//! `flex crop`: the framing maths (no Vision), the centre crop on a synthetic photo, output naming; the real best-four
//! photos are #[ignore]d (they need Vision and the author's media).
use flex_core::crop::{self, Options, Subject};
use std::path::PathBuf;

#[test]
fn centre_takes_the_largest_cell_shaped_crop() {
    let (b, s, notes) = crop::plan((1000, 1000), (500, 1000), Subject::Centre, None, 1.3, (0.5, 0.5));
    assert_eq!(b, [250., 0., 500., 1000.]);
    assert!((s - 1.0).abs() < 1e-9);
    assert!(notes.is_empty(), "{notes:?}");
}

#[test]
fn a_person_fills_the_cell_and_sits_on_its_place() {
    // a 100 × 430 person in a big photo: the crop is 430 / 0.86 = 500 tall, the person's centre at (0.5, 0.57)
    let (b, s, notes) = crop::plan((4000, 3000), (500, 1000), Subject::Person, Some([1000., 1000., 100., 430.]), 4., (0.5, 0.57));
    assert!((b[3] - 500.).abs() < 1e-6 && (b[2] - 250.).abs() < 1e-6, "{b:?}");
    assert!((b[0] + b[2] * 0.5 - 1050.).abs() < 1e-6 && (b[1] + b[3] * 0.57 - 1215.).abs() < 1e-6, "{b:?}");
    assert!((s - 2.0).abs() < 1e-9);
    assert!(notes.is_empty(), "{notes:?}");
}

#[test]
fn the_ceiling_grows_the_crop_and_says_so() {
    // the framing wants 2×, --max 1.3: the crop grows to 1000 / 1.3 tall, still around the subject
    let (b, s, notes) = crop::plan((4000, 3000), (500, 1000), Subject::Person, Some([1000., 1000., 100., 430.]), 1.3, (0.5, 0.5));
    assert!((b[3] - 1000. / 1.3).abs() < 1e-6, "{b:?}");
    assert!((s - 1.3).abs() < 1e-9);
    assert!((b[0] + b[2] * 0.5 - 1050.).abs() < 1e-6, "the subject stays placed: {b:?}");
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("--max 1.3"), "{notes:?}");
}

#[test]
fn a_small_photo_is_noted_and_the_crop_stays_inside() {
    let (b, s, notes) = crop::plan((300, 400), (540, 960), Subject::Face, Some([250., 20., 40., 40.]), 1.3, (0.5, 0.42));
    assert!(b[0] >= 0. && b[1] >= 0. && b[0] + b[2] <= 300. + 1e-6 && b[1] + b[3] <= 400. + 1e-6, "{b:?}");
    assert!((b[3] - 400.).abs() < 1e-6, "the largest crop: {b:?}");
    assert!(s > 1.3);
    assert!(notes.iter().any(|n| n.contains("small for this cell")), "{notes:?}");
}

fn synthetic(dir: &std::path::Path) -> PathBuf {
    // left half red, right half blue, a green square in the middle
    let img = image::RgbImage::from_fn(800, 600, |x, y| {
        if (350..450).contains(&x) && (250..350).contains(&y) { image::Rgb([0, 255, 0]) } else if x < 400 { image::Rgb([255, 0, 0]) } else { image::Rgb([0, 0, 255]) }
    });
    let p = dir.join("photo.png");
    img.save(&p).unwrap();
    p
}

#[test]
fn centre_crop_writes_a_cell_beside_the_photo_and_never_overwrites() {
    let t = tempfile::tempdir().unwrap();
    let input = synthetic(t.path());
    let o = Options { input: input.clone(), cell: (300, 600), subject: Subject::Centre, max: 1.3, place: None, out: None };
    let r = crop::run(&o).unwrap();
    assert_eq!(r.out, t.path().join("photo.crop.png"));
    assert_eq!((r.x, r.y, r.w, r.h), (250, 0, 300, 600));
    let img = image::open(&r.out).unwrap().to_rgb8();
    assert_eq!(img.dimensions(), (300, 600));
    assert_eq!(img.get_pixel(150, 300).0, [0, 255, 0], "the middle is the green square");
    // a second run doesn't overwrite the first
    let r2 = crop::run(&o).unwrap();
    assert_eq!(r2.out, t.path().join("photo.crop-2.png"));
    // an explicit -o does
    let r3 = crop::run(&Options { out: Some(r.out.clone()), ..o.clone() }).unwrap();
    assert_eq!(r3.out, r.out);
}

