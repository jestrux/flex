//! A project's finished renders: the mp4s in a renders folder whose names are the project's. The
//! app lets the author choose the folder per project; the default is Flex's own
//! `~/Downloads/flex-videos/<name>/` (also where exports start). The pipeline's own output folder,
//! `~/Downloads/fancy-e2e-videos/<out>/` (`out_dir`), can be chosen instead. Names: `<name>[@size].mp4` (the whole film) or
//! `<name>--<scene>[@size].mp4` (one scene, maybe a variant like `outro-dark`). Labs
//! (`<name>-lab-…`) are other projects and aren't listed.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Render {
    pub path: PathBuf,
    pub file: String,
    pub bytes: u64,
    /// modified, seconds since 1970
    pub modified: f64,
    /// `None` = the whole film; else what follows `--` (a scene id, maybe with a variant suffix)
    pub part: Option<String>,
    /// "@4k", "@720p" …; empty for 1080p
    pub size: String,
}

/// Flex's default folder for a project's renders and exports, `~/Downloads/flex-videos/<name>/`,
/// created on first use.
pub fn default_dir(name: &str) -> PathBuf {
    let d = dirs::home_dir().unwrap_or_default().join("Downloads/flex-videos").join(name);
    let _ = std::fs::create_dir_all(&d);
    d
}

/// The pipeline's output folder for a project with this `out:`.
pub fn out_dir(out: Option<&str>) -> PathBuf {
    let base = std::env::var_os("OUT_DIR").map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Downloads/fancy-e2e-videos"));
    match out { Some(o) if !o.is_empty() => base.join(o), _ => base }
}

/// What a file name says, if it's one of this project's renders.
pub fn parse(name: &str, file: &str) -> Option<(Option<String>, String)> {
    if file.ends_with(".rendering.mp4") { return None; } // a render still being written (swapped in when complete)
    let stem = file.strip_suffix(".mp4")?.strip_prefix(name)?;
    let (rest, size) = match stem.rfind('@') { Some(i) => (&stem[..i], stem[i..].to_string()), None => (stem, String::new()) };
    if rest.is_empty() { return Some((None, size)); }
    let part = rest.strip_prefix("--")?;
    (!part.is_empty()).then(|| (Some(part.to_string()), size))
}

/// The renders in `dir` for project `name`, newest first.
pub fn list(dir: &Path, name: &str) -> Vec<Render> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<Render> = rd.filter_map(|e| {
        let e = e.ok()?;
        let file = e.file_name().to_string_lossy().into_owned();
        let (part, size) = parse(name, &file)?;
        let meta = e.metadata().ok()?;
        if meta.len() == 0 { return None; }
        let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs_f64();
        Some(Render { path: e.path(), file, bytes: meta.len(), modified, part, size })
    }).collect();
    out.sort_by(|a, b| b.modified.total_cmp(&a.modified));
    out
}

/// Any video file, for A/B from wherever it lives: what its name says if it's one of this
/// project's renders, else taken as the whole film.
pub fn describe(path: &Path, name: &str) -> Option<Render> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() { return None; }
    let file = path.file_name()?.to_string_lossy().into_owned();
    let (part, size) = parse(name, &file).unwrap_or((None, String::new()));
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs_f64();
    Some(Render { path: path.to_path_buf(), file, bytes: meta.len(), modified, part, size })
}

/// The scene a render's part belongs to: the longest scene id it starts with (`outro-dark` → `outro`).
pub fn scene_of<'a>(part: &str, scenes: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    scenes.into_iter().filter(|id| part == *id || part.starts_with(&format!("{id}-"))).max_by_key(|id| id.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        let n = "circles-overview";
        assert_eq!(parse(n, "circles-overview.mp4"), Some((None, String::new())));
        assert_eq!(parse(n, "circles-overview@4k.mp4"), Some((None, "@4k".into())));
        assert_eq!(parse(n, "circles-overview--book@4k.mp4"), Some((Some("book".into()), "@4k".into())));
        assert_eq!(parse(n, "circles-overview--outro-dark.mp4"), Some((Some("outro-dark".into()), String::new())));
        assert_eq!(parse(n, "circles-overview-lab-join-1--join.mp4"), None);
        assert_eq!(parse(n, "circles-overview.srt"), None);
        assert_eq!(parse(n, "other.mp4"), None);
        assert_eq!(parse(n, "circles-overview@4k.rendering.mp4"), None);
        assert_eq!(parse(n, "circles-overview.rendering.mp4"), None);
    }

    #[test]
    fn scenes() {
        let ids = ["outro", "ui-tour", "ui"];
        assert_eq!(scene_of("outro-dark", ids), Some("outro"));
        assert_eq!(scene_of("ui-tour", ids), Some("ui-tour"));
        assert_eq!(scene_of("nope", ids), None);
    }
}
