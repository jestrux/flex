//! The agents' own accounts: Claude Code session transcripts, followed read-only and in place.
//!
//! **On disk** (Claude Code 2.1, checked 2026-10-17): `~/.claude/projects/<slug of the session's starting cwd>/` holds
//! `<session>.jsonl` (the main agent) and `<session>/subagents/agent-<agentId>.jsonl` (each subagent, workflows' agents
//! under `subagents/workflows/<wf>/`), each with `agent-<agentId>.meta.json` = `{agentType, description, toolUseId,
//! spawnDepth}`. `toolUseId` is the parent's `Agent` tool call: that is the link from a parent's lane to the child's.
//! The slug is the cwd with every non-alphanumeric character turned into `-`. One JSON object per line; each content
//! block of a message is its own line (`type` assistant/user, `timestamp`, `cwd`, `message.content[]`: `text`,
//! `tool_use {id,name,input}`, `tool_result {tool_use_id,is_error}`). A background subagent's end reaches the parent
//! as a user line with `origin.kind = "task-notification"` (`<task-id>`, `<status>`).
//!
//! **Which sessions belong to a project** ([`Finder`]), strongest first:
//! 1. a recorded `flex` command carried the session's id (`CLAUDE_CODE_SESSION_ID`): exact;
//! 2. the session started in the project (its folder's slug is the project's, or a folder inside it): exact for the
//!    main agent;
//! 3. a line inside the window has a `cwd` in the project, or a tool call names a path in the project (by its real
//!    path, the path as given, or `~/…`): good, but it misses an agent that only uses relative paths from a cwd
//!    outside the project (rare: the cwd would be outside), and it counts a session that only read the project.
//! Rule 3 needs a scan of every transcript changed inside the window (substring search, no JSON parse): ~1 s per GB
//! the first time; the offsets scanned are cached in Flex's support folder (`activity/scan/`, no transcript content),
//! so later reads only scan what was appended.

use super::trail::{Event, Kind, Lane, LaneKind};
use super::{clip, parse_iso};
use serde::de::{self, Deserializer, IgnoredAny, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Where Claude Code keeps transcripts: `FLEX_CLAUDE_PROJECTS`, else `~/.claude/projects`.
pub fn claude_root() -> PathBuf {
    std::env::var_os("FLEX_CLAUDE_PROJECTS").map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".claude").join("projects"))
}

/// Claude Code's folder name for a cwd.
pub fn slug(p: &Path) -> String { p.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect() }

/// A subagent's `.meta.json`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub agent_type: Option<String>,
    pub description: Option<String>,
    pub tool_use_id: Option<String>,
    pub spawn_depth: Option<u32>,
}

/// One transcript file: a session's main agent, or one of its subagents.
#[derive(Debug, Clone)]
pub struct Transcript {
    pub path: PathBuf,
    pub session: String,
    /// the subagent's id (None: the main agent)
    pub agent: Option<String>,
    pub meta: Meta,
    pub size: u64,
    pub mtime_ms: i64,
}

impl Transcript {
    pub fn lane_id(&self) -> String {
        match &self.agent { Some(a) => format!("a:{a}"), None => format!("s:{}", self.session) }
    }
}

fn stat(p: &Path) -> Option<(u64, i64)> {
    let md = fs::metadata(p).ok()?;
    Some((md.len(), md.modified().map(super::ms_of).unwrap_or(0)))
}

/// Every transcript under `root` changed at or after `since` (and the main transcript of any session with a subagent
/// that did, so a lane always has its parent).
pub fn list(root: &Path, since: i64) -> Vec<Transcript> {
    let mut out = vec![];
    for folder in fs::read_dir(root).into_iter().flatten().flatten() {
        let fp = folder.path();
        if !fp.is_dir() { continue; }
        for f in fs::read_dir(&fp).into_iter().flatten().flatten() {
            let p = f.path();
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else { continue };
            let Some(session) = name.strip_suffix(".jsonl") else { continue };
            let Some((size, mtime)) = stat(&p) else { continue };
            let subs = subagents(&fp.join(session), session, since);
            if mtime >= since || !subs.is_empty() {
                out.push(Transcript { path: p.clone(), session: session.to_string(), agent: None, meta: Meta::default(), size, mtime_ms: mtime });
            }
            out.extend(subs);
        }
    }
    out
}

