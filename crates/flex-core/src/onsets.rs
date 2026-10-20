//! `flex onsets`: where sung syllables and letters start (energy, pitch and fricative onsets), in file seconds and, for a
//! project's track or stem, film seconds and bar.beat. Whisper can't hear sung spelled letters or Swahili; this can.
//!
//!
//! The stretch is decoded by ffmpeg (mono, 24 kHz) and read in 5 ms frames: five band levels under 4 kHz, the 4–10 kHz
//! "hiss" band and an autocorrelation pitch. Three novelty curves find the candidates:
//! - **energy**: the bands' rise (a coarse spectral flux, in dB, over ±20 ms and ±50 ms);
//! - **fricative**: the hiss band's rise ("S", "Z", the "t" and "k" bursts), counted only when a voiced sound follows
//!   it (a hiss that ends a syllable, the "ch" of "aitch", falls away into a gap);
//! - **pitch**: a new held note either side (a semitone or more), for a syllable sung legato into the next ("and I").
//!
//! Each peak of their sum is a candidate. Its strength is how far the voiced level (80 Hz–1 kHz) climbs from the dip
//! before it to the sound after it (a brief dip inside a line climbs little, a breath stays quiet), plus the hiss's rise,
//! plus the change of note. Its time is where the level has climbed `RISE` of the way from the dip; for a consonant that
//! hisses or bursts before its vowel ("tee", "kay", "zed"), where the hiss starts, if that's sooner; for a new note,
//! the middle of the move. A consonant and its vowel, a slow rise with no dip in it, and the halves of one glide are
//! one onset. The strongest are kept, at least `min_gap` apart.
//!
//! Tuned on sung lead-vocal stems (a song's spelled-out names: see onsets_tests.rs). The
//! hand-measured references put a hissed consonant's onset at the hiss ("Z on the 'z' of Zed") and a vowel-led letter's
//! at its vowel; an aspirated "haitch" is the one place they part (the hiss is found, 0.1 s before the vowel).
//! `FLEX_ONSETS_DEBUG=1` prints every frame's features and every candidate to stderr.

