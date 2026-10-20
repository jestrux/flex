//! `flex transcribe`: what is said or sung in any audio, word by word with times, by local Whisper (mlx-whisper with
//! the large-v3-turbo model). One Whisper path for Flex: `server/whisper.py`, which `flex music` uses for the lead
//! vocal too. When the file belongs to a project whose track has been read (`flex music`), each word also gets its
//! bar.beat on the film's grid (stems and the track share the song's clock; other audio, e.g. a narration line, doesn't).

use crate::project::{login_path, support_script, ProjectError};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const WHISPER: &str = include_str!("../../../server/whisper.py");
pub const MODEL: &str = crate::doctor::WHISPER_MODEL;

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct Word {
    pub word: String,
    pub start: f64,
    pub end: f64,
    /// the stretch it was heard in
    pub line: u32,
    /// bar.beat on the project's grid, when the audio is on the song's clock
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub at: Option<String>,
}

/// The script, written to the support folder; `flex music` gets its path in FLEX_WHISPER.
pub fn script() -> Result<PathBuf, ProjectError> { support_script("whisper.py", WHISPER) }

/// The mlx-whisper tool's own python (from its launcher's first line).
pub fn python() -> Result<PathBuf, ProjectError> {
    let o = Command::new("sh").arg("-c").arg("command -v mlx_whisper").env("PATH", login_path()).output()?;
    let bin = String::from_utf8_lossy(&o.stdout).trim().to_string();
    if bin.is_empty() { return Err(ProjectError::Invalid("mlx_whisper is not installed: uv tool install mlx-whisper (flex doctor)".into())); }
    let real = std::fs::canonicalize(&bin)?;
    let first = std::fs::read_to_string(&real)?.lines().next().unwrap_or_default().trim_start_matches("#!").trim().to_string();
    if first.is_empty() { return Err(ProjectError::Invalid(format!("can't read mlx_whisper's python from {}", real.display()))); }
    Ok(PathBuf::from(first))
}

fn duration(file: &Path) -> Result<f64, ProjectError> {
    let o = Command::new("ffprobe").args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"]).arg(file).env("PATH", login_path()).output()?;
    String::from_utf8_lossy(&o.stdout).trim().parse().map_err(|_| ProjectError::Invalid(format!("can't read {}'s length (ffprobe)", file.display())))
}