/// A session's subagents changed at or after `since` (`<session>/subagents/**/agent-*.jsonl`).
fn subagents(dir: &Path, session: &str, since: i64) -> Vec<Transcript> {
    let mut out = vec![];
    let mut stack = vec![dir.join("subagents")];
    while let Some(d) = stack.pop() {
        for f in fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = f.path();
            if f.file_type().is_ok_and(|t| t.is_dir()) { if stack.len() < 64 { stack.push(p); } continue; }
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else { continue };
            let Some(agent) = name.strip_prefix("agent-").and_then(|n| n.strip_suffix(".jsonl")).map(String::from) else { continue };
            let Some((size, mtime)) = stat(&p) else { continue };
            if mtime < since { continue; }
            let meta = fs::read(p.with_file_name(format!("agent-{agent}.meta.json"))).ok()
                .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            out.push(Transcript { path: p, session: session.to_string(), agent: Some(agent), meta, size, mtime_ms: mtime });
        }
    }
    out
}

/// The byte offset of the first line at or after `since` (transcripts are appended in time order), by bisection, so a
/// 500 MB transcript is never read from the start to show its last hour.
pub fn offset_at(path: &Path, since: i64) -> u64 {
    let Ok(f) = fs::File::open(path) else { return 0 };
    let size = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut r = BufReader::with_capacity(1 << 16, f);
    // the time of the first timestamped line at or after `at`, and where that line starts
    let mut probe = |at: u64| -> Option<(i64, u64)> {
        r.seek(SeekFrom::Start(at)).ok()?;
        let mut pos = at;
        if at > 0 { pos += r.skip_until(b'\n').ok()? as u64; }
        let mut line = Vec::new();
        for _ in 0..50 {
            line.clear();
            let n = r.read_until(b'\n', &mut line).ok()?;
            if n == 0 { return None; }
            if let Some(t) = timestamp_of(&line) { return Some((t, pos)); }
            pos += n as u64;
        }
        None
    };
    if since <= 0 { return 0; }
    let (mut lo, mut hi) = (0u64, size);
    // invariant: every line starting before `lo` is older than `since`
    while hi - lo > 1 << 16 {
        let mid = lo + (hi - lo) / 2;
        match probe(mid) {
            Some((t, _)) if t < since => lo = mid,
            _ => hi = mid,
        }
    }
    // finish linearly from the line at `lo`
    let start = if lo == 0 { 0 } else { match probe(lo) { Some((_, p)) => p, None => return size } };
    let Ok(_) = r.seek(SeekFrom::Start(start)) else { return 0 };
    let mut pos = start;
    let mut line = Vec::new();
    loop {
        line.clear();
        let Ok(n) = r.read_until(b'\n', &mut line) else { return pos };
        if n == 0 { return pos; }
        if timestamp_of(&line).is_some_and(|t| t >= since) { return pos; }
        pos += n as u64;
    }
}

/// A line's `"timestamp":"…"` without parsing the line (they can be megabytes).
fn timestamp_of(line: &[u8]) -> Option<i64> {
    const KEY: &[u8] = b"\"timestamp\":\"";
    let i = find(line, KEY, 0)?;
    let s = &line[i + KEY.len()..];
    let end = s.iter().position(|&c| c == b'"')?;
    parse_iso(std::str::from_utf8(&s[..end]).ok()?)
}

fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || hay.len() < needle.len() { return None; }
    let first = needle[0];
    let mut i = from;
    while i + needle.len() <= hay.len() {
        let j = i + hay[i..hay.len() - needle.len() + 1].iter().position(|&c| c == first)?;
        if &hay[j..j + needle.len()] == needle { return Some(j); }
        i = j + 1;
    }
    None
}

// ── which transcripts touch a project ──────────────────────────────────────────────────────────────────────────

/// The ways a project's path is written in a transcript: its real path, the path as the caller gave it, and `~/…`.
pub fn aliases(project: &Path, given: &[PathBuf]) -> Vec<String> {
    let mut v: Vec<String> = vec![project.to_string_lossy().into_owned()];
    for g in given { v.push(g.to_string_lossy().into_owned()); }
    if let Some(home) = dirs::home_dir() {
        for a in v.clone() {
            if let Ok(r) = Path::new(&a).strip_prefix(&home) { v.push(format!("~/{}", r.to_string_lossy())); }
        }
    }
    v.retain(|a| a.len() > 3);
    v.sort();
    v.dedup();
    v
}

