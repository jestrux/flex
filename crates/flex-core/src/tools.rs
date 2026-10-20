//! The pipeline's own tools (its `package.json` scripts: music analysis, check, stills, say, the final render …), run on a
//! project with Flex's environment, so neither an agent nor the author needs to know the env (docs/agent-guide.md):
//!   - `FLEX_PIPELINE`, `FLEX_VOICE_CACHE`, `FLEX_SUPPORT`, the import redirect;
//!   - `FLEX_PROJECTS`: a folder linking the project under the film's name (the pipeline finds looks, sounds and projects
//!     there);
//!   - `FLEX_TAKES`: the project's `takes/`;
//!   - `FLEX_WORK`: where the pipeline writes `build/` and `.cache/` (patch 06);
//!   - `FLEX_OUT`: where films land, `~/Downloads/flex-videos/<project name>/`.

use crate::project::{find_pipeline, login_path, redirect_script, support_dir, voice_cache, ProjectError};
use std::path::{Path, PathBuf};

const MUSIC_SCRIPT: &str = include_str!("../../../server/music.mts");
const CARD_SCRIPT: &str = include_str!("../../../server/card.mts");
const DUCK_SCRIPT: &str = include_str!("../../../server/duck.mts");

/// `flex duck`: the music's dip under each narration line (server/duck.mts, beside the server's timeline.mts)
pub fn duck(dir: &Path, args: &[String]) -> Result<Command, ProjectError> {
    crate::server::script()?; // timeline.mts and take-layers.mts, which duck.mts plans the film with
    flex_script(dir, "duck.mts", DUCK_SCRIPT, args)
}

/// `flex card`: one card alone, with the project's look (server/card.mts)
pub fn card(dir: &Path, args: &[String]) -> Result<Command, ProjectError> { flex_script(dir, "card.mts", CARD_SCRIPT, args) }

/// `flex music`: the track read for cutting to (server/music.mts)
pub fn music(dir: &Path, args: &[String]) -> Result<Command, ProjectError> {
    let mut c = flex_script(dir, "music.mts", MUSIC_SCRIPT, args)?;
    // Flex's one Whisper path (crate::transcribe); without mlx-whisper, flex music reads the track without the words
    if let Ok(py) = crate::transcribe::python() { c.env("FLEX_WHISPER_PY", py).env("FLEX_WHISPER", crate::transcribe::script()?); }
    Ok(c)
}
use std::process::Command;

/// the project's name from project.ts (`name: "…"`), else its folder's
pub fn project_name(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("project.ts")).ok()
        .and_then(|s| s.lines().find_map(|l| l.trim().strip_prefix("name:").map(|r| r.trim().trim_end_matches(',').trim_matches(|c| c == '"' || c == '\'').to_string())))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| dir.file_name().unwrap_or_default().to_string_lossy().into_owned())
}

/// The folder a project's films go to: `~/Downloads/flex-videos/<project name>/`.
pub fn out_dir(dir: &Path) -> PathBuf {
    dirs::download_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Downloads")).join("flex-videos").join(project_name(dir))
}

/// The name the pipeline knows the project by: the film's name (project.ts `name`, else the folder's), linked in a
/// projects folder of its own (stable per project path, so two projects with the same name don't collide). The film's
/// name, not the folder's: the pipeline names a project's own look after the project, and a film in a folder called
/// `overview` has a look called `circles-overview`.
pub(crate) fn projects_link(dir: &Path) -> Result<(PathBuf, String), ProjectError> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    dir.hash(&mut h);
    let base = support_dir().join("work").join("projects").join(format!("{:016x}", h.finish()));
    let name = project_name(dir);
    std::fs::create_dir_all(&base)?;
    let link = base.join(&name);
    // only this one link (a renamed film, or an older link named after the folder, would load the look twice)
    for e in std::fs::read_dir(&base)?.filter_map(|e| e.ok()) { if e.file_name().to_string_lossy() != name { let _ = std::fs::remove_file(e.path()); } }
    if std::fs::read_link(&link).ok().as_deref() != Some(dir) {
        let _ = std::fs::remove_file(&link);
        // two Flex processes can make the link at the same moment (the app's engine and its card list): the other one's is as good
        if let Err(e) = std::os::unix::fs::symlink(dir, &link) {
            if e.kind() != std::io::ErrorKind::AlreadyExists || std::fs::read_link(&link).ok().as_deref() != Some(dir) { return Err(e.into()); }
        }
    }
    Ok((base, name))
}

