//! Cheap media facts from file headers: a WAV's length from its chunks, an mp4's from its `mvhd` and its picture size
//! from the video track's `tkhd`, an image's size from its header. Anything else (an mp3's length) asks ffprobe once and
//! remembers the answer by path, size and date, so a rescan costs nothing.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

type Key = (PathBuf, u64, u64);
fn key(p: &Path) -> Option<Key> {
    let m = std::fs::metadata(p).ok()?;
    let t = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos() as u64;
    Some((p.to_path_buf(), m.len(), t))
}
fn memo() -> &'static Mutex<HashMap<Key, Option<f64>>> {
    static M: OnceLock<Mutex<HashMap<Key, Option<f64>>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

/// An audio file's length in seconds.
pub fn audio_duration(p: &Path) -> Option<f64> {
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    if ext == "wav" { if let Some(d) = wav_duration(p) { return Some(d); } }
    let k = key(p)?;
    if let Some(d) = memo().lock().unwrap().get(&k) { return *d; }
    // on disk too: the CLI is a new process each time, and starting ffprobe (with the login PATH) costs ~0.5 s
    let mut h = std::collections::hash_map::DefaultHasher::new();
    k.hash(&mut h);
    let disk = crate::project::support_dir().join("assets").join("probe").join(format!("{:016x}", h.finish()));
    let d = match std::fs::read_to_string(&disk) {
        Ok(s) => s.trim().parse().ok(),
        Err(_) => {
            let d = ffprobe_duration(p);
            if let Some(parent) = disk.parent() { let _ = std::fs::create_dir_all(parent); }
            let _ = std::fs::write(&disk, d.map(|d| d.to_string()).unwrap_or_default());
            d
        }
    };
    memo().lock().unwrap().insert(k, d);
    d
}

fn ffprobe_duration(p: &Path) -> Option<f64> {
    let o = std::process::Command::new("ffprobe").env("PATH", crate::project::login_path())
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]).arg(p).output().ok()?;
    String::from_utf8_lossy(&o.stdout).trim().parse().ok()
}

/// A RIFF/WAVE file's length: the data chunk's size over the fmt chunk's byte rate.
pub fn wav_duration(p: &Path) -> Option<f64> {
    let mut f = File::open(p).ok()?;
    let mut h = [0u8; 12];
    f.read_exact(&mut h).ok()?;
    if &h[0..4] != b"RIFF" || &h[8..12] != b"WAVE" { return None; }
    let mut byte_rate = None;
    loop {
        let mut c = [0u8; 8];
        f.read_exact(&mut c).ok()?;
        let size = u32::from_le_bytes([c[4], c[5], c[6], c[7]]) as u64;
        match &c[0..4] {
            b"fmt " => {
                let mut fmt = vec![0u8; size.min(64) as usize];
                f.read_exact(&mut fmt).ok()?;
                if fmt.len() < 12 { return None; }
                byte_rate = Some(u32::from_le_bytes([fmt[8], fmt[9], fmt[10], fmt[11]]) as f64);
                if size > 64 { f.seek(SeekFrom::Current(size as i64 - 64)).ok()?; }
            }
            b"data" => {
                let br = byte_rate.filter(|b| *b > 0.0)?;
                // a streamed WAV may leave the size at 0 or u32::MAX: take the rest of the file then
                let size = if size == 0 || size == u32::MAX as u64 { f.metadata().ok()?.len().saturating_sub(f.stream_position().ok()?) } else { size };
                return Some(size as f64 / br);
            }
            _ => { f.seek(SeekFrom::Current((size + (size & 1)) as i64)).ok()?; }
        }
    }
}

/// An image's pixel size from its header (PNG and JPEG; other formats aren't measured).
pub fn image_size(p: &Path) -> Option<(u32, u32)> {
    image::image_dimensions(p).ok()
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Mp4Info { pub duration: Option<f64>, pub width: Option<u32>, pub height: Option<u32> }

/// An mp4's length (`moov/mvhd`) and its video track's size (the first `trak/tkhd` with a size), by walking the box
/// headers only: the media data is skipped, never read.
pub fn mp4_info(p: &Path) -> Option<Mp4Info> {
    let mut f = File::open(p).ok()?;
    let len = f.metadata().ok()?.len();
    let (start, size) = find_box(&mut f, 0, len, b"moov")?;
    // moov is small (kilobytes): read it whole
    if size > 64 << 20 { return None; }
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut moov = vec![0u8; size as usize];
    f.read_exact(&mut moov).ok()?;
    let mut info = Mp4Info::default();
    for (kind, body) in boxes(&moov) {
        match &kind {
            b"mvhd" => {
                let (scale, dur) = if body.first() == Some(&1) {
                    (be32(body, 20)? as f64, be64(body, 24)? as f64)
                } else {
                    (be32(body, 12)? as f64, be32(body, 16)? as f64)
                };
                if scale > 0.0 { info.duration = Some(dur / scale); }
            }
            b"trak" if info.width.is_none() => {
                if let Some((_, tk)) = boxes(body).into_iter().find(|(k, _)| k == b"tkhd") {
                    // width and height are 16.16 fixed point, the last 8 bytes of tkhd
                    let n = tk.len();
                    if n >= 8 {
                        let (w, h) = (be32(tk, n - 8)? >> 16, be32(tk, n - 4)? >> 16);
                        if w > 0 && h > 0 { info.width = Some(w); info.height = Some(h); }
                    }
                }
            }
            _ => {}
        }
    }
    Some(info)
}

fn be32(b: &[u8], at: usize) -> Option<u32> { Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?)) }
fn be64(b: &[u8], at: usize) -> Option<u64> { Some(u64::from_be_bytes(b.get(at..at + 8)?.try_into().ok()?)) }