/// Whether `alias` occurs in `line` as a whole path (not as the start of a sibling folder's name, `overview-lab-a`).
fn mentions(line: &[u8], alias: &[u8]) -> bool {
    let mut from = 0;
    while let Some(i) = find(line, alias, from) {
        match line.get(i + alias.len()) {
            None | Some(b'/' | b'"' | b' ' | b'\'' | b'\\' | b'\n' | b')' | b',' | b':' | b'`' | b';') => return true,
            _ => from = i + 1,
        }
    }
    false
}

/// A line is evidence when its cwd is in the project or it is a tool call naming the project (a mention in a prompt or a
/// tool's output is not: the brief that names a project doesn't make an agent work on it).
fn evidence(line: &[u8], aliases: &[String]) -> bool {
    aliases.iter().any(|a| {
        let a = a.as_bytes();
        if !mentions(line, a) { return false; }
        let mut cwd = b"\"cwd\":\"".to_vec();
        cwd.extend_from_slice(a);
        mentions(line, &cwd) || (find(line, b"\"type\":\"tool_use\"", 0).is_some() && find(line, b"\"type\":\"assistant\"", 0).is_some())
    })
}

#[derive(Serialize, Deserialize, Default, Clone, Copy)]
struct Scanned { from: u64, to: u64, last_hit: Option<u64> }

/// Finds a project's transcripts, remembering what it has scanned.
pub struct Finder {
    root: PathBuf,
    aliases: Vec<String>,
    slugs: Vec<String>,
    cache_file: Option<PathBuf>,
    scanned: BTreeMap<String, Scanned>,
    dirty: bool,
}

impl Finder {
    pub fn new(root: &Path, project: &Path, given: &[PathBuf], cache_dir: Option<&Path>) -> Finder {
        let aliases = aliases(project, given);
        let slugs: Vec<String> = aliases.iter().filter(|a| a.starts_with('/')).map(|a| slug(Path::new(a))).collect();
        let cache_file = cache_dir.map(|d| {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            project.hash(&mut h);
            d.join(format!("{:016x}.json", h.finish()))
        });
        let scanned = cache_file.as_ref().and_then(|f| fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Finder { root: root.to_path_buf(), aliases, slugs, cache_file, scanned, dirty: false }
    }

    pub fn aliases(&self) -> &[String] { &self.aliases }

    /// The session started in the project (rule 2).
    pub fn started_in(&self, t: &Transcript) -> bool {
        let folder = t.path.strip_prefix(&self.root).ok().and_then(|r| r.components().next())
            .map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();
        t.agent.is_none() && self.slugs.iter().any(|s| folder == *s || folder.starts_with(&format!("{s}-")))
    }

    /// Whether the transcript has evidence (rule 3) at or after byte `from`, scanning only what it hasn't before.
    pub fn touches(&mut self, t: &Transcript, from: u64) -> bool {
        let key = t.path.to_string_lossy().into_owned();
        let mut s = self.scanned.get(&key).copied().unwrap_or(Scanned { from: t.size, to: t.size, last_hit: None });
        if t.size < s.to { s = Scanned { from: t.size, to: t.size, last_hit: None }; } // rewritten: start over
        let hit = |a: u64, b: u64, s: &mut Scanned| { if let Some(h) = scan(&t.path, a, b, &self.aliases) { s.last_hit = Some(s.last_hit.map_or(h, |x| x.max(h))); } };
        if from < s.from { hit(from, s.from, &mut s); s.from = from; self.dirty = true; }
        if s.to < t.size { hit(s.to, t.size, &mut s); s.to = t.size; self.dirty = true; }
        self.scanned.insert(key, s);
        s.last_hit.is_some_and(|h| h >= from)
    }

    /// Keep what was scanned (only offsets, never content).
    pub fn save(&mut self) {
        if !self.dirty { return; }
        if let Some(f) = &self.cache_file {
            if let Some(d) = f.parent() { let _ = fs::create_dir_all(d); }
            if let Ok(b) = serde_json::to_vec(&self.scanned) { let _ = fs::write(f, b); }
        }
        self.dirty = false;
    }
}

/// The offset of the last evidence line in [a, b), reading in chunks of complete lines.
fn scan(path: &Path, a: u64, b: u64, aliases: &[String]) -> Option<u64> {
    let mut f = fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(a)).ok()?;
    let mut r = f.take(b - a);
    let mut buf: Vec<u8> = Vec::with_capacity(8 << 20);
    let mut base = a;
    let mut last = None;
    let mut chunk = vec![0u8; 8 << 20];
    loop {
        let n = r.read(&mut chunk).ok()?;
        if n > 0 { buf.extend_from_slice(&chunk[..n]); }
        let end = if n == 0 { buf.len() } else { match buf.iter().rposition(|&c| c == b'\n') { Some(i) => i + 1, None => continue } };
        let quick = aliases.iter().any(|al| find(&buf[..end], al.as_bytes(), 0).is_some());
        if quick {
            let mut s = 0;
            for line in buf[..end].split_inclusive(|&c| c == b'\n') {
                if evidence(line, aliases) { last = Some(base + s as u64); }
                s += line.len();
            }
        }
        base += end as u64;
        buf.drain(..end);
        if n == 0 { return last; }
    }
}

