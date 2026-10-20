//! Capture (docs/capture.md): record a project's journeys (screen recordings of the real app) into take versions, report
//! their timing, pick one, and stage the app's data. A thin runner over `server/capture.mts`, which drives the
//! pipeline's own capture; the CLI passes its output through, the app watches a run's progress.

use crate::project::{find_pipeline, login_path, redirect_script, support_dir, support_script, voice_cache, ProjectError};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

const CAPTURE_SCRIPT: &str = include_str!("../../../server/capture.mts");

/// `capture.mts <args…> <project>…`, ready to run: the pipeline's tsx with the import redirect, Flex's env.
/// `args` is the command line after the script: the command, the project folder, then the rest.
pub fn command(dir: &Path, cmd: &str, rest: &[String]) -> Result<Command, ProjectError> {
    let dir = std::fs::canonicalize(dir).map_err(|_| ProjectError::NotAProject(dir.to_path_buf()))?;
    let pipeline = find_pipeline(&dir)?;
    let tsx = pipeline.join("node_modules/.bin/tsx");
    if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline)); }
    redirect_script()?;
    let mut c = Command::new(&tsx);
    c.arg("--import").arg(redirect_script()?)
        .arg(support_script("capture.mts", CAPTURE_SCRIPT)?)
        .arg(cmd).arg(&dir).args(rest)
        .current_dir(&pipeline)
        .env("PATH", login_path())
        .env("FLEX_PIPELINE", &pipeline)
        .env("FLEX_VOICE_CACHE", voice_cache())
        .env("FLEX_SUPPORT", support_dir())
        .env("FLEX_PROJECTS", crate::tools::projects_link(&dir)?.0);
    crate::secrets::apply(&mut c, &dir);
    crate::project::apply_frame(&mut c, &dir);
    Ok(c)
}

/// Run a capture command to the end and return its JSON result (`--json` is added).
pub fn run_json(dir: &Path, cmd: &str, rest: &[String]) -> Result<Value, ProjectError> {
    let mut rest = rest.to_vec();
    rest.push("--json".into());
    let o = command(dir, cmd, &rest)?.stdin(Stdio::null()).output().map_err(|e| ProjectError::Run(e.to_string()))?;
    let text = String::from_utf8_lossy(&o.stdout);
    let line = text.lines().rev().find(|l| l.starts_with('{'))
        .ok_or_else(|| ProjectError::Run(format!("capture {cmd}: no result\n{}", String::from_utf8_lossy(&o.stderr).lines().rev().take(8).collect::<Vec<_>>().join("\n"))))?;
    serde_json::from_str(line).map_err(|e| ProjectError::Run(e.to_string()))
}

/// A capture command running in the background (a dry run or a real capture can take minutes): its log as it comes,
/// the version folder it records into, and its JSON result at the end.
pub struct CaptureRun {
    child: Mutex<Child>,
    log: Arc<Mutex<Vec<String>>>,
    result: Arc<Mutex<Option<Value>>>,
    /// where the frames are going (`@flex {"recording": dir}` from the runner), for a live view
    recording: Arc<Mutex<Option<PathBuf>>>,
}

impl CaptureRun {
    pub fn start(dir: &Path, cmd: &str, rest: &[String]) -> Result<CaptureRun, ProjectError> {
        let mut rest = rest.to_vec();
        rest.push("--json".into());
        let mut child = command(dir, cmd, &rest)?.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| ProjectError::Run(e.to_string()))?;
        let log = Arc::new(Mutex::new(Vec::new()));
        let result = Arc::new(Mutex::new(None));
        let recording = Arc::new(Mutex::new(None));
        if let Some(err) = child.stderr.take() {
            let (log, recording) = (log.clone(), recording.clone());
            std::thread::spawn(move || for line in BufReader::new(err).lines().map_while(Result::ok) {
                if let Some(ev) = line.strip_prefix("@flex ") {
                    if let Ok(v) = serde_json::from_str::<Value>(ev) {
                        if let Some(d) = v.get("recording").and_then(|d| d.as_str()) { *recording.lock().unwrap() = Some(PathBuf::from(d)); }
                    }
                    continue;
                }
                let mut l = log.lock().unwrap();
                if l.len() > 4000 { l.drain(..1000); }
                l.push(line);
            });
        }
        if let Some(out) = child.stdout.take() {
            let result = result.clone();
            std::thread::spawn(move || for line in BufReader::new(out).lines().map_while(Result::ok) {
                if let Ok(v) = serde_json::from_str::<Value>(&line) { *result.lock().unwrap() = Some(v); }
            });
        }
        Ok(CaptureRun { child: Mutex::new(child), log, result, recording })
    }

    /// the log so far
    pub fn log(&self) -> Vec<String> { self.log.lock().unwrap().clone() }
    /// still running?
    pub fn running(&self) -> bool { matches!(self.child.lock().unwrap().try_wait(), Ok(None)) }
    /// the JSON result, once it has finished (`ok: false` with `error` when it failed)
    pub fn result(&self) -> Option<Value> {
        if self.running() { return None; }
        // the stdout thread may lag the exit by a moment
        for _ in 0..20 {
            if let Some(v) = self.result.lock().unwrap().clone() { return Some(v); }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        Some(serde_json::json!({ "ok": false, "error": self.log().last().cloned().unwrap_or_else(|| "the capture stopped".into()) }))
    }
    /// the newest frame recorded so far (the live view)
    pub fn latest_frame(&self) -> Option<PathBuf> {
        let dir = self.recording.lock().unwrap().clone()?.join("frames");
        std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "jpg" || x == "png"))
            .max_by_key(|p| p.file_name().map(|n| n.to_os_string()))
    }
    /// stop it (a real capture stopped part-way leaves no version)
    pub fn stop(&self) {
        // SIGTERM first: Playwright closes its browser on it; then make sure
        let mut c = self.child.lock().unwrap();
        let _ = Command::new("kill").arg("-TERM").arg(c.id().to_string()).status();
        for _ in 0..30 { if !matches!(c.try_wait(), Ok(None)) { return; } std::thread::sleep(std::time::Duration::from_millis(100)); }
        let _ = c.kill();
    }
}

impl Drop for CaptureRun {
    fn drop(&mut self) { if self.running() { self.stop(); } }
}
