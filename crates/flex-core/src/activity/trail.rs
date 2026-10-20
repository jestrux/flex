//! The merged trail: lanes (Flex's own, each session's main agent, each subagent under its parent) and events on one
//! clock, read incrementally. `Trail::poll` returns what is new since the last poll: the CLI polls once (or every
//! second with `--follow`), the app every second or two while the panel shows.
//!
//! **Attribution** (whose lane an event goes in):
//! - a transcript's events are its agent's;
//! - a `flex` command run by an agent carries its session id; it goes to the lane (main or subagent) whose Bash call
//!   ran it: a call in that session that started before the command and hadn't finished, whose text names `flex` and
//!   the subcommand. No match (the transcript isn't readable, or the command was run another way): the session's main
//!   lane. No session id: Flex's lane;
//! - a file change during a command is that command's; between commands, an agent's Edit/Write of that path around
//!   that time (exact), else a Bash call running at that moment (`guess`), else Flex's lane.

use super::record::Words;
use super::transcripts::{self, Finder, Reader, Transcript};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// a `flex` command (from the project's log)
    #[default]
    Command,
    /// a file in the project changed (from the log, with its diff)
    Change,
    /// what the author, or a subagent's parent, asked
    Prompt,
    /// the agent's own words
    Message,
    /// a tool call
    Tool,
    /// a tool call's answer (folded into the call when both are in hand)
    Result,
    /// a subagent started (`child_lane`)
    Spawn,
    /// a subagent finished (`child_lane`)
    Done,
    /// a report or a compaction: a point to come back to
    Checkpoint,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Command => "command", Kind::Change => "change", Kind::Prompt => "prompt", Kind::Message => "message",
            Kind::Tool => "tool", Kind::Result => "result", Kind::Spawn => "spawn", Kind::Done => "done", Kind::Checkpoint => "checkpoint",
        }
    }
}

