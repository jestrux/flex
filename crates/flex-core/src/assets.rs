//! The project's assets: everything a film is made from, each previewable on its own (PLAN.md "After the MVP: assets").
//! Nothing is registered by hand: an asset is a file the project already has (audio.json's music, stems and sounds;
//! takes and their versions; freezes and walk stills; the cards and looks the agent wrote; labs; renders).
//!
//! Tools measure; the film decides. The scan reports what is there and what can be measured cheaply (lengths, sizes,
//! the loudness audio.json records, word counts where a transcription exists, which take version is picked). It never
//! ranks or judges a piece.
//!
//! The scan is file-only and fast: take frame folders are never walked (events.json says what is in them), media lengths
//! come from file headers. The one slow fact, the list of cards (it runs the pipeline in node, 2–4 s), is cached by the
//! look's and cards' file stamps; a stale cache is reported (`cards_stale`), and `refresh_cards` fills it.

mod cards;
mod media;
pub mod preview;

pub use cards::{refresh as refresh_cards, CardInfo};

use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};

/// What an asset is. The order is the grid's order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind { Music, Stem, Sound, Take, TakeVersion, Card, Look, Lab, Freeze, Still, Sketch, Image, Render, Other }

impl Kind {
    pub const ALL: [Kind; 14] = [Kind::Music, Kind::Stem, Kind::Sound, Kind::Take, Kind::TakeVersion, Kind::Card, Kind::Look,
        Kind::Lab, Kind::Freeze, Kind::Still, Kind::Sketch, Kind::Image, Kind::Render, Kind::Other];
    pub fn name(self) -> &'static str {
        match self {
            Kind::Music => "music", Kind::Stem => "stem", Kind::Sound => "sound", Kind::Take => "take",
            Kind::TakeVersion => "take-version", Kind::Card => "card", Kind::Look => "look", Kind::Lab => "lab",
            Kind::Freeze => "freeze", Kind::Still => "still", Kind::Sketch => "sketch", Kind::Image => "image", Kind::Render => "render", Kind::Other => "other",
        }
    }
    /// a kind by its name, plural or with the usual alias (`sfx`, `version`)
    pub fn parse(s: &str) -> Option<Kind> {
        let s = s.strip_suffix('s').unwrap_or(s);
        match s { "sfx" => return Some(Kind::Sound), "version" => return Some(Kind::TakeVersion), "storyboard" => return Some(Kind::Sketch), _ => {} }
        Kind::ALL.into_iter().find(|k| k.name() == s)
    }
    /// plays sound
    pub fn is_audio(self) -> bool { matches!(self, Kind::Music | Kind::Stem | Kind::Sound) }
}

/// One take version, as its take lists them.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Version {
    pub n: u32,
    /// the version's asset id (`takes/.versions/<take>/v<n>`)
    pub id: String,
    pub picked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frames: Option<u32>,
    /// when it was recorded (ISO time, from version.json)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
}

