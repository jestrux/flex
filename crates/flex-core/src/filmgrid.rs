//! The film's own beat grid: the song's analysed grid (`<track>.grid.json`, phase-corrected by `flex music`) carried
//! through the music edit. With an edit, a song second can play twice (a repeated bar) or not at all, so film bars are
//! not song bars: here film bar n is the n-th downbeat the film plays. Bar.beat everywhere in Flex means this film grid.

use crate::project::{Music, ProjectError};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct FilmGrid {
    /// the stretches of the song the film plays, back to back (song seconds), and where each starts in the film
    pub segments: Vec<[f64; 2]>,
    pub starts: Vec<f64>,
    /// the music key each stretch plays (all the project's `music.key` unless the edit names tracks)
    pub tracks: Vec<String>,
    /// film seconds of every downbeat and every beat the film plays
    pub bars: Vec<f64>,
    pub beats: Vec<f64>,
    /// seconds per beat
    pub beat: f64,
    /// seconds per beat of each stretch's track (`beat` throughout with one track)
    pub stretch_beat: Vec<f64>,
    pub bpm: f64,
    /// the song's grid came from flex music (phase checked on the drum stem), or only from the pipeline's analysis
    pub corrected: bool,
}

/// a bundled track's grid (the pipeline's assets/music/<key>.grid.json)
fn bundled_grid(key: &str) -> Option<serde_json::Value> {
    let p = crate::project::bundled_pipeline().ok()?.join("assets/music").join(format!("{key}.grid.json"));
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

impl FilmGrid {
    /// The project's film grid: each stretch's track grid through the music edit (or from `music.from`), over `duration` s.
    /// With `music.tracks` the film can change songs at a join: each side's bars and beats come from its own song, and
    /// `beat` / `bpm` are the first track's.
    pub fn load(dir: &Path, music: &Music, duration: f64) -> Result<FilmGrid, ProjectError> {
        let audio: serde_json::Value = std::fs::read_to_string(dir.join("audio.json")).ok().and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let segments = match &music.segments {
            Some(s) if !s.is_empty() => s.clone(),
            _ => { let f = music.from.unwrap_or(0.0); vec![[f, f + duration]] }
        };
        let tracks: Vec<String> = (0..segments.len()).map(|i| music.tracks.as_ref().and_then(|t| t.get(i)).cloned().unwrap_or_else(|| music.key.clone())).collect();
        let mut grids: std::collections::HashMap<&str, serde_json::Value> = std::collections::HashMap::new();
        for k in &tracks {
            if grids.contains_key(k.as_str()) { continue; }
            let g = match audio["music"][k]["file"].as_str() {
                Some(file) => {
                    let gp = dir.join(file).with_extension("grid.json");
                    std::fs::read_to_string(&gp).ok().and_then(|s| serde_json::from_str(&s).ok())
                        .ok_or_else(|| ProjectError::Invalid(format!("no beat grid for the track yet ({}): run flex music", gp.display())))?
                }
                // not the project's own: a song from Flex's library, or one of the pipeline's bundled tracks
                None => crate::library::grid(k).or_else(|| bundled_grid(k))
                    .ok_or_else(|| ProjectError::Invalid(format!("the music \"{k}\" isn't in the project's audio.json or Flex's library")))?,
            };
            grids.insert(k, g);
        }
        let nums = |g: &serde_json::Value, k: &str| g[k].as_array().map(|a| a.iter().filter_map(|x| x.as_f64()).collect::<Vec<_>>()).unwrap_or_default();
        let mut starts = vec![];
        let mut t = 0.0;
        for s in &segments { starts.push(t); t += s[1] - s[0]; }
        let g0 = &grids[tracks[0].as_str()];
        let corrected = grids.values().all(|g| g.get("phase").is_some());
        let stretch_beat = tracks.iter().map(|k| grids[k.as_str()]["beat"].as_f64().unwrap_or(0.6)).collect();
        let mut fg = FilmGrid { segments, starts, tracks: tracks.clone(), stretch_beat, bars: vec![], beats: vec![], beat: g0["beat"].as_f64().unwrap_or(0.6), bpm: g0["bpm"].as_f64().unwrap_or(100.0), corrected };
        let (mut bars, mut beats) = (vec![], vec![]);
        for (i, k) in tracks.iter().enumerate() {
            let g = &grids[k.as_str()];
            bars.extend(nums(g, "downbeats").into_iter().filter_map(|t| fg.in_stretch(i, t)));
            beats.extend(nums(g, "beats").into_iter().filter_map(|t| fg.in_stretch(i, t)));
        }
        fg.bars = sorted(bars);
        fg.beats = sorted(beats);
        Ok(fg)
    }

    /// a song second of stretch `i`'s track → the film second it plays at, if the stretch plays it
    fn in_stretch(&self, i: usize, song: f64) -> Option<f64> {
        let s = self.segments[i];
        (song >= s[0] - 1e-6 && song < s[1] - 1e-6).then(|| ((self.starts[i] + song - s[0]) * 1000.0).round() / 1000.0)
    }

    /// a song second → every film second it plays at (none if the edit skips it); with more than one track, only the
    /// stretches of the first track (use `to_film_in` for another)
    pub fn to_film(&self, song: f64) -> Vec<f64> {
        let k = self.tracks.first().cloned().unwrap_or_default();
        self.to_film_in(&k, song)
    }

    /// a second of track `key` → every film second it plays at
    pub fn to_film_in(&self, key: &str, song: f64) -> Vec<f64> {
        (0..self.segments.len()).filter(|&i| self.tracks[i] == key).filter_map(|i| self.in_stretch(i, song)).collect()
    }

    /// seconds per beat of the song playing at a film second
    pub fn beat_at(&self, film: f64) -> f64 {
        self.starts.iter().rposition(|&f| f <= film + 1e-6).and_then(|i| self.stretch_beat.get(i).copied()).unwrap_or(self.beat)
    }

    /// the music key playing at a film second
    pub fn track_at(&self, film: f64) -> Option<&str> {
        let i = self.starts.iter().rposition(|&f| f <= film + 1e-6)?;
        Some(self.tracks[i].as_str())
    }

    /// a film second → the song second playing then
    pub fn to_song(&self, film: f64) -> Option<f64> {
        let i = self.starts.iter().rposition(|&f| f <= film + 1e-6)?;
        let s = self.segments[i];
        let t = s[0] + film - self.starts[i];
        (t <= s[1] + 1e-6).then_some((t * 1000.0).round() / 1000.0)
    }

    /// a film second → "bar.beat" (bar 1 = the film's first downbeat; beats in quarters; "pickup -0.5" before it)
    pub fn at(&self, film: f64) -> String {
        let Some(&first) = self.bars.first() else { return "?".into() };
        if film < first - 1e-6 { return format!("pickup -{}", ((first - film) / self.beat * 4.0).round() / 4.0); }
        let i = self.bars.iter().rposition(|&b| b <= film + 1e-6).unwrap_or(0);
        let bl = self.beat_at(self.bars[i]);
        let beat = (((film - self.bars[i]) / bl + 1.0) * 4.0).round() / 4.0;
        // a bar the edit cut short can't run past the next downbeat
        if beat >= 5.0 || self.bars.get(i + 1).is_some_and(|&n| film >= n - bl / 8.0) { return format!("{}.1", i + 2); }
        format!("{}.{}", i + 1, beat)
    }

    /// "15.2.5" (film bar.beat) → film seconds
    pub fn parse_at(&self, s: &str) -> Option<f64> {
        let (bar, beat) = match s.split_once('.') { Some((b, r)) => (b.parse::<usize>().ok()?, r.parse::<f64>().ok()?), None => (s.parse().ok()?, 1.0) };
        let b = *self.bars.get(bar.checked_sub(1)?)?;
        Some(((b + (beat - 1.0) * self.beat_at(b)) * 1000.0).round() / 1000.0)
    }

    /// the nearest beat to a film second, and how far off it is (seconds, negative = early)
    pub fn nearest_beat(&self, film: f64) -> Option<(f64, f64)> {
        self.beats.iter().map(|&b| (b, film - b)).min_by(|a, b| a.1.abs().partial_cmp(&b.1.abs()).unwrap())
    }
}

/// film times, sorted, with near-duplicates (a beat on both sides of a join) merged
fn sorted(mut v: Vec<f64>) -> Vec<f64> {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v.dedup_by(|a, b| (*a - *b).abs() < 0.03);
    v
}
