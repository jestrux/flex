//! `flex crop`: a cell-shaped crop of a photo centred on its subject (macOS Vision face / person boxes), never enlarged
//! past a ceiling.
//!
//! How the crop is chosen:
//! - the subject's box (Vision; `server/subject.swift`, compiled once into the support folder) sets the crop's size: a face
//!   fills about a fifth of the cell's height (head and shoulders, some body), a person about 86 %, its centre a little below the middle (the whole figure with a
//!   little room); `centre` takes the largest cell-shaped crop there is;
//! - the ceiling: the crop is never smaller than the cell ÷ `max`, so the photo is never enlarged more than `max`. When the
//!   framing wanted more, the crop grows around the subject's place and a note says so;
//! - the crop never leaves the photo: it is moved inside (the subject then sits off its place) and, when the photo is
//!   smaller than the cell allows, it is the largest crop there is (a note gives the enlargement it still needs);
//! - then it's resized to the cell with Lanczos3.

use crate::project::{login_path, support_dir, ProjectError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

const SOURCE: &str = include_str!("../../../server/subject.swift");

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Subject { Face, Person, Centre }

#[derive(Debug, Clone)]
pub struct Options {
    pub input: PathBuf,
    /// the cell's aspect and output size in px, e.g. (1080, 1350)
    pub cell: (u32, u32),
    pub subject: Subject,
    /// how far the photo may be enlarged (1.3 = 130 %); the crop grows to stay under it
    pub max: f64,
    /// where the subject's centre sits in the cell (fractions; default 0.5, 0.42: a face a little above centre)
    pub place: Option<(f64, f64)>,
    pub out: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub out: PathBuf,
    /// the crop in the source's pixels
    pub x: u32, pub y: u32, pub w: u32, pub h: u32,
    /// the enlargement it needed (output px per source px)
    pub scale: f64,
    /// the subject box found (source px), if any
    pub subject: Option<[f64; 4]>,
    pub notes: Vec<String>,
}

impl Report {
    pub fn summary(&self) -> String { format!("{} · crop {}×{} at {},{} · {:.2}×{}", self.out.display(), self.w, self.h, self.x, self.y, self.scale, self.notes.iter().map(|n| format!(" · {n}")).collect::<String>()) }
}

/// One detected box, as `subject.swift` prints it (source px as shown, origin top left).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Found { pub x: f64, pub y: f64, pub w: f64, pub h: f64, pub confidence: f64 }

/// What Vision found in a photo, largest first.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subjects { pub width: u32, pub height: u32, pub faces: Vec<Found>, pub people: Vec<Found> }

/// The share of the cell's (width, height) a subject's box takes at most, by kind.
const FACE_FILL: (f64, f64) = (0.40, 0.20);
const PERSON_FILL: (f64, f64) = (0.90, 0.86);

/// The default place of the subject's centre in the cell.
pub fn default_place(s: Subject) -> (f64, f64) { match s { Subject::Face => (0.5, 0.42), Subject::Person => (0.5, 0.57), Subject::Centre => (0.5, 0.5) } }

/// The crop (x, y, w, h in source px, fractional), the enlargement and the notes, for a photo `size` with the subject's
/// box `subject` ([x, y, w, h], None: the photo's centre). Pure: no Vision, no files.
pub fn plan(size: (u32, u32), cell: (u32, u32), kind: Subject, subject: Option<[f64; 4]>, max: f64, place: (f64, f64)) -> ([f64; 4], f64, Vec<String>) {
    let (sw, sh) = (size.0 as f64, size.1 as f64);
    let (cw, ch) = (cell.0 as f64, cell.1 as f64);
    let aspect = cw / ch;
    let mut notes = vec![];
    // the largest cell-shaped crop in the photo
    let fit_h = sh.min(sw / aspect);
    // the framing's height
    let want_h = match (kind, subject) {
        (Subject::Centre, _) | (_, None) => fit_h,
        (k, Some([_, _, bw, bh])) => {
            let (fx, fy) = if k == Subject::Face { FACE_FILL } else { PERSON_FILL };
            (bh / fy).max(bw / fx / aspect)
        }
    };
    let mut h = want_h;
    let floor = ch / max; // the smallest crop the ceiling allows
    if h < floor {
        notes.push(format!("the framing wanted {:.2}× (more than --max {max}): the crop grows to {:.0}×{:.0}", ch / h, floor.min(fit_h) * aspect, floor.min(fit_h)));
        h = floor;
    }
    if h > fit_h { h = fit_h; }
    let s = ch / h;
    if s > max + 1e-9 {
        notes.push(format!("the photo is small for this cell: its largest {}×{} crop is still enlarged {s:.2}× (more than --max {max})", (fit_h * aspect).round(), fit_h.round()));
    }
    if let Some([_, _, bw, bh]) = subject { if bh > h + 0.5 || bw > h * aspect + 0.5 { notes.push("the subject is larger than the photo's largest cell-shaped crop: it's cut".into()); } }
    let w = h * aspect;
    // place the subject's centre, then keep the crop inside the photo
    let (cx, cy) = match subject { Some([x, y, bw, bh]) => (x + bw / 2., y + bh / 2.), None => (sw / 2., sh / 2.) };
    let (px, py) = if kind == Subject::Centre || subject.is_none() { (0.5, 0.5) } else { place };
    let x = (cx - px * w).clamp(0., (sw - w).max(0.));
    let y = (cy - py * h).clamp(0., (sh - h).max(0.));
    ([x, y, w, h], ch / h, notes)
}

/// The compiled subject finder (built on first use: swiftc, from the Xcode command-line tools).
fn binary() -> Result<PathBuf, ProjectError> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    SOURCE.hash(&mut h);
    let dir = support_dir().join("bin");
    let bin = dir.join(format!("subject-{:012x}", h.finish() & 0xffff_ffff_ffff));
    if bin.exists() { return Ok(bin); }
    std::fs::create_dir_all(&dir)?;
    let src = dir.join("subject.swift");
    std::fs::write(&src, SOURCE)?;
    let o = Command::new("xcrun").args(["swiftc", "-O", "-o"]).arg(&bin).arg(&src).env("PATH", login_path()).output()?;
    if !o.status.success() {
        return Err(ProjectError::Invalid(format!("couldn't build the subject finder (swiftc; install the Xcode command-line tools): {}",
            String::from_utf8_lossy(&o.stderr).lines().find(|l| l.contains("error")).unwrap_or("swiftc failed"))));
    }
    Ok(bin)
}

