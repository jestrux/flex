//! Every change to a project's text files, with its diff, whether or not the app is open. A shadow copy of the
//! project's text files lives in `<project>/.flex/shadow/` (`index.json`: path → mtime and size; `files/<path>`: the
//! last content seen). [`sync`] compares the project with it (stat only, unless a file's mtime or size moved), writes
//! one `change` line per added, modified or deleted file into the activity log, and updates the shadow. Each recorded
//! `flex` command syncs when it ends; the app syncs while it is open.
//!
//! Bounded: only text files (by extension, no NUL bytes) up to `FILE_MAX`, at most `COUNT_MAX` files and `TOTAL_MAX`
//! bytes in all, and never the big or generated folders (node_modules, takes but each take's `edl.json`, the
//! storyboard's generated walk (its sketches are followed), audio analyses, build output). The first sync of a project only takes the baseline: no changes.

use super::diff;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const FILE_MAX: u64 = 256 << 10;
const TOTAL_MAX: u64 = 16 << 20;
const COUNT_MAX: usize = 3000;
/// a change line's diff is cut past this
const DIFF_MAX: usize = 24 << 10;
/// the walk never looks at more than this many entries (a project gone wrong mustn't stall every command)
const WALK_MAX: usize = 20_000;

/// One file (or take version) found by the walk.
#[derive(Debug, Clone)]
pub struct Entry {
    /// project-relative, `/`-separated
    pub rel: String,
    pub path: PathBuf,
    pub mtime_ms: i64,
    pub size: u64,
    /// a `takes/.versions/<take>/v<n>` folder, standing for everything in it
    pub take_version: bool,
}

/// Folders never walked: dependencies, caches, build output, a take's frames, and Flex's own.
fn skipped_dir(name: &str) -> bool {
    matches!(name, "node_modules" | ".git" | ".flex" | ".cache" | "build" | "dist" | "frames" | "__pycache__" | ".venv")
}

/// Every file in the project (stat only), with each take version as one entry.
pub fn walk(project: &Path) -> Vec<Entry> {
    let mut out = vec![];
    walk_into(project, project, 0, &mut out);
    out
}

fn walk_into(root: &Path, dir: &Path, depth: usize, out: &mut Vec<Entry>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if out.len() >= WALK_MAX { return; }
        let name = e.file_name();
        let name = name.to_string_lossy();
        let Ok(ft) = e.file_type() else { continue };
        let path = e.path();
        if ft.is_dir() {
            if skipped_dir(&name) || depth >= 8 { continue; }
            if name == ".versions" && depth == 1 && dir.file_name().is_some_and(|n| n == "takes") {
                versions(root, &path, out);
                continue;
            }
            walk_into(root, &path, depth + 1, out);
        } else if ft.is_file() {
            if name == ".DS_Store" { continue; }
            let Ok(md) = e.metadata() else { continue };
            out.push(Entry { rel: super::rel(&path, root), path, mtime_ms: md.modified().map(super::ms_of).unwrap_or(0), size: md.len(), take_version: false });
        }
    }
}

/// `takes/.versions/<take>/v<n>`: one entry per version (its folder's mtime), never its frames.
fn versions(root: &Path, dir: &Path, out: &mut Vec<Entry>) {
    for take in fs::read_dir(dir).into_iter().flatten().flatten() {
        for v in fs::read_dir(take.path()).into_iter().flatten().flatten() {
            if !v.file_type().is_ok_and(|t| t.is_dir()) { continue; }
            let Ok(md) = v.metadata() else { continue };
            let path = v.path();
            out.push(Entry { rel: super::rel(&path, root), path, mtime_ms: md.modified().map(super::ms_of).unwrap_or(0), size: 0, take_version: true });
        }
    }
}

const TEXT_EXT: &[&str] = &[
    "ts", "tsx", "mts", "cts", "js", "mjs", "cjs", "jsx", "json", "md", "txt", "css", "html", "svg", "srt", "vtt", "yaml",
    "yml", "toml", "sh", "py", "csv",
];