// ── reading events ─────────────────────────────────────────────────────────────────────────────────────────────

/// A transcript line, only the fields the trail uses (the rest, tool outputs included, is skipped, not built).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    #[serde(rename = "type")]
    ty: Option<String>,
    timestamp: Option<String>,
    uuid: Option<String>,
    #[serde(default)]
    is_meta: bool,
    subtype: Option<String>,
    message: Option<Msg>,
    origin: Option<Origin>,
    custom_title: Option<String>,
    cwd: Option<String>,
}

#[derive(Deserialize)]
struct Origin { kind: Option<String> }

#[derive(Deserialize)]
struct Msg { content: Option<Content> }

enum Content { Text(String), Blocks(Vec<Block>) }

impl<'de> Deserialize<'de> for Content {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Content;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("a string or blocks") }
            fn visit_str<E: de::Error>(self, s: &str) -> Result<Content, E> { Ok(Content::Text(s.to_string())) }
            fn visit_string<E: de::Error>(self, s: String) -> Result<Content, E> { Ok(Content::Text(s)) }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<Content, A::Error> {
                let mut v = vec![];
                while let Some(b) = a.next_element::<Block>()? { v.push(b); }
                Ok(Content::Blocks(v))
            }
        }
        d.deserialize_any(V)
    }
}

#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    ty: String,
    text: Option<String>,
    id: Option<String>,
    name: Option<String>,
    input: Option<Value>,
    tool_use_id: Option<String>,
    is_error: Option<bool>,
    /// a result's text, only its start (an error's message)
    content: Option<ResultText>,
}

/// The first 300 characters of a tool result's text, skipping the rest without building it.
struct ResultText(String);
impl<'de> Deserialize<'de> for ResultText {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        #[derive(Deserialize)]
        struct T { text: Option<String> }
        impl<'de> Visitor<'de> for V {
            type Value = ResultText;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("a result") }
            fn visit_str<E: de::Error>(self, s: &str) -> Result<ResultText, E> { Ok(ResultText(clip(s, 300))) }
            fn visit_seq<A: SeqAccess<'de>>(self, mut a: A) -> Result<ResultText, A::Error> {
                let mut first = String::new();
                while let Some(t) = a.next_element::<T>()? { if first.is_empty() { first = t.text.map(|s| clip(&s, 300)).unwrap_or_default(); } }
                Ok(ResultText(first))
            }
            fn visit_unit<E: de::Error>(self) -> Result<ResultText, E> { Ok(ResultText(String::new())) }
            fn visit_map<A: de::MapAccess<'de>>(self, mut a: A) -> Result<ResultText, A::Error> {
                while a.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                Ok(ResultText(String::new()))
            }
        }
        d.deserialize_any(V)
    }
}

/// Reads one transcript incrementally into events in its lane.
pub struct Reader {
    pub transcript: Transcript,
    pub offset: u64,
    /// where reading began (the window's start)
    pub start: u64,
    lane: String,
    aliases: Vec<String>,
    /// tool calls not yet answered: id → name (results of reads and searches only matter when they fail)
    open: HashMap<String, (String, i64)>,
    pub title: Option<String>,
    pub done: bool,
}

