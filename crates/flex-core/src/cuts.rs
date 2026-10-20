//! Where each cut sits against the music: every change from one item to the next (a card, a take, a scene), measured
//! against the nearest beat of the film's grid (the song's beats through the music edit: filmgrid.rs) and the nearest
//! hit the project declares (markers.hits). Measurement only: whether a cut is meant to sit on a beat is the film's call
//! (a seam can be early on purpose). `between` marks a cut more than 40 ms from every beat and declared hit. Cuts sit on
//! frames, so ±17 ms (half a frame at 30 fps) is the floor.

use crate::filmgrid::FilmGrid;
use crate::project::Music;
use crate::server::Manifest;
use serde::Serialize;
use std::path::Path;

pub const OFF_MS: f64 = 40.0;

#[derive(Debug, Clone, Serialize)]
pub struct Cut {
    /// film seconds
    pub t: f64,
    pub frame: u32,
    pub from: String,
    pub to: String,
    /// a scene boundary (else a change inside a scene)
    pub scene: bool,
    /// film bar.beat
    pub at: String,
    /// the nearer of the nearest beat ("beat <bar.beat>") and the nearest declared hit within 300 ms ("hit <label>")
    pub nearest: String,
    /// ms from it (negative: before it)
    pub off_ms: f64,
    /// ms from the nearest beat, and from the nearest declared hit (within 300 ms)
    pub beat_ms: Option<f64>,
    pub hit_ms: Option<f64>,
    /// within 40 ms of a beat or a declared hit
    pub on: bool,
    /// a deliberate hard cut the project declares (markers.cuts)
    pub declared: bool,
}

pub fn check(dir: &Path, m: &Manifest) -> Result<Vec<Cut>, crate::project::ProjectError> {
    let music = Music { key: m.music.key.clone(), segments: m.music.segments.clone(), from: m.music.from, tracks: m.music.tracks.clone() };
    let g = FilmGrid::load(dir, &music, m.duration)?;
    let hits = m.markers.as_ref().map(|x| x.hits.clone()).unwrap_or_default();
    let declared = m.markers.as_ref().map(|x| x.cuts.clone()).unwrap_or_default();
    let fps = m.fps as f64;
    // every item in film order, with its scene
    let items: Vec<(&str, &str, f64)> = m.scenes.iter().flat_map(|s| s.items.iter().map(move |it| (s.id.as_str(), it.label.as_str(), it.start))).collect();
    let mut out = vec![];
    for w in items.windows(2) {
        let ((sa, la, _), (sb, lb, t)) = (w[0], w[1]);
        let t = (t * fps).round() / fps;
        let hit = hits.iter().map(|h| (h, t - h.t)).filter(|(_, d)| d.abs() <= 0.3).min_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap());
        let beat = g.nearest_beat(t);
        let (nearest, off) = match (hit, beat) {
            (Some((h, dh)), Some((_, db))) if dh.abs() <= db.abs() + 0.001 => (format!("hit {}", h.label), dh),
            (_, Some((b, db))) => (format!("beat {}", g.at(b)), db),
            (Some((h, dh)), None) => (format!("hit {}", h.label), dh),
            (None, None) => ("—".into(), 0.0),
        };
        let off_ms = (off * 1000.0).round();
        out.push(Cut { t: (t * 1000.0).round() / 1000.0, frame: (t * fps).round() as u32, from: format!("{sa}/{la}"), to: format!("{sb}/{lb}"),
            scene: sa != sb, at: g.at(t), nearest, off_ms, beat_ms: beat.map(|(_, d)| (d * 1000.0).round()), hit_ms: hit.map(|(_, d)| (d * 1000.0).round()), on: off_ms.abs() <= OFF_MS, declared: declared.iter().any(|d| (d - t).abs() < 0.5 / fps + 1e-3) });
    }
    Ok(out)
}
