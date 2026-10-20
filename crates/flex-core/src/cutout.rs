//! `flex cutout`: a person cut out of a photo or a clip (macOS Vision), as a clip with alpha (ProRes 4444) or a PNG, for
//! `{video, alpha: true}` / `{image, alpha: true}` layers.
//!
//! Vision finds her (`server/cutout.swift`, compiled once into the support folder like `flex read`'s recogniser): the
//! foreground-instance mask limited to a grown person mask, so signs and lights behind her drop out. The rest happens
//! here, on the masks: smoothing over time (only where neighbouring frames nearly agree, so a moving arm never leaves a
//! ghost or a hole), dropping specks far smaller than her, the alpha floor, and the defringe (the background's colour
//! taken back out of her soft edge, and coloured light spilled onto her outline pulled back to her own colour).
//!
//! A video streams through: ffmpeg decodes RGBA frames → the Vision helper (stdin/stdout) → the clean-up here → ffmpeg
//! encodes ProRes 4444, so no frames are written to disk. The output is written beside its final name and renamed when
//! complete.

use crate::project::{login_path, support_dir, ProjectError};
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};

const SOURCE: &str = include_str!("../../../server/cutout.swift");
const VIDEO_EXT: &[&str] = &["mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "3gp", "gif"];

#[derive(Debug, Clone)]
pub struct Options {
    /// a photo or a video
    pub input: PathBuf,
    /// where to write (default: beside the input, `<name>.cutout.mov` / `.cutout.png`)
    pub out: Option<PathBuf>,
    /// a stretch of a video (seconds)
    pub from: Option<f64>,
    pub to: Option<f64>,
    /// keep background text and signs (by default only the person instance is kept)
    pub keep_text: bool,
    /// temporal smoothing of the mask, in frames (0 = off)
    pub smooth: u32,
    /// alpha below this (0–1) becomes fully transparent
    pub floor: f64,
    /// also write a preview over a checkerboard (`<out>.preview.png` / `.mp4`)
    pub preview: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub out: PathBuf,
    pub frames: u32,
    pub width: u32,
    pub height: u32,
    /// share of the frame kept (mean over frames), 0–1
    pub coverage: f64,
    pub notes: Vec<String>,
}

impl Report {
    pub fn summary(&self) -> String { format!("{} · {} frame(s) {}×{} · {:.0}% kept", self.out.display(), self.frames, self.width, self.height, self.coverage * 100.0) }
}

fn invalid(m: impl Into<String>) -> ProjectError { ProjectError::Invalid(m.into()) }

/// The compiled Vision helper (built on first use: swiftc, from the Xcode command-line tools).
fn binary() -> Result<PathBuf, ProjectError> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    SOURCE.hash(&mut h);
    let dir = support_dir().join("bin");
    let bin = dir.join(format!("cutout-{:012x}", h.finish() & 0xffff_ffff_ffff));
    if bin.exists() { return Ok(bin); }
    std::fs::create_dir_all(&dir)?;
    let src = dir.join("cutout.swift");
    std::fs::write(&src, SOURCE)?;
    let o = Command::new("xcrun").args(["swiftc", "-O", "-o"]).arg(&bin).arg(&src).env("PATH", login_path()).output()?;
    if !o.status.success() {
        return Err(invalid(format!("couldn't build the cut-out helper (swiftc; install the Xcode command-line tools): {}",
            String::from_utf8_lossy(&o.stderr).lines().find(|l| l.contains("error")).unwrap_or("swiftc failed"))));
    }
    Ok(bin)
}

/// A video, by its extension (anything else is read as a photo).
pub fn is_video(p: &Path) -> bool { p.extension().map(|e| VIDEO_EXT.contains(&e.to_string_lossy().to_lowercase().as_str())).unwrap_or(false) }

/// `<dir>/<stem>.cutout.<mov|png>`
pub fn default_out(input: &Path, video: bool) -> PathBuf {
    let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "cutout".into());
    input.with_file_name(format!("{stem}.cutout.{}", if video { "mov" } else { "png" }))
}

