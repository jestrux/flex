use flex_core::project::{find_pipeline, Project, ProjectError};
use std::fs;
use std::path::Path;

fn sample() -> std::path::PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples/circles-overview") }

#[test]
fn not_a_project() {
    let d = tempfile::tempdir().unwrap();
    assert!(matches!(Project::open(d.path()), Err(ProjectError::NotAProject(_))));
}

/// Any project runs on Flex's own copy of the pipeline, whatever its project.ts imports (the import is redirected).
#[test]
fn uses_flexs_own_pipeline() {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join("project.ts"), r#"import { defineProject } from "../nowhere/fancy-e2e-videos/lib/project.ts";"#).unwrap();
    let Ok(p) = find_pipeline(d.path()) else { eprintln!("skip: no pipeline/ (scripts/sync-pipeline.sh)"); return };
    assert!(p.join("lib/project.ts").exists(), "Flex's pipeline copy has the pipeline's lib/");
    assert!(p.join("lib/sequence.ts").exists());
}

/// The sample, through the real pipeline (skipped when the sample or the checkout isn't there).
#[test]
fn opens_the_sample() {
    if !sample().join("project.ts").exists() { eprintln!("skip: no samples/circles-overview (scripts/copy-sample.sh)"); return; }
    let Ok(pipe) = find_pipeline(&sample()) else { eprintln!("skip: no pipeline/ (scripts/sync-pipeline.sh)"); return };
    if !pipe.join("node_modules").exists() { eprintln!("skip: pipeline/ not installed"); return; }
    let p = Project::open(&sample()).unwrap();
    assert_eq!(p.name, "circles-overview");
    let ids: Vec<_> = p.scenes.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, ["sting", "into-the-app", "ui-tour", "book", "home", "how-it-works", "pool-up", "reports", "outro"]);
    assert!(p.scenes.iter().all(|s| s.file.is_some()), "every scene maps to scenes/NN-<id>.ts");
    for w in p.scenes.windows(2) { assert!((w[0].end - w[1].start).abs() < 1e-3, "scenes tile the film"); }
    assert!(p.music_file.as_ref().is_some_and(|f| f.ends_with("audio/count-me-in-2.mp3")));
    assert!(p.duration > 60.0);
}

fn hello() -> std::path::PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples/hello-flex") }

/// The in-repo sample end to end: server, keys, a painted frame (skipped without a checkout).
#[test]
fn paints_hello_flex() {
    let Ok(pipe) = find_pipeline(&hello()) else { eprintln!("skip: no fancy-e2e-videos checkout"); return };
    if !pipe.join("node_modules").exists() { eprintln!("skip: fancy-e2e-videos not installed"); return; }
    let support = tempfile::tempdir().unwrap();
    std::env::set_var("FLEX_SUPPORT", support.path());
    let s = flex_core::Session::open(&hello()).unwrap();
    let m = s.manifest();
    assert_eq!(m.frames, 300);
    assert_eq!(m.scenes.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["opening", "chapter", "closing"]);
    assert!(s.errors.is_empty());
    // a held frame and its neighbour share nothing by accident: keys differ across scenes
    assert_ne!(s.key(10), s.key(150));
    match s.frame(60, 480).unwrap() {
        flex_core::FrameState::Cached(p) => assert!(p.exists()),
        other => panic!("frame 60: {other:?}"),
    }
    assert!(s.cached(60, 480).is_some(), "painted frames are found again by key");
}

/// Capture's pick (server/capture.mts): the film's take becomes v0, the new version is cloned in, and the pick's locked
/// camera plan comes along shifted piecewise, each time by the offset of the last mark at or before it; picking v0
/// again restores the plan's times.
#[test]
fn pick_carries_the_camera_plan() {
    let Ok(pipe) = find_pipeline(&hello()) else { eprintln!("skip: no pipeline"); return };
    if !pipe.join("node_modules").exists() { eprintln!("skip: pipeline not installed"); return; }
    let support = tempfile::tempdir().unwrap();
    std::env::set_var("FLEX_SUPPORT", support.path());
    let d = tempfile::tempdir().unwrap();
    let p = d.path();
    std::fs::write(p.join("project.ts"), "export default {};\n").unwrap();
    std::fs::write(p.join("capture.json"), "{}").unwrap();
    let take = |dir: &Path, marks: &[(u32, &str)]| {
        std::fs::create_dir_all(dir.join("frames")).unwrap();
        std::fs::write(dir.join("frames/f000001.jpg"), b"x").unwrap();
        let m: Vec<_> = marks.iter().map(|(t, l)| serde_json::json!({ "t": t, "label": l })).collect();
        std::fs::write(dir.join("events.json"), serde_json::json!({ "dpr": 3, "duration": 9000, "frames": [{ "t": 0, "file": "f000001.jpg" }],
            "clicks": [], "marks": m }).to_string()).unwrap();
    };
    take(&p.join("takes/t"), &[(1000, "beat-start"), (4000, "beat-click")]);
    std::fs::write(p.join("takes/t/edl.json"), serde_json::json!({ "locked": true,
        "segments": [{ "start": 1500, "end": 3000 }, { "start": 4200, "end": 6000 }], "effects": [{ "start": 900, "end": 4100 }] }).to_string()).unwrap();
    // the new capture: started 100 ms earlier, and the click landed 300 ms later than before
    take(&p.join("takes/.versions/t/v1"), &[(900, "beat-start"), (4300, "beat-click")]);
    std::fs::write(p.join("takes/.versions/t/v1/version.json"), r#"{"n":1,"at":"2026-10-16T00:00:00Z"}"#).unwrap();

    let r = flex_core::capture::run_json(p, "pick", &["t".into(), "v1".into()]).unwrap();
    assert_eq!(r["ok"], true, "{r}");
    let edl: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p.join("takes/t/edl.json")).unwrap()).unwrap();
    assert_eq!((edl["segments"][0]["start"].as_i64(), edl["segments"][0]["end"].as_i64()), (Some(1400), Some(2900)));
    assert_eq!((edl["segments"][1]["start"].as_i64(), edl["segments"][1]["end"].as_i64()), (Some(4500), Some(6300)));
    // before the first mark: shifted by the first mark's offset
    assert_eq!((edl["effects"][0]["start"].as_i64(), edl["effects"][0]["end"].as_i64()), (Some(800), Some(4400)));
    assert_eq!(std::fs::read_to_string(p.join("takes/t/.flex-version")).unwrap(), "1");
    assert!(p.join("takes/.versions/t/v0/events.json").exists(), "the take before Flex is kept as v0");

    let r = flex_core::capture::run_json(p, "pick", &["t".into(), "v0".into()]).unwrap();
    assert_eq!(r["ok"], true, "{r}");
    let edl: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p.join("takes/t/edl.json")).unwrap()).unwrap();
    assert_eq!(edl["segments"][1]["start"].as_i64(), Some(4200));
    assert_eq!(edl["effects"][0]["start"].as_i64(), Some(900));
}
