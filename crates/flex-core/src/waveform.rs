//! The music's waveform on the film's clock: peaks of the song, played through the music edit
//! (its stretches back to back), so they line up with the timeline.
//!
//! The song is decoded once by `ffmpeg` (mono, 8 kHz) and the peaks are cached in
//! `<support>/waveform/<hash>.f32` (little-endian f32s), keyed by the file's path, size and
//! mtime, the edit and the resolution.

use crate::project::{login_path, support_dir, ProjectError};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

const RATE: u32 = 8000;

/// Peaks (0–1, the largest |sample| in each bin), `per_second` bins per film second.
/// `segments` is the music edit in song seconds; empty = the song as it is.
pub fn peaks(file: &Path, segments: &[[f64; 2]], per_second: u32) -> Result<Vec<f32>, ProjectError> {
    let per_second = per_second.clamp(1, 1000);
    let meta = std::fs::metadata(file)?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    file.hash(&mut h);
    meta.len().hash(&mut h);
    meta.modified().ok().hash(&mut h);
    for s in segments { s[0].to_bits().hash(&mut h); s[1].to_bits().hash(&mut h); }
    per_second.hash(&mut h);
    let dir = support_dir().join("waveform");
    let cached = dir.join(format!("{:016x}.f32", h.finish()));
    if let Ok(b) = std::fs::read(&cached) {
        return Ok(b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect());
    }
    let song = decode(file)?;
    let out = edit_peaks(&song, segments, per_second);
    std::fs::create_dir_all(&dir)?;
    let tmp: PathBuf = cached.with_extension("tmp");
    std::fs::write(&tmp, out.iter().flat_map(|p| p.to_le_bytes()).collect::<Vec<u8>>())?;
    std::fs::rename(&tmp, &cached)?;
    Ok(out)
}

/// The song as mono samples at 8 kHz, by ffmpeg.
fn decode(file: &Path) -> Result<Vec<f32>, ProjectError> {
    let o = Command::new("ffmpeg").env("PATH", login_path())
        .args(["-v", "error", "-i"]).arg(file)
        .args(["-ac", "1", "-ar", &RATE.to_string(), "-f", "f32le", "-"])
        .output().map_err(|e| ProjectError::Run(format!("ffmpeg: {e}")))?;
    if !o.status.success() { return Err(ProjectError::Run(format!("ffmpeg couldn't read {}: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    Ok(o.stdout.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
}

/// The edit's samples, back to back, binned into peaks.
fn edit_peaks(song: &[f32], segments: &[[f64; 2]], per_second: u32) -> Vec<f32> {
    let at = |t: f64| ((t * RATE as f64).round().max(0.0) as usize).min(song.len());
    let edited: Vec<f32> = if segments.is_empty() { song.to_vec() } else {
        segments.iter().filter(|s| s[1] > s[0]).flat_map(|s| song[at(s[0])..at(s[1])].iter().copied()).collect()
    };
    let bin = (RATE / per_second).max(1) as usize;
    edited.chunks(bin).map(|c| c.iter().fold(0f32, |m, x| m.max(x.abs())).min(1.0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_edit_is_spliced_then_binned() {
        // one second of silence, then one second at 0.5
        let song: Vec<f32> = (0..2 * RATE as usize).map(|i| if i < RATE as usize { 0.0 } else { -0.5 }).collect();
        assert_eq!(edit_peaks(&song, &[], 2), vec![0.0, 0.0, 0.5, 0.5]);
        // the loud second first, then the silent one
        assert_eq!(edit_peaks(&song, &[[1.0, 2.0], [0.0, 1.0]], 1), vec![0.5, 0.0]);
    }
}