/// Something a command made.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Made {
    /// as logged: project-relative inside the project, else absolute
    pub path: String,
    /// absolute, for opening or a thumbnail
    pub abs: String,
    /// still, render, video, audio, take-version, data, folder, …
    pub kind: String,
    pub bytes: u64,
    /// project, out or cwd
    pub place: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Event {
    /// stable across polls (a tool call's id, a log line's id)
    pub id: String,
    pub t_ms: i64,
    pub lane: String,
    pub kind: Kind,
    /// one line
    pub title: String,
    /// more, when there is more (an error, a whole message, a Bash command)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dur_ms: Option<u64>,
    /// files it touched, project-relative when inside
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub made: Vec<Made>,
    /// a unified diff (a file change, or an agent's Edit/Write)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    /// a film time a command was about (`flex frame <dir> 12.5s`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seek_s: Option<f64>,
    /// or a frame number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seek_frame: Option<u32>,
    /// the subagent a spawn, a message or an end is about
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_lane: Option<String>,
    /// the tool call this belongs to (a command an agent's Bash call ran, a change its Edit made, a result)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<String>,
    /// the tool's name, for a tool call
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    /// the lane was guessed from timing, not matched
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub guess: bool,
    /// a Bash call's command line (for matching flex commands to it)
    #[serde(skip)]
    pub command: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LaneKind {
    /// Flex's own: commands and changes no agent claimed
    #[default]
    Flex,
    Main,
    Subagent,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Lane {
    /// `flex`, `s:<session>` or `a:<agent id>`
    pub id: String,
    pub kind: LaneKind,
    pub label: String,
    /// the lane that spawned it
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    /// the transcript it's read from (read-only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript: Option<String>,
    /// the parent's tool call that spawned it
    #[serde(skip)]
    pub spawned_by: Option<String>,
    pub depth: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ms: Option<i64>,
    pub events: usize,
    /// a subagent that reported back or was seen to finish
    pub done: bool,
    /// why it's in this project's trail
    pub why: String,
    /// in the trail only as its subagents' parent: only its events about them are shown (spawns, ends, messages)
    pub parent_only: bool,
    /// it changed the project (an edit or write of a project file, a recorded command, a change credited to it), as
    /// opposed to only reading it (an agent studying a film as prior art). Read-only lanes come after working ones.
    pub works: bool,
}

pub struct Options {
    /// events before this are left out (epoch ms; 0 = everything)
    pub since_ms: i64,
    /// where the transcripts are (default `transcripts::claude_root()`); None reads no transcripts
    pub claude_root: Option<PathBuf>,
    /// where to remember scanned offsets (default Flex's support folder); None = don't
    pub cache_dir: Option<PathBuf>,
    /// the path the project was given as, besides its real path (a symlink): also searched for in transcripts
    pub given: Vec<PathBuf>,
}

impl Options {
    pub fn new(since_ms: i64) -> Options {
        Options {
            since_ms, claude_root: Some(transcripts::claude_root()),
            cache_dir: Some(crate::project::support_dir().join("activity").join("scan")), given: vec![],
        }
    }
}

/// A tool call kept for attributing commands and changes that are read later.
#[derive(Clone)]
struct Call { lane: String, id: String, t: i64, end: Option<i64>, text: String, paths: Vec<String>, edit: bool }

pub struct Trail {
    project: PathBuf,
    opts: Options,
    finder: Option<Finder>,
    readers: Vec<Reader>,
    lanes: BTreeMap<String, Lane>,
    /// transcripts looked at and not (yet) in: path → where reading would start
    seen: HashMap<PathBuf, u64>,
    /// a subagent's spawning tool call → its lane
    spawned: HashMap<String, String>,
    /// tool call id → lane
    calls_lane: HashMap<String, String>,
    calls: Vec<Call>,
    /// command id → lane
    cmd_lane: HashMap<String, String>,
    sessions: HashSet<String>,
    /// every subagent seen (a task notification about anything else is a background command's)
    agents: HashSet<String>,
    log_offset: u64,
    first: bool,
}

/// What a poll found.
pub struct Update { pub lanes: Vec<Lane>, pub events: Vec<Event> }

const CALLS_KEPT: usize = 5000;
const STARTED: &str = "started in the project";
const READS: &str = "reads the project";
const WORKS: &str = "works in the project's files";

impl Trail {
    pub fn open(project: &Path, opts: Options) -> Trail {
        let project = fs::canonicalize(project).unwrap_or_else(|_| project.to_path_buf());
        let finder = opts.claude_root.as_ref().map(|r| Finder::new(r, &project, &opts.given, opts.cache_dir.as_deref()));
        let mut lanes = BTreeMap::new();
        lanes.insert("flex".into(), Lane { id: "flex".into(), kind: LaneKind::Flex, label: "Flex".into(), why: "commands and changes no agent claimed".into(), works: true, ..Lane::default() });
        Trail {
            project, opts, finder, readers: vec![], lanes, seen: HashMap::new(), spawned: HashMap::new(), calls_lane: HashMap::new(),
            calls: vec![], cmd_lane: HashMap::new(), sessions: HashSet::new(), agents: HashSet::new(), log_offset: 0, first: true,
        }
    }

    pub fn project(&self) -> &Path { &self.project }

    /// The lanes as they stand, parents before their children.
    pub fn lanes(&self) -> Vec<Lane> {
        let mut out = vec![];
        // working lanes (or parents of one) first, then those that only read the project; each by first event
        let working = |id: &str| -> bool {
            let mut stack = vec![id.to_string()];
            let mut n = 0;
            while let Some(x) = stack.pop() {
                n += 1;
                if n > 512 { break; }
                if self.lanes.get(&x).is_some_and(|l| l.works) { return true; }
                stack.extend(self.lanes.values().filter(|c| c.parent.as_deref() == Some(x.as_str())).map(|c| c.id.clone()));
            }
            false
        };
        let key: HashMap<String, (bool, i64)> = self.lanes.values().map(|l| (l.id.clone(), (!working(&l.id), l.first_ms.unwrap_or(i64::MAX)))).collect();
        fn add(id: &str, all: &BTreeMap<String, Lane>, out: &mut Vec<Lane>, depth: usize, key: &HashMap<String, (bool, i64)>) {
            let Some(l) = all.get(id) else { return };
            if out.iter().any(|x: &Lane| x.id == l.id) || depth > 16 { return; }
            out.push(l.clone());
            let mut kids: Vec<&Lane> = all.values().filter(|c| c.parent.as_deref() == Some(id)).collect();
            kids.sort_by_key(|c| key[&c.id]);
            for c in kids { add(&c.id, all, out, depth + 1, key); }
        }
        add("flex", &self.lanes, &mut out, 0, &key);
        let mut roots: Vec<&Lane> = self.lanes.values().filter(|l| l.id != "flex" && l.parent.as_ref().is_none_or(|p| !self.lanes.contains_key(p))).collect();
        roots.sort_by_key(|l| key[&l.id]);
        for r in roots { add(&r.id, &self.lanes, &mut out, 0, &key); }
        out
    }

    /// What is new since the last poll (the first poll: everything since `since`), in time order.
    pub fn poll(&mut self) -> Update {
        let log = self.read_log();
        for (_, v) in &log { if let Some(s) = v["agent"]["session"].as_str() { self.sessions.insert(s.to_string()); } }
        let mut events = vec![];
        if self.finder.is_some() { self.discover(); }
        for r in &mut self.readers {
            let new = r.read();
            let lane = r.transcript.lane_id();
            if let Some(l) = self.lanes.get_mut(&lane) {
                if r.title.is_some() && l.kind == LaneKind::Main { l.label = r.title.clone().unwrap(); }
                if r.done { l.done = true; }
                else if new.iter().any(|e| !matches!(e.kind, Kind::Prompt | Kind::Checkpoint)) { l.done = false; } // resumed
            }
            for e in &new {
                if e.kind == Kind::Tool || e.kind == Kind::Spawn {
                    self.calls_lane.insert(e.id.clone(), lane.clone());
                    self.calls.push(Call { lane: lane.clone(), id: e.id.clone(), t: e.t_ms, end: None, text: e.command.clone().unwrap_or_default(), paths: e.paths.clone(), edit: matches!(e.tool.as_deref(), Some("Edit" | "MultiEdit" | "Write")) });
                }
                if e.kind == Kind::Result {
                    if let Some(id) = &e.ref_id { if let Some(c) = self.calls.iter_mut().rev().find(|c| &c.id == id) { c.end = Some(e.t_ms); } }
                }
            }
            let parent_only = self.lanes.get(&lane).is_some_and(|l| l.parent_only);
            let lanes = &self.lanes;
            let spawned = &self.spawned;
            events.extend(new.into_iter().filter(|e| e.t_ms >= self.opts.since_ms).filter(|e| {
                if !parent_only { return true; }
                let child = if e.kind == Kind::Spawn { spawned.get(&e.id) } else { e.child_lane.as_ref() };
                child.is_some_and(|c| lanes.contains_key(c))
            }));
        }
        if self.calls.len() > CALLS_KEPT { self.calls.drain(..self.calls.len() - CALLS_KEPT); }
        // subagents finish in their parents' lanes; a background command's end is a plain event in the lane that ran it
        for e in &mut events {
            if e.kind != Kind::Done { continue; }
            if e.child_lane.as_ref().is_some_and(|c| !self.agents.contains(c) && !self.lanes.contains_key(c)) { e.child_lane = None; }
            if let Some(l) = e.child_lane.as_ref().and_then(|c| self.lanes.get_mut(c)) { l.done = true; }
        }
        self.link();
        for (_, v) in log { if let Some(e) = self.log_event(&v) { events.push(e); } }
        for e in &mut events {
            if e.kind == Kind::Spawn { e.child_lane = self.spawned.get(&e.id).cloned(); }
        }
        events.sort_by(|a, b| a.t_ms.cmp(&b.t_ms).then_with(|| a.id.cmp(&b.id)));
        for e in &events {
            if let Some(l) = self.lanes.get_mut(&e.lane) {
                let wrote = match e.kind {
                    Kind::Command => true,
                    Kind::Change => !e.guess,
                    Kind::Tool => matches!(e.tool.as_deref(), Some("Edit" | "MultiEdit" | "Write" | "NotebookEdit"))
                        && e.paths.first().is_some_and(|p| !p.starts_with('/') && !p.starts_with('~')),
                    _ => false,
                };
                if wrote && !l.works { l.works = true; if l.why == READS { l.why = WORKS.into(); } }
                l.events += 1;
                l.first_ms = Some(l.first_ms.map_or(e.t_ms, |f| f.min(e.t_ms)));
                l.last_ms = Some(l.last_ms.map_or(e.t_ms, |f| f.max(e.t_ms)));
            }
        }
        if let Some(f) = &mut self.finder { f.save(); }
        self.first = false;
        Update { lanes: self.lanes(), events }
    }

    /// New lines of the project's log (on the first poll, the rotated one too), with their time.
    fn read_log(&mut self) -> Vec<(i64, Value)> {
        let mut out = vec![];
        let path = super::log_path(&self.project);
        let mut read = |p: &Path, from: u64| -> u64 {
            let Ok(mut f) = fs::File::open(p) else { return from };
            let size = f.metadata().map(|m| m.len()).unwrap_or(0);
            let from = if size < from { 0 } else { from }; // rotated
            if f.seek(SeekFrom::Start(from)).is_err() { return from; }
            let mut pos = from;
            let mut r = BufReader::new(f);
            let mut line = String::new();
            loop {
                line.clear();
                let Ok(n) = r.read_line(&mut line) else { break };
                if n == 0 || !line.ends_with('\n') { break; }
                pos += n as u64;
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    let t = v["ms"].as_i64().unwrap_or(0);
                    if t >= self.opts.since_ms { out.push((t, v)); }
                }
            }
            pos
        };
        if self.first { read(&path.with_file_name("activity.1.jsonl"), 0); }
        self.log_offset = read(&path, self.log_offset);
        out
    }

    /// Find the transcripts that belong to the project and start reading the new ones.
    fn discover(&mut self) {
        let Some(root) = self.opts.claude_root.clone() else { return };
        let since = self.opts.since_ms;
        let all = transcripts::list(&root, since);
        for t in &all {
            if let Some(tu) = &t.meta.tool_use_id { self.spawned.insert(tu.clone(), t.lane_id()); }
            if t.agent.is_some() { self.agents.insert(t.lane_id()); }
        }
        let reading: HashSet<PathBuf> = self.readers.iter().map(|r| r.transcript.path.clone()).collect();
        let mut add: Vec<(Transcript, u64, String)> = vec![];
        let finder = self.finder.as_mut().unwrap();
        // a lane shown only as a parent becomes a full lane once it works in the project itself
        for r in &self.readers {
            let id = r.transcript.lane_id();
            if !self.lanes.get(&id).is_some_and(|l| l.parent_only) { continue; }
            if finder.started_in(&r.transcript) || finder.touches(&r.transcript, r.start) {
                if let Some(l) = self.lanes.get_mut(&id) { l.parent_only = false; if !l.works { l.why = READS.into(); } }
            }
        }
        for t in &all {
            if reading.contains(&t.path) { continue; }
            let from = *self.seen.entry(t.path.clone()).or_insert_with(|| if since > 0 { transcripts::offset_at(&t.path, since) } else { 0 });
            let why = if finder.started_in(t) {
                Some(STARTED.to_string())
            } else if finder.touches(t, from) {
                Some(READS.to_string())
            } else { None };
            if let Some(why) = why { add.push((t.clone(), from, why)); }
        }
        // a session whose flex commands named the project (its id is all a command carries: which of its agents ran
        // them is matched later) is shown, at least as its agents' parent
        for t in all.iter().filter(|t| t.agent.is_none() && self.sessions.contains(&t.session)) {
            if reading.contains(&t.path) || add.iter().any(|(a, ..)| a.path == t.path) { continue; }
            let from = self.seen.get(&t.path).copied().unwrap_or(0);
            add.push((t.clone(), from, "PARENT:its agents ran flex commands on the project".into()));
        }
        // a subagent's session is shown too, as its parent
        let mains: Vec<(Transcript, u64)> = add.iter().filter(|(t, ..)| t.agent.is_some())
            .filter_map(|(t, ..)| all.iter().find(|m| m.agent.is_none() && m.session == t.session))
            .filter(|m| !reading.contains(&m.path) && !add.iter().any(|(a, ..)| a.path == m.path))
            .map(|m| (m.clone(), self.seen.get(&m.path).copied().unwrap_or(0))).collect();
        for (m, from) in mains {
            if !add.iter().any(|(a, ..)| a.path == m.path) { add.push((m, from, "PARENT:spawned agents working in the project".into())); }
        }
        let aliases = self.finder.as_ref().unwrap().aliases().to_vec();
        for (t, from, why) in add {
            let mut lane = transcripts::lane_of(&t, None);
            lane.works = why == STARTED;
            match why.strip_prefix("PARENT:") { Some(w) => { lane.why = w.into(); lane.parent_only = true; } None => lane.why = why }
            self.lanes.insert(lane.id.clone(), lane);
            self.seen.remove(&t.path);
            self.readers.push(Reader::new(t, from, &aliases));
        }
    }

    /// Each subagent's parent: the lane whose tool call spawned it, else (the call is before the window) its session.
    fn link(&mut self) {
        let ids: Vec<String> = self.lanes.keys().cloned().collect();
        for id in ids {
            let l = &self.lanes[&id];
            if l.kind != LaneKind::Subagent || l.parent.is_some() { continue; }
            let parent = l.spawned_by.as_ref().and_then(|tu| self.calls_lane.get(tu)).cloned()
                .or_else(|| l.session.as_ref().map(|s| format!("s:{s}")).filter(|p| self.lanes.contains_key(p)));
            if let (Some(p), Some(l)) = (parent, self.lanes.get_mut(&id)) {
                if l.depth <= 1 || p.starts_with("a:") || self.first { l.parent = Some(p); }
            }
        }
    }

    fn log_event(&mut self, v: &Value) -> Option<Event> {
        let t = v["ms"].as_i64()?;
        let id = v["id"].as_str()?.to_string();
        match v["kind"].as_str()? {
            "command" => Some(self.command_event(t, id, v)),
            "change" => Some(self.change_event(t, id, v)),
            _ => None,
        }
    }

    fn command_event(&mut self, t: i64, id: String, v: &Value) -> Event {
        let argv: Vec<String> = v["argv"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let words = Words::of(&argv);
        let cmd = v["cmd"].as_str().unwrap_or("").to_string();
        let mut e = Event { id: format!("c:{id}"), t_ms: t, lane: "flex".into(), kind: Kind::Command, ..Event::default() };
        e.title = std::iter::once("flex".to_string()).chain(argv.iter().skip(1).map(|a| shell_word(a, &self.project))).collect::<Vec<_>>().join(" ");
        e.ok = v["ok"].as_bool();
        e.dur_ms = v["dur_ms"].as_u64();
        e.detail = v["error"].as_str().map(String::from);
        e.paths = v["changed"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        e.made = v["made"].as_array().map(|a| a.iter().map(|m| {
            let path = m["path"].as_str().unwrap_or("").to_string();
            let abs = if Path::new(&path).is_absolute() { path.clone() } else { self.project.join(&path).to_string_lossy().into_owned() };
            Made { path, abs, kind: m["kind"].as_str().unwrap_or("file").into(), bytes: m["bytes"].as_u64().unwrap_or(0), place: m["where"].as_str().unwrap_or("").into() }
        }).collect()).unwrap_or_default();
        // the film time it was about
        let at = match cmd.as_str() {
            "frame" => words.positionals.get(2).map(String::as_str),
            "watch" | "grid" => words.flag(&["--at"]),
            "mix" => words.flag(&["--from"]),
            _ => None,
        };
        if let Some(at) = at {
            if let Some(s) = at.strip_suffix('s').and_then(|s| s.parse::<f64>().ok()) { e.seek_s = Some(s); }
            else if cmd == "frame" { e.seek_frame = at.parse().ok(); }
        }
        if let Some(session) = v["agent"]["session"].as_str() {
            let lanes_of_session: HashSet<&str> = self.lanes.values().filter(|l| l.session.as_deref() == Some(session)).map(|l| l.id.as_str()).collect();
            let call = self.calls.iter().rev().find(|c| {
                lanes_of_session.contains(c.lane.as_str()) && c.t <= t + 2000 && c.t >= t - 6 * 3_600_000
                    && c.end.is_none_or(|end| end + 2000 >= t)
                    && mentions_command(&c.text, &cmd)
            });
            match call {
                Some(c) => { e.lane = c.lane.clone(); e.ref_id = Some(c.id.clone()); }
                None => {
                    let lane = format!("s:{session}");
                    self.lanes.entry(lane.clone()).or_insert_with(|| Lane {
                        id: lane.clone(), kind: LaneKind::Main, label: format!("Claude Code · {}", &session[..session.len().min(8)]),
                        session: Some(session.to_string()), why: "ran flex commands on the project (its transcript isn't readable)".into(), ..Lane::default()
                    });
                    e.lane = lane;
                }
            }
        }
        self.cmd_lane.insert(id, e.lane.clone());
        e
    }

    fn change_event(&mut self, t: i64, id: String, v: &Value) -> Event {
        let path = v["path"].as_str().unwrap_or("").to_string();
        let op = v["op"].as_str().unwrap_or("modified");
        let mut e = Event { id: format!("f:{id}"), t_ms: t, lane: "flex".into(), kind: Kind::Change, ..Event::default() };
        let (plus, minus) = (v["plus"].as_u64(), v["minus"].as_u64());
        e.title = match (plus, minus) {
            (Some(p), Some(m)) => format!("{op} {path} (+{p} −{m})"),
            _ => format!("{op} {path}"),
        };
        e.diff = v["diff"].as_str().map(String::from);
        e.paths = vec![path.clone()];
        if let Some(lane) = v["by"].as_str().and_then(|c| self.cmd_lane.get(c)) {
            e.lane = lane.clone();
            e.ref_id = v["by"].as_str().map(|c| format!("c:{c}"));
            return e;
        }
        // an agent's own edit of that file, around that time
        if let Some(c) = self.calls.iter().rev().find(|c| c.edit && c.paths.iter().any(|p| *p == path) && c.t <= t + 2000 && c.end.unwrap_or(c.t + 60_000) + 2000 >= t) {
            e.lane = c.lane.clone();
            e.ref_id = Some(c.id.clone());
            return e;
        }
        // else a Bash call running then
        // (a call with no answer yet is still running: for up to 10 minutes)
        if let Some(c) = self.calls.iter().rev().find(|c| !c.text.is_empty() && c.t <= t + 500 && c.end.map_or(t - c.t < 600_000, |end| end + 1000 >= t)) {
            e.lane = c.lane.clone();
            e.ref_id = Some(c.id.clone());
            e.guess = true;
        }
        e
    }
}

/// A Bash command line that runs this `flex` subcommand.
fn mentions_command(text: &str, cmd: &str) -> bool {
    let words: Vec<&str> = text.split(|c: char| c.is_whitespace() || "'\";|&()".contains(c)).filter(|w| !w.is_empty()).collect();
    words.windows(2).any(|w| (w[0] == "flex" || w[0].ends_with("/flex")) && w[1] == cmd)
        || words.windows(3).any(|w| (w[0] == "flex" || w[0].ends_with("/flex")) && w[1].starts_with("--") && w[2] == cmd)
        || (words.iter().any(|w| *w == "flex" || w.ends_with("/flex")) && words.contains(&cmd))
}

/// An argument as it reads best: the project's own path shortened to its name.
fn shell_word(a: &str, project: &Path) -> String {
    let p = project.to_string_lossy();
    let a = if a == p { project.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() } else { a.to_string() };
    if a.is_empty() || a.contains(|c: char| c.is_whitespace() || "'\"$&;|<>(){}".contains(c)) { format!("'{}'", a.replace('\'', "'\\''")) } else { a }
}

/// For a one-shot read: a command an agent's Bash call ran replaces the call, a change an agent's edit made gives the
/// call its real diff, a result is folded into its call. (Streaming readers do this as events arrive.)
pub fn fold(events: Vec<Event>) -> Vec<Event> {
    let commands: HashSet<String> = events.iter().filter(|e| e.kind == Kind::Command).filter_map(|e| e.ref_id.clone()).collect();
    let mut by_id: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Event> = vec![];
    for e in events {
        match e.kind {
            Kind::Tool if commands.contains(&e.id) => continue,
            Kind::Result => {
                let Some(r) = &e.ref_id else { continue };
                if commands.contains(r) { continue; }
                match by_id.get(r) {
                    Some(&i) => { out[i].ok = e.ok; out[i].dur_ms = e.dur_ms; if e.detail.is_some() && e.ok == Some(false) { out[i].detail = e.detail; } }
                    None => out.push(e),
                }
                continue;
            }
            Kind::Change => {
                if let Some(&i) = e.ref_id.as_ref().and_then(|r| by_id.get(r)) {
                    if matches!(out[i].tool.as_deref(), Some("Edit" | "MultiEdit" | "Write")) {
                        out[i].diff = e.diff.clone();
                        continue;
                    }
                }
            }
            _ => {}
        }
        by_id.insert(e.id.clone(), out.len());
        out.push(e);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_flex_command_lines() {
        assert!(mentions_command("cd ~/x && flex frame overview 12s -o /tmp/a.png", "frame"));
        assert!(mentions_command("target/debug/flex --variant END=dark render .", "render"));
        assert!(mentions_command("~/.flex/bin/flex music . --lyrics 2>&1 | tail", "music"));
        assert!(!mentions_command("ls frames", "frame"));
    }
}
