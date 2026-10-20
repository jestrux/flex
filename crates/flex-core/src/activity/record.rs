//! Recording one `flex` command (the CLI's contract): `Recorder::begin(argv)` first thing in `main`, `end(outcome)` when
//! it finishes. `begin` only notes the time; `end` does the work (finding the project, what the command made, syncing the
//! shadow, one appended line), in a few ms. It never fails and never panics into the command: everything is swallowed.
//! `FLEX_ACTIVITY=off` turns it off.

use super::shadow::{self, Entry};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

/// One `flex` command being recorded.
pub struct Recorder {
    argv: Vec<String>,
    started: SystemTime,
    clock: Instant,
}

/// Commands not recorded: reading the trail itself (an agent or the author may run it every few seconds).
const UNRECORDED: &[&str] = &["activity", "help"];

/// Flags that take no value (every other `--flag` takes the next word, unless written `--flag=value`).
const SWITCHES: &[&str] = &[
    "--json", "--fast", "--lyrics", "--sheet", "--off", "--on", "--lock", "--unlock", "--dry", "--no-warm", "--yes",
    "--force", "--full", "--follow", "--help", "-h", "--version", "-V",
];

impl Recorder {
    /// A `flex` command starts: `argv` is the whole command line (argv[0] is the binary).
    pub fn begin(argv: &[String]) -> Recorder { Recorder { argv: argv.to_vec(), started: SystemTime::now(), clock: Instant::now() } }

    /// It finished: `Ok(code)` with its exit code (0 = success), or `Err(message)` when it failed with an error.
    pub fn end(self, outcome: Result<i32, String>) {
        if std::env::var("FLEX_ACTIVITY").is_ok_and(|v| v == "off" || v == "0") { return; }
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| self.write(outcome)));
    }

    fn write(self, outcome: Result<i32, String>) {
        let words = Words::of(&self.argv);
        let Some(cmd) = words.positionals.first().cloned() else { return };
        if UNRECORDED.contains(&cmd.as_str()) || self.argv.iter().any(|a| a == "--help" || a == "-h") { return; }
        let dur_ms = self.clock.elapsed().as_millis() as u64;
        let start_ms = super::ms_of(self.started);
        let cwd = std::env::current_dir().ok();
        let project = find_project(&words, cwd.as_deref());
        let id = format!("{start_ms}-{}", std::process::id());

        let walked = project.as_deref().map(shadow::walk);
        let synced = match (&project, &walked) {
            (Some(p), Some(w)) => shadow::sync(p, Some((&id, start_ms)), Some(w)),
            _ => shadow::Synced::default(),
        };
        let mut made = vec![];
        if let (Some(p), Some(w)) = (&project, &walked) {
            let edited: std::collections::HashSet<&str> = synced.changed.iter().map(|s| s.as_str()).collect();
            made_in_project(p, w, start_ms, &edited, &mut made);
            made_in_folder(&crate::tools::out_dir(p), start_ms, 2, "out", &mut made);
        }
        made_explicit(&words, &self.argv, cwd.as_deref(), project.as_deref(), start_ms, &mut made);
        if let Some(c) = &cwd {
            if project.as_deref().is_none_or(|p| !c.starts_with(p)) { made_in_folder(c, start_ms, 0, "cwd", &mut made); }
        }
        let more = made.len().saturating_sub(MADE_MAX);
        made.truncate(MADE_MAX);

        let (ok, code, error) = match outcome { Ok(c) => (c == 0, c, None), Err(e) => (false, 1, Some(super::clip(&e, 2000))) };
        let mut argv = redact(&self.argv);
        if let Some(a0) = argv.first_mut() { *a0 = Path::new(a0.as_str()).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(); }
        let line = json!({
            "v": super::SCHEMA, "kind": "command", "id": id, "t": super::iso(start_ms), "ms": start_ms, "dur_ms": dur_ms,
            "cmd": cmd, "argv": argv, "cwd": cwd, "project": project,
            "ok": ok, "code": code, "error": error,
            "made": made, "more": more, "changed": synced.changed,
            "agent": agent(), "ppid": std::os::unix::process::parent_id(),
            "tty": std::io::IsTerminal::is_terminal(&std::io::stdin()),
        });
        let log = project.as_deref().map(super::log_path).unwrap_or_else(super::global_log_path);
        append(&log, &[line.to_string()]);
    }
}

const MADE_MAX: usize = 40;

/// The command line split into positionals (the subcommand first) and flags with their values.
pub(crate) struct Words { pub positionals: Vec<String>, pub flags: Vec<(String, Option<String>)> }

