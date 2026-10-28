//! The stutter check: does every clip in the film advance a frame per film frame?
//!
//! Two sources:
//! - **the plan** (`check`): every film frame's video layers, straight from the server (nothing painted). Each clip
//!   layer is followed by its file (and its order among the frame's layers of that file, for a clip that crossfades
//!   with itself); its source frame is `paint::frame_index(at)`. Then, per run of frames the clip is on screen:
//!   a **repeat** is the source frame standing still for 1–2 film frames while it moves either side (a stutter);
//!   standing still for longer is a **hold** (meant); a **skip** is the source jumping 2+ frames between two film
//!   frames inside a run that otherwise plays 1:1; and the run's **speed** (source frames per film frame) is reported
//!   when it isn't 1, since footage at any other speed shows repeats or skips by construction.
//! - **a render** (`check_video`): consecutive frames compared small; a frame identical to the one before it while
//!   the picture moves either side is a repeat.

use crate::frames::Session;
use crate::paint::{frame_index, Layer};
use crate::project::ProjectError;
use crate::server::FrameLayers;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Run {
    pub scene: String,
    /// the clip's file name (not its path)
    pub clip: String,
    /// film frames it's on screen (first, last) and film seconds
    pub first: u32,
    pub last: u32,
    pub t: f64,
    /// source frames per film frame over the run (holds excluded); 1 is real time
    pub speed: f64,
    /// film frames where the source stood still for 1–2 frames inside motion: a visible stutter
    pub repeats: Vec<u32>,
    /// film frames where the source jumped 2+ frames inside a run playing at ~1:1
    pub skips: Vec<u32>,
    /// stretches the source stands still on purpose (≥ 3 frames): (first film frame, length)
    pub holds: Vec<(u32, u32)>,
}

impl Run {
    pub fn ok(&self) -> bool { self.repeats.is_empty() && self.skips.is_empty() && (self.still() || (self.speed - 1.).abs() < 0.02) }
    /// a freeze: the source never moves (speed 0), which is meant
    pub fn still(&self) -> bool { self.speed == 0. }
}

/// Classify a run's source frames (one per consecutive film frame from `first`).
pub fn classify(first: u32, src: &[i64]) -> (f64, Vec<u32>, Vec<u32>, Vec<(u32, u32)>) {
    let d: Vec<i64> = src.windows(2).map(|w| w[1] - w[0]).collect();
    let (mut repeats, mut skips, mut holds) = (vec![], vec![], vec![]);
    let mut i = 0;
    while i < d.len() {
        if d[i] == 0 {
            let s = i;
            while i < d.len() && d[i] == 0 { i += 1; }
            let len = (i - s) as u32;
            // still at the run's start or end is a hold-in / hold-out, never a stutter
            if len >= 3 || s == 0 || i == d.len() { holds.push((first + s as u32 + 1, len)); } else { for k in s..i { repeats.push(first + k as u32 + 1); } }
        } else { i += 1; }
    }
    let moving: Vec<i64> = d.iter().copied().filter(|&x| x != 0).collect();
    let speed = if moving.is_empty() { 0. } else { moving.iter().sum::<i64>() as f64 / (moving.len() + repeats.len()) as f64 };
    if (speed - 1.).abs() < 0.25 { for (k, &x) in d.iter().enumerate() { if x >= 2 || x < 0 { skips.push(first + k as u32 + 1); } } }
    (speed, repeats, skips, holds)
}

/// A source jump of more than this many frames between two film frames is a cut to another part of the clip, not a skip.
pub const SPLIT: i64 = 3;

