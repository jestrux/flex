//! The engine for one open project: a session (server + keys), a painter that keeps the cache
//! full, nearest the playhead first, and a watcher that reloads on any change in the project.
//!
//! Front ends (the app, `flex watch`) drive it with `set_playhead` and read `state()`; it never
//! calls back. A reload restarts the server, re-keys the film and repaints only frames whose key
//! changed.

use crate::frames::Session;
use crate::paint;
use crate::project::ProjectError;
use crate::server::FrameLayers;
use notify::{RecursiveMode, Watcher};
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

/// Frames painted ahead of the playhead before anything else.
pub const AHEAD: u32 = 90;
const BATCH: usize = 64;

#[derive(Debug, Clone, Default)]
pub struct EngineState {
    /// bumps on every reload; frame paths from an older generation may be stale
    pub generation: u64,
    pub loading: bool,
    /// why the last load failed (the project keeps its last good frames)
    pub error: Option<String>,
    /// painted / total per scene, in manifest order
    pub scenes: Vec<(String, u32, u32)>,
    pub painting: bool,
    /// frames whose key changed in the last reload
    pub changed: u32,
    pub last_reload_ms: u64,
    /// the film's mixed sound (voice, effects, music), once it's ready for this generation
    pub mix: Option<PathBuf>,
    pub mixing: bool,
    pub mix_error: Option<String>,
    /// the narration lines: (film seconds, length in seconds, text)
    pub voice: Vec<(f64, f64, String)>,
    /// every scene boundary, checked for a jump (crate::joins), once checked for this generation
    pub joins: Vec<crate::joins::JoinCheck>,
    pub checking_joins: bool,
    /// the variant flags this session runs with (name, value)
    pub variants: Vec<(String, String)>,
}

pub struct Engine {
    pub dir: PathBuf,
    pub width: u32,
    session: RwLock<Option<Arc<Session>>>,
    playhead: AtomicU32,
    generation: AtomicU64,
    /// bumps when the film's script (script.json) or a storyboard sketch changes: those reload nothing else
    script_generation: AtomicU64,
    stop: AtomicBool,
    dirty: AtomicBool,
    state: Mutex<EngineState>,
    /// variant flags for the next session (set_variant restarts it)
    variants: Mutex<Vec<(String, String)>>,
    status_at: Mutex<Option<Instant>>,
    _watcher: Mutex<Option<notify::RecommendedWatcher>>,
    self_ref: Mutex<Option<std::sync::Weak<Engine>>>,
    /// a playhead move asked for from outside (`flex show`), until the front end takes it
    seek: Mutex<Option<u32>>,
    /// a render running through the control socket: (frames done, frames, what)
    rendering: Mutex<Option<(u32, u32, String)>>,
}

fn ignored(p: &Path) -> bool {
    p.components().any(|c| matches!(c.as_os_str().to_str(), Some("node_modules" | ".git" | "build" | ".cache" | ".versions" | ".flex")))
        || p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.') || n.ends_with('~') || n.ends_with(".swp"))
}

/// script.json, or anything under storyboard/ (sketches, flex walk's screenshots)
fn is_storyboard(dir: &Path, p: &Path) -> bool {
    let rel = p.strip_prefix(dir).unwrap_or(p);
    rel == Path::new("script.json") || rel.starts_with("storyboard")
}

