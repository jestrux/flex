//! Where the narration's words land in the film: each voice line (its film start from the plan) transcribed word by
//! word (local Whisper, cached), every word in film seconds and film bar.beat, and flagged when the song's lead vocal is
//! singing then (the song's phrases from `flex music`, through the music edit). "Does 'share' land on the downbeat?" and
//! "is this line over a sung line?" become a lookup.

use crate::filmgrid::FilmGrid;
use crate::project::{Music, ProjectError};
use crate::server::Server;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct LineWord { pub word: String, pub t: f64, pub end: f64, pub at: String, pub off_beat_ms: f64, pub over_singing: bool }

#[derive(Debug, Clone, Serialize)]
/// t: film seconds; dur: seconds (the plan's voice lines carry t in ms, dur in seconds)
pub struct Line { pub text: String, pub t: f64, pub dur: f64, pub at: String, pub words: Vec<LineWord>, pub over_singing: Vec<String> }

pub fn check(dir: &Path, srv: &Server) -> Result<Vec<Line>, ProjectError> {
    let m = &srv.manifest;
    let music = Music { key: m.music.key.clone(), segments: m.music.segments.clone(), from: m.music.from, tracks: m.music.tracks.clone() };
    let g = FilmGrid::load(dir, &music, m.duration)?;
    let cues = srv.cues()?;
    let voice = cues["voice"].as_array().cloned().unwrap_or_default();
    // the song's sung phrases (song seconds, from flex music), through the edit
    let audio: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("audio.json"))?).unwrap_or_default();
    let track = audio["music"][&music.key]["file"].as_str().map(|f| dir.join(f));
    let sung: Vec<(f64, f64)> = track.and_then(|t| std::fs::read_to_string(t.with_extension("music.json")).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .map(|mj| mj["phrases"].as_array().cloned().unwrap_or_default().iter().flat_map(|p| {
            let (a, b) = (p["start"].as_f64().unwrap_or(0.0), p["end"].as_f64().unwrap_or(0.0));
            g.to_film(a).into_iter().map(move |fa| (fa, fa + (b - a))).collect::<Vec<_>>()
        }).collect()).unwrap_or_default();
    let files: Vec<PathBuf> = voice.iter().map(|v| PathBuf::from(v["file"].as_str().unwrap_or_default())).collect();
    let words = crate::transcribe::run_many(&files)?;
    Ok(voice.iter().zip(words).map(|(v, ws)| {
        let t0 = v["t"].as_f64().unwrap_or(0.0) / 1000.0;
        let words: Vec<LineWord> = ws.iter().map(|w| {
            let t = ((t0 + w.start) * 1000.0).round() / 1000.0;
            LineWord { word: w.word.clone(), t, end: ((t0 + w.end) * 1000.0).round() / 1000.0, at: g.at(t),
                off_beat_ms: g.nearest_beat(t).map(|(_, d)| (d * 1000.0).round()).unwrap_or(0.0),
                over_singing: sung.iter().any(|(a, b)| t >= *a && t < *b) }
        }).collect();
        let over = words.iter().filter(|w| w.over_singing).map(|w| w.word.clone()).collect();
        Line { text: v["text"].as_str().unwrap_or_default().to_string(), t: t0, dur: v["dur"].as_f64().unwrap_or(0.0), at: g.at(t0), words, over_singing: over }
    }).collect())
}
