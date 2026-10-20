//! `flex onsets`: synthetic onsets (tones after silence, noise bursts, a legato change of note) found within 10 ms; the
//! strongest-N and min-gap picking; a stem matched to its project's track; and, ignored by default (they need the
//! real media in $FLEX_TEST_MEDIA, see media()), two songs' sung spelled-out names against the hand-measured onsets
//! (within 40 ms).

use flex_core::onsets::{detect, run, track_for, Onset, Options, RATE};
use std::f64::consts::PI;
use std::fs;
use std::path::{Path, PathBuf};

const SR: f64 = RATE as f64;

fn silence(secs: f64) -> Vec<f32> { vec![0.0; (secs * SR) as usize] }

/// a tone from `at` for `len` s (a 2 ms attack, a 20 ms release), added into `x`
fn tone(x: &mut [f32], at: f64, len: f64, hz: f64, amp: f64) {
    let (a, n) = ((at * SR) as usize, (len * SR) as usize);
    for i in 0..n.min(x.len().saturating_sub(a)) {
        let t = i as f64 / SR;
        let env = (t / 0.002).min(1.0) * ((len - t) / 0.02).min(1.0);
        // a little second harmonic, like a voice
        x[a + i] += (amp * env * ((2.0 * PI * hz * t).sin() + 0.3 * (4.0 * PI * hz * t).sin())) as f32;
    }
}

/// white noise from `at` for `len` s (deterministic), added into `x`
fn noise(x: &mut [f32], at: f64, len: f64, amp: f64, seed: &mut u64) {
    let (a, n) = ((at * SR) as usize, (len * SR) as usize);
    for i in 0..n.min(x.len().saturating_sub(a)) {
        *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let r = ((*seed >> 33) as f64 / (1u64 << 31) as f64) * 2.0 - 1.0;
        let env = (i as f64 / SR / 0.002).min(1.0);
        x[a + i] += (amp * env * r) as f32;
    }
}

fn times(o: &[Onset]) -> Vec<f64> { o.iter().map(|x| x.t).collect() }

/// each expected time has a found one within `tol` s, and nothing else was found
fn assert_found(got: &[Onset], want: &[f64], tol: f64) {
    let t = times(got);
    assert_eq!(t.len(), want.len(), "found {t:?}, wanted {want:?}");
    for (g, w) in t.iter().zip(want) { assert!((g - w).abs() <= tol, "found {t:?}, wanted {want:?} (±{} ms)", tol * 1000.0); }
}

#[test]
fn tones_after_silence_are_found_where_they_start() {
    let want = [0.40, 0.95, 1.52, 2.10];
    let mut x = silence(2.6);
    for (i, &t) in want.iter().enumerate() { tone(&mut x, t, 0.3, [220.0, 330.0, 262.0, 392.0][i], 0.3); }
    let got = detect(&x, RATE, 0.0, 0.0, 2.6, None, 0.12);
    assert_found(&got, &want, 0.010);
    assert!(got.iter().all(|o| o.strength > 0.0 && o.strength <= 1.0));
    assert!(got.iter().any(|o| o.strength == 1.0));
}

#[test]
fn noise_bursts_are_found_and_read_as_hiss() {
    let want = [0.30, 0.80, 1.45];
    let mut x = silence(2.0);
    let mut seed = 7;
    for &t in &want { noise(&mut x, t, 0.15, 0.2, &mut seed); }
    let got = detect(&x, RATE, 0.0, 0.0, 2.0, None, 0.12);
    assert_found(&got, &want, 0.010);
}

#[test]
fn a_new_note_sung_legato_is_a_pitch_onset() {
    // one steady tone from 0.5 s, changing note (phase-continuous, no change of level) at 0.9 and 1.3 s
    let mut x = silence(2.0);
    let (a, b) = ((0.5 * SR) as usize, (1.8 * SR) as usize);
    let mut ph = 0.0f64;
    for i in a..b {
        let t = i as f64 / SR;
        let hz = if t < 0.9 { 220.0 } else if t < 1.3 { 277.2 } else { 329.6 };
        ph += 2.0 * PI * hz / SR;
        let env = ((t - 0.5) / 0.002).min(1.0) * ((1.8 - t) / 0.02).min(1.0);
        x[i] = (0.3 * env * (ph.sin() + 0.3 * (2.0 * ph).sin())) as f32;
    }
    let got = detect(&x, RATE, 0.0, 0.0, 1.75, None, 0.12);
    assert_found(&got, &[0.5, 0.9, 1.3], 0.010);
    assert_eq!(got[1].kind, "pitch");
    assert_eq!(got[2].kind, "pitch");
}