/// Transcribe `file` (from..to seconds, default all of it), in stretches of at most 20 s.
pub fn run(file: &Path, from: Option<f64>, to: Option<f64>, language: Option<&str>) -> Result<Vec<Word>, ProjectError> {
    if !file.is_file() { return Err(ProjectError::Invalid(format!("no audio at {}", file.display()))); }
    let (a, b) = (from.unwrap_or(0.0), match to { Some(t) => t, None => duration(file)? });
    let mut chunks = vec![];
    let mut t = a;
    while t < b - 0.05 { let e = (t + 20.0).min(b); chunks.push([t, e]); t = e; }
    // English unless told otherwise ("auto": Whisper guesses; on sung audio it often guesses wrong and hears little)
    let language = match language { None => Some("en"), Some("auto") => None, Some(l) => Some(l) };
    let req = serde_json::json!({ "file": file, "model": MODEL, "chunks": chunks, "language": language });
    let mut child = Command::new(python()?).arg(script()?)
        .env("PATH", login_path()).env("HF_HUB_DISABLE_XET", "1")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    use std::io::Write;
    child.stdin.take().unwrap().write_all(req.to_string().as_bytes())?;
    let o = child.wait_with_output()?;
    let text = String::from_utf8_lossy(&o.stdout);
    let line = text.lines().rev().find(|l| l.starts_with('['))
        .ok_or_else(|| ProjectError::Invalid(format!("Whisper failed: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("no output"))))?;
    let mut words: Vec<Word> = serde_json::from_str(line).map_err(|e| ProjectError::Invalid(e.to_string()))?;
    if let Some(g) = grid_for(file) { for w in &mut words { w.at = Some(g.at(w.start)); } }
    Ok(words)
}

/// Several whole files in one Whisper run (the model loads once), each cached in `<support>/words/` by the file's path,
/// size and date. For narration lines: their words with times inside each line.
pub fn run_many(files: &[PathBuf]) -> Result<Vec<Vec<Word>>, ProjectError> {
    use std::hash::{Hash, Hasher};
    let cache = crate::project::support_dir().join("words");
    std::fs::create_dir_all(&cache)?;
    let key = |f: &Path| -> PathBuf {
        let m = std::fs::metadata(f).ok();
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (f, m.as_ref().map(|m| m.len()), m.and_then(|m| m.modified().ok())).hash(&mut h);
        cache.join(format!("{:016x}.json", h.finish()))
    };
    let mut out: Vec<Option<Vec<Word>>> = files.iter().map(|f| std::fs::read_to_string(key(f)).ok().and_then(|s| serde_json::from_str(&s).ok())).collect();
    let todo: Vec<usize> = (0..files.len()).filter(|&i| out[i].is_none()).collect();
    if !todo.is_empty() {
        let jobs: Vec<_> = todo.iter().map(|&i| serde_json::json!({ "file": files[i] })).collect();
        let req = serde_json::json!({ "jobs": jobs, "model": MODEL, "language": "en" });
        let mut child = Command::new(python()?).arg(script()?).env("PATH", login_path()).env("HF_HUB_DISABLE_XET", "1")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
        use std::io::Write;
        child.stdin.take().unwrap().write_all(req.to_string().as_bytes())?;
        let o = child.wait_with_output()?;
        let text = String::from_utf8_lossy(&o.stdout);
        let line = text.lines().rev().find(|l| l.starts_with('['))
            .ok_or_else(|| ProjectError::Invalid(format!("Whisper failed: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("no output"))))?;
        let got: Vec<Vec<Word>> = serde_json::from_str(line).map_err(|e| ProjectError::Invalid(e.to_string()))?;
        for (&i, w) in todo.iter().zip(got) {
            let _ = std::fs::write(key(&files[i]), serde_json::to_string(&w).unwrap_or_default());
            out[i] = Some(w);
        }
    }
    Ok(out.into_iter().map(|w| w.unwrap_or_default()).collect())
}

/// The song's grid, when the file is the project's track or one of its stems and `flex music` has read it.
pub struct Grid { first: f64, bar: f64, beat: f64 }
impl Grid {
    pub fn at(&self, t: f64) -> String {
        let rel = (t - self.first) / self.bar;
        if rel < 0.0 { return format!("pickup -{}", (((self.first - t) / self.beat) * 4.0).round() / 4.0); }
        let bar = rel.floor() as i64 + 1;
        let beat = ((rel - rel.floor()) * 4.0 + 1.0) * 4.0;
        let beat = beat.round() / 4.0;
        if beat >= 5.0 { format!("{}.1", bar + 1) } else { format!("{bar}.{beat}") }
    }
}
fn grid_for(file: &Path) -> Option<Grid> {
    let file = std::fs::canonicalize(file).ok()?;
    let dir = file.ancestors().find(|d| d.join("audio.json").is_file())?;
    let audio: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("audio.json")).ok()?).ok()?;
    let stems = dir.join(audio["stems"].as_str().unwrap_or("audio/stems/"));
    for (_, m) in audio["music"].as_object()? {
        let track = dir.join(m["file"].as_str()?);
        let ours = file == std::fs::canonicalize(&track).ok()? || std::fs::canonicalize(&stems).ok().is_some_and(|s| file.starts_with(s));
        if !ours { continue; }
        let mj: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(track.with_extension("music.json")).ok()?).ok()?;
        return Some(Grid { first: mj["firstDownbeat"].as_f64()?, bar: mj["bar"].as_f64()?, beat: mj["beat"].as_f64()? });
    }
    None
}
