//! The film's script and storyboard: `script.json` in the project. The film's own plan, written by whoever makes the film
//! (an agent or the author), in beats on the film's bars. Flex reads it, places it on the film's clock, measures it and
//! shows it; it never writes or judges it.
//!
//! ```json
//! { "beats": [
//!   { "id": "opening", "title": "Opening", "at": "1.1", "status": "sketch",
//!     "picture": "…", "music": "…", "sounds": "…", "proves": "…",
//!     "narration": [{ "text": "Money comes in.", "at": "2.1" }],
//!     "panels": [{ "sketch": "storyboard/sketches/01-opening.svg", "caption": "…", "at": "1.1" }] } ] }
//! ```
//! - A position is film `bar.beat` ("13.2.5") or seconds ("31.4s"). A beat runs from its `at` to its `to`, else to the
//!   next beat, else to the film's end. A panel runs from its `at` (default: the beat's start, or spread evenly when no
//!   panel gives one) to the next panel or the beat's end.
//! - The script plans past what's built: a position past the film's end continues the film grid at the track's tempo
//!   (four beats a bar), so the rest of the film can be boarded before it exists. Such a beat is `planned`.
//! - `status`: "sketch" (the beat isn't built: the viewer can show its panels) or "built". The film's call, kept here.
//! - A sketch is an SVG (drawn by the film's maker: framing, device, arrows for camera moves) or a PNG/JPG.

use crate::filmgrid::FilmGrid;
use crate::project::ProjectError;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct Line { pub text: String, pub t: f64, pub at: String }

