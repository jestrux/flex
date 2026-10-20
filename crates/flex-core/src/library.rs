//! Flex's song library: songs made for Flex, listed in `library/songs.json` (built into Flex) with their beat grids
//! (`library/grids.json`). Their files are on the `library-v1` release of github.com/jestrux/flex, out of git: a song
//! is downloaded the first time a film uses it (`music: { key: "night-drift" }`), or ahead with `flex library pull`.
//!
//! On disk, in `$FLEX_LIBRARY` (default `<support>/library/`): `library.json`, the songs as the pipeline's library
//! entries (paths relative to it; the pipeline reads it through patch 17), and per song `<key>/<key>.mp3` with its
//! `<key>.grid.json` beside it, and its stems in `<key>/stems/` once pulled. The list and the grids are written on
//! every pipeline run, so a film can name any song; only its files wait for the download.

use crate::project::{login_path, support_dir, ProjectError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const SONGS: &str = include_str!("../../../library/songs.json");
const GRIDS: &str = include_str!("../../../library/grids.json");

/// A file on the release: where it is and what it must be.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Remote {
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Song {
    pub key: String,
    pub title: String,
    pub bpm: f64,
    pub duration: f64,
    /// vocals, chant or instrumental
    pub vocals: String,
    pub genre: String,
    pub mood: String,
    #[serde(default)]
    pub energy: Option<String>,
    #[serde(default)]
    pub sections: Option<String>,
    #[serde(default)]
    pub ending: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub suits: Vec<String>,
    pub source: String,
    pub licence: String,
    #[serde(default)]
    pub attribution: Option<String>,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub stems: Option<Remote>,
}

impl Song {
    pub fn file(&self) -> Remote { Remote { url: self.url.clone(), size: self.size, sha256: self.sha256.clone() } }
}

#[derive(Deserialize)]
struct Manifest { songs: Vec<Song> }

/// Every song in the library, in its order.
pub fn songs() -> Vec<Song> { serde_json::from_str::<Manifest>(SONGS).expect("library/songs.json").songs }

pub fn song(key: &str) -> Option<Song> { songs().into_iter().find(|s| s.key == key) }

/// A song's beat grid (built in, so it's there before the song is downloaded).
pub fn grid(key: &str) -> Option<serde_json::Value> {
    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(GRIDS).ok()?.remove(key)
}

/// Where the songs live: `$FLEX_LIBRARY`, else `<support>/library`.
pub fn dir() -> PathBuf {
    std::env::var_os("FLEX_LIBRARY").map(PathBuf::from).unwrap_or_else(|| support_dir().join("library"))
}

pub fn mp3(key: &str) -> PathBuf { dir().join(key).join(format!("{key}.mp3")) }
pub fn stems_dir(key: &str) -> PathBuf { dir().join(key).join("stems") }

/// The song's mp3 is here, whole.
pub fn downloaded(s: &Song) -> bool { fs::metadata(mp3(&s.key)).map(|m| m.len() == s.size).unwrap_or(false) }

pub fn has_stems(key: &str) -> bool { fs::read_dir(stems_dir(key)).map(|mut d| d.next().is_some()).unwrap_or(false) }

/// Write the list (`library.json`) and every song's grid, when they differ from what's there. Returns the folder.
pub fn catalogue() -> Result<PathBuf, ProjectError> {
    let d = dir();
    let grids: serde_json::Map<String, serde_json::Value> = serde_json::from_str(GRIDS).expect("library/grids.json");
    let mut music = serde_json::Map::new();
    for s in songs() {
        music.insert(s.key.clone(), serde_json::json!({
            "file": format!("{0}/{0}.mp3", s.key), "mood": s.mood, "bpm": s.bpm,
            "source": s.source, "licence": s.licence, "attribution": s.attribution,
        }));
        if let Some(g) = grids.get(&s.key) { write_if_changed(&d.join(&s.key).join(format!("{}.grid.json", s.key)), &g.to_string())?; }
    }
    write_if_changed(&d.join("library.json"), &serde_json::to_string_pretty(&serde_json::json!({ "sfx": {}, "music": music })).expect("json"))?;
    Ok(d)
}

fn write_if_changed(p: &Path, s: &str) -> Result<(), ProjectError> {
    if fs::read_to_string(p).ok().as_deref() == Some(s) { return Ok(()); }
    fs::create_dir_all(p.parent().unwrap())?;
    let tmp = p.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, s)?;
    fs::rename(tmp, p)?;
    Ok(())
}

