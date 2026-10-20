//! The assets panel's FFI (flex_core::assets for the app). Lane A owns this file.
//!
//! `AssetsLibrary` keeps one project's last scan, so the panel asks for a preview by the asset's id and the engine
//! finds its files (the app never builds a path into a project). The scan itself is ~10 ms; previews that encode
//! (a take's proxy, a card's clip, a card's still) take seconds the first time: call them off the main thread.

use crate::FlexError;
use flex_core::assets::{self, preview, Asset, Options, Scan};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn fail(e: impl ToString) -> FlexError { FlexError::Failed { message: e.to_string() } }
fn s(p: &Path) -> String { p.to_string_lossy().into_owned() }
/// JSON laid out for reading, its numbers as written (Swift's JSONSerialization would print 0.85 as 0.8499999999999998)
fn pretty(json: &str) -> String {
    serde_json::from_str::<serde_json::Value>(json).ok().and_then(|v| serde_json::to_string_pretty(&v).ok()).unwrap_or_else(|| json.to_string())
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AssetVersion {
    pub n: u32,
    pub id: String,
    pub picked: bool,
    pub duration: Option<f64>,
    pub frames: Option<u32>,
    pub at: Option<String>,
}

/// One asset with its measured facts flattened (flex_core::assets::Facts; absent = not measured).
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AssetInfo {
    pub id: String,
    /// music, stem, sound, take, take-version, card, look, lab, freeze, still, image, render, other
    pub kind: String,
    pub title: String,
    pub note: Option<String>,
    pub file: Option<String>,
    pub files: Vec<String>,
    pub bytes: Option<u64>,
    pub modified: f64,
    pub parent: Option<String>,
    pub group: Option<String>,
    pub duration: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub lufs: Option<f64>,
    pub peak: Option<f64>,
    pub bpm: Option<f64>,
    pub words: Option<u32>,
    pub registered: Option<bool>,
    /// frames played (events.json's list, after retiming), not the folder's count
    pub frames: Option<u32>,
    pub dpr: Option<f64>,
    pub versions: Vec<AssetVersion>,
    pub version: Option<u32>,
    pub picked: Option<bool>,
    pub late: Option<u32>,
    pub worst_ms: Option<f64>,
    pub report: Option<String>,
    pub boxes: Option<String>,
    pub box_names: Vec<String>,
    pub card_type: Option<String>,
    pub origin: Option<String>,
    pub params: Option<String>,
    /// "preview" (the card's own sample) or "defaults"
    pub sample: Option<String>,
    pub target: Option<String>,
    pub cards: Option<u32>,
}

impl From<&Asset> for AssetInfo {
    fn from(a: &Asset) -> Self {
        let f = &a.facts;
        AssetInfo {
            id: a.id.clone(), kind: a.kind.name().into(), title: a.title.clone(), note: a.note.clone(),
            file: a.file.as_deref().map(s), files: a.files.iter().map(|p| s(p)).collect(), bytes: a.bytes, modified: a.modified,
            parent: a.parent.clone(), group: a.group.clone(),
            duration: f.duration, width: f.width, height: f.height, lufs: f.lufs, peak: f.peak, bpm: f.bpm, words: f.words,
            registered: f.registered, frames: f.frames, dpr: f.dpr,
            versions: f.versions.iter().map(|v| AssetVersion { n: v.n, id: v.id.clone(), picked: v.picked, duration: v.duration, frames: v.frames, at: v.at.clone() }).collect(),
            version: f.version, picked: f.picked, late: f.late, worst_ms: f.worst_ms, report: f.report.as_deref().map(s),
            boxes: f.boxes.as_deref().map(s), box_names: f.box_names.clone(), card_type: f.card_type.clone(), origin: f.origin.clone(),
            params: f.params.as_deref().map(pretty), sample: f.sample.clone(), target: f.target.clone(), cards: f.cards,
        }
    }
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AssetScan {
    pub assets: Vec<AssetInfo>,
    pub cards_stale: bool,
    pub cards_error: Option<String>,
    pub ms: f64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AssetWord { pub word: String, pub start: f64, pub end: f64, pub line: u32, pub at: Option<String> }

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct TakeFrame { pub ms: f64, pub file: String }

/// A still's element box, in the still's pixels.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct StillBox { pub name: String, pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct AssetThumb {
    pub file: String,
    /// one flat colour: a card that draws nothing with its sample params
    pub blank: bool,
}

/// One project's assets.
#[derive(uniffi::Object)]
pub struct AssetsLibrary {
    dir: PathBuf,
    opt: Mutex<Options>,
    last: Mutex<Option<Scan>>,
}

impl AssetsLibrary {
    /// the asset by id (or a path naming it), from the last scan (scanning first if there is none)
    fn asset(&self, id: &str) -> Result<Asset, FlexError> {
        if self.last.lock().unwrap().is_none() { self.scan(false)?; }
        let last = self.last.lock().unwrap();
        last.as_ref().and_then(|sc| sc.find(id)).cloned().ok_or_else(|| fail(format!("no asset \"{id}\"")))
    }
    fn root(&self) -> PathBuf { self.last.lock().unwrap().as_ref().map(|s| s.dir.clone()).unwrap_or_else(|| self.dir.clone()) }
}

#[uniffi::export]
impl AssetsLibrary {
    #[uniffi::constructor]
    pub fn new(path: String) -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self { dir: PathBuf::from(path), opt: Mutex::new(Options::default()), last: Mutex::new(None) })
    }

    /// The film's track when it isn't in the project's audio.json (ProjectInfo.music_file).
    pub fn set_track(&self, file: Option<String>) { self.opt.lock().unwrap().track = file.map(PathBuf::from); }

    /// The renders folder (the project's chosen one; default Flex's).
    pub fn set_renders(&self, dir: Option<String>) { self.opt.lock().unwrap().renders = dir.map(PathBuf::from); }

    /// Scan the project (~10 ms). `refresh_cards` lists the cards through the pipeline when the list is stale (2–4 s).
    pub fn scan(&self, refresh_cards: bool) -> Result<AssetScan, FlexError> {
        let mut opt = self.opt.lock().unwrap().clone();
        opt.refresh_cards = refresh_cards;
        let sc = assets::scan(&self.dir, &opt).map_err(fail)?;
        let out = AssetScan { assets: sc.assets.iter().map(AssetInfo::from).collect(), cards_stale: sc.cards_stale, cards_error: sc.cards_error.clone(), ms: sc.ms };
        *self.last.lock().unwrap() = Some(sc);
        Ok(out)
    }

    /// The id of the asset a path names (an id, a project path, an absolute path, one of its files).
    pub fn find(&self, path: String) -> Option<String> { self.asset(&path).ok().map(|a| a.id) }

    /// An audio asset's peaks (0–1), `per_second` bins a second, as the file is. Cached; seconds the first time.
    pub fn peaks(&self, id: String, per_second: u32) -> Result<Vec<f32>, FlexError> {
        let a = self.asset(&id)?;
        preview::peaks(a.file.as_deref().ok_or_else(|| fail("no file"))?, per_second).map_err(fail)
    }

    /// An audio asset's words with their times in the file, where a transcription exists.
    pub fn words(&self, id: String) -> Vec<AssetWord> {
        let Ok(a) = self.asset(&id) else { return vec![] };
        preview::words(&self.root(), &a).into_iter().map(|w| AssetWord { word: w.word, start: w.start, end: w.end, line: w.line, at: w.at }).collect()
    }

    /// A take's or version's frames with their times (ms into the take).
    pub fn take_frames(&self, id: String) -> Vec<TakeFrame> {
        let Ok(a) = self.asset(&id) else { return vec![] };
        preview::take_folder(&self.root(), &a).map(|f| preview::take_frames(&f).into_iter().map(|(ms, p)| TakeFrame { ms, file: s(&p) }).collect()).unwrap_or_default()
    }

    /// A take or version as an mp4 on its own clock, `width` wide. Encoded once (seconds), then cached.
    pub fn take_proxy(&self, id: String, width: u32) -> Result<String, FlexError> {
        let a = self.asset(&id)?;
        let folder = preview::take_folder(&self.root(), &a).ok_or_else(|| fail(format!("{id} isn't a take")))?;
        preview::take_proxy(&folder, width).map(|p| s(&p)).map_err(fail)
    }

    /// A version's timing report (`report.json`), as JSON text.
    pub fn report(&self, id: String) -> Option<String> {
        std::fs::read_to_string(self.asset(&id).ok()?.facts.report?).ok()
    }

    /// A card alone as a clip with its sample params, `width` wide (runs the pipeline: seconds, then cached).
    pub fn card_clip(&self, id: String, width: u32) -> Result<String, FlexError> {
        let a = self.asset(&id)?;
        let t = a.facts.card_type.as_deref().ok_or_else(|| fail(format!("{id} registers no card of its own")))?;
        preview::card_clip(&self.root(), t, a.facts.params.as_deref(), a.facts.duration, width).map(|p| s(&p)).map_err(fail)
    }

    /// The picture for an asset's tile (None for audio, a look, a piece): the image, a take's first frame, a render's or a
    /// lab's still, a card's middle (runs the pipeline the first time).
    pub fn thumbnail(&self, id: String, width: u32) -> Result<Option<AssetThumb>, FlexError> {
        let a = self.asset(&id)?;
        let t = preview::thumbnail(&self.root(), &a, width).map_err(fail)?;
        Ok(t.map(|p| AssetThumb { blank: a.kind == assets::Kind::Card && preview::is_blank(&p), file: s(&p) }))
    }

    /// A still's element boxes, in its pixels.
    pub fn boxes(&self, id: String) -> Vec<StillBox> {
        let Some(b) = self.asset(&id).ok().and_then(|a| a.facts.boxes) else { return vec![] };
        preview::boxes(&b).into_iter().map(|(name, x, y, w, h)| StillBox { name, x, y, w, h }).collect()
    }
}
