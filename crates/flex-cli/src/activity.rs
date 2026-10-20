//! `flex activity`: a project's activity trail, as the app's activity panel shows it: lanes (Flex's own, each agent's,
//! each subagent under its parent) and their events on one clock. Read-only: it writes nothing into the project.
use anyhow::Result;
use flex_core::activity::{self, trail, Event, Kind, Lane, LaneKind, Options, Trail};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(clap::Args)]
pub struct Args {
    /// the project folder
    pub dir: PathBuf,
    /// print JSON (with --follow: one event per line)
    #[arg(long)]
    pub json: bool,
    /// from when: an age (30m, 6h, 2d), a time (2026-10-17T05:00:00Z) or all
    #[arg(long, default_value = "24h")]
    pub since: String,
    /// keep printing new events as they happen
    #[arg(long)]
    pub follow: bool,
    /// only these lanes (a lane id, or a word of its label; repeatable)
    #[arg(long = "lane")]
    pub lanes: Vec<String>,
    /// only these kinds: command, change, prompt, message, tool, spawn, done, checkpoint (repeatable)
    #[arg(long = "kind")]
    pub kinds: Vec<String>,
    /// leave out the agents' transcripts (only Flex's own log)
    #[arg(long)]
    pub no_agents: bool,
}

pub fn run(a: Args) -> Result<()> {
    anyhow::ensure!(a.dir.join("project.ts").is_file(), "{} isn't a project folder (no project.ts)", a.dir.display());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis() as i64;
    let since = activity::parse_since(&a.since, now).ok_or_else(|| anyhow::anyhow!("--since: an age (30m, 6h, 2d), a time or all, not \"{}\"", a.since))?;
    let mut opts = Options::new(since);
    opts.given = vec![std::path::absolute(&a.dir)?];
    if a.no_agents { opts.claude_root = None; }
    let mut t = Trail::open(&a.dir, opts);
    let tz = local_offset_ms();
    let started = std::time::Instant::now();
    let up = t.poll();
    let events: Vec<Event> = trail::fold(up.events).into_iter().filter(|e| keep(&a, e, &up.lanes)).collect();
    let tags = tags(&up.lanes);
    if a.json && !a.follow {
        println!("{}", serde_json::to_string_pretty(&serde_json::json!({
            "schema": activity::SCHEMA, "project": t.project(), "since": activity::iso(since),
            "lanes": up.lanes, "events": events,
        }))?);
        return Ok(());
    }
    if a.json {
        for e in &events { println!("{}", serde_json::to_string(e)?); }
    } else {
        let name = t.project().file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        println!("{name}: activity since {} ({} events, read in {} ms)", local(since.max(0), tz, true), events.len(), started.elapsed().as_millis());
        println!("\nlanes");
        for l in &up.lanes { print_lane(l, &tags); }
        println!();
        let mut day = String::new();
        for e in &events { print_event(e, &tags, tz, &mut day); }
    }
    if !a.follow { return Ok(()); }
    let mut tags = tags;
    let mut day = String::new();
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let up = t.poll();
        for l in &up.lanes {
            if !tags.contains_key(&l.id) {
                tags = self::tags(&up.lanes);
                if !a.json { print!("new lane: "); print_lane(l, &tags); }
            }
        }
        for e in up.events.iter().filter(|e| keep(&a, e, &up.lanes)) {
            if a.json { println!("{}", serde_json::to_string(e)?); } else { print_event(e, &tags, tz, &mut day); }
        }
    }
}

fn keep(a: &Args, e: &Event, lanes: &[Lane]) -> bool {
    if !a.kinds.is_empty() && !a.kinds.iter().any(|k| k == e.kind.name()) { return false; }
    if a.lanes.is_empty() { return true; }
    let lane = lanes.iter().find(|l| l.id == e.lane);
    a.lanes.iter().any(|want| e.lane == *want || e.lane.contains(want.as_str())
        || lane.is_some_and(|l| l.label.to_lowercase().contains(&want.to_lowercase())))
}

/// A short tag per lane: `flex`, `main`, `main 2`, …, and a subagent's first words.
fn tags(lanes: &[Lane]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut used: HashMap<String, usize> = HashMap::new();
    for l in lanes {
        let base = match l.kind {
            LaneKind::Flex => "flex".to_string(),
            LaneKind::Main => "main".to_string(),
            LaneKind::Subagent => l.label.split_whitespace().take(3).collect::<Vec<_>>().join(" ").chars().take(18).collect(),
        };
        let n = used.entry(base.clone()).or_insert(0);
        *n += 1;
        out.insert(l.id.clone(), if *n == 1 { base } else { format!("{base} {n}") });
    }
    out
}

