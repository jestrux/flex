//! The painter: a frame's layers (the pipeline's `Layer[]`, see docs/server.md) to pixels.
//! SVG layers go through resvg, image layers through tiny-skia. Layers are laid out for a
//! 1920 × 1080 frame; painting at another width scales everything at once.
//!
//! Large downscales (3× screenshots shrunk into a slide) use a Lanczos-filtered copy of the
//! image at the nearest power-of-two size, then bicubic for the rest, so fine text stays as
//! sharp as the pipeline's sharp/Lanczos resize.

use resvg::{tiny_skia as sk, usvg};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

pub const FRAME_W: f32 = 1920.0;
pub const FRAME_H: f32 = 1080.0;

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Rect { pub x: f32, pub y: f32, pub w: f32, pub h: f32 }

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum Layer {
    Svg { svg: String },
    /// `rotate`: degrees clockwise about the rect's centre (pipeline patch 13)
    Image { image: String, rect: Rect, crop: Option<Rect>, radius: Option<f32>, opacity: Option<f32>, alpha: Option<bool>, rotate: Option<f32> },
    /// a frame of a video file at `at` s; `alpha` keeps its transparency (ProRes 4444, PNG-in-MOV cut-outs)
    Video { video: String, at: f64, rect: Rect, crop: Option<Rect>, radius: Option<f32>, opacity: Option<f32>, alpha: Option<bool>, rotate: Option<f32> },
}

#[derive(Debug, thiserror::Error)]
pub enum PaintError {
    #[error("an SVG layer didn't parse: {0}")]
    Svg(String),
    #[error("couldn't read {0}: {1}")]
    Image(String, String),
    #[error("bad frame size {0}×{1}")]
    Size(u32, u32),
}

pub(crate) fn fontdb() -> Arc<usvg::fontdb::Database> {
    static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        db.load_system_fonts();
        Arc::new(db)
    }).clone()
}

/// Decoded images (premultiplied), by file, alpha handling and downscale level. Shared by every
/// painter in the process.
type ImageKey = (String, bool, u32);
fn images() -> &'static Mutex<HashMap<ImageKey, Arc<sk::Pixmap>>> {
    static C: OnceLock<Mutex<HashMap<ImageKey, Arc<sk::Pixmap>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// `level` k = the image shrunk by 2^k with Lanczos (0 = as is). `alpha: false` drops the
/// alpha channel the way the pipeline does (sharp's removeAlpha: the colour stays, opaque).
fn image(file: &str, alpha: bool, level: u32) -> Result<Arc<sk::Pixmap>, PaintError> {
    let key = (file.to_string(), alpha, level);
    if let Some(p) = images().lock().unwrap().get(&key) { return Ok(p.clone()); }
    let err = |e: String| PaintError::Image(file.to_string(), e);
    let mut im = decode_srgb(file)?;
    // premultiply first, so filtering doesn't bleed colour out of transparent pixels
    for p in im.pixels_mut() {
        if !alpha { p[3] = 255; continue; }
        let a = p[3] as u16;
        for c in 0..3 { p[c] = ((p[c] as u16 * a + 127) / 255) as u8; }
    }
    if level > 0 {
        let (w, h) = im.dimensions();
        let (nw, nh) = ((w >> level).max(1), (h >> level).max(1));
        im = image::imageops::resize(&im, nw, nh, image::imageops::FilterType::Lanczos3);
    }
    let (w, h) = im.dimensions();
    let size = sk::IntSize::from_wh(w, h).ok_or_else(|| err("empty image".into()))?;
    let px = Arc::new(sk::Pixmap::from_vec(im.into_raw(), size).ok_or_else(|| err("bad pixels".into()))?);
    let mut c = images().lock().unwrap();
    if c.len() > 160 { c.clear(); } // a crude bound; a frame rarely uses more than a few dozen
    c.insert(key, px.clone());
    Ok(px)
}

/// The pipeline's video frames (`videoFrame` in lib/presets/layers.ts, patch 11): a file's frames at 30 fps, extracted once
/// into `<work>/.cache/frames/<sha1("file|30")[..12]>/f000001.jpg` (PNG with alpha under `"file|30|alpha"`); the frame
/// for `at` is number floor(at × 30) + 1, held on the last past the end. Shared with the pipeline, so a clip is extracted
/// once and both painters show the same frame.
pub fn video_frame(file: &str, at: f64, alpha: bool) -> Result<std::path::PathBuf, PaintError> {
    const FPS: f64 = 30.;
    static COUNTS: OnceLock<Mutex<HashMap<std::path::PathBuf, usize>>> = OnceLock::new();
    let work = std::env::var_os("FLEX_WORK").map(std::path::PathBuf::from).unwrap_or_else(|| crate::project::support_dir().join("work"));
    let tag = if alpha { format!("{file}|30|alpha") } else { format!("{file}|30") };
    let dir = work.join(".cache").join("frames").join(&sha1_hex(tag.as_bytes())[..12]);
    let ext = if alpha { "png" } else { "jpg" };
    let err = |e: String| PaintError::Image(file.to_string(), e);
    // one extraction at a time (frames are painted in parallel; a clip's first frame starts it)
    let mut counts = COUNTS.get_or_init(Default::default).lock().unwrap();
    let n = match counts.get(&dir) {
        Some(&n) => n,
        None => {
            let count = |d: &std::path::Path| std::fs::read_dir(d).map(|r| r.filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(ext)).count()).unwrap_or(0);
            if count(&dir) == 0 {
                if !std::path::Path::new(file).exists() { return Err(err("no such file".into())); }
                // into a temp folder, renamed when complete: a stopped extraction never looks finished
                let tmp = dir.with_extension("partial");
                let _ = std::fs::remove_dir_all(&tmp);
                std::fs::create_dir_all(&tmp).map_err(|e| err(e.to_string()))?;
                let mut c = std::process::Command::new("ffmpeg");
                c.args(["-v", "error", "-y", "-i", file, "-vf", "fps=30"]);
                if alpha { c.args(["-pix_fmt", "rgba"]); } else { c.args(["-q:v", "2"]); }
                c.arg(tmp.join(format!("f%06d.{ext}"))).env("PATH", crate::project::login_path());
                let st = c.status().map_err(|e| err(e.to_string()))?;
                if !st.success() { let _ = std::fs::remove_dir_all(&tmp); return Err(err("ffmpeg couldn't extract its frames".into())); }
                let _ = std::fs::remove_dir_all(&dir);
                std::fs::rename(&tmp, &dir).map_err(|e| err(e.to_string()))?;
            }
            let n = count(&dir);
            if n == 0 { return Err(err("the video has no frames".into())); }
            counts.insert(dir.clone(), n);
            n
        }
    };
    drop(counts);
    let i = ((at * FPS).floor() as i64 + 1).clamp(1, n as i64);
    Ok(dir.join(format!("f{i:06}.{ext}")))
}