pub fn run(o: &Options) -> Result<Report, ProjectError> {
    if !o.input.is_file() { return Err(invalid(format!("no file at {}", o.input.display()))); }
    if !(0.0..1.0).contains(&o.floor) { return Err(invalid(format!("--floor is a share of full alpha, 0–1 (not {})", o.floor))); }
    let video = is_video(&o.input);
    if !video && (o.from.is_some() || o.to.is_some()) { return Err(invalid("--from / --to are for a video; this is a photo")); }
    if let (Some(a), Some(b)) = (o.from, o.to) { if b <= a { return Err(invalid(format!("--to ({b}) must come after --from ({a})"))); } }
    let out = o.out.clone().unwrap_or_else(|| default_out(&o.input, video));
    if let Some(d) = out.parent() { if !d.as_os_str().is_empty() { std::fs::create_dir_all(d)?; } }
    if video { run_video(o, out) } else { run_photo(o, out) }
}

// ---------------------------------------------------------------------------------------------------------------------
// the clean-up (pure, no Vision; tested in tests/cutout_tests.rs)

/// A frame's alpha from Vision's masks: `masks` are a window of frames' masks (W×H, 0–255) with this frame in the
/// middle (`masks.len() / 2`); smoothed, specks dropped, the floor applied.
pub fn alpha(masks: &[&[u8]], w: usize, h: usize, floor: f64) -> Vec<u8> {
    let mut a = smooth(masks);
    drop_specks(&mut a, w, h);
    apply_floor(&mut a, floor);
    a
}

/// Smoothing over time, around the middle frame: each neighbour counts (a triangle over the window) only as far as it
/// agrees with this frame (a bilateral weight, σ = 48/255). Boiling soft edges settle; where a limb moved (a jump of
/// most of the range) this frame's value stays, so nothing ghosts, lags or gets holes.
pub fn smooth(masks: &[&[u8]]) -> Vec<u8> {
    let c = masks.len() / 2;
    let cur = masks[c];
    if masks.len() < 2 { return cur.to_vec(); }
    let sim: Vec<f32> = (0..256).map(|d| { let x = d as f32 / 48.; (-x * x).exp() }).collect();
    let tri: Vec<f32> = (0..masks.len()).map(|j| (c + 1) as f32 - (j as f32 - c as f32).abs()).collect();
    let mut out = vec![0u8; cur.len()];
    for (i, o) in out.iter_mut().enumerate() {
        let v0 = cur[i];
        let (mut s, mut ws) = (0f32, 0f32);
        for (j, m) in masks.iter().enumerate() {
            let v = m[i];
            let w = tri[j] * sim[(v as i32 - v0 as i32).unsigned_abs() as usize];
            s += w * v as f32;
            ws += w;
        }
        *o = (s / ws).round().clamp(0., 255.) as u8;
    }
    out
}

/// Drop islands of alpha far smaller than the largest (stray lights, a sign's fragment): on a ¼-size grid, regions
/// connected above 60/255 smaller than 2 % of the largest are cleared, with their soft rim. Returns how many went.
/// (A second person, or a hand apart from her, is much more than 2 % and stays.)
pub fn drop_specks(a: &mut [u8], w: usize, h: usize) -> usize {
    const S: usize = 4;
    let (gw, gh) = (w.div_ceil(S), h.div_ceil(S));
    let mut on = vec![false; gw * gh];
    for gy in 0..gh {
        for gx in 0..gw {
            let mut m = 0u8;
            for y in gy * S..((gy + 1) * S).min(h) { for x in gx * S..((gx + 1) * S).min(w) { m = m.max(a[y * w + x]); } }
            on[gy * gw + gx] = m > 60;
        }
    }
    let mut lab = vec![0u32; gw * gh];
    let mut sizes = vec![0usize];
    let mut q = Vec::new();
    for s in 0..gw * gh {
        if !on[s] || lab[s] != 0 { continue; }
        let id = sizes.len() as u32;
        lab[s] = id;
        q.push(s);
        let mut n = 0;
        while let Some(p) = q.pop() {
            n += 1;
            let (x, y) = (p % gw, p / gw);
            let mut go = |np: usize| if on[np] && lab[np] == 0 { lab[np] = id; q.push(np); };
            if x > 0 { go(p - 1); }
            if x + 1 < gw { go(p + 1); }
            if y > 0 { go(p - gw); }
            if y + 1 < gh { go(p + gw); }
        }
        sizes.push(n);
    }
    if sizes.len() <= 2 { return 0; }
    let big = sizes.iter().copied().max().unwrap_or(0);
    let keep: Vec<bool> = sizes.iter().map(|&n| n * 50 >= big).collect();
    let dropped = keep.iter().skip(1).filter(|k| !**k).count();
    if dropped == 0 { return 0; }
    // a cell is cleared when a dropped island is within one cell of it and no kept one is
    let near = |gx: usize, gy: usize, kept: bool| -> bool {
        for y in gy.saturating_sub(1)..(gy + 2).min(gh) {
            for x in gx.saturating_sub(1)..(gx + 2).min(gw) { let l = lab[y * gw + x]; if l != 0 && keep[l as usize] == kept { return true; } }
        }
        false
    };
    for gy in 0..gh {
        for gx in 0..gw {
            if near(gx, gy, false) && !near(gx, gy, true) {
                for y in gy * S..((gy + 1) * S).min(h) { for x in gx * S..((gx + 1) * S).min(w) { a[y * w + x] = 0; } }
            }
        }
    }
    dropped
}