fn print_lane(l: &Lane, tags: &HashMap<String, String>) {
    let indent = if l.parent.is_some() { "    " } else { "  " };
    let ty = l.agent_type.as_deref().map(|t| format!(" ({t})")).unwrap_or_default();
    let state = if l.done { ", done" } else { "" };
    println!("{indent}[{}] {}{ty}: {} events{state} · {} · {}", tags[&l.id], l.label, l.events, l.id, l.why);
}

fn print_event(e: &Event, tags: &HashMap<String, String>, tz: i64, day: &mut String) {
    let d = local(e.t_ms, tz, true)[..10].to_string();
    if *day != d { println!("── {d}"); *day = d; }
    let mark = match (e.kind, e.ok) {
        (Kind::Command, Some(true)) => "$ ✓", (Kind::Command, _) => "$ ✗",
        (Kind::Change, _) => "±", (Kind::Prompt, _) => "»", (Kind::Message, _) => "“",
        (Kind::Tool, Some(false)) => "· ✗", (Kind::Tool, _) => "·", (Kind::Result, Some(false)) => "  ✗", (Kind::Result, _) => "  ✓",
        (Kind::Spawn, _) => "+", (Kind::Done, _) => "■", (Kind::Checkpoint, _) => "◆",
    };
    let dur = e.dur_ms.filter(|d| *d >= 1000 || e.kind == Kind::Command).map(|d| if d < 1000 { format!(" {d}ms") } else { format!(" {:.1}s", d as f64 / 1000.0) }).unwrap_or_default();
    let guess = if e.guess { " (lane guessed)" } else { "" };
    println!("{} [{}] {mark} {}{dur}{guess}", &local(e.t_ms, tz, false), tags.get(&e.lane).map(String::as_str).unwrap_or(&e.lane), e.title);
    if e.kind == Kind::Command {
        if let Some(err) = &e.detail { println!("{:>13}error: {}", "", err.lines().next().unwrap_or("")); }
        for m in e.made.iter().take(6) { println!("{:>13}→ {} {} ({})", "", m.kind, m.path, size(m.bytes)); }
        if e.made.len() > 6 { println!("{:>13}→ … {} more", "", e.made.len() - 6); }
        if let Some(s) = e.seek_s { println!("{:>13}at {s}s in the film", ""); }
    }
    if let Some(c) = &e.child_lane { if let Some(t) = tags.get(c) { if e.kind != Kind::Tool { println!("{:>13}→ lane [{t}]", ""); } } }
    // diffs of the project's own files (an agent's writes elsewhere stay one line)
    if e.kind == Kind::Change || (e.kind == Kind::Tool && e.paths.first().is_some_and(|p| !p.starts_with('/'))) {
        if let Some(diff) = &e.diff {
            let lines: Vec<&str> = diff.lines().filter(|l| !l.starts_with(' ')).collect();
            for l in lines.iter().take(6) { println!("{:>13}{}", "", clip(l, 110)); }
            if lines.len() > 6 { println!("{:>13}… {} more lines", "", lines.len() - 6); }
        }
    }
}

fn clip(s: &str, n: usize) -> String { if s.chars().count() <= n { s.into() } else { format!("{}…", s.chars().take(n).collect::<String>()) } }

fn size(b: u64) -> String {
    if b >= 1 << 20 { format!("{:.1} MB", b as f64 / (1 << 20) as f64) } else if b >= 1024 { format!("{} KB", b / 1024) } else { format!("{b} B") }
}

/// Epoch ms in local time: `HH:MM:SS`, or the date and minute.
fn local(ms: i64, tz: i64, date: bool) -> String {
    let s = activity::iso(ms + tz);
    if date { s[..16].replace('T', " ") } else { s[11..19].to_string() }
}

/// The local time zone's offset (from `date`, once; Flex has no time zone database of its own).
fn local_offset_ms() -> i64 {
    let out = std::process::Command::new("date").arg("+%z").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).unwrap_or_default();
    let z = out.trim();
    if z.len() != 5 { return 0; }
    let sign = if z.starts_with('-') { -1 } else { 1 };
    let (h, m) = (z[1..3].parse::<i64>().unwrap_or(0), z[3..5].parse::<i64>().unwrap_or(0));
    sign * (h * 3_600_000 + m * 60_000)
}