/// SHA-1 as hex (the pipeline names its frame caches by it)
fn sha1_hex(data: &[u8]) -> String {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut m = data.to_vec();
    let bits = (data.len() as u64).wrapping_mul(8);
    m.push(0x80);
    while m.len() % 64 != 56 { m.push(0); }
    m.extend_from_slice(&bits.to_be_bytes());
    for chunk in m.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 { w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]); }
        for i in 16..80 { w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1); }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i { 0..=19 => ((b & c) | (!b & d), 0x5A827999), 20..=39 => (b ^ c ^ d, 0x6ED9EBA1), 40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC), _ => (b ^ c ^ d, 0xCA62C1D6) };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d; d = c; c = b.rotate_left(30); b = a; a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) { *x = x.wrapping_add(y); }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

/// libvips's built-in sRGB profile (as sharp converts to), taken from sharp's own output
const VIPS_SRGB: &[u8] = include_bytes!("../icc/vips-srgb.icc");

/// Decode an image as sharp does: RGBA, with an embedded colour profile (e.g. an iPhone photo's Display P3) converted
/// to sRGB with perceptual intent through lcms2, libvips's colour engine. Without it a P3 photo drew up to ~8/255 off.
fn decode_srgb(file: &str) -> Result<image::RgbaImage, PaintError> {
    use image::ImageDecoder;
    let err = |e: String| PaintError::Image(file.to_string(), e);
    let reader = image::ImageReader::open(file).map_err(|e| err(e.to_string()))?.with_guessed_format().map_err(|e| err(e.to_string()))?;
    let mut dec = reader.into_decoder().map_err(|e| err(e.to_string()))?;
    let icc = dec.icc_profile().ok().flatten();
    let is_jpeg = matches!(std::path::Path::new(file).extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("jpg" | "jpeg"));
    let mut im = if is_jpeg {
        // JPEGs through libjpeg (mozjpeg, the library sharp bundles): the image crate's own decoder upsamples a 4:2:0
        // photo's colour a little differently (~0.26/255)
        drop(dec);
        let decoded = std::panic::catch_unwind(|| -> std::io::Result<(usize, usize, Vec<u8>)> {
            let d = mozjpeg::Decompress::new_path(file)?;
            let mut started = d.rgba()?;
            let (w, h) = (started.width(), started.height());
            let px = started.read_scanlines::<[u8; 4]>()?;
            started.finish()?;
            Ok((w, h, px.into_iter().flatten().collect()))
        });
        match decoded {
            Ok(Ok((w, h, px))) => image::RgbaImage::from_raw(w as u32, h as u32, px).ok_or_else(|| err("bad size".into()))?,
            _ => image::open(file).map_err(|e| err(e.to_string()))?.to_rgba8(),
        }
    } else {
        image::DynamicImage::from_decoder(dec).map_err(|e| err(e.to_string()))?.to_rgba8()
    };
    if let Some(icc) = icc.filter(|p| p.as_slice() != VIPS_SRGB) {
        // as libvips's icc_transform: one lcms transform, the embedded profile to its sRGB, 8 bits in and out, perceptual
        if let (Ok(inp), Ok(out)) = (lcms2::Profile::new_icc(&icc), lcms2::Profile::new_icc(VIPS_SRGB)) {
            if inp.color_space() == lcms2::ColorSpaceSignature::RgbData {
                if let Ok(t) = lcms2::Transform::<[u8; 3], [u8; 3]>::new_flags(&inp, lcms2::PixelFormat::RGB_8, &out, lcms2::PixelFormat::RGB_8, lcms2::Intent::Perceptual, lcms2::Flags::NO_CACHE) {
                    let px: &mut [[u8; 4]] = bytemuck_rgba(im.as_mut());
                    let rgb: Vec<[u8; 3]> = px.iter().map(|p| [p[0], p[1], p[2]]).collect();
                    let mut back = vec![[0u8; 3]; rgb.len()];
                    t.transform_pixels(&rgb, &mut back);
                    for (p, b) in px.iter_mut().zip(back) { p[0] = b[0]; p[1] = b[1]; p[2] = b[2]; }
                }
            }
        }
    }
    Ok(im)
}
fn bytemuck_rgba(b: &mut [u8]) -> &mut [[u8; 4]] {
    // SAFETY: [u8; 4] has the alignment of u8; the length is a multiple of 4 (RGBA)
    unsafe { std::slice::from_raw_parts_mut(b.as_mut_ptr() as *mut [u8; 4], b.len() / 4) }
}

/// Drop decoded images (after a project's files change).
pub fn forget_images() { images().lock().unwrap().clear(); placed().lock().unwrap().clear(); straight().lock().unwrap().clear(); turned().lock().unwrap().clear(); }

fn rounded(r: sk::Rect, rad: f32) -> sk::Path {
    let (x, y, w, h) = (r.x(), r.y(), r.width(), r.height());
    let q = rad.min(w / 2.).min(h / 2.);
    let k = 0.5523 * q;
    let mut b = sk::PathBuilder::new();
    b.move_to(x + q, y);
    b.line_to(x + w - q, y); b.cubic_to(x + w - q + k, y, x + w, y + q - k, x + w, y + q);
    b.line_to(x + w, y + h - q); b.cubic_to(x + w, y + h - q + k, x + w - q + k, y + h, x + w - q, y + h);
    b.line_to(x + q, y + h); b.cubic_to(x + q - k, y + h, x, y + h - q + k, x, y + h - q);
    b.line_to(x, y + q); b.cubic_to(x, y + q - k, x + q - k, y, x + q, y);
    b.close();
    b.finish().unwrap()
}

