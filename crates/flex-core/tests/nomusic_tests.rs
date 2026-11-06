//! A film without music, through the real pipeline (its own test binary: it sets FLEX_SUPPORT for the process).
use flex_core::project::{find_pipeline, Project, ProjectError};
use std::fs;
use std::path::Path;

fn hello() -> std::path::PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples/hello-flex") }

/// A film without music (`flex new <dir>` with no --music): no `music:` in project.ts, no music in audio.json, no track or
/// stems; it opens and plans through the real pipeline (pipeline-patches/26-music-optional.patch), the server says it has
/// no music, there is no grid, and the narration check still answers (film seconds only).
#[test]
fn a_film_without_music() {
    let Ok(pipe) = find_pipeline(&hello()) else { eprintln!("skip: no pipeline"); return };
    if !pipe.join("node_modules").exists() { eprintln!("skip: pipeline not installed"); return; }
    let support = tempfile::tempdir().unwrap();
    std::env::set_var("FLEX_SUPPORT", support.path());
    let d = tempfile::tempdir().unwrap();
    let dir = d.path().join("quiet");
    let c = flex_core::new::create(&dir, None, None, None, None).unwrap();
    assert_eq!(c.music_key, None);
    assert!(c.stems.is_none());
    assert!(!c.files.iter().any(|f| f.starts_with("audio/")), "no track: {:?}", c.files);
    let ts = fs::read_to_string(dir.join("project.ts")).unwrap();
    assert!(!ts.lines().any(|l| l.trim_start().starts_with("music:") || l.trim_start().starts_with("snap:")), "no music: or snap: field\n{ts}");
    let audio: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.join("audio.json")).unwrap()).unwrap();
    assert!(audio.get("music").is_none() && audio.get("stems").is_none(), "{audio}");
    assert!(matches!(flex_core::new::create(&dir, None, None, None, None), Err(ProjectError::Invalid(_))), "an existing project stays");

    let p = Project::open(&dir).unwrap();
    assert!(p.music.is_none());
    assert!(p.music_file.is_none());
    assert_eq!(p.duration, 8.0);
    assert!(matches!(flex_core::filmgrid::FilmGrid::load(&p.dir, &p.music, p.duration), Err(ProjectError::NoMusic)));

    let srv = flex_core::Server::start(&p.dir).unwrap();
    assert!(srv.manifest.music.is_none(), "the server says null: {:?}", srv.manifest.music);
    assert_eq!(srv.manifest.frames, 240);
    assert!(matches!(flex_core::cuts::check(&p.dir, &srv.manifest), Err(ProjectError::NoMusic)));
    assert!(flex_core::narration::check(&p.dir, &srv).unwrap().is_empty(), "no lines, and no error");
    let cues = srv.cues().unwrap();
    assert_eq!(cues["music"], serde_json::json!(false), "the plan has no music: {cues}");
    let credits = srv.credits().unwrap();
    assert!(credits["credits"].as_array().unwrap().iter().all(|l| !l.as_str().unwrap_or("").starts_with("Music:")), "{credits}");
}
