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
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("source: ").map(|x| PathBuf::from(x.trim()))))
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

pub struct Created { pub dir: PathBuf, pub name: String, pub music_key: String, pub files: Vec<String> }

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
    // stems beside the track (a folder named stems/ next to it), copied for analysis
    if let Some(stems) = music.parent().map(|p| p.join("stems")).filter(|p| p.is_dir()) {
        std::fs::create_dir_all(dir.join("audio/stems"))?;
        for e in std::fs::read_dir(stems)?.filter_map(|e| e.ok()) {
            if e.path().extension().is_some_and(|x| x == "wav" || x == "mp3" || x == "flac") {
                std::fs::copy(e.path(), dir.join("audio/stems").join(e.file_name()))?;
                files.push(format!("audio/stems/{}", e.file_name().to_string_lossy()));
            }
        }
    }
    Ok(Created { dir, name, music_key: key, files })
}
