//! A film without music from the command line: `flex new <dir>` without --music, then every command that needs a track or
//! its beat grid says so in one line and exits 0. Runs through Flex's pipeline copy (skipped without it).
use std::path::{Path, PathBuf};
use std::process::Command;

fn pipeline_ready() -> bool { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../pipeline/node_modules/.bin/tsx").exists() }

struct Tmp(PathBuf);
impl Drop for Tmp { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

fn flex(support: &Path, args: &[&str]) -> (bool, String) {
    let o = Command::new(env!("CARGO_BIN_EXE_flex")).args(args).env("FLEX_SUPPORT", support).output().unwrap();
    (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
}

#[test]
fn a_film_without_music_from_the_command_line() {
    if !pipeline_ready() { eprintln!("skip: pipeline/ not installed (scripts/sync-pipeline.sh)"); return; }
    let tmp = Tmp(std::env::temp_dir().join(format!("flex-no-music-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&tmp.0);
    let (support, dir) = (tmp.0.join("support"), tmp.0.join("quiet"));
    let d = dir.to_str().unwrap();

    let (ok, out) = flex(&support, &["new", d]);
    assert!(ok, "{out}");
    assert!(out.contains("no music:"), "{out}");
    assert!(!dir.join("audio").exists(), "no track, no stems");
    let (ok, out) = flex(&support, &["new", &format!("{d}-2"), "--licence", "CC-BY"]);
    assert!(!ok && out.contains("--licence is the song's"), "a licence without a song: {out}");

    let (ok, out) = flex(&support, &["open", d]);
    assert!(ok && out.contains("no music"), "{out}");
    let (ok, out) = flex(&support, &["open", d, "--json"]);
    assert!(ok && out.contains("\"music\": null"), "{out}");

    // the commands that need a track: one line, exit 0
    for args in [vec!["music", d], vec!["music", d, "--joins"], vec!["music", d, "--at", "3.2"], vec!["grid", d], vec!["cuts", d],
                 vec!["cuts", d, "--suggest"], vec!["shift", d, "--at", "2s", "--by", "1s"], vec!["duck", d]] {
        let (ok, out) = flex(&support, &args);
        assert!(ok, "flex {args:?} exits 0: {out}");
        let lines: Vec<_> = out.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 1, "flex {args:?}: one line\n{out}");
        assert!(lines[0].starts_with("no music in this film: "), "flex {args:?}: {out}");
    }
    let (ok, out) = flex(&support, &["grid", d, "--json"]);
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap_or_else(|_| panic!("JSON: {out}"));
    assert!(ok && v["ok"] == true && v["music"].is_null(), "{out}");

    // what works without music: the narration (film seconds), the status, a frame, a bar.beat refused clearly
    let (ok, out) = flex(&support, &["narration", d]);
    assert!(ok && out.contains("no music in this film: words in film seconds"), "{out}");
    let (ok, out) = flex(&support, &["status", d]);
    assert!(ok && out.contains("no music"), "{out}");
    let png = tmp.0.join("f.png");
    let (ok, out) = flex(&support, &["frame", d, "4s", "-o", png.to_str().unwrap()]);
    assert!(ok && png.exists(), "{out}");
    let (ok, out) = flex(&support, &["mix", d, "--from", "2.1", "-o", tmp.0.join("m.wav").to_str().unwrap()]);
    assert!(!ok && out.contains("this film has no music, so no bar.beat"), "{out}");
}
