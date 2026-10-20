use flex_core::cutout::{apply_floor, default_out, defringe, drop_specks, is_video, mean_alpha, over_checker, smooth};
use std::path::{Path, PathBuf};

/// Smoothing over time settles a boiling soft edge but never blends across a real change (a limb that moved), so
/// nothing ghosts, lags or gets holes.
#[test]
fn smoothing_settles_boil_but_keeps_motion() {
    // pixel 0: a soft edge boiling 110 / 150 / 120; pixel 1: an arm arriving (0 → 255 → 255);
    // pixel 2: an arm leaving (255 → 0 → 0); pixel 3: steady
    let prev = [110u8, 0, 255, 200];
    let cur = [150u8, 255, 0, 200];
    let next = [120u8, 255, 0, 200];
    let out = smooth(&[&prev, &cur, &next]);
    assert!((out[0] as i32 - 133).abs() <= 4, "the boil is averaged toward its neighbours: {}", out[0]);
    assert_eq!(out[1], 255, "an arriving arm is fully there, no ghost");
    assert_eq!(out[2], 0, "a leaving arm is fully gone, no trail");
    assert_eq!(out[3], 200);
    // a window of one is the frame itself
    assert_eq!(smooth(&[&cur]), cur.to_vec());
}

/// Specks far smaller than her go (with their rim); a second sizeable shape stays.
#[test]
fn specks_apart_from_her_are_dropped() {
    let (w, h) = (200usize, 200usize);
    let mut a = vec![0u8; w * h];
    let mut fill = |x0: usize, y0: usize, x1: usize, y1: usize, v: u8| for y in y0..y1 { for x in x0..x1 { a[y * w + x] = v; } };
    fill(40, 20, 120, 190, 255); // her
    fill(150, 30, 154, 34, 255); // a 4×4 speck of a sign
    fill(149, 29, 155, 35, 30); // …with a faint rim (drawn under it, so it rings it)
    fill(150, 30, 154, 34, 255);
    fill(150, 120, 190, 190, 255); // someone else, big enough to keep
    let mut b = a.clone();
    let n = drop_specks(&mut b, w, h);
    assert_eq!(n, 1);
    assert_eq!(b[32 * w + 152], 0, "the speck is gone");
    assert_eq!(b[29 * w + 149], 0, "its rim too");
    assert_eq!(b[100 * w + 80], 255, "she stays");
    assert_eq!(b[150 * w + 170], 255, "the second shape stays");
    // one shape alone: nothing to drop
    let mut c = vec![0u8; w * h];
    c[50 * w + 50] = 255;
    assert_eq!(drop_specks(&mut c, w, h), 0);
    assert_eq!(c[50 * w + 50], 255);
}

#[test]
fn the_floor_clears_faint_alpha_and_keeps_the_edge_continuous() {
    let mut a: Vec<u8> = (0..=255).collect();
    apply_floor(&mut a, 0.08);
    assert_eq!(a[0], 0);
    assert_eq!(a[20], 0, "under 8 % is gone");
    assert!(a[22] > 0 && a[22] < 4, "just over the floor starts near 0: {}", a[22]);
    assert_eq!(a[255], 255);
    assert!(a.windows(2).all(|p| p[1] >= p[0]), "monotonic");
    let mut b: Vec<u8> = (0..=255).collect();
    apply_floor(&mut b, 0.);
    assert_eq!(b, (0..=255).collect::<Vec<u8>>());
}