#[derive(Debug, Clone, Serialize)]
pub struct Panel {
    /// project-relative
    pub sketch: String,
    pub caption: Option<String>,
    pub start: f64,
    pub end: f64,
    /// the sketch file exists
    pub found: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Beat {
    pub id: String,
    pub title: String,
    pub start: f64,
    pub end: f64,
    /// film bar.beat of its start and end
    pub at: String,
    pub to: String,
    pub status: String,
    pub picture: Option<String>,
    pub music: Option<String>,
    pub sounds: Option<String>,
    pub proves: Option<String>,
    pub narration: Vec<Line>,
    pub panels: Vec<Panel>,
    /// it starts past the film's end (the film doesn't reach it yet)
    pub planned: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Script {
    pub beats: Vec<Beat>,
    /// the film's length, and the plan's: past the film's end when beats are planned beyond it
    pub duration: f64,
    pub length: f64,
    /// what can be measured about it: positions that don't parse, overlaps and gaps, missing sketches, lines outside
    /// their beat
    pub notes: Vec<String>,
}

pub fn path(dir: &Path) -> PathBuf { dir.join("script.json") }

/// A position → film seconds: "13.2.5" on the film grid, or "31.4s". Past the grid's last bar it carries on at the
/// track's tempo (four beats a bar): the plan beyond what's built.
fn pos(s: &str, grid: Option<&FilmGrid>) -> Option<f64> {
    let s = s.trim();
    if let Some(sec) = s.strip_suffix('s') { return sec.parse().ok(); }
    let g = grid?;
    g.parse_at(s).or_else(|| {
        let (bar, beat) = match s.split_once('.') { Some((b, r)) => (b.parse::<usize>().ok()?, r.parse::<f64>().ok()?), None => (s.parse().ok()?, 1.0) };
        let (n, last) = (g.bars.len(), *g.bars.last()?);
        (bar > n).then(|| ((last + ((bar - n) as f64 * 4.0 + beat - 1.0) * g.beat) * 1000.0).round() / 1000.0)
    })
}

/// film seconds → "bar.beat" (past the grid's last bar, carried on at the track's tempo)
fn label(t: f64, grid: Option<&FilmGrid>) -> String {
    let Some(g) = grid else { return format!("{t:.2}s") };
    match g.bars.last() {
        Some(&last) if t >= last + 4.0 * g.beat - 1e-3 => {
            let beats = ((t - last) / g.beat * 4.0).round() / 4.0;
            format!("{}.{}", g.bars.len() + (beats / 4.0).floor() as usize, beats % 4.0 + 1.0)
        }
        _ => g.at(t),
    }
}

/// The project's script, placed on the film's clock (`duration`: the film's length; the animatic runs the plan's). None when it has no script.json.
pub fn load(dir: &Path, grid: Option<&FilmGrid>, duration: f64) -> Result<Option<Script>, ProjectError> {
    let p = path(dir);
    let Ok(raw) = std::fs::read_to_string(&p) else { return Ok(None) };
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| ProjectError::Invalid(format!("script.json: {e}")))?;
    let mut notes = vec![];
    let str_of = |x: &serde_json::Value, k: &str| x[k].as_str().map(String::from);
    let raw_beats = v["beats"].as_array().cloned().unwrap_or_default();
    // starts first (a beat ends where the next begins)
    let starts: Vec<Option<f64>> = raw_beats.iter().map(|b| {
        let at = b["at"].as_str().unwrap_or("");
        let t = pos(at, grid);
        if t.is_none() {
            // past the grid's last bar: the grid is older than the film (it grew since flex music read the track)
            notes.push(format!("{}: \"{at}\" isn't a film position (bar.beat or seconds{})", b["id"].as_str().unwrap_or("?"),
                if grid.is_none() { "; no film grid yet: run flex music" } else { "" }));
        }
        t
    }).collect();
    let mut beats = vec![];
    for (i, b) in raw_beats.iter().enumerate() {
        let id = str_of(b, "id").unwrap_or_else(|| format!("beat-{}", i + 1));
        let Some(start) = starts[i] else { continue };
        let next = starts[i + 1..].iter().flatten().next().copied();
        // the last beat runs to the film's end; one planned past it, a bar
        let bar = grid.map(|g| 4.0 * g.beat).unwrap_or(2.4);
        let end = b["to"].as_str().and_then(|s| pos(s, grid)).or(next).unwrap_or(if start < duration - 1e-3 { duration } else { start + bar }).max(start);
        let narration = b["narration"].as_array().map(|ls| ls.iter().filter_map(|l| {
            let text = l["text"].as_str()?.to_string();
            let t = l["at"].as_str().and_then(|s| pos(s, grid)).unwrap_or(start);
            if t < start - 1e-3 || t >= end { notes.push(format!("{id}: the line \"{text}\" starts at {} (outside the beat)", label(t, grid))); }
            Some(Line { at: label(t, grid), text, t })
        }).collect()).unwrap_or_default();
        let raw_panels = b["panels"].as_array().cloned().unwrap_or_default();
        let given: Vec<Option<f64>> = raw_panels.iter().map(|p| p["at"].as_str().and_then(|s| pos(s, grid))).collect();
        let n = raw_panels.len().max(1) as f64;
        let mut panels = vec![];
        for (j, p) in raw_panels.iter().enumerate() {
            let Some(sketch) = str_of(p, "sketch") else { continue };
            let ps = given[j].unwrap_or_else(|| if given.iter().all(|g| g.is_none()) { start + (end - start) * j as f64 / n } else { start });
            let pe = given[j + 1..].iter().flatten().next().copied()
                .unwrap_or_else(|| if given.iter().all(|g| g.is_none()) { start + (end - start) * (j + 1) as f64 / n } else { end }).min(end);
            let found = dir.join(&sketch).is_file();
            if !found { notes.push(format!("{id}: no sketch at {sketch}")); }
            panels.push(Panel { caption: str_of(p, "caption"), start: ps, end: pe.max(ps), found, sketch });
        }
        beats.push(Beat {
            at: label(start, grid), to: label(end, grid), title: str_of(b, "title").unwrap_or_else(|| id.clone()),
            status: str_of(b, "status").unwrap_or_else(|| "sketch".into()),
            picture: str_of(b, "picture"), music: str_of(b, "music"), sounds: str_of(b, "sounds"), proves: str_of(b, "proves"),
            planned: start >= duration - 1e-3, id, start, end, narration, panels,
        });
    }
    for w in beats.windows(2) {
        if w[1].start < w[0].end - 1e-3 { notes.push(format!("{} and {} overlap ({} – {})", w[0].id, w[1].id, w[1].at, w[0].to)); }
        else if w[1].start > w[0].end + 1e-3 { notes.push(format!("a gap between {} and {} ({} – {})", w[0].id, w[1].id, w[0].to, w[1].at)); }
    }
    let length = beats.iter().map(|b| b.end).fold(duration, f64::max);
    Ok(Some(Script { beats, notes, duration, length }))
}

/// The project's script with its film grid (from the project's music), for the CLI.
pub fn open(dir: &Path) -> Result<Option<Script>, ProjectError> {
    let p = crate::Project::open(dir)?;
    let grid = FilmGrid::load(&p.dir, &p.music, p.duration).ok();
    load(&p.dir, grid.as_ref(), p.duration)
}

/// A sketch as a PNG `width` wide (an SVG is rendered; a PNG or JPG is scaled), cached in Flex's support folder by the
/// file's contents. Its path.
pub fn panel_png(dir: &Path, sketch: &str, width: u32) -> Result<PathBuf, ProjectError> {
    use std::hash::{Hash, Hasher};
    let file = dir.join(sketch);
    let bytes = std::fs::read(&file).map_err(|e| ProjectError::Invalid(format!("{sketch}: {e}")))?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    width.hash(&mut h);
    let out = crate::project::support_dir().join("storyboard").join(format!("{:016x}.png", h.finish()));
    if out.is_file() { return Ok(out); }
    std::fs::create_dir_all(out.parent().unwrap())?;
    let img = if sketch.to_lowercase().ends_with(".svg") { render_svg(&bytes, file.parent(), width)? } else {
        let i = image::load_from_memory(&bytes).map_err(|e| ProjectError::Invalid(format!("{sketch}: {e}")))?;
        let h = (i.height() as f64 * width as f64 / i.width().max(1) as f64).round() as u32;
        i.resize_exact(width, h.max(1), image::imageops::FilterType::Lanczos3).to_rgba8()
    };
    img.save(&out).map_err(|e| ProjectError::Invalid(format!("{}: {e}", out.display())))?;
    Ok(out)
}

/// An SVG document → RGBA `width` wide (its own aspect), with the system's fonts and paths relative to `base`.
pub fn render_svg(svg: &[u8], base: Option<&Path>, width: u32) -> Result<image::RgbaImage, ProjectError> {
    let mut opt = resvg::usvg::Options { resources_dir: base.map(Path::to_path_buf), ..Default::default() };
    opt.fontdb = crate::paint::fontdb();
    let tree = resvg::usvg::Tree::from_data(svg, &opt).map_err(|e| ProjectError::Invalid(format!("the sketch isn't valid SVG: {e}")))?;
    let size = tree.size();
    let scale = width as f32 / size.width();
    let h = (size.height() * scale).round().max(1.0) as u32;
    let mut pix = resvg::tiny_skia::Pixmap::new(width, h).ok_or_else(|| ProjectError::Invalid("an empty sketch".into()))?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pix.as_mut());
    // tiny-skia is premultiplied; image wants straight alpha
    let mut out = image::RgbaImage::new(width, h);
    for (o, p) in out.pixels_mut().zip(pix.pixels()) { let c = p.demultiply(); *o = image::Rgba([c.red(), c.green(), c.blue(), c.alpha()]); }
    Ok(out)
}

