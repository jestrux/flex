//! An asset on its own, the way the source viewer shows it (and `flex assets --preview` writes it for an agent):
//! - audio: its peaks (`waveform::peaks`, the song as it is, not through the edit) and its words where a transcription
//!   exists (`flex music`'s .music.json/.lyrics.json beside the track, or Flex's `transcribe` cache), as a sheet image;
//! - a take or version: its frames with their times (events.json), or a proxy mp4 on the take's own clock (t = 0 is
//!   the recording's start), encoded once by ffmpeg into `<support>/assets/takes/`;
//! - a card: a clip (or a still) rendered alone with its sample params by `flex card`, cached in `<support>/assets/cards/`
//!   by the card, its params and the look's and cards' stamps;
//! - a still: the image with its element boxes drawn;
//! - a render or a lab's render: a still from it.
//!
//! Measurement and mechanics only: nothing here picks a version or a moment worth showing (a card's still is its middle).

use super::{read_json, Asset, Kind};
use crate::project::{login_path, support_dir, ProjectError};
use crate::transcribe::Word;
use resvg::{tiny_skia as sk, usvg};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, OnceLock};

fn err(m: impl Into<String>) -> ProjectError { ProjectError::Invalid(m.into()) }

fn cache(sub: &str, key: impl Hash, ext: &str) -> Result<PathBuf, ProjectError> {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut h);
    let d = support_dir().join("assets").join(sub);
    std::fs::create_dir_all(&d)?;
    Ok(d.join(format!("{:016x}.{ext}", h.finish())))
}

fn stamp(p: &Path) -> (u64, Option<std::time::SystemTime>) {
    let m = std::fs::metadata(p).ok();
    (m.as_ref().map(|m| m.len()).unwrap_or(0), m.and_then(|m| m.modified().ok()))
}

// ---- audio

/// Peaks (0–1) of an audio file as it is, `per_second` bins a second (cached by `waveform`).
pub fn peaks(file: &Path, per_second: u32) -> Result<Vec<f32>, ProjectError> { crate::waveform::peaks(file, &[], per_second) }

/// Words `flex transcribe` already heard in this whole file (Flex's `<support>/words/` cache), if any.
pub fn cached_words(file: &Path) -> Option<Vec<Word>> {
    // the same key as transcribe::run_many
    let m = std::fs::metadata(file).ok();
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (file, m.as_ref().map(|m| m.len()), m.and_then(|m| m.modified().ok())).hash(&mut h);
    let w: Vec<Word> = serde_json::from_str(&std::fs::read_to_string(support_dir().join("words").join(format!("{:016x}.json", h.finish()))).ok()?).ok()?;
    (!w.is_empty()).then_some(w)
}

fn to_words(v: &[serde_json::Value]) -> Vec<Word> {
    v.iter().filter_map(|w| Some(Word {
        word: w["word"].as_str()?.trim().to_string(), start: w["start"].as_f64()?, end: w["end"].as_f64()?,
        line: w["line"].as_u64().unwrap_or(0) as u32, at: w["at"].as_str().map(String::from),
    })).collect()
}

/// An audio asset's words with their times (seconds into the file), where a transcription exists.
pub fn words(dir: &Path, a: &Asset) -> Vec<Word> {
    let Some(file) = a.file.as_deref() else { return vec![] };
    match a.kind {
        Kind::Music => super::track_words(file).map(|w| to_words(&w)).or_else(|| cached_words(file)).unwrap_or_default(),
        // the lead vocal's: the track's words (heard in this stem, on the same clock)
        Kind::Stem if a.facts.words.is_some() => {
            let manifest = read_json(&dir.join("audio.json")).unwrap_or_default();
            manifest["music"].as_object().into_iter().flat_map(|m| m.values())
                .filter_map(|m| m["file"].as_str()).map(|f| dir.join(f))
                .find_map(|t| super::track_words(&t)).map(|w| to_words(&w)).unwrap_or_default()
        }
        _ if a.kind.is_audio() => cached_words(file).unwrap_or_default(),
        _ => vec![],
    }
}

// ---- takes

/// A take folder's frames: (ms into the take, file), from its events.json.
pub fn take_frames(folder: &Path) -> Vec<(f64, PathBuf)> {
    let Some(ev) = read_json(&folder.join("events.json")) else { return vec![] };
    ev["frames"].as_array().map(|a| a.iter().filter_map(|f| Some((f["t"].as_f64()?, folder.join("frames").join(f["file"].as_str()?)))).collect()).unwrap_or_default()
}

