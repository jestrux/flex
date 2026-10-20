//! Flex's song library: the manifest is whole (unique keys, a grid and a release file per song), the list and grids
//! land in $FLEX_LIBRARY as the pipeline reads them, and a download takes its name only when its size and checksum
//! match (served from a file:// URL, so no network).

use flex_core::library::{self, Remote};
use std::collections::HashSet;
use std::fs;
use std::process::Command;

#[test]
fn every_song_is_whole() {
    let songs = library::songs();
    assert!(songs.len() >= 20, "{} songs", songs.len());
    let mut keys = HashSet::new();
    for s in &songs {
        assert!(keys.insert(s.key.clone()), "{} twice", s.key);
        assert!(s.key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "key {}", s.key);
        assert!(s.url.ends_with(&format!("/library-v1/{}.mp3", s.key)), "{}", s.url);
        assert!(s.size > 100_000 && s.sha256.len() == 64, "{}", s.key);
        let st = s.stems.as_ref().expect("stems");
        assert!(st.url.ends_with(&format!("/library-v1/{}-stems.zip", s.key)) && st.sha256.len() == 64, "{}", s.key);
        assert!(s.bpm > 60. && s.bpm < 200. && s.duration > 30., "{}", s.key);
        assert!(["vocals", "chant", "instrumental"].contains(&s.vocals.as_str()), "{}: {}", s.key, s.vocals);
        assert!(!s.licence.is_empty() && !s.source.is_empty(), "{}", s.key);
    }
}

#[test]
fn the_catalogue_and_downloads() {
    let d = tempfile::tempdir().unwrap();
    std::env::set_var("FLEX_LIBRARY", d.path());

    // the list, as the pipeline's library entries, and a grid beside every song's (not yet downloaded) mp3
    assert_eq!(library::catalogue().unwrap(), d.path());
    let lib: serde_json::Value = serde_json::from_str(&fs::read_to_string(d.path().join("library.json")).unwrap()).unwrap();
    for s in library::songs() {
        assert_eq!(lib["music"][&s.key]["file"], format!("{0}/{0}.mp3", s.key));
        let g: serde_json::Value = serde_json::from_str(&fs::read_to_string(d.path().join(&s.key).join(format!("{}.grid.json", s.key))).unwrap()).unwrap();
        assert!((g["bpm"].as_f64().unwrap() - s.bpm).abs() < 0.01, "{}", s.key);
        assert!(!library::downloaded(&s) && !library::has_stems(&s.key));
    }
    // unchanged: not rewritten
    let t = fs::metadata(d.path().join("library.json")).unwrap().modified().unwrap();
    library::catalogue().unwrap();
    assert_eq!(fs::metadata(d.path().join("library.json")).unwrap().modified().unwrap(), t);

    // a download: right size and checksum → takes its name; wrong → an error and nothing left behind
    let src = d.path().join("src.bin");
    fs::write(&src, b"a song, for the test").unwrap();
    let sum = String::from_utf8(Command::new("shasum").args(["-a", "256"]).arg(&src).output().unwrap().stdout).unwrap();
    let sum = sum.split_whitespace().next().unwrap().to_string();
    let url = format!("file://{}", src.display());
    let dest = d.path().join("x/x.mp3");
    library::download(&Remote { url: url.clone(), size: 20, sha256: sum.clone() }, &dest).unwrap();
    assert_eq!(fs::read(&dest).unwrap(), b"a song, for the test");
    let bad = d.path().join("y/y.mp3");
    let e = library::download(&Remote { url: url.clone(), size: 20, sha256: "0".repeat(64) }, &bad).unwrap_err();
    assert!(e.to_string().contains("checksum"), "{e}");
    let e = library::download(&Remote { url, size: 21, sha256: sum }, &bad).unwrap_err();
    assert!(e.to_string().contains("expected 21"), "{e}");
    assert!(!bad.exists() && fs::read_dir(d.path().join("y")).unwrap().next().is_none(), "no partial file");
    let e = library::download(&Remote { url: format!("file://{}/missing", d.path().display()), size: 1, sha256: "0".repeat(64) }, &bad).unwrap_err();
    assert!(e.to_string().contains("couldn't download"), "{e}");

    // not a library song: nothing to fetch
    assert!(library::ensure("not-a-song").unwrap().is_none());
}

#[test]
fn a_film_on_a_library_song_has_its_grid_before_the_download() {
    use flex_core::{filmgrid::FilmGrid, Music};
    let d = tempfile::tempdir().unwrap(); // no audio.json
    let s = library::songs().into_iter().next().unwrap();
    let g = FilmGrid::load(d.path(), &Music { key: s.key.clone(), segments: None, from: Some(0.0), tracks: None }, 30.0).unwrap();
    assert!((g.bpm - s.bpm).abs() < 0.01 && !g.bars.is_empty() && !g.beats.is_empty(), "{}", s.key);
    assert!(FilmGrid::load(d.path(), &Music { key: "not-a-song".into(), segments: None, from: Some(0.0), tracks: None }, 30.0).is_err());
}
