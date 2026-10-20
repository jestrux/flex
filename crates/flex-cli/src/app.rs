//! The running Flex app, through its control socket (flex_core::control): the author's playhead, and the app's warm
//! session for painting and rendering. Every command here works without the app too; the app is a faster path.

use anyhow::{anyhow, bail, Result};
use flex_core::control::{self, Client, Request};
use serde_json::Value;
use std::path::Path;
use std::time::Duration;

const BUNDLE_ID: &str = "dev.waky.flex";

/// The app, if it's running; with `launch`, start it (in front with `front`) and wait for it.
pub fn client(launch: bool, front: bool) -> Result<Option<Client>> {
    if let Some(c) = Client::app() { return Ok(Some(c)); }
    if !launch { return Ok(None); }
    eprintln!("flex: starting Flex");
    // a clean environment, so the app doesn't inherit the caller's (an agent session's variables would reach every tool
    // the app starts)
    let mut open = std::process::Command::new("/usr/bin/open");
    open.env_clear();
    for v in ["HOME", "USER", "LOGNAME", "FLEX_SUPPORT", "FLEX_PIPELINE"] { if let Ok(x) = std::env::var(v) { open.env(v, x); } }
    open.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
    if !front { open.arg("-g"); }
    if !open.args(["-b", BUNDLE_ID]).status().map(|s| s.success()).unwrap_or(false) {
        bail!("the Flex app isn't installed (no app with bundle id {BUNDLE_ID})");
    }
    control::wait_for_app(Duration::from_secs(20)).map(Some).ok_or_else(|| anyhow!("Flex didn't answer within 20 s"))
}

/// `dir`'s status in the app, when the app has it open and loaded.
pub fn project(c: &mut Client, dir: &Path) -> Option<Value> {
    let v = c.call(&Request::Status { project: Some(dir.to_string_lossy().into_owned()) }).ok()?;
    v["projects"].as_array()?.first().filter(|p| p["frames"].is_u64()).cloned()
}

/// The app has `dir` open, running the film as the command would (no variant or take preview on either side): its
/// client and the project's status.
pub fn warm(dir: &Path, variants: bool) -> Option<(Client, Value)> {
    if variants { return None; }
    let dir = std::fs::canonicalize(dir).ok()?;
    let mut c = Client::app()?;
    let p = project(&mut c, &dir)?;
    if p["variants"].as_array().is_some_and(|v| !v.is_empty()) { return None; }
    Some((c, p))
}

/// A frame from `at` against the app's project status: a frame number, or film seconds ("12.5s").
pub fn frame_in(p: &Value, at: &str) -> Result<u32> {
    let (fps, frames) = (p["fps"].as_u64().unwrap_or(30) as f64, p["frames"].as_u64().unwrap_or(0) as u32);
    let f = if let Some(s) = at.strip_suffix('s') { (s.parse::<f64>()? * fps).round() as u32 } else { at.parse()? };
    anyhow::ensure!(f < frames, "frame {f} is past the end ({frames} frames)");
    Ok(f)
}

/// One line about a project in the app: its playhead and what's painted.
pub fn describe(p: &Value) -> String {
    let ph = &p["playhead"];
    let render = p["rendering"].as_object().map(|r| format!(" · rendering {} {}/{}", r["what"].as_str().unwrap_or(""), r["done"], r["total"])).unwrap_or_default();
    format!("{}  ·  {}  ·  playhead {:.2}s (frame {}, {})  ·  painted {}/{}{}{}",
        p["name"].as_str().unwrap_or("?"), p["dir"].as_str().unwrap_or(""), ph["t"].as_f64().unwrap_or(0.), ph["frame"], ph["scene"].as_str().unwrap_or("?"),
        p["painted"], p["total"], p["variants"].as_array().filter(|v| !v.is_empty()).map(|v| format!(" · variants {}", serde_json::to_string(v).unwrap_or_default())).unwrap_or_default(), render)
}

/// Progress for a terminal (one line, updated in place) or for a pipe or a log (a line every tenth, and the end).
pub fn progress(label: &'static str) -> impl Fn(u32, u32) + Sync {
    let tty = std::io::IsTerminal::is_terminal(&std::io::stderr());
    let last = std::sync::atomic::AtomicU32::new(u32::MAX);
    move |done, total| {
        if tty { eprint!("\r  {label} {done}/{total} ({:.0}%)", 100.0 * done as f64 / total.max(1) as f64); if done == total { eprintln!(); } return; }
        let tenth = if total == 0 { 10 } else { done * 10 / total };
        if last.swap(tenth, std::sync::atomic::Ordering::Relaxed) != tenth { eprintln!("  {label} {done}/{total} ({}%)", tenth * 10); }
    }
}