/// The folder a take or version asset plays from.
pub fn take_folder(dir: &Path, a: &Asset) -> Option<PathBuf> {
    matches!(a.kind, Kind::Take | Kind::TakeVersion).then(|| dir.join(&a.id))
}

/// A take folder as an mp4 on its own clock, `width` wide (each frame held until the next; the first from t = 0).
/// Encoded once (a few seconds for a 3× take) and cached by the folder and its events.json.
pub fn take_proxy(folder: &Path, width: u32) -> Result<PathBuf, ProjectError> {
    let ev = folder.join("events.json");
    let out = cache("takes", (folder, stamp(&ev), width, 3u8), "mp4")?;
    if out.is_file() { return Ok(out); }
    let frames = take_frames(folder);
    if frames.is_empty() { return Err(err(format!("{} has no frames in its events.json", folder.display()))); }
    let total = read_json(&ev).and_then(|v| v["duration"].as_f64()).unwrap_or(frames.last().unwrap().0 + 100.0);
    // the concat demuxer: each frame for as long as it showed
    let mut list = String::from("ffconcat version 1.0\n");
    let q = |p: &Path| p.to_string_lossy().replace('\'', "'\\''");
    for (i, (t, f)) in frames.iter().enumerate() {
        let start = if i == 0 { 0.0 } else { *t };
        let end = frames.get(i + 1).map(|x| x.0).unwrap_or(total.max(t + 33.0));
        list.push_str(&format!("file '{}'\nduration {:.4}\n", q(f), ((end - start) / 1000.0).max(0.001)));
    }
    let tmp_list = out.with_extension("txt");
    std::fs::write(&tmp_list, list)?;
    let tmp = out.with_extension("tmp.mp4");
    let o = Command::new("ffmpeg").env("PATH", login_path())
        .args(["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i"]).arg(&tmp_list)
        // the last frame held (tpad) until -t ends the clip where the take ends
        .args(["-vf", &format!("scale={width}:-2:flags=lanczos,fps=30,tpad=stop_mode=clone:stop_duration=5"), "-t", &format!("{:.3}", total / 1000.0), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart"]).arg(&tmp)
        .output().map_err(|e| ProjectError::Run(format!("ffmpeg: {e}")))?;
    let _ = std::fs::remove_file(&tmp_list);
    if !o.status.success() { return Err(ProjectError::Run(format!("ffmpeg couldn't encode {}: {}", folder.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    std::fs::rename(&tmp, &out)?;
    Ok(out)
}

// ---- cards

fn card_cmd(dir: &Path, card: &str, params: Option<&str>, args: &[&str], out: &Path) -> Result<(), ProjectError> {
    let mut a: Vec<String> = vec![card.into()];
    if let Some(p) = params { a.push("--params".into()); a.push(p.into()); }
    a.extend(args.iter().map(|s| s.to_string()));
    a.push("-o".into()); a.push(out.to_string_lossy().into_owned());
    a.push("--json".into());
    let o = crate::tools::card(dir, &a)?.stdin(std::process::Stdio::null()).output()?;
    let text = String::from_utf8_lossy(&o.stdout);
    let res: serde_json::Value = text.lines().rev().find(|l| l.starts_with('{')).and_then(|l| serde_json::from_str(l).ok()).unwrap_or_default();
    if res["ok"] != serde_json::Value::Bool(true) || !out.is_file() {
        let why = res["error"].as_str().map(String::from)
            .unwrap_or_else(|| String::from_utf8_lossy(&o.stderr).lines().rev().take(4).collect::<Vec<_>>().join("\n"));
        return Err(ProjectError::Run(format!("flex card {card}: {why}")));
    }
    Ok(())
}

/// A card alone as a clip, `width` wide, with these params (its defaults when None), `dur_s` long (its own length when
/// None). Cached.
pub fn card_clip(dir: &Path, card: &str, params: Option<&str>, dur_s: Option<f64>, width: u32) -> Result<PathBuf, ProjectError> {
    let ms = dur_s.map(|d| (d * 1000.0).round() as u64);
    let out = cache("cards", (dir, card, params, ms, width, super::cards::stamp(dir), "clip"), "mp4")?;
    if out.is_file() { return Ok(out); }
    let tmp = out.with_extension("tmp.mp4");
    let w = width.to_string();
    let ms_s = ms.map(|m| m.to_string());
    let mut args = vec!["--width", w.as_str()];
    if let Some(m) = &ms_s { args.extend(["--dur", m.as_str()]); }
    card_cmd(dir, card, params, &args, &tmp)?;
    std::fs::rename(&tmp, &out)?;
    Ok(out)
}

/// A card alone as a still at `at_ms`, `width` wide. Cached.
pub fn card_still(dir: &Path, card: &str, params: Option<&str>, at_ms: f64, width: u32) -> Result<PathBuf, ProjectError> {
    let out = cache("cards", (dir, card, params, width, super::cards::stamp(dir), at_ms.to_bits()), "png")?;
    if out.is_file() { return Ok(out); }
    let tmp = out.with_extension("tmp.png");
    card_cmd(dir, card, params, &["--width", &width.to_string(), "--at", &format!("{}", at_ms.round())], &tmp)?;
    std::fs::rename(&tmp, &out)?;
    Ok(out)
}

/// Is a picture one flat colour (a card that draws nothing with its sample params)? A measurement for the tile's label.
pub fn is_blank(image: &Path) -> bool {
    let Ok(im) = image::open(image) else { return false };
    let im = im.thumbnail(64, 64).to_rgb8();
    let first = im.get_pixel(0, 0).0;
    im.pixels().all(|p| p.0.iter().zip(first).all(|(a, b)| a.abs_diff(b) <= 3))
}

// ---- video

/// A still from a video at `at` seconds, `width` wide. Cached by the file's stamp.
pub fn video_still(file: &Path, at: f64, width: u32) -> Result<PathBuf, ProjectError> {
    let out = cache("thumbs", (file, stamp(file), at.to_bits(), width), "jpg")?;
    if out.is_file() { return Ok(out); }
    let tmp = out.with_extension("tmp.jpg");
    let o = Command::new("ffmpeg").env("PATH", login_path())
        .args(["-v", "error", "-y", "-ss", &format!("{at:.3}"), "-i"]).arg(file)
        .args(["-frames:v", "1", "-vf", &format!("scale={width}:-2"), "-q:v", "3"]).arg(&tmp)
        .output().map_err(|e| ProjectError::Run(format!("ffmpeg: {e}")))?;
    if !o.status.success() || !tmp.is_file() { return Err(ProjectError::Run(format!("ffmpeg couldn't read {}: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    std::fs::rename(&tmp, &out)?;
    Ok(out)
}

// ---- thumbnails

/// The picture for an asset's tile: the image itself, a take's first frame, a still from a render, a card's middle.
/// None for audio (the tile draws its peaks) and for what has no picture (a look, an animation piece).
/// A card's runs the pipeline (1–2 s, then cached).
pub fn thumbnail(dir: &Path, a: &Asset, width: u32) -> Result<Option<PathBuf>, ProjectError> {
    Ok(match a.kind {
        Kind::Freeze | Kind::Still | Kind::Image | Kind::Take | Kind::TakeVersion => a.file.clone().filter(|f| f.is_file()),
        // a sketch may be an SVG: drawn to a PNG (crate::script, cached by content)
        Kind::Sketch => match a.file.as_deref().filter(|f| f.is_file()) {
            Some(f) if f.extension().is_some_and(|x| x.eq_ignore_ascii_case("svg")) => Some(crate::script::panel_png(dir, &a.id, width)?),
            f => f.map(Path::to_path_buf),
        },
        Kind::Render => Some(video_still(a.file.as_deref().ok_or_else(|| err("no file"))?, 0.5, width)?),
        Kind::Lab => match a.files.iter().find(|f| f.extension().is_some_and(|x| x == "mp4")) { Some(r) => Some(video_still(r, 0.5, width)?), None => None },
        Kind::Card => match &a.facts.card_type {
            Some(t) => Some(card_still(dir, t, a.facts.params.as_deref(), (a.facts.duration.unwrap_or(2.0) * 500.0).round(), width)?),
            None => None,
        },
        _ => None,
    })
}

// ---- sheets: what an agent reads instead of listening or watching

fn fontdb() -> Arc<usvg::fontdb::Database> {
    static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| { let mut db = usvg::fontdb::Database::new(); db.load_system_fonts(); Arc::new(db) }).clone()
}

fn esc(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;") }

fn render_svg(svg: &str, out: &Path) -> Result<(), ProjectError> {
    let mut opt = usvg::Options::default();
    opt.fontdb = fontdb();
    let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| err(format!("sheet: {e}")))?;
    let (w, h) = (tree.size().width().ceil() as u32, tree.size().height().ceil() as u32);
    let mut px = sk::Pixmap::new(w, h).ok_or_else(|| err("sheet: bad size"))?;
    px.fill(sk::Color::from_rgba8(18, 18, 20, 255));
    resvg::render(&tree, sk::Transform::identity(), &mut px.as_mut());
    crate::paint::save(&px, out, 90).map_err(err)
}

/// An audio file as a picture: its peaks over seconds, and its words at their times (in rows so they don't collide).
pub fn audio_sheet(file: &Path, words: &[Word], title: &str, out: &Path) -> Result<(), ProjectError> {
    const W: f64 = 1920.0;
    const H: f64 = 610.0;
    let dur = super::media::audio_duration(file).ok_or_else(|| err(format!("can't read {}'s length", file.display())))?;
    let per_second = ((1800.0 / dur.max(0.01)).ceil() as u32).clamp(1, 1000);
    let p = peaks(file, per_second)?;
    let (x0, x1, mid, amp) = (60.0, W - 40.0, 260.0, 150.0);
    let x = |t: f64| x0 + (t / dur.max(0.001)) * (x1 - x0);
    let mut s = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="Helvetica" font-size="15">"##);
    s.push_str(&format!(r##"<text x="{x0}" y="40" fill="#eee" font-size="22">{} · {:.2} s</text>"##, esc(title), dur));
    // seconds
    let step = [0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0].into_iter().find(|s| dur / s <= 24.0).unwrap_or(120.0);
    let mut t = 0.0;
    while t <= dur + 1e-6 {
        s.push_str(&format!(r##"<line x1="{0:.1}" y1="80" x2="{0:.1}" y2="440" stroke="#333"/><text x="{0:.1}" y="465" fill="#888" text-anchor="middle">{1}</text>"##, x(t), if step < 1.0 { format!("{t:.2}") } else { format!("{t:.0}") }));
        t += step;
    }
    // peaks
    let mut d = String::new();
    for (i, v) in p.iter().enumerate() {
        let (a, b) = (x(i as f64 / per_second as f64), x((i + 1) as f64 / per_second as f64));
        let hgt = (*v as f64 * amp).max(0.5);
        d.push_str(&format!("M{a:.1} {:.1}H{:.1}V{:.1}H{a:.1}Z", mid - hgt, b.max(a + 0.6), mid + hgt));
    }
    s.push_str(&format!(r##"<path d="{d}" fill="#5aa9e6"/>"##));
    // words: a tick each at its time and length; its label in the first of four rows with room, else left out (the
    // CLI prints every word beside the sheet)
    let mut ends = [f64::MIN; 4];
    for w in words {
        let wx = x(w.start);
        s.push_str(&format!(r##"<rect x="{wx:.1}" y="{:.1}" width="{:.1}" height="4" fill="#e6b85a"/>"##, mid + amp + 4.0, (x(w.end) - wx).max(1.5)));
        let Some(row) = (0..4).find(|r| ends[*r] < wx) else { continue };
        ends[row] = wx + 8.6 * w.word.chars().count() as f64 + 10.0;
        s.push_str(&format!(r##"<text x="{wx:.1}" y="{:.1}" fill="#e6b85a">{}</text>"##, 495.0 + row as f64 * 26.0, esc(&w.word)));
    }
    if words.is_empty() { s.push_str(&format!(r##"<text x="{x0}" y="510" fill="#777">no transcription</text>"##)); }
    s.push_str("</svg>");
    render_svg(&s, out)
}

/// A still with its element boxes (`.boxes.json`, CSS px × dpr) drawn and named; at most 1920 wide.
pub fn still_sheet(image: &Path, boxes: Option<&Path>, out: &Path) -> Result<(), ProjectError> {
    let (iw, ih) = super::media::image_size(image).ok_or_else(|| err(format!("can't read {}", image.display())))?;
    let k = (1920.0 / iw as f64).min(1.0);
    let (w, h) = (iw as f64 * k, ih as f64 * k);
    let href = esc(&image.to_string_lossy());
    let mut s = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w:.0}" height="{h:.0}" font-family="Helvetica" font-size="18"><image href="{href}" xlink:href="{href}" width="{w:.0}" height="{h:.0}"/>"##);
    if let Some(v) = boxes.and_then(read_json) {
        let dpr = v["dpr"].as_f64().unwrap_or(1.0) * k;
        for (name, b) in v["boxes"].as_object().into_iter().flatten() {
            let (Some(bx), Some(by), Some(bw), Some(bh)) = (b["x"].as_f64(), b["y"].as_f64(), b["w"].as_f64(), b["h"].as_f64()) else { continue };
            s.push_str(&format!(r##"<rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="#ff3b8d" stroke-width="3"/><rect x="{:.1}" y="{:.1}" width="{:.1}" height="24" fill="#ff3b8d"/><text x="{:.1}" y="{:.1}" fill="#fff">{}</text>"##,
                bx * dpr, by * dpr, bw * dpr, bh * dpr, bx * dpr, (by * dpr - 24.0).max(0.0), 10.0 + 9.5 * name.chars().count() as f64,
                bx * dpr + 5.0, (by * dpr - 24.0).max(0.0) + 18.0, esc(name)));
        }
    }
    s.push_str("</svg>");
    render_svg(&s, out)
}

/// A still's element boxes in its own pixels (`.boxes.json` is CSS px; × its dpr): (name, x, y, w, h).
pub fn boxes(file: &Path) -> Vec<(String, f64, f64, f64, f64)> {
    let Some(v) = read_json(file) else { return vec![] };
    let dpr = v["dpr"].as_f64().unwrap_or(1.0);
    v["boxes"].as_object().into_iter().flatten().filter_map(|(name, b)| Some((name.clone(),
        b["x"].as_f64()? * dpr, b["y"].as_f64()? * dpr, b["w"].as_f64()? * dpr, b["h"].as_f64()? * dpr))).collect()
}

// ---- the CLI's preview: an asset written as a file

fn ext(p: &Path) -> String { p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase() }

fn copy_as(src: &Path, out: &Path) -> Result<(), ProjectError> {
    if ext(src) == ext(out) || (matches!(ext(src).as_str(), "jpg" | "jpeg") && matches!(ext(out).as_str(), "jpg" | "jpeg")) {
        std::fs::copy(src, out)?;
    } else {
        image::open(src).map_err(|e| err(e.to_string()))?.save(out).map_err(|e| err(e.to_string()))?;
    }
    Ok(())
}

/// Write an asset's preview to `out`; the extension says what: `.png`/`.jpg` (a picture: a sheet, a still, a frame)
/// or `.mp4` (a take's proxy, a card's clip, a render). `width` for what is rendered (default 1280).
pub fn write(dir: &Path, a: &Asset, out: &Path, width: Option<u32>) -> Result<(), ProjectError> {
    let e = ext(out);
    let picture = matches!(e.as_str(), "png" | "jpg" | "jpeg");
    let video = e == "mp4";
    if !picture && !video { return Err(err("-o: a .png, .jpg or .mp4")); }
    if let Some(d) = out.parent() { if !d.as_os_str().is_empty() { std::fs::create_dir_all(d)?; } }
    let width = width.unwrap_or(1280);
    let file = a.file.as_deref();
    match a.kind {
        k if k.is_audio() => {
            if !picture { return Err(err("audio previews as a picture (-o x.png): its waveform and words")); }
            audio_sheet(file.ok_or_else(|| err("no file"))?, &words(dir, a), &a.title, out)
        }
        Kind::Take | Kind::TakeVersion => {
            let folder = take_folder(dir, a).unwrap();
            if video { std::fs::copy(take_proxy(&folder, width)?, out)?; Ok(()) } else { copy_as(file.ok_or_else(|| err("no frames"))?, out) }
        }
        Kind::Card => {
            let t = a.facts.card_type.as_deref().ok_or_else(|| err(format!("{} registers no card: it is a piece other cards use, with no preview of its own", a.id)))?;
            let p = a.facts.params.as_deref();
            if video { std::fs::copy(card_clip(dir, t, p, a.facts.duration, width)?, out)?; } else { copy_as(&card_still(dir, t, p, (a.facts.duration.unwrap_or(2.0) * 500.0).round(), width)?, out)?; }
            Ok(())
        }
        Kind::Freeze | Kind::Still | Kind::Image => {
            if !picture { return Err(err("an image previews as a picture (-o x.png)")); }
            let f = file.ok_or_else(|| err("no file"))?;
            match &a.facts.boxes { Some(b) => still_sheet(f, Some(b), out), None => copy_as(f, out) }
        }
        Kind::Sketch => {
            if !picture { return Err(err("a sketch previews as a picture (-o x.png)")); }
            copy_as(&thumbnail(dir, a, width)?.ok_or_else(|| err("no file"))?, out)
        }
        Kind::Render | Kind::Lab => {
            let f = if a.kind == Kind::Lab { a.files.iter().find(|f| ext(f) == "mp4").cloned() } else { file.map(Path::to_path_buf) }
                .ok_or_else(|| err(format!("{} has no render yet", a.title)))?;
            if video { std::fs::copy(&f, out)?; Ok(()) } else { copy_as(&video_still(&f, 0.5, width)?, out) }
        }
        _ => Err(err(format!("a {} has no preview of its own (its cards do)", a.kind.name()))),
    }
}