/// A file the shadow follows: text, small, and not generated.
pub fn followed(e: &Entry) -> bool {
    if e.take_version || e.size > FILE_MAX { return false; }
    let rel = e.rel.as_str();
    let name = rel.rsplit('/').next().unwrap_or(rel);
    let Some(ext) = name.rsplit_once('.').map(|(_, x)| x.to_ascii_lowercase()) else { return false };
    if !TEXT_EXT.contains(&ext.as_str()) { return false; }
    if name == "package-lock.json" || name.ends_with(".boxes.json") { return false; }
    let mut parts = rel.split('/');
    match parts.next() {
        // a take's camera plan is the one hand-edited file in a take
        Some("takes") => { let rest: Vec<_> = parts.collect(); rest.len() == 2 && rest[1] == "edl.json" }
        // storyboard/: the sketches are drawn by hand (an SVG is text); the walk's screenshots and boxes are generated
        Some("storyboard") => parts.next() == Some("sketches"),
        // audio/: the scripts that make sounds, not the analyses written beside each track
        Some("audio") if rel.contains('/') => matches!(ext.as_str(), "sh" | "ts" | "mjs" | "js" | "py"),
        _ => true,
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    /// path → [mtime ms, size, shadowed (1), only noted (0: over the caps) or not text (2)]
    files: BTreeMap<String, (i64, u64, u8)>,
    bytes: u64,
}

fn shadow_dir(project: &Path) -> PathBuf { super::flex_dir(project).join("shadow") }

/// A lock so two commands ending together don't both write the shadow (the later one skips; the next sync catches up).
struct Lock(PathBuf);
impl Lock {
    fn take(dir: &Path) -> Option<Lock> {
        let p = dir.join("shadow.lock");
        for _ in 0..2 {
            match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
                Ok(_) => return Some(Lock(p)),
                Err(_) => {
                    // a lock left by a killed command
                    let stale = fs::metadata(&p).and_then(|m| m.modified()).ok()
                        .and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > 60);
                    if !stale { return None; }
                    let _ = fs::remove_file(&p);
                }
            }
        }
        None
    }
}
impl Drop for Lock { fn drop(&mut self) { let _ = fs::remove_file(&self.0); } }

