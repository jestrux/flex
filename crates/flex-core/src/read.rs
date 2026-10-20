//! `flex read`: the text in an image or a PDF (macOS's own text recognition, offline), with where each line sits. The
//! recogniser is a small Swift program (`server/ocr.swift`), compiled once into the support folder, again only when its
//! source changes.

use crate::project::{login_path, support_dir, ProjectError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

const SOURCE: &str = include_str!("../../../server/ocr.swift");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Box { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Line { pub text: String, pub confidence: f64, pub page: u32, #[serde(rename = "box")] pub bbox: Box }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Text { pub width: u32, pub height: u32, pub pages: u32, pub lines: Vec<Line> }

impl Text {
    /// the text in reading order, a line per line, pages separated by a blank line
    pub fn plain(&self) -> String {
        let mut s = String::new();
        let mut page = 1;
        for l in &self.lines {
            if l.page != page { s.push('\n'); page = l.page; }
            s.push_str(&l.text); s.push('\n');
        }
        s
    }
}

/// The compiled recogniser (built on first use: swiftc, from the Xcode command-line tools).
fn binary() -> Result<PathBuf, ProjectError> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    SOURCE.hash(&mut h);
    let dir = support_dir().join("bin");
    let bin = dir.join(format!("ocr-{:012x}", h.finish() & 0xffff_ffff_ffff));
    if bin.exists() { return Ok(bin); }
    std::fs::create_dir_all(&dir)?;
    let src = dir.join("ocr.swift");
    std::fs::write(&src, SOURCE)?;
    let o = Command::new("xcrun").args(["swiftc", "-O", "-o"]).arg(&bin).arg(&src).env("PATH", login_path()).output()?;
    if !o.status.success() {
        return Err(ProjectError::Invalid(format!("couldn't build the text recogniser (swiftc; install the Xcode command-line tools): {}",
            String::from_utf8_lossy(&o.stderr).lines().find(|l| l.contains("error")).unwrap_or("swiftc failed"))));
    }
    Ok(bin)
}

/// Read the text in `file` (PNG, JPEG, HEIC, TIFF, a PDF …). `fast`: quicker, less accurate. `langs`: e.g. ["en-US"].
pub fn run(file: &Path, fast: bool, langs: &[String]) -> Result<Text, ProjectError> {
    if !file.is_file() { return Err(ProjectError::Invalid(format!("no file at {}", file.display()))); }
    let mut c = Command::new(binary()?);
    c.arg(file);
    if fast { c.arg("--fast"); }
    if !langs.is_empty() { c.arg("--lang").arg(langs.join(",")); }
    let o = c.output()?;
    if !o.status.success() { return Err(ProjectError::Invalid(format!("{}: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    serde_json::from_slice(&o.stdout).map_err(|e| ProjectError::Invalid(e.to_string()))
}
