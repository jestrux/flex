//! `flex mockup`: screens in Apple device frames, as PNGs (server/mockup.mts over server/devices/*.css). A page (an .html
//! file or a URL) is captured at the device's own size with its safe areas, light or dark; a screenshot is placed as it
//! is. Needs no film project: it runs on Flex's own pipeline (its Chromium and sharp).

use crate::project::{bundled_pipeline, login_path, support_script, ProjectError};
use std::path::Path;
use std::process::Command;

const SCRIPT: &str = include_str!("../../../server/mockup.mts");
const FRAMES: [(&str, &str); 3] = [
    ("devices/iphone-frame.css", include_str!("../../../server/devices/iphone-frame.css")),
    ("devices/ipad-frame.css", include_str!("../../../server/devices/ipad-frame.css")),
    ("devices/mac-frame.css", include_str!("../../../server/devices/mac-frame.css")),
];

/// `mockup.mts <args…>`, ready to run: the pipeline's tsx, the script and its frames in Flex's support folder.
pub fn command(args: &[String]) -> Result<Command, ProjectError> {
    let pipeline = bundled_pipeline()?;
    let tsx = pipeline.join("node_modules/.bin/tsx");
    if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline)); }
    for (name, body) in FRAMES { support_script(name, body)?; }
    let script = support_script("mockup.mts", SCRIPT)?;
    let mut c = Command::new(&tsx);
    c.arg(&script).args(args).current_dir(&pipeline).env("PATH", login_path()).env("FLEX_PIPELINE", &pipeline);
    Ok(c)
}

/// Inputs as absolute paths (the script runs in the pipeline's folder); URLs as they are.
pub fn absolute(input: &str) -> String {
    if input.starts_with("http://") || input.starts_with("https://") { return input.to_string(); }
    std::path::absolute(Path::new(input)).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| input.to_string())
}

/// Where the overlays live (built or not): by a hash of the frame's CSS and the script that draws them.
pub fn device_overlays_dir() -> std::path::PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    SCRIPT.hash(&mut h); FRAMES[0].1.hash(&mut h);
    crate::project::support_dir().join("device-frames").join(format!("{:012x}", h.finish() & 0xffff_ffff_ffff))
}

/// Does the project have a phone take (a take recorded in a device: `"device"` in its events.json)?
pub fn has_phone_takes(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir.join("takes")) else { return false };
    rd.filter_map(|e| e.ok()).any(|e| std::fs::read_to_string(e.path().join("events.json")).is_ok_and(|s| s.contains("\"device\"")))
}

/// The iPhone's parts as transparent PNGs for painting phone takes (`mockup.mts --overlays`): built once into the support
/// folder, again only when the frame's CSS or the script changes. The pipeline's `phoneLayers` reads them through
/// `FLEX_DEVICE_FRAMES`, which Flex sets for every server.
pub fn device_overlays() -> Result<std::path::PathBuf, ProjectError> {
    let dir = device_overlays_dir();
    if dir.join("frame.json").exists() { return Ok(dir); }
    let mut c = command(&["--overlays".into(), "-o".into(), dir.to_string_lossy().into_owned()])?;
    let o = c.output()?;
    if !o.status.success() || !dir.join("frame.json").exists() {
        return Err(ProjectError::Invalid(format!("couldn't draw the device overlays: {}", String::from_utf8_lossy(&o.stderr).trim())));
    }
    Ok(dir)
}