/// What a frame painted: the pixels, and any layer that couldn't be drawn (left out, said here).
pub struct Painted { pub pixmap: sk::Pixmap, pub skipped: Vec<String> }

/// Paint `layers` onto a black 1920 × 1080 frame scaled to `width` pixels wide.
pub fn paint(layers: &[Layer], width: u32) -> Result<Painted, PaintError> { paint_in(layers, [FRAME_W as u32, FRAME_H as u32], width) }

/// Paint `layers` (laid out in a `frame`-sized frame, e.g. [1080, 1920] for a vertical film) scaled to `width` pixels wide.
pub fn paint_in(layers: &[Layer], frame_size: [u32; 2], width: u32) -> Result<Painted, PaintError> {
    let (fw, fh) = (frame_size[0] as f32, frame_size[1] as f32);
    let height = (width as f32 * fh / fw).round() as u32;
    let mut frame = sk::Pixmap::new(width, height).ok_or(PaintError::Size(width, height))?;
    frame.fill(sk::Color::BLACK);
    let s = width as f32 / fw;
    // at the film's own size: exactly as the pipeline paints (the preview at other sizes takes the faster path below)
    if (s - 1.).abs() < 1e-6 { return paint_exact(layers, width, height); }
    let root = sk::Transform::from_scale(s, s);
    let skipped: Vec<String> = vec![];
    let mut opt = usvg::Options::default();
    opt.fontdb = fontdb();
    for l in layers {
        match l {
            Layer::Svg { svg } => {
                // the SVG is sized in the frame's px (1920 wide unless the film is vertical); scaling the tree keeps it vector-sharp
                let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| PaintError::Svg(e.to_string()))?;
                let ts = sk::Transform::from_scale(width as f32 / tree.size().width(), height as f32 / tree.size().height());
                // drawn on its own and laid over the frame in floating point, as the pipeline's sharp composite does (drawn
                // straight into the frame, tiny-skia's 8-bit blend left semi-transparent fills about 1/255 lighter)
                let mut layer = sk::Pixmap::new(width, height).ok_or(PaintError::Size(width, height))?;
                resvg::render(&tree, ts, &mut layer.as_mut());
                over_premultiplied(&mut frame, &layer);
            }
            Layer::Image { image: file, rect, crop, radius, opacity, alpha, rotate } => {
                draw_image(&mut frame, root, s, file, *rect, *crop, radius.unwrap_or(0.), opacity.unwrap_or(1.), alpha.unwrap_or(false), rotate.unwrap_or(0.))?;
            }
            Layer::Video { video, at, rect, crop, radius, opacity, alpha, rotate } => {
                let a = alpha.unwrap_or(false);
                let f = video_frame(video, *at, a)?;
                let f = f.to_string_lossy().into_owned();
                draw_image(&mut frame, root, s, &f, *rect, *crop, radius.unwrap_or(0.), opacity.unwrap_or(1.), a, rotate.unwrap_or(0.))?;
                // each video frame is its own file, painted once: don't keep it decoded
                images().lock().unwrap().retain(|k, _| k.0 != f);
                straight().lock().unwrap().remove(&f);
                placed().lock().unwrap().retain(|k, _| k.0 != f);
            }
        }
    }
    Ok(Painted { pixmap: frame, skipped })
}

/// The frame as the pipeline paints it: every layer made into a straight-RGBA overlay as the pipeline makes it — image
/// and video layers placed (and turned, by libvips's rotate) as `placed()`/`put()` do, SVG layers loaded by libvips
/// (librsvg) — then all of them laid over the black frame in one go, as sharp's single composite does: the frame held
/// in float (premultiplied), each overlay blended in turn, and only the end result rounded (truncated) to 8 bits.
fn paint_exact(layers: &[Layer], width: u32, height: u32) -> Result<Painted, PaintError> {
    let (fw, fh) = (width as i64, height as i64);
    let mut acc = vec![[0f32, 0., 0., 1.]; (width * height) as usize];
    let mut lay = |pic: &image::RgbaImage, x: i64, y: i64| {
        let (w, h) = (pic.width() as i64, pic.height() as i64);
        for j in 0.max(-y)..h.min(fh - y) {
            let row = &pic.as_raw()[(j * w * 4) as usize..][..(w * 4) as usize];
            let dst = &mut acc[((y + j) * fw) as usize..][..fw as usize];
            for i in 0.max(-x)..w.min(fw - x) {
                let sp = &row[(i * 4) as usize..][..4];
                if sp[3] == 0 { continue; }
                let b = &mut dst[(x + i) as usize];
                // libvips's blend3, OVER: the source premultiplied, src + (1 − αs) × dst (fused, as clang builds it)
                let aa = sp[3] as f32 / 255.;
                let t1 = 1. - aa;
                let ar = b[3].mul_add(t1, aa);
                for c in 0..3 { b[c] = t1.mul_add(b[c], sp[c] as f32 / 255. * aa); }
                b[3] = ar;
            }
        }
    };
    let vips = crate::vips::get();
    let mut opt = usvg::Options::default();
    opt.fontdb = fontdb();
    for l in layers {
        match l {
            Layer::Svg { svg } => { let p = svg_overlay(vips, svg, &opt, width, height)?; lay(&p, 0, 0) }
            Layer::Image { image: file, rect, crop, radius, opacity, alpha, rotate } => {
                let (pic, x, y) = placed_turned(vips, file, *rect, *crop, radius.unwrap_or(0.), opacity.unwrap_or(1.), alpha.unwrap_or(false), rotate.unwrap_or(0.), width, height)?;
                lay(&pic, x, y);
            }
            Layer::Video { video, at, rect, crop, radius, opacity, alpha, rotate } => {
                let a = alpha.unwrap_or(false);
                let f = video_frame(video, *at, a)?.to_string_lossy().into_owned();
                let (pic, x, y) = placed_turned(vips, &f, *rect, *crop, radius.unwrap_or(0.), opacity.unwrap_or(1.), a, rotate.unwrap_or(0.), width, height)?;
                lay(&pic, x, y);
                // each video frame is its own file, painted once: don't keep it decoded
                straight().lock().unwrap().remove(&f);
                placed().lock().unwrap().retain(|k, _| k.0 != f);
                turned().lock().unwrap().retain(|k, _| k.0.0 != f);
            }
        }
    }
    // unpremultiplied, ×255, truncated; the frame opaque
    let mut frame = sk::Pixmap::new(width, height).ok_or(PaintError::Size(width, height))?;
    for (d, b) in frame.data_mut().chunks_exact_mut(4).zip(&acc) {
        let ar = b[3];
        for c in 0..3 { d[c] = if ar == 0. { 0 } else { (b[c] / ar * 255.).clamp(0., 255.) as u8 }; }
        d[3] = 255;
    }
    Ok(Painted { pixmap: frame, skipped: vec![] })
}

