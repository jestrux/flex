//! Review pages, written as plain local HTML next to the media they play (no server needed):
//! - `compare`: the same picture under each value of a variant flag (a music edit, a mix), muxed one mp4 per value from
//!   the latest render's picture and each value's own mix, with the scenes and each value's music edit as timelines,
//!   moment buttons and one-player-at-a-time;
//! - `clips`: the latest render cut scene by scene, with a checklist per scene from a notes file
//!   (`{ "<scene id>": { "note": "…", "asks": ["…"] } }`), ticks and notes kept in the browser, and feedback to copy.

use crate::project::{login_path, ProjectError};
use crate::server::{Manifest, Server};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

const COMPARE: &str = include_str!("../../../server/pages/compare.html");
const CLIPS: &str = include_str!("../../../server/pages/clips.html");

fn bad(m: impl Into<String>) -> ProjectError { ProjectError::Invalid(m.into()) }

/// The film's latest whole-film render (1080p first), in Flex's renders folder
pub fn latest_render(dir: &Path) -> Result<PathBuf, ProjectError> {
    let name = crate::tools::project_name(dir);
    let mut rs: Vec<_> = crate::renders::list(&crate::renders::default_dir(&name), &name).into_iter().filter(|r| r.part.is_none()).collect();
    rs.sort_by(|a, b| (a.size.is_empty(), a.modified).partial_cmp(&(b.size.is_empty(), b.modified)).unwrap());
    rs.pop().map(|r| r.path).ok_or_else(|| bad(format!("no render of {name} yet: flex render {} first", dir.display())))
}

fn ffmpeg(args: &[&str]) -> Result<(), ProjectError> {
    let o = Command::new("ffmpeg").args(["-v", "error", "-y"]).args(args).env("PATH", login_path()).output()?;
    if o.status.success() { Ok(()) } else { Err(bad(format!("ffmpeg: {}", String::from_utf8_lossy(&o.stderr).trim()))) }
}

fn page(tpl: &str, data: &Value) -> String { tpl.replace("/*DATA*/null", &serde_json::to_string(data).unwrap()) }

fn scenes(m: &Manifest) -> Value { json!(m.scenes.iter().map(|s| json!({ "id": s.id, "start": s.start, "end": s.end })).collect::<Vec<_>>()) }

pub struct Compare { pub name: String, pub values: Vec<String>, pub moments: Vec<(f64, String)>, pub render: Option<PathBuf>, pub out: Option<PathBuf> }

/// → the page's path
pub fn compare(dir: &Path, o: &Compare) -> Result<PathBuf, ProjectError> {
    if o.values.len() < 2 { return Err(bad("compare needs two values or more: --with NAME=a --with NAME=b")); }
    let film = crate::tools::project_name(dir);
    let render = match &o.render { Some(r) => r.clone(), None => latest_render(dir)? };
    let out = o.out.clone().unwrap_or_else(|| crate::renders::default_dir(&film).join(format!("compare-{}", o.name.to_lowercase())));
    std::fs::create_dir_all(&out)?;
    let mut variants = vec![];
    let mut base: Option<Manifest> = None;
    for v in &o.values {
        let srv = Server::start_with(dir, &[(o.name.clone(), v.clone())])?;
        let wav = out.join(format!("{v}.wav"));
        srv.mix(&wav)?;
        let file = format!("{}-{v}.mp4", film);
        ffmpeg(&["-i", &render.to_string_lossy(), "-i", &wav.to_string_lossy(), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", &out.join(&file).to_string_lossy()])?;
        let _ = std::fs::remove_file(&wav);
        let m = &srv.manifest;
        variants.push(json!({ "label": format!("{}={v}", o.name), "file": file, "music": { "key": m.music.key, "segments": m.music.segments, "tracks": m.music.tracks } }));
        if base.is_none() { base = Some(m.clone()); }
    }
    let m = base.unwrap();
    let data = json!({ "film": film, "name": o.name, "len": m.duration, "scenes": scenes(&m), "variants": variants,
        "moments": o.moments.iter().map(|(t, w)| json!({ "t": t, "what": w })).collect::<Vec<_>>() });
    let p = out.join("index.html");
    std::fs::write(&p, page(COMPARE, &data))?;
    Ok(p)
}

pub struct Clips { pub notes: Option<PathBuf>, pub render: Option<PathBuf>, pub out: Option<PathBuf> }

pub fn clips(dir: &Path, m: &Manifest, o: &Clips) -> Result<PathBuf, ProjectError> {
    let film = crate::tools::project_name(dir);
    let render = match &o.render { Some(r) => r.clone(), None => latest_render(dir)? };
    let out = o.out.clone().unwrap_or_else(|| crate::renders::default_dir(&film).join("clips"));
    std::fs::create_dir_all(out.join("clips"))?;
    let notes: Value = match &o.notes {
        Some(n) => serde_json::from_str(&std::fs::read_to_string(n)?).map_err(|e| bad(format!("{}: {e}", n.display())))?,
        None => json!({}),
    };
    let mut rows = vec![];
    for (i, s) in m.scenes.iter().enumerate() {
        let clip = format!("clips/{:02}-{}.mp4", i + 1, s.id);
        // re-encoded, so each clip starts and ends on its scene's own frames (a stream copy cuts on keyframes)
        ffmpeg(&["-ss", &format!("{:.3}", s.start), "-to", &format!("{:.3}", s.end), "-i", &render.to_string_lossy(), "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", &out.join(&clip).to_string_lossy()])?;
        rows.push(json!({ "id": s.id, "start": s.start, "end": s.end, "clip": clip, "notes": notes.get(&s.id).cloned().unwrap_or(Value::Null) }));
    }
    let data = json!({ "film": film, "render": render.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(), "scenes": rows });
    let p = out.join("index.html");
    std::fs::write(&p, page(CLIPS, &data))?;
    Ok(p)
}