/// What can be measured cheaply, per kind. Every field is optional: absent means not measured, never "zero".
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Facts {
    /// seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// integrated loudness, as audio.json records it
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lufs: Option<f64>,
    /// peak dBFS, as audio.json records it
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bpm: Option<f64>,
    /// words in its transcription, when one exists
    #[serde(skip_serializing_if = "Option::is_none")]
    pub words: Option<u32>,
    /// an audio file: is it in audio.json?
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered: Option<bool>,
    /// a take's or version's frames played: events.json's frame list (what the film plays, after retiming), never a
    /// count of the folder
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frames: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dpr: Option<f64>,
    /// a take: its versions, oldest first
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub versions: Vec<Version>,
    /// a take: the picked version's number (`.flex-version`); a version: its own number
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u32>,
    /// a version: is it the pick?
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picked: Option<bool>,
    /// a version's timing (version.json): beats more than 40 ms late, and the worst lateness in ms
    #[serde(skip_serializing_if = "Option::is_none")]
    pub late: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worst_ms: Option<f64>,
    /// a version's timing report (`report.json`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<PathBuf>,
    /// a still's `<still>.boxes.json`, and the names it has a box for
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boxes: Option<PathBuf>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub box_names: Vec<String>,
    /// a card's registered type (what `flex card <dir> <type>` takes); none for a file under cards/ that registers none
    #[serde(skip_serializing_if = "Option::is_none")]
    pub card_type: Option<String>,
    /// a card's: "look" (the project's own look) or "pipeline" (built in)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    /// a card's sample params (its defaults), JSON
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<String>,
    /// where a card's sample params come from: "preview" (its own exported sample) or "defaults"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
    /// a lab's declared target section
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// a look: how many cards it registers
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cards: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Asset {
    /// stable: the project-relative path, or `audio.json#music/<key>` / `audio.json#sfx/<key>` for registered audio,
    /// `cards/<file>.ts#<name>` / `look.ts#<name>` / `card:<type>` for cards, `../<folder>` for labs,
    /// `render:<file>` for renders (they live outside the project)
    pub id: String,
    pub kind: Kind,
    pub title: String,
    /// what the project itself says about it (audio.json's purpose or mood, a version's note), quoted as is
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// the file that plays or shows (absolute); a take's is its first frame, a card's is its source
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<PathBuf>,
    /// every file that makes it (absolute): the track with its .grid/.lyrics/.music.json, a still with its boxes …
    pub files: Vec<PathBuf>,
    /// bytes on disk; for a take, without its frames (they aren't listed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    /// modified, seconds since 1970
    pub modified: f64,
    /// the asset this one belongs to (a version's take)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// the folder it sits in, for kinds that come in numbers (images): the grid groups them by it
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub facts: Facts,
}

impl Asset {
    pub(crate) fn new(id: impl Into<String>, kind: Kind, title: impl Into<String>, file: Option<PathBuf>) -> Asset {
        let mut a = Asset { id: id.into(), kind, title: title.into(), note: None, files: file.iter().cloned().collect(), file,
            bytes: None, modified: 0.0, parent: None, group: None, facts: Facts::default() };
        a.stat();
        a
    }
    /// bytes and modified, from its files
    pub(crate) fn stat(&mut self) {
        let (mut bytes, mut modified, mut any) = (0u64, 0f64, false);
        for f in &self.files {
            if let Ok(m) = std::fs::metadata(f) {
                if m.is_file() { bytes += m.len(); any = true; }
                modified = modified.max(mtime(&m));
            }
        }
        self.bytes = any.then_some(bytes);
        self.modified = modified;
    }
    /// does `path` (an id, a project-relative path or an absolute one) name this asset or one of its files?
    pub fn matches(&self, path: &str, dir: &Path) -> bool {
        let path = path.trim_end_matches('/');
        if self.id == path || self.id.split('#').next() == Some(path) { return true; }
        // an absolute path may come through a symlink (/var → /private/var, a linked sample): compare it canonical
        let abs = if Path::new(path).is_absolute() { std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path)) } else { dir.join(path) };
        self.files.iter().chain(self.file.iter()).any(|f| *f == abs)
    }
}

/// The scan's options: what the caller already knows.
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// the film's track when it isn't in the project's audio.json (a pipeline library song), from an opened project
    pub track: Option<PathBuf>,
    /// where the renders are (default: Flex's `~/Downloads/flex-videos/<name>/`)
    pub renders: Option<PathBuf>,
    /// run the pipeline to list the cards when the cache is stale (2–4 s); otherwise a stale list is used and reported
    pub refresh_cards: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Scan {
    pub dir: PathBuf,
    pub assets: Vec<Asset>,
    /// the card list is older than the look or the cards, or was never made: `refresh_cards` brings it up to date
    pub cards_stale: bool,
    /// why listing the cards failed, when it was tried
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cards_error: Option<String>,
    /// how long the scan took
    pub ms: f64,
}