/// An SVG layer as the overlay sharp makes of it (libvips's svgload; resvg, unpremultiplied, without the library).
/// Cached by its text: a card that holds still is the same SVG frame after frame.
fn svg_overlay(vips: Option<&crate::vips::Vips>, svg: &str, opt: &usvg::Options, width: u32, height: u32) -> Result<Arc<image::RgbaImage>, PaintError> {
    static C: OnceLock<Mutex<HashMap<u64, Arc<image::RgbaImage>>>> = OnceLock::new();
    let key = { use std::hash::{Hash, Hasher}; let mut h = std::collections::hash_map::DefaultHasher::new(); svg.hash(&mut h); h.finish() };
    if let Some(p) = C.get_or_init(Default::default).lock().unwrap().get(&key) { return Ok(p.clone()); }
    let pic = match vips.map(|v| v.svg(svg)) {
        Some(r) => r.map_err(PaintError::Svg)?,
        None => {
            let tree = usvg::Tree::from_str(svg, opt).map_err(|e| PaintError::Svg(e.to_string()))?;
            let mut layer = sk::Pixmap::new(width, height).ok_or(PaintError::Size(width, height))?;
            resvg::render(&tree, sk::Transform::from_scale(width as f32 / tree.size().width(), height as f32 / tree.size().height()), &mut layer.as_mut());
            straight_of(&layer)
        }
    };
    let pic = Arc::new(pic);
    let mut c = C.get().unwrap().lock().unwrap();
    if c.len() > 24 { c.clear(); }
    c.insert(key, pic.clone());
    Ok(pic)
}

fn straight_of(p: &sk::Pixmap) -> image::RgbaImage {
    let mut out = image::RgbaImage::new(p.width(), p.height());
    for (o, px) in out.pixels_mut().zip(p.pixels()) { let c = px.demultiply(); o.0 = [c.red(), c.green(), c.blue(), c.alpha()]; }
    out
}

type TurnedKey = ((String, bool, [u32; 4], [u32; 2], u32, u32), u32);
fn turned() -> &'static Mutex<HashMap<TurnedKey, (Arc<image::RgbaImage>, i64, i64)>> {
    static C: OnceLock<Mutex<HashMap<TurnedKey, (Arc<image::RgbaImage>, i64, i64)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// An image layer placed, and turned when it has a `rotate`, as the pipeline's `put()` does: libvips's rotate of the
/// placed picture (transparent corners), moved by half the growth, rounded (JavaScript's Math.round).
#[allow(clippy::too_many_arguments)]
fn placed_turned(vips: Option<&crate::vips::Vips>, file: &str, rect: Rect, crop: Option<Rect>, radius: f32, opacity: f32, alpha: bool, rotate: f32, width: u32, height: u32) -> Result<(Arc<image::RgbaImage>, i64, i64), PaintError> {
    if rotate == 0. { return placed_exact(file, rect, crop, radius, opacity, alpha); }
    let Some(v) = vips else {
        // without the library: tiny-skia's turn, on a clear frame-sized layer
        let mut layer = sk::Pixmap::new(width, height).ok_or(PaintError::Size(width, height))?;
        draw_image(&mut layer, sk::Transform::identity(), 1., file, rect, crop, radius, opacity, alpha, rotate)?;
        return Ok((Arc::new(straight_of(&layer)), 0, 0));
    };
    let (pic, x, y) = placed_exact(file, rect, crop, radius, opacity, alpha)?;
    let key: TurnedKey = ((file.to_string(), alpha, [rect.x.to_bits(), rect.y.to_bits(), rect.w.to_bits(), rect.h.to_bits()], [crop.map_or(0, |c| c.x.to_bits() ^ c.w.to_bits().rotate_left(7)), crop.map_or(0, |c| c.y.to_bits() ^ c.h.to_bits().rotate_left(7))], radius.to_bits(), opacity.to_bits()), rotate.to_bits());
    if let Some(t) = turned().lock().unwrap().get(&key) { return Ok(t.clone()); }
    let r = v.rotate(&pic, as_written(rotate)).map_err(|e| PaintError::Image(file.to_string(), e))?;
    let js_round = |v: f64| (v + 0.5).floor() as i64;
    let t = (Arc::new(r.clone()), js_round(x as f64 + (pic.width() as f64 - r.width() as f64) / 2.), js_round(y as f64 + (pic.height() as f64 - r.height() as f64) / 2.));
    let mut c = turned().lock().unwrap();
    if c.len() > 64 { c.clear(); }
    c.insert(key, t.clone());
    Ok(t)
}

/// `layer` (premultiplied, the frame's size) over `frame`, in f32: out = src + dst × (1 − src alpha)
fn over_premultiplied(frame: &mut sk::Pixmap, layer: &sk::Pixmap) {
    for (d, s) in frame.data_mut().chunks_exact_mut(4).zip(layer.data().chunks_exact(4)) {
        let a = s[3];
        if a == 0 { continue; }
        if a == 255 { d.copy_from_slice(s); continue; }
        let k = 1. - a as f32 / 255.;
        for c in 0..3 { d[c] = (s[c] as f32 + d[c] as f32 * k + 1e-3).min(255.) as u8; } // truncated, as libvips casts its float blend
        d[3] = 255;
    }
}