/// The child boxes in a box's body: (type, body).
fn boxes(b: &[u8]) -> Vec<([u8; 4], &[u8])> {
    let mut out = vec![];
    let mut i = 0;
    while i + 8 <= b.len() {
        let mut size = be32(b, i).unwrap_or(0) as usize;
        let kind: [u8; 4] = b[i + 4..i + 8].try_into().unwrap();
        let mut head = 8;
        if size == 1 { size = be64(b, i + 8).unwrap_or(0) as usize; head = 16; }
        if size == 0 { size = b.len() - i; }
        if size < head || i + size > b.len() { break; }
        out.push((kind, &b[i + head..i + size]));
        i += size;
    }
    out
}

/// A top-level box in the file: (body start, body size).
fn find_box(f: &mut File, mut at: u64, end: u64, want: &[u8; 4]) -> Option<(u64, u64)> {
    while at + 8 <= end {
        f.seek(SeekFrom::Start(at)).ok()?;
        let mut h = [0u8; 16];
        f.read_exact(&mut h[..8]).ok()?;
        let mut size = u32::from_be_bytes(h[0..4].try_into().ok()?) as u64;
        let mut head = 8;
        if size == 1 { f.read_exact(&mut h[8..16]).ok()?; size = u64::from_be_bytes(h[8..16].try_into().ok()?); head = 16; }
        if size == 0 { size = end - at; }
        if size < head { return None; }
        if &h[4..8] == want { return Some((at + head, size - head)); }
        at += size;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// a minimal WAV: 8 kHz mono 16-bit, `n` samples
    pub fn wav(n: usize) -> Vec<u8> {
        let data = n * 2;
        let mut v = b"RIFF".to_vec();
        v.extend(((36 + data) as u32).to_le_bytes());
        v.extend(b"WAVEfmt ");
        v.extend(16u32.to_le_bytes());
        v.extend(1u16.to_le_bytes()); v.extend(1u16.to_le_bytes());
        v.extend(8000u32.to_le_bytes()); v.extend(16000u32.to_le_bytes());
        v.extend(2u16.to_le_bytes()); v.extend(16u16.to_le_bytes());
        v.extend(b"LIST"); v.extend(4u32.to_le_bytes()); v.extend(b"INFO");
        v.extend(b"data"); v.extend((data as u32).to_le_bytes());
        v.extend(std::iter::repeat_n(0u8, data));
        v
    }

    #[test]
    fn wav_length_from_its_chunks() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.wav");
        std::fs::write(&p, wav(12000)).unwrap();
        assert_eq!(wav_duration(&p), Some(1.5));
        assert_eq!(audio_duration(&p), Some(1.5));
    }

    #[test]
    fn mp4_boxes() {
        // ftyp, then moov { mvhd v0 (timescale 1000, duration 2500), trak { tkhd with 1920×1080 } }, then mdat
        let bx = |k: &[u8], body: Vec<u8>| { let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec(); v.extend(k); v.extend(body); v };
        let mut mvhd = vec![0u8; 100];
        mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
        mvhd[16..20].copy_from_slice(&2500u32.to_be_bytes());
        let mut tkhd = vec![0u8; 84];
        tkhd[76..80].copy_from_slice(&(1920u32 << 16).to_be_bytes());
        tkhd[80..84].copy_from_slice(&(1080u32 << 16).to_be_bytes());
        let moov = bx(b"moov", [bx(b"mvhd", mvhd), bx(b"trak", bx(b"tkhd", tkhd))].concat());
        let file = [bx(b"ftyp", b"isom0000".to_vec()), bx(b"mdat", vec![7u8; 4096]), moov].concat();
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.mp4");
        std::fs::write(&p, file).unwrap();
        assert_eq!(mp4_info(&p), Some(Mp4Info { duration: Some(2.5), width: Some(1920), height: Some(1080) }));
    }
}