#[test]
fn bad_options_are_refused() {
    let t = tempfile::tempdir().unwrap();
    let input = synthetic(t.path());
    let o = Options { input, cell: (0, 600), subject: Subject::Centre, max: 1.3, place: None, out: None };
    assert!(crop::run(&o).is_err());
    assert!(crop::run(&Options { cell: (300, 600), max: 0., ..o.clone() }).is_err());
    assert!(crop::run(&Options { cell: (300, 600), place: Some((1.5, 0.5)), ..o }).is_err());
}

/// The best four from real photos, close to hand-made cells. The media: $FLEX_TEST_MEDIA (default
/// ~/Documents/web/flex-test-media), out of git: crop/photo-1..4.jpg and the hand-made crop/cell-1..4.png.
#[test]
#[ignore]
fn best_four_match_the_hand_made_cells() {
    let media = std::env::var_os("FLEX_TEST_MEDIA").map(std::path::PathBuf::from).unwrap_or_else(|| dirs::home_dir().unwrap().join("Documents/web/flex-test-media"));
    let (src, cells) = (media.join("crop"), media.join("crop"));
    let t = tempfile::tempdir().unwrap();
    // (cell, source, subject, the hand crop box x, y, w, h)
    let picks = [
        ("cell-1", "photo-1", Subject::Face, [1.8, 0., 715.3, 1280.]),
        ("cell-2", "photo-2", Subject::Face, [1.8, 0., 715.3, 1280.]),
        ("cell-3", "photo-3", Subject::Person, [254., 391., 393., 703.3]),
        ("cell-4", "photo-4", Subject::Person, [175., 194., 458., 819.6]),
    ];
    for (cell, s, subject, hand) in picks {
        let r = crop::run(&Options { input: src.join(format!("{s}.jpg")), cell: (1064, 1904), subject, max: 3., place: None, out: Some(t.path().join(format!("{cell}.png"))) }).unwrap();
        let mine = image::open(&r.out).unwrap().to_rgb8();
        let theirs = image::open(cells.join(format!("{cell}.png"))).unwrap().to_rgb8();
        let d: f64 = mine.as_raw().iter().zip(theirs.as_raw()).map(|(a, b)| (*a as f64 - *b as f64).abs()).sum::<f64>() / mine.as_raw().len() as f64;
        // the crop's centre within 8 % of the hand crop's size, its size within 10 %
        let (cx, cy) = (r.x as f64 + r.w as f64 / 2., r.y as f64 + r.h as f64 / 2.);
        let (hx, hy) = (hand[0] + hand[2] / 2., hand[1] + hand[3] / 2.);
        println!("{cell}: crop {},{} {}×{} vs hand {:?} · Δ {d:.2}", r.x, r.y, r.w, r.h, hand);
        assert!((cx - hx).abs() < 0.08 * hand[2] && (cy - hy).abs() < 0.08 * hand[3], "{cell}: centre {cx},{cy} vs {hx},{hy}");
        assert!((r.h as f64 / hand[3] - 1.).abs() < 0.10, "{cell}: height {} vs {}", r.h, hand[3]);
    }
    // at the default ceiling the 720 × 1280 selfie can't make a 1064 × 1904 cell: the note says so
    let r = crop::run(&Options { input: src.join("photo-1.jpg"), cell: (1064, 1904), subject: Subject::Face, max: 1.3, place: None, out: Some(t.path().join("ceiling.png")) }).unwrap();
    assert!(r.notes.iter().any(|n| n.contains("--max 1.3")), "{:?}", r.notes);
}