fn read_text(p: &Path) -> Option<String> {
    let mut f = fs::File::open(p).ok()?;
    let mut buf = vec![];
    f.by_ref().take(FILE_MAX + 1).read_to_end(&mut buf).ok()?;
    if buf.len() as u64 > FILE_MAX || buf[..buf.len().min(8192)].contains(&0) { return None; }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// The outcome of a sync: the project-relative paths that changed, and the log lines written for them.
#[derive(Debug, Default)]
pub struct Synced { pub changed: Vec<String>, pub lines: usize, pub baseline: bool }

/// Compare the project with its shadow and log each change. `by`: the command running now, and when it started (a
/// change whose mtime is at or after the start is that command's). `entries`: a walk already done, else it walks.
pub fn sync(project: &Path, by: Option<(&str, i64)>, entries: Option<&[Entry]>) -> Synced {
    let flex = super::flex_dir(project);
    if fs::create_dir_all(&flex).is_err() { return Synced::default(); }
    let Some(_lock) = Lock::take(&flex) else { return Synced::default() };
    let dir = shadow_dir(project);
    let index_path = dir.join("index.json");
    let old: Option<Index> = fs::read(&index_path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let baseline = old.is_none();
    let mut idx = old.unwrap_or_default();
    let walked;
    let entries = match entries { Some(e) => e, None => { walked = walk(project); &walked } };
    let now = super::now_ms();
    let pid = std::process::id();
    let mut lines = vec![];
    let mut changed = vec![];
    let mut seen = std::collections::HashSet::new();
    let files = dir.join("files");
    let mut dirty = baseline;

    let log_change = |rel: &str, op: &str, ms: i64, before: &str, after: Option<&str>, lines: &mut Vec<String>| {
        let d = after.map(|a| diff::unified(before, a, DIFF_MAX));
        let by_cmd = by.filter(|(_, start)| ms >= *start).map(|(id, _)| id.to_string());
        lines.push(json!({
            "v": super::SCHEMA, "kind": "change", "id": format!("{now}-{pid}-{}", lines.len()), "t": super::iso(ms), "ms": ms,
            "path": rel, "op": op,
            "plus": d.as_ref().map(|d| d.plus), "minus": d.as_ref().map(|d| d.minus),
            "diff": d.as_ref().map(|d| d.text.clone()), "truncated": d.as_ref().map(|d| d.truncated),
            "by": by_cmd,
        }).to_string());
    };

    for e in entries.iter().filter(|e| followed(e)) {
        seen.insert(e.rel.clone());
        let prev = idx.files.get(&e.rel).copied();
        if prev.is_some_and(|(m, s, _)| m == e.mtime_ms && s == e.size) { continue; }
        dirty = true;
        let copy = files.join(&e.rel);
        // not text after all (a NUL byte): noted (2) so it isn't seen as new at every sync
        let Some(now_text) = read_text(&e.path) else { idx.files.insert(e.rel.clone(), (e.mtime_ms, e.size, 2)); continue };
        let room = idx.files.len() < COUNT_MAX && idx.bytes + e.size <= TOTAL_MAX;
        match prev {
            None => {
                if !baseline {
                    changed.push(e.rel.clone());
                    log_change(&e.rel, "added", e.mtime_ms, "", room.then_some(now_text.as_str()), &mut lines);
                }
            }
            Some((_, old_size, shadowed)) => {
                let before = if shadowed == 1 { fs::read_to_string(&copy).ok() } else { None };
                if before.as_deref() == Some(now_text.as_str()) {
                    idx.files.insert(e.rel.clone(), (e.mtime_ms, e.size, 1));
                    continue; // touched, not changed
                }
                changed.push(e.rel.clone());
                log_change(&e.rel, "modified", e.mtime_ms, before.as_deref().unwrap_or(""), before.as_ref().map(|_| now_text.as_str()), &mut lines);
                if shadowed == 1 { idx.bytes = idx.bytes.saturating_sub(old_size); }
            }
        }
        let shadowed = room || prev.is_some_and(|p| p.2 == 1);
        if shadowed {
            if let Some(parent) = copy.parent() { let _ = fs::create_dir_all(parent); }
            if fs::write(&copy, &now_text).is_ok() { idx.bytes += e.size; } else { idx.files.remove(&e.rel); continue; }
        }
        idx.files.insert(e.rel.clone(), (e.mtime_ms, e.size, shadowed as u8));
    }
    let gone: Vec<String> = idx.files.keys().filter(|k| !seen.contains(*k)).cloned().collect();
    for rel in gone {
        dirty = true;
        let (_, size, shadowed) = idx.files.remove(&rel).unwrap_or_default();
        let copy = files.join(&rel);
        let before = if shadowed == 1 { fs::read_to_string(&copy).ok() } else { None };
        // a file that left the followed set but still exists (grew past the cap) isn't a deletion
        if shadowed != 2 && !project.join(&rel).exists() {
            changed.push(rel.clone());
            log_change(&rel, "deleted", now, before.as_deref().unwrap_or(""), before.as_ref().map(|_| ""), &mut lines);
        }
        if shadowed == 1 { idx.bytes = idx.bytes.saturating_sub(size); let _ = fs::remove_file(copy); }
    }
    if dirty {
        let _ = fs::create_dir_all(&dir);
        if let Ok(b) = serde_json::to_vec(&idx) {
            let tmp = dir.join("index.json.tmp");
            if fs::write(&tmp, b).is_ok() { let _ = fs::rename(tmp, &index_path); }
        }
    }
    let n = lines.len();
    if n > 0 { super::record::append(&super::log_path(project), &lines); }
    Synced { changed, lines: n, baseline }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(rel: &str, size: u64) -> Entry { Entry { rel: rel.into(), path: rel.into(), mtime_ms: 0, size, take_version: false } }

    #[test]
    fn follows_text_not_generated() {
        for yes in ["project.ts", "scenes/01-a.ts", "audio.json", "takes/home/edl.json", "audio/sfx/gen-whoosh.sh", "NOTES.md", "script.json", "storyboard/sketches/01-open.svg"] {
            assert!(followed(&entry(yes, 10)), "{yes}");
        }
        for no in ["takes/home/events.json", "audio/song.grid.json", "storyboard/walk/a.json", "assets/x.png", "package-lock.json", "a.ts.bin"] {
            assert!(!followed(&entry(no, 10)), "{no}");
        }
        assert!(!followed(&entry("big.json", FILE_MAX + 1)));
    }
}
