//! The film grid across a song switch: two tracks with different tempi, each stretch carrying its own song's beats.

use flex_core::filmgrid::FilmGrid;
use flex_core::project::Music;
use std::fs;

#[test]
fn a_two_track_edit_takes_each_sides_beats_from_its_own_song() {
    let d = std::env::temp_dir().join(format!("flex-filmgrid-two-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(d.join("audio")).unwrap();
    fs::write(d.join("audio.json"), r#"{ "music": { "a": { "file": "audio/a.mp3" }, "b": { "file": "audio/b.mp3" } } }"#).unwrap();
    // a: 100 bpm (beats every 0.6 s, bars every 2.4 s); b: 120 bpm (0.5 s, bars every 2 s) with its first bar at 0.25
    let a_beats: Vec<f64> = (0..40).map(|i| i as f64 * 0.6).collect();
    let b_beats: Vec<f64> = (0..60).map(|i| 0.25 + i as f64 * 0.5).collect();
    fs::write(d.join("audio/a.grid.json"), serde_json::json!({ "downbeats": a_beats.iter().step_by(4).collect::<Vec<_>>(), "beats": a_beats, "beat": 0.6, "bpm": 100, "phase": 0 }).to_string()).unwrap();
    fs::write(d.join("audio/b.grid.json"), serde_json::json!({ "downbeats": b_beats.iter().step_by(4).collect::<Vec<_>>(), "beats": b_beats, "beat": 0.5, "bpm": 120, "phase": 0 }).to_string()).unwrap();
    // a 0 → 4.8 (two bars), then b from its bar at 4.25 → 8.25 (two bars)
    let m = Music { key: "a".into(), segments: Some(vec![[0.0, 4.8], [4.25, 8.25]]), from: None, tracks: Some(vec!["a".into(), "b".into()]) };
    let g = FilmGrid::load(&d, &m, 8.8).unwrap();
    assert_eq!(g.tracks, vec!["a", "b"]);
    assert_eq!(g.bars, vec![0.0, 2.4, 4.8, 6.8]);
    // a's beats every 0.6 up to the join, then b's every 0.5
    assert_eq!(&g.beats[..8], &[0.0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2]);
    assert_eq!(&g.beats[8..], &[4.8, 5.3, 5.8, 6.3, 6.8, 7.3, 7.8, 8.3]);
    assert_eq!(g.track_at(1.0), Some("a"));
    assert_eq!(g.track_at(5.0), Some("b"));
    assert_eq!(g.to_film_in("b", 4.75), vec![5.3]);
    assert_eq!(g.at(7.3), "4.2");
    assert!(g.corrected);
    let _ = fs::remove_dir_all(&d);
}
