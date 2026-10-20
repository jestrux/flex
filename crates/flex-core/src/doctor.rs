//! `flex doctor`: is this machine ready to make films? Flex's own pipeline copy, and the global tools it relies on
//! (Node, ffmpeg, Playwright's Chromium, the voice engine, local Whisper). Each check says how to fix it.

use crate::project::{bundled_pipeline, login_path};
use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct Check {
    pub name: String,
    pub ok: bool,
    /// what was found
    pub detail: String,
    /// how to fix it (empty when ok)
    pub fix: String,
    /// needed for everything (false: only for one kind of work, e.g. transcription)
    pub required: bool,
}

/// The cached Whisper model Flex uses for transcription (mlx-whisper, Apple silicon).
pub const WHISPER_MODEL: &str = "mlx-community/whisper-large-v3-turbo";

fn sh(cmd: &str, cwd: Option<&Path>) -> Option<String> {
    let mut c = Command::new("sh");
    c.arg("-c").arg(cmd).env("PATH", login_path());
    if let Some(d) = cwd { c.current_dir(d); }
    let o = c.output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn check(name: &str, required: bool, found: Option<String>, fix: &str) -> Check {
    Check { name: name.into(), ok: found.is_some(), detail: found.unwrap_or_else(|| "missing".into()), fix: fix.into(), required }
}

/// Whether a Hugging Face model is fully downloaded (its weights are in a snapshot, not only its metadata).
pub fn hf_model_ready(model: &str) -> Option<String> {
    let dir = dirs::home_dir()?.join(".cache/huggingface/hub").join(format!("models--{}", model.replace('/', "--"))).join("snapshots");
    for snap in std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()) {
        if snap.path().join("weights.safetensors").exists() || snap.path().join("weights.npz").exists() { return Some(snap.path().display().to_string()); }
    }
    None
}

pub fn run() -> Vec<Check> {
    let mut v = vec![];
    let pipe = bundled_pipeline();
    v.push(check("pipeline (Flex's copy)", true,
        pipe.as_ref().ok().filter(|p| p.join("node_modules/.bin/tsx").exists())
            .map(|p| format!("{} · {}", p.display(), std::fs::read_to_string(p.join("SOURCE")).ok().and_then(|s| s.lines().find(|l| l.starts_with("commit")).map(String::from)).unwrap_or_default())),
        "scripts/sync-pipeline.sh (copies fancy-e2e-videos, applies pipeline-patches/, installs its packages)"));
    v.push(check("node", true, sh("node --version", None), "brew install node"));
    v.push(check("ffmpeg / ffprobe", true, sh("ffmpeg -version | head -1 && ffprobe -version >/dev/null && echo", None).map(|s| s.lines().next().unwrap_or_default().to_string()), "brew install ffmpeg"));
    let chromium = pipe.as_ref().ok().and_then(|p| sh("node -e \"const p=require('playwright').chromium.executablePath();process.stdout.write(require('fs').existsSync(p)?p:'')\"", Some(p)).filter(|s| !s.is_empty()));
    v.push(check("Playwright Chromium (capture)", true, chromium, "cd <flex>/pipeline && npx playwright install chromium"));
    let openai = (std::env::var("OPENAI_API_KEY").is_ok_and(|k| !k.is_empty()) || crate::secrets::get(crate::secrets::OPENAI).is_some())
        .then(|| format!("{} (gpt-4o-mini-tts); Kokoro for projects that pin it", crate::secrets::voice_engine(None)));
    let kokoro = dirs::home_dir().filter(|h| h.join(".kokoro/kokoro-v1.0.onnx").exists() && h.join(".kokoro/voices-v1.0.bin").exists())
        .and_then(|_| sh("python3 -c 'import kokoro_onnx' && echo 'Kokoro (~/.kokoro, am_michael)'", None));
    v.push(check("voice (narration)", true, openai.or(kokoro),
        "flex key set openai (or OPENAI_API_KEY), or install Kokoro: pip3 install kokoro-onnx, with kokoro-v1.0.onnx and voices-v1.0.bin in ~/.kokoro"));
    v.push(check("swiftc (flex read: text in images)", false, sh("xcrun --find swiftc", None), "xcode-select --install"));
    v.push(check("mlx_whisper (transcription)", false, sh("command -v mlx_whisper", None), "uv tool install mlx-whisper"));
    v.push(check(&format!("Whisper model {WHISPER_MODEL}"), false, hf_model_ready(WHISPER_MODEL),
        &format!("downloads on first use (~1.6 GB): flex music <project> --lyrics, or flex transcribe <audio> (if it stalls: HF_HUB_DISABLE_XET=1)")));
    v
}
