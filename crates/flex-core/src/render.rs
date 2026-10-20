//! Final renders with Flex's painter: every frame painted in film order and streamed into the encoder (no frame files;
//! a held frame is painted once), with the film's mix, at the pipeline's own encoder settings (x264 CRF 16, AAC 192k).
//! Several times faster than the pipeline's render, which repaints every frame.
//! It refuses when the film uses what Flex's painter can't draw yet (a raster effect, a transition other than a cut):
//! then the pipeline renders it (`flex render`).

use crate::frames::Session;
use crate::paint;
use crate::project::{login_path, ProjectError};
use crate::server::FrameLayers;
use rayon::prelude::*;
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// Why Flex's painter can't render this film (empty: it can).
pub fn blockers(s: &Session) -> Vec<String> {
    let mut b: Vec<String> = s.manifest().warnings.iter().filter(|w| w.contains("transitions")).cloned().collect();
    for sc in &s.manifest().scenes { if sc.items.iter().any(|i| !i.paintable) { b.push(format!("scene {} has items Flex can't paint", sc.id)); } }
    b
}

/// Render `s` at `width` into `out` (an mp4), with `mix` (a WAV of the film's sound). progress(frame, frames).
pub fn render(s: &Session, width: u32, mix: &Path, out: &Path, progress: impl Fn(u32, u32) + Sync) -> Result<Vec<String>, ProjectError> {
    render_range(s, width, mix, out, 0..s.manifest().frames, progress)
}

