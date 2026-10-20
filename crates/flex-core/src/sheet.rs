//! `flex sheet`: a labelled contact sheet or frame strip of a video (or a folder of images), optionally each frame beside
//! a reference film's same frame.
//!
//! Frames come out of ffmpeg by exact frame number (`select` on the frame index, passthrough timing), so a label's
//! "f375" is the frame `ffmpeg -vf select=eq(n\,375)` gives. The sheet is composed here (`image`, Lanczos3 thumbnails)
//! and its text drawn as SVG (resvg, the system fonts). With `--ref`, each frame stands beside the reference's frame at
//! the same time, with the mean difference of the two (0–255, per channel, at the frame's full size).

use crate::project::{login_path, ProjectError};
use image::{imageops, RgbImage};
use resvg::{tiny_skia as sk, usvg};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Options {
    /// a video, or a folder of images (sorted by name)
    pub input: PathBuf,
    /// a stretch (seconds; for a video)
    pub from: Option<f64>,
    pub to: Option<f64>,
    /// frames per second to take (default: enough for about 24 frames)
    pub fps: Option<f64>,
    /// columns (default: by the frame's shape)
    pub cols: Option<u32>,
    /// a thumbnail's width in px (default 270 for a vertical frame, 360 otherwise)
    pub thumb: Option<u32>,
    /// label each frame with its time and frame number
    pub label: bool,
    /// a reference video: each frame shown beside the reference's same frame, with their mean difference
    pub reference: Option<PathBuf>,
    pub out: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub out: PathBuf,
    pub frames: u32,
    /// with a reference: each frame's time and mean difference (0–255)
    pub diffs: Vec<(f64, f64)>,
}

impl Report {
    pub fn summary(&self) -> String { format!("{} · {} frames", self.out.display(), self.frames) }
}

/// The most frames one sheet takes.
const MOST: usize = 400;
const GAP: u32 = 8;
const PAIR_SPACE: u32 = 20;
const PAIR_GAP: u32 = 3;
const BG: [u8; 3] = [17, 17, 17];

fn bad(m: impl Into<String>) -> ProjectError { ProjectError::Invalid(m.into()) }