/// Her soft edge over a red neon: the red is taken back out (her colour comes back), her inside is untouched, and
/// what's transparent is black.
#[test]
fn defringe_takes_the_background_out_of_her_edge() {
    let (w, h) = (80usize, 40usize);
    let skin = [150u8, 110, 90];
    let neon = [250u8, 20, 30];
    let mut px = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            // her on the left (x < 40), a 4 px soft edge, the neon on the right
            let a: f32 = if x < 38 { 1. } else if x < 42 { (42 - x) as f32 / 5. } else { 0. };
            let i = (y * w + x) * 4;
            for k in 0..3 { px[i + k] = (skin[k] as f32 * a + neon[k] as f32 * (1. - a)).round() as u8; }
            px[i + 3] = (a * 255.).round() as u8;
        }
    }
    let before = px.clone();
    defringe(&mut px, w, h);
    let at = |p: &[u8], x: usize| { let i = (20 * w + x) * 4; [p[i], p[i + 1], p[i + 2], p[i + 3]] };
    assert_eq!(at(&px, 10), at(&before, 10), "inside her is untouched");
    assert_eq!(at(&px, 60), [0, 0, 0, 0], "the background is transparent black");
    for x in 38..42 {
        let (o, b) = (at(&px, x), at(&before, x));
        assert_eq!(o[3], b[3], "alpha is never changed");
        let err = |p: [u8; 4]| (0..3).map(|k| (p[k] as i32 - skin[k] as i32).abs()).max().unwrap();
        assert!(err(o) <= 12, "x {x}: the edge is her colour again ({o:?}, was {b:?})");
        assert!(err(o) < err(b), "x {x}: closer to her than before");
    }
}

#[test]
fn checker_preview_and_names() {
    // transparent → the checker, opaque → the colour
    let px = [255u8, 0, 0, 255, 255, 0, 0, 0];
    let rgb = over_checker(&px, 2, 1);
    assert_eq!(&rgb[0..3], &[255, 0, 0]);
    assert_eq!(&rgb[3..6], &[204, 204, 204]);
    assert!((mean_alpha(&[255, 0]) - 0.5).abs() < 1e-9);
    assert!(is_video(Path::new("a/V12.MP4")) && is_video(Path::new("x.mov")) && !is_video(Path::new("p.jpg")) && !is_video(Path::new("p.heic")));
    assert_eq!(default_out(Path::new("/m/V12.mp4"), true), PathBuf::from("/m/V12.cutout.mov"));
    assert_eq!(default_out(Path::new("/m/her.jpg"), false), PathBuf::from("/m/her.cutout.png"));
}

#[test]
fn bad_options_are_refused() {
    let d = tempfile::tempdir().unwrap();
    let photo = d.path().join("p.png");
    image::RgbaImage::new(4, 4).save(&photo).unwrap();
    let o = |input: PathBuf, from: Option<f64>, floor: f64| flex_core::cutout::Options { input, out: None, from, to: None, keep_text: false, smooth: 3, floor, preview: false };
    assert!(flex_core::cutout::run(&o(d.path().join("missing.mp4"), None, 0.08)).is_err());
    assert!(flex_core::cutout::run(&o(photo.clone(), Some(1.), 0.08)).is_err(), "--from on a photo");
    assert!(flex_core::cutout::run(&o(photo, None, 1.5)).is_err(), "--floor over 1");
}

// ---------------------------------------------------------------------------------------------------------------------
// real media (macOS Vision, ffmpeg): cargo test -p flex-core --test cutout_tests -- --ignored
// $FLEX_TEST_MEDIA (default ~/Documents/web/flex-test-media), out of git: cutout/clip.mp4, and a film's hand-made
// cut-out frames (cutout/hand/NNNN.png) with the clip's frames they came from (cutout/clip-frames/NNNN.jpg)

fn media() -> PathBuf { std::env::var_os("FLEX_TEST_MEDIA").map(PathBuf::from).unwrap_or_else(|| dirs::home_dir().unwrap().join("Documents/web/flex-test-media")) }

fn alpha_frames(mov: &Path, dir: &Path) -> Vec<image::RgbaImage> {
    std::fs::create_dir_all(dir).unwrap();
    let st = std::process::Command::new("ffmpeg").args(["-v", "error", "-y", "-i"]).arg(mov).args(["-pix_fmt", "rgba"]).arg(dir.join("%04d.png"))
        .env("PATH", flex_core::project::login_path()).status().unwrap();
    assert!(st.success());
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    v.sort();
    v.iter().map(|p| image::open(p).unwrap().to_rgba8()).collect()
}

