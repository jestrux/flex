//! `flex new <dir> --music <file>`: start a film project that opens, plays and renders at once. It has:
//! - project.ts on a look;
//! - the track, copied in and registered in audio.json;
//! - one placeholder title scene over the song's first 8 s;
//! - package.json / tsconfig.json;
//! - an empty journeys/ folder;
//! - a .gitignore for takes/ and .flex/ (the activity trail).
//! Everything after that (the look, the cut, the cards, the journeys) is the film's own work.

use crate::project::ProjectError;
use std::path::{Path, PathBuf};

/// Where the pipeline's source checkout is (pipeline/SOURCE), so the project's imports also work there.
fn pipeline_source() -> PathBuf {
    crate::project::bundled_pipeline().ok()
        .and_then(|p| std::fs::read_to_string(p.join("SOURCE")).ok())
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("source: ").map(|x| x.trim().to_string())))
        // written ~-relative (scripts/sync-pipeline.sh)
        .map(|x| match x.strip_prefix("~/") { Some(rest) => dirs::home_dir().unwrap_or_default().join(rest), None => PathBuf::from(x) })
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Documents/web/fancy-e2e-videos"))
}

/// `to` relative to `from` (both absolute), e.g. "../../../fancy-e2e-videos"
fn relative(from: &Path, to: &Path) -> String {
    let a: Vec<_> = from.components().collect();
    let b: Vec<_> = to.components().collect();
    let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), a.len() - common).collect();
    parts.extend(b[common..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()));
    parts.join("/")
}

fn slug(s: &str) -> String {
    let s: String = s.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    s.split('-').filter(|x| !x.is_empty()).collect::<Vec<_>>().join("-")
}

/// `stems`: where the stems came from (a folder or a zip next to the song), if any
pub struct Created { pub dir: PathBuf, pub name: String, pub music_key: String, pub files: Vec<String>, pub stems: Option<PathBuf> }

pub fn create(dir: &Path, name: Option<&str>, music: &Path, feel: Option<&str>, licence: Option<&str>) -> Result<Created, ProjectError> {
    let feel_given = feel.is_some();
    let feel = feel.unwrap_or("clean");
    if dir.join("project.ts").exists() { return Err(ProjectError::Invalid(format!("{} already has a project.ts", dir.display()))); }
    if !music.is_file() { return Err(ProjectError::Invalid(format!("no music file at {}", music.display()))); }
    std::fs::create_dir_all(dir)?;
    let dir = std::fs::canonicalize(dir)?;
    let name = name.map(String::from).unwrap_or_else(|| slug(&dir.file_name().unwrap_or_default().to_string_lossy()));
    let up = relative(&dir, &pipeline_source());
    let up_scenes = relative(&dir.join("scenes"), &pipeline_source());
    let ext = music.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "mp3".into());
    let track = format!("{}.{ext}", slug(&music.file_stem().unwrap_or_default().to_string_lossy()));
    let key = format!("{name}-music");
    let mut files = vec![];
    let mut put = |rel: &str, body: String| -> Result<(), ProjectError> {
        let p = dir.join(rel);
        if let Some(d) = p.parent() { std::fs::create_dir_all(d)?; }
        std::fs::write(&p, body)?;
        files.push(rel.to_string());
        Ok(())
    };
    let feel_note = if feel == "clean" && !feel_given { "a placeholder: the look is the film's call (a built-in feel: clean, modern, professional; or a project look, look.ts)".to_string() } else { "a built-in feel (clean, modern, professional), or a project look (look.ts)".to_string() };
    put("project.ts", format!(r#"// {name}: made with Flex (flex new). The film: scenes in order over the song, each a slice of the track in song seconds.
import {{ defineProject }} from "{up}/lib/project.ts";
import opening from "./scenes/01-opening.ts";

export default defineProject({{
  name: "{name}",
  feel: "{feel}", // {feel_note}
  music: {{ key: "{key}" }}, // audio.json
  snap: "off",
  scenes: [opening],
}});
"#))?;
    put("scenes/01-opening.ts", format!(r#"// A placeholder so the project opens and plays at once: a title over the song's first 8 s. Replace it.
import {{ scene }} from "{up_scenes}/lib/project.ts";

export default scene({{
  id: "opening",
  start: 0,
  end: 8,
  items: [{{ kind: "title", type: "title-opening", params: {{ title: "{name}", kicker: "Draft" }}, dur: 8000 }}],
}});
"#))?;
    put("audio.json", serde_json::to_string_pretty(&serde_json::json!({
        "_doc": "This project's audio: music tracks (key → file, relative to this folder), stems for analysis (not played), sound effects. Keys are unique across projects. A track's beat grid sits next to it (flex music).",
        "music": { &key: { "file": format!("audio/{track}"), "source": music.display().to_string(),
            "licence": licence.unwrap_or("not recorded: set it (owned, CC-BY with its attribution, …); the credits print it") } },
        "stems": "audio/stems/",
        "sfx": {}
    })).unwrap() + "\n")?;
    put("package.json", format!("{{\n  \"private\": true,\n  \"type\": \"module\",\n  \"description\": \"{name}: a film project (Flex)\"\n}}\n"))?;
    put("tsconfig.json", format!("{{\n  \"extends\": \"{up}/tsconfig.json\",\n  \"compilerOptions\": {{ \"types\": [\"node\"], \"typeRoots\": [\"{up}/node_modules/@types\"] }},\n  \"include\": [\"./**/*.ts\"],\n  \"exclude\": []\n}}\n"))?;
    put(".gitignore", "takes/\n.flex/\n".into())?;
    std::fs::create_dir_all(dir.join("journeys"))?;
    std::fs::create_dir_all(dir.join("audio"))?;
    std::fs::copy(music, dir.join("audio").join(&track))?;
    files.push(format!("audio/{track}"));
    // stems beside the track, copied for analysis
    let stems = stems_beside(music);
    if let Some(src) = &stems {
        let unpacked = if src.is_dir() { None } else { Some(unzip(src)?) };
        let from = unpacked.as_deref().unwrap_or(src);
        std::fs::create_dir_all(dir.join("audio/stems"))?;
        let mut audio = vec![];
        audio_files(from, &mut audio);
        audio.sort();
        for p in audio {
            let f = p.file_name().unwrap_or_default();
            std::fs::copy(&p, dir.join("audio/stems").join(f))?;
            files.push(format!("audio/stems/{}", f.to_string_lossy()));
        }
        if let Some(t) = unpacked { let _ = std::fs::remove_dir_all(t); }
    }
    Ok(Created { dir, name, music_key: key, files, stems })
}

/// The song's stems next to it: a `stems/` folder (Flex's library), else a folder or zip named after the song, as Suno
/// exports them ("I Am Because We Are.mp3" → "I Am Because We Are Stems/" or "… Stems.zip"), compared on letters and
/// digits only, a re-download's " (1)" ignored. A folder wins over a zip.
pub fn stems_beside(music: &Path) -> Option<PathBuf> {
    let parent = music.parent()?;
    let plain = parent.join("stems");
    if plain.is_dir() { return Some(plain); }
    let norm = |s: &str| -> String { s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect() };
    let stem = music.file_stem()?.to_string_lossy().to_string();
    // "Song (1)" → "Song"
    let base = match stem.trim_end().strip_suffix(')').and_then(|s| s.rsplit_once(" (")) {
        Some((b, n)) if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) => b.to_string(),
        _ => stem,
    };
    let song = norm(&base);
    let named = |p: &Path| p.file_stem().is_some_and(|s| norm(&s.to_string_lossy()).strip_suffix("stems") == Some(song.as_str()));
    let mut hits: Vec<PathBuf> = std::fs::read_dir(parent).ok()?.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| named(p)).collect();
    hits.sort();
    hits.iter().find(|p| p.is_dir())
        .or_else(|| hits.iter().find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("zip"))))
        .cloned()
}