/// Alpha under `floor` (0–1) becomes 0; above it is stretched back to the full range, so the edge stays continuous.
pub fn apply_floor(a: &mut [u8], floor: f64) {
    if floor <= 0. { return; }
    let f = floor * 255.;
    let lut: Vec<u8> = (0..256).map(|v| (((v as f64 - f) / (255. - f)).clamp(0., 1.) * 255.).round() as u8).collect();
    for v in a.iter_mut() { *v = lut[*v as usize]; }
}

/// Box mean of a plane over a (2r+1)² square, edges clamped (a summed-area table).
fn box_mean(p: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut sat = vec![0f64; (w + 1) * (h + 1)];
    for y in 0..h {
        let mut row = 0f64;
        for x in 0..w { row += p[y * w + x] as f64; sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row; }
    }
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        let (y0, y1) = (y.saturating_sub(r), (y + r + 1).min(h));
        for x in 0..w {
            let (x0, x1) = (x.saturating_sub(r), (x + r + 1).min(w));
            let s = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
            out[y * w + x] = (s / ((y1 - y0) * (x1 - x0)) as f64) as f32;
        }
    }
    out
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 { let t = ((x - a) / (b - a)).clamp(0., 1.); t * t * (3. - 2. * t) }
fn luma(c: [f32; 3]) -> f32 { 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] }

