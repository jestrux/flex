//! The script (script.json) on a fixture project: a 4-bar grid at 100 bpm (a bar 2.4 s), a film 9.6 s long.

use flex_core::filmgrid::FilmGrid;
use flex_core::project::Music;
use flex_core::script::{self, Script};
use std::fs;
use std::path::{Path, PathBuf};

const DURATION: f64 = 9.6;

fn fixture(name: &str, script: serde_json::Value) -> PathBuf {
    let d = std::env::temp_dir().join(format!("flex-script-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(d.join("audio")).unwrap();
    fs::create_dir_all(d.join("storyboard/sketches")).unwrap();
    fs::write(d.join("audio.json"), r#"{ "music": { "m": { "file": "audio/track.mp3" } } }"#).unwrap();
    let beats: Vec<f64> = (0..16).map(|i| i as f64 * 0.6).collect();
    fs::write(d.join("audio/track.grid.json"), serde_json::json!({ "downbeats": [0.0, 2.4, 4.8, 7.2], "beats": beats, "beat": 0.6, "bpm": 100 }).to_string()).unwrap();
    fs::write(d.join("storyboard/sketches/a.svg"), r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>"#).unwrap();
    fs::write(d.join("script.json"), script.to_string()).unwrap();
    d
}

fn grid(d: &Path) -> FilmGrid {
    FilmGrid::load(d, &Music { key: "m".into(), segments: None, from: Some(0.0), tracks: None }, DURATION).unwrap()
}

fn load(d: &Path) -> Script { script::load(d, Some(&grid(d)), DURATION).unwrap().unwrap() }

#[test]
fn places_beats_on_the_film_grid_and_in_seconds() {
    let d = fixture("pos", serde_json::json!({ "beats": [
        { "id": "a", "at": "1.1" }, { "id": "b", "at": "2.3" }, { "id": "c", "at": "7.2s" } ] }));
    let s = load(&d);
    let starts: Vec<f64> = s.beats.iter().map(|b| b.start).collect();
    assert_eq!(starts, vec![0.0, 3.6, 7.2]);
    // a beat runs to the next; the last to the film's end
    assert_eq!(s.beats[0].end, 3.6);
    assert_eq!(s.beats[2].end, DURATION);
    assert_eq!(s.beats[1].at, "2.3");
    assert!(s.beats.iter().all(|b| !b.planned));
    assert_eq!(s.length, DURATION);
    assert!(s.notes.is_empty(), "{:?}", s.notes);
}

#[test]
fn plans_past_the_films_end_at_the_tracks_tempo() {
    // the grid stops at bar 4 (7.2 s); bar 6 is two bars on: 7.2 + 8 beats × 0.6 = 12.0
    let d = fixture("planned", serde_json::json!({ "beats": [
        { "id": "built", "at": "1.1", "status": "built" }, { "id": "next", "at": "6.1" }, { "id": "after", "at": "7.3" } ] }));
    let s = load(&d);
    let next = &s.beats[1];
    assert_eq!(next.start, 12.0);
    assert!(next.planned);
    assert_eq!(next.at, "6.1");
    assert_eq!(next.end, s.beats[2].start);
    let after = &s.beats[2];
    assert_eq!(after.start, 12.0 + 2.4 + 1.2);
    assert_eq!(after.at, "7.3");
    // the last planned beat runs a bar, and the plan is longer than the film
    assert!((after.end - (after.start + 2.4)).abs() < 1e-9);
    assert_eq!(s.length, after.end);
    assert_eq!(s.duration, DURATION);
    // the built beat runs on into the plan (to the next beat)
    assert_eq!(s.beats[0].end, 12.0);
    assert!(!s.beats[0].planned);
}

#[test]
fn spreads_panels_without_positions_over_their_beat() {
    let d = fixture("panels", serde_json::json!({ "beats": [
        { "id": "a", "at": "1.1", "to": "3.1", "panels": [
            { "sketch": "storyboard/sketches/a.svg", "caption": "one" }, { "sketch": "storyboard/sketches/a.svg" } ] },
        { "id": "b", "at": "3.1", "panels": [
            { "sketch": "storyboard/sketches/a.svg", "at": "3.3" }, { "sketch": "storyboard/sketches/a.svg" } ] } ] }));
    let s = load(&d);
    let a = &s.beats[0].panels;
    assert_eq!((a[0].start, a[0].end), (0.0, 2.4));
    assert_eq!((a[1].start, a[1].end), (2.4, 4.8));
    assert_eq!(a[0].caption.as_deref(), Some("one"));
    assert!(a[0].found);
    // with positions given: one from its position, one without from the beat's start
    let b = &s.beats[1].panels;
    assert_eq!((b[0].start, b[0].end), (6.0, DURATION));
    assert_eq!(b[1].start, 4.8);
}

#[test]
fn notes_what_it_can_measure() {
    let d = fixture("notes", serde_json::json!({ "beats": [
        { "id": "a", "at": "1.1", "to": "2.3",
          "narration": [{ "text": "inside", "at": "1.2" }, { "text": "outside", "at": "3.1" }],
          "panels": [{ "sketch": "storyboard/sketches/missing.svg" }] },
        { "id": "b", "at": "2.1", "to": "3.1" },
        { "id": "c", "at": "3.3" },
        { "id": "d", "at": "nowhere" } ] }));
    let s = load(&d);
    let has = |needle: &str| s.notes.iter().any(|n| n.contains(needle));
    assert!(has("no sketch at storyboard/sketches/missing.svg"), "{:?}", s.notes);
    assert!(has("the line \"outside\""), "{:?}", s.notes);
    assert!(!has("\"inside\""), "{:?}", s.notes);
    assert!(has("a and b overlap"), "{:?}", s.notes);
    assert!(has("a gap between b and c"), "{:?}", s.notes);
    assert!(has("d: \"nowhere\" isn't a film position"), "{:?}", s.notes);
    assert!(!s.beats[0].panels[0].found);
    assert_eq!(s.beats.len(), 3);
}

#[test]
fn without_a_grid_bars_cant_be_placed_but_seconds_can() {
    let d = fixture("nogrid", serde_json::json!({ "beats": [{ "id": "a", "at": "1.1" }, { "id": "b", "at": "2.5s" }] }));
    let s = script::load(&d, None, DURATION).unwrap().unwrap();
    assert_eq!(s.beats.len(), 1);
    assert_eq!(s.beats[0].start, 2.5);
    assert_eq!(s.beats[0].at, "2.50s");
    assert!(s.notes.iter().any(|n| n.contains("no film grid yet")), "{:?}", s.notes);
}

#[test]
fn no_script_is_none() {
    let d = fixture("none", serde_json::json!({}));
    fs::remove_file(d.join("script.json")).unwrap();
    assert!(script::load(&d, None, DURATION).unwrap().is_none());
}