impl Scan {
    pub fn get(&self, id: &str) -> Option<&Asset> { self.assets.iter().find(|a| a.id == id) }
    /// the asset a path names: its id, the file part of an id, or one of its files
    pub fn find(&self, path: &str) -> Option<&Asset> {
        self.get(path).or_else(|| self.assets.iter().find(|a| a.matches(path, &self.dir)))
    }
}

pub(crate) fn mtime(m: &std::fs::Metadata) -> f64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

pub(crate) fn read_json(p: &Path) -> Option<Value> { serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok() }

fn rel(dir: &Path, p: &Path) -> String { p.strip_prefix(dir).unwrap_or(p).to_string_lossy().into_owned() }

const AUDIO: [&str; 7] = ["wav", "mp3", "m4a", "aiff", "aif", "flac", "ogg"];
const IMAGES: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
fn ext(p: &Path) -> String { p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase() }

/// Scan a project folder.
pub fn scan(dir: &Path, opt: &Options) -> Result<Scan, crate::ProjectError> {
    let t0 = Instant::now();
    let dir = std::fs::canonicalize(dir).map_err(|_| crate::ProjectError::NotAProject(dir.to_path_buf()))?;
    if !dir.join("project.ts").is_file() { return Err(crate::ProjectError::NotAProject(dir)); }
    let mut out = vec![];
    audio(&dir, opt, &mut out);
    takes(&dir, &mut out);
    let (cards_stale, cards_error) = cards::assets(&dir, opt.refresh_cards, &mut out);
    labs(&dir, &mut out);
    images(&dir, &mut out);
    renders(&dir, opt, &mut out);
    // the grid's order: by kind (a version right after its take), then by title; renders newest first
    let group = |a: &Asset| (match a.kind { Kind::TakeVersion => Kind::Take, k => k }, a.parent.clone().unwrap_or_else(|| a.id.clone()));
    out.sort_by(|a, b| group(a).0.cmp(&group(b).0)
        .then_with(|| if a.kind == Kind::Render { b.modified.total_cmp(&a.modified) } else { std::cmp::Ordering::Equal })
        .then_with(|| a.group.cmp(&b.group))
        .then_with(|| group(a).1.to_lowercase().cmp(&group(b).1.to_lowercase()))
        .then_with(|| (a.kind == Kind::TakeVersion).cmp(&(b.kind == Kind::TakeVersion)))
        .then_with(|| a.facts.version.cmp(&b.facts.version))
        .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(Scan { dir, assets: out, cards_stale, cards_error, ms: t0.elapsed().as_secs_f64() * 1000.0 })
}

// ---- audio: audio.json's music (+ its .grid/.lyrics/.music.json), the stems folder, the sounds; any other audio file

/// A track's words: `flex music`'s `<track>.music.json` (with bar.beat), else `<track>.lyrics.json`.
pub(crate) fn track_words(track: &Path) -> Option<Vec<Value>> {
    ["music.json", "lyrics.json"].iter()
        .find_map(|side| read_json(&track.with_extension(side))?["words"].as_array().filter(|w| !w.is_empty()).cloned())
}

/// The stem the track's words were heard in (`.lyrics.json`'s `stem`).
pub(crate) fn words_stem(track: &Path) -> Option<String> {
    read_json(&track.with_extension("lyrics.json"))?["stem"].as_str().map(String::from)
}

fn audio(dir: &Path, opt: &Options, out: &mut Vec<Asset>) {
    let manifest = read_json(&dir.join("audio.json")).unwrap_or(Value::Null);
    let mut seen: Vec<PathBuf> = vec![];
    let mut tracks: Vec<PathBuf> = vec![];
    let mut own_stems: Vec<(PathBuf, PathBuf)> = vec![];
    if let Some(music) = manifest["music"].as_object() {
        for (key, m) in music {
            let Some(f) = m["file"].as_str() else { continue };
            let file = dir.join(f);
            let mut a = Asset::new(format!("audio.json#music/{key}"), Kind::Music, key.clone(), Some(file.clone()));
            for side in ["grid.json", "lyrics.json", "music.json"] {
                let p = file.with_extension(side);
                if p.is_file() { a.files.push(p); }
            }
            a.stat();
            let grid = read_json(&file.with_extension("grid.json"));
            a.note = m["mood"].as_str().map(String::from);
            a.facts.lufs = m["lufs"].as_f64();
            a.facts.peak = m["peak"].as_f64();
            a.facts.bpm = grid.as_ref().and_then(|g| g["bpm"].as_f64()).or_else(|| m["bpm"].as_f64());
            a.facts.duration = grid.as_ref().and_then(|g| g["duration"].as_f64()).or_else(|| media::audio_duration(&file));
            a.facts.words = track_words(&file).map(|w| w.len() as u32);
            a.facts.registered = Some(true);
            seen.push(file.clone());
            // a track's own stems (`stems` on its entry, when the project has more than one song)
            if let Some(d) = m["stems"].as_str() { own_stems.push((dir.join(d), file.clone())); }
            tracks.push(file);
            out.push(a);
        }
    }
    // the film's track from the pipeline's library (hello-flex), when the caller knows it
    if let Some(t) = opt.track.as_ref().filter(|t| t.is_file() && !seen.contains(t)) {
        let mut a = Asset::new(format!("track:{}", t.file_name().unwrap_or_default().to_string_lossy()), Kind::Music,
            t.file_stem().unwrap_or_default().to_string_lossy(), Some(t.clone()));
        a.note = Some("the film's track, from the pipeline's library".into());
        a.facts.duration = media::audio_duration(t);
        a.facts.bpm = read_json(&t.with_extension("grid.json")).and_then(|g| g["bpm"].as_f64());
        seen.push(t.clone());
        out.push(a);
    }
    // the stems; the lead vocal's carries the track's words (they were heard in it)
    let stems = dir.join(manifest["stems"].as_str().unwrap_or("audio/stems/"));
    let mut stem_dirs: Vec<(PathBuf, Option<PathBuf>)> = own_stems.iter().map(|(d, t)| (d.clone(), Some(t.clone()))).collect();
    if !stem_dirs.iter().any(|(d, _)| *d == stems) { stem_dirs.push((stems.clone(), tracks.first().cloned())); }
    for (stems, track) in &stem_dirs {
        let lead = track.as_ref().and_then(|t| words_stem(t));
        let lead_words = track.as_ref().and_then(|t| read_json(&t.with_extension("lyrics.json")))
            .and_then(|v| v["words"].as_array().map(|w| w.len() as u32));
        for f in files_in(stems, &AUDIO) {
            if seen.contains(&f) { continue; }
            let name = f.file_name().unwrap_or_default().to_string_lossy().into_owned();
            let mut a = Asset::new(rel(dir, &f), Kind::Stem, f.file_stem().unwrap_or_default().to_string_lossy(), Some(f.clone()));
            a.facts.duration = media::audio_duration(&f);
            // the stems of a track of their own carry its name, so two songs' "2 Drums" can be told apart
            if stem_dirs.len() > 1 { a.group = track.as_ref().and_then(|t| t.file_stem()).map(|s| s.to_string_lossy().into_owned()); }
            if lead.as_deref() == Some(name.as_str()) { a.facts.words = lead_words; }
            seen.push(f);
            out.push(a);
        }
    }
    // the registered sounds
    if let Some(sfx) = manifest["sfx"].as_object() {
        for (key, s) in sfx {
            let Some(f) = s["file"].as_str() else { continue };
            let file = dir.join(f);
            let mut a = Asset::new(format!("audio.json#sfx/{key}"), Kind::Sound, key.clone(), Some(file.clone()));
            a.note = s["purpose"].as_str().map(String::from);
            a.facts.lufs = s["lufs"].as_f64();
            a.facts.peak = s["peak"].as_f64();
            a.facts.duration = media::audio_duration(&file);
            a.facts.registered = Some(true);
            a.facts.words = preview::cached_words(&file).map(|w| w.len() as u32);
            seen.push(file);
            out.push(a);
        }
    }
    // any other audio file under audio/: not in audio.json, but a file the project has
    for f in walk(&dir.join("audio"), 3, &AUDIO) {
        if seen.contains(&f) || stem_dirs.iter().any(|(d, _)| f.starts_with(d)) { continue; }
        let mut a = Asset::new(rel(dir, &f), Kind::Sound, f.file_stem().unwrap_or_default().to_string_lossy(), Some(f.clone()));
        a.facts.duration = media::audio_duration(&f);
        a.facts.registered = Some(false);
        a.facts.words = preview::cached_words(&f).map(|w| w.len() as u32);
        out.push(a);
    }
}

/// The files directly in `d` with one of these extensions, sorted.
fn files_in(d: &Path, exts: &[&str]) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(d) else { return vec![] };
    let mut v: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| !hidden(p) && exts.contains(&ext(p).as_str()) && p.is_file()).collect();
    v.sort();
    v
}

