//! The activity trail (PLAN.md "After the MVP: agents", item 5): what happened in a project, on one clock, from three
//! sources. Flex records; it doesn't restrict.
//!
//! 1. **Every `flex` command** ([`Recorder`]): `begin` when a command starts, `end` when it finishes, one line in
//!    `<project>/.flex/activity.jsonl` (commands that name no project go to `<support>/activity.jsonl`).
//! 2. **Every change to the project's text files** ([`shadow`]): a bounded shadow copy under `.flex/shadow/`, diffed
//!    after each recorded command (and by the app while it is open), each change one line in the same log, with its
//!    diff. Agents mostly work with the app closed, so the commands they run are what notices.
//! 3. **The agents' own accounts** ([`transcripts`]): Claude Code session transcripts, read in place and read-only (they
//!    can hold secrets, and projects get committed: nothing from them is ever written into the project). A subagent has
//!    its own transcript, so it gets its own lane.
//!
//! [`Trail`] merges the three into lanes (Flex's own, each session's main agent, each subagent under its parent) and
//! events in time order, incrementally (byte offsets), for `flex activity` and the app's Activity panel.
//!
//! ## The log's schema (`SCHEMA` = 1): one JSON object per line
//!
//! ```text
//! {"v":1,"kind":"command","id":"<ms>-<pid>","t":"2026-10-17T05:20:00.123Z","ms":<epoch ms>,"dur_ms":812,
//!  "cmd":"frame","argv":["flex","frame",".","12.5s","-o","x.png"],"cwd":"/abs","project":"/abs/project",
//!  "ok":true,"code":0,"error":null,
//!  "made":[{"path":"x.png","kind":"still","bytes":123456,"where":"cwd"}],"more":0,
//!  "changed":["scenes/01-opening.ts"],
//!  "agent":{"tool":"claude-code","session":"<uuid>","pid":68637,"ai_agent":"claude-code_2-1-287_agent"},
//!  "ppid":81095,"tty":false}
//! {"v":1,"kind":"change","id":"<ms>-<pid>-<n>","t":"…","ms":<the file's mtime>,"path":"scenes/01-opening.ts",
//!  "op":"modified","plus":3,"minus":1,"diff":"@@ -4,3 +4,5 @@\n…","truncated":false,"by":"<command id>"|null}
//! ```
//!
//! `made` paths are project-relative inside the project, else absolute; `where` is `project`, `out` (the film's output
//! folder, `tools::out_dir`) or `cwd`. A take version (`takes/.versions/<take>/v<n>`) is one entry, never its frames.
//! `by` on a change is the command during whose run it happened; a change between commands is attributed when the
//! trail is read (an agent's Edit/Write of that file, else a Bash call running at that moment, else no one).

mod diff;
pub mod record;
pub mod shadow;
pub mod trail;
pub mod transcripts;

pub use record::Recorder;
pub use trail::{Event, Kind, Lane, LaneKind, Made, Options, Trail};

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The log's schema version (the `v` of every line).
pub const SCHEMA: u32 = 1;

/// `<project>/.flex`: Flex's own folder in a project (the app's watcher ignores it).
pub fn flex_dir(project: &Path) -> PathBuf { project.join(".flex") }

/// The project's activity log.
pub fn log_path(project: &Path) -> PathBuf { flex_dir(project).join("activity.jsonl") }

/// The log for commands that name no project (`flex doctor`, `flex read`, …).
pub fn global_log_path() -> PathBuf { crate::project::support_dir().join("activity.jsonl") }

/// A log is rotated once past this (the old one kept as `activity.1.jsonl`, which the trail also reads).
pub(crate) const LOG_MAX: u64 = 16 << 20;

pub(crate) fn now_ms() -> i64 { ms_of(SystemTime::now()) }

pub(crate) fn ms_of(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) { Ok(d) => d.as_millis() as i64, Err(e) => -(e.duration().as_millis() as i64) }
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm), so the log needs no date crate.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Epoch ms → `2026-10-17T05:20:00.123Z`.
pub fn iso(ms: i64) -> String {
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000)
}

