//! A project: one fancy-e2e-videos film in its own folder (`project.ts`, `look.ts`, `scenes/`,
//! `hits.ts`, `audio.json`, assets). Opening one finds the fancy-e2e-videos checkout it belongs
//! to and reads its outline through the pipeline itself, never by parsing TypeScript here.

use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The outline reader, run with the pipeline's own tsx. Embedded so the app needs no checkout of
/// this repo; written to the support folder on first use.
const OUTLINE_SCRIPT: &str = include_str!("../../../server/outline.mts");
/// The import redirect: projects import `…/fancy-e2e-videos/lib/…`; Flex runs them against its own copy.
const REDIRECT: &str = include_str!("../../../server/redirect.mjs");
const REDIRECT_HOOKS: &str = include_str!("../../../server/redirect-hooks.mjs");
const PERSONAS: &str = include_str!("../../../server/personas.mts");

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("{0} is not a project folder: it has no project.ts")]
    NotAProject(PathBuf),
    #[error("project.ts doesn't import fancy-e2e-videos (looked for a path ending in fancy-e2e-videos/lib/project.ts)")]
    NoPipelineImport,
    #[error("project.ts points at {0}, but there is no fancy-e2e-videos checkout there")]
    PipelineMissing(PathBuf),
    #[error("fancy-e2e-videos at {0} has no node_modules: run `npm install` there")]
    PipelineNotInstalled(PathBuf),
    #[error("couldn't run the pipeline: {0}")]
    Run(String),
    #[error("the project didn't load:\n{0}")]
    Load(String),
    /// a request that can't be done as asked (an unknown id, an end before its start)
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Deserialize)]
pub struct Item {
    pub kind: String,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub take: Option<String>,
    /// ms, when the item gives one
    pub dur: Option<f64>,
}