/// A tool call's diff, from its own input (an Edit's old and new text, a Write's content): the agent's exact edit.
const EDIT_DIFF_MAX: usize = 16 << 10;

impl Reader {
    pub fn new(t: Transcript, from: u64, aliases: &[String]) -> Reader {
        let lane = t.lane_id();
        Reader { transcript: t, offset: from, start: from, lane, aliases: aliases.to_vec(), open: HashMap::new(), title: None, done: false }
    }

    /// Everything appended since the last read (complete lines only: the last one may still be being written).
    pub fn read(&mut self) -> Vec<Event> {
        let mut out = vec![];
        let Ok(mut f) = fs::File::open(&self.transcript.path) else { return out };
        let size = f.metadata().map(|m| m.len()).unwrap_or(0);
        if size < self.offset { self.offset = 0; } // rewritten
        if size == self.offset || f.seek(SeekFrom::Start(self.offset)).is_err() { return out; }
        let mut r = BufReader::with_capacity(1 << 20, f);
        let mut line = Vec::new();
        loop {
            line.clear();
            let Ok(n) = r.read_until(b'\n', &mut line) else { break };
            if n == 0 || line.last() != Some(&b'\n') { break; }
            self.offset += n as u64;
            if let Ok(l) = serde_json::from_slice::<Line>(&line) {
                let before = out.len();
                let was_done = self.done;
                self.line(l, &mut out);
                // a subagent resumed after its report is working again
                if was_done && out[before..].iter().any(|e| e.kind != Kind::Prompt && e.kind != Kind::Checkpoint) { self.done = false; }
            }
        }
        out
    }

    fn rel(&self, p: &str) -> String {
        for a in &self.aliases {
            if let Some(r) = p.strip_prefix(a.as_str()) { if r.is_empty() || r.starts_with('/') { return r.trim_start_matches('/').to_string(); } }
        }
        p.to_string()
    }

    fn ev(&self, t: i64, kind: Kind, id: String, title: String) -> Event {
        Event { id, t_ms: t, lane: self.lane.clone(), kind, title, ..Event::default() }
    }

    fn line(&mut self, l: Line, out: &mut Vec<Event>) {
        if let Some(t) = l.custom_title { self.title = Some(t); return; }
        let Some(t) = l.timestamp.as_deref().and_then(parse_iso) else { return };
        let uuid = l.uuid.unwrap_or_default();
        match l.ty.as_deref() {
            Some("system") if l.subtype.as_deref() == Some("compact_boundary") => {
                out.push(self.ev(t, Kind::Checkpoint, format!("u:{uuid}"), "Context compacted".into()));
            }
            Some("assistant") => {
                let Some(Content::Blocks(blocks)) = l.message.and_then(|m| m.content) else { return };
                for (i, b) in blocks.into_iter().enumerate() {
                    match b.ty.as_str() {
                        "text" => {
                            let text = b.text.unwrap_or_default();
                            if text.trim().is_empty() { continue; }
                            let mut e = self.ev(t, Kind::Message, format!("u:{uuid}:{i}"), clip(&text, 240));
                            if text.chars().count() > 240 { e.detail = Some(clip_lines(&text, 2000)); }
                            out.push(e);
                        }
                        "tool_use" => {
                            let id = b.id.unwrap_or_else(|| format!("u:{uuid}:{i}"));
                            let name = b.name.unwrap_or_default();
                            let input = b.input.unwrap_or(Value::Null);
                            self.open.insert(id.clone(), (name.clone(), t));
                            out.push(self.tool_call(t, id, &name, &input));
                        }
                        _ => {}
                    }
                }
            }
            Some("user") if !l.is_meta => {
                if l.origin.as_ref().and_then(|o| o.kind.as_deref()) == Some("task-notification") {
                    if let Some(Content::Text(s)) = l.message.and_then(|m| m.content) {
                        let tag = |k: &str| s.split(&format!("<{k}>")).nth(1).and_then(|r| r.split(&format!("</{k}>")).next()).map(str::trim).map(String::from);
                        if let Some(child) = tag("task-id") {
                            let status = tag("status").unwrap_or_else(|| "finished".into());
                            let mut e = self.ev(t, Kind::Done, format!("u:{uuid}"), tag("summary").unwrap_or_else(|| format!("Agent {status}")));
                            e.child_lane = Some(format!("a:{child}"));
                            e.ref_id = tag("tool-use-id");
                            e.ok = Some(status == "completed");
                            out.push(e);
                        }
                    }
                    return;
                }
                if l.origin.is_some() { return; } // messages from peers: the sender's own lane has them
                match l.message.and_then(|m| m.content) {
                    Some(Content::Text(s)) => self.prompt(t, &uuid, &s, out),
                    Some(Content::Blocks(blocks)) => {
                        for (i, b) in blocks.into_iter().enumerate() {
                            match b.ty.as_str() {
                                "tool_result" => {
                                    let id = b.tool_use_id.unwrap_or_default();
                                    let Some((name, at)) = self.open.remove(&id) else { continue };
                                    let failed = b.is_error.unwrap_or(false);
                                    let mut e = self.ev(t, Kind::Result, format!("r:{id}"), if failed { format!("{name} failed") } else { format!("{name} done") });
                                    e.ok = Some(!failed);
                                    e.ref_id = Some(id);
                                    e.dur_ms = Some((t - at).max(0) as u64);
                                    if failed { e.detail = b.content.map(|c| c.0); }
                                    out.push(e);
                                }
                                "text" => self.prompt(t, &format!("{uuid}:{i}"), b.text.as_deref().unwrap_or(""), out),
                                _ => {}
                            }
                        }
                    }
                    None => {}
                }
            }
            _ => {}
        }
        let _ = l.cwd;
    }