fn hidden(p: &Path) -> bool { p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) }

/// Files with these extensions under `d`, at most `depth` folders down; hidden folders and frame folders are skipped.
fn walk(d: &Path, depth: u32, exts: &[&str]) -> Vec<PathBuf> {
    let mut out = files_in(d, exts);
    if depth == 0 { return out; }
    let Ok(rd) = std::fs::read_dir(d) else { return out };
    let mut subs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path())
        .filter(|p| !hidden(p) && !matches!(p.file_name().and_then(|n| n.to_str()), Some("frames" | "node_modules")) && p.is_dir()).collect();
    subs.sort();
    for s in subs { out.extend(walk(&s, depth - 1, exts)); }
    out
}

// ---- takes: takes/<take> (the pick) and takes/.versions/<take>/v<n>

/// A take folder's facts from its events.json (never by listing frames/), and its first frame.
fn take_facts(folder: &Path) -> (Facts, Option<PathBuf>) {
    let mut f = Facts::default();
    let Some(ev) = read_json(&folder.join("events.json")) else { return (f, None) };
    f.duration = ev["duration"].as_f64().map(|ms| ms / 1000.0);
    let frames = ev["frames"].as_array();
    f.frames = frames.map(|a| a.len() as u32);
    f.width = ev["viewport"]["w"].as_f64().map(|w| w as u32);
    f.height = ev["viewport"]["h"].as_f64().map(|h| h as u32);
    f.dpr = ev["dpr"].as_f64();
    let first = frames.and_then(|a| a.first()).and_then(|x| x["file"].as_str()).map(|n| folder.join("frames").join(n));
    (f, first)
}