impl Item {
    /// a short name for the item: the card's key (`fold` for `circles-overview/fold`), a take's id
    pub fn label(&self) -> String {
        if let Some(t) = &self.take { return t.clone(); }
        match &self.item_type {
            Some(t) => t.rsplit('/').next().unwrap_or(t).to_string(),
            None => self.kind.clone(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Scene {
    pub id: String,
    /// film seconds
    pub start: f64,
    pub end: f64,
    pub note: Option<String>,
    pub items: Vec<Item>,
    /// the scene's file, `scenes/NN-<id>.ts`, when there is one
    #[serde(skip)]
    pub file: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Music {
    pub key: String,
    /// the edit: stretches of the song (song seconds) played back to back
    pub segments: Option<Vec<[f64; 2]>>,
    /// the track each stretch plays (one music key per stretch; none = `key` throughout): a film can change songs at a join
    #[serde(default)]
    pub tracks: Option<Vec<String>>,
    /// where the film starts in the song (song seconds; without an edit)
    #[serde(default)]
    pub from: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
struct Outline {
    ok: bool,
    error: Option<String>,
    name: Option<String>,
    feel: Option<String>,
    music: Option<Music>,
    duration: Option<f64>,
    scenes: Option<Vec<Scene>>,
}

#[derive(Debug, Clone)]
pub struct Project {
    pub dir: PathBuf,
    /// the fancy-e2e-videos checkout
    pub pipeline: PathBuf,
    pub name: String,
    pub feel: String,
    pub music: Music,
    /// the track's file, from the project's audio.json, when it has the key
    pub music_file: Option<PathBuf>,
    /// film seconds
    pub duration: f64,
    pub scenes: Vec<Scene>,
}

/// Flex's own copy of the pipeline (scripts/sync-pipeline.sh), which runs every project: `FLEX_PIPELINE` if set, else
/// the app bundle's `Resources/pipeline`, else the repo's `pipeline/` (a dev build). A project's own import of a
/// fancy-e2e-videos checkout is redirected to it (server/redirect.mjs), so no checkout is needed.
pub fn bundled_pipeline() -> Result<PathBuf, ProjectError> {
    let mut tried = Vec::new();
    if let Some(p) = std::env::var_os("FLEX_PIPELINE") { tried.push(PathBuf::from(p)); }
    // (through a link, e.g. ~/.flex/bin/flex → the app's Contents/Helpers/flex: the app's own pipeline)
    if let Ok(exe) = std::env::current_exe().and_then(fs::canonicalize) {
        if let Some(contents) = exe.parent().and_then(|m| m.parent()) { tried.push(contents.join("Resources/pipeline")); }
    }
    tried.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../pipeline"));
    for p in &tried {
        if p.join("lib/project.ts").exists() { return fs::canonicalize(p).map_err(|_| ProjectError::PipelineMissing(p.clone())); }
    }
    Err(ProjectError::PipelineMissing(tried.pop().unwrap_or_default()))
}

/// The pipeline a project runs on: Flex's own copy. (A project still has to be one: it needs a `project.ts`.)
pub fn find_pipeline(dir: &Path) -> Result<PathBuf, ProjectError> {
    if !dir.join("project.ts").exists() { return Err(ProjectError::NotAProject(dir.to_path_buf())); }
    bundled_pipeline()
}

/// Write an embedded script into the support folder (only when it changed); its path.
pub fn support_script(name: &str, body: &str) -> Result<PathBuf, ProjectError> {
    let path = support_dir().join("server").join(name);
    if fs::read_to_string(&path).ok().as_deref() != Some(body) {
        fs::create_dir_all(path.parent().unwrap())?;
        fs::write(&path, body)?;
    }
    Ok(path)
}

/// The redirect, written next to the other scripts; pass it as `--import <path>` to tsx.
pub fn redirect_script() -> Result<PathBuf, ProjectError> {
    support_script("redirect-hooks.mjs", REDIRECT_HOOKS)?;
    support_script("personas.mts", PERSONAS)?;
    support_script("redirect.mjs", REDIRECT)
}

/// Flex's narration cache: `FLEX_VOICE_CACHE`, else `<support>/voice` (scripts/seed-voices.sh can fill it from a
/// fancy-e2e-videos checkout, so lines it has already spoken aren't spoken again).
pub fn voice_cache() -> PathBuf {
    std::env::var_os("FLEX_VOICE_CACHE").map(PathBuf::from).unwrap_or_else(|| support_dir().join("voice"))
}

/// Where Flex keeps its own files (the outline script; later the frame cache).
pub fn support_dir() -> PathBuf {
    let base = std::env::var_os("FLEX_SUPPORT").map(PathBuf::from)
        .unwrap_or_else(|| dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Flex"));
    let _ = fs::create_dir_all(&base);
    base
}

fn outline_script() -> Result<PathBuf, ProjectError> { support_script("outline.mts", OUTLINE_SCRIPT) }

/// `scenes/NN-<id>.ts` for each scene id
fn scene_files(dir: &Path, scenes: &mut [Scene]) {
    let Ok(rd) = fs::read_dir(dir.join("scenes")) else { return };
    let files: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "ts")).collect();
    for s in scenes.iter_mut() {
        s.file = files.iter().find(|p| {
            let stem = p.file_stem().unwrap_or_default().to_string_lossy();
            // the order prefix: digits, optionally a letter ("03b-book" sits between 03 and 04)
            let rest = stem.split_once('-').map(|(n, r)| if n.starts_with(|c: char| c.is_ascii_digit()) && n.chars().all(|c| c.is_ascii_alphanumeric()) { r } else { &*stem }).unwrap_or(&stem);
            rest == s.id
        }).cloned();
    }
}

/// The track's file: from the project's audio.json, else the pipeline's own library.
fn music_file(dir: &Path, pipeline: &Path, key: &str) -> Option<PathBuf> {
    let look = |manifest: PathBuf, base: &Path| -> Option<PathBuf> {
        let raw: serde_json::Value = serde_json::from_str(&fs::read_to_string(manifest).ok()?).ok()?;
        let rel = raw.get("music")?.get(key)?.get("file")?.as_str()?;
        let p = base.join(rel);
        p.exists().then_some(p)
    };
    look(dir.join("audio.json"), dir).or_else(|| look(pipeline.join("assets/library.json"), &pipeline.join("assets")))
}

impl Project {
    /// Open a project folder: find its pipeline and read its outline (about a second).
    pub fn open(dir: &Path) -> Result<Project, ProjectError> {
        let dir = fs::canonicalize(dir).map_err(|_| ProjectError::NotAProject(dir.to_path_buf()))?;
        if !dir.join("project.ts").exists() { return Err(ProjectError::NotAProject(dir)); }
        let pipeline = find_pipeline(&dir)?;
        let tsx = pipeline.join("node_modules/.bin/tsx");
        if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline)); }
        let out = Command::new(&tsx)
            .arg("--import").arg(redirect_script()?)
            .arg(outline_script()?)
            .arg(&dir)
            .current_dir(&pipeline)
            .env("PATH", login_path())
            .env("FLEX_PIPELINE", &pipeline)
            .output()
            .map_err(|e| ProjectError::Run(e.to_string()))?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        let line = stdout.lines().rev().find(|l| l.starts_with('{'))
            .ok_or_else(|| ProjectError::Run(String::from_utf8_lossy(&out.stderr).trim().to_string()))?;
        let o: Outline = serde_json::from_str(line).map_err(|e| ProjectError::Run(e.to_string()))?;
        if !o.ok { return Err(ProjectError::Load(o.error.unwrap_or_default())); }
        let mut scenes = o.scenes.unwrap_or_default();
        scene_files(&dir, &mut scenes);
        let music = o.music.unwrap_or(Music { key: String::new(), segments: None, from: None, tracks: None });
        Ok(Project {
            music_file: music_file(&dir, &pipeline, &music.key),
            name: o.name.unwrap_or_default(),
            feel: o.feel.unwrap_or_default(),
            duration: o.duration.unwrap_or(0.0),
            music, scenes, pipeline, dir,
        })
    }
}

/// The PATH tools run with: the user's own, as their login shell sets it (so `python3`, `node` and `mlx_whisper` are the
/// ones they get in a terminal; a GUI app starts with a bare PATH), then the usual install places as a fallback. Read once.
/// The film's frame in layout px, from `frame.json` (`{ "width": 1080, "height": 1920 }` for a vertical film); 1920 × 1080
/// when the project has none. Everything that paints or renders the film works in this frame.
pub fn frame_size(dir: &Path) -> (u32, u32) {
    let v: Option<serde_json::Value> = fs::read_to_string(dir.join("frame.json")).ok().and_then(|s| serde_json::from_str(&s).ok());
    let n = |k: &str| v.as_ref().and_then(|v| v[k].as_u64()).filter(|n| (16..=8192).contains(n)).map(|n| n as u32);
    match (n("width"), n("height")) { (Some(w), Some(h)) => (w, h), _ => (1920, 1080) }
}

/// Pass the project's frame to a pipeline process (`FLEX_FRAME=WxH`, read by the pipeline's output size: patch 08).
pub fn apply_frame(cmd: &mut Command, dir: &Path) {
    let (w, h) = frame_size(dir);
    if (w, h) != (1920, 1080) { cmd.env("FLEX_FRAME", format!("{w}x{h}")); }
}

/// An output size for the film's frame: "1080p" (the frame itself), "1440p" or "4k" scale its short side to 1080, 1440 or
/// 2160 px. Returns (width, height) and the file suffix ("" for the frame itself).
pub fn output_size(frame: (u32, u32), name: Option<&str>) -> Result<((u32, u32), &'static str), String> {
    let (k, tag) = match name { None | Some("1080p") => (1.0, ""), Some("1440p") => (4.0 / 3.0, "@1440p"), Some("4k") | Some("2160p") => (2.0, "@4k"),
        Some(x) => return Err(format!("--size 1080p, 1440p or 4k, not {x}")) };
    let even = |v: f64| ((v / 2.0).round() * 2.0) as u32;
    Ok(((even(frame.0 as f64 * k), even(frame.1 as f64 * k)), tag))
}

#[cfg(test)]
mod frame_tests {
    use super::*;
    #[test]
    fn frame_json_and_output_sizes() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(frame_size(d.path()), (1920, 1080));
        std::fs::write(d.path().join("frame.json"), r#"{ "width": 1080, "height": 1920 }"#).unwrap();
        assert_eq!(frame_size(d.path()), (1080, 1920));
        assert_eq!(output_size((1080, 1920), None).unwrap(), ((1080, 1920), ""));
        assert_eq!(output_size((1080, 1920), Some("4k")).unwrap(), ((2160, 3840), "@4k"));
        assert_eq!(output_size((1920, 1080), Some("1440p")).unwrap(), ((2560, 1440), "@1440p"));
        assert!(output_size((1920, 1080), Some("8k")).is_err());
    }
}

pub fn login_path() -> String {
    static PATH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    PATH.get_or_init(|| {
        let mut parts: Vec<String> = vec![];
        if let Some(p) = shell_path() { parts.push(p); }
        if let Ok(p) = std::env::var("PATH") { parts.push(p); }
        parts.extend(["/opt/homebrew/bin".to_string(), "/usr/local/bin".into()]);
        if let Some(home) = dirs::home_dir() {
            // nvm / volta installs, newest first
            if let Ok(rd) = fs::read_dir(home.join(".nvm/versions/node")) {
                let mut v: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path().join("bin"))).collect();
                v.sort(); v.reverse();
                parts.extend(v.into_iter().map(|p| p.to_string_lossy().into_owned()));
            }
            parts.push(home.join(".volta/bin").to_string_lossy().into_owned());
            parts.push(home.join(".local/bin").to_string_lossy().into_owned());
        }
        parts.push("/usr/bin:/bin:/usr/sbin:/sbin".into());
        // one entry per directory, first wins
        let mut seen = std::collections::HashSet::new();
        parts.iter().flat_map(|p| p.split(':')).filter(|d| !d.is_empty() && seen.insert(d.to_string())).collect::<Vec<_>>().join(":")
    }).clone()
}

/// the login shell's PATH (interactive, so .zshrc's additions count); None if it can't be read within a few seconds
fn shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell).args(["-ilc", "printf '\\n__FLEX_PATH__%s\\n' \"$PATH\""])
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null()).spawn().ok()?;
    let t0 = std::time::Instant::now();
    loop {
        if child.try_wait().ok()?.is_some() { break; }
        if t0.elapsed() > std::time::Duration::from_secs(5) { let _ = child.kill(); return None; }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let out = child.wait_with_output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().find_map(|l| l.strip_prefix("__FLEX_PATH__").map(String::from)).filter(|p| !p.is_empty())
}