    /// What the author (or, for a subagent, its parent) asked. Harness-injected text (`<system-reminder>`, a slash
    /// command's wrapper) is left out.
    fn prompt(&self, t: i64, id: &str, s: &str, out: &mut Vec<Event>) {
        let s = s.trim();
        if s.is_empty() || s.starts_with('<') || s.starts_with("[Request interrupted") { return; }
        let mut e = self.ev(t, Kind::Prompt, format!("u:{id}"), clip(s, 240));
        if s.chars().count() > 240 { e.detail = Some(clip_lines(s, 2000)); }
        out.push(e);
    }

    fn tool_call(&mut self, t: i64, id: String, name: &str, input: &Value) -> Event {
        let s = |k: &str| input.get(k).and_then(|v| v.as_str()).unwrap_or("");
        let mut e = self.ev(t, Kind::Tool, id.clone(), name.to_string());
        e.tool = Some(name.to_string());
        let path = ["file_path", "path", "notebook_path"].iter().map(|k| s(k)).find(|p| !p.is_empty()).map(|p| self.rel(p));
        if let Some(p) = &path { e.paths.push(p.clone()); }
        match name {
            "Bash" => {
                let cmd = s("command");
                e.title = if s("description").is_empty() { clip(cmd, 120) } else { clip(s("description"), 120) };
                e.detail = Some(clip_lines(cmd, 2000));
                for w in cmd.split(|c: char| c.is_whitespace() || "'\";|&()<>".contains(c)) {
                    if self.aliases.iter().any(|a| w.starts_with(a.as_str())) {
                        let r = self.rel(w);
                        if !r.is_empty() && !e.paths.contains(&r) { e.paths.push(r); }
                    }
                }
                e.command = Some(cmd.to_string());
            }
            "Read" => e.title = format!("Read {}", path.unwrap_or_default()),
            "Write" => {
                let content = s("content");
                e.title = format!("Write {} ({} lines)", path.unwrap_or_default(), content.lines().count());
                let d = super::diff::unified("", content, EDIT_DIFF_MAX);
                e.diff = Some(d.text);
            }
            "Edit" | "MultiEdit" => {
                e.title = format!("Edit {}", path.unwrap_or_default());
                let edits: Vec<(&str, &str)> = match input.get("edits").and_then(|v| v.as_array()) {
                    Some(a) => a.iter().map(|x| (x["old_string"].as_str().unwrap_or(""), x["new_string"].as_str().unwrap_or(""))).collect(),
                    None => vec![(s("old_string"), s("new_string"))],
                };
                let mut text = String::new();
                for (old, new) in edits {
                    let d = super::diff::unified(old, new, EDIT_DIFF_MAX.saturating_sub(text.len()));
                    // the snippet's line numbers aren't the file's: keep the hunk marks, drop the numbers
                    for l in d.text.lines() { text.push_str(if l.starts_with("@@") { "@@" } else { l }); text.push('\n'); }
                }
                e.diff = Some(text);
            }
            "Grep" | "Glob" => e.title = format!("{name} {}", clip(s("pattern"), 100)),
            "Agent" | "Task" => {
                e.kind = Kind::Spawn;
                let ty = if s("subagent_type").is_empty() { "agent" } else { s("subagent_type") };
                e.title = format!("Spawned {ty}: {}", clip(s("description"), 100));
                e.detail = Some(clip_lines(s("prompt"), 2000));
            }
            "SendMessage" => {
                e.title = format!("Message to {}: {}", clip(s("to"), 40), clip(s("summary"), 100));
                e.child_lane = Some(format!("a:{}", s("to")));
                e.detail = Some(clip_lines(s("message"), 2000));
            }
            "SubagentHandback" => {
                e.kind = Kind::Checkpoint;
                e.title = format!("Report: {}", clip(s("message"), 160));
                e.detail = Some(clip_lines(s("message"), 4000));
                self.done = true;
            }
            "Skill" => e.title = format!("Skill {}", s("skill")),
            "WebFetch" | "WebSearch" => e.title = format!("{name} {}", clip(if s("url").is_empty() { s("query") } else { s("url") }, 100)),
            _ => {
                if let Some(p) = &e.paths.first() { e.title = format!("{name} {p}"); }
            }
        }
        e
    }
}