/// The pipeline's own placing of an image (lib/presets/layers.ts `placed` and its alpha path, sharp/libvips): the crop
/// as whole source pixels, resized once with Lanczos3 to the rounded rect — covering it for an opaque image, filling it
/// for one with alpha — rounded corners and opacity on its alpha, laid over the frame at the rounded position in
/// floating point. Used at the film's own size (renders, accept); cached by its inputs (a held photo resizes once).
type PlacedKey = (String, bool, [u32; 4], [u32; 2], u32, u32);
fn placed() -> &'static Mutex<HashMap<PlacedKey, Arc<image::RgbaImage>>> {
    static C: OnceLock<Mutex<HashMap<PlacedKey, Arc<image::RgbaImage>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// libvips's resize (8.17, sharp 0.34's) as sharp calls it: `shrink` per axis (in / out, ≥ 1 reduces): the vertical
/// reduce first, then the horizontal, each in 8-bit fixed point exactly as libvips does it — the output size rounded,
/// the origin moved by half the rounding, a 2·rint(3·shrink)+1-point Lanczos3 mask per 1/64 pixel quantised to 12 bits,
/// edges extended, (Σ p·k + 2048) >> 12 saturated — after an integer box shrink when the factor is past twice the gap
/// (2). An axis that enlarges is resampled with Lanczos3 at that axis's size (libvips's affine path, not ported).
fn vips_resize(src: &image::RgbaImage, hshrink: f64, vshrink: f64, kept: (usize, usize)) -> image::RgbaImage {
    let (w0, h0) = src.dimensions();
    let mut buf = src.as_raw().clone();
    let (mut w, mut h) = (w0 as usize, h0 as usize);
    // (sharp hands libvips the scale, 1 / shrink, and libvips inverts it again)
    if vshrink > 1. { let (b, n) = vips_reduce_axis(&buf, w, h, 1. / (1. / vshrink), true, kept.1); buf = b; h = n; }
    if hshrink > 1. { let (b, n) = vips_reduce_axis(&buf, w, h, 1. / (1. / hshrink), false, kept.0); buf = b; w = n; }
    let out = image::RgbaImage::from_raw(w as u32, h as u32, buf).expect("size");
    // any enlarging: libvips's affine with its bicubic interpolator (the other axis at scale 1)
    if hshrink < 1. || vshrink < 1. { return vips_affine_bicubic(&out, if hshrink < 1. { 1. / hshrink } else { 1. }, if vshrink < 1. { 1. / vshrink } else { 1. }); }
    let _ = (w0, h0);
    out
}

/// libvips's affine (scale sx, sy; idx = idy = 0.5, extend copy) with its bicubic (Catmull-Rom) interpolator, 8-bit:
/// the output size is the input's mapped and rounded; output pixel o reads the 4 × 4 around (o / s − 0.5) in source
/// pixels, weights from a 1/64-pixel table in 12-bit fixed point, rows rounded first.
fn vips_affine_bicubic(src: &image::RgbaImage, sx: f64, sy: f64) -> image::RgbaImage {
    const TS: f64 = 64.;
    let round_int = |r: f64| -> i64 { if r > 0. { (r + 0.5) as i64 } else { (r - 0.5) as i64 } }; // VIPS_ROUND_INT
    let table: Vec<[i32; 4]> = (0..=64).map(|t| {
        let x = t as f64 / TS;
        let (cr1, cr2) = (1. - x, -0.5 * x);
        let cr3 = cr1 * cr2;
        let (cone, cfou) = (cr1 * cr3, x * cr3);
        let cr4 = cfou - cone;
        let (ctwo, cthr) = (cr1 - cone + cr4, x - cfou - cr4);
        [cone, ctwo, cthr, cfou].map(|c| (c * 4096.) as i32)
    }).collect();
    let (w, h) = src.dimensions();
    // one axis: the output's first coordinate and size, and for output o the stencil's first source index and table row
    let axis = |n: u32, s: f64| -> (Vec<(i64, usize)>, u32) {
        let size = round_int(n as f64 * s).max(1) as u32;
        let v = (0..size as i64).map(|o| {
            let e = o as f64 / s + 1.5; // in the embedded image (2 px border): ix − idx(0.5 − 1) + window_offset(1)
            let st = (e * TS * 2.) as i64;
            let t = (((st & (TS as i64 * 2 - 1)) + 1) >> 1) as usize;
            (e as i64 - 1 - 2, t) // the stencil's top-left, back in source pixels
        }).collect();
        (v, size)
    };
    let ((xs, ow), (ys, oh)) = (axis(w, sx), axis(h, sy));
    let raw = src.as_raw();
    let px = |x: i64, y: i64, c: usize| raw[((y.clamp(0, h as i64 - 1) as usize) * w as usize + x.clamp(0, w as i64 - 1) as usize) * 4 + c] as i32;
    let mut out = image::RgbaImage::new(ow, oh);
    for (oy, &(y0, ty)) in ys.iter().enumerate() {
        let cy = table[ty];
        for (ox, &(x0, tx)) in xs.iter().enumerate() {
            let cx = table[tx];
            let q = out.get_pixel_mut(ox as u32, oy as u32);
            for c in 0..4 {
                let mut col = 0i32;
                for j in 0..4 {
                    let r = (0..4).map(|i| cx[i] * px(x0 + i as i64, y0 + j as i64, c)).sum::<i32>();
                    col += cy[j] * ((r + 2048) >> 12);
                }
                q[c] = ((col + 2048) >> 12).clamp(0, 255) as u8;
            }
        }
    }
    out
}

