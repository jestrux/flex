//! The music edit's joins, heard through the stems: at each join of `music.segments`, what each stem plays in the bar
//! before (the outgoing stretch's song) and the bar after (the incoming one's). A join where the bass plays on both sides
//! from two different places in the song(s) is two bass lines meeting, which the ear hears as a fight even when the
//! beat lines up; the same for the lead vocal (a line cut into another). Measurements only, from each track's map
//! (`<track>.music.json`, written by `flex music`): levels 0–8 per bar against the stem's own loudest bar.
//!
//! For a fighting join it suggests bar lines within two bars where the bass rests on one side, on the outgoing song
//! (an earlier or later out-point) and on the incoming one (an in-point): a join there can't put two bass lines together.

use crate::project::ProjectError;
use crate::server::Manifest;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// a stem plays in a bar at this level or above (of 8)
pub const PLAYS: i64 = 3;
/// and rests at this level or below
pub const RESTS: i64 = 1;

#[derive(Debug, Clone, Serialize)]
pub struct Side {
    pub track: String,
    /// the song second of the join on this side, and the bar it reads (1-based on the track's grid)
    pub song: f64,
    pub bar: i64,
    /// each stem's level in that bar (0–8)
    pub levels: Vec<(String, i64)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Join {
    /// the join's index (between segment i and i+1) and its film second
    pub index: usize,
    pub t: f64,
    pub out: Side,
    #[serde(rename = "in")]
    pub inn: Side,
    /// the bass plays on both sides
    pub bass_fights: bool,
    /// the lead vocal sings on both sides
    pub vocal_through: bool,
    /// beats the bar's "1" moves by at the join (0–3): an out- or in-point off its song's bar lines puts the downbeat
    /// somewhere else, which the ear hears as the band falling out of time even when every beat lines up
    pub bar_shift: i64,
    /// the same song jumping by whole bars (≤ 4), a repeat or skip of its own bars: one bass line, so never a fight
    pub repeat: bool,
    /// song seconds where the bass rests on one side, within two bars: (side, song second, film second if the join moved there)
    pub suggest: Vec<(String, f64, f64)>,
    /// why a side couldn't be read (no map for the track yet)
    pub unknown: Option<String>,
}

impl Join {
    /// a join the ear will catch: two bass lines, or the bar's "1" moving
    pub fn bad(&self) -> bool { self.bass_fights || self.bar_shift != 0 }
}

struct Map { first: f64, bar: f64, stems: Vec<(String, Vec<i64>)> }

impl Map {
    fn load(path: &Path) -> Option<Map> {
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
        let stems = v["stems"].as_object()?.iter()
            .map(|(k, a)| (k.clone(), a.as_array().map(|a| a.iter().map(|x| x.as_i64().unwrap_or(0)).collect()).unwrap_or_default())).collect();
        Some(Map { first: v["firstDownbeat"].as_f64()?, bar: v["bar"].as_f64()?, stems })
    }
    /// 0-based bar index holding song second t
    fn bar_at(&self, t: f64) -> i64 { ((t - self.first) / self.bar).floor() as i64 }
    fn level(&self, role: Role, bar: i64) -> Option<i64> {
        let (_, l) = self.stems.iter().find(|(n, _)| role_of(n) == Some(role))?;
        if bar < 0 { return Some(0); }
        Some(*l.get(bar as usize).unwrap_or(&0))
    }
    fn levels(&self, bar: i64) -> Vec<(String, i64)> {
        self.stems.iter().map(|(n, l)| (n.clone(), if bar < 0 { 0 } else { *l.get(bar as usize).unwrap_or(&0) })).collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Role { Bass, Lead }

/// which part a stem is, by its name (Suno's "3 Bass", "12 Vocals", "0 Lead Vocals"; "Backing Vocals" is neither)
pub fn role_of(name: &str) -> Option<Role> {
    let n = name.to_lowercase();
    if n.contains("bass") { return Some(Role::Bass); }
    if n.contains("backing") || n.contains("choir") || n.contains("harmony") { return None; }
    if n.contains("lead") || n.contains("vocal") { return Some(Role::Lead); }
    None
}

/// The track's map file, from the project's audio.json (`<track file>` with `.music.json`)
pub(crate) fn map_path(dir: &Path, key: &str) -> Option<std::path::PathBuf> {
    let audio: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("audio.json")).ok()?).ok()?;
    let file = audio["music"][key]["file"].as_str()?;
    Some(dir.join(file).with_extension("music.json"))
}


pub fn check(dir: &Path, m: &Manifest) -> Result<Vec<Join>, ProjectError> {
    let Some(segs) = m.music.segments.clone().filter(|s| s.len() > 1) else { return Ok(vec![]) };
    let key = |i: usize| m.music.tracks.as_ref().and_then(|t| t.get(i)).cloned().unwrap_or_else(|| m.music.key.clone());
    let mut maps: HashMap<String, Option<Map>> = HashMap::new();
    let mut out = vec![];
    let mut t = 0.0;
    for i in 0..segs.len() - 1 {
        t += segs[i][1] - segs[i][0];
        let (ko, ki) = (key(i), key(i + 1));
        let (b, a) = (segs[i][1], segs[i + 1][0]);
        // the edit plays straight on here: no join to hear
        if ko == ki && (a - b).abs() < 0.005 { continue; }
        for k in [&ko, &ki] { maps.entry(k.clone()).or_insert_with(|| map_path(dir, k).and_then(|p| Map::load(&p))); }
        let (mo, mi) = (maps[&ko].as_ref(), maps[&ki].as_ref());
        let side = |k: &str, m: Option<&Map>, song: f64, bar: i64| Side { track: k.to_string(), song, bar: bar + 1, levels: m.map(|m| m.levels(bar)).unwrap_or_default() };
        let (Some(mo), Some(mi)) = (mo, mi) else {
            out.push(Join { index: i, t, out: side(&ko, None, b, 0), inn: side(&ki, None, a, 0), bass_fights: false, vocal_through: false, bar_shift: 0, repeat: false, suggest: vec![],
                unknown: Some(format!("no map for {}: run flex music on it", if mo.is_none() { &ko } else { &ki })) });
            continue;
        };
        // the bar that ends at the out-point, the bar that starts at the in-point (20 ms in, so a join on a bar line reads
        // the bars either side of it)
        let (bo, bi) = (mo.bar_at(b - 0.02), mi.bar_at(a + 0.02));
        let plays = |m: &Map, r, bar| m.level(r, bar).map(|l| l >= PLAYS);
        // where each point sits in its bar, in beats (4 to the bar), and how far the "1" moves
        let beat_in = |m: &Map, t: f64| { let x = (t - m.first) / m.bar * 4.; x - (x / 4.).floor() * 4. };
        let shift = ((beat_in(mi, a) - beat_in(mo, b)).round() as i64).rem_euclid(4);
        let whole = (a - b) / mo.bar;
        let repeat = ko == ki && (whole - whole.round()).abs() * mo.bar < 0.03 && whole.round().abs() <= 4.;
        let bass_fights = !repeat && plays(mo, Role::Bass, bo) == Some(true) && plays(mi, Role::Bass, bi) == Some(true);
        let vocal_through = !repeat && plays(mo, Role::Lead, bo) == Some(true) && plays(mi, Role::Lead, bi) == Some(true);
        let mut suggest = vec![];
        if bass_fights {
            // out-points: bar lines L within two bars of b where the outgoing bass rests in the bar before L
            for d in -2..=2i64 {
                let l = mo.first + (bo + 1 + d) as f64 * mo.bar;
                if d != 0 && mo.level(Role::Bass, bo + d).is_some_and(|v| v <= RESTS) { suggest.push(("out".into(), round3(l), round3(t + (l - b)))); }
            }
            // in-points: bar lines within two bars of a where the incoming bass rests in the bar after
            for d in -2..=2i64 {
                let l = mi.first + (bi + d) as f64 * mi.bar;
                if d != 0 && mi.level(Role::Bass, bi + d).is_some_and(|v| v <= RESTS) { suggest.push(("in".into(), round3(l), round3(t))); }
            }
        }
        out.push(Join { index: i, t: round3(t), out: side(&ko, Some(mo), b, bo), inn: side(&ki, Some(mi), a, bi), bass_fights, vocal_through, bar_shift: shift, repeat, suggest, unknown: None });
    }
    Ok(out)
}

fn round3(x: f64) -> f64 { (x * 1000.).round() / 1000. }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stem_roles() {
        assert_eq!(role_of("3 Bass"), Some(Role::Bass));
        assert_eq!(role_of("Bass"), Some(Role::Bass));
        assert_eq!(role_of("Lead Vocals"), Some(Role::Lead));
        assert_eq!(role_of("Vocals"), Some(Role::Lead));
        assert_eq!(role_of("Backing Vocals"), None);
        assert_eq!(role_of("Drums"), None);
    }

    #[test]
    fn bars_either_side_of_a_join_on_a_bar_line() {
        let m = Map { first: 2.31, bar: 2.4, stems: vec![("Bass".into(), vec![0, 5, 5, 0, 6])] };
        // a join at 7.11 (the end of bar 2, 0-based 1): out reads bar 1, in reads bar 2
        assert_eq!(m.bar_at(7.11 - 0.02), 1);
        assert_eq!(m.bar_at(7.11 + 0.02), 2);
        assert_eq!(m.level(Role::Bass, 3), Some(0));
    }
}