fn takes(dir: &Path, out: &mut Vec<Asset>) {
    let root = dir.join("takes");
    let Ok(rd) = std::fs::read_dir(&root) else { return };
    let mut names: Vec<String> = rd.filter_map(|e| e.ok()).filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.starts_with('.')).collect();
    names.sort();
    for take in names {
        let folder = root.join(&take);
        let id = format!("takes/{take}");
        let (facts, first) = take_facts(&folder);
        let mut a = Asset::new(id.clone(), Kind::Take, take.clone(), first);
        a.files = ["events.json", "edl.json"].iter().map(|f| folder.join(f)).filter(|p| p.is_file()).collect();
        a.stat();
        a.files.push(folder.clone());
        a.facts = facts;
        let picked: Option<u32> = std::fs::read_to_string(folder.join(".flex-version")).ok().and_then(|s| s.trim().parse().ok());
        a.facts.version = picked;
        let vroot = root.join(".versions").join(&take);
        let mut ns: Vec<u32> = std::fs::read_dir(&vroot).map(|rd| rd.filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().to_str()?.strip_prefix('v')?.parse().ok()).collect()).unwrap_or_default();
        ns.sort();
        for n in ns {
            let vf = vroot.join(format!("v{n}"));
            let vid = format!("takes/.versions/{take}/v{n}");
            let (mut vfacts, vfirst) = take_facts(&vf);
            let meta = read_json(&vf.join("version.json")).unwrap_or(Value::Null);
            let mut v = Asset::new(vid.clone(), Kind::TakeVersion, format!("{take} v{n}"), vfirst);
            v.files = ["events.json", "edl.json", "version.json", "report.json"].iter().map(|f| vf.join(f)).filter(|p| p.is_file()).collect();
            v.stat();
            v.files.push(vf.clone());
            v.parent = Some(id.clone());
            v.note = meta["note"].as_str().map(String::from);
            vfacts.version = Some(n);
            vfacts.picked = Some(picked == Some(n));
            vfacts.late = meta["late"].as_u64().map(|x| x as u32);
            vfacts.worst_ms = meta["worst"].as_f64();
            vfacts.report = Some(vf.join("report.json")).filter(|p| p.is_file());
            if vfacts.duration.is_none() { vfacts.duration = meta["duration"].as_f64().map(|ms| ms / 1000.0); }
            if vfacts.frames.is_none() { vfacts.frames = meta["frames"].as_u64().map(|x| x as u32); }
            a.facts.versions.push(Version { n, id: vid, picked: picked == Some(n), duration: vfacts.duration, frames: vfacts.frames,
                at: meta["at"].as_str().map(String::from) });
            v.facts = vfacts;
            out.push(v);
        }
        out.push(a);
    }
}