/// One axis of libvips's reduce (reducev / reduceh, uchar), on RGBA rows `w` × `h`; returns the new buffer and length.
fn vips_reduce_axis(src: &[u8], w: usize, h: usize, shrink: f64, vertical: bool, start: usize) -> (Vec<u8>, usize) {
    const TS: usize = 64; // VIPS_TRANSFORM_SCALE
    let n_in = if vertical { h } else { w };
    let across = if vertical { w } else { h };
    let n_out = ((n_in as f64 / shrink) + 0.5).floor().max(1.) as usize; // VIPS_ROUND_UINT
    let mut extra = (n_out as f64).mul_add(shrink, -(n_in as f64)); // fused, as clang builds it for arm64
    let mut residual = shrink;
    // the integer part first (gap 2): libvips's shrink — the axis padded to a multiple by repeating its last pixel,
    // then each group's sum as ((Σ + s/2) × (2³² / (256 s))) >> 24 (its C path, which sharp's build takes), ceil size
    let int_shrink = ((n_in as f64 / n_out as f64 / 2.).floor() as usize).max(1);
    let shrunk;
    let (data, len): (&[u8], usize) = if int_shrink > 1 {
        let (s, n2) = (int_shrink, n_in.div_ceil(int_shrink));
        let mult = ((1u64 << 32) / (256 * s as u64)) as u32;
        let fin = |sum: u32| ((sum + s as u32 / 2).wrapping_mul(mult) >> 24) as u8;
        let mut nd = vec![0u8; across * n2 * 4];
        if vertical {
            let row = w * 4;
            let mut acc = vec![0u32; row];
            for o in 0..n2 {
                acc.fill(0);
                for j in o * s..(o + 1) * s { for (a, &p) in acc.iter_mut().zip(&src[j.min(n_in - 1) * row..][..row]) { *a += p as u32; } }
                for (q, &a) in nd[o * row..][..row].iter_mut().zip(&acc) { *q = fin(a); }
            }
        } else {
            for i in 0..across {
                let (r, q) = (&src[i * n_in * 4..][..n_in * 4], &mut nd[i * n2 * 4..][..n2 * 4]);
                for o in 0..n2 { for c in 0..4 {
                    let sum: u32 = (o * s..(o + 1) * s).map(|j| r[j.min(n_in - 1) * 4 + c] as u32).sum();
                    q[o * 4 + c] = fin(sum);
                } }
            }
        }
        extra /= s as f64; residual /= s as f64;
        shrunk = nd;
        (&shrunk, n2)
    } else { (src, n_in) };
    if residual == 1. { return (data.to_vec(), len); }
    let n_point = 2 * (3. * residual).round_ties_even() as usize + 1;
    let offset = (1. + extra) / 2. - 1.;
    // the masks: for each 1/64 position, Lanczos3 over n_point taps, normalised, then (short)(c × 4096)
    let lanczos = |x: f64| -> f64 { if !(-3. ..=3.).contains(&x) { return 0.; } let s = |v: f64| if v == 0. { 1. } else { (v * std::f64::consts::PI).sin() / (v * std::f64::consts::PI) }; s(x) * s(x / 3.) };
    let masks: Vec<Vec<i32>> = (0..=TS).map(|ty| {
        let x = ty as f64 / TS as f64;
        let half = x + n_point as f64 / 2. - 1.;
        let c: Vec<f64> = (0..n_point).map(|i| lanczos((i as f64 - half) / residual)).collect();
        let sum: f64 = c.iter().sum();
        c.iter().map(|v| ((v / sum) * 4096.) as i16 as i32).collect()
    }).collect();
    let pad = (n_point as f64 / 2.).ceil() as i64 - 1; // the embed before the first pixel
    // the sample position, as libvips steps it: set at the top (left) of each region it's asked for, then + residual a
    // pixel — regions are 16-row strips (pngsave's) from the first row kept, and whole rows across; for each output
    // pixel, the first input pixel under the mask (edges extended, VIPS_EXTEND_COPY) and the mask
    let block = if vertical { 16 } else { usize::MAX };
    let mut y = 0.;
    let pos: Vec<(i64, &[i32])> = (0..n_out).map(|o| {
        if o < start || (o - start) % block == 0 { y = (o as f64 + 0.5).mul_add(residual, -0.5) - offset; } else { y += residual; }
        let sy = (y * TS as f64 * 2.) as i64;
        let ty = (((sy & (TS as i64 * 2 - 1)) + 1) >> 1) as usize;
        (y as i64 - pad, masks[ty].as_slice()) // (int) Y: toward zero
    }).collect();
    let last = len as i64 - 1;
    let mut out = vec![0u8; across * n_out * 4];
    if vertical {
        // row by row: each output row a weighted sum of whole input rows
        let row = w * 4;
        let mut acc = vec![0i32; row];
        for (o, &(j0, k)) in pos.iter().enumerate() {
            acc.fill(2048);
            for (t, &kt) in k.iter().enumerate() {
                if kt == 0 { continue; }
                let j = (j0 + t as i64).clamp(0, last) as usize;
                for (a, &p) in acc.iter_mut().zip(&data[j * row..][..row]) { *a += p as i32 * kt; }
            }
            for (q, &a) in out[o * row..][..row].iter_mut().zip(&acc) { *q = (a >> 12).clamp(0, 255) as u8; }
        }
    } else {
        for i in 0..across {
            let (r, q) = (&data[i * len * 4..][..len * 4], &mut out[i * n_out * 4..][..n_out * 4]);
            for (o, &(j0, k)) in pos.iter().enumerate() {
                let mut acc = [2048i32; 4];
                if j0 >= 0 && j0 + k.len() as i64 <= len as i64 {
                    for (p, &kt) in r[j0 as usize * 4..][..k.len() * 4].chunks_exact(4).zip(k) { for c in 0..4 { acc[c] += p[c] as i32 * kt; } }
                } else {
                    for (t, &kt) in k.iter().enumerate() { let j = (j0 + t as i64).clamp(0, last) as usize * 4; for c in 0..4 { acc[c] += r[j + c] as i32 * kt; } }
                }
                for c in 0..4 { q[o * 4 + c] = (acc[c] >> 12).clamp(0, 255) as u8; }
            }
        }
    }
    (out, n_out)
}