/// Decontaminate her edge, in place on straight RGBA (alpha already final). Near each edge pixel two colours are
/// measured: hers (pixels well inside) and the background's (pixels well outside). A soft edge pixel is a mix of the
/// two, so the background's share is taken back out (and the faintest lean on her colour); an opaque pixel on her
/// outline that looks more like a coloured background than like her (neon spilled on hair) keeps its brightness but
/// takes her colour. Transparent pixels become black.
pub fn defringe(px: &mut [u8], w: usize, h: usize) {
    let n = w * h;
    let a: Vec<f32> = (0..n).map(|i| px[i * 4 + 3] as f32 / 255.).collect();
    // wide enough to reach past a soft edge to clean pixels on both sides
    let r = ((w.max(h) as f32 / 60.).round() as usize).clamp(8, 32);
    let a2 = box_mean(&a, w, h, 2);
    let a3 = box_mean(&a, w, h, 3);
    let inner: Vec<f32> = a2.iter().map(|&m| if m >= 0.99 { 1. } else { 0. }).collect();
    let outer: Vec<f32> = a2.iter().map(|&m| if m <= 0.01 { 1. } else { 0. }).collect();
    let wi = box_mean(&inner, w, h, r);
    let wo = box_mean(&outer, w, h, r);
    let mut fin: [Vec<f32>; 3] = Default::default();
    let mut bg: [Vec<f32>; 3] = Default::default();
    for c in 0..3 {
        let ci: Vec<f32> = (0..n).map(|i| px[i * 4 + c] as f32 * inner[i]).collect();
        let co: Vec<f32> = (0..n).map(|i| px[i * 4 + c] as f32 * outer[i]).collect();
        fin[c] = box_mean(&ci, w, h, r);
        bg[c] = box_mean(&co, w, h, r);
    }
    let dist = |p: [f32; 3], q: [f32; 3]| ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2) + (p[2] - q[2]).powi(2)).sqrt();
    for i in 0..n {
        let al = a[i];
        if al <= 0. { px[i * 4] = 0; px[i * 4 + 1] = 0; px[i * 4 + 2] = 0; continue; }
        if a3[i] >= 0.999 { continue; } // well inside
        let c = [px[i * 4] as f32, px[i * 4 + 1] as f32, px[i * 4 + 2] as f32];
        let (has_in, has_bg) = (wi[i] > 1e-3, wo[i] > 1e-3);
        let f_in = if has_in { [fin[0][i] / wi[i], fin[1][i] / wi[i], fin[2][i] / wi[i]] } else { c };
        let b = if has_bg { [bg[0][i] / wo[i], bg[1][i] / wo[i], bg[2][i] / wo[i]] } else { c };
        let chroma = |p: [f32; 3]| p.iter().cloned().fold(f32::MIN, f32::max) - p.iter().cloned().fold(f32::MAX, f32::min);
        let mut o = c;
        let mut like_bg = 0f32;
        if al < 0.999 {
            // c = α·F + (1-α)·B  →  F
            if has_bg {
                let mut u = [0f32; 3];
                for k in 0..3 { u[k] = ((c[k] - (1. - al) * b[k]) / al.max(0.05)).clamp(0., 255.); }
                // trusted only when it lands nearer her colour than the pixel was (where the background guess is
                // wrong, e.g. a hole in her, unmixing would invent a colour)
                if !has_in || dist(u, f_in) <= dist(c, f_in) { o = u; }
            }
            if has_in { let t = smoothstep(0.1, 0.6, al); for k in 0..3 { o[k] = f_in[k] + (o[k] - f_in[k]) * t; } }
        } else if has_bg {
            // spill: closer to a coloured background than to her
            let (db, df) = (dist(c, b), dist(c, f_in));
            like_bg = ((df - db) / (df + db + 1.)).clamp(0., 1.) * (chroma(b) / (chroma(b) + 30.));
        }
        if has_in {
            // or far more saturated than she is around here, in another colour: a neon letter behind her caught in her
            // outline (the background average can't say, when the background is blue light and red lettering)
            let df = dist(o, f_in);
            let neon = ((chroma(o) - chroma(f_in) - 20.) / 60.).clamp(0., 1.) * ((df - 40.) / 80.).clamp(0., 1.);
            // on her outline only, fading out ~3 px in
            let s = like_bg.max(neon) * ((1. - a3[i]) * 5.).min(1.);
            if s > 0. {
                let shift = luma(o) - luma(f_in);
                for k in 0..3 { let t = (f_in[k] + shift).clamp(0., 255.); o[k] += (t - o[k]) * s; }
            }
        }
        for k in 0..3 { px[i * 4 + k] = o[k].round().clamp(0., 255.) as u8; }
    }
}

/// One finished frame: `rgba` (the source; its alpha ignored) with `alpha`, defringed. Straight (not premultiplied) RGBA.
pub fn finish(rgba: &[u8], alpha: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut px = rgba.to_vec();
    for (i, &a) in alpha.iter().enumerate() { px[i * 4 + 3] = a; }
    defringe(&mut px, w, h);
    px
}

/// Straight RGBA over a grey checkerboard (16 px squares) → RGB.
pub fn over_checker(px: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let bgv = if ((x / 16) + (y / 16)) % 2 == 0 { 204. } else { 153. };
            let a = px[i * 4 + 3] as f32 / 255.;
            for k in 0..3 { out[i * 3 + k] = (px[i * 4 + k] as f32 * a + bgv * (1. - a)).round() as u8; }
        }
    }
    out
}

/// Mean alpha as a share of full, 0–1.
pub fn mean_alpha(a: &[u8]) -> f64 { a.iter().map(|&v| v as u64).sum::<u64>() as f64 / (a.len().max(1) as f64 * 255.) }