/// An RFC 3339 time (`2026-10-17T05:20:00.123Z`, `…+02:00`, or a bare date, taken as UTC) → epoch ms.
pub fn parse_iso(s: &str) -> Option<i64> {
    let s = s.trim();
    if !s.is_ascii() { return None; }
    let num = |a: usize, b: usize| s.get(a..b).and_then(|x| x.parse::<i64>().ok());
    if s.get(4..5) != Some("-") || s.get(7..8) != Some("-") { return None; }
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let day = days_from_civil(y, mo, d) * 86_400_000;
    if s.len() == 10 { return Some(day); }
    let (h, mi, sec) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let mut ms = day + h * 3_600_000 + mi * 60_000 + sec * 1000;
    let mut rest = &s[19..];
    if let Some(frac) = rest.strip_prefix('.') {
        let n = frac.bytes().take_while(|c| c.is_ascii_digit()).count();
        let first3: String = frac[..n].chars().chain("000".chars()).take(3).collect();
        ms += first3.parse::<i64>().ok()?;
        rest = &frac[n..];
    }
    match rest {
        "" | "Z" | "z" => {}
        tz => {
            let sign = match tz.as_bytes()[0] { b'+' => 1, b'-' => -1, _ => return None };
            let hh = tz.get(1..3)?.parse::<i64>().ok()?;
            let mm = tz.get(tz.len() - 2..)?.parse::<i64>().ok()?;
            ms -= sign * (hh * 3_600_000 + mm * 60_000);
        }
    }
    Some(ms)
}

/// `--since`: an RFC 3339 time, epoch ms, `all`, or an age before `now` (`90s`, `30m`, `6h`, `2d`).
pub fn parse_since(s: &str, now: i64) -> Option<i64> {
    let s = s.trim();
    if s == "all" { return Some(0); }
    if let Some(t) = parse_iso(s) { return Some(t); }
    if s.len() >= 12 && s.chars().all(|c| c.is_ascii_digit()) { return s.parse().ok(); }
    let (n, unit) = s.split_at(s.find(|c: char| !c.is_ascii_digit() && c != '.')?);
    let n: f64 = n.parse().ok()?;
    let k = match unit { "s" => 1e3, "m" | "min" => 60e3, "h" => 3600e3, "d" => 86400e3, _ => return None };
    Some(now - (n * k) as i64)
}

/// `p` relative to `base` when inside it, else as is.
pub(crate) fn rel(p: &Path, base: &Path) -> String {
    p.strip_prefix(base).map(|r| r.to_string_lossy().into_owned()).unwrap_or_else(|_| p.to_string_lossy().into_owned())
}

/// The first `n` characters of `s` on one line, with an ellipsis when cut.
pub(crate) fn clip(s: &str, n: usize) -> String {
    let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= n { one } else { format!("{}…", one.chars().take(n).collect::<String>()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_round_trips() {
        for ms in [0i64, 1_792_000_000_123, 951_782_400_000 /* 2000-02-29 */, 1_234] {
            assert_eq!(parse_iso(&iso(ms)), Some(ms), "{}", iso(ms));
        }
        assert_eq!(iso(1_792_214_062_739), "2026-10-17T05:14:22.739Z");
        assert_eq!(parse_iso("2026-10-17T07:14:22.739+02:00"), parse_iso("2026-10-17T05:14:22.739Z"));
        assert_eq!(parse_iso("2026-10-17T05:14:22Z"), Some(1_792_214_062_000));
    }

    #[test]
    fn since_forms() {
        let now = 1_000_000_000_000;
        assert_eq!(parse_since("30m", now), Some(now - 1_800_000));
        assert_eq!(parse_since("2h", now), Some(now - 7_200_000));
        assert_eq!(parse_since("1.5d", now), Some(now - 129_600_000));
        assert_eq!(parse_since("2026-10-17T05:14:22Z", now), Some(1_792_214_062_000));
        assert!(parse_since("soon", now).is_none());
    }

    #[test]
    fn clips_to_one_line() {
        assert_eq!(clip("a\n  b c", 10), "a b c");
        assert_eq!(clip("abcdef", 3), "abc…");
    }
}