/// Decoded sources, straight alpha (as sharp holds them), by file; shared by every painter in the process.
fn straight() -> &'static Mutex<HashMap<String, Arc<image::RgbaImage>>> {
    static C: OnceLock<Mutex<HashMap<String, Arc<image::RgbaImage>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}
fn decoded_straight(file: &str) -> Result<Arc<image::RgbaImage>, PaintError> {
    if let Some(i) = straight().lock().unwrap().get(file) { return Ok(i.clone()); }
    let im = Arc::new(decode_srgb(file)?);
    let mut c = straight().lock().unwrap();
    if c.len() > 40 { c.clear(); }
    c.insert(file.to_string(), im.clone());
    Ok(im)
}

/// A layer's number as the pipeline wrote it into its SVG (JavaScript's shortest form of the JSON value, which reached
/// Flex as f32): the f32's shortest decimal, read back as f64.
fn as_written(v: f32) -> f64 { v.to_string().parse().unwrap_or(v as f64) }

/// The pipeline's mask for a w × h image (cached: a video layer reuses it every frame).
fn mask(w: u32, h: u32, radius: f32, opacity: f32) -> Arc<Vec<u8>> {
    static C: OnceLock<Mutex<HashMap<(u32, u32, u32, u32), Arc<Vec<u8>>>>> = OnceLock::new();
    let key = (w, h, radius.to_bits(), opacity.to_bits());
    if let Some(m) = C.get_or_init(Default::default).lock().unwrap().get(&key) { return m.clone(); }
    let m = Arc::new(crate::roundmask::round_rect(w, h, as_written(radius.max(0.)), opacity.clamp(0., 1.)));
    let mut c = C.get().unwrap().lock().unwrap();
    if c.len() > 64 { c.clear(); }
    c.insert(key, m.clone());
    m
}

/// An image layer placed exactly as the pipeline's `placed()` makes it (straight RGBA, the rounded rect's size) and
/// where it goes (the rounded top-left).
fn placed_exact(file: &str, rect: Rect, crop: Option<Rect>, radius: f32, opacity: f32, alpha: bool) -> Result<(Arc<image::RgbaImage>, i64, i64), PaintError> {
    // (positions rounded as JavaScript's Math.round: half up, also below zero)
    let (x, y, w, h) = ((rect.x as f64 + 0.5).floor() as i64, (rect.y as f64 + 0.5).floor() as i64, rect.w.round().max(1.) as u32, rect.h.round().max(1.) as u32);
    // the crop in whole source pixels, as the pipeline's extract()
    let full = decoded_straight(file)?;
    let dims = full.dimensions();
    let (sw, sh) = (dims.0 as f32, dims.1 as f32);
    let c = crop.unwrap_or(Rect { x: 0., y: 0., w: 1., h: 1. });
    let (left, top) = ((c.x * sw).round().max(0.) as u32, (c.y * sh).round().max(0.) as u32);
    let cw = ((c.w * sw).round() as u32).min(dims.0.saturating_sub(left)).max(1);
    let ch = ((c.h * sh).round() as u32).min(dims.1.saturating_sub(top)).max(1);
    let key: PlacedKey = (file.to_string(), alpha, [left, top, cw, ch], [w, h], radius.to_bits(), opacity.to_bits());
    let cached = placed().lock().unwrap().get(&key).cloned();
    let pic = match cached {
        Some(p) => p,
        None => {
            let mut region = image::imageops::crop_imm(full.as_ref(), left, top, cw, ch).to_image();
            if !alpha { for p in region.pixels_mut() { p[3] = 255; } } // sharp's removeAlpha
            // as sharp: an image with alpha is premultiplied (to 8 bits) around the resize
            // (libvips's premultiply: × (float) (α / 255.0), in float, cast back truncated)
            if alpha { for p in region.pixels_mut() { let k = (p[3] as f64 / 255.) as f32; for c in 0..3 { p[c] = (p[c] as f32 * k).clamp(0., 255.) as u8; } } }
            let mut out = if alpha {
                vips_resize(&region, cw as f64 / w as f64, ch as f64 / h as f64, (0, 0))
            } else {
                // fit: cover, as sharp does it: one shrink for both sides (the smaller), then the centre ((in − out + 1) / 2)
                let k = (cw as f64 / w as f64).min(ch as f64 / h as f64);
                // the centre that's kept: libvips computes from its first row and column
                let size = |n: u32| ((n as f64 / (1. / (1. / k))) + 0.5).floor().max(1.) as u32;
                let kept = (((size(cw).saturating_sub(w) + 1) / 2) as usize, ((size(ch).saturating_sub(h) + 1) / 2) as usize);
                let big = vips_resize(&region, k, k, kept);
                let (bw, bh) = big.dimensions();
                image::imageops::crop_imm(&big, (bw.saturating_sub(w) + 1) / 2, (bh.saturating_sub(h) + 1) / 2, w.min(bw), h.min(bh)).to_image()
            };
            if out.dimensions() != (w, h) { out = image::imageops::resize(&out, w, h, image::imageops::FilterType::Lanczos3); }
            // (and its unpremultiply: × (float) (255.0 / α), truncated)
            if alpha { for p in out.pixels_mut() { let k = if p[3] == 0 { 0. } else { (255. / p[3] as f64) as f32 }; for c in 0..3 { p[c] = (k * p[c] as f32).clamp(0., 255.) as u8; } } }
            // rounded corners and opacity, as the pipeline's dest-in masks: the opaque path's one SVG rect (its rx and
            // fill-opacity); the alpha path's rect (rx), then a flat round(255 × opacity)
            if radius > 0. || opacity < 1. {
                let ms = |out: &mut image::RgbaImage, m: &[u8]| for (p, &a) in out.pixels_mut().zip(m) { p.0 = crate::roundmask::dest_in(p.0, a); };
                if !alpha { ms(&mut out, &mask(w, h, radius, opacity)); } else {
                    if radius > 0. { ms(&mut out, &mask(w, h, radius, 1.)); }
                    if opacity < 1. { let a = (255. * as_written(opacity)).round() as u8; for p in out.pixels_mut() { p.0 = crate::roundmask::dest_in(p.0, a); } }
                }
            }
            let p = Arc::new(out);
            let mut cache = placed().lock().unwrap();
            if cache.len() > 120 { cache.clear(); }
            cache.insert(key, p.clone());
            p
        }
    };
    Ok((pic, x, y))
}

