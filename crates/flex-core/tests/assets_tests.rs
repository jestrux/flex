//! The assets scan on a made-up project (every kind), and on the real samples when they're there.

use flex_core::assets::{self, Kind, Options};
use std::fs;
use std::path::Path;

/// a minimal WAV: 8 kHz mono 16-bit, `n` samples of silence
fn wav(n: usize) -> Vec<u8> {
    let data = n * 2;
    let mut v = b"RIFF".to_vec();
    v.extend(((36 + data) as u32).to_le_bytes());
    v.extend(b"WAVEfmt ");
    v.extend(16u32.to_le_bytes());
    v.extend(1u16.to_le_bytes()); v.extend(1u16.to_le_bytes());
    v.extend(8000u32.to_le_bytes()); v.extend(16000u32.to_le_bytes());
    v.extend(2u16.to_le_bytes()); v.extend(16u16.to_le_bytes());
    v.extend(b"data"); v.extend((data as u32).to_le_bytes());
    v.extend(std::iter::repeat_n(0u8, data));
    v
}

fn png(p: &Path, w: u32, h: u32) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    image::RgbImage::from_pixel(w, h, image::Rgb([200, 200, 200])).save(p).unwrap();
}

fn write(p: &Path, s: impl AsRef<[u8]>) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}