/// Check the plan's clips, scene by scene (or one scene).
pub fn check(s: &Session, scene: Option<&str>) -> Result<Vec<Run>, ProjectError> {
    let m = s.manifest();
    let mut out = vec![];
    for sc in m.scenes.iter().filter(|x| scene.is_none_or(|id| x.id == id)) {
        // per clip key: the open run (first frame, source frames), closed when the clip leaves the screen
        let mut open: BTreeMap<(String, usize), (u32, Vec<i64>)> = BTreeMap::new();
        let close = |key: &(String, usize), (first, src): (u32, Vec<i64>), out: &mut Vec<Run>| {
            if src.len() < 2 { return; }
            let (speed, repeats, skips, holds) = classify(first, &src);
            let clip = Path::new(&key.0).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| key.0.clone());
            out.push(Run { scene: sc.id.clone(), clip, first, last: first + src.len() as u32 - 1, t: first as f64 / m.fps as f64, speed, repeats, skips, holds });
        };
        for f in sc.first..sc.first + sc.frames {
            let layers = match s.server.layers(f)? { FrameLayers::Layers(l) => l, _ => vec![] };
            let mut seen: BTreeMap<String, usize> = BTreeMap::new();
            let mut here = vec![];
            for l in &layers {
                if let Layer::Video { video, at, .. } = l {
                    let n = seen.entry(video.clone()).or_default();
                    here.push(((video.clone(), *n), frame_index(*at)));
                    *n += 1;
                }
            }
            let gone: Vec<_> = open.keys().filter(|k| !here.iter().any(|(h, _)| h == *k)).cloned().collect();
            for k in gone { let r = open.remove(&k).unwrap(); close(&k, r, &mut out); }
            for (k, i) in here {
                // a jump back, or forward by more than SPLIT frames, is a new segment of the same clip (a cut inside it):
                // it closes the run and starts another
                if let Some((_, src)) = open.get(&k) { let l = *src.last().unwrap(); if i < l || i > l + SPLIT { let r = open.remove(&k).unwrap(); close(&k, r, &mut out); } }
                open.entry(k).or_insert((f, vec![])).1.push(i);
            }
        }
        for (k, r) in std::mem::take(&mut open) { close(&k, r, &mut out); }
    }
    out.sort_by_key(|r| (r.first, r.clip.clone()));
    Ok(out)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct VideoRepeat {
    /// the repeated frame (0-based, as ffmpeg counts) and its time
    pub frame: u32,
    pub t: f64,
    /// mean difference to the frame before (≈ 0) and the motion either side, 0–255
    pub diff: f64,
    pub before: f64,
    pub after: f64,
}

/// A render's repeated frames: each frame compared with the one before at 160 × 90 grey; a frame that doesn't change
/// (< 0.05/255: an encoder's duplicate is exactly 0) while both its neighbours change more than 0.25/255 (slow motion at
/// this size is ~0.3) is a repeat.
pub fn check_video(file: &Path) -> Result<(u32, f64, Vec<VideoRepeat>), ProjectError> {
    let (w, h) = (160usize, 90usize);
    let out = std::process::Command::new("ffmpeg")
        .args(["-v", "error", "-i"]).arg(file)
        .args(["-vf", &format!("scale={w}:{h},format=gray"), "-f", "rawvideo", "-"])
        .env("PATH", crate::project::login_path())
        .output().map_err(|e| ProjectError::Invalid(format!("ffmpeg: {e}")))?;
    if !out.status.success() { return Err(ProjectError::Invalid(format!("ffmpeg couldn't read {}", file.display()))); }
    let fps = crate::sheet::probe(file).map(|(f, _)| f).unwrap_or(30.);
    let px = w * h;
    let frames: Vec<&[u8]> = out.stdout.chunks_exact(px).collect();
    let diff = |a: &[u8], b: &[u8]| a.iter().zip(b).map(|(x, y)| x.abs_diff(*y) as u64).sum::<u64>() as f64 / px as f64;
    let d: Vec<f64> = frames.windows(2).map(|p| diff(p[0], p[1])).collect(); // d[i]: frame i → i+1
    let mut rep = vec![];
    for i in 1..d.len().saturating_sub(1) {
        if d[i] < 0.05 && d[i - 1] > 0.25 && d[i + 1] > 0.25 {
            let f = (i + 1) as u32;
            rep.push(VideoRepeat { frame: f, t: f as f64 / fps, diff: d[i], before: d[i - 1], after: d[i + 1] });
        }
    }
    Ok((frames.len() as u32, fps, rep))
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn real_time_is_clean() {
        let (speed, r, s, h) = classify(100, &[10, 11, 12, 13, 14, 15]);
        assert!((speed - 1.).abs() < 1e-9 && r.is_empty() && s.is_empty() && h.is_empty());
    }

    #[test]
    fn a_doubled_frame_is_a_repeat_and_a_long_still_a_hold() {
        let (_, r, _, h) = classify(100, &[10, 11, 11, 12, 13, 13, 13, 13, 14, 15]);
        assert_eq!(r, vec![102]);
        assert_eq!(h, vec![(105, 3)]);
    }

    #[test]
    fn a_jump_is_a_skip_and_slow_footage_has_its_speed() {
        let (_, _, s, _) = classify(0, &[1, 2, 3, 5, 6, 7]);
        assert_eq!(s, vec![3]);
        // 0.9× speed: a repeat every ~10 frames, speed reported under 1
        let src: Vec<i64> = (0..60).map(|k| (k as f64 * 0.9 + 1e-9).floor() as i64).collect();
        let (speed, r, _, _) = classify(0, &src);
        assert!(speed < 0.95 && !r.is_empty());
    }

    #[test]
    fn stills_at_the_ends_are_holds() {
        let (_, r, _, h) = classify(0, &[5, 5, 6, 7, 8, 8]);
        assert!(r.is_empty());
        assert_eq!(h, vec![(1, 1), (5, 1)]);
    }
}