/// The pipeline's tools: `package.json` script name → its file under the pipeline (and any fixed leading args).
pub fn list(pipeline: &Path) -> Vec<(String, String)> {
    let Ok(raw) = std::fs::read_to_string(pipeline.join("package.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else { return vec![] };
    v["scripts"].as_object().map(|o| o.iter().filter_map(|(k, s)| Some((k.clone(), s.as_str()?.strip_prefix("tsx ")?.to_string()))).collect()).unwrap_or_default()
}

/// A pipeline tool on this project, ready to run. In `args`, `@` stands for the film's name (what check, stills and the
/// films are named after) and `@folder` for the name the pipeline finds the project folder by (what `video` takes).
pub fn command(dir: &Path, tool: &str, args: &[String]) -> Result<Command, ProjectError> {
    let dir = std::fs::canonicalize(dir).map_err(|_| ProjectError::NotAProject(dir.to_path_buf()))?;
    let pipeline = find_pipeline(&dir)?;
    let tools = list(&pipeline);
    let script = tools.iter().find(|(k, _)| k == tool).map(|(_, s)| s.clone())
        .ok_or_else(|| ProjectError::Invalid(format!("no pipeline tool \"{tool}\" (tools: {})", tools.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(", "))))?;
    let (_, folder) = projects_link(&dir)?;
    let film = project_name(&dir);
    let mut all: Vec<String> = script.split_whitespace().map(String::from).collect();
    all.extend(args.iter().map(|a| match a.as_str() { "@" => film.clone(), "@folder" => folder.clone(), _ => a.clone() }));
    with_env(&dir, &pipeline, &all)
}

/// One of Flex's own scripts (embedded, like server/music.mts), run with the same environment: `<script> <project> …`.
pub fn flex_script(dir: &Path, name: &str, body: &str, args: &[String]) -> Result<Command, ProjectError> {
    let dir = std::fs::canonicalize(dir).map_err(|_| ProjectError::NotAProject(dir.to_path_buf()))?;
    let pipeline = find_pipeline(&dir)?;
    let mut all = vec![crate::project::support_script(name, body)?.to_string_lossy().into_owned(), dir.to_string_lossy().into_owned()];
    all.extend(args.iter().cloned());
    with_env(&dir, &pipeline, &all)
}

fn with_env(dir: &Path, pipeline: &Path, args: &[String]) -> Result<Command, ProjectError> {
    let tsx = pipeline.join("node_modules/.bin/tsx");
    if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline.to_path_buf())); }
    let (projects, _) = projects_link(dir)?;
    let work = support_dir().join("work");
    std::fs::create_dir_all(&work)?;
    let dir = dir.to_path_buf();
    let mut c = Command::new(&tsx);
    c.arg("--import").arg(redirect_script()?);
    c.args(args);
    c.current_dir(pipeline)
        .env("PATH", login_path())
        .env("FLEX_PIPELINE", pipeline)
        .env("FLEX_VOICE_CACHE", voice_cache())
        .env("FLEX_SUPPORT", support_dir())
        .env("FLEX_PROJECTS", &projects)
        .env("FLEX_WORK", &work)
        .env("FLEX_OUT", out_dir(&dir));
    if dir.join("takes").is_dir() { c.env("FLEX_TAKES", dir.join("takes")); }
    crate::secrets::apply(&mut c, &dir);
    crate::project::apply_frame(&mut c, &dir);
    crate::library::apply(&mut c); // Flex's songs (FLEX_LIBRARY)
    Ok(c)
}