/// `s` kept to `n` characters, lines and all (for the detail an event opens to).
fn clip_lines(s: &str, n: usize) -> String {
    if s.chars().count() <= n { s.to_string() } else { format!("{}…", s.chars().take(n).collect::<String>()) }
}

/// The lane a transcript is read into.
pub fn lane_of(t: &Transcript, reader_title: Option<&str>) -> Lane {
    match &t.agent {
        None => Lane {
            id: t.lane_id(), kind: LaneKind::Main,
            label: reader_title.map(String::from).unwrap_or_else(|| format!("Main agent · {}", &t.session[..t.session.len().min(8)])),
            parent: None, session: Some(t.session.clone()), agent_type: None, transcript: Some(t.path.to_string_lossy().into_owned()),
            ..Lane::default()
        },
        Some(a) => Lane {
            id: t.lane_id(), kind: LaneKind::Subagent,
            label: t.meta.description.clone().unwrap_or_else(|| format!("Subagent {a}")),
            parent: None, session: Some(t.session.clone()), agent_type: t.meta.agent_type.clone(),
            transcript: Some(t.path.to_string_lossy().into_owned()), spawned_by: t.meta.tool_use_id.clone(),
            depth: t.meta.spawn_depth.unwrap_or(1),
            ..Lane::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_like_claude_code() {
        assert_eq!(slug(Path::new("/Users/me/Documents/web/my-app")), "-Users-me-Documents-web-my-app");
        assert_eq!(slug(Path::new("/a/b.c_d")), "-a-b-c-d");
    }

    #[test]
    fn mentions_whole_paths_only() {
        let a = b"/x/overview";
        assert!(mentions(br#"{"file_path":"/x/overview/scenes/a.ts"}"#, a));
        assert!(mentions(br#"cd /x/overview && ls"#, a));
        assert!(!mentions(br#"{"file_path":"/x/overview-lab-a/scenes/a.ts"}"#, a));
    }

    #[test]
    fn finds_the_offset_of_a_time() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("s.jsonl");
        let mut body = String::new();
        for i in 0..5000 {
            body.push_str(&format!("{{\"type\":\"user\",\"timestamp\":\"{}\",\"pad\":\"{}\"}}\n", super::super::iso(1_000_000 + i * 1000), "x".repeat(i as usize % 300)));
            if i % 7 == 0 { body.push_str("{\"type\":\"summary\"}\n"); }
        }
        fs::write(&p, &body).unwrap();
        for i in [0i64, 1, 2500, 4999] {
            let off = offset_at(&p, 1_000_000 + i * 1000) as usize;
            assert_eq!(timestamp_of(body[off..].lines().next().unwrap().as_bytes()), Some(1_000_000 + i * 1000));
        }
        assert_eq!(offset_at(&p, 999_999_999), body.len() as u64);
    }
}
