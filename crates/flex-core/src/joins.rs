//! The join check: is every scene boundary seamless, or does the picture jump?
//!
//! For each boundary (a scene's first frame, after the first scene) it paints the frames
//! `first-2`, `first-1` and `first` small (480 wide, cached like any frame), and takes the mean
//! absolute difference (0–255 per channel) across the cut, `first-1 → first`, and a baseline
//! of ordinary motion just before it, `first-2 → first-1`. A join **jumps** when the cut is much
//! bigger than the motion leading into it, and visible: `mean > max(3 × baseline + 1, 3)` (the
//! floor lets a drop's bump or a cursor moving over a still frame pass). A boundary the project
//! declares as a deliberate hard cut (`markers.cuts`, within half a frame) is a `cut`, never a jump.

use crate::frames::{FrameState, Session};
use crate::project::ProjectError;
use serde::Serialize;
use std::path::Path;

/// Joins are checked at this width: enough to see a jump, cheap to paint.
pub const JOIN_WIDTH: u32 = 480;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct JoinCheck {
    /// the scene that starts here, and the one before it
    pub scene: String,
    pub prev: String,
    /// the scene's first frame, and film seconds
    pub frame: u32,
    pub t: f64,
    /// mean difference across the cut (first-1 → first), 0–255
    pub mean: f64,
    /// mean difference just before it (first-2 → first-1)
    pub baseline: f64,
    /// `mean > max(3 × baseline + 1, 3)`, and not a declared cut
    pub jumps: bool,
    /// the project declares a deliberate hard cut here (markers.cuts): meant to jump
    pub cut: bool,
    /// why it couldn't be checked (a take placeholder, a scene that threw); `jumps` is false then
    pub unknown: Option<String>,
}

/// The rule: a cut that changes the picture much more than the motion leading into it.
pub fn jumps(mean: f64, baseline: f64) -> bool { mean > threshold(baseline) }

/// The difference above which a cut jumps, given the motion before it.
pub fn threshold(baseline: f64) -> f64 { (3.0 * baseline + 1.0).max(3.0) }

/// Mean absolute difference per channel between two images of the same size.
pub fn mean_difference(a: &Path, b: &Path) -> Result<f64, String> {
    let a = image::open(a).map_err(|e| e.to_string())?.to_rgb8();
    let b = image::open(b).map_err(|e| e.to_string())?.to_rgb8();
    if a.dimensions() != b.dimensions() { return Err(format!("sizes differ: {:?} vs {:?}", a.dimensions(), b.dimensions())); }
    let sum: u64 = a.as_raw().iter().zip(b.as_raw()).map(|(x, y)| x.abs_diff(*y) as u64).sum();
    Ok(sum as f64 / a.as_raw().len().max(1) as f64)
}

/// Check every scene boundary of the session's film (painting what isn't cached at 480).
pub fn check(s: &Session) -> Result<Vec<JoinCheck>, ProjectError> {
    let m = s.manifest();
    let cuts = m.markers.as_ref().map(|k| k.cuts.clone()).unwrap_or_default();
    let mut out = vec![];
    for w in m.scenes.windows(2) {
        let (prev, sc) = (&w[0], &w[1]);
        let f = sc.first;
        let mut row = JoinCheck { scene: sc.id.clone(), prev: prev.id.clone(), frame: f, t: f as f64 / m.fps as f64,
            mean: 0.0, baseline: 0.0, jumps: false, unknown: None,
            cut: cuts.iter().any(|c| (c * m.fps as f64 - f as f64).abs() <= 0.5) };
        if f < 2 { row.unknown = Some("too near the start".into()); out.push(row); continue; }
        let paths: Result<Vec<_>, String> = [f - 2, f - 1, f].iter().map(|&g| match s.frame(g, JOIN_WIDTH) {
            Ok(FrameState::Cached(p)) => Ok(p),
            Ok(FrameState::Placeholder(why)) => Err(format!("frame {g}: {}", why.lines().next().unwrap_or(""))),
            Err(e) => Err(format!("frame {g}: {e}")),
        }).collect();
        match paths.and_then(|p| Ok((mean_difference(&p[0], &p[1])?, mean_difference(&p[1], &p[2])?))) {
            Ok((baseline, mean)) => { row.baseline = baseline; row.mean = mean; row.jumps = !row.cut && jumps(mean, baseline); }
            Err(e) => row.unknown = Some(e),
        }
        out.push(row);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rule() {
        assert!(!jumps(0.5, 0.0), "a near-identical cut is seamless");
        assert!(!jumps(2.09, 0.0), "a bump or a cursor over a still frame passes the floor");
        assert!(jumps(7.87, 0.0), "a new picture after a still frame jumps");
        assert!(!jumps(10.0, 4.0), "a cut inside fast motion is seamless");
        assert!(jumps(14.0, 4.0));
    }

    #[test]
    fn mean_of_two_images() {
        let d = tempfile::tempdir().unwrap();
        let (a, b) = (d.path().join("a.png"), d.path().join("b.png"));
        image::RgbImage::from_pixel(4, 4, image::Rgb([10, 10, 10])).save(&a).unwrap();
        image::RgbImage::from_pixel(4, 4, image::Rgb([16, 10, 4])).save(&b).unwrap();
        assert!((mean_difference(&a, &b).unwrap() - 4.0).abs() < 1e-9);
        assert_eq!(mean_difference(&a, &a).unwrap(), 0.0);
    }
}