impl Words {
    pub(crate) fn of(argv: &[String]) -> Words {
        let (mut positionals, mut flags) = (vec![], vec![]);
        let mut it = argv.iter().skip(1).peekable();
        let mut rest = false;
        while let Some(a) = it.next() {
            if rest || !a.starts_with('-') || a == "-" || a.parse::<f64>().is_ok() { positionals.push(a.clone()); continue; }
            if a == "--" { rest = true; continue; }
            if let Some((k, v)) = a.split_once('=') { flags.push((k.to_string(), Some(v.to_string()))); continue; }
            if SWITCHES.contains(&a.as_str()) { flags.push((a.clone(), None)); continue; }
            flags.push((a.clone(), it.next().cloned()));
        }
        Words { positionals, flags }
    }
    pub(crate) fn flag(&self, names: &[&str]) -> Option<&str> {
        self.flags.iter().find(|(k, _)| names.contains(&k.as_str())).and_then(|(_, v)| v.as_deref())
    }
}

/// The project a command is about: the first word that is a path inside a folder holding `project.ts` (the folder
/// itself, a file in it, or a file deeper down, like a stem given to `flex transcribe`). Canonical, so a symlinked
/// sample and its target log to one place.
pub(crate) fn find_project(words: &Words, cwd: Option<&Path>) -> Option<PathBuf> {
    let home = dirs::home_dir();
    let candidates = words.positionals.iter().skip(1).chain(words.flags.iter().filter_map(|(_, v)| v.as_ref()));
    for w in candidates {
        let p = Path::new(w);
        let p = if p.is_absolute() { p.to_path_buf() } else { cwd?.join(p) };
        let Ok(md) = fs::metadata(&p) else { continue };
        let mut dir = if md.is_dir() { Some(p.as_path()) } else { p.parent() };
        for _ in 0..6 {
            let Some(d) = dir else { break };
            if home.as_deref() == Some(d) || d.parent().is_none() { break; }
            if d.join("project.ts").is_file() { return fs::canonicalize(d).ok(); }
            dir = d.parent();
        }
    }
    None
}

fn kind_of(path: &str, folder: bool, take_version: bool, place: &str) -> &'static str {
    if take_version { return "take-version"; }
    if folder { return "folder"; }
    let ext = path.rsplit_once('.').map(|(_, x)| x.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "heic" => "still",
        "mp4" | "mov" | "webm" | "gif" | "m4v" => if place == "out" { "render" } else { "video" },
        "wav" | "mp3" | "m4a" | "aac" | "flac" | "aiff" => "audio",
        "pdf" => "pdf",
        "json" => "data",
        "srt" | "vtt" => "subtitles",
        _ => "file",
    }
}

fn push(made: &mut Vec<Value>, path: String, bytes: u64, place: &str, folder: bool, take_version: bool) {
    if made.iter().any(|m| m["path"] == path.as_str()) { return; }
    let kind = kind_of(&path, folder, take_version, place);
    made.push(json!({ "path": path, "kind": kind, "bytes": bytes, "where": place }));
}

/// Files in the project modified during the run (edits to followed text files are `changed`, with diffs, instead).
fn made_in_project(project: &Path, walked: &[Entry], start_ms: i64, edited: &std::collections::HashSet<&str>, made: &mut Vec<Value>) {
    let _ = project;
    let mut new: Vec<&Entry> = walked.iter().filter(|e| e.mtime_ms >= start_ms && !edited.contains(e.rel.as_str())).collect();
    // what was made reads best newest-last, and a big folder of stills shouldn't hide the take version
    new.sort_by_key(|e| (!e.take_version, e.mtime_ms));
    for e in new { push(made, e.rel.clone(), e.size, "project", false, e.take_version); }
}

/// Files in a folder (outside the project) modified during the run, `depth` levels down.
fn made_in_folder(dir: &Path, start_ms: i64, depth: usize, place: &str, made: &mut Vec<Value>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten().take(2000) {
        let name = e.file_name();
        if name.to_string_lossy().starts_with('.') { continue; }
        let Ok(md) = e.metadata() else { continue };
        let fresh = md.modified().map(super::ms_of).is_ok_and(|m| m >= start_ms);
        if md.is_dir() {
            if depth > 0 { made_in_folder(&e.path(), start_ms, depth - 1, place, made); }
        } else if fresh {
            push(made, e.path().to_string_lossy().into_owned(), md.len(), place, false, false);
        }
    }
}

/// The paths a command was told to write (`-o`, `--out`, `--to-dir`), wherever they are.
fn made_explicit(words: &Words, argv: &[String], cwd: Option<&Path>, project: Option<&Path>, start_ms: i64, made: &mut Vec<Value>) {
    let _ = argv;
    for (k, v) in &words.flags {
        if !matches!(k.as_str(), "-o" | "--out" | "--to-dir" | "--keep") { continue; }
        let Some(v) = v else { continue };
        let p = Path::new(v);
        let p = if p.is_absolute() { p.to_path_buf() } else { match cwd { Some(c) => c.join(p), None => continue } };
        let Ok(md) = fs::metadata(&p) else { continue };
        if !md.modified().map(super::ms_of).is_ok_and(|m| m >= start_ms) { continue; }
        let p = fs::canonicalize(&p).unwrap_or(p);
        let (path, place) = match project.filter(|pr| p.starts_with(pr)) {
            Some(pr) => (super::rel(&p, pr), "project"),
            None => (p.to_string_lossy().into_owned(), "cwd"),
        };
        push(made, path, md.len(), place, md.is_dir(), false);
    }
}