fn partial(out: &Path) -> PathBuf {
    let name = out.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    out.with_file_name(format!(".{name}.partial"))
}

fn flag_notes(o: &Options, one: u32, none: u32, frames: u32) -> Vec<String> {
    let mut v = vec![];
    if o.keep_text { v.push("--keep-text: Vision's foreground mask alone (background text and signs kept)".into()); }
    if one > 0 && !o.keep_text { v.push(format!("{one} of {frames} frame(s): no foreground instance found, the person mask alone (signs behind her may show)")); }
    if none > 0 { v.push(format!("{none} of {frames} frame(s): nobody found (left transparent)")); }
    v
}

// ---------------------------------------------------------------------------------------------------------------------
// a photo

fn run_photo(o: &Options, out: PathBuf) -> Result<Report, ProjectError> {
    let mut c = Command::new(binary()?);
    c.arg("photo").arg(&o.input);
    if o.keep_text { c.arg("--keep-text"); }
    let r = c.output()?;
    if !r.status.success() { return Err(invalid(format!("{}: {}", o.input.display(), String::from_utf8_lossy(&r.stderr).trim()))); }
    let b = &r.stdout;
    if b.len() < 8 { return Err(invalid("the cut-out helper said nothing")); }
    let w = u32::from_le_bytes(b[0..4].try_into().unwrap()) as usize;
    let h = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize;
    if b.len() != 8 + w * h * 5 + 1 { return Err(invalid("the cut-out helper's answer was the wrong size")); }
    let rgba = &b[8..8 + w * h * 4];
    let flag = b[8 + w * h * 4];
    let mut a = b[8 + w * h * 4 + 1..].to_vec();
    let specks = drop_specks(&mut a, w, h);
    apply_floor(&mut a, o.floor);
    let px = finish(rgba, &a, w, h);
    let tmp = partial(&out);
    image::save_buffer_with_format(&tmp, &px, w as u32, h as u32, image::ColorType::Rgba8, image::ImageFormat::Png).map_err(|e| invalid(e.to_string()))?;
    std::fs::rename(&tmp, &out)?;
    let mut notes = flag_notes(o, (flag == 1) as u32, (flag == 2) as u32, 1);
    if specks > 0 { notes.push(format!("{specks} speck(s) apart from her dropped")); }
    if o.preview {
        let p = out.with_extension("preview.png");
        image::save_buffer_with_format(&p, &over_checker(&px, w, h), w as u32, h as u32, image::ColorType::Rgb8, image::ImageFormat::Png).map_err(|e| invalid(e.to_string()))?;
        notes.push(format!("preview: {}", p.display()));
    }
    Ok(Report { out, frames: 1, width: w as u32, height: h as u32, coverage: mean_alpha(&a), notes })
}

// ---------------------------------------------------------------------------------------------------------------------
// a video

struct Probe { w: usize, h: usize, rate: String, fps: f64 }