fn is_audio(p: &Path) -> bool {
    p.extension().is_some_and(|x| ["wav", "mp3", "flac", "m4a", "aiff"].contains(&x.to_string_lossy().to_lowercase().as_str()))
}

/// The audio files in `d` and the folders under it (a zip may wrap them in one), skipping macOS's `__MACOSX`.
fn audio_files(d: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(d) else { return };
    for p in rd.filter_map(|e| e.ok().map(|e| e.path())) {
        let name = p.file_name().unwrap_or_default().to_string_lossy();
        if name.starts_with('.') || name == "__MACOSX" { continue; }
        if p.is_dir() { audio_files(&p, out) } else if is_audio(&p) { out.push(p) }
    }
}

fn unzip(zip: &Path) -> Result<PathBuf, ProjectError> {
    let tmp = std::env::temp_dir().join(format!("flex-stems-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;
    let st = std::process::Command::new("ditto").args(["-x", "-k"]).arg(zip).arg(&tmp).status()?;
    if !st.success() { let _ = std::fs::remove_dir_all(&tmp); return Err(ProjectError::Run(format!("couldn't unpack {}", zip.display()))); }
    Ok(tmp)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(p: &Path) { std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(p, b"x").unwrap(); }

    #[test]
    fn finds_stems_the_way_they_are_exported() {
        let d = std::env::temp_dir().join(format!("flex-stems-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        touch(&d.join("I Am Because We Are.mp3"));
        touch(&d.join("I Am Because We Are (1).mp3"));
        touch(&d.join("I Am Because We Are Stems/0 Lead Vocals.wav"));
        touch(&d.join("I Am Because We Are Stems.zip"));
        touch(&d.join("Clock It.mp3"));
        touch(&d.join("Clock It Stems.zip"));
        touch(&d.join("Other.mp3"));
        let at = |s: &str| stems_beside(&d.join(s)).map(|p| p.file_name().unwrap().to_string_lossy().to_string());
        assert_eq!(at("I Am Because We Are.mp3").as_deref(), Some("I Am Because We Are Stems"), "the folder over the zip");
        assert_eq!(at("I Am Because We Are (1).mp3").as_deref(), Some("I Am Because We Are Stems"), "a re-download's (1)");
        assert_eq!(at("Clock It.mp3").as_deref(), Some("Clock It Stems.zip"), "only the zip");
        assert_eq!(at("Other.mp3"), None);
        touch(&d.join("stems/drums.wav"));
        assert_eq!(at("Other.mp3").as_deref(), Some("stems"), "a plain stems/ first (the library's)");
        let _ = std::fs::remove_dir_all(&d);
    }
}