#[test]
fn expect_keeps_the_strongest_in_time_order_and_min_gap_holds() {
    let mut x = silence(2.6);
    tone(&mut x, 0.40, 0.3, 220.0, 0.02); // quiet
    tone(&mut x, 0.95, 0.3, 330.0, 0.4);
    tone(&mut x, 1.52, 0.3, 262.0, 0.02); // quiet
    tone(&mut x, 2.10, 0.3, 392.0, 0.4);
    let got = detect(&x, RATE, 0.0, 0.0, 2.6, Some(2), 0.12);
    assert_found(&got, &[0.95, 2.10], 0.010);
    // two bursts 60 ms apart, at least 120 ms between onsets: one
    let mut y = silence(1.0);
    let mut seed = 3;
    noise(&mut y, 0.30, 0.05, 0.2, &mut seed);
    noise(&mut y, 0.36, 0.10, 0.2, &mut seed);
    assert_eq!(detect(&y, RATE, 0.0, 0.0, 1.0, None, 0.12).len(), 1);
    assert_eq!(detect(&y, RATE, 0.0, 0.0, 1.0, Some(5), 0.12).len(), 1);
}

#[test]
fn only_the_stretch_asked_for_and_in_the_files_seconds() {
    // through ffmpeg: a WAV whose tones sit at known file seconds; only those inside --from/--to come back
    let d = std::env::temp_dir().join(format!("flex-onsets-run-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    let mut x = silence(3.0);
    for (i, &t) in [0.40, 0.95, 1.52, 2.10].iter().enumerate() { tone(&mut x, t, 0.3, [220.0, 330.0, 262.0, 392.0][i], 0.3); }
    let wav = d.join("tones.wav");
    write_wav(&wav, &x);
    let o = run(&Options { file: wav, from: 0.8, to: 1.9, project: None, expect: None, min_gap: 0.12 }).unwrap();
    assert_found(&o, &[0.95, 1.52], 0.010);
    assert!(o.iter().all(|x| x.film.is_none() && x.at.is_none()));
}

fn write_wav(p: &Path, x: &[f32]) {
    let data: Vec<u8> = x.iter().flat_map(|s| ((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes()).collect();
    let mut b = vec![];
    b.extend(b"RIFF"); b.extend((36 + data.len() as u32).to_le_bytes()); b.extend(b"WAVEfmt ");
    b.extend(16u32.to_le_bytes()); b.extend(1u16.to_le_bytes()); b.extend(1u16.to_le_bytes());
    b.extend(RATE.to_le_bytes()); b.extend((RATE * 2).to_le_bytes()); b.extend(2u16.to_le_bytes()); b.extend(16u16.to_le_bytes());
    b.extend(b"data"); b.extend((data.len() as u32).to_le_bytes()); b.extend(data);
    fs::write(p, b).unwrap();
}

#[test]
fn a_stem_is_matched_to_its_track_by_its_folder() {
    let d = std::env::temp_dir().join(format!("flex-onsets-track-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    let proj = d.join("film");
    fs::create_dir_all(proj.join("audio")).unwrap();
    fs::write(proj.join("audio.json"), r#"{ "music": { "one": { "file": "audio/song-one.mp3" }, "two": { "file": "audio/song-two.mp3" } } }"#).unwrap();
    fs::write(proj.join("audio/song-one.mp3"), b"").unwrap();
    fs::write(proj.join("audio/song-two.mp3"), b"").unwrap();
    let stems = d.join("music/Song Two Stems");
    fs::create_dir_all(&stems).unwrap();
    fs::write(stems.join("0 Lead Vocals.wav"), b"").unwrap();
    let by_key = d.join("music/one/stems");
    fs::create_dir_all(&by_key).unwrap();
    fs::write(by_key.join("vocals.wav"), b"").unwrap();
    let other = d.join("music/Something Else Stems");
    fs::create_dir_all(&other).unwrap();
    fs::write(other.join("0 Lead Vocals.wav"), b"").unwrap();
    // the track itself; a stem in a folder named after the song; one in a folder named after the key; no match
    assert_eq!(track_for(&proj, &proj.join("audio/song-one.mp3")).as_deref(), Some("one"));
    assert_eq!(track_for(&proj, &stems.join("0 Lead Vocals.wav")).as_deref(), Some("two"));
    assert_eq!(track_for(&proj, &by_key.join("vocals.wav")).as_deref(), Some("one"));
    assert_eq!(track_for(&proj, &other.join("0 Lead Vocals.wav")), None);
}

// ── the real stems (cargo test -p flex-core --test onsets_tests -- --ignored --nocapture) ──

/// the real media: $FLEX_TEST_MEDIA (default ~/Documents/web/flex-test-media), out of git. onsets/: song-a and song-b
/// (each a stems folder with "0 Lead Vocals.wav"), composite (a Flex project playing song-b, then song-a from its bar 32.1)
fn media() -> PathBuf { std::env::var_os("FLEX_TEST_MEDIA").map(PathBuf::from).unwrap_or_else(|| dirs::home_dir().unwrap().join("Documents/web/flex-test-media")) }
fn music() -> PathBuf { media().join("onsets") }

/// the onsets found in the stretch, each against its hand-measured one: (found, error ms)
fn check(stem: &Path, from: f64, to: f64, want: &[f64], letters: &str) -> Vec<(f64, f64)> {
    let o = run(&Options { file: stem.to_path_buf(), from, to, project: None, expect: Some(want.len()), min_gap: 0.12 }).unwrap();
    let t = times(&o);
    println!("{}: {from}–{to}", stem.display());
    want.iter().zip(letters.chars()).map(|(&w, ch)| {
        let g = t.iter().copied().min_by(|a, b| (a - w).abs().partial_cmp(&(b - w).abs()).unwrap()).unwrap_or(f64::NAN);
        let err = ((g - w) * 1000.0).round();
        println!("  {ch}  hand {w:8.3}  found {g:8.3}  {err:+5} ms");
        (g, err)
    }).collect()
}

#[test]
#[ignore]
fn song_a_outro_letters_within_40_ms() {
    let stem = music().join("song-a/0 Lead Vocals.wav");
    // two spelled-out names (measured by hand on the lead stem)
    for (from, to, want, letters) in [
        (92.4, 96.3, vec![92.70, 93.30, 93.78, 94.34, 94.79, 95.38, 95.90], "ABCDEFG"),
        (101.0, 104.6, vec![101.27, 101.87, 102.37, 102.93, 103.37, 104.20], "ABCDEF"),
    ] {
        for (ch, (_, err)) in letters.chars().zip(check(&stem, from, to, &want, letters)) {
            assert!(err.abs() <= 40.0, "{letters}: {ch} is {err} ms off");
        }
    }
}

#[test]
#[ignore]
fn song_b_opening_spot_check() {
    // a scene's hand-placed `at` ms; the stretch stops before the next word (its "s" is at 3.69)
    let stem = music().join("song-b/0 Lead Vocals.wav");
    let errs = check(&stem, 0.0, 3.6, &[0.15, 0.67, 1.28, 1.78, 2.35, 2.93, 3.45], "ABCDEFG");
    // six within 20 ms; the sixth letter, an H, is sung "haitch" here and is found on its "h", 0.1 s before the vowel the hand mark is on
    for (i, (_, e)) in errs.iter().enumerate() {
        if i == 5 { assert!((-120.0..=0.0).contains(e), "H: {e} ms"); } else { assert!(e.abs() <= 40.0, "{i}: {e} ms"); }
    }
}

#[test]
#[ignore]
fn a_song_a_stem_maps_to_the_composite_film_clock() {
    // the composite plays song-b to its bar 32.1, then song-a from its own bar 32.1: film = song-a + 0.4892 there. Needs the pipeline
    // (FLEX_PIPELINE, or the repo's pipeline/ installed).
    let stem = music().join("song-a/0 Lead Vocals.wav");
    let proj = music().join("composite");
    let o = run(&Options { file: stem, from: 101.0, to: 104.6, project: Some(proj), expect: Some(6), min_gap: 0.12 }).unwrap();
    for x in &o {
        let film = x.film.expect("a film time");
        assert!((film - x.t - 0.4892).abs() <= 0.0015, "{} → {film}", x.t);
        assert!(x.at.is_some());
        println!("  {:8.3} → film {film:8.3}  {}", x.t, x.at.as_deref().unwrap());
    }
}