fn probe(file: &Path) -> Result<Probe, ProjectError> {
    let o = Command::new("ffprobe").args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:stream_side_data=rotation", "-of", "json"])
        .arg(file).env("PATH", login_path()).output().map_err(|e| invalid(format!("ffprobe: {e} (install ffmpeg)")))?;
    if !o.status.success() { return Err(invalid(format!("{}: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    let j: serde_json::Value = serde_json::from_slice(&o.stdout).map_err(|e| invalid(e.to_string()))?;
    let s = j["streams"].get(0).ok_or_else(|| invalid(format!("{}: no video stream", file.display())))?;
    let (mut w, mut h) = (s["width"].as_u64().unwrap_or(0) as usize, s["height"].as_u64().unwrap_or(0) as usize);
    let rot = s["side_data_list"].as_array().and_then(|l| l.iter().find_map(|d| d["rotation"].as_f64())).unwrap_or(0.);
    if (rot.abs().round() as i64) % 180 == 90 { std::mem::swap(&mut w, &mut h); }
    let rate = s["r_frame_rate"].as_str().unwrap_or("30/1").to_string();
    let fps = match rate.split_once('/') { Some((a, b)) => a.parse::<f64>().unwrap_or(30.) / b.parse::<f64>().unwrap_or(1.).max(1e-9), None => rate.parse().unwrap_or(30.) };
    if w == 0 || h == 0 || !(fps > 0.) { return Err(invalid(format!("{}: can't tell its size or frame rate", file.display()))); }
    Ok(Probe { w, h, rate, fps })
}

/// A child killed on drop (a failed run leaves no ffmpeg or helper behind).
struct Kid(Child);
impl Drop for Kid { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }

fn spawn(mut c: Command, what: &str) -> Result<Kid, ProjectError> { c.spawn().map(Kid).map_err(|e| invalid(format!("{what}: {e}"))) }

fn stderr_of(k: &mut Kid) -> String { let mut s = String::new(); if let Some(mut e) = k.0.stderr.take() { let _ = e.read_to_string(&mut s); } s.trim().to_string() }

/// ffmpeg reading raw frames on stdin: ProRes 4444 with alpha, or (the preview) H.264.
fn encoder(out: &Path, w: usize, h: usize, rate: &str, prores: bool) -> Result<Kid, ProjectError> {
    let mut c = Command::new("ffmpeg");
    c.args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", if prores { "rgba" } else { "rgb24" }, "-s", &format!("{w}x{h}"), "-framerate", rate, "-i", "-"]);
    if prores {
        // BT.601 is the matrix ffmpeg converts RGB with by default; say so, so every reader converts back the same way
        c.args(["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-colorspace", "smpte170m", "-color_primaries", "bt709", "-color_trc", "bt709", "-f", "mov"]);
    } else {
        c.args(["-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-f", "mp4"]);
    }
    c.arg(out).env("PATH", login_path()).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
    spawn(c, "ffmpeg (install ffmpeg)")
}

fn close(mut k: Kid, what: &str) -> Result<(), ProjectError> {
    drop(k.0.stdin.take());
    let e = stderr_of(&mut k);
    if !k.0.wait()?.success() { return Err(invalid(format!("{what}: {e}"))); }
    Ok(())
}

fn run_video(o: &Options, out: PathBuf) -> Result<Report, ProjectError> {
    let p = probe(&o.input)?;
    let (w, h) = (p.w, p.h);
    let first = (o.from.unwrap_or(0.).max(0.) * p.fps).round() as u64;
    let count = o.to.map(|t| ((t * p.fps).round() as u64).saturating_sub(first));
    if count == Some(0) { return Err(invalid("that stretch has no frames")); }
    let bin = binary()?;

    // decode: RGBA frames from `first` (a seek to half a frame before it is frame-accurate), the source's rotation applied
    let mut c = Command::new("ffmpeg");
    c.args(["-v", "error"]);
    if first > 0 { c.args(["-ss", &format!("{:.6}", (first as f64 - 0.5) / p.fps)]); }
    c.arg("-i").arg(&o.input).args(["-an", "-fps_mode", "passthrough"]);
    if let Some(n) = count { c.args(["-frames:v", &n.to_string()]); }
    c.args(["-f", "rawvideo", "-pix_fmt", "rgba", "-"]).env("PATH", login_path()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut dec = spawn(c, "ffmpeg (install ffmpeg)")?;
    let mut dec_out = dec.0.stdout.take().unwrap();

    let mut c = Command::new(&bin);
    c.args(["stream", &w.to_string(), &h.to_string()]);
    if o.keep_text { c.arg("--keep-text"); }
    c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut vis = spawn(c, "the cut-out helper")?;
    // its stderr drained aside (a chatty framework must never fill the pipe and stall it)
    let vis_log = { let mut e = vis.0.stderr.take().unwrap(); std::thread::spawn(move || { let mut s = String::new(); let _ = e.read_to_string(&mut s); s }) };
    let mut vis_in = vis.0.stdin.take().unwrap();
    let mut vis_out = vis.0.stdout.take().unwrap();

    let tmp = partial(&out);
    let mut enc = encoder(&tmp, w, h, &p.rate, true)?;
    let mut enc_in = enc.0.stdin.take().unwrap();
    let prev_path = out.with_extension("preview.mp4");
    let mut prev = if o.preview { Some(encoder(&prev_path, w, h, &p.rate, false)?) } else { None };
    let mut prev_in: Option<ChildStdin> = prev.as_mut().map(|k| k.0.stdin.take().unwrap());

    let radius = if o.smooth >= 2 { (o.smooth / 2) as usize } else { 0 };
    let fsz = w * h * 4;
    // the frames in flight, (rgba, mask); frame k is at win[k - base]
    let mut win: VecDeque<(Vec<u8>, Vec<u8>)> = VecDeque::new();
    let (mut base, mut next, mut decoded) = (0usize, 0usize, 0usize);
    let (mut one, mut none, mut specks, mut cover) = (0u32, 0u32, 0usize, 0f64);

    // write out frame i, its masks' window clamped to the frames there are
    let mut emit = |win: &VecDeque<(Vec<u8>, Vec<u8>)>, base: usize, i: usize, last: usize, enc_in: &mut ChildStdin, prev_in: &mut Option<ChildStdin>| -> Result<(), ProjectError> {
        let masks: Vec<&[u8]> = (0..=2 * radius).map(|k| win[(i + k).saturating_sub(radius).min(last).max(base) - base].1.as_slice()).collect();
        let mut a = smooth(&masks);
        specks += drop_specks(&mut a, w, h);
        apply_floor(&mut a, o.floor);
        cover += mean_alpha(&a);
        let px = finish(&win[i - base].0, &a, w, h);
        enc_in.write_all(&px).map_err(|e| invalid(format!("ffmpeg (encode): {e}")))?;
        if let Some(pi) = prev_in.as_mut() { pi.write_all(&over_checker(&px, w, h)).map_err(|e| invalid(format!("ffmpeg (preview): {e}")))?; }
        Ok(())
    };

    let mut frame = vec![0u8; fsz];
    loop {
        let mut got = 0;
        while got < fsz { match dec_out.read(&mut frame[got..])? { 0 => break, n => got += n } }
        if got == 0 { break; }
        if got < fsz { return Err(invalid("ffmpeg's last frame was cut short")); }
        let mut m = vec![0u8; 1 + w * h];
        if vis_in.write_all(&frame).is_err() || vis_out.read_exact(&mut m).is_err() {
            drop(vis);
            return Err(invalid(format!("the cut-out helper stopped: {}", vis_log.join().unwrap_or_default().trim())));
        }
        match m[0] { 1 => one += 1, 2 => none += 1, _ => {} }
        m.remove(0);
        win.push_back((frame.clone(), m));
        decoded += 1;
        // frame `next` is ready once `next + radius` has its mask
        while next + radius < decoded {
            emit(&win, base, next, decoded - 1, &mut enc_in, &mut prev_in)?;
            next += 1;
            while base + radius < next { win.pop_front(); base += 1; }
        }
    }
    let e = stderr_of(&mut dec);
    if !dec.0.wait()?.success() { return Err(invalid(format!("ffmpeg (decode): {e}"))); }
    if decoded == 0 { return Err(invalid("no frames in that stretch")); }
    while next < decoded {
        emit(&win, base, next, decoded - 1, &mut enc_in, &mut prev_in)?;
        next += 1;
    }
    drop(vis_in);
    drop(enc_in);
    if let Err(e) = close(enc, "ffmpeg (encode)") { let _ = std::fs::remove_file(&tmp); return Err(e); }
    std::fs::rename(&tmp, &out)?;
    let mut notes = flag_notes(o, one, none, decoded as u32);
    if radius > 0 { notes.push(format!("smoothed over {} frames", 2 * radius + 1)); }
    if specks > 0 { notes.push(format!("{specks} speck(s) apart from her dropped (over all frames)")); }
    notes.push(format!("{} fps, from frame {first} ({:.3} s)", p.rate, first as f64 / p.fps));
    if let Some(k) = prev { drop(prev_in); close(k, "ffmpeg (preview)")?; notes.push(format!("preview: {}", prev_path.display())); }
    Ok(Report { out, frames: decoded as u32, width: w as u32, height: h as u32, coverage: cover / decoded as f64, notes })
}