#[allow(clippy::too_many_arguments)]
fn draw_image(frame: &mut sk::Pixmap, root: sk::Transform, s: f32, file: &str, rect: Rect, crop: Option<Rect>, radius: f32, opacity: f32, alpha: bool, rotate: f32) -> Result<(), PaintError> {
    if opacity <= 0. || rect.w <= 0. || rect.h <= 0. { return Ok(()); }
    let full = image(file, alpha, 0)?;
    let c = crop.unwrap_or(Rect { x: 0., y: 0., w: 1., h: 1. });
    // the pipeline rounds the rect before resizing into it
    let (rx, ry, rw, rh) = (rect.x.round(), rect.y.round(), rect.w.round().max(1.), rect.h.round().max(1.));
    // how much the source shrinks on screen; pick the Lanczos level that leaves ≥ 0.5 for bicubic
    let shrink = (rw * s) / (c.w * full.width() as f32);
    let level = if shrink < 0.5 { ((0.5 / shrink).log2().floor() as u32 + 1).min(5) } else { 0 };
    let src = if level > 0 { image(file, alpha, level)? } else { full };
    let (sw, sh) = (src.width() as f32, src.height() as f32);
    let (mut cx, mut cy, mut cw, mut ch) = (c.x * sw, c.y * sh, (c.w * sw).max(1e-3), (c.h * sh).max(1e-3));
    // an opaque image covers its rect the way the pipeline's sharp resize(fit: "cover") does: the crop is trimmed to the
    // rect's shape about its centre (stretching it, as before, drew a crop of another shape squashed); an alpha image
    // is resized to fill, as the pipeline's alpha path does
    if !alpha {
        let (ra, ca) = (rw / rh, cw / ch);
        if ca > ra * 1.0001 { let nw = ch * ra; cx += (cw - nw) / 2.; cw = nw; } else if ca < ra / 1.0001 { let nh = cw / ra; cy += (ch - nh) / 2.; ch = nh; }
    }
    // in layer space: fill_path applies `root` to the shader as well as to the path
    let t = sk::Transform::from_translate(rx, ry).pre_scale(rw / cw, rh / ch).pre_translate(-cx, -cy);
    let mut paint = sk::Paint::default();
    paint.shader = sk::Pattern::new(src.as_ref().as_ref(), sk::SpreadMode::Pad, sk::FilterQuality::Bicubic, opacity, t);
    paint.anti_alias = true;
    let r = sk::Rect::from_xywh(rx, ry, rw, rh).unwrap();
    let path = if radius > 0. { rounded(r, radius) } else { sk::PathBuilder::from_rect(r) };
    // turned about the rect's centre: the path and its shader together (fill_path applies the transform to both)
    let ts = if rotate != 0. { root.pre_concat(sk::Transform::from_rotate_at(rotate, rx + rw / 2., ry + rh / 2.)) } else { root };
    frame.fill_path(&path, &paint, sk::FillRule::Winding, ts, None);
    Ok(())
}

/// Encode a painted frame (opaque) as JPEG or PNG by the path's extension.
pub fn save(p: &sk::Pixmap, path: &std::path::Path, quality: u8) -> Result<(), String> {
    let (w, h) = (p.width(), p.height());
    let rgb: Vec<u8> = p.data().chunks_exact(4).flat_map(|c| [c[0], c[1], c[2]]).collect();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let tmp = path.with_extension(format!("{ext}.tmp"));
    {
        let f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut w8 = std::io::BufWriter::new(f);
        if ext == "png" {
            image::codecs::png::PngEncoder::new(&mut w8)
                .write_image(&rgb, w, h, image::ExtendedColorType::Rgb8).map_err(|e| e.to_string())?;
        } else {
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w8, quality)
                .encode(&rgb, w, h, image::ExtendedColorType::Rgb8).map_err(|e| e.to_string())?;
        }
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

use image::ImageEncoder;

/// How far a painted frame is from a reference image: the mean absolute difference per channel
/// (0–255) and the share of pixels off by more than 16 in any channel. Optionally writes a map.
pub struct Difference { pub mean: f64, pub over: f64 }

pub fn compare(reference: &std::path::Path, ours: &sk::Pixmap, map: Option<&std::path::Path>) -> Result<Difference, String> {
    let r = image::open(reference).map_err(|e| e.to_string())?.to_rgb8();
    if (r.width(), r.height()) != (ours.width(), ours.height()) { return Err(format!("sizes differ: {}×{} vs {}×{}", r.width(), r.height(), ours.width(), ours.height())); }
    let (mut sum, mut over) = (0u64, 0u64);
    let mut m = map.map(|_| image::GrayImage::new(r.width(), r.height()));
    for (i, (px, q)) in r.pixels().zip(ours.pixels()).enumerate() {
        let d = [px[0].abs_diff(q.red()), px[1].abs_diff(q.green()), px[2].abs_diff(q.blue())];
        sum += d.iter().map(|x| *x as u64).sum::<u64>();
        let worst = *d.iter().max().unwrap();
        if worst > 16 { over += 1; }
        if let Some(m) = m.as_mut() { m.as_mut()[i] = (worst as u32 * 4).min(255) as u8; }
    }
    if let (Some(m), Some(p)) = (m, map) { m.save(p).map_err(|e| e.to_string())?; }
    let n = (r.width() * r.height()) as f64;
    Ok(Difference { mean: sum as f64 / n / 3., over: over as f64 / n })
}

#[cfg(test)]
mod video_tests {
    #[test]
    fn sha1_matches_the_pipelines_cache_names() {
        assert_eq!(super::sha1_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(super::sha1_hex(b""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert_eq!(super::sha1_hex(&[b'a'; 1000]), "291e9a6c66994949b57ba5e650361e98fc36b1ba");
    }
}
