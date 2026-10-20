//! The activity panel's FFI (flex_core::activity for the app). Lane B owns this file.
//!
//! `ActivityTrail` is one project's trail, polled while the panel shows: each `poll()` first syncs the project's shadow
//! (so file changes appear while the app is open, not only when a command runs), then returns what is new. Events
//! arrive unfolded: a command later replaces the agent's Bash call that ran it (`ref_id`), a result updates its call,
//! a change gives an Edit its diff. The panel applies those as they come.

use crate::FlexError;
use flex_core::activity;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, uniffi::Record)]
pub struct ActivityLane {
    /// `flex`, `s:<session>` or `a:<agent id>`
    pub id: String,
    /// flex, main or subagent
    pub kind: String,
    pub label: String,
    pub parent: Option<String>,
    pub agent_type: Option<String>,
    pub depth: u32,
    pub first_ms: Option<i64>,
    pub last_ms: Option<i64>,
    pub events: u64,
    pub done: bool,
    /// why it is in this project's trail
    pub why: String,
    /// it changed the project (false: it only read it)
    pub works: bool,
    /// only shown as its subagents' parent
    pub parent_only: bool,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ActivityMade {
    pub path: String,
    pub abs: String,
    /// still, render, video, audio, take-version, data, folder, …
    pub kind: String,
    pub bytes: u64,
    /// project, out or cwd
    pub place: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ActivityEvent {
    pub id: String,
    pub t_ms: i64,
    pub lane: String,
    /// command, change, prompt, message, tool, result, spawn, done, checkpoint
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    pub ok: Option<bool>,
    pub dur_ms: Option<u64>,
    pub paths: Vec<String>,
    pub made: Vec<ActivityMade>,
    pub diff: Option<String>,
    pub seek_s: Option<f64>,
    pub seek_frame: Option<u32>,
    pub child_lane: Option<String>,
    pub ref_id: Option<String>,
    pub tool: Option<String>,
    pub guess: bool,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ActivityUpdate {
    /// all lanes as they stand, parents before children, working before read-only
    pub lanes: Vec<ActivityLane>,
    /// new since the last poll, in time order
    pub events: Vec<ActivityEvent>,
}

/// One project's activity trail.
#[derive(uniffi::Object)]
pub struct ActivityTrail { inner: Mutex<activity::Trail>, project: std::path::PathBuf, record: bool }

#[uniffi::export]
impl ActivityTrail {
    /// The trail since `since_ms` (epoch ms). Cheap; the first `poll()` does the reading.
    #[uniffi::constructor]
    pub fn new(path: String, since_ms: i64) -> std::sync::Arc<Self> {
        let mut opts = activity::Options::new(since_ms);
        opts.given = vec![Path::new(&path).to_path_buf()];
        let trail = activity::Trail::open(Path::new(&path), opts);
        let project = trail.project().to_path_buf();
        std::sync::Arc::new(Self { inner: Mutex::new(trail), project, record: recording() })
    }

    /// Sync the shadow (unless recording is off), then what is new. The first poll can take a couple of seconds (it
    /// scans the day's transcripts once); call it off the main thread.
    pub fn poll(&self) -> Result<ActivityUpdate, FlexError> {
        if self.record { activity::shadow::sync(&self.project, None, None); }
        let up = self.inner.lock().map_err(|_| FlexError::Failed { message: "the trail is busy".into() })?.poll();
        Ok(ActivityUpdate { lanes: up.lanes.into_iter().map(lane).collect(), events: up.events.into_iter().map(event).collect() })
    }

    /// Whether the app records file changes into the project (`FLEX_ACTIVITY=off` turns it off, as for the CLI).
    pub fn records(&self) -> bool { self.record }
}

fn recording() -> bool { !std::env::var("FLEX_ACTIVITY").is_ok_and(|v| v == "off" || v == "0") }

fn lane(l: activity::Lane) -> ActivityLane {
    ActivityLane {
        kind: match l.kind { activity::LaneKind::Flex => "flex", activity::LaneKind::Main => "main", activity::LaneKind::Subagent => "subagent" }.into(),
        id: l.id, label: l.label, parent: l.parent, agent_type: l.agent_type, depth: l.depth, first_ms: l.first_ms, last_ms: l.last_ms,
        events: l.events as u64, done: l.done, why: l.why, works: l.works, parent_only: l.parent_only,
    }
}

fn event(e: activity::Event) -> ActivityEvent {
    ActivityEvent {
        kind: e.kind.name().into(),
        id: e.id, t_ms: e.t_ms, lane: e.lane, title: e.title, detail: e.detail, ok: e.ok, dur_ms: e.dur_ms, paths: e.paths,
        made: e.made.into_iter().map(|m| ActivityMade { path: m.path, abs: m.abs, kind: m.kind, bytes: m.bytes, place: m.place }).collect(),
        diff: e.diff, seek_s: e.seek_s, seek_frame: e.seek_frame, child_lane: e.child_lane, ref_id: e.ref_id, tool: e.tool, guess: e.guess,
    }
}

/// A `--since` as the CLI takes it (`30m`, `6h`, `2d`, a time, `all`) → epoch ms; None if it isn't one.
#[uniffi::export]
pub fn activity_since(text: String) -> Option<i64> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    activity::parse_since(&text, now)
}
