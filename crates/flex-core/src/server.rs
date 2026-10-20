//! Flex's server (`server/serve.mts`, docs/server.md): a Node process that runs the project's
//! pipeline and answers what goes in each frame. One request at a time, JSON lines.

use crate::paint::Layer;
use crate::project::{find_pipeline, login_path, redirect_script, support_script, voice_cache, ProjectError};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};

const SERVE_SCRIPT: &str = include_str!("../../../server/serve.mts");

#[derive(Debug, Clone, Deserialize)]
pub struct ItemInfo {
    pub kind: String,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    pub label: String,
    pub start: f64,
    pub end: f64,
    pub paintable: bool,
    /// a take clip's camera plan, as the film paints it
    #[serde(default)]
    pub take: Option<TakeCamera>,
}

/// A take clip's camera plan (docs/capture.md): its zoom segments and effects in take milliseconds, the stretch of the take
/// the clip plays (`from`..`to`, take seconds), whether the take's `edl.json` is locked, and whether the scene's patch
/// changed the plan (then edits to `edl.json` may not show).
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct TakeCamera {
    pub take: String,
    pub from: f64,
    pub to: f64,
    pub locked: bool,
    pub patched: bool,
    pub segments: Vec<CameraBlock>,
    pub effects: Vec<CameraBlock>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct CameraBlock {
    pub id: Option<String>,
    /// take ms
    pub start: f64,
    pub end: f64,
    pub enabled: bool,
    /// a zoom's scale and kind (stage, control, …); an effect's type
    #[serde(default)]
    pub scale: Option<f64>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default, rename = "type")]
    pub effect_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SceneInfo {
    pub id: String,
    pub start: f64,
    pub end: f64,
    /// the scene's first frame and its frame count
    pub first: u32,
    pub frames: u32,
    pub items: Vec<ItemInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MusicInfo {
    pub key: String,
    pub segments: Option<Vec<[f64; 2]>>,
    /// the track each stretch plays (one music key per stretch; none = `key` throughout): a film can change songs at a join
    #[serde(default)]
    pub tracks: Option<Vec<String>>,
    /// where the film starts in the song (without an edit)
    #[serde(default)]
    pub from: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub name: String,
    pub fps: u32,
    pub frames: u32,
    pub duration: f64,
    pub music: MusicInfo,
    pub scenes: Vec<SceneInfo>,
    #[serde(default)]
    pub warnings: Vec<String>,
    /// env flags the project's scenes read, with their values (the first is the default): END → [white, dark]
    #[serde(default)]
    pub variants: std::collections::BTreeMap<String, Vec<String>>,
    /// the film's sections, bars, hits and music-edit joins (film seconds), from the project's `markers` export
    #[serde(default)]
    pub markers: Option<Markers>,
    /// the project's output subfolder (project.ts `out:`): its renders are in ~/Downloads/fancy-e2e-videos/<out>/
    #[serde(default)]
    pub out: Option<String>,
    /// the film's frame in layout px (frame.json; 1920 × 1080 by default)
    #[serde(default = "landscape")]
    pub size: [u32; 2],
}

fn landscape() -> [u32; 2] { [1920, 1080] }

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Markers {
    #[serde(default)] pub sections: Vec<Section>,
    #[serde(default)] pub bars: Vec<f64>,
    #[serde(default)] pub hits: Vec<Hit>,
    #[serde(default)] pub joins: Vec<f64>,
    /// deliberate hard cuts (film seconds): a join there is meant to jump
    #[serde(default)] pub cuts: Vec<f64>,
}
/// `end` is null for an open-ended last section (the finale)
#[derive(Debug, Clone, Deserialize)]
pub struct Section { pub id: String, pub start: f64, pub end: Option<f64> }
#[derive(Debug, Clone, Deserialize)]
pub struct Hit { pub label: String, pub t: f64 }

impl Manifest {
    pub fn scene_at(&self, frame: u32) -> Option<&SceneInfo> {
        self.scenes.iter().find(|s| frame >= s.first && frame < s.first + s.frames).or(self.scenes.last())
    }
}

/// What a frame is made of.
#[derive(Debug, Clone)]
pub enum FrameLayers {
    Layers(Vec<Layer>),
    /// nothing the server can give layers for yet (a take, until the pipeline seam)
    Placeholder(String),
    /// the scene's code threw for this frame
    Error(String),
}

struct Io { child: Child, stdin: ChildStdin, stdout: BufReader<ChildStdout>, next: u64 }

/// A running server for one project. Requests are serialised; it is cheap (layers take ms).
pub struct Server {
    io: Mutex<Io>,
    pub manifest: Manifest,
    pub log: Arc<Mutex<Vec<String>>>,
}

const TIMELINE_SCRIPT: &str = include_str!("../../../server/timeline.mts");
const TAKE_LAYERS_SCRIPT: &str = include_str!("../../../server/take-layers.mts");

/// serve.mts and the modules it loads, written into the support folder together
pub(crate) fn script() -> Result<PathBuf, ProjectError> {
    support_script("timeline.mts", TIMELINE_SCRIPT)?;
    support_script("take-layers.mts", TAKE_LAYERS_SCRIPT)?;
    support_script("serve.mts", SERVE_SCRIPT)
}

impl Server {
    /// Start the server for a project folder and wait for its manifest (about a second).
    pub fn start(dir: &Path) -> Result<Server, ProjectError> { Self::start_with(dir, &[]) }

    /// Start it with variant flags set (name, value), e.g. ("END", "dark").
    pub fn start_with(dir: &Path, variants: &[(String, String)]) -> Result<Server, ProjectError> {
        let dir = std::fs::canonicalize(dir).map_err(|_| ProjectError::NotAProject(dir.to_path_buf()))?;
        let pipeline = find_pipeline(&dir)?;
        let tsx = pipeline.join("node_modules/.bin/tsx");
        if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline)); }
        let mut cmd = Command::new(&tsx);
        cmd.arg("--import").arg(redirect_script()?)
            .arg(script()?).arg(&dir)
            .current_dir(&pipeline)
            .env("PATH", login_path())
            .env("FLEX_PIPELINE", &pipeline)
            .env("FLEX_VOICE_CACHE", voice_cache())
            .env("FLEX_PROJECTS", crate::tools::projects_link(&dir)?.0);
        // a variant (END=dark …): the project's declared flags, passed as the pipeline reads them, from the environment
        for (k, v) in variants { cmd.env(k, v); }
        crate::secrets::apply(&mut cmd, &dir); // the stored OpenAI key, unless the project pins Kokoro
        crate::project::apply_frame(&mut cmd, &dir); // a vertical film's frame (frame.json)
        let mut child = cmd
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|e| ProjectError::Run(e.to_string()))?;
        let log = Arc::new(Mutex::new(Vec::new()));
        if let Some(err) = child.stderr.take() {
            let log = log.clone();
            std::thread::spawn(move || for line in BufReader::new(err).lines().map_while(Result::ok) {
                let mut l = log.lock().unwrap();
                if l.len() > 2000 { l.drain(..500); }
                l.push(line);
            });
        }
        let stdin = child.stdin.take().unwrap();
        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        stdout.read_line(&mut line).map_err(|e| ProjectError::Run(e.to_string()))?;
        if line.is_empty() {
            let _ = child.wait();
            let tail = log.lock().unwrap().iter().rev().take(12).rev().cloned().collect::<Vec<_>>().join("\n");
            return Err(ProjectError::Run(format!("the server stopped before it was ready\n{tail}")));
        }
        let v: Value = serde_json::from_str(&line).map_err(|e| ProjectError::Run(format!("{e}: {line}")))?;
        if v["ok"] != json!(true) { return Err(ProjectError::Load(v["error"].as_str().unwrap_or("").to_string())); }
        let manifest: Manifest = serde_json::from_value(v["manifest"].clone()).map_err(|e| ProjectError::Run(e.to_string()))?;
        Ok(Server { io: Mutex::new(Io { child, stdin, stdout, next: 1 }), manifest, log })
    }

    fn ask(&self, mut q: Value) -> Result<Value, ProjectError> {
        let mut io = self.io.lock().unwrap();
        let id = io.next; io.next += 1;
        q["id"] = json!(id);
        writeln!(io.stdin, "{q}").and_then(|_| io.stdin.flush()).map_err(|e| ProjectError::Run(format!("the server has stopped ({e})")))?;
        let mut line = String::new();
        io.stdout.read_line(&mut line).map_err(|e| ProjectError::Run(e.to_string()))?;
        if line.is_empty() { return Err(ProjectError::Run("the server has stopped".into())); }
        let v: Value = serde_json::from_str(&line).map_err(|e| ProjectError::Run(e.to_string()))?;
        if v["ok"] != json!(true) { return Err(ProjectError::Load(v["error"].as_str().unwrap_or("").to_string())); }
        Ok(v)
    }

    pub fn layers(&self, frame: u32) -> Result<FrameLayers, ProjectError> {
        let v = self.ask(json!({ "op": "layers", "frame": frame }))?;
        if let Some(p) = v["placeholder"].as_str() { return Ok(FrameLayers::Placeholder(p.to_string())); }
        if let Some(e) = v["error"].as_str() { return Ok(FrameLayers::Error(e.to_string())); }
        let layers: Vec<Layer> = serde_json::from_value(v["layers"].clone()).map_err(|e| ProjectError::Run(format!("frame {frame}: {e}")))?;
        Ok(FrameLayers::Layers(layers))
    }

    /// One key per frame: equal keys look the same (docs/server.md).
    /// Also: the scenes whose code threw while keying, with the error.
    pub fn keys(&self, from: u32, to: u32) -> Result<(Vec<String>, Vec<(String, String)>), ProjectError> {
        let v = self.ask(json!({ "op": "keys", "from": from, "to": to }))?;
        let keys = v["keys"].as_array().map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect()).unwrap_or_default();
        let errors = v["errors"].as_object().map(|o| o.iter().map(|(k, e)| (k.clone(), e.as_str().unwrap_or("").to_string())).collect()).unwrap_or_default();
        Ok((keys, errors))
    }

    /// The film's sound cues (voice lines, sound effects, the music, the length), as JSON.
    pub fn cues(&self) -> Result<Value, ProjectError> { self.ask(json!({ "op": "cues" })) }

    /// Mix the film's sound with the pipeline's mixer into `out` (a WAV; seconds of work).
    pub fn mix(&self, out: &Path) -> Result<Value, ProjectError> { self.ask(json!({ "op": "mix", "out": out })) }
    /// the attribution lines the film's sounds and music need (as the pipeline's .credits.txt), and its voice lines
    pub fn credits(&self) -> Result<Value, ProjectError> { self.ask(json!({ "op": "credits" })) }
    /// one layer of the mix alone: "music" (the edit, levelled and ducked), "voice" or "sfx"
    pub fn mix_only(&self, out: &Path, only: &str) -> Result<Value, ProjectError> { self.ask(json!({ "op": "mix", "out": out, "only": only })) }

    /// The pipeline's own paint of a frame, as a PNG (for `flex diff`).
    pub fn reference(&self, frame: u32, out: &Path) -> Result<(), ProjectError> {
        self.ask(json!({ "op": "reference", "frame": frame, "out": out }))?;
        Ok(())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Ok(io) = self.io.get_mut() { let _ = io.child.kill(); let _ = io.child.wait(); }
    }
}