/// V12's cut-out (the dancer, 11.0–12.0 s: hands up, a red neon sign right behind her head) matches Film
/// A's hand-made frames (mean alpha Δ ≤ 3/255 per frame), and `{video, alpha: true}` paints her with transparency.
#[test]
#[ignore]
fn v12_matches_film_a_and_paints_with_alpha() {
    let clip = media().join("cutout/clip.mp4");
    let film_a = media().join("cutout/hand");
    if !clip.exists() || !film_a.exists() { eprintln!("skipped: no test media"); return; }
    let d = tempfile::tempdir().unwrap();
    let out = d.path().join("v12.cutout.mov");
    let r = flex_core::cutout::run(&flex_core::cutout::Options { input: clip, out: Some(out.clone()), from: Some(11.0), to: Some(12.0), keep_text: false, smooth: 3, floor: 0.08, preview: false }).unwrap();
    assert_eq!((r.frames, r.width, r.height), (30, 480, 848));
    assert!(r.coverage > 0.10 && r.coverage < 0.30, "coverage {}", r.coverage);
    let frames = alpha_frames(&out, &d.path().join("f"));
    assert_eq!(frames.len(), 30);
    let clips = media().join("cutout/clip-frames");
    let mut neon = (0, 0);
    for (i, f) in frames.iter().enumerate() {
        // Film A's frame k (1-based) is clip time (k-1)/30: 11.0 s is 0331
        let k = 331 + i;
        let theirs = image::open(film_a.join(format!("{k:04}.png"))).unwrap().to_rgba8();
        let d: f64 = f.pixels().zip(theirs.pixels()).map(|(a, b)| (a[3] as f64 - b[3] as f64).abs()).sum::<f64>() / (480. * 848.);
        assert!(d <= 3.0, "frame {k}: mean alpha Δ {d:.2}");
        // the sign behind her head is gone: of the source's red neon (the sign's lettering, upper 40 %), no more is kept
        // than Film A kept (what both keep is her own red: the shirt's trim, lips, nails)
        let src = image::open(clips.join(format!("{k:04}.jpg"))).unwrap().to_rgb8();
        let kept = |m: &image::RgbaImage| (0..340u32).flat_map(|y| (0..480u32).map(move |x| (x, y)))
            .filter(|&(x, y)| { let c = src.get_pixel(x, y); c[0] > 170 && c[1] < 100 && c[2] < 150 && m.get_pixel(x, y)[3] > 128 }).count();
        let (m, t) = (kept(f), kept(&theirs));
        assert!(m <= t + 100, "frame {k}: {m} neon pixels kept (Film A {t})");
        neon.0 += m; neon.1 += t;
    }
    assert!(neon.0 as f64 <= neon.1 as f64 * 1.15 + 200., "neon kept {} vs Film A {}", neon.0, neon.1);

    // painted by Flex over green: the green shows round her, she shows in the middle
    std::env::set_var("FLEX_WORK", d.path().join("work"));
    use flex_core::paint::{paint_in, Layer, Rect};
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#00ff00"/></svg>"##;
    let layers = vec![Layer::Svg { svg: svg.into() }, Layer::Video { video: out.to_string_lossy().into_owned(), at: 0.5, rect: Rect { x: 0., y: 0., w: 1080., h: 1908. }, crop: None, radius: None, opacity: None, alpha: Some(true), rotate: None }];
    let p = paint_in(&layers, [1080, 1920], 480).unwrap();
    assert!(p.skipped.is_empty());
    // to look at it: FLEX_CUTOUT_SHOT=/some/where.png
    if let Some(shot) = std::env::var_os("FLEX_CUTOUT_SHOT") { flex_core::paint::save(&p.pixmap, Path::new(&shot), 90).unwrap(); }
    let px = |x: u32, y: u32| { let c = p.pixmap.pixel(x, y).unwrap().demultiply(); [c.red(), c.green(), c.blue()] };
    let f = &frames[15];
    // a pixel where she isn't, and one where she is (in the cut-out's own frame, 480 wide: same scale)
    let (bx, by) = (20, 800);
    assert_eq!(f.get_pixel(bx, by)[3], 0);
    assert_eq!(px(bx, by), [0, 255, 0], "transparent: the green shows");
    let (sx, sy) = (0..480u32).flat_map(|x| (380..460u32).map(move |y| (x, y))).find(|&(x, y)| f.get_pixel(x, y)[3] == 255 && x > 200).unwrap();
    let c = px(sx, sy);
    let o = f.get_pixel(sx, sy);
    assert!((0..3).all(|k| (c[k] as i32 - o[k] as i32).abs() <= 12), "her colour {c:?} vs the cut-out's {o:?}");
}
