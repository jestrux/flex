//! The reading check: is every line of display text on screen long enough to read?
//!
//! Measured on the painted film, not on the project's code, so it sees every card, caption, lens and title the same way
//! the viewer does. Frames every `step` (100 ms) are painted at 960 wide (cached like any frame) and read by macOS's text
//! recognition in one process (`read::run_batch`). Lines whose box is at least `min_height` film px tall are display
//! text (a slide line, a lens's magnified figure); a screen recording's interface text is smaller and doesn't count.
//!
//! Each line is followed through the samples by its normalised text (allowing one missed sample, since recognition
//! flickers), then lines that come on together and sit in one column are grouped into a block (a two-line slide reads
//! as one). A block needs `0.3 s × words + 0.7 s` (the time to find it and read it); one on screen for less is flagged.
//! Text that types or fades in is read as partial lines first: a run whose text is part of a block that follows it
//! directly counts towards that block's time on screen.

use crate::frames::{FrameState, Session};
use crate::project::ProjectError;
use crate::read::{run_batch, Line};
use serde::Serialize;
use std::collections::BTreeMap;

pub const WIDTH: u32 = 960;

pub const SEC_PER_WORD: f64 = 0.3;
pub const FIND: f64 = 0.7;

pub fn need(words: usize) -> f64 { SEC_PER_WORD * words as f64 + FIND }

#[derive(Debug, Clone, Serialize)]
pub struct Block {
    pub text: String,
    pub words: usize,
    /// film seconds it's on screen, and for how long
    pub from: f64,
    pub to: f64,
    pub shown: f64,
    /// the time it needs, and whether it gets it
    pub need: f64,
    pub short: bool,
    pub scene: String,
    /// its box in film px (the union of its lines)
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone)]
struct Run { key: String, text: String, first: usize, last: usize, seen: usize, x: f64, y: f64, w: f64, h: f64, texts: BTreeMap<String, usize> }

/// lower case, letters and digits only, single spaces: what recognition gets the same twice
pub fn norm(s: &str) -> String {
    s.to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `slack`: seconds a line is readable but not yet (or no longer) recognised, while it fades in and out; a block is
/// short when its recognised time + slack is under the need. 0.4 s: text reads through most of a fade, but recognition
/// wants it near full strength, so a card that fades in and out over 200–400 ms loses about that much.
pub struct Options { pub scene: Option<String>, pub min_height: f64, pub step: u32, pub slack: f64 }

/// words as a reader counts them: "K 3,000" is two, "share-out." one, a "/" none
pub fn words(s: &str) -> usize { s.split_whitespace().filter(|w| w.chars().any(|c| c.is_alphanumeric())).count() }

/// the key a line is followed by: its normalised text with every digit as # (a rolling figure stays one line)
pub fn key(s: &str) -> String { norm(s).chars().map(|c| if c.is_ascii_digit() { '#' } else { c }).collect() }

/// similarity of two keys, 0–1 (1 − edit distance / the longer length): recognition misreads a letter or two in motion
pub fn similar(a: &str, b: &str) -> f64 {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a.is_empty() || b.is_empty() { return 0.; }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; b.len() + 1];
        for j in 1..=b.len() { cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + usize::from(a[i - 1] != b[j - 1])); }
        prev = cur;
    }
    1. - prev[b.len()] as f64 / a.len().max(b.len()) as f64
}