/// film/ (the project) and film-lab/ beside it
fn fixture(root: &Path) -> std::path::PathBuf {
    let d = fs::canonicalize(root).unwrap().join("film");
    write(&d.join("project.ts"), "export default defineProject({\n  name: \"fixture-film\",\n  feel: \"modern\",\n});\n");
    write(&d.join("audio.json"), r#"{
      "music": { "song": { "file": "audio/song.wav", "mood": "calm", "lufs": -14.1, "peak": -1.0 } },
      "stems": "audio/stems/",
      "sfx": { "pop": { "file": "audio/sfx/pop.wav", "purpose": "a pop", "lufs": -20.5 } }
    }"#);
    write(&d.join("audio/song.wav"), wav(8000 * 4));
    write(&d.join("audio/song.grid.json"), r#"{"bpm": 120.0, "duration": 4.0}"#);
    write(&d.join("audio/song.lyrics.json"), r#"{"stem": "0 Lead.wav", "words": [{"word":"hey","start":1.0,"end":1.4,"line":0},{"word":"you","start":1.5,"end":1.9,"line":0}]}"#);
    write(&d.join("audio/stems/0 Lead.wav"), wav(8000 * 4));
    write(&d.join("audio/stems/1 Drums.wav"), wav(8000 * 4));
    write(&d.join("audio/sfx/pop.wav"), wav(4000));
    write(&d.join("audio/sfx/whoosh.wav"), wav(2000)); // not in audio.json
    // a take picked at v1, with versions v0 and v1
    let ev = |n: usize| format!(r#"{{"viewport":{{"w":1440,"h":810}},"dpr":2,"duration":{},"frames":[{}]}}"#, n * 100,
        (0..n).map(|i| format!(r#"{{"t":{},"file":"f{:06}.jpg"}}"#, i * 100, i + 1)).collect::<Vec<_>>().join(","));
    write(&d.join("takes/home/events.json"), ev(5));
    write(&d.join("takes/home/.flex-version"), "1");
    write(&d.join("takes/home/frames/f000001.jpg"), b"x");
    write(&d.join("takes/.versions/home/v0/events.json"), ev(3));
    write(&d.join("takes/.versions/home/v0/version.json"), r#"{"n":0,"note":"the take before Flex versioned it"}"#);
    write(&d.join("takes/.versions/home/v1/events.json"), ev(5));
    write(&d.join("takes/.versions/home/v1/version.json"), r#"{"n":1,"at":"2026-10-16T20:26:38Z","late":1,"worst":55}"#);
    write(&d.join("takes/.versions/home/v1/report.json"), "{}");
    // images
    png(&d.join("assets/freezes/manager-loans.png"), 40, 20);
    png(&d.join("storyboard/walk/manager-overview.png"), 64, 36);
    write(&d.join("storyboard/walk/manager-overview.boxes.json"), r#"{"dpr":1,"boxes":{"loanRow":{"x":2,"y":3,"w":20,"h":8},"gone":null}}"#);
    png(&d.join("assets/people/ann.png"), 10, 10);
    // cards and the look (the card list needs the pipeline: not run here)
    write(&d.join("look.ts"), "export default defineLook({ cards: { sting: defineCard({}) } });");
    write(&d.join("cards/lift.ts"), "export function liftSequence() {}");
    // a lab of it
    let root = d.parent().unwrap();
    write(&root.join("film-lab/project.ts"), "import x from \"../film/cards/lift.ts\";\nexport default defineProject({ name: \"film-lab\", target: { project: \"../film\", section: \"book\" } });\n");
    write(&root.join("unrelated/project.ts"), "export default defineProject({ name: \"other\" });\n");
    // a renders folder with one of the film's renders (an mp4 whose header says 2.5 s at 640×360)
    let bx = |k: &[u8], body: Vec<u8>| { let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec(); v.extend(k); v.extend(body); v };
    let mut mvhd = vec![0u8; 100];
    mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
    mvhd[16..20].copy_from_slice(&2500u32.to_be_bytes());
    let mut tkhd = vec![0u8; 84];
    tkhd[76..80].copy_from_slice(&(640u32 << 16).to_be_bytes());
    tkhd[80..84].copy_from_slice(&(360u32 << 16).to_be_bytes());
    let moov = bx(b"moov", [bx(b"mvhd", mvhd), bx(b"trak", bx(b"tkhd", tkhd))].concat());
    write(&root.join("renders/fixture-film--intro.mp4"), [bx(b"ftyp", b"isom0000".to_vec()), moov].concat());
    write(&root.join("renders/someone-else.mp4"), b"x");
    d
}

#[test]
fn scans_every_kind() {
    let t = tempfile::tempdir().unwrap();
    let d = fixture(t.path());
    let s = assets::scan(&d, &Options { renders: Some(t.path().join("renders")), ..Default::default() }).unwrap();
    let ids: Vec<(&str, Kind)> = s.assets.iter().map(|a| (a.id.as_str(), a.kind)).collect();
    let has = |id: &str, k: Kind| assert!(ids.contains(&(id, k)), "{id} as {k:?} missing from {ids:#?}");

    // audio
    has("audio.json#music/song", Kind::Music);
    let song = s.get("audio.json#music/song").unwrap();
    assert_eq!(song.facts.duration, Some(4.0));
    assert_eq!(song.facts.bpm, Some(120.0));
    assert_eq!(song.facts.lufs, Some(-14.1));
    assert_eq!(song.facts.words, Some(2));
    assert_eq!(song.note.as_deref(), Some("calm"));
    assert_eq!(song.files.len(), 3, "the track, its grid and its lyrics");
    has("audio/stems/0 Lead.wav", Kind::Stem);
    assert_eq!(s.get("audio/stems/0 Lead.wav").unwrap().facts.words, Some(2), "the stem the words were heard in");
    assert_eq!(s.get("audio/stems/1 Drums.wav").unwrap().facts.words, None);
    has("audio.json#sfx/pop", Kind::Sound);
    assert_eq!(s.get("audio.json#sfx/pop").unwrap().facts.duration, Some(0.5));
    has("audio/sfx/whoosh.wav", Kind::Sound);
    assert_eq!(s.get("audio/sfx/whoosh.wav").unwrap().facts.registered, Some(false));

    // takes: the pick, its versions after it, oldest first
    let take = s.get("takes/home").unwrap();
    assert_eq!(take.kind, Kind::Take);
    assert_eq!((take.facts.frames, take.facts.duration, take.facts.version), (Some(5), Some(0.5), Some(1)));
    assert_eq!(take.facts.versions.iter().map(|v| (v.n, v.picked)).collect::<Vec<_>>(), vec![(0, false), (1, true)]);
    assert_eq!(take.file.as_deref(), Some(d.join("takes/home/frames/f000001.jpg").as_path()));
    let v1 = s.get("takes/.versions/home/v1").unwrap();
    assert_eq!((v1.kind, v1.facts.picked, v1.facts.late, v1.facts.worst_ms), (Kind::TakeVersion, Some(true), Some(1), Some(55.0)));
    assert!(v1.facts.report.is_some());
    assert_eq!(s.get("takes/.versions/home/v0").unwrap().note.as_deref(), Some("the take before Flex versioned it"));
    let at = |id: &str| s.assets.iter().position(|a| a.id == id).unwrap();
    assert!(at("takes/home") < at("takes/.versions/home/v0") && at("takes/.versions/home/v0") < at("takes/.versions/home/v1"));
    assert_eq!(take.facts.versions.iter().map(|v| v.n).collect::<Vec<_>>(), vec![0, 1]);

    // images
    has("assets/freezes/manager-loans.png", Kind::Freeze);
    assert_eq!(s.get("assets/freezes/manager-loans.png").unwrap().facts.width, Some(40));
    has("storyboard/walk/manager-overview.png", Kind::Still);
    assert_eq!(s.get("storyboard/walk/manager-overview.png").unwrap().facts.box_names, vec!["loanRow".to_string()]);
    has("assets/people/ann.png", Kind::Image);
    assert!(!ids.iter().any(|(i, k)| *i == "assets/freezes/manager-loans.png" && *k == Kind::Image), "a freeze isn't also an image");

    // cards: without a card list, the files under cards/ still show; the look shows
    has("cards/lift.ts", Kind::Card);
    has("look.ts", Kind::Look);
    assert!(s.cards_stale);

    // labs: the sibling that imports and targets this film, not the unrelated one
    has("../film-lab", Kind::Lab);
    assert_eq!(s.get("../film-lab").unwrap().facts.target.as_deref(), Some("book"));
    assert!(!ids.iter().any(|(i, _)| *i == "../unrelated"));

    // renders: only the film's
    has("render:fixture-film--intro.mp4", Kind::Render);
    let r = s.get("render:fixture-film--intro.mp4").unwrap();
    assert_eq!((r.title.as_str(), r.facts.duration, r.facts.width), ("intro", Some(2.5), Some(640)));
    assert!(!ids.iter().any(|(i, _)| i.contains("someone-else")));

    // grouped by kind in the grid's order
    let kinds: Vec<Kind> = s.assets.iter().map(|a| match a.kind { Kind::TakeVersion => Kind::Take, k => k }).collect();
    assert!(kinds.windows(2).all(|w| w[0] <= w[1]), "{kinds:?}");
}

#[test]
fn paths_find_their_asset() {
    let t = tempfile::tempdir().unwrap();
    let d = fixture(t.path());
    let s = assets::scan(&d, &Options::default()).unwrap();
    // an activity event names files: each finds the asset it belongs to
    assert_eq!(s.find("audio/song.lyrics.json").map(|a| a.id.as_str()), Some("audio.json#music/song"));
    assert_eq!(s.find("audio/sfx/pop.wav").map(|a| a.id.as_str()), Some("audio.json#sfx/pop"));
    assert_eq!(s.find(&d.join("assets/freezes/manager-loans.png").to_string_lossy()).map(|a| a.id.as_str()), Some("assets/freezes/manager-loans.png"));
    assert_eq!(s.find("takes/home/").map(|a| a.id.as_str()), Some("takes/home"));
    assert_eq!(s.find("storyboard/walk/manager-overview.boxes.json").map(|a| a.id.as_str()), Some("storyboard/walk/manager-overview.png"));
    assert!(s.find("nothing/here.png").is_none());
}

#[test]
fn a_take_plays_from_its_events() {
    let t = tempfile::tempdir().unwrap();
    let d = fixture(t.path());
    let f = assets::preview::take_frames(&d.join("takes/.versions/home/v0"));
    assert_eq!(f.len(), 3);
    assert_eq!(f[2].0, 200.0);
    assert!(f[2].1.ends_with("frames/f000003.jpg"));
}

#[test]
fn a_still_sheet_draws_its_boxes() {
    let t = tempfile::tempdir().unwrap();
    let d = fixture(t.path());
    let out = t.path().join("sheet.png");
    let still = d.join("storyboard/walk/manager-overview.png");
    assets::preview::still_sheet(&still, Some(&still.with_extension("boxes.json")), &out).unwrap();
    let im = image::open(&out).unwrap().to_rgb8();
    assert_eq!(im.dimensions(), (64, 36));
    // the box's left edge (x = 2) is drawn in its colour; the middle of the still is untouched
    let edge = im.get_pixel(2, 8);
    assert!(edge[0] > 200 && edge[1] < 120, "{edge:?}");
    assert_eq!(im.get_pixel(50, 30).0, [200, 200, 200]);
}

#[test]
fn scans_the_samples_fast() {
    for name in ["hello-flex", "circles-overview"] {
        let d = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples").join(name);
        if !d.join("project.ts").exists() { continue; }
        let s = assets::scan(&d, &Options::default()).unwrap();
        let s2 = assets::scan(&d, &Options::default()).unwrap(); // warm: what a rescan costs
        assert!(s2.ms < 200.0, "{name}: {:.0} ms", s2.ms);
        assert_eq!(s.assets.len(), s2.assets.len());
        if name == "circles-overview" {
            assert!(s.assets.iter().any(|a| a.kind == Kind::Take));
            assert!(s.assets.iter().any(|a| a.kind == Kind::Music && a.facts.words.is_some()));
        }
    }
}

#[test]
fn a_flat_picture_is_blank() {
    let t = tempfile::tempdir().unwrap();
    let flat = t.path().join("flat.png");
    png(&flat, 64, 36);
    assert!(assets::preview::is_blank(&flat));
    let mut im = image::RgbImage::from_pixel(64, 36, image::Rgb([0, 0, 0]));
    im.put_pixel(30, 20, image::Rgb([255, 255, 255]));
    for x in 20..40 { im.put_pixel(x, 18, image::Rgb([255, 255, 255])); }
    let drawn = t.path().join("drawn.png");
    im.save(&drawn).unwrap();
    assert!(!assets::preview::is_blank(&drawn));
}

#[test]
fn lists_the_storyboards_sketches() {
    let t = tempfile::tempdir().unwrap();
    let d = t.path().join("film");
    write(&d.join("project.ts"), "export default {};\n");
    write(&d.join("storyboard/sketches/01-open.svg"), r##"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#c6f432"/></svg>"##);
    png(&d.join("storyboard/sketches/02-app.png"), 32, 18);
    png(&d.join("boards/elsewhere.png"), 32, 18);
    png(&d.join("storyboard/walk/home.png"), 32, 18);
    write(&d.join("script.json"), r#"{ "beats": [
        { "id": "open", "title": "Open", "at": "1s", "panels": [{ "sketch": "storyboard/sketches/01-open.svg" }, { "sketch": "boards/elsewhere.png" }] },
        { "id": "app", "title": "Into the app", "at": "3s", "panels": [{ "sketch": "storyboard/sketches/01-open.svg" }] } ] }"#);
    let s = assets::scan(&d, &Options::default()).unwrap();
    let sk: Vec<&assets::Asset> = s.assets.iter().filter(|a| a.kind == Kind::Sketch).collect();
    let ids: Vec<&str> = sk.iter().map(|a| a.id.as_str()).collect();
    assert!(ids.contains(&"storyboard/sketches/01-open.svg") && ids.contains(&"storyboard/sketches/02-app.png") && ids.contains(&"boards/elsewhere.png"), "{ids:?}");
    let open = sk.iter().find(|a| a.id.ends_with("01-open.svg")).unwrap();
    assert_eq!(open.note.as_deref(), Some("in Open, Into the app"));
    assert_eq!(sk.iter().find(|a| a.id.ends_with("02-app.png")).unwrap().note.as_deref(), Some("in no beat"));
    // a walk screenshot stays a still
    assert!(s.assets.iter().any(|a| a.id == "storyboard/walk/home.png" && a.kind == Kind::Still));
    // an SVG sketch's tile is drawn
    let th = flex_core::assets::preview::thumbnail(&d, open, 160).unwrap().unwrap();
    assert_eq!(th.extension().unwrap(), "png");
    assert_eq!(image::image_dimensions(&th).unwrap().0, 160);
}