/// A video's frame rate and duration (ffprobe).
pub fn probe(file: &Path) -> Result<(f64, f64), ProjectError> {
    let o = Command::new("ffprobe").args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,avg_frame_rate,duration:format=duration", "-of", "json"])
        .arg(file).env("PATH", login_path()).output().map_err(|e| bad(format!("couldn't run ffprobe (install ffmpeg): {e}")))?;
    if !o.status.success() { return Err(bad(format!("{}: not a video ffprobe can read: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    let j: serde_json::Value = serde_json::from_slice(&o.stdout).map_err(|e| bad(e.to_string()))?;
    let s = j["streams"].get(0).ok_or_else(|| bad(format!("{}: no video stream", file.display())))?;
    let rate = |k: &str| s[k].as_str().and_then(|r| { let (a, b) = r.split_once('/')?; let (a, b) = (a.parse::<f64>().ok()?, b.parse::<f64>().ok()?); (b > 0. && a > 0.).then(|| a / b) });
    let fps = rate("r_frame_rate").or_else(|| rate("avg_frame_rate")).ok_or_else(|| bad(format!("{}: no frame rate", file.display())))?;
    let num = |v: &serde_json::Value| v.as_str().and_then(|x| x.parse::<f64>().ok());
    let dur = num(&s["duration"]).or_else(|| num(&j["format"]["duration"])).unwrap_or(0.);
    Ok((fps, dur))
}

/// The frame numbers to take: from `from` to `to` (inclusive, when it lands on a step) every 1/`step_fps` s.
pub fn frame_numbers(from: f64, to: f64, step_fps: f64, video_fps: f64) -> Vec<u64> {
    let mut v: Vec<u64> = vec![];
    let mut k = 0u64;
    loop {
        let t = from + k as f64 / step_fps;
        if t > to + 1e-6 { break; }
        let n = (t * video_fps + 1e-6).round() as u64;
        if v.last() != Some(&n) { v.push(n); }
        k += 1;
        if v.len() > MOST { break; }
    }
    v
}

/// Frames `ns` (ascending) of a video, at full size, by exact frame index.
pub fn extract(file: &Path, ns: &[u64]) -> Result<Vec<RgbImage>, ProjectError> {
    if ns.is_empty() { return Ok(vec![]); }
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!("flex-sheet-{}-{}", std::process::id(), SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let expr = ns.iter().map(|n| format!("eq(n\\,{n})")).collect::<Vec<_>>().join("+");
    let o = Command::new("ffmpeg").args(["-v", "error", "-nostdin", "-i"]).arg(file)
        .args(["-vf", &format!("select={expr}"), "-fps_mode", "passthrough", "-compression_level", "1"]).arg(dir.join("f%05d.png"))
        .env("PATH", login_path()).output().map_err(|e| bad(format!("couldn't run ffmpeg: {e}")))?;
    let read = || -> Result<Vec<RgbImage>, ProjectError> {
        if !o.status.success() { return Err(bad(format!("ffmpeg couldn't take the frames of {}: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)?.filter_map(|e| e.ok().map(|e| e.path())).collect();
        files.sort();
        files.iter().map(|f| image::open(f).map(|i| i.to_rgb8()).map_err(|e| bad(format!("{}: {e}", f.display())))).collect()
    };
    let r = read();
    let _ = std::fs::remove_dir_all(&dir);
    r
}

/// Mean absolute difference (0–255, per channel) of two frames; `b` is resized to `a`'s size when it differs.
pub fn mean_diff(a: &RgbImage, b: &RgbImage) -> f64 {
    let resized;
    let b = if a.dimensions() == b.dimensions() { b } else { resized = imageops::resize(b, a.width(), a.height(), imageops::FilterType::Triangle); &resized };
    let sum: u64 = a.as_raw().iter().zip(b.as_raw()).map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs() as u64).sum();
    sum as f64 / a.as_raw().len().max(1) as f64
}

fn xml(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }

/// An image fitted (contained) into w × h on the sheet's background.
fn fit(img: &RgbImage, w: u32, h: u32) -> RgbImage {
    let (iw, ih) = img.dimensions();
    let s = (w as f64 / iw as f64).min(h as f64 / ih as f64);
    let (tw, th) = (((iw as f64 * s).round() as u32).clamp(1, w), ((ih as f64 * s).round() as u32).clamp(1, h));
    let t = imageops::resize(img, tw, th, imageops::FilterType::Lanczos3);
    if (tw, th) == (w, h) { return t; }
    let mut c = RgbImage::from_pixel(w, h, image::Rgb(BG));
    imageops::overlay(&mut c, &t, ((w - tw) / 2) as i64, ((h - th) / 2) as i64);
    c
}

/// One frame on the sheet: its picture, the reference's (if any), its label and the difference.
struct Cell { img: RgbImage, reference: Option<RgbImage>, label: String, diff: Option<f64> }

pub fn run(o: &Options) -> Result<Report, ProjectError> {
    let label = o.label;
    let mut diffs = vec![];
    let mut header;
    let cells: Vec<Cell> = if o.input.is_dir() {
        if o.reference.is_some() { return Err(bad("--ref goes with a video, not a folder of images")); }
        if o.from.is_some() || o.to.is_some() || o.fps.is_some() { return Err(bad("--from, --to and --fps go with a video, not a folder of images")); }
        let mut files: Vec<PathBuf> = std::fs::read_dir(&o.input)?.filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_file() && p.extension().map(|e| matches!(e.to_string_lossy().to_lowercase().as_str(), "png" | "jpg" | "jpeg")).unwrap_or(false)).collect();
        files.sort();
        if files.is_empty() { return Err(bad(format!("no PNG or JPEG images in {}", o.input.display()))); }
        if files.len() > MOST { return Err(bad(format!("{} images: a sheet takes at most {MOST}", files.len()))); }
        header = format!("{} · {} images", o.input.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), files.len());
        files.iter().map(|f| Ok(Cell {
            img: crate::crop::load(f)?.to_rgb8(), reference: None, diff: None,
            label: f.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        })).collect::<Result<_, ProjectError>>()?
    } else {
        if !o.input.is_file() { return Err(bad(format!("no file or folder at {}", o.input.display()))); }
        let (vfps, dur) = probe(&o.input)?;
        let from = o.from.unwrap_or(0.).max(0.);
        let last = if dur > 0. { dur - 1. / vfps } else { f64::MAX };
        let to = o.to.unwrap_or(last).min(last);
        if to < from { return Err(bad(format!("--to {to:.3} is before --from {from:.3} (the video is {dur:.3} s)"))); }
        let fps = o.fps.unwrap_or_else(|| if to > from { 23. / (to - from) } else { 1. });
        if !(fps.is_finite() && fps > 0.) { return Err(bad(format!("--fps {fps}: frames per second above 0"))); }
        let ns = frame_numbers(from, to, fps.min(vfps), vfps);
        if ns.len() > MOST { return Err(bad(format!("that's more than {MOST} frames: a lower --fps or a shorter stretch"))); }
        let (frames, refs) = match &o.reference {
            None => (extract(&o.input, &ns)?, None),
            Some(r) => {
                let (rfps, _) = probe(r)?;
                let rns: Vec<u64> = ns.iter().map(|n| (*n as f64 / vfps * rfps + 1e-6).round() as u64).collect();
                let (a, b) = std::thread::scope(|s| {
                    let h = s.spawn(|| extract(r, &rns));
                    (extract(&o.input, &ns), h.join().unwrap_or_else(|_| Err(bad("ffmpeg thread failed"))))
                });
                (a?, Some(b?))
            }
        };
        if frames.is_empty() { return Err(bad(format!("no frames between {from:.3} s and {to:.3} s"))); }
        let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        header = format!("{} · {:.3}–{:.3} s · {} fps · {} frames", name(&o.input), from, to, (fps * 1000.).round() / 1000., frames.len());
        if let Some(r) = &o.reference { header.push_str(&format!("  ·  left: this, right: {}", name(r))); }
        let mut refs = refs.map(|v| v.into_iter());
        frames.into_iter().zip(ns.iter()).map(|(img, n)| {
            let t = *n as f64 / vfps;
            let reference = refs.as_mut().and_then(|r| r.next());
            let diff = reference.as_ref().map(|r| (mean_diff(&img, r) * 100.).round() / 100.);
            if let Some(d) = diff { diffs.push(((t * 1000.).round() / 1000., d)); }
            Cell { img, reference, diff, label: format!("{t:.3} s · f{n}") }
        }).collect()
    };
    let (fw, fh) = cells[0].img.dimensions();
    let vertical = fh > fw;
    let paired = cells.iter().any(|c| c.reference.is_some());
    let tw = o.thumb.unwrap_or(if vertical { 270 } else { 360 }).clamp(32, 4096);
    let th = ((tw as f64 * fh as f64 / fw as f64).round() as u32).max(1);
    let cols = o.cols.unwrap_or(match (vertical, paired) { (true, false) => 8, (false, false) => 4, (true, true) => 4, (false, true) => 2 })
        .clamp(1, cells.len() as u32);
    let rows = (cells.len() as u32).div_ceil(cols);
    let font = (tw as f64 / 15.).clamp(12., 24.).round();
    let strip = if label || paired { (font * 1.6).round() as u32 } else { 0 };
    let head = (font * 2.).round() as u32;
    let cell_w = if paired { tw * 2 + PAIR_GAP } else { tw };
    let cell_h = strip + th;
    let gap = if paired { PAIR_SPACE } else { GAP };
    let (sw, sh) = (gap + cols * (cell_w + gap), head + rows * (cell_h + gap));
    let mut sheet = RgbImage::from_pixel(sw, sh, image::Rgb(BG));
    let mut svg = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="{sw}" height="{sh}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="{font}">"#);
    svg.push_str(&format!(r##"<text x="{}" y="{}" fill="#bbbbbb">{}</text>"##, if paired { PAIR_SPACE } else { GAP }, (head as f64 * 0.68).round(), xml(&header)));
    let thumbs: Vec<(RgbImage, Option<RgbImage>)> = {
        use rayon::prelude::*;
        cells.par_iter().map(|c| (fit(&c.img, tw, th), c.reference.as_ref().map(|r| fit(r, tw, th)))).collect()
    };
    for (i, (c, (a, b))) in cells.iter().zip(thumbs).enumerate() {
        let (col, row) = (i as u32 % cols, i as u32 / cols);
        let x = gap + col * (cell_w + gap);
        let y = head + row * (cell_h + gap);
        imageops::overlay(&mut sheet, &a, x as i64, (y + strip) as i64);
        if let Some(b) = b { imageops::overlay(&mut sheet, &b, (x + tw + PAIR_GAP) as i64, (y + strip) as i64); }
        let base = y as f64 + strip as f64 * 0.72;
        if label { svg.push_str(&format!(r##"<text x="{}" y="{base}" fill="#ffffdd">{}</text>"##, x + 4, xml(&c.label))); }
        if let Some(d) = c.diff {
            let hue = if d < 2. { "#8fd18f" } else if d < 8. { "#ffd27f" } else { "#ff8a7a" };
            svg.push_str(&format!(r##"<text x="{}" y="{base}" fill="{hue}" text-anchor="end">Δ {d:.1}</text>"##, x + cell_w - 4));
        }
    }
    svg.push_str("</svg>");
    // the text over the sheet
    let mut opt = usvg::Options::default();
    opt.fontdb = crate::paint::fontdb();
    let tree = usvg::Tree::from_str(&svg, &opt).map_err(|e| bad(format!("the labels' SVG: {e}")))?;
    let mut ink = sk::Pixmap::new(sw, sh).ok_or_else(|| bad(format!("a {sw}×{sh} sheet is too large")))?;
    resvg::render(&tree, sk::Transform::identity(), &mut ink.as_mut());
    for (p, q) in sheet.as_mut().chunks_exact_mut(3).zip(ink.data().chunks_exact(4)) {
        let a = q[3] as u32;
        if a == 0 { continue; }
        for k in 0..3 { p[k] = (q[k] as u32 + p[k] as u32 * (255 - a) / 255).min(255) as u8; }
    }
    let out = match &o.out { Some(p) => p.clone(), None => crate::crop::free_name(&o.input, ".sheet", "jpg") };
    if let Some(p) = out.parent() { if !p.as_os_str().is_empty() { std::fs::create_dir_all(p)?; } }
    let werr = |e: String| bad(format!("couldn't write {}: {e}", out.display()));
    match out.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("png") => sheet.save(&out).map_err(|e| werr(e.to_string()))?,
        _ => {
            let f = std::fs::File::create(&out).map_err(|e| werr(e.to_string()))?;
            image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(f), 88).encode_image(&sheet).map_err(|e| werr(e.to_string()))?;
        }
    }
    Ok(Report { out, frames: cells.len() as u32, diffs })
}