/// Faces and people in `file`, by Vision (EXIF orientation applied).
pub fn subjects(file: &Path) -> Result<Subjects, ProjectError> {
    let o = Command::new(binary()?).arg(file).output()?;
    if !o.status.success() { return Err(ProjectError::Invalid(format!("{}: {}", file.display(), String::from_utf8_lossy(&o.stderr).trim()))); }
    serde_json::from_slice(&o.stdout).map_err(|e| ProjectError::Invalid(e.to_string()))
}

/// The photo as shown: decoded with its EXIF orientation applied.
pub fn load(file: &Path) -> Result<image::DynamicImage, ProjectError> {
    use image::ImageDecoder;
    let bad = |e: String| ProjectError::Invalid(format!("couldn't read {}: {e} (PNG or JPEG)", file.display()));
    let mut d = image::ImageReader::open(file)?.with_guessed_format()?.into_decoder().map_err(|e| bad(e.to_string()))?;
    let orient = d.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = image::DynamicImage::from_decoder(d).map_err(|e| bad(e.to_string()))?;
    img.apply_orientation(orient);
    Ok(img)
}

/// `dir/<stem><suffix>.<ext>` beside `input`, or with -2, -3 … when that's taken: a default never overwrites a file.
pub(crate) fn free_name(input: &Path, suffix: &str, ext: &str) -> PathBuf {
    let dir = input.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = input.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "out".into());
    let first = dir.join(format!("{stem}{suffix}.{ext}"));
    if !first.exists() { return first; }
    (2..).map(|i| dir.join(format!("{stem}{suffix}-{i}.{ext}"))).find(|p| !p.exists()).unwrap()
}