pub fn check(s: &Session, o: &Options) -> Result<Vec<Block>, ProjectError> {
    let m = s.manifest();
    let scale = m.size[0] as f64 / WIDTH as f64;
    let (a, b) = match &o.scene {
        Some(id) => { let sc = m.scenes.iter().find(|x| &x.id == id).ok_or_else(|| ProjectError::Invalid(format!("no scene \"{id}\"")))?; (sc.first, sc.first + sc.frames) }
        None => (0, m.frames),
    };
    let frames: Vec<u32> = (a..b).step_by(o.step.max(1) as usize).collect();
    s.warm(frames.iter().copied(), WIDTH, |_, _| {})?;
    let paths: Vec<_> = frames.iter().map(|&f| match s.frame(f, WIDTH) { Ok(FrameState::Cached(p)) => Some(p), _ => None }).collect();
    let files: Vec<_> = paths.iter().flatten().cloned().collect();
    // four recognisers at once, a quarter of the frames each
    let chunk = files.len().div_ceil(4).max(1);
    let parts: Vec<Result<Vec<Result<crate::read::Text, String>>, ProjectError>> = std::thread::scope(|sc| {
        let hs: Vec<_> = files.chunks(chunk).map(|c| sc.spawn(move || run_batch(c, false))).collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let mut all = vec![];
    for p in parts { all.extend(p?); }
    let mut read = all.into_iter();
    let texts: Vec<Vec<Line>> = paths.iter().map(|p| if p.is_some() { read.next().and_then(|r| r.ok()).map(|t| t.lines).unwrap_or_default() } else { vec![] }).collect();

    // follow each display line through the samples: a line continues an open run whose key is similar (≥ 0.75) and
    // whose box is in the same place, missing at most two samples (recognition flickers)
    let mut open: Vec<Run> = vec![];
    let mut runs: Vec<Run> = vec![];
    for (i, lines) in texts.iter().enumerate() {
        for l in lines {
            if l.bbox.h * scale < o.min_height { continue; }
            let k = key(&l.text);
            if k.chars().filter(|c| c.is_alphabetic()).count() < 2 { continue; }
            let (x, y, w, h) = (l.bbox.x * scale, l.bbox.y * scale, l.bbox.w * scale, l.bbox.h * scale);
            let best = open.iter_mut().filter(|r| r.last < i && (r.y - y).abs() < r.h.max(h) && (r.x - x).abs().min(((r.x + r.w / 2.) - (x + w / 2.)).abs()) < r.h.max(h) * 2.)
                .map(|r| (similar(&r.key, &k), r)).filter(|(sim, _)| *sim >= 0.75).max_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            match best {
                Some((_, r)) => { r.last = i; r.seen += 1; *r.texts.entry(l.text.clone()).or_default() += 1; if k.len() > r.key.len() { r.key = k; } }
                None => open.push(Run { key: k, text: l.text.clone(), first: i, last: i, seen: 1, x, y, w, h, texts: BTreeMap::from([(l.text.clone(), 1)]) }),
            }
        }
        let (stale, live): (Vec<Run>, Vec<Run>) = open.into_iter().partition(|r| i - r.last > 2);
        runs.extend(stale); open = live;
    }
    runs.extend(open);
    // a run seen fewer than 3 times (0.3 s) is a read caught mid-transition, not a line; its text is the one read most
    runs.retain(|r| r.seen >= 3);
    for r in runs.iter_mut() { r.text = r.texts.iter().max_by_key(|(_, n)| **n).map(|(t, _)| t.clone()).unwrap_or_default(); }
    runs.sort_by_key(|r| (r.first, (r.y * 10.) as i64));

    // partial lines (typing, fading in) that lead straight into a fuller line of the same text: the fuller line was on
    // screen from the partial's start
    let mut keep: Vec<Run> = vec![];
    for r in &runs {
        let lead = runs.iter().any(|q| q.key.len() > r.key.len() && q.key.contains(&r.key) && q.first >= r.first && q.first <= r.last + 2 && q.last > r.last);
        if !lead { keep.push(r.clone()); }
    }
    for k in keep.iter_mut() {
        if let Some(p) = runs.iter().filter(|q| q.key.len() < k.key.len() && k.key.starts_with(&q.key) && q.first < k.first && k.first <= q.last + 2).map(|q| q.first).min() { k.first = p; }
    }

    // blocks: lines that come on and go off within 0.4 s of each other and stack in one column (left edges or centres within
    // a line's height, vertical gaps under 1.5 lines)
    let dt = o.step as f64 / m.fps as f64;
    let near = (0.4 / dt).round() as usize;
    let mut used = vec![false; keep.len()];
    let mut blocks = vec![];
    for i in 0..keep.len() {
        if used[i] { continue; }
        used[i] = true;
        let mut g = vec![i];
        loop {
            let mut grew = false;
            for j in 0..keep.len() {
                if used[j] { continue; }
                let q = &keep[j];
                let fits = g.iter().any(|&k| {
                    let p = &keep[k];
                    let lh = p.h.max(q.h);
                    p.first.abs_diff(q.first) <= near && p.last.abs_diff(q.last) <= near
                        && ((p.x - q.x).abs() < lh || ((p.x + p.w / 2.) - (q.x + q.w / 2.)).abs() < lh)
                        && (q.y - (p.y + p.h)).abs().min((p.y - (q.y + q.h)).abs()) < 1.5 * lh
                });
                if fits { used[j] = true; g.push(j); grew = true; }
            }
            if !grew { break; }
        }
        g.sort_by(|a, b| keep[*a].y.partial_cmp(&keep[*b].y).unwrap());
        let text = g.iter().map(|&k| keep[k].text.clone()).collect::<Vec<_>>().join(" / ");
        let words = g.iter().map(|&k| words(&keep[k].text)).sum::<usize>();
        let first = g.iter().map(|&k| keep[k].first).min().unwrap();
        let last = g.iter().map(|&k| keep[k].last).max().unwrap();
        let (from, to) = (frames[first] as f64 / m.fps as f64, frames[last] as f64 / m.fps as f64 + dt);
        let (x0, y0) = (g.iter().map(|&k| keep[k].x).fold(f64::MAX, f64::min), g.iter().map(|&k| keep[k].y).fold(f64::MAX, f64::min));
        let (x1, y1) = (g.iter().map(|&k| keep[k].x + keep[k].w).fold(0., f64::max), g.iter().map(|&k| keep[k].y + keep[k].h).fold(0., f64::max));
        let shown = to - from;
        let scene = m.scenes.iter().rfind(|sc| sc.first <= frames[first]).map(|sc| sc.id.clone()).unwrap_or_default();
        blocks.push(Block { text, words, from: r2(from), to: r2(to), shown: r2(shown), need: r2(need(words)), short: shown + o.slack + 1e-6 < need(words), scene,
            x: x0.round(), y: y0.round(), w: (x1 - x0).round(), h: (y1 - y0).round() });
    }
    blocks.sort_by(|a, b| a.from.partial_cmp(&b.from).unwrap());
    Ok(blocks)
}

fn r2(x: f64) -> f64 { (x * 100.).round() / 100. }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_rule_and_the_text() {
        assert!((need(5) - 2.2).abs() < 1e-9);
        assert_eq!(norm("Loans go out. / And come back!"), "loans go out and come back");
        assert_eq!(norm("K 6,152.50"), "k 6 152 50");
        assert_eq!(words("Asks for K 3,000 / for her business."), 7);
        assert_eq!(key("34 circles"), key("2 circles").replace("#", "##"));
        assert!(similar("repayment recorded", "repaymentent orded") > 0.75);
    }
}