use crate::filmgrid::FilmGrid;
use crate::project::{login_path, ProjectError};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone)]
pub struct Options {
    /// an audio file (a stem is best: the lead vocal)
    pub file: PathBuf,
    /// the stretch, in the file's seconds
    pub from: f64,
    pub to: f64,
    /// the project folder, for film seconds and bar.beat (the file is its track or one of its stems)
    pub project: Option<PathBuf>,
    /// how many onsets to expect (e.g. 7 letters): the strongest that many, at least `min_gap` apart
    pub expect: Option<usize>,
    /// seconds between two onsets at least
    pub min_gap: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Onset {
    /// file seconds
    pub t: f64,
    /// film seconds and bar.beat, when the file is the project's track or stem
    pub film: Option<f64>,
    pub at: Option<String>,
    /// 0–1, relative to the stretch's strongest
    pub strength: f64,
    /// what moved: "energy", "pitch" or "fricative"
    pub kind: String,
}

/// the analysis rate: 4–10 kHz fits under its Nyquist, and a 5 ms hop is a whole number of samples
pub const RATE: u32 = 24_000;
/// context decoded either side of the stretch, so an onset right at `from` has a "before"
const PAD: f64 = 0.3;

pub fn run(o: &Options) -> Result<Vec<Onset>, ProjectError> {
    if !o.file.is_file() { return Err(ProjectError::Invalid(format!("no audio at {}", o.file.display()))); }
    if !(o.to > o.from) { return Err(ProjectError::Invalid(format!("--to ({}) must be after --from ({})", o.to, o.from))); }
    if o.min_gap < 0.0 { return Err(ProjectError::Invalid("--min-gap can't be negative".into())); }
    let start = (o.from - PAD).max(0.0);
    let x = decode(&o.file, start, o.to + PAD - start)?;
    let mut out = detect(&x, RATE, start, o.from, o.to, o.expect, o.min_gap);
    if let Some((grid, key)) = place(&o.file, o.project.as_deref())? {
        for on in &mut out {
            on.film = grid.to_film_in(&key, on.t).first().copied();
            on.at = on.film.map(|f| grid.at(f));
        }
    }
    Ok(out)
}

/// `len` seconds of the file from `start`, mono at RATE, by ffmpeg.
fn decode(file: &Path, start: f64, len: f64) -> Result<Vec<f32>, ProjectError> {
    let o = Command::new("ffmpeg").env("PATH", login_path())
        .args(["-v", "error", "-nostdin", "-ss", &format!("{start:.4}"), "-t", &format!("{len:.4}"), "-i"]).arg(file)
        .args(["-ac", "1", "-ar", &RATE.to_string(), "-f", "f32le", "-"])
        .output().map_err(|e| ProjectError::Run(format!("ffmpeg: {e}")))?;
    if !o.status.success() { return Err(ProjectError::Run(format!("ffmpeg couldn't read {}: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    let x: Vec<f32> = o.stdout.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    if x.is_empty() { return Err(ProjectError::Invalid(format!("nothing to read in {} from {start:.3} s", file.display()))); }
    Ok(x)
}

// ── the analysis ─────────────────────────────────────────────────────────────────────────────────────────────────────

const HOP_S: f64 = 0.005;
/// band levels: a 512-sample window at 24 kHz (21 ms)
const WIN: usize = 512;
/// pitch: a 768-sample window (32 ms, two periods down to 62 Hz)
const PWIN: usize = 768;
/// the bands under 4 kHz (Hz); the first three are the voiced level
const BANDS: [(f64, f64); 5] = [(80.0, 250.0), (250.0, 500.0), (500.0, 1000.0), (1000.0, 2000.0), (2000.0, 4000.0)];
const VOICED: usize = 3;
/// the hiss band (Hz)
const FRIC: (f64, f64) = (4000.0, 10000.0);
/// below the stretch's loudest, where each level is floored (dB): a band's, the hiss band's, the voiced and energy levels
const BAND_FLOOR: f64 = 50.0;
const FRIC_FLOOR: f64 = 25.0;
const LEVEL_FLOOR: f64 = 40.0;
/// the novelty curves read "before" and "after" over ±20 ms, and over ±50 ms for a slow rise (weighed down a little)
const SIDE: f64 = 0.02;
const SLOW: f64 = 0.05;
const SLOW_W: f64 = 0.8;
/// pitch either side (s)
const PSIDE: f64 = 0.04;
/// what a clear onset rises by: dB averaged over the bands, dB of the hiss band, semitones; and how far a syllable's
/// voiced level climbs from its dip (dB)
const E_UNIT: f64 = 12.0;
const F_UNIT: f64 = 24.0;
const P_UNIT: f64 = 2.0;
const E_DEPTH: f64 = 15.0;
/// a hiss counts when a voiced sound comes within 150 ms of it, no more than 6 dB under the level before it
const TAIL: f64 = 0.15;
const FRIC_DROP: f64 = 6.0;
/// a syllable whose sound peaks this far under the stretch's loudest (dB) counts for less, down to nothing at the floor
const LOUD: f64 = 40.0;
/// the dip before a candidate is looked for this far back, the sound after it this far ahead (s)
const BACK: f64 = 0.15;
const AHEAD: f64 = 0.15;
/// where on its rise an onset sits: the level's fraction of the way up, the hiss's; a rise read over its top 30 dB at
/// most (from silence, the very start of a window's overlap would otherwise count)
const RISE: f64 = 0.45;
const RISE_SPAN: f64 = 30.0;
const FRIC_RISE: f64 = 0.3;
/// a hiss this strong is a consonant that starts its syllable
const CONSONANT: f64 = 0.5;
/// one syllable read as two: within 150 ms with no dip of 5 dB between (or after a consonant); a glide's halves 70 ms
const JOIN: f64 = 0.15;
const DIP: f64 = 5.0;
const GLIDE: f64 = 0.07;
/// without --expect, what's kept: this much of the strongest; a candidate weaker than MIN_STRENGTH isn't one
const KEEP: f64 = 0.2;
const MIN_STRENGTH: f64 = 0.05;

/// Per-frame features of a stretch.
struct Frames {
    /// file seconds of each frame's centre
    t: Vec<f64>,
    /// dB per band, the hiss band, the whole frame, the bands under 4 kHz together
    bands: Vec<[f64; 5]>,
    fric: Vec<f64>,
    level: Vec<f64>,
    energy: Vec<f64>,
    /// midi pitch on voiced frames
    pitch: Vec<Option<f64>>,
}

/// An onset candidate: its time and frame, the frames its level is read over, and the three detectors' parts.
#[derive(Debug, Clone)]
struct Cand { t: f64, k0: usize, lo: usize, hi: usize, valley: f64, next: f64, es: f64, fs: f64, ps: f64 }
impl Cand {
    fn strength(&self) -> f64 { self.es + self.fs + self.ps }
    fn kind(&self) -> &'static str { if self.ps >= self.es && self.ps >= self.fs { "pitch" } else if self.fs > self.es { "fricative" } else { "energy" } }
    /// a hiss or a burst big enough to be the syllable's start
    fn consonant(&self) -> bool { self.fs >= CONSONANT || self.kind() == "fricative" }
}

/// Onsets in `x` (mono at `sr`, whose first sample is file second `offset`) between file seconds `from` and `to`:
/// the `expect` strongest (else all that stand clear), at least `min_gap` apart, in time order.
pub fn detect(x: &[f32], sr: u32, offset: f64, from: f64, to: f64, expect: Option<usize>, min_gap: f64) -> Vec<Onset> {
    let debug = std::env::var_os("FLEX_ONSETS_DEBUG").is_some();
    let f = frames(x, sr, offset);
    let n = f.t.len();
    if n < 8 { return vec![]; }
    let frames_of = |s: f64| (s / HOP_S).round() as usize;
    let (side, slow, pside, tail) = (frames_of(SIDE), frames_of(SLOW), frames_of(PSIDE), frames_of(TAIL));
    let mean = |v: &dyn Fn(usize) -> f64, a: usize, b: usize| -> f64 { (a..b).map(v).sum::<f64>() / (b - a).max(1) as f64 };
    let power_sum = |db: &mut dyn Iterator<Item = f64>| 10.0 * db.map(|d| 10f64.powf(d / 10.0)).sum::<f64>().log10();
    // the voiced level: the bands under 1 kHz together
    let voiced: Vec<f64> = (0..n).map(|k| power_sum(&mut f.bands[k][..VOICED].iter().copied())).collect();

    // ── the novelty curves ──
    let (mut e, mut fr, mut p) = (vec![0.0; n], vec![0.0; n], vec![0.0; n]);
    for i in side..n.saturating_sub(side) {
        let band_rise = |s: usize| -> f64 {
            let (a, b) = (i.saturating_sub(s), (i + s).min(n));
            (0..BANDS.len()).map(|bd| (mean(&|k| f.bands[k][bd], i, b) - mean(&|k| f.bands[k][bd], a, i)).max(0.0)).sum::<f64>() / BANDS.len() as f64
        };
        e[i] = band_rise(side).max(SLOW_W * band_rise(slow)) / E_UNIT;
        let fric_rise = |s: usize| -> f64 { mean(&|k| f.fric[k], i, (i + s).min(n)) - mean(&|k| f.fric[k], i.saturating_sub(s), i) };
        let rise = fric_rise(side).max(SLOW_W * fric_rise(slow)).max(0.0);
        let v_before = mean(&|k| voiced[k], i.saturating_sub(3 * side), i.saturating_sub(side / 2));
        let v_after = (i + side..(i + tail).min(n)).map(|k| voiced[k]).fold(f64::MIN, f64::max);
        fr[i] = ((v_after - v_before + FRIC_DROP) / FRIC_DROP).clamp(0.0, 1.0) * rise / F_UNIT;
    }
    for i in pside..n.saturating_sub(pside + 1) {
        // a note either side, held: its median, if it's voiced most of the side and steady
        let held = |a: usize, b: usize| -> Option<f64> {
            let mut v: Vec<f64> = (a..b).filter_map(|k| f.pitch[k]).collect();
            if v.len() * 3 < (b - a) * 2 { return None; }
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let med = v[v.len() / 2];
            let mut dev: Vec<f64> = v.iter().map(|x| (x - med).abs()).collect();
            dev.sort_by(|a, b| a.partial_cmp(b).unwrap());
            (dev[dev.len() / 2] <= 0.6).then_some(med)
        };
        let (Some(a), Some(b)) = (held(i - pside, i), held(i + 1, i + 1 + pside)) else { continue };
        let d = (b - a).abs();
        // a jump near an octave is the tracker, not the singer; a droop as a note dies away isn't a new one
        if (d - 12.0).abs() < 1.0 || d < 0.8 { continue; }
        if mean(&|k| f.level[k], i - pside, i) - mean(&|k| f.level[k], i + 1, i + 1 + pside) > 3.0 { continue; }
        p[i] = d.min(2.0 * P_UNIT) / P_UNIT;
    }
    let smooth = |v: &[f64]| -> Vec<f64> { (0..v.len()).map(|i| { let (a, b) = (i.saturating_sub(1), (i + 2).min(v.len())); v[a..b].iter().sum::<f64>() / (b - a) as f64 }).collect() };
    let (e, fr, p) = (smooth(&e), smooth(&fr), smooth(&p));
    let c: Vec<f64> = (0..n).map(|i| e[i] + fr[i] + p[i]).collect();
    if debug {
        for i in 0..n {
            eprintln!("{:8.3} lvl {:6.1} en {:6.1} vo {:6.1} fric {:6.1} pitch {:5.1}  e {:4.2} f {:4.2} p {:4.2}  c {:4.2}", f.t[i], f.level[i], f.energy[i], voiced[i], f.fric[i], f.pitch[i].unwrap_or(0.0), e[i], fr[i], p[i], c[i]);
        }
    }

    // ── the candidates: each peak of the curve with the stretch around it above half the peak (two peaks in one such
    // stretch are one onset rising in two steps), highest first ──
    let mut order: Vec<usize> = (1..n - 1).filter(|&i| c[i] > 0.02 && c[i] >= c[i - 1] && c[i] > c[i + 1]).collect();
    order.sort_by(|&a, &b| c[b].partial_cmp(&c[a]).unwrap());
    let mut lobes: Vec<(usize, usize, usize)> = vec![];
    for i in order {
        let half = c[i] * 0.5;
        let (mut l, mut r) = (i, i);
        while l > 0 && c[l - 1] >= half { l -= 1; }
        while r + 1 < n && c[r + 1] >= half { r += 1; }
        if lobes.iter().any(|&(a, _, b)| l <= b && r >= a) { continue; }
        lobes.push((l, i, r));
    }
    lobes.sort();
    // the ones that bound a neighbour's level reading: not the curve's small wobbles
    let cmax = c.iter().copied().fold(0.0, f64::max);
    let bounds: Vec<(usize, usize, usize)> = lobes.iter().copied().filter(|&(_, i, _)| c[i] >= 0.1 * cmax).collect();
    // the levels a candidate is weighed and timed on, smoothed over ~25 ms (a low voice's level flickers frame to frame)
    let smoothed = |v: &[f64]| -> Vec<f64> {
        let top = v.iter().copied().fold(f64::MIN, f64::max);
        (0..n).map(|i| {
            let (a, b) = (i.saturating_sub(2), (i + 3).min(n));
            (v[a..b].iter().sum::<f64>() / (b - a) as f64).max(top - LEVEL_FLOOR)
        }).collect()
    };
    let level = smoothed(&voiced);
    let elevel = smoothed(&f.energy);
    let vtop = voiced.iter().copied().fold(f64::MIN, f64::max);
    let depth = |valley: f64, next: f64| -> f64 {
        let loud = ((next - (vtop - LOUD)) / (LOUD / 2.0)).clamp(0.0, 1.0);
        (next - valley).max(0.0) / E_DEPTH * loud
    };
    let (back, ahead) = (frames_of(BACK), frames_of(AHEAD));
    let mut cand: Vec<Cand> = vec![];
    for &(l, i, r) in &lobes {
        let half = c[i] * 0.5;
        let w: f64 = (l..=r).map(|k| c[k] - half).sum();
        let tc = if w > 0.0 { (l..=r).map(|k| (c[k] - half) * f.t[k]).sum::<f64>() / w } else { f.t[i] };
        let k0 = ((tc - f.t[0]) / HOP_S).round().clamp(0.0, (n - 1) as f64) as usize;
        // the dip since the onset before, the sound until the one after
        let lo = bounds.iter().filter(|x| x.2 < l).map(|x| x.2).max().unwrap_or(0).max(k0.saturating_sub(back)).min(k0);
        let hi = bounds.iter().filter(|x| x.0 > r).map(|x| x.0).min().unwrap_or(n).min(k0 + ahead).max(k0 + 4).min(n);
        let valley = level[lo..=k0].iter().copied().fold(f64::MAX, f64::min);
        let next = level[k0..hi].iter().copied().fold(f64::MIN, f64::max);
        let near = |v: &[f64]| v[l.saturating_sub(2)..=(r + 2).min(n - 1)].iter().copied().fold(0.0, f64::max);
        let mut x = Cand { t: tc, k0, lo, hi, valley, next, es: depth(valley, next), fs: near(&fr), ps: near(&p) };
        let main = match x.kind() {
            "pitch" => {
                let (a, b) = (l.saturating_sub(2), (r + 2).min(n - 1));
                let k = (a..=b).find(|&k| p[k] >= 0.5 * x.ps).unwrap_or(i);
                let start = if k > 0 && p[k] > p[k - 1] { f.t[k - 1] + (0.5 * x.ps - p[k - 1]) / (p[k] - p[k - 1]) * HOP_S } else { f.t[k] };
                let kl = (k..=b).take_while(|&j| p[j] >= 0.5 * x.ps).last().unwrap_or(k);
                let end = if kl + 1 < n && p[kl + 1] < p[kl] { f.t[kl] + (p[kl] - 0.5 * x.ps) / (p[kl] - p[kl + 1]) * HOP_S } else { f.t[kl] };
                Some(0.5 * (start + end))
            }
            _ => rise_at(&elevel, &f.t, lo, k0, hi, RISE),
        };
        let hiss = if x.consonant() { rise_at(&f.fric, &f.t, lo, k0, hi, FRIC_RISE) } else { None };
        x.t = match (main, hiss) { (Some(a), Some(b)) => a.min(b), (a, b) => a.or(b).unwrap_or(tc) };
        // (a wobble of the curve that none of the three detectors calls a start)
        if x.strength() >= MIN_STRENGTH { cand.push(x); }
    }
    cand.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
    // one syllable read as two: a consonant and its vowel; a slow rise with no dip in it; the two halves of a glide
    let mut merged: Vec<Cand> = vec![];
    for b in cand {
        if let Some(a) = merged.last_mut() {
            let gap = b.t - a.t;
            let mut crest = f64::MIN;
            let dip = (a.k0.min(b.k0)..=a.k0.max(b.k0)).any(|k| { crest = crest.max(level[k]); level[k] < crest - DIP });
            let one = if a.kind() == "pitch" && b.kind() == "pitch" { gap < GLIDE } else { gap < JOIN && (a.consonant() || !dip) };
            if one {
                if debug { eprintln!("join {:8.3} ({:4.2}) + {:8.3} ({:4.2})", a.t, a.strength(), b.t, b.strength()); }
                // a slight stir before a strong onset is only its run-up: the onset is the strong one's
                if a.strength() < 0.5 * b.strength() { let (valley, lo) = (a.valley.min(b.valley), a.lo); *a = Cand { valley, lo, ..b.clone() }; continue; }
                a.next = a.next.max(b.next);
                a.hi = a.hi.max(b.hi);
                a.es = depth(a.valley, a.next);
                a.fs = a.fs.max(b.fs);
                a.ps = a.ps.max(b.ps);
                if !a.consonant() && a.kind() != "pitch" { if let Some(t) = rise_at(&elevel, &f.t, a.lo, a.k0, a.hi, RISE) { a.t = t; } }
                continue;
            }
        }
        merged.push(b);
    }
    let mut cand: Vec<Cand> = merged.into_iter().filter(|x| x.t >= from - 1e-9 && x.t <= to + 1e-9).collect();
    if debug {
        for x in &cand { eprintln!("cand {:8.3}  e {:4.2} (valley {:5.1} next {:5.1})  f {:4.2}  p {:4.2}  = {:4.2}", x.t, x.es, x.valley, x.next, x.fs, x.ps, x.strength()); }
    }

    // ── the strongest, apart ──
    let top = cand.iter().map(|x| x.strength()).fold(0.0, f64::max);
    if top <= 0.0 { return vec![]; }
    if expect.is_none() { cand.retain(|x| x.strength() >= KEEP * top); }
    cand.sort_by(|a, b| b.strength().partial_cmp(&a.strength()).unwrap());
    let mut keep: Vec<Cand> = vec![];
    for x in cand {
        if keep.iter().any(|k| (k.t - x.t).abs() < min_gap - 1e-9) { continue; }
        keep.push(x);
        if expect.is_some_and(|n| keep.len() >= n) { break; }
    }
    keep.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
    keep.into_iter().map(|x| Onset { t: (x.t * 1000.0).round() / 1000.0, film: None, at: None, strength: ((x.strength() / top) * 100.0).round() / 100.0, kind: x.kind().into() }).collect()
}

/// The time `v` has climbed `frac` of the way (in dB) from its lowest in `lo..=k0` to its highest in `k0..hi`: the
/// last upward crossing before the highest, interpolated between frames.
fn rise_at(v: &[f64], t: &[f64], lo: usize, k0: usize, hi: usize, frac: f64) -> Option<f64> {
    let vi = (lo..=k0).min_by(|&a, &b| v[a].partial_cmp(&v[b]).unwrap())?;
    let kp = (k0..hi).max_by(|&a, &b| v[a].partial_cmp(&v[b]).unwrap())?;
    if kp <= vi { return None; }
    let low = v[vi].max(v[kp] - RISE_SPAN);
    let mid = low + frac * (v[kp] - low);
    (vi + 1..=kp).filter(|&k| v[k - 1] < mid && v[k] >= mid).last()
        .map(|k| t[k - 1] + (mid - v[k - 1]) / (v[k] - v[k - 1]) * (t[k] - t[k - 1]))
}

fn frames(x: &[f32], sr: u32, offset: f64) -> Frames {
    let srf = sr as f64;
    let hop = HOP_S * srf;
    let win = (WIN as f64 * srf / RATE as f64).round() as usize;
    let nfft = win.next_power_of_two();
    let pwin = (PWIN as f64 * srf / RATE as f64).round() as usize;
    let pfft = (2 * pwin).next_power_of_two();
    let hann = |n: usize| -> Vec<f64> { (0..n).map(|i| 0.5 - 0.5 * (2.0 * std::f64::consts::PI * (i as f64 + 0.5) / n as f64).cos()).collect() };
    let (w, pw) = (hann(win), hann(pwin));
    // the window's own autocorrelation, to unbias the frame's
    let wac = autocorr(&pw, pfft);
    let bin = |hz: f64| ((hz / srf * nfft as f64).round() as usize).min(nfft / 2);
    let mut out = Frames { t: vec![], bands: vec![], fric: vec![], level: vec![], energy: vec![], pitch: vec![] };
    let half = win.max(pwin) / 2;
    let mut k = 0usize;
    loop {
        let centre = (k as f64 * hop).round() as usize + half;
        if centre + half > x.len() { break; }
        k += 1;
        // the spectrum
        let mut re = vec![0.0; nfft];
        let mut im = vec![0.0; nfft];
        for j in 0..win { re[j] = x[centre - win / 2 + j] as f64 * w[j]; }
        fft(&mut re, &mut im, false);
        let pow: Vec<f64> = (0..=nfft / 2).map(|j| re[j] * re[j] + im[j] * im[j]).collect();
        let db = |lo: f64, hi: f64| -> f64 { let s: f64 = pow[bin(lo)..bin(hi).max(bin(lo) + 1)].iter().sum(); 10.0 * (s + 1e-10).log10() };
        let mut bands = [0.0; 5];
        for (b, &(lo, hi)) in BANDS.iter().enumerate() { bands[b] = db(lo, hi); }
        out.bands.push(bands);
        out.energy.push(db(BANDS[0].0, BANDS[BANDS.len() - 1].1));
        out.fric.push(db(FRIC.0, FRIC.1.min(srf / 2.0 - 1.0)));
        out.level.push(db(60.0, srf / 2.0 - 1.0));
        out.t.push(offset + centre as f64 / srf);
        // the pitch: normalised, unbiased autocorrelation; the first peak near the highest, 70–1000 Hz
        let seg: Vec<f64> = (0..pwin).map(|j| x[centre - pwin / 2 + j] as f64).collect();
        let m = seg.iter().sum::<f64>() / pwin as f64;
        let seg: Vec<f64> = seg.iter().zip(&pw).map(|(s, w)| (s - m) * w).collect();
        let ac = autocorr(&seg, pfft);
        let (lo, hi) = ((srf / 1000.0).floor() as usize, ((srf / 70.0).ceil() as usize).min(pwin * 2 / 3));
        let mut pitch = None;
        if ac[0] > 1e-9 {
            let r: Vec<f64> = (0..=hi + 1).map(|l| ac[l] / wac[l].max(1e-9) * wac[0] / ac[0]).collect();
            let best = (lo..=hi).map(|l| r[l]).fold(f64::MIN, f64::max);
            if best > 0.7 {
                if let Some(l) = (lo.max(1)..=hi).find(|&l| r[l] >= 0.88 * best && r[l] >= r[l - 1] && r[l] >= r[l + 1]) {
                    // parabolic interpolation of the lag
                    let (a, b, c) = (r[l - 1], r[l], r[l + 1]);
                    let d = a - 2.0 * b + c;
                    let lag = l as f64 + if d.abs() > 1e-12 { 0.5 * (a - c) / d } else { 0.0 };
                    pitch = Some(69.0 + 12.0 * (srf / lag / 440.0).log2());
                }
            }
        }
        out.pitch.push(pitch);
    }
    // floors under the stretch's loudest: silence and the stem's bleed don't rise
    let top = |v: &mut dyn Iterator<Item = f64>| v.fold(f64::MIN, f64::max);
    for b in 0..BANDS.len() {
        let t = top(&mut out.bands.iter().map(|x| x[b]));
        for x in &mut out.bands { x[b] = x[b].max(t - BAND_FLOOR); }
    }
    let t = top(&mut out.fric.iter().copied());
    for x in &mut out.fric { *x = x.max(t - FRIC_FLOOR); }
    let t = top(&mut out.energy.iter().copied());
    for x in &mut out.energy { *x = x.max(t - LEVEL_FLOOR); }
    // no pitch in the near-silence
    let t = top(&mut out.level.iter().copied());
    for (i, l) in out.level.iter().enumerate() { if *l < t - 35.0 { out.pitch[i] = None; } }
    out
}

/// The autocorrelation of `x` (zero-padded to `n`, a power of two ≥ 2·len), lags 0..n/2.
fn autocorr(x: &[f64], n: usize) -> Vec<f64> {
    let mut re = vec![0.0; n];
    let mut im = vec![0.0; n];
    re[..x.len()].copy_from_slice(x);
    fft(&mut re, &mut im, false);
    for j in 0..n { re[j] = re[j] * re[j] + im[j] * im[j]; im[j] = 0.0; }
    fft(&mut re, &mut im, true);
    re.truncate(n / 2);
    re
}

/// In-place radix-2 FFT (`n` a power of two); `inverse` scales by 1/n.
fn fft(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 { j ^= bit; bit >>= 1; }
        j |= bit;
        if i < j { re.swap(i, j); im.swap(i, j); }
    }
    let mut len = 2;
    while len <= n {
        let ang = 2.0 * std::f64::consts::PI / len as f64 * if inverse { 1.0 } else { -1.0 };
        let (wr, wi) = (ang.cos(), ang.sin());
        for s in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (a, b) = (s + k, s + k + len / 2);
                let (tr, ti) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - tr; im[b] = im[a] - ti;
                re[a] += tr; im[a] += ti;
                let nr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = nr;
            }
        }
        len <<= 1;
    }
    if inverse { for k in 0..n { re[k] /= n as f64; im[k] /= n as f64; } }
}

// ── the project ──────────────────────────────────────────────────────────────────────────────────────────────────────

/// The film grid and the music key `file` plays on, when it's a project's track or one of its stems. A project named
/// outright that can't be read (its pipeline missing, no beat grid yet) is an error; one found above the file, a folder
/// that isn't a project, or a file that isn't on any of its tracks just leaves the film times out.
fn place(file: &Path, project: Option<&Path>) -> Result<Option<(FilmGrid, String)>, ProjectError> {
    let (dir, named) = match project {
        Some(d) => (d.to_path_buf(), true),
        None => match std::fs::canonicalize(file).ok().and_then(|f| f.ancestors().skip(1).find(|d| d.join("project.ts").is_file() && d.join("audio.json").is_file()).map(Path::to_path_buf)) {
            Some(d) => (d, false),
            None => return Ok(None),
        },
    };
    let Some(key) = track_for(&dir, file) else { return Ok(None) };
    let grid = match crate::project::Project::open(&dir).and_then(|p| FilmGrid::load(&p.dir, &p.music, p.duration)) {
        Ok(g) => g,
        Err(ProjectError::NotAProject(_)) => return Ok(None),
        Err(e) if named => return Err(e),
        Err(_) => return Ok(None),
    };
    Ok(grid.tracks.iter().any(|k| *k == key).then_some((grid, key)))
}

/// Which of the project's music tracks (`audio.json` keys) `file` is on the clock of:
/// 1. the track's own file;
/// 2. a stem: a folder above it (up to two) named after the track, i.e. after the track's file or its key, compared on
///    letters and digits only, a trailing "stems" dropped ("Song Two Stems/0 Lead Vocals.wav" →
///    `audio/song-two.mp3`); or any file in the project's stems folder (`audio.json` "stems") with one track;
/// 3. else the one track whose length matches the file's within 50 ms (stems are rendered the song's length).
pub fn track_for(dir: &Path, file: &Path) -> Option<String> {
    let audio: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("audio.json")).ok()?).ok()?;
    let music = audio["music"].as_object()?;
    let tracks: Vec<(String, PathBuf)> = music.iter().filter_map(|(k, m)| Some((k.clone(), dir.join(m["file"].as_str()?)))).collect();
    let canon = std::fs::canonicalize(file).unwrap_or_else(|_| file.to_path_buf());
    // 1. the track itself
    if let Some((k, _)) = tracks.iter().find(|(_, p)| std::fs::canonicalize(p).ok().as_ref() == Some(&canon)) { return Some(k.clone()); }
    // 2. a folder named after a track
    let norm = |s: &str| -> String { let s: String = s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect(); s.strip_suffix("stems").map(str::to_string).unwrap_or(s) };
    for folder in canon.ancestors().skip(1).take(2) {
        let name = norm(&folder.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        if name.is_empty() { continue; }
        let hit: Vec<&String> = tracks.iter().filter(|(k, p)| norm(k) == name || p.file_stem().is_some_and(|s| norm(&s.to_string_lossy()) == name)).map(|(k, _)| k).collect();
        if hit.len() == 1 { return Some(hit[0].clone()); }
    }
    let stems = dir.join(audio["stems"].as_str().unwrap_or("audio/stems/"));
    if tracks.len() == 1 && std::fs::canonicalize(&stems).ok().is_some_and(|s| canon.starts_with(s)) { return Some(tracks[0].0.clone()); }
    // 3. the same length
    let len = duration(&canon)?;
    let hit: Vec<&String> = tracks.iter().filter(|(_, p)| duration(p).is_some_and(|d| (d - len).abs() <= 0.05)).map(|(k, _)| k).collect();
    (hit.len() == 1).then(|| hit[0].clone())
}

fn duration(file: &Path) -> Option<f64> {
    let o = Command::new("ffprobe").args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]).arg(file).env("PATH", login_path()).output().ok()?;
    String::from_utf8_lossy(&o.stdout).trim().parse().ok()
}
