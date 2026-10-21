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