impl Engine {
    /// Open a project and start painting and watching. Loading runs in the background: read
    /// `state()` (`loading`, then `error` or scenes).
    pub fn open(dir: &Path, width: u32) -> Arc<Engine> {
        let e = Arc::new(Engine {
            dir: dir.to_path_buf(), width,
            session: RwLock::new(None),
            playhead: AtomicU32::new(0), generation: AtomicU64::new(0), script_generation: AtomicU64::new(0),
            stop: AtomicBool::new(false), dirty: AtomicBool::new(true),
            state: Mutex::new(EngineState { loading: true, ..Default::default() }),
            variants: Mutex::new(vec![]),
            status_at: Mutex::new(None),
            _watcher: Mutex::new(None),
            self_ref: Mutex::new(None),
            seek: Mutex::new(None),
            rendering: Mutex::new(None),
        });
        *e.self_ref.lock().unwrap() = Some(Arc::downgrade(&e));
        crate::control::register(&e);
        // the watcher only marks the project dirty; the worker reloads after a short quiet spell
        let weak = Arc::downgrade(&e);
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            let paths: Vec<&PathBuf> = ev.paths.iter().filter(|p| !ignored(p)).collect();
            if paths.is_empty() { return; }
            let Some(e) = weak.upgrade() else { return };
            // the script and its sketches are the film's plan, not the film: only the storyboard needs reading again
            if paths.iter().all(|p| is_storyboard(&e.dir, p)) { e.script_generation.fetch_add(1, Ordering::SeqCst); }
            else { e.dirty.store(true, Ordering::SeqCst); }
        });
        if let Ok(mut w) = w {
            let _ = w.watch(dir, RecursiveMode::Recursive);
            *e._watcher.lock().unwrap() = Some(w);
        }
        let worker = e.clone();
        std::thread::spawn(move || worker.run());
        e
    }

    pub fn close(&self) { self.stop.store(true, Ordering::SeqCst); }

    pub fn closed(&self) -> bool { self.stop.load(Ordering::SeqCst) }

    pub fn set_playhead(&self, frame: u32) { self.playhead.store(frame, Ordering::Relaxed); }

    /// Where the front end's playhead is.
    pub fn playhead(&self) -> u32 { self.playhead.load(Ordering::Relaxed) }

    /// Ask the front end to move its playhead to `frame` (`flex show`); it takes the request with `take_seek`.
    pub fn request_seek(&self, frame: u32) { *self.seek.lock().unwrap() = Some(frame); self.set_playhead(frame); }

    pub fn take_seek(&self) -> Option<u32> { self.seek.lock().unwrap().take() }

    /// A render running through the control socket, for the front end to show: (frames done, frames, what).
    pub fn rendering(&self) -> Option<(u32, u32, String)> { self.rendering.lock().unwrap().clone() }

    pub(crate) fn set_rendering(&self, r: Option<(u32, u32, String)>) { *self.rendering.lock().unwrap() = r; }

    pub(crate) fn set_rendering_progress(&self, done: u32, total: u32) {
        if let Some(r) = self.rendering.lock().unwrap().as_mut() { r.0 = done; r.1 = total; }
    }

    pub fn state(&self) -> EngineState { self.state.lock().unwrap().clone() }

    /// Bumps when script.json or a storyboard sketch changes (read `script()` again).
    pub fn script_generation(&self) -> u64 { self.script_generation.load(Ordering::SeqCst) }

    /// The film's script on its clock (the film grid through its music edit), once loaded; None without a script.json.
    pub fn script(&self) -> Option<crate::script::Script> {
        let s = self.session()?;
        let m = s.manifest();
        let music = crate::Music { key: m.music.key.clone(), segments: m.music.segments.clone(), from: m.music.from, tracks: m.music.tracks.clone() };
        let grid = crate::filmgrid::FilmGrid::load(&self.dir, &music, m.duration).ok();
        crate::script::load(&self.dir, grid.as_ref(), m.duration).ok().flatten()
    }

    pub fn session(&self) -> Option<Arc<Session>> { self.session.read().unwrap().clone() }

    /// Run the film with a variant flag (`END=dark`), or without it (`value` None = the default).
    /// Restarts the session with the flags; frames that don't change stay cached (keys are content).
    pub fn set_variant(&self, name: &str, value: Option<&str>) {
        let mut v = self.variants.lock().unwrap();
        v.retain(|(k, _)| k != name);
        if let Some(value) = value { v.push((name.to_string(), value.to_string())); }
        v.sort();
        drop(v);
        self.dirty.store(true, Ordering::SeqCst);
    }

    /// The variant flags asked for (they apply from the next reload).
    pub fn variants(&self) -> Vec<(String, String)> { self.variants.lock().unwrap().clone() }

    /// Paint one frame at any width, now, to a PNG or JPEG (by extension), whatever the cache holds.
    pub fn export_still(&self, frame: u32, width: u32, out: &Path) -> Result<()> {
        let s = self.session().ok_or_else(|| ProjectError::Run("the project isn't loaded yet".into()))?;
        match s.server.layers(frame)? {
            FrameLayers::Layers(l) => {
                let p = paint::paint_in(&l, s.manifest().size, width).map_err(|e| ProjectError::Run(e.to_string()))?;
                paint::save(&p.pixmap, out, 95).map_err(ProjectError::Run)
            }
            FrameLayers::Placeholder(why) => Err(ProjectError::Run(format!("frame {frame} has nothing to paint: {why}"))),
            FrameLayers::Error(e) => Err(ProjectError::Run(format!("frame {frame}: the scene's code threw:\n{e}"))),
        }
    }

    /// The painted frame at `frame`, if there is one (never paints).
    pub fn frame_path(&self, frame: u32) -> Option<PathBuf> { self.session()?.cached(frame, self.width) }

    fn run(self: Arc<Self>) {
        while !self.stop.load(Ordering::SeqCst) {
            if self.dirty.swap(false, Ordering::SeqCst) {
                // reload after 250 ms without changes (an editor saves in several writes)
                loop { std::thread::sleep(Duration::from_millis(250)); if !self.dirty.swap(false, Ordering::SeqCst) { break; } }
                self.reload();
                continue;
            }
            if !self.paint_some() { std::thread::sleep(Duration::from_millis(40)); }
        }
    }

    fn reload(&self) {
        let t = Instant::now();
        self.state.lock().unwrap().loading = true;
        let old = self.session();
        let variants = self.variants();
        match Session::open_with(&self.dir, &variants) {
            Ok(s) => {
                let changed = match &old {
                    Some(o) => (0..s.manifest().frames).filter(|f| o.key(*f) != s.key(*f)).count() as u32,
                    None => s.manifest().frames,
                };
                paint::forget_images();
                let s = Arc::new(s);
                *self.session.write().unwrap() = Some(s.clone());
                let g = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
                let mut st = self.state.lock().unwrap();
                st.generation = g; st.loading = false; st.error = None; st.changed = changed;
                st.last_reload_ms = t.elapsed().as_millis() as u64;
                st.scenes = s.status(self.width);
                st.variants = variants.clone();
                drop(st);
                self.start_mix(g, variants);
                self.start_joins(g, s);
            }
            Err(e) => {
                let mut st = self.state.lock().unwrap();
                st.loading = false; st.error = Some(e.to_string());
            }
        }
    }

    /// Mix the sound for generation `g` in its own server, so painting isn't held up. The mix is
    /// cached by its cues: an edit that moves no cue reuses it.
    fn start_mix(&self, g: u64, variants: Vec<(String, String)>) {
        { let mut st = self.state.lock().unwrap(); st.mixing = true; st.mix_error = None; }
        let dir = self.dir.clone();
        let me = self.self_ref.lock().unwrap().clone();
        std::thread::spawn(move || {
            let Some(e) = me.and_then(|w| w.upgrade()) else { return };
            let result = (|| -> Result<(PathBuf, Vec<(f64, f64, String)>)> {
                let srv = crate::server::Server::start_with(&dir, &variants)?;
                let cues = srv.cues()?;
                let voice = cues["voice"].as_array().map(|a| a.iter().map(|v| (
                    v["t"].as_f64().unwrap_or(0.) / 1000., v["dur"].as_f64().unwrap_or(0.), v["text"].as_str().unwrap_or("").to_string())).collect()).unwrap_or_default();
                let mut h = std::collections::hash_map::DefaultHasher::new();
                use std::hash::{Hash, Hasher};
                // the cues name voice files by text hash, and sound keys; the music by key and edit
                format!("{}|{}|{}|{}", cues["voice"], cues["sfx"], cues["music"], cues["total"]).hash(&mut h);
                let dirm = crate::project::support_dir().join("mix");
                std::fs::create_dir_all(&dirm)?;
                let out = dirm.join(format!("{:016x}.wav", h.finish()));
                if !out.exists() {
                    let tmp = out.with_extension("tmp.wav");
                    srv.mix(&tmp)?;
                    std::fs::rename(&tmp, &out)?;
                }
                Ok((out, voice))
            })();
            if e.generation.load(Ordering::SeqCst) != g { return; } // a newer reload took over
            let mut st = e.state.lock().unwrap();
            st.mixing = false;
            match result {
                Ok((p, voice)) => { st.mix = Some(p); st.voice = voice; }
                Err(err) => st.mix_error = Some(err.to_string()),
            }
        });
    }

    /// Check every scene boundary for generation `g` (paints a few frames at 480; seconds at most).
    fn start_joins(&self, g: u64, s: Arc<Session>) {
        self.state.lock().unwrap().checking_joins = true;
        let me = self.self_ref.lock().unwrap().clone();
        std::thread::spawn(move || {
            let joins = crate::joins::check(&s).unwrap_or_default();
            let Some(e) = me.and_then(|w| w.upgrade()) else { return };
            if e.generation.load(Ordering::SeqCst) != g { return; }
            let mut st = e.state.lock().unwrap();
            st.joins = joins; st.checking_joins = false;
        });
    }

    /// Paint the next batch of missing frames, nearest the playhead (ahead of it) first.
    /// Returns false when there's nothing left to paint.
    fn paint_some(&self) -> bool {
        let Some(s) = self.session() else { return false };
        let n = s.manifest().frames;
        if n == 0 { return false; }
        let ph = self.playhead.load(Ordering::Relaxed).min(n - 1);
        let mut seen = std::collections::HashSet::new();
        let mut todo: Vec<(u32, String)> = vec![];
        // ahead of the playhead, then the rest of the film from there, wrapping
        for i in 0..n {
            let f = (ph + i) % n;
            let Some(k) = s.key(f) else { continue };
            if !seen.insert(k.clone()) { continue; }
            if s.cached(f, self.width).is_none() && !self.placeholder(&s, f) && !k.starts_with("err") { todo.push((f, k)); }
            // near the playhead, small batches land sooner; further out, big ones keep every core busy
            if todo.len() >= BATCH || (i <= AHEAD && todo.len() >= BATCH / 4 && i == AHEAD) { break; }
        }
        if todo.is_empty() {
            let mut st = self.state.lock().unwrap();
            if st.painting { st.painting = false; st.scenes = s.status(self.width); }
            return false;
        }
        self.state.lock().unwrap().painting = true;
        let work: Vec<_> = todo.iter().filter_map(|(f, k)| match s.server.layers(*f) {
            Ok(FrameLayers::Layers(l)) => Some((k.clone(), l)),
            _ => None,
        }).collect();
        work.par_iter().for_each(|(k, l)| {
            if let Ok(p) = paint::paint_in(l, s.manifest().size, self.width) {
                let _ = paint::save(&p.pixmap, &crate::frames::cache_dir(self.width).join(format!("{k}.jpg")), crate::frames::JPEG_QUALITY);
            }
        });
        // per-scene counts stat every frame's file: at most twice a second
        let mut at = self.status_at.lock().unwrap();
        if at.is_none_or(|t| t.elapsed() > Duration::from_millis(500)) {
            *at = Some(Instant::now());
            let scenes = s.status(self.width);
            self.state.lock().unwrap().scenes = scenes;
        }
        true
    }

    fn placeholder(&self, s: &Session, f: u32) -> bool {
        s.manifest().scene_at(f).is_some_and(|sc| {
            sc.items.iter().any(|i| !i.paintable && (i.start * s.manifest().fps as f64).round() as u32 <= f && f < (i.end * s.manifest().fps as f64).round() as u32)
        })
    }
}

impl Drop for Engine { fn drop(&mut self) { self.stop.store(true, Ordering::SeqCst); } }

pub type Result<T> = std::result::Result<T, ProjectError>;