/// Who ran it, when an agent did: Claude Code sets these in its Bash tool's environment. `CLAUDE_CODE_SESSION_ID` is
/// the session (a subagent's commands carry its parent session's id: the trail finds which agent by matching the
/// command against the session's Bash calls).
fn agent() -> Option<Value> {
    let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    let session = var("CLAUDE_CODE_SESSION_ID");
    let ai = var("AI_AGENT");
    let claude = session.is_some() || var("CLAUDECODE").is_some();
    if !claude && ai.is_none() { return None; }
    let tool = if claude { "claude-code".to_string() } else { ai.as_deref().unwrap_or("").split('_').next().unwrap_or("agent").to_string() };
    Some(json!({
        "tool": tool, "session": session, "pid": var("CLAUDE_PID").and_then(|p| p.parse::<u32>().ok()),
        "ai_agent": ai, "entrypoint": var("CLAUDE_CODE_ENTRYPOINT"),
    }))
}

/// Keys and tokens never reach the log (`flex key set` reads its key from stdin, but an agent may pass one anywhere).
fn redact(argv: &[String]) -> Vec<String> {
    let secretish = |s: &str| { let l = s.to_ascii_lowercase(); ["key", "token", "secret", "password", "cookie"].iter().any(|w| l.contains(w)) };
    let mut out = Vec::with_capacity(argv.len());
    let mut hide_next = false;
    for a in argv {
        let hide = std::mem::take(&mut hide_next);
        if a.starts_with("--") && secretish(a) {
            match a.split_once('=') { Some((k, _)) => out.push(format!("{k}=<redacted>")), None => { out.push(a.clone()); hide_next = true; } }
            continue;
        }
        let looks = a.starts_with("sk-") || a.contains("Bearer ") || (a.len() > 40 && !a.contains('/') && !a.contains(' ') && a.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)));
        out.push(if hide || looks { "<redacted>".into() } else { a.clone() });
    }
    out
}

/// Append lines to a log in one write (atomic enough for concurrent commands on a local disk), rotating it past
/// `LOG_MAX`. Errors are swallowed: the trail must never break a command.
pub(crate) fn append(log: &Path, lines: &[String]) {
    if let Some(dir) = log.parent() { let _ = fs::create_dir_all(dir); }
    if fs::metadata(log).is_ok_and(|m| m.len() > super::LOG_MAX) {
        let _ = fs::rename(log, log.with_file_name("activity.1.jsonl"));
    }
    let mut buf = String::new();
    for l in lines { buf.push_str(l); buf.push('\n'); }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log) { let _ = f.write_all(buf.as_bytes()); }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> { v.iter().map(|x| x.to_string()).collect() }

    #[test]
    fn words_split_flags_and_positionals() {
        let w = Words::of(&s(&["flex", "--variant", "END=dark", "frame", "dir", "12.5s", "-o", "x.png", "--json", "--width=960"]));
        assert_eq!(w.positionals, s(&["frame", "dir", "12.5s"]));
        assert_eq!(w.flag(&["-o", "--out"]), Some("x.png"));
        assert_eq!(w.flag(&["--width"]), Some("960"));
        assert_eq!(w.flag(&["--variant"]), Some("END=dark"));
        let w = Words::of(&s(&["flex", "shift", "d", "--at", "43.1", "--by", "-2"]));
        assert_eq!(w.flag(&["--by"]), Some("-2"));
    }

    #[test]
    fn redacts_secrets() {
        let r = redact(&s(&["flex", "x", "--api-key", "abc", "--token=zzz", "sk-proj-123", "scenes/01.ts"]));
        assert_eq!(r, s(&["flex", "x", "--api-key", "<redacted>", "--token=<redacted>", "<redacted>", "scenes/01.ts"]));
    }

    #[test]
    fn finds_the_project_from_any_path_in_it() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("film");
        fs::create_dir_all(p.join("audio/stems")).unwrap();
        fs::write(p.join("project.ts"), "").unwrap();
        fs::write(p.join("audio/stems/vocals.wav"), "").unwrap();
        let canon = fs::canonicalize(&p).unwrap();
        for argv in [["flex", "frame", "film", "1s"], ["flex", "transcribe", "film/audio/stems/vocals.wav", "--json"]] {
            assert_eq!(find_project(&Words::of(&s(&argv)), Some(t.path())), Some(canon.clone()));
        }
        assert_eq!(find_project(&Words::of(&s(&["flex", "doctor"])), Some(t.path())), None);
    }
}