pub fn run(o: &Options) -> Result<Report, ProjectError> {
    if !o.input.is_file() { return Err(ProjectError::Invalid(format!("no file at {}", o.input.display()))); }
    let (cw, ch) = o.cell;
    if cw == 0 || ch == 0 || cw > 16384 || ch > 16384 { return Err(ProjectError::Invalid(format!("--cell {cw}:{ch}: a size in px, e.g. 1080:1350"))); }
    if !(o.max.is_finite() && o.max > 0.) { return Err(ProjectError::Invalid(format!("--max {}: an enlargement above 0, e.g. 1.3", o.max))); }
    if let Some((x, y)) = o.place { if !(0. ..=1.).contains(&x) || !(0. ..=1.).contains(&y) { return Err(ProjectError::Invalid(format!("--place {x}:{y}: fractions of the cell, 0–1"))); } }
    let img = load(&o.input)?.to_rgb8();
    let size = img.dimensions();
    let mut notes = vec![];
    // the subject
    let (kind, found) = match o.subject {
        Subject::Centre => (Subject::Centre, None),
        want => {
            let s = subjects(&o.input)?;
            if (s.width, s.height) != size { notes.push(format!("Vision saw the photo as {}×{}, not {}×{}: its boxes are scaled", s.width, s.height, size.0, size.1)); }
            let k = (size.0 as f64 / s.width.max(1) as f64, size.1 as f64 / s.height.max(1) as f64);
            let sc = |f: &Found| { let (x, y) = (f.x.max(0.), f.y.max(0.)); [x * k.0, y * k.1, (f.w - (x - f.x)) * k.0, (f.h - (y - f.y)) * k.1] };
            let (first, second, other) = if want == Subject::Face { (&s.faces, &s.people, Subject::Person) } else { (&s.people, &s.faces, Subject::Face) };
            let name = |k: Subject| if k == Subject::Face { "face" } else { "person" };
            if let Some(f) = first.first() { (want, Some(sc(f))) }
            else if let Some(f) = second.first() { notes.push(format!("no {} found: framed on the {} instead", name(want), name(other))); (other, Some(sc(f))) }
            else { notes.push(format!("no {} or {} found: the centre crop", name(want), name(other))); (Subject::Centre, None) }
        }
    };
    let place = o.place.unwrap_or_else(|| default_place(kind));
    let (b, scale, more) = plan(size, o.cell, kind, found, o.max, place);
    notes.extend(more);
    // whole source pixels, inside the photo
    let x = (b[0].round() as u32).min(size.0 - 1);
    let y = (b[1].round() as u32).min(size.1 - 1);
    let w = (b[2].round() as u32).clamp(1, size.0 - x);
    let h = (b[3].round() as u32).clamp(1, size.1 - y);
    let part = image::imageops::crop_imm(&img, x, y, w, h).to_image();
    let cell = image::imageops::resize(&part, cw, ch, image::imageops::FilterType::Lanczos3);
    let out = match &o.out { Some(p) => p.clone(), None => free_name(&o.input, ".crop", "png") };
    if let Some(p) = out.parent() { if !p.as_os_str().is_empty() { std::fs::create_dir_all(p)?; } }
    cell.save(&out).map_err(|e| ProjectError::Invalid(format!("couldn't write {}: {e}", out.display())))?;
    Ok(Report { out, x, y, w, h, scale: (scale * 1000.).round() / 1000., subject: found.map(|f| f.map(|v| (v * 10.).round() / 10.)), notes })
}
