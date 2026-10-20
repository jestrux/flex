//! UniFFI surface over `flex-core` for the Mac app. A thin translation layer only.

uniffi::setup_scaffolding!();

// each panel's surface in its own file (the assets panel, the activity trail)
mod activity;
mod assets;
mod control;

use std::path::Path;

#[derive(Debug, Clone, uniffi::Record)]
pub struct SceneInfo {
    pub id: String,
    /// film seconds
    pub start: f64,
    pub end: f64,
    /// what fills it: card keys and take ids
    pub items: Vec<String>,
    /// scenes/NN-<id>.ts, relative to the project
    pub file: Option<String>,
}

/// A stretch of the song, in song seconds; the edit plays them back to back.
#[derive(Debug, Clone, uniffi::Record)]
pub struct Segment { pub start: f64, pub end: f64 }

#[derive(Debug, Clone, uniffi::Record)]
pub struct ProjectInfo {
    pub name: String,
    pub dir: String,
    pub pipeline: String,
    pub duration: f64,
    pub music_key: String,
    pub music_file: Option<String>,
    /// the music edit's joins, in film seconds
    pub joins: Vec<f64>,
    /// the music edit (empty = the song as it is)
    pub segments: Vec<Segment>,
    pub scenes: Vec<SceneInfo>,
    /// the film's frame in layout px (frame.json: 1080 × 1920 for a vertical film; 1920 × 1080 by default)
    pub frame_width: u32,
    pub frame_height: u32,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum FlexError {
    #[error("{message}")]
    Failed { message: String },
}

/// Open a project folder and read its outline through its fancy-e2e-videos pipeline. Blocks for
/// about a second; call it off the main thread.
#[uniffi::export]
pub fn open_project(path: String) -> Result<ProjectInfo, FlexError> {
    let p = flex_core::Project::open(Path::new(&path)).map_err(|e| FlexError::Failed { message: e.to_string() })?;
    let rel = |f: &Path| f.strip_prefix(&p.dir).unwrap_or(f).to_string_lossy().into_owned();
    let mut joins = vec![];
    if let Some(segs) = &p.music.segments {
        let mut t = 0.0;
        for s in &segs[..segs.len().saturating_sub(1)] { t += s[1] - s[0]; joins.push(t); }
    }
    let (frame_width, frame_height) = flex_core::project::frame_size(&p.dir);
    Ok(ProjectInfo {
        frame_width, frame_height,
        name: p.name.clone(),
        dir: p.dir.to_string_lossy().into_owned(),
        pipeline: p.pipeline.to_string_lossy().into_owned(),
        duration: p.duration,
        music_key: p.music.key.clone(),
        music_file: p.music_file.as_deref().map(|f| f.to_string_lossy().into_owned()),
        joins,
        segments: p.music.segments.iter().flatten().map(|s| Segment { start: s[0], end: s[1] }).collect(),
        scenes: p.scenes.iter().map(|s| SceneInfo {
            id: s.id.clone(), start: s.start, end: s.end,
            items: s.items.iter().map(|i| i.label()).collect(),
            file: s.file.as_deref().map(rel),
        }).collect(),
    })
}

/// The music's peaks on the film's clock (0–1, `per_second` per second), through the edit
/// (`segments`, song seconds; empty = the song as is). Decoded once by ffmpeg and cached.
/// Seconds the first time; call it off the main thread.
#[uniffi::export]
pub fn music_peaks(file: String, segments: Vec<Segment>, per_second: u32) -> Result<Vec<f32>, FlexError> {
    let segs: Vec<[f64; 2]> = segments.iter().map(|s| [s.start, s.end]).collect();
    flex_core::waveform::peaks(Path::new(&file), &segs, per_second).map_err(|e| FlexError::Failed { message: e.to_string() })
}

fn render_info(r: flex_core::renders::Render, m: &flex_core::Manifest) -> RenderInfo {
    RenderInfo {
        scene: r.part.as_deref().and_then(|p| flex_core::renders::scene_of(p, m.scenes.iter().map(|x| x.id.as_str()))).map(String::from),
        path: r.path.to_string_lossy().into_owned(), file: r.file, bytes: r.bytes, modified: r.modified, part: r.part, size: r.size,
    }
}

// ── the engine for an open project ─────────────────────────────────────────────────────────

/// A take clip's camera plan: where it plays in the film (seconds), the stretch of the take it plays (take seconds),
/// and its zoom segments and effects (take ms).
#[derive(Debug, Clone, uniffi::Record)]
pub struct CameraClip {
    pub scene: String,
    pub take: String,
    pub film_start: f64,
    pub film_end: f64,
    pub from: f64,
    pub to: f64,
    pub locked: bool,
    /// the scene's patch changes this plan: edits to edl.json may not show
    pub patched: bool,
    pub blocks: Vec<CameraBlockInfo>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct CameraBlockInfo {
    pub id: String,
    /// "zoom" or "effect"
    pub kind: String,
    pub label: String,
    pub start_ms: f64,
    pub end_ms: f64,
    pub enabled: bool,
}

/// One of the song's hits at a film time (flex music).
#[derive(Debug, Clone, uniffi::Record)]
pub struct FilmHit { pub t: f64, pub stem: String, pub strength: f64, pub entry: bool, pub at: String }

/// A narration word at its film time (flex narration).
#[derive(Debug, Clone, uniffi::Record)]
pub struct NarrationWord { pub line: u32, pub word: String, pub t: f64, pub end: f64, pub at: String, pub off_beat_ms: f64, pub over_singing: bool }

/// A cut and the nearest beat or declared hit (flex cuts).
#[derive(Debug, Clone, uniffi::Record)]
pub struct CutMark {
    pub t: f64,
    pub from: String,
    pub to: String,
    pub scene: bool,
    pub at: String,
    pub target: String,
    pub off_ms: f64,
    pub on: bool,
    pub declared: bool,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct SceneStatus {
    pub id: String,
    /// first frame and frame count
    pub first: u32,
    pub frames: u32,
    pub painted: u32,
    /// labels of what can't be painted yet (takes), empty when it all can
    pub unpaintable: Vec<String>,
    /// the scene's code threw: the first error (its frames aren't painted)
    pub error: Option<String>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct VoiceCue {
    /// film seconds
    pub start: f64,
    pub dur: f64,
    pub text: String,
}

/// A stretch of the song's structure (verse, chorus …), film seconds; `end` None = to the film's end.
#[derive(Debug, Clone, uniffi::Record)]
pub struct MarkerSection { pub id: String, pub start: f64, pub end: Option<f64> }

/// A hit in the song (a riff, a drop …), film seconds.
#[derive(Debug, Clone, uniffi::Record)]
pub struct MarkerHit { pub label: String, pub t: f64 }

/// The project's markers, film seconds (manifest `markers`).
#[derive(Debug, Clone, uniffi::Record)]
pub struct Markers {
    pub sections: Vec<MarkerSection>,
    pub bars: Vec<f64>,
    pub hits: Vec<MarkerHit>,
    /// where the music edit splices
    pub joins: Vec<f64>,
}

/// A declared variant: an env flag the scenes read, with its values (the first is the default).
#[derive(Debug, Clone, uniffi::Record)]
pub struct Variant {
    pub name: String,
    pub values: Vec<String>,
    /// the value this session runs with
    pub current: String,
}

/// A scene boundary, checked: is the cut seamless or does the picture jump?
#[derive(Debug, Clone, uniffi::Record)]
pub struct JoinCheck {
    pub scene: String,
    pub prev: String,
    pub frame: u32,
    pub t: f64,
    /// mean difference across the cut and just before it (0–255)
    pub mean: f64,
    pub baseline: f64,
    pub jumps: bool,
    /// a deliberate hard cut the project declares (markers.cuts): meant to jump
    pub cut: bool,
    /// the difference above which it would jump
    pub threshold: f64,
    /// why it couldn't be checked
    pub unknown: Option<String>,
}

/// A finished render of the project (an mp4 the pipeline wrote).
#[derive(Debug, Clone, uniffi::Record)]
pub struct RenderInfo {
    pub path: String,
    pub file: String,
    pub bytes: u64,
    /// seconds since 1970
    pub modified: f64,
    /// None = the whole film; else the part after `--` (a scene, maybe with a variant suffix)
    pub part: Option<String>,
    /// the scene it is, when it's one scene; the render's time 0 is that scene's first frame
    pub scene: Option<String>,
    /// "@4k" …; empty for 1080p
    pub size: String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ScriptLine { pub text: String, pub t: f64, pub at: String }

#[derive(Debug, Clone, uniffi::Record)]
pub struct ScriptPanel {
    /// project-relative, as the script names it
    pub sketch: String,
    /// the file
    pub path: String,
    pub caption: Option<String>,
    pub start: f64,
    pub end: f64,
    pub found: bool,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ScriptBeat {
    pub id: String,
    pub title: String,
    pub start: f64,
    pub end: f64,
    pub at: String,
    pub to: String,
    /// "sketch" (not built: the viewer shows its panels) or "built"
    pub status: String,
    /// it starts past the film's end
    pub planned: bool,
    pub picture: Option<String>,
    pub narration: Vec<ScriptLine>,
    pub panels: Vec<ScriptPanel>,
}

/// The film's script (script.json) on its clock: flex_core::script.
#[derive(Debug, Clone, uniffi::Record)]
pub struct ScriptInfo {
    pub beats: Vec<ScriptBeat>,
    pub notes: Vec<String>,
    /// the film's length, and the plan's (longer when beats are planned past the film's end)
    pub duration: f64,
    pub length: f64,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct EngineSnapshot {
    pub generation: u64,
    /// bumps when script.json or a sketch changes (read `script()` again)
    pub script_generation: u64,
    pub loading: bool,
    pub error: Option<String>,
    pub painting: bool,
    pub changed: u32,
    pub reload_ms: u64,
    pub fps: u32,
    pub frames: u32,
    pub scenes: Vec<SceneStatus>,
    /// the film's mixed sound, once ready (voice, effects and music, as a render mixes them)
    pub mix_path: Option<String>,
    pub mixing: bool,
    pub mix_error: Option<String>,
    pub voice: Vec<VoiceCue>,
    pub joins: Vec<JoinCheck>,
    pub checking_joins: bool,
    /// a render the `flex` command runs through the app: frames done, frames, and what ("the film", "scene x")
    pub rendering: Option<RenderProgress>,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct RenderProgress { pub done: u32, pub total: u32, pub what: String }

/// One open project: its server, painter, cache and watcher (flex-core's Engine).
#[derive(uniffi::Object)]
pub struct ProjectEngine { inner: std::sync::Arc<flex_core::Engine> }

#[uniffi::export]
impl ProjectEngine {
    /// Start loading, painting and watching. Returns at once; poll `snapshot()`.
    #[uniffi::constructor]
    pub fn new(path: String, width: u32) -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self { inner: flex_core::Engine::open(Path::new(&path), width) })
    }

    pub fn set_playhead(&self, frame: u32) { self.inner.set_playhead(frame) }

    /// A playhead move the `flex` command asked for (`flex show`), once: the window seeks there.
    pub fn take_seek(&self) -> Option<u32> { self.inner.take_seek() }

    /// The painted frame's file, if it's painted (never paints).
    pub fn frame_path(&self, frame: u32) -> Option<String> {
        self.inner.frame_path(frame).map(|p| p.to_string_lossy().into_owned())
    }

    pub fn snapshot(&self) -> EngineSnapshot {
        let st = self.inner.state();
        let s = self.inner.session();
        let (fps, frames) = s.as_ref().map(|s| (s.manifest().fps, s.manifest().frames)).unwrap_or((30, 0));
        let scenes = s.as_ref().map(|s| s.manifest().scenes.iter().map(|sc| SceneStatus {
            id: sc.id.clone(), first: sc.first, frames: sc.frames,
            painted: st.scenes.iter().find(|(id, _, _)| id == &sc.id).map(|x| x.1).unwrap_or(0),
            unpaintable: sc.items.iter().filter(|i| !i.paintable).map(|i| i.label.clone()).collect(),
            error: s.error(&sc.id).map(String::from),
        }).collect()).unwrap_or_default();
        EngineSnapshot { generation: st.generation, script_generation: self.inner.script_generation(), loading: st.loading, error: st.error, painting: st.painting,
            changed: st.changed, reload_ms: st.last_reload_ms, fps, frames, scenes,
            mix_path: st.mix.as_ref().map(|p| p.to_string_lossy().into_owned()), mixing: st.mixing, mix_error: st.mix_error.clone(),
            voice: st.voice.iter().map(|(t, d, x)| VoiceCue { start: *t, dur: *d, text: x.clone() }).collect(),
            joins: st.joins.iter().map(|j| JoinCheck { scene: j.scene.clone(), prev: j.prev.clone(), frame: j.frame, t: j.t,
                mean: j.mean, baseline: j.baseline, jumps: j.jumps, cut: j.cut,
                threshold: flex_core::joins::threshold(j.baseline), unknown: j.unknown.clone() }).collect(),
            checking_joins: st.checking_joins,
            rendering: self.inner.rendering().map(|(done, total, what)| RenderProgress { done, total, what }) }
    }

    /// The film's script (script.json) on its clock, once the project has loaded; None without one.
    pub fn script(&self) -> Option<ScriptInfo> {
        let sc = self.inner.script()?;
        let dir = &self.inner.dir;
        Some(ScriptInfo { notes: sc.notes, duration: sc.duration, length: sc.length, beats: sc.beats.into_iter().map(|b| ScriptBeat {
            id: b.id, title: b.title, start: b.start, end: b.end, at: b.at, to: b.to, status: b.status, planned: b.planned, picture: b.picture,
            narration: b.narration.into_iter().map(|l| ScriptLine { text: l.text, t: l.t, at: l.at }).collect(),
            panels: b.panels.into_iter().map(|p| ScriptPanel { path: dir.join(&p.sketch).to_string_lossy().into_owned(), sketch: p.sketch,
                caption: p.caption, start: p.start, end: p.end, found: p.found }).collect(),
        }).collect() })
    }

    /// A panel's sketch as a PNG at `width` (an SVG rendered, a picture scaled; cached by content), for the lane and the
    /// viewer. Call off the main thread the first time.
    pub fn sketch_png(&self, sketch: String, width: u32) -> Option<String> {
        flex_core::script::panel_png(&self.inner.dir, &sketch, width).ok().map(|p| p.to_string_lossy().into_owned())
    }

    /// The project's markers (sections, bars, hits, the edit's joins), once loaded and if it declares them.
    pub fn markers(&self) -> Option<Markers> {
        let s = self.inner.session()?;
        let m = s.manifest().markers.as_ref()?;
        Some(Markers {
            sections: m.sections.iter().map(|x| MarkerSection { id: x.id.clone(), start: x.start, end: x.end }).collect(),
            bars: m.bars.clone(),
            hits: m.hits.iter().map(|h| MarkerHit { label: h.label.clone(), t: h.t }).collect(),
            joins: m.joins.clone(),
        })
    }

    /// Every cut (a change of card, take or scene) and how far it sits from the nearest beat or declared hit.
    /// Empty until the track has a grid (flex music).
    pub fn cuts(&self) -> Vec<CutMark> {
        let Some(s) = self.inner.session() else { return vec![] };
        flex_core::cuts::check(&self.inner.dir, s.manifest()).unwrap_or_default().into_iter().map(|c| CutMark {
            t: c.t, from: c.from, to: c.to, scene: c.scene, at: c.at, target: c.nearest, off_ms: c.off_ms, on: c.on, declared: c.declared }).collect()
    }

    /// The song's hits (flex music: each stem's onsets, with strength 0–1, and entries) at their film times, through the
    /// music edit (a repeated bar's hits appear at each repeat). Empty until flex music has read the track.
    pub fn film_hits(&self) -> Vec<FilmHit> {
        let Some(s) = self.inner.session() else { return vec![] };
        let m = s.manifest();
        let music = flex_core::Music { key: m.music.key.clone(), segments: m.music.segments.clone(), from: m.music.from, tracks: m.music.tracks.clone() };
        let Ok(g) = flex_core::filmgrid::FilmGrid::load(&self.inner.dir, &music, m.duration) else { return vec![] };
        let audio: serde_json::Value = std::fs::read_to_string(self.inner.dir.join("audio.json")).ok().and_then(|x| serde_json::from_str(&x).ok()).unwrap_or_default();
        let Some(file) = audio["music"][&music.key]["file"].as_str() else { return vec![] };
        let mj: serde_json::Value = std::fs::read_to_string(self.inner.dir.join(file).with_extension("music.json")).ok().and_then(|x| serde_json::from_str(&x).ok()).unwrap_or_default();
        mj["hits"].as_array().cloned().unwrap_or_default().iter().flat_map(|h| {
            let (t, stem, st, entry) = (h["t"].as_f64().unwrap_or(0.0), h["stem"].as_str().unwrap_or("").to_string(), h["strength"].as_f64().unwrap_or(0.0), h["entry"].as_bool().unwrap_or(false));
            g.to_film(t).into_iter().map(move |ft| FilmHit { t: ft, stem: stem.clone(), strength: st, entry, at: String::new() }).collect::<Vec<_>>()
        }).map(|mut h| { h.at = g.at(h.t); h }).collect()
    }

    /// Each narration line's words in film time (local Whisper, cached; seconds the first time). Call off the main thread.
    pub fn narration_words(&self) -> Vec<NarrationWord> {
        let Some(s) = self.inner.session() else { return vec![] };
        flex_core::narration::check(&self.inner.dir, &s.server).unwrap_or_default().into_iter().enumerate()
            .flat_map(|(i, l)| l.words.into_iter().map(move |w| NarrationWord { line: i as u32, word: w.word, t: w.t, end: w.end, at: w.at, off_beat_ms: w.off_beat_ms, over_singing: w.over_singing }))
            .collect()
    }

    /// How the music dips under each narration line (flex duck), as JSON. Mixes the film twice: call off the main thread.
    pub fn duck_json(&self) -> Option<String> {
        let o = flex_core::tools::duck(&self.inner.dir, &["--json".into()]).ok()?.output().ok()?;
        String::from_utf8_lossy(&o.stdout).lines().rev().find(|l| l.starts_with('{')).map(String::from)
    }

    /// The film's bar lines (film seconds), through the music edit (empty without a grid: flex music).
    pub fn film_bars(&self) -> Vec<f64> {
        let Some(s) = self.inner.session() else { return vec![] };
        let m = s.manifest();
        let music = flex_core::Music { key: m.music.key.clone(), segments: m.music.segments.clone(), from: m.music.from, tracks: m.music.tracks.clone() };
        flex_core::filmgrid::FilmGrid::load(&self.inner.dir, &music, m.duration).map(|g| g.bars).unwrap_or_default()
    }

    /// Every take clip's camera plan as the film paints it (the camera lane).
    pub fn camera(&self) -> Vec<CameraClip> {
        let Some(s) = self.inner.session() else { return vec![] };
        s.manifest().scenes.iter().flat_map(|sc| sc.items.iter().filter_map(move |it| {
            let c = it.take.as_ref()?;
            let block = |kind: &str, b: &flex_core::CameraBlock| CameraBlockInfo {
                id: b.id.clone().unwrap_or_default(), kind: kind.into(),
                label: if kind == "zoom" { format!("×{} {}", b.scale.unwrap_or(1.0), b.kind.clone().unwrap_or_default()) }
                       else { b.effect_type.clone().unwrap_or_default().rsplit('/').next().unwrap_or_default().to_string() },
                start_ms: b.start, end_ms: b.end, enabled: b.enabled };
            Some(CameraClip { scene: sc.id.clone(), take: c.take.clone(), film_start: it.start, film_end: it.end, from: c.from, to: c.to,
                locked: c.locked, patched: c.patched,
                blocks: c.segments.iter().map(|b| block("zoom", b)).chain(c.effects.iter().map(|b| block("effect", b))).collect() })
        })).collect()
    }

    /// Edit a camera block in the take's edl.json (times in take ms; `shift` moves both); locks the plan. The engine
    /// reloads on the file change and repaints what moved.
    pub fn camera_edit(&self, take: String, id: String, start_ms: Option<f64>, end_ms: Option<f64>, shift_ms: Option<f64>, enabled: Option<bool>) -> Result<(), FlexError> {
        let e = flex_core::camera::Edit { start: start_ms, end: end_ms, shift: shift_ms, enabled, params: vec![] };
        flex_core::camera::edit(&self.inner.dir, &take, &id, &e).map(|_| ()).map_err(|e| FlexError::Failed { message: e.to_string() })
    }

    pub fn camera_lock(&self, take: String, locked: bool) -> Result<(), FlexError> {
        flex_core::camera::set_locked(&self.inner.dir, &take, locked).map_err(|e| FlexError::Failed { message: e.to_string() })
    }

    /// The declared variants, with the value each runs with now.
    pub fn variants(&self) -> Vec<Variant> {
        let Some(s) = self.inner.session() else { return vec![] };
        let on = self.inner.variants();
        s.manifest().variants.iter().map(|(name, values)| Variant {
            name: name.clone(), values: values.clone(),
            current: on.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()).or_else(|| values.first().cloned()).unwrap_or_default(),
        }).collect()
    }

    /// Run the film with `name=value` (the first declared value clears the flag). Restarts the
    /// session; unchanged frames stay cached.
    pub fn set_variant(&self, name: String, value: String) {
        let default = self.inner.session().and_then(|s| s.manifest().variants.get(&name).and_then(|v| v.first().cloned()));
        self.inner.set_variant(&name, (Some(&value) != default.as_ref()).then_some(value.as_str()));
    }

    /// Preview take versions in the film in place of their picks ("circles-pool-back=v2,…"; "" = the picks). Restarts
    /// the session; frames that don't change stay cached.
    pub fn set_take_versions(&self, value: String) {
        self.inner.set_variant("FLEX_TAKE_VERSIONS", (!value.is_empty()).then_some(value.as_str()));
    }

    /// Paint one frame at `width` into `path` (PNG or JPEG by extension), now.
    pub fn export_still(&self, frame: u32, width: u32, path: String) -> Result<(), FlexError> {
        self.inner.export_still(frame, width, Path::new(&path)).map_err(|e| FlexError::Failed { message: e.to_string() })
    }

    /// The project's finished renders in `dir` (newest first): mp4s named after the project.
    pub fn renders(&self, dir: String) -> Vec<RenderInfo> {
        let Some(s) = self.inner.session() else { return vec![] };
        let m = s.manifest();
        flex_core::renders::list(Path::new(&dir), &m.name).into_iter().map(|r| render_info(r, m)).collect()
    }

    /// Any video file, for A/B (a whole film unless its name says it's one scene of this project).
    pub fn render_file(&self, path: String) -> Option<RenderInfo> {
        let s = self.inner.session()?;
        let m = s.manifest();
        flex_core::renders::describe(Path::new(&path), &m.name).map(|r| render_info(r, m))
    }

    /// Flex's default folder for this project's renders and exports, `~/Downloads/flex-videos/<name>/`
    /// (created now if missing).
    pub fn default_dir(&self) -> Option<String> {
        let s = self.inner.session()?;
        Some(flex_core::renders::default_dir(&s.manifest().name).to_string_lossy().into_owned())
    }

    /// The pipeline's own output folder for this project (`~/Downloads/fancy-e2e-videos/<out>/`; may not exist).
    pub fn pipeline_renders_dir(&self) -> Option<String> {
        let s = self.inner.session()?;
        Some(flex_core::renders::out_dir(s.manifest().out.as_deref()).to_string_lossy().into_owned())
    }

    /// The server's recent log lines (what the pipeline printed).
    pub fn log(&self) -> Vec<String> {
        self.inner.session().map(|s| s.server.log.lock().unwrap().clone()).unwrap_or_default()
    }

    pub fn close(&self) { self.inner.close() }
}

/// A capture command, run to the end (blocking; call it off the main thread): `journeys`, `report`, `pick`, `stage`
/// (docs/capture.md). Its JSON result.
#[uniffi::export]
pub fn capture_query(project: String, cmd: String, args: Vec<String>) -> Result<String, FlexError> {
    flex_core::capture::run_json(Path::new(&project), &cmd, &args).map(|v| v.to_string()).map_err(|e| FlexError::Failed { message: e.to_string() })
}

/// A capture command running in the background (`run` a journey, dry or for real; `stage` a script): its log, the
/// newest recorded frame for a live view, and its JSON result when it ends.
#[derive(uniffi::Object)]
pub struct CaptureJob { inner: flex_core::CaptureRun }

#[uniffi::export]
impl CaptureJob {
    #[uniffi::constructor]
    pub fn start(project: String, cmd: String, args: Vec<String>) -> Result<std::sync::Arc<Self>, FlexError> {
        flex_core::CaptureRun::start(Path::new(&project), &cmd, &args).map(|inner| std::sync::Arc::new(CaptureJob { inner }))
            .map_err(|e| FlexError::Failed { message: e.to_string() })
    }
    pub fn log(&self) -> Vec<String> { self.inner.log() }
    pub fn running(&self) -> bool { self.inner.running() }
    /// the JSON result once it has ended
    pub fn result(&self) -> Option<String> { self.inner.result().map(|v| v.to_string()) }
    pub fn latest_frame(&self) -> Option<String> { self.inner.latest_frame().map(|p| p.to_string_lossy().into_owned()) }
    pub fn stop(&self) { self.inner.stop() }
}

/// Whether Flex has a key saved (`name`: "openai").
#[uniffi::export]
pub fn has_key(name: String) -> bool { flex_core::secrets::get(&name).is_some() }

/// Save a key (in Flex's support folder, readable only by you); the tools Flex starts from now on get it (OPENAI_API_KEY for "openai").
#[uniffi::export]
pub fn set_key(name: String, value: String) -> Result<(), FlexError> {
    flex_core::secrets::set(&name, &value).map_err(|e| FlexError::Failed { message: e.to_string() })
}

#[uniffi::export]
pub fn remove_key(name: String) -> Result<(), FlexError> {
    flex_core::secrets::remove(&name).map_err(|e| FlexError::Failed { message: e.to_string() })
}

/// Which voice engine narration uses (and why), for a project or in general.
#[uniffi::export]
pub fn voice_engine(project: Option<String>) -> String {
    flex_core::secrets::voice_engine(project.as_deref().map(Path::new))
}