// ---- images: freezes, walk stills (+ boxes), anything else under assets/

fn images(dir: &Path, out: &mut Vec<Asset>) {
    let freezes = dir.join("assets").join("freezes");
    let image = |f: &Path, kind: Kind| -> Asset {
        let mut a = Asset::new(rel(dir, f), kind, f.file_stem().unwrap_or_default().to_string_lossy(), Some(f.to_path_buf()));
        if let Some((w, h)) = media::image_size(f) { a.facts.width = Some(w); a.facts.height = Some(h); }
        a
    };
    for f in files_in(&freezes, &IMAGES) { out.push(image(&f, Kind::Freeze)); }
    // the storyboard's sketches: under storyboard/sketches/, or named by a panel in script.json (crate::script), with the
    // beats that use them
    let script: serde_json::Value = read_json(&dir.join("script.json")).unwrap_or_default();
    let mut used: Vec<(PathBuf, String)> = vec![];
    for b in script["beats"].as_array().into_iter().flatten() {
        let title = b["title"].as_str().or(b["id"].as_str()).unwrap_or("?").to_string();
        for p in b["panels"].as_array().into_iter().flatten() {
            if let Some(sk) = p["sketch"].as_str() { used.push((dir.join(sk), title.clone())); }
        }
    }
    let sketches = dir.join("storyboard").join("sketches");
    let mut seen = vec![];
    for f in walk(&sketches, 3, &IMAGES).into_iter().chain(used.iter().map(|(f, _)| f.clone()).filter(|f| f.is_file())) {
        if seen.contains(&f) { continue; }
        seen.push(f.clone());
        let mut a = image(&f, Kind::Sketch);
        let mut beats: Vec<&str> = used.iter().filter(|(u, _)| *u == f).map(|(_, t)| t.as_str()).collect();
        beats.dedup();
        a.note = Some(if beats.is_empty() { "in no beat".to_string() } else { format!("in {}", beats.join(", ")) });
        out.push(a);
    }
    for f in walk(&dir.join("storyboard"), 3, &IMAGES) {
        if seen.contains(&f) { continue; }
        let mut a = image(&f, Kind::Still);
        a.group = f.parent().map(|p| rel(dir, p));
        let boxes = f.with_extension("boxes.json");
        if let Some(v) = read_json(&boxes) {
            a.facts.box_names = v["boxes"].as_object().map(|o| o.iter().filter(|(_, b)| !b.is_null()).map(|(k, _)| k.clone()).collect()).unwrap_or_default();
            a.facts.dpr = v["dpr"].as_f64();
            a.files.push(boxes.clone());
            a.facts.boxes = Some(boxes);
            a.stat();
        }
        out.push(a);
    }
    for f in walk(&dir.join("assets"), 4, &IMAGES) {
        if f.starts_with(&freezes) { continue; }
        let mut a = image(&f, Kind::Image);
        a.group = f.parent().map(|p| rel(dir, p));
        out.push(a);
    }
}

