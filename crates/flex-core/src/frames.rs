//! A project's frames: asked of the server, painted here, cached on disk by key.
//!
//! The cache is `<support>/cache/p<painter version>/<width>/<key>.jpg`. A key is a hash of a frame's layers and of
//! the files they name (docs/server.md), so an edit repaints exactly the frames it changed, and
//! two projects (or a project and its copy) share frames that look the same.

use crate::paint::{self, Layer};
use crate::project::{support_dir, ProjectError};
use crate::server::{FrameLayers, Manifest, Server};
use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

pub const JPEG_QUALITY: u8 = 86;
/// Bump when the painter's output changes: older paintings then stop matching.
pub const PAINTER_VERSION: u32 = 7;

/// Where a frame comes from, once asked for.
#[derive(Debug, Clone, PartialEq)]
pub enum FrameState {
    /// painted and on disk
    Cached(PathBuf),
    /// no layers for it yet (a take): show the label
    Placeholder(String),
}

pub struct Session {
    pub dir: PathBuf,
    pub server: Server,
    keys: Mutex<Vec<String>>,
    /// scenes whose code threw, with the error (their frames aren't painted)
    pub errors: Vec<(String, String)>,
}

pub fn cache_dir(width: u32) -> PathBuf {
    let d = support_dir().join("cache").join(format!("p{PAINTER_VERSION}")).join(width.to_string());
    let _ = std::fs::create_dir_all(&d);
    d
}

impl Session {
    /// Start the server and key every frame (a couple of seconds for a minute of film).
    pub fn open(dir: &Path) -> Result<Session, ProjectError> { Self::open_with(dir, &[]) }

    /// with variant flags set (name, value), e.g. ("END", "dark")
    pub fn open_with(dir: &Path, variants: &[(String, String)]) -> Result<Session, ProjectError> {
        let server = Server::start_with(dir, variants)?;
        let (keys, errors) = server.keys(0, server.manifest.frames)?;
        Ok(Session { dir: std::fs::canonicalize(dir)?, server, keys: Mutex::new(keys), errors })
    }

    /// Start the server without keying every frame first (a render keys each frame from the layers it fetches anyway,
    /// and keying a film computes all its layers once more: ~7 ms a frame).
    pub fn open_unkeyed(dir: &Path) -> Result<Session, ProjectError> {
        let server = Server::start_with(dir, &[])?;
        Ok(Session { dir: std::fs::canonicalize(dir)?, server, keys: Mutex::new(vec![]), errors: vec![] })
    }

    pub fn manifest(&self) -> &Manifest { &self.server.manifest }

    pub fn error(&self, scene: &str) -> Option<&str> { self.errors.iter().find(|(s, _)| s == scene).map(|(_, e)| e.as_str()) }

    pub fn key(&self, frame: u32) -> Option<String> { self.keys.lock().unwrap().get(frame as usize).cloned() }

    fn path(key: &str, width: u32) -> PathBuf { cache_dir(width).join(format!("{key}.jpg")) }

    /// The frame if it's already painted, without painting it.
    pub fn cached(&self, frame: u32, width: u32) -> Option<PathBuf> {
        let p = Self::path(&self.key(frame)?, width);
        p.exists().then_some(p)
    }

    /// The frame, painting it now if it isn't cached.
    pub fn frame(&self, frame: u32, width: u32) -> Result<FrameState, ProjectError> {
        if let Some(p) = self.cached(frame, width) { return Ok(FrameState::Cached(p)); }
        match self.server.layers(frame)? {
            FrameLayers::Placeholder(why) => Ok(FrameState::Placeholder(why)),
            FrameLayers::Error(e) => Ok(FrameState::Placeholder(format!("error: {e}"))),
            FrameLayers::Layers(layers) => {
                let key = self.key(frame).unwrap_or_else(|| format!("nokey-{frame}"));
                Ok(FrameState::Cached(paint_to(&layers, self.manifest().size, width, &Self::path(&key, width))?))
            }
        }
    }

    /// Paint every uncached frame in `frames` in parallel; `progress(done, total)` as they land.
    /// Layers come from the server one frame at a time (ms each); painting uses every core.
    pub fn warm(&self, frames: impl IntoIterator<Item = u32>, width: u32, progress: impl Fn(usize, usize) + Sync) -> Result<WarmReport, ProjectError> {
        // one painting per key: held frames share theirs
        let mut todo: Vec<(u32, String)> = vec![];
        let mut seen = std::collections::HashSet::new();
        let keys = self.keys.lock().unwrap().clone();
        for f in frames {
            let Some(k) = keys.get(f as usize) else { continue };
            if seen.insert(k.clone()) && !Self::path(k, width).exists() { todo.push((f, k.clone())); }
        }
        let total = todo.len();
        let done = AtomicUsize::new(0);
        let placeholders = AtomicUsize::new(0);
        let errors: Arc<Mutex<Vec<String>>> = Default::default();
        // fetch layers in chunks (serial, cheap), paint each chunk in parallel
        for chunk in todo.chunks(64) {
            let mut work: Vec<(String, Vec<Layer>)> = vec![];
            for (f, k) in chunk {
                match self.server.layers(*f)? {
                    FrameLayers::Layers(l) => work.push((k.clone(), l)),
                    FrameLayers::Placeholder(_) | FrameLayers::Error(_) => { placeholders.fetch_add(1, Ordering::Relaxed); done.fetch_add(1, Ordering::Relaxed); }
                }
            }
            work.par_iter().for_each(|(k, l)| {
                if let Err(e) = paint_to(l, self.manifest().size, width, &Self::path(k, width)) { errors.lock().unwrap().push(e.to_string()); }
                progress(done.fetch_add(1, Ordering::Relaxed) + 1, total);
            });
        }
        let errors = errors.lock().unwrap().clone();
        Ok(WarmReport { painted: total - placeholders.load(Ordering::Relaxed) - errors.len(), placeholders: placeholders.into_inner(), errors })
    }

    /// Frames of each scene that are painted at `width`: (scene id, cached, total).
    pub fn status(&self, width: u32) -> Vec<(String, u32, u32)> {
        self.manifest().scenes.iter().map(|s| {
            let n = (s.first..s.first + s.frames).filter(|f| self.cached(*f, width).is_some()).count() as u32;
            (s.id.clone(), n, s.frames)
        }).collect()
    }
}

#[derive(Debug)]
pub struct WarmReport { pub painted: usize, pub placeholders: usize, pub errors: Vec<String> }

fn paint_to(layers: &[Layer], frame: [u32; 2], width: u32, out: &Path) -> Result<PathBuf, ProjectError> {
    let painted = paint::paint_in(layers, frame, width).map_err(|e| ProjectError::Run(e.to_string()))?;
    paint::save(&painted.pixmap, out, JPEG_QUALITY).map_err(ProjectError::Run)?;
    Ok(out.to_path_buf())
}
