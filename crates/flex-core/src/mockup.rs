//! `flex mockup`: screens in device frames (Apple, Android, Windows, app windows), as PNGs (server/mockup.mts over server/devices/*.css). A page (an .html
//! file or a URL) is captured at the device's own size with its safe areas, light or dark; a screenshot is placed as it
//! is. Needs no film project: it runs on Flex's own pipeline (its Chromium and sharp).

use crate::project::{bundled_pipeline, login_path, support_script, ProjectError};
use std::path::Path;
use std::process::Command;

const SCRIPT: &str = include_str!("../../../server/mockup.mts");
const SCREENS: &str = include_str!("../../../server/screens.mts");
/// the device table both scripts share (sizes, safe areas, finishes)
const DEVICES: &str = include_str!("../../../server/devices.mts");
/// the review page (--review), imported by mockup.mts
const REVIEW: &str = include_str!("../../../server/review.mts");
const EMBED: &str = include_str!("../../../server/embed.mts");
/// the OS's own screens the review board draws over a frame (a flow's "system"), imported by review.mts
const SYSTEM: &str = include_str!("../../../server/system.mts");
/// `flex review`: the canvas served, with notes
const FLOW_REVIEW: &str = include_str!("../../../server/flow-review.mts");
const FRAMES: [(&str, &str); 6] = [
    ("devices/iphone-frame.css", include_str!("../../../server/devices/iphone-frame.css")),
    ("devices/ipad-frame.css", include_str!("../../../server/devices/ipad-frame.css")),
    ("devices/mac-frame.css", include_str!("../../../server/devices/mac-frame.css")),
    ("devices/android-frame.css", include_str!("../../../server/devices/android-frame.css")),
    ("devices/pc-frame.css", include_str!("../../../server/devices/pc-frame.css")),
    ("devices/window-frame.css", include_str!("../../../server/devices/window-frame.css")),
];

/// `mockup.mts <args…>`, ready to run: the pipeline's tsx, the script and its frames in Flex's support folder.
pub fn command(args: &[String]) -> Result<Command, ProjectError> {
    let pipeline = bundled_pipeline()?;
    let tsx = pipeline.join("node_modules/.bin/tsx");
    if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline)); }
    for (name, body) in FRAMES { support_script(name, body)?; }
    support_script("devices.mts", DEVICES)?;
    support_script("review.mts", REVIEW)?;
    support_script("system.mts", SYSTEM)?;
    support_script("embed.mts", EMBED)?;
    let script = support_script("mockup.mts", SCRIPT)?;
    let mut c = Command::new(&tsx);
    c.arg(&script).args(args).current_dir(&pipeline).env("PATH", login_path()).env("FLEX_PIPELINE", &pipeline);
    Ok(c)
}

/// `screens.mts <args…>` (`flex screens`): a web app's screens frozen to self-contained HTML per device and theme, for
/// `flex mockup` to frame. Runs on the same pipeline (its Chromium) as `command`.
pub fn screens_command(args: &[String]) -> Result<Command, ProjectError> {
    let pipeline = bundled_pipeline()?;
    let tsx = pipeline.join("node_modules/.bin/tsx");
    if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline)); }
    support_script("devices.mts", DEVICES)?;
    let script = support_script("screens.mts", SCREENS)?;
    let mut c = Command::new(&tsx);
    c.arg(&script).args(args).current_dir(&pipeline).env("PATH", login_path()).env("FLEX_PIPELINE", &pipeline);
    Ok(c)
}

/// `flow-review.mts <args…>` (`flex review`): a flow's live screen canvas served on localhost with notes on its frames,
/// or `wait` for the author's next round of them. It builds the canvas with `screens.mts` and `mockup.mts`, so all three
/// go into the support folder.
pub fn review_command(args: &[String]) -> Result<Command, ProjectError> {
    let pipeline = bundled_pipeline()?;
    let tsx = pipeline.join("node_modules/.bin/tsx");
    if !tsx.exists() { return Err(ProjectError::PipelineNotInstalled(pipeline)); }
    for (name, body) in FRAMES { support_script(name, body)?; }
    for (name, body) in [("devices.mts", DEVICES), ("review.mts", REVIEW), ("system.mts", SYSTEM), ("embed.mts", EMBED), ("mockup.mts", SCRIPT), ("screens.mts", SCREENS)] { support_script(name, body)?; }
    let script = support_script("flow-review.mts", FLOW_REVIEW)?;
    let mut c = Command::new(&tsx);
    c.arg(&script).args(args).current_dir(&pipeline).env("PATH", login_path()).env("FLEX_PIPELINE", &pipeline);
    Ok(c)
}

/// Inputs as absolute paths (the script runs in the pipeline's folder); URLs as they are.
pub fn absolute(input: &str) -> String {
    if input.starts_with("http://") || input.starts_with("https://") { return input.to_string(); }
    std::path::absolute(Path::new(input)).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| input.to_string())
}

/// Where the overlays live (built or not): by a hash of the frames' CSS and the script that draws them.
pub fn device_overlays_dir() -> std::path::PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    SCRIPT.hash(&mut h); DEVICES.hash(&mut h); for (_, css) in FRAMES { css.hash(&mut h); }
    crate::project::support_dir().join("device-frames").join(format!("{:012x}", h.finish() & 0xffff_ffff_ffff))
}

/// Does the project have a phone take (a take recorded in a device: `"device"` in its events.json)?
pub fn has_phone_takes(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir.join("takes")) else { return false };
    rd.filter_map(|e| e.ok()).any(|e| std::fs::read_to_string(e.path().join("events.json")).is_ok_and(|s| s.contains("\"device\"")))
}

/// Does the project paint devices: a phone take, or a screen recording in a device (the pipeline's `recordingLayers`,
/// patch 27, called from its look or a scene)?
pub fn uses_devices(dir: &Path) -> bool {
    if has_phone_takes(dir) { return true; }
    let mentions = |p: &Path| std::fs::read_to_string(p).is_ok_and(|s| s.contains("recordingLayers"));
    if mentions(&dir.join("look.ts")) { return true; }
    let Ok(rd) = std::fs::read_dir(dir.join("scenes")) else { return false };
    rd.filter_map(|e| e.ok()).any(|e| mentions(&e.path()))
}

/// The handhelds' parts as transparent PNGs for painting phone takes and screen recordings (`mockup.mts --overlays`): the
/// iPhone's in the folder itself, every other device's in a subfolder (`android/`, `android-tablet/`). Built once into the
/// support folder, again only when a frame's CSS or the script changes. The pipeline's `phoneLayers` and
/// `recordingLayers` read them through `FLEX_DEVICE_FRAMES`, which Flex sets for every server.
pub fn device_overlays() -> Result<std::path::PathBuf, ProjectError> {
    let dir = device_overlays_dir();
    let built = |d: &std::path::Path| ["frame.json", "android/frame.json", "android-tablet/frame.json"].iter().all(|f| d.join(f).exists());
    if built(&dir) { return Ok(dir); }
    let mut c = command(&["--overlays".into(), "-o".into(), dir.to_string_lossy().into_owned()])?;
    let o = c.output()?;
    if !o.status.success() || !built(&dir) {
        return Err(ProjectError::Invalid(format!("couldn't draw the device overlays: {}", String::from_utf8_lossy(&o.stderr).trim())));
    }
    Ok(dir)
}
