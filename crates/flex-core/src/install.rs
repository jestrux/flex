//! Flex › Install flex Command…: the app's own `flex` command and its agent skill, linked from the app bundle.
//!
//! The command goes to `~/.flex/bin/flex`, Flex's own folder, which `~/.zshrc` puts first on the PATH (macOS ships an
//! unrelated `/usr/bin/flex`, the lexer generator); that folder is Flex's, so whatever `flex` is there (a link, or the
//! copy `scripts/install-cli.sh` makes) is replaced. The skill goes to `~/.claude/skills/flex`, replacing only an
//! earlier link. Both are links into the app, so they update when Flex does. The skill is also listed in
//! `~/.claude/CLAUDE.md` when that file exists and doesn't name it yet.

use std::path::{Path, PathBuf};

pub const SKILL_NAME: &str = "flex";

#[derive(Debug, Clone, PartialEq)]
pub struct Installed {
    pub command: PathBuf,
    /// `~/.zshrc` already put `~/.flex/bin` on the PATH (false: the line was just added; a new terminal picks it up)
    pub on_path: bool,
    /// where the skill was linked, or why it wasn't
    pub skill: Result<PathBuf, String>,
    /// what happened to `~/.claude/CLAUDE.md`, or why it couldn't be updated
    pub claude_md: Result<ClaudeMd, String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ClaudeMd { Added(PathBuf), AlreadyListed(PathBuf), NoFile }

const SKILL_ROW: &str = "| `/flex` | Make and check a Flex film: frames, cuts on the beat, the music grid, renders and their acceptance; show the author a frame in the Flex app |";
const SKILL_SECTION: &str = "## Flex\n\nUse the `/flex` skill to make and check a Flex film (frames, cuts against the music, renders) and to show the\nauthor a frame in the Flex app.\n";
const PATH_LINE: &str = "export PATH=\"$HOME/.flex/bin:$PATH\" # Flex CLI first (macOS has an unrelated /usr/bin/flex)";

/// Link `cli` (the bundled command) to `~/.flex/bin/flex` and `skill` (the bundled skill folder) into
/// `~/.claude/skills`, under `home`.
pub fn install(cli: &Path, skill: &Path, home: &Path) -> Result<Installed, String> {
    if !cli.is_file() { return Err(format!("the app has no flex command at {}", cli.display())); }
    let bin = home.join(".flex/bin");
    std::fs::create_dir_all(&bin).map_err(|e| format!("couldn't create {}: {e}", bin.display()))?;
    let command = bin.join("flex");
    if std::fs::symlink_metadata(&command).is_ok() {
        std::fs::remove_file(&command).map_err(|e| format!("couldn't replace {}: {e}", command.display()))?;
    }
    std::os::unix::fs::symlink(cli, &command).map_err(|e| format!("couldn't link {}: {e}", command.display()))?;
    let rc = home.join(".zshrc");
    let text = std::fs::read_to_string(&rc).unwrap_or_default();
    let on_path = text.contains(".flex/bin");
    if !on_path {
        std::fs::write(&rc, format!("{text}{}{PATH_LINE}\n", if text.is_empty() || text.ends_with('\n') { "\n" } else { "\n\n" }))
            .map_err(|e| format!("couldn't add Flex to the PATH in {}: {e}", rc.display()))?;
    }
    let skill = if skill.join("SKILL.md").is_file() {
        let dest = home.join(".claude/skills").join(SKILL_NAME);
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string()).and_then(|_| link(skill, &dest).map(|_| dest))
    } else { Err(format!("the app has no skill at {}", skill.display())) };
    let claude_md = match &skill { Ok(_) => list_skill(&home.join(".claude/CLAUDE.md")), Err(_) => Ok(ClaudeMd::NoFile) };
    Ok(Installed { command, on_path, skill, claude_md })
}

/// Mention the skill in the author's CLAUDE.md: a row after the last row of its skills table (a line starting with a
/// pipe and a backticked slash name), or a short section at the end. Never creates the file, and leaves it alone when
/// it already names the skill.
pub fn list_skill(file: &Path) -> Result<ClaudeMd, String> {
    let text = match std::fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ClaudeMd::NoFile),
        Err(e) => return Err(format!("couldn't read {}: {e}", file.display())),
    };
    if text.contains(&format!("`/{SKILL_NAME}`")) { return Ok(ClaudeMd::AlreadyListed(file.to_path_buf())); }
    std::fs::write(file, with_skill(&text)).map_err(|e| format!("couldn't update {}: {e}", file.display()))?;
    Ok(ClaudeMd::Added(file.to_path_buf()))
}

fn with_skill(text: &str) -> String {
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let is_row = |l: &str| l.trim_start().starts_with("| `/");
    if let Some(last) = lines.iter().rposition(|l| is_row(l)) {
        // the table's column count: our two cells, then empty ones
        let cells = lines[last].trim().matches('|').count().saturating_sub(1);
        let mut row = SKILL_ROW.to_string();
        for _ in 2..cells { row.push_str("  |"); }
        let mut out = String::new();
        for (i, l) in lines.iter().enumerate() {
            out.push_str(l);
            if i == last {
                if !l.ends_with('\n') { out.push('\n'); }
                out.push_str(&row);
                out.push('\n');
            }
        }
        return out;
    }
    let mut out = text.trim_end().to_string();
    if !out.is_empty() { out.push_str("\n\n"); }
    out.push_str(SKILL_SECTION);
    out
}

/// Point `dest` at `target`, replacing only an earlier symlink.
fn link(target: &Path, dest: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(dest) {
        Ok(m) if m.file_type().is_symlink() => std::fs::remove_file(dest).map_err(|e| format!("couldn't replace {}: {e}", dest.display()))?,
        Ok(_) => return Err(format!("{} already exists and isn't a link Flex made; move it away first", dest.display())),
        Err(_) => {}
    }
    std::os::unix::fs::symlink(target, dest).map_err(|e| format!("couldn't link {}: {e}", dest.display()))
}