fn esc(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }

/// The storyboard as one sheet: every panel in order with its beat, its bars and its caption (an SVG laid out here,
/// rendered with the panels embedded). `cols` panels a row, each `w` wide.
pub fn sheet(dir: &Path, script: &Script, out: &Path, cols: usize, w: u32) -> Result<(), ProjectError> {
    let (pw, ph) = (w as f64, (w as f64 * 9.0 / 16.0).round());
    let (gap, cap_h, head) = (24.0, 64.0, 70.0);
    let panels: Vec<(&Beat, &Panel)> = script.beats.iter().flat_map(|b| b.panels.iter().map(move |p| (b, p))).collect();
    let rows = panels.len().div_ceil(cols).max(1);
    let (sw, sh) = (gap + cols as f64 * (pw + gap), head + rows as f64 * (ph + cap_h + gap) + gap);
    let mut s = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{sw}" height="{sh}" viewBox="0 0 {sw} {sh}"><rect width="100%" height="100%" fill="#f4f2ee"/><text x="{gap}" y="44" font-family="Helvetica, Arial" font-size="26" font-weight="700" fill="#1c1b1a">{}</text>"##,
        esc(&format!("{} · storyboard · {} beats, {} panels", dir.file_name().unwrap_or_default().to_string_lossy(), script.beats.len(), panels.len())));
    for (i, (b, p)) in panels.iter().enumerate() {
        let (x, y) = (gap + (i % cols) as f64 * (pw + gap), head + (i / cols) as f64 * (ph + cap_h + gap));
        s += &format!(r##"<rect x="{x}" y="{y}" width="{pw}" height="{ph}" fill="#fff" stroke="#d8d4cc"/>"##);
        if p.found {
            let png = panel_png(dir, &p.sketch, w)?;
            s += &format!(r##"<image x="{x}" y="{y}" width="{pw}" height="{ph}" preserveAspectRatio="xMidYMid meet" xlink:href="{}"/>"##, esc(&png.to_string_lossy()));
        } else {
            s += &format!(r##"<text x="{}" y="{}" text-anchor="middle" font-family="Helvetica" font-size="16" fill="#b04">no sketch: {}</text>"##, x + pw / 2.0, y + ph / 2.0, esc(&p.sketch));
        }
        let when = format!("{}  ·  {:.1}–{:.1}s", b.at, p.start, p.end);
        s += &format!(r##"<text x="{x}" y="{}" font-family="Helvetica, Arial" font-size="15" font-weight="700" fill="#1c1b1a">{}</text><text x="{}" y="{}" text-anchor="end" font-family="Menlo, monospace" font-size="12" fill="#6b665e">{}</text>"##,
            y + ph + 22.0, esc(&b.title), x + pw, y + ph + 22.0, esc(&when));
        if let Some(c) = &p.caption {
            let c: String = c.chars().take(110).collect();
            s += &format!(r##"<text x="{x}" y="{}" font-family="Helvetica, Arial" font-size="13" fill="#4a4640">{}</text>"##, y + ph + 44.0, esc(&c));
        }
    }
    s += "</svg>";
    let img = render_svg(s.as_bytes(), Some(dir), sw.round() as u32)?;
    img.save(out).map_err(|e| ProjectError::Invalid(format!("{}: {e}", out.display())))?;
    Ok(())
}

/// The animatic: each panel held over its bars, the film's track under it (`track`), a mp4 `w` wide. Where no panel
/// covers a stretch, it's a plain card with the beat's title.
pub fn animatic(dir: &Path, script: &Script, track: Option<&Path>, duration: f64, out: &Path, w: u32) -> Result<(), ProjectError> {
    let work = crate::project::support_dir().join("storyboard").join("animatic");
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work)?;
    let (fw, fh) = crate::project::frame_size(dir); // the film's frame (frame.json): 16:9, or 9:16 for a vertical film
    let h = ((w as f64 * fh as f64 / fw as f64 / 2.0).round() * 2.0) as u32;
    // the stretches: panels, and cards for what no panel covers
    let mut cuts: Vec<(f64, f64, PathBuf)> = vec![];
    let blank = |title: &str, i: usize| -> Result<PathBuf, ProjectError> {
        let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}"><rect width="100%" height="100%" fill="#f4f2ee"/><text x="50%" y="52%" text-anchor="middle" font-family="Helvetica, Arial" font-size="{}" fill="#8a857c">{}</text></svg>"##, h / 14, esc(title));
        let p = work.join(format!("gap-{i}.png"));
        render_svg(svg.as_bytes(), None, w)?.save(&p).map_err(|e| ProjectError::Invalid(e.to_string()))?;
        Ok(p)
    };
    let mut t = 0.0;
    let mut n = 0;
    for b in &script.beats {
        for p in &b.panels {
            if p.start > t + 0.02 { cuts.push((t, p.start, blank(&b.title, n)?)); n += 1; }
            let img = if p.found { panel_png(dir, &p.sketch, w)? } else { blank(&format!("{}: no sketch", b.title), n)? };
            n += 1;
            cuts.push((p.start, p.end, img));
            t = p.end;
        }
        if b.panels.is_empty() && b.end > t + 0.02 { cuts.push((b.start.max(t), b.end, blank(&b.title, n)?)); n += 1; t = b.end; }
    }
    if duration > t + 0.02 { cuts.push((t, duration, blank("", n)?)); }
    // ffmpeg's concat list: each picture for its stretch (letterboxed to the film's frame)
    let mut list = String::new();
    for (a, b, p) in &cuts { list += &format!("file '{}'\nduration {:.3}\n", p.display(), (b - a).max(0.04)); }
    if let Some((_, _, p)) = cuts.last() { list += &format!("file '{}'\n", p.display()); }
    let lp = work.join("list.txt");
    std::fs::write(&lp, list)?;
    let mut c = std::process::Command::new("ffmpeg");
    c.args(["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i"]).arg(&lp);
    if let Some(a) = track { c.arg("-i").arg(a); }
    c.args(["-vf", &format!("scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=0xf4f2ee,fps=30,format=yuv420p")]);
    c.args(["-c:v", "libx264", "-crf", "20", "-preset", "veryfast"]);
    // (past the track's end, for beats planned beyond the film: silence)
    if track.is_some() { c.args(["-af", "apad", "-c:a", "aac", "-b:a", "192k", "-map", "0:v", "-map", "1:a"]); }
    c.args(["-t", &format!("{duration:.3}")]).arg(out);
    let o = c.env("PATH", crate::project::login_path()).output().map_err(|e| ProjectError::Run(format!("ffmpeg: {e}")))?;
    if !o.status.success() { return Err(ProjectError::Run(format!("ffmpeg: {}", String::from_utf8_lossy(&o.stderr).trim()))); }
    Ok(())
}
