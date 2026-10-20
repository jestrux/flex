//! Flex's engine. Rust owns the project, the cache and the processes; the app and the `flex`
//! CLI are two front ends on it.

pub mod activity;
pub mod assets;
pub mod camera;
pub mod capture;
pub mod crop;
pub mod install;
pub mod control;
pub mod cuts;
pub mod cutout;
pub mod doctor;
pub mod narration;
pub mod onsets;
pub mod new;
pub mod script;
pub mod secrets;
pub mod tools;
pub mod transcribe;
pub mod engine;
pub mod filmgrid;
pub mod frames;
pub mod joins;
pub mod paint;
pub mod project;
pub mod read;
pub mod render;
mod roundmask;
mod vips;
pub mod renders;
pub mod server;
pub mod sheet;
pub mod waveform;

pub use capture::CaptureRun;
pub use engine::{Engine, EngineState};
pub use frames::{FrameState, Session};
pub use project::{Item, Music, Project, ProjectError, Scene};
pub use server::{CameraBlock, FrameLayers, Manifest, Server, TakeCamera};
