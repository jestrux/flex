//! Keys Flex passes to the tools it runs, kept in Flex's support folder (`<support>/keys/<name>`, readable only by you:
//! the folder is 0700, each file 0600), so the app, opened from Finder, has them too (it never sees a shell's environment).
//! Not the Keychain: macOS ties "Always Allow" to the exact binary, and Flex's binaries change on every build, so the
//! Keychain asked again and again. Today: the OpenAI key, which makes the pipeline voice narration with OpenAI's
//! gpt-4o-mini-tts instead of local Kokoro.
//!
//! A key in the environment wins over the stored one. A project can pin Kokoro (`export const voice = "kokoro"` in
//! project.ts): then no OpenAI key is passed to it, so an approved film keeps its voice. Lines are cached per engine, so
//! a switch re-voices every line.

use crate::project::{support_dir, ProjectError};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

pub const OPENAI: &str = "openai";

fn key_path(name: &str) -> PathBuf { support_dir().join("keys").join(name) }

pub fn get(name: &str) -> Option<String> {
    std::fs::read_to_string(key_path(name)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn set(name: &str, value: &str) -> Result<(), ProjectError> {
    let p = key_path(name);
    let dir = p.parent().unwrap();
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    std::fs::write(&p, value.trim())?;
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

pub fn remove(name: &str) -> Result<(), ProjectError> {
    match std::fs::remove_file(key_path(name)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// The project's narrator, from `voice.json`: `{ "engine": "openai" | "kokoro", "voice": "ash", "style": "how to read" }`.
/// `voice` and `style` are OpenAI's (a voice name, and gpt-4o-mini-tts's instructions: tone, pace, energy). The film's
/// call; Flex passes it to the pipeline (VOICE, VOICE_STYLE). Lines are cached per voice and style, so a change re-voices.
pub fn voice_json(dir: &Path) -> Option<serde_json::Value> {
    std::fs::read_to_string(dir.join("voice.json")).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// the project pins Kokoro: `"engine": "kokoro"` in voice.json, or `export const voice = "kokoro"` in its project.ts
pub fn pins_kokoro(dir: &Path) -> bool {
    if let Some(v) = voice_json(dir) { return v["engine"].as_str() == Some("kokoro"); }
    std::fs::read_to_string(dir.join("project.ts")).is_ok_and(|s| s.lines().any(|l| {
        let l = l.trim();
        l.starts_with("export const voice") && l.contains("kokoro")
    }))
}

/// Which voice engine a project runs with, and why (for `flex doctor` and the app).
pub fn voice_engine(dir: Option<&Path>) -> String {
    if dir.is_some_and(pins_kokoro) { return "Kokoro (the project pins it)".into(); }
    let named = dir.and_then(voice_json).and_then(|v| v["voice"].as_str().map(|n| format!(", voice {n}"))).unwrap_or_default();
    if !named.is_empty() && (std::env::var("OPENAI_API_KEY").is_ok_and(|k| !k.is_empty()) || get(OPENAI).is_some()) {
        return format!("OpenAI (voice.json{named})");
    }
    if std::env::var("OPENAI_API_KEY").is_ok_and(|k| !k.is_empty()) { return "OpenAI (OPENAI_API_KEY in the environment)".into(); }
    if get(OPENAI).is_some() { return "OpenAI (the key Flex keeps)".into(); }
    "Kokoro (no OpenAI key)".into()
}

/// Give a tool the project's voice: the OpenAI key from the Keychain when the environment has none, or no key at all
/// when the project pins Kokoro.
pub fn apply(cmd: &mut Command, dir: &Path) {
    if pins_kokoro(dir) { cmd.env_remove("OPENAI_API_KEY"); return; }
    if let Some(v) = voice_json(dir) {
        if let Some(n) = v["voice"].as_str() { cmd.env("VOICE", n); }
        if let Some(s) = v["style"].as_str() { cmd.env("VOICE_STYLE", s); }
    }
    if std::env::var("OPENAI_API_KEY").is_ok_and(|k| !k.is_empty()) { return; }
    if let Some(k) = get(OPENAI) { cmd.env("OPENAI_API_KEY", k); }
}