// ---- labs: sibling folders whose project.ts imports this project or targets it

fn labs(dir: &Path, out: &mut Vec<Asset>) {
    let (Some(parent), Some(me)) = (dir.parent(), dir.file_name().map(|n| n.to_string_lossy().into_owned())) else { return };
    let Ok(rd) = std::fs::read_dir(parent) else { return };
    let mut sibs: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir() && p.as_path() != dir).collect();
    sibs.sort();
    for s in sibs {
        let pt = s.join("project.ts");
        let Ok(text) = std::fs::read_to_string(&pt) else { continue };
        let Some(target) = lab_of(&text, &me) else { continue };
        let name = crate::tools::project_name(&s);
        let mut a = Asset::new(format!("../{}", s.file_name().unwrap_or_default().to_string_lossy()), Kind::Lab, name.clone(), Some(pt));
        a.facts.target = target;
        // its newest render, when it has one: what the source viewer plays
        if let Some(r) = crate::renders::list(&crate::tools::out_dir(&s), &name).into_iter().next() {
            a.facts.duration = media::mp4_info(&r.path).and_then(|i| i.duration);
            a.files.push(r.path);
        }
        out.push(a);
    }
}

/// Is this project.ts a lab of `me`? `Some(section)` when it imports `../<me>/…` or names `"../<me>"` (a `target`).
/// A string search for the path, not a reading of the TypeScript.
pub(crate) fn lab_of(text: &str, me: &str) -> Option<Option<String>> {
    let needles = [format!("\"../{me}/"), format!("'../{me}/"), format!("\"../{me}\""), format!("'../{me}'")];
    if !needles.iter().any(|n| text.contains(n.as_str())) { return None; }
    let section = text.find("target").and_then(|i| {
        let rest = &text[i..];
        let rest = &rest[..rest.char_indices().nth(200).map(|(j, _)| j).unwrap_or(rest.len())];
        let r = &rest[rest.find("section")? + 7..];
        let r = &r[r.find(['"', '\''])? + 1..];
        Some(r[..r.find(['"', '\''])?].to_string())
    });
    Some(section)
}

// ---- renders: the project's finished mp4s

fn renders(dir: &Path, opt: &Options, out: &mut Vec<Asset>) {
    let name = crate::tools::project_name(dir);
    let folder = opt.renders.clone().unwrap_or_else(|| crate::tools::out_dir(dir));
    for r in crate::renders::list(&folder, &name) {
        let title = match &r.part { Some(p) => format!("{p}{}", r.size), None => format!("{name}{}", r.size) };
        let mut a = Asset::new(format!("render:{}", r.file), Kind::Render, title, Some(r.path.clone()));
        if let Some(i) = media::mp4_info(&r.path) {
            a.facts.duration = i.duration;
            a.facts.width = i.width;
            a.facts.height = i.height;
        }
        out.push(a);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_parse() {
        assert_eq!(Kind::parse("takes"), Some(Kind::Take));
        assert_eq!(Kind::parse("take-version"), Some(Kind::TakeVersion));
        assert_eq!(Kind::parse("versions"), Some(Kind::TakeVersion));
        assert_eq!(Kind::parse("sfx"), Some(Kind::Sound));
        assert_eq!(Kind::parse("cards"), Some(Kind::Card));
        assert_eq!(Kind::parse("nope"), None);
    }

    #[test]
    fn labs_by_import_or_target() {
        assert_eq!(lab_of(r#"import x from "../overview/cards/lift.ts";"#, "overview"), Some(None));
        assert_eq!(lab_of("target: { project: \"../overview\", section: \"book\" },", "overview"), Some(Some("book".into())));
        assert_eq!(lab_of(r#"import x from "../overview-lab-1/x.ts";"#, "overview"), None);
    }
}