/// Render frames `range` of `s` (an excerpt for review, with its stretch of `mix`, the whole film's sound).
pub fn render_range(s: &Session, width: u32, mix: &Path, out: &Path, range: std::ops::Range<u32>, progress: impl Fn(u32, u32) + Sync) -> Result<Vec<String>, ProjectError> {
    let m = s.manifest();
    let range = range.start.min(m.frames)..range.end.min(m.frames);
    if range.is_empty() { return Err(ProjectError::Invalid("the range has no frames".into())); }
    let (t0, len) = (range.start as f64 / m.fps as f64, (range.end - range.start) as f64 / m.fps as f64);
    let [fw, fh] = m.size;
    let height = (width as f64 * fh as f64 / fw as f64).round() as u32;
    // written beside `out` and swapped in when complete, so the last good film stays until then
    let tmp = out.with_extension("rendering.mp4");
    let mut ff = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{width}x{height}"), "-r", &m.fps.to_string(), "-i", "-"])
        .args(["-ss", &format!("{t0:.6}")]).arg("-i").arg(mix)
        .args(["-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-aq-mode", "3", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", &format!("{len:.3}")])
        .arg(&tmp).env("PATH", login_path()).stdin(Stdio::piped()).spawn()?;
    let mut stdin = ff.stdin.take().unwrap();
    let mut notes: Vec<String> = vec![];
    // frames in chunks: layers from the server (serial, on their own thread, so the next chunk's are fetched while this
    // one paints), each distinct frame painted once (parallel), written in order. A frame's key is the session's when it
    // has keys, else a hash of its layers.
    let chunk = 48u32;
    let n = range.end - range.start;
    type Fetched = Result<(String, Option<Vec<crate::paint::Layer>>), ProjectError>;
    let (tx, rx) = std::sync::mpsc::sync_channel::<Fetched>(2 * chunk as usize);
    std::thread::scope(|sc| -> Result<(), ProjectError> {
        let r0 = range.clone();
        sc.spawn(move || {
            let mut prev: Option<String> = None;
            for f in r0 {
                let item = match s.key(f) {
                    // a held frame (the same key as the one before): nothing to fetch
                    Some(k) if prev.as_ref() == Some(&k) => Ok((k, None)),
                    known => match s.server.layers(f) {
                        Ok(FrameLayers::Layers(l)) => Ok((known.unwrap_or_else(|| layers_key(&l)), Some(l))),
                        Ok(FrameLayers::Placeholder(why) | FrameLayers::Error(why)) => Err(ProjectError::Invalid(format!("frame {f} can't be painted: {why}"))),
                        Err(e) => Err(e),
                    },
                };
                prev = item.as_ref().ok().map(|(k, _)| k.clone());
                let stop = item.is_err();
                if tx.send(item).is_err() || stop { break; }
            }
        });
        let mut last: HashMap<String, std::sync::Arc<Vec<u8>>> = HashMap::new();
        let mut done = 0u32;
        while done < n {
            let take = chunk.min(n - done);
            let mut order: Vec<String> = vec![];
            let mut todo: Vec<(String, Vec<crate::paint::Layer>)> = vec![];
            for _ in 0..take {
                let (key, layers) = rx.recv().map_err(|_| ProjectError::Run("the frames stopped coming".into()))??;
                if let Some(l) = layers { if !last.contains_key(&key) && !todo.iter().any(|(k, _)| k == &key) { todo.push((key.clone(), l)); } }
                order.push(key);
            }
            let painted: Vec<(String, Result<(Vec<u8>, Vec<String>), String>)> = todo.into_par_iter().map(|(k, l)| {
                let r = paint::paint_in(&l, m.size, width).map(|p| (p.pixmap.data().to_vec(), p.skipped)).map_err(|e| e.to_string());
                (k, r)
            }).collect();
            let mut now: HashMap<String, std::sync::Arc<Vec<u8>>> = HashMap::new();
            for (k, r) in painted {
                let (px, skipped) = r.map_err(ProjectError::Run)?;
                for sk in skipped { if !notes.contains(&sk) { notes.push(sk); } }
                now.insert(k, std::sync::Arc::new(px));
            }
            for (i, k) in order.iter().enumerate() {
                let px = now.get(k).or_else(|| last.get(k)).cloned().ok_or_else(|| ProjectError::Run(format!("frame {} not painted", range.start + done + i as u32)))?;
                stdin.write_all(&px)?;
                now.entry(k.clone()).or_insert(px);
            }
            // keep only what the next chunk can still reuse (a held frame runs on)
            last = now.into_iter().filter(|(k, _)| order.last() == Some(k)).collect();
            done += take;
            progress(done, n);
        }
        Ok(())
    })?;
    drop(stdin);
    if !ff.wait()?.success() { let _ = std::fs::remove_file(&tmp); return Err(ProjectError::Run("ffmpeg couldn't encode the film".into())); }
    std::fs::rename(&tmp, out)?;
    Ok(notes)
}

/// A frame's key from its layers (a render without session keys): equal layers paint equal frames.
fn layers_key(l: &[crate::paint::Layer]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for x in l { match x { crate::paint::Layer::Svg { svg } => svg.hash(&mut h), o => format!("{o:?}").hash(&mut h) } }
    format!("h{:016x}", h.finish())
}

/// What to render with Flex's painter: the whole film, one scene, or a stretch of film seconds (an excerpt for review).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "part", rename_all = "snake_case")]
pub enum Part { Film, Scene { id: String }, Range { from: f64, to: f64 } }

/// What `render_film` wrote.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Rendered { pub out: std::path::PathBuf, pub notes: Vec<String>, pub secs: f64 }

/// Why Flex's painter shouldn't render this film without being told to (`fast`): it has captured takes (the pipeline
/// renders those), or something the painter can't draw (`blockers`). Empty: the painter renders it.
pub fn painter_refuses(s: &Session) -> Vec<String> {
    let mut why = blockers(s);
    if s.manifest().scenes.iter().any(|sc| sc.items.iter().any(|i| i.kind == "take")) { why.push("the film has captured takes".into()); }
    why
}

/// Render `part` of `s`'s film with Flex's painter into ~/Downloads/flex-videos/<project>/ at `size` (1080p by
/// default): the sound mixed, every frame painted and encoded; for the film or a scene, its `.srt` (the narration) and
/// `.credits.txt` beside it. `say` reports a step ("mixing the sound…"); `progress(frames done, frames)`.
pub fn render_film(s: &Session, part: &Part, size: Option<&str>, say: impl Fn(&str), progress: impl Fn(u32, u32) + Sync) -> Result<Rendered, ProjectError> {
    let t0 = std::time::Instant::now();
    let dir = s.dir.clone();
    let m = s.manifest();
    let ((width, _), tag) = crate::project::output_size(crate::project::frame_size(&dir), size).map_err(ProjectError::Invalid)?;
    let film = crate::tools::project_name(&dir);
    let dirout = crate::tools::out_dir(&dir);
    std::fs::create_dir_all(&dirout)?;
    let fps = m.fps as f64;
    let (frames, out, captions) = match part {
        Part::Range { from, to } => {
            if to <= from { return Err(ProjectError::Invalid("the range ends before it starts".into())); }
            let blocked: Vec<String> = m.scenes.iter().filter(|sc| sc.items.iter().any(|i| !i.paintable && i.start < *to && i.end > *from)).map(|sc| sc.id.clone()).collect();
            if !blocked.is_empty() { return Err(ProjectError::Invalid(format!("Flex's painter can't paint scene(s) {} yet: an excerpt needs it", blocked.join(", ")))); }
            ((from * fps).round() as u32..(to * fps).round() as u32, dirout.join(format!("{film}--excerpt-{from:.2}-{to:.2}{tag}.mp4")), false)
        }
        Part::Scene { id } => {
            let sc = m.scenes.iter().find(|x| &x.id == id).ok_or_else(|| ProjectError::Invalid(format!("no scene \"{id}\" (scenes: {})", m.scenes.iter().map(|x| x.id.as_str()).collect::<Vec<_>>().join(", "))))?;
            (sc.first..sc.first + sc.frames, dirout.join(format!("{film}--{id}{tag}.mp4")), true)
        }
        Part::Film => (0..m.frames, dirout.join(format!("{film}{tag}.mp4")), true),
    };
    let (t_from, t_to) = (frames.start as f64 / fps, frames.end as f64 / fps);
    let mix = std::env::temp_dir().join(format!("flex-render-mix-{}-{}.wav", std::process::id(), t0.elapsed().as_nanos()));
    say("mixing the sound…");
    s.server.mix(&mix)?;
    let notes = render_range(s, width, &mix, &out, frames, progress);
    let _ = std::fs::remove_file(&mix);
    let notes = notes?;
    if captions {
        // beside it, as the pipeline writes them: the subtitles (the narration) and the attributions
        let cr = s.server.credits()?;
        let srt_t = |ms: f64| { let ms = ms.max(0.).round() as u64; format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000) };
        let mut srt = String::new();
        for l in cr["voice"].as_array().into_iter().flatten() {
            let (t, d) = (l["t"].as_f64().unwrap_or(0.) / 1000., l["dur"].as_f64().unwrap_or(0.));
            if t + d <= t_from || t >= t_to { continue; }
            srt += &format!("{}\n{} --> {}\n{}\n\n", srt.matches(" --> ").count() + 1, srt_t((t - t_from) * 1000.), srt_t((t + d - t_from) * 1000.), l["text"].as_str().unwrap_or(""));
        }
        std::fs::write(out.with_extension("srt"), srt)?;
        let lines: Vec<&str> = cr["credits"].as_array().into_iter().flatten().filter_map(|x| x.as_str()).collect();
        let credits = out.with_extension("credits.txt");
        if lines.is_empty() { let _ = std::fs::remove_file(&credits); } else { std::fs::write(&credits, lines.join("\n") + "\n")?; }
    }
    Ok(Rendered { out, notes, secs: t0.elapsed().as_secs_f64() })
}