/// Point a pipeline run at the library (and write its list and grids). A failure to write them only loses the songs.
pub fn apply(c: &mut Command) {
    match catalogue() {
        Ok(d) => { c.env("FLEX_LIBRARY", d); }
        Err(e) => eprintln!("flex: the song library isn't available: {e}"),
    }
}

/// The song's mp3, downloaded if it isn't here yet. `None` when `key` isn't one of the library's songs.
pub fn ensure(key: &str) -> Result<Option<PathBuf>, ProjectError> {
    let Some(s) = song(key) else { return Ok(None) };
    catalogue()?;
    let p = mp3(key);
    if !downloaded(&s) { download(&s.file(), &p)?; }
    Ok(Some(p))
}

/// The song's stems folder, downloaded and unpacked if it isn't here yet.
pub fn ensure_stems(key: &str) -> Result<PathBuf, ProjectError> {
    let s = song(key).ok_or_else(|| ProjectError::Invalid(format!("no song \"{key}\" in Flex's library (flex library lists them)")))?;
    let r = s.stems.ok_or_else(|| ProjectError::Invalid(format!("\"{key}\" has no stems")))?;
    let out = stems_dir(key);
    if has_stems(key) { return Ok(out); }
    let zip = dir().join(key).join(format!("{key}-stems.zip"));
    download(&r, &zip)?;
    let tmp = out.with_extension(format!("tmp{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp)?;
    let st = Command::new("ditto").args(["-x", "-k"]).arg(&zip).arg(&tmp).status()?;
    if !st.success() { let _ = fs::remove_dir_all(&tmp); return Err(ProjectError::Run(format!("couldn't unpack {}", zip.display()))); }
    let _ = fs::remove_dir_all(&out);
    fs::rename(&tmp, &out)?;
    fs::remove_file(&zip)?;
    Ok(out)
}

/// Fetch `r` to `dest` (curl), checking its size and sha256 before it takes the name.
pub fn download(r: &Remote, dest: &Path) -> Result<(), ProjectError> {
    fs::create_dir_all(dest.parent().unwrap())?;
    let part = dest.with_extension(format!("part{}", std::process::id()));
    eprintln!("flex: downloading {} ({:.1} MB)", r.url, r.size as f64 / 1e6);
    let st = Command::new("curl").args(["-fsSL", "--retry", "2", "-o"]).arg(&part).arg(&r.url).env("PATH", login_path()).status()?;
    let fail = |why: String| { let _ = fs::remove_file(&part); Err(ProjectError::Run(why)) };
    if !st.success() { return fail(format!("couldn't download {} (curl exited {})", r.url, st.code().unwrap_or(-1))); }
    let size = fs::metadata(&part)?.len();
    if size != r.size { return fail(format!("{}: got {size} bytes, expected {}", r.url, r.size)); }
    let sum = sha256(&part)?;
    if sum != r.sha256 { return fail(format!("{}: checksum {sum} doesn't match {}", r.url, r.sha256)); }
    fs::rename(&part, dest)?;
    Ok(())
}

fn sha256(p: &Path) -> Result<String, ProjectError> {
    let out = Command::new("shasum").args(["-a", "256"]).arg(p).output()?;
    if !out.status.success() { return Err(ProjectError::Run(format!("shasum failed on {}", p.display()))); }
    Ok(String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap_or_default().to_string())
}
