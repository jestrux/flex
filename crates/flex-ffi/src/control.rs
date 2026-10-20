//! The `flex` command's way in (flex-core's control socket) and Flex › Install flex Command….

use crate::FlexError;
use std::sync::{Arc, Mutex};

/// Implemented in Swift: what the `flex` command asks of the app's windows. Called from a socket thread.
#[uniffi::export(with_foreign)]
pub trait ControlHandler: Send + Sync {
    /// Bring the app forward; open (or focus) the project's window when a folder is named.
    fn open_project(&self, project: Option<String>);
}

struct Bridge(Arc<dyn ControlHandler>);
impl flex_core::control::ControlHandler for Bridge {
    fn open_project(&self, project: Option<String>) { self.0.open_project(project) }
}

fn served() -> &'static Mutex<Option<flex_core::control::ControlServer>> {
    static S: std::sync::OnceLock<Mutex<Option<flex_core::control::ControlServer>>> = std::sync::OnceLock::new();
    S.get_or_init(Default::default)
}

/// Serve the control socket the `flex` command talks to. Fails when another Flex already serves it.
#[uniffi::export]
pub fn serve_control(handler: Arc<dyn ControlHandler>) -> Result<(), FlexError> {
    let s = flex_core::control::serve(&flex_core::control::socket_path(), Some(Arc::new(Bridge(handler))))
        .map_err(|message| FlexError::Failed { message })?;
    *served().lock().unwrap() = Some(s);
    Ok(())
}

/// Stop serving and remove the socket (on quit).
#[uniffi::export]
pub fn stop_control() { served().lock().unwrap().take(); }

/// What Install flex Command did.
#[derive(Debug, Clone, uniffi::Record)]
pub struct ToolsInstalled {
    pub command_path: String,
    /// ~/.zshrc already had Flex on the PATH (false: the line was just added)
    pub on_path: bool,
    pub skill_path: Option<String>,
    pub skill_error: Option<String>,
    /// "added", "listed" (already there), "none" (no ~/.claude/CLAUDE.md), or why it couldn't be updated
    pub claude_md: String,
}

/// Link the bundled `flex` command to ~/.flex/bin and its skill into ~/.claude/skills.
#[uniffi::export]
pub fn install_tools(cli_path: String, skill_dir: String) -> Result<ToolsInstalled, FlexError> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).ok_or_else(|| FlexError::Failed { message: "no home folder".into() })?;
    let i = flex_core::install::install(std::path::Path::new(&cli_path), std::path::Path::new(&skill_dir), &home)
        .map_err(|message| FlexError::Failed { message })?;
    use flex_core::install::ClaudeMd;
    Ok(ToolsInstalled {
        command_path: i.command.to_string_lossy().into_owned(), on_path: i.on_path,
        skill_path: i.skill.as_ref().ok().map(|p| p.to_string_lossy().into_owned()), skill_error: i.skill.err(),
        claude_md: match i.claude_md { Ok(ClaudeMd::Added(_)) => "added".into(), Ok(ClaudeMd::AlreadyListed(_)) => "listed".into(), Ok(ClaudeMd::NoFile) => "none".into(), Err(e) => e },
    })
}
