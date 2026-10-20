//! `flex sheet`: frame picking, a folder sheet, exact frames from a synthetic video (ffmpeg), the reference pairing; the
//! author's Final 1 renders are #[ignore]d.
use flex_core::sheet::{self, Options};
use std::path::{Path, PathBuf};
use std::process::Command;

fn opts(input: PathBuf) -> Options {
    Options { input, from: None, to: None, fps: None, cols: None, thumb: None, label: true, reference: None, out: None }
}

fn have_ffmpeg() -> bool { Command::new("ffmpeg").arg("-version").output().map(|o| o.status.success()).unwrap_or(false) }

/// A 64 × 64 grey clip at 10 fps whose frame n has luma 8·n (so a frame tells its own number).
fn ramp(dir: &Path, name: &str, frames: u32) -> PathBuf {
    let p = dir.join(name);
    let st = Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=64x64:r=10", "-vf", "format=gray,geq=lum='N*8'", "-frames:v"])
        .arg(frames.to_string()).args(["-c:v", "ffv1"]).arg(&p).status().unwrap();
    assert!(st.success());
    p
}

#[test]
fn frame_numbers_step_by_the_rate_and_include_the_end() {
    assert_eq!(sheet::frame_numbers(76., 77., 2., 30.), vec![2280, 2295, 2310]);
    assert_eq!(sheet::frame_numbers(0., 0.3, 10., 10.), vec![0, 1, 2, 3]);
    // asking for more than the video has doesn't repeat frames
    assert_eq!(sheet::frame_numbers(0., 0.2, 100., 10.), vec![0, 1, 2]);
}

#[test]
fn a_folder_makes_a_sheet_beside_it() {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("stills");
    std::fs::create_dir(&dir).unwrap();
    for (i, c) in [[255u8, 0, 0], [0, 255, 0], [0, 0, 255]].iter().enumerate() {
        image::RgbImage::from_pixel(90, 160, image::Rgb(*c)).save(dir.join(format!("{i}.png"))).unwrap();
    }
    let r = sheet::run(&Options { thumb: Some(90), ..opts(dir.clone()) }).unwrap();
    assert_eq!(r.out, t.path().join("stills.sheet.jpg"));
    assert_eq!(r.frames, 3);
    let img = image::open(&r.out).unwrap().to_rgb8();
    // three vertical thumbs in a row, label strip above
    assert!(img.width() >= 3 * 90 && img.height() > 160, "{:?}", img.dimensions());
    // never overwrites
    assert_eq!(sheet::run(&Options { thumb: Some(90), ..opts(dir.clone()) }).unwrap().out, t.path().join("stills.sheet-2.jpg"));
    // a folder with --ref is refused
    assert!(sheet::run(&Options { reference: Some(dir.join("0.png")), ..opts(dir) }).is_err());
}

#[test]
fn frames_come_out_by_exact_number() {
    if !have_ffmpeg() { eprintln!("no ffmpeg: skipped"); return; }
    let t = tempfile::tempdir().unwrap();
    let v = ramp(t.path(), "ramp.mkv", 30);
    let frames = sheet::extract(&v, &[3, 7, 20]).unwrap();
    assert_eq!(frames.len(), 3);
    for (f, n) in frames.iter().zip([3u32, 7, 20]) {
        let luma = f.get_pixel(32, 32).0[0] as i32;
        assert!((luma - (n as i32) * 8).abs() <= 2, "frame {n}: luma {luma}");
    }
}

#[test]
fn a_reference_pairs_frames_and_measures_them() {
    if !have_ffmpeg() { eprintln!("no ffmpeg: skipped"); return; }
    let t = tempfile::tempdir().unwrap();
    let v = ramp(t.path(), "a.mkv", 30);
    let same = ramp(t.path(), "b.mkv", 30);
    let out = t.path().join("pair.png");
    let r = sheet::run(&Options { from: Some(0.5), to: Some(1.5), fps: Some(2.), reference: Some(same), out: Some(out.clone()), ..opts(v.clone()) }).unwrap();
    assert_eq!(r.out, out);
    assert_eq!(r.frames, 3);
    assert_eq!(r.diffs.iter().map(|d| d.0).collect::<Vec<_>>(), vec![0.5, 1.0, 1.5]);
    assert!(r.diffs.iter().all(|d| d.1 < 0.5), "{:?}", r.diffs);
    // a reference a frame behind differs by about 8 levels
    let shifted = t.path().join("c.mkv");
    assert!(Command::new("ffmpeg").args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=64x64:r=10", "-vf", "format=gray,geq=lum='(N+1)*8'", "-frames:v", "30", "-c:v", "ffv1"]).arg(&shifted).status().unwrap().success());
    let r = sheet::run(&Options { from: Some(0.5), to: Some(1.5), fps: Some(2.), reference: Some(shifted), out: Some(t.path().join("shift.jpg")), ..opts(v) }).unwrap();
    assert!(r.diffs.iter().all(|d| (d.1 - 8.).abs() < 1.5), "{:?}", r.diffs);
}

#[test]
fn a_stretch_past_the_end_is_refused() {
    if !have_ffmpeg() { eprintln!("no ffmpeg: skipped"); return; }
    let t = tempfile::tempdir().unwrap();
    let v = ramp(t.path(), "short.mkv", 10);
    assert!(sheet::run(&Options { from: Some(5.), to: Some(6.), ..opts(v) }).is_err());
}

/// A film's variant, 76–83 s at 2 fps, alone and beside the film; frame 2370 is ffmpeg's frame 2370. The media:
/// $FLEX_TEST_MEDIA (default ~/Documents/web/flex-test-media), out of git: sheet/variant.mp4 and sheet/film.mp4.
#[test]
#[ignore]
fn final_one_sheets() {
    let dir = std::env::var_os("FLEX_TEST_MEDIA").map(std::path::PathBuf::from).unwrap_or_else(|| dirs::home_dir().unwrap().join("Documents/web/flex-test-media")).join("sheet");
    let (a, b) = (dir.join("variant.mp4"), dir.join("film.mp4"));
    let t = tempfile::tempdir().unwrap();
    let r = sheet::run(&Options { from: Some(76.), to: Some(83.), fps: Some(2.), out: Some(t.path().join("a.jpg")), ..opts(a.clone()) }).unwrap();
    assert_eq!(r.frames, 15);
    let r = sheet::run(&Options { from: Some(76.), to: Some(83.), fps: Some(2.), reference: Some(b), out: Some(t.path().join("b.jpg")), ..opts(a.clone()) }).unwrap();
    assert_eq!(r.diffs.len(), 15);
    let mine = sheet::extract(&a, &[2370]).unwrap().remove(0);
    let png = t.path().join("f2370.png");
    assert!(Command::new("ffmpeg").args(["-v", "error", "-y", "-i"]).arg(&a).args(["-vf", "select=eq(n\\,2370)", "-fps_mode", "passthrough", "-frames:v", "1"]).arg(&png).status().unwrap().success());
    assert_eq!(sheet::mean_diff(&mine, &image::open(&png).unwrap().to_rgb8()), 0.);
}
