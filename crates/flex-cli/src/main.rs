//! `flex`: Flex from the terminal.
use anyhow::Result;
use clap::{Parser, Subcommand};
use flex_core::{FrameLayers, Project, Session};
use std::time::Instant;
use std::path::PathBuf;

mod activity;
mod app;
mod assets;

#[derive(Parser)]
#[command(name = "flex", version, about = "Flex: watch and steer a fancy-e2e-videos film")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
    /// run the film with a variant flag the project declares, e.g. --variant END=dark (repeatable)
    #[arg(long = "variant", global = true, value_name = "NAME=VALUE")]
    variants: Vec<String>,
    /// preview a take version in the film in place of the pick, e.g. --take circles-pool-back=v2 (repeatable)
    #[arg(long = "take", global = true, value_name = "TAKE=vN")]
    takes: Vec<String>,
}

/// `--variant NAME=VALUE`: set as environment variables, which the server (a child process)
/// inherits and the project's scenes read, as `END=dark npm run video` does.
fn set_variants(v: &[String]) -> Result<()> {
    for kv in v {
        let (k, val) = kv.split_once('=').ok_or_else(|| anyhow::anyhow!("--variant takes NAME=VALUE, not \"{kv}\""))?;
        std::env::set_var(k.trim(), val.trim());
    }
    Ok(())
}

#[derive(Subcommand)]
enum LibraryCmd {
    /// Download songs now (they download on first use anyway): into <support>/library/<key>/
    Pull {
        /// the songs' keys (flex library lists them)
        keys: Vec<String>,
        /// every song
        #[arg(long)]
        all: bool,
        /// their stems too (a few hundred MB each), into <key>/stems/
        #[arg(long)]
        stems: bool,
    },
}

#[derive(Subcommand)]
enum Cmd {
    /// The project's assets: the song and stems, takes, freezes and stills, cards, looks, labs, renders
    Assets(assets::Args),
    /// Flex's own music library: tracks a film can use without a song of its own (`music: { key: "<key>" }` in
    /// project.ts), with their tempo, length, mood and licence. The songs download the first time a film uses them
    Library {
        /// print JSON
        #[arg(long)]
        json: bool,
        #[command(subcommand)]
        cmd: Option<LibraryCmd>,
    },
    /// The project's activity trail: flex commands, file changes and the agents' sessions, on one clock
    Activity(activity::Args),
    /// The film's script (script.json): its beats on the film's bars, their narration and panels, and what's measurable
    /// about them (overlaps, gaps, missing sketches, lines outside their beat)
    Script {
        dir: PathBuf,
        /// print JSON
        #[arg(long)]
        json: bool,
    },
    /// The storyboard: the script's panels as one sheet (PNG) and as an animatic over the track (mp4)
    Storyboard {
        dir: PathBuf,
        /// the sheet (default: <film's folder>/storyboard.png in ~/Downloads/flex-videos)
        #[arg(long)]
        sheet: Option<PathBuf>,
        /// the animatic: each panel over its bars, the film's track under it
        #[arg(long)]
        animatic: Option<PathBuf>,
        /// panels a row on the sheet
        #[arg(long, default_value_t = 4)]
        cols: usize,
        /// each panel's width (sheet) or the animatic's width
        #[arg(long)]
        width: Option<u32>,
    },
    /// Open a project folder and print its outline: the music and the scenes (`flex show` opens it in the app)
    Open {
        dir: PathBuf,
        /// print JSON
        #[arg(long)]
        json: bool,
    },
    /// Paint one frame (a frame number, or a time like 12.5s) to a PNG or JPEG
    Frame {
        dir: PathBuf,
        at: String,
        #[arg(short, long, default_value = "frame.png")]
        out: PathBuf,
        /// pixels wide (default: the film's frame, 1920, or 1080 for a vertical film)
        #[arg(long)]
        width: Option<u32>,
    },
    /// Paint every frame of the film (or of one scene) into the cache
    Warm {
        dir: PathBuf,
        #[arg(long)]
        scene: Option<String>,
        #[arg(long, default_value_t = 960)]
        width: u32,
    },
    /// What the Flex app has open and where the author's playhead is (no folder: every project in the app); without the
    /// app, how much of each scene is painted
    Status {
        dir: Option<PathBuf>,
        #[arg(long, default_value_t = 960)]
        width: u32,
        /// print JSON (the app's view: playhead, scene, painted, any render running)
        #[arg(long)]
        json: bool,
    },
    /// Show the author a moment in the Flex app: opens the project there (starting the app if needed) and moves its
    /// playhead to AT (a frame number, film seconds like 12.5s, or a film bar.beat like 37.2) or to a scene's start
    Show {
        dir: PathBuf,
        at: Option<String>,
        /// the start of this scene
        #[arg(long, conflicts_with = "at")]
        scene: Option<String>,
    },
    /// Paint frames here and with the pipeline's own paint, and compare them
    Diff {
        dir: PathBuf,
        /// frame numbers or times; default: the middle of every paintable scene
        at: Vec<String>,
        /// keep the two images and a difference map here
        #[arg(long)]
        keep: Option<PathBuf>,
    },
    /// The MVP's acceptance test: paint frames across every scene (first, last, every --every seconds) and compare them
    /// with a finished render of the same film; check nothing is a placeholder; compare the mix's loudness with the film's
    Accept {
        dir: PathBuf,
        /// the pipeline's render of this film (an mp4 at 1920 × 1080 or larger)
        #[arg(long)]
        film: PathBuf,
        /// seconds between checked frames inside a scene
        #[arg(long, default_value_t = 2.0)]
        every: f64,
        /// a frame fails above this mean difference (0–255); video compression alone is about 1
        #[arg(long, default_value_t = 4.0)]
        max_mean: f64,
        /// keep each frame pair here
        #[arg(long)]
        keep: Option<PathBuf>,
        /// print JSON
        #[arg(long)]
        json: bool,
    },
    /// Keep the cache painted and print each reload (edit a scene file to see it land)
    Watch {
        dir: PathBuf,
        #[arg(long, default_value_t = 960)]
        width: u32,
        /// the playhead, as a frame or a time: painting starts here
        #[arg(long)]
        at: Option<String>,
    },
    /// Check every scene boundary: paint the frames either side small and flag a cut that jumps
    /// (the difference across it is more than 3 × the motion just before it, + 1)
    Joins {
        dir: PathBuf,
        /// print JSON
        #[arg(long)]
        json: bool,
    },
    /// Write the film's frames (from the cache, painting what's missing) as numbered files
    Play {
        dir: PathBuf,
        #[arg(long)]
        to_dir: PathBuf,
        #[arg(long)]
        scene: Option<String>,
        #[arg(long, default_value_t = 960)]
        width: u32,
    },
    /// Is this machine ready? Flex's pipeline copy and the global tools (node, ffmpeg, Chromium, voice, Whisper), with fixes
    Doctor {
        #[arg(long)]
        json: bool,
    },
    /// Start a film project: project.ts, the track (and a stems/ folder beside it) in audio/, a placeholder scene
    New {
        dir: PathBuf,
        /// the song the film is cut to (a stems/ folder next to it is copied too)
        #[arg(long)]
        music: PathBuf,
        /// the film's name (default: the folder's)
        #[arg(long)]
        name: Option<String>,
        /// a built-in feel: clean, modern, professional (default: a plain placeholder; the look is the film's call)
        #[arg(long)]
        feel: Option<String>,
        /// the song's licence, for the credits (owned, CC-BY …; default: "not recorded")
        #[arg(long)]
        licence: Option<String>,
    },
    /// Run one of the pipeline's own tools on the project, with Flex's environment (`flex run <dir>` lists them).
    /// `@` in the arguments stands for the film's name, e.g. flex run . check @
    Run {
        dir: PathBuf,
        tool: Option<String>,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Render the film (or one scene) into ~/Downloads/flex-videos/<project>/: a film made only of cards with Flex's painter (exactly what the preview shows), one with captured takes with the pipeline (--pipeline forces it)
    Render {
        dir: PathBuf,
        #[arg(long)]
        scene: Option<String>,
        /// 1080p (default), 1440p, 4k
        #[arg(long)]
        size: Option<String>,
        /// paint with Flex's painter, streamed into the encoder (it says so if the film needs the pipeline); the default
        /// for a film made only of cards
        #[arg(long)]
        fast: bool,
        /// render with the pipeline even when Flex's painter could (a film with captured takes always uses it)
        #[arg(long, conflicts_with = "fast")]
        pipeline: bool,
        /// an excerpt with its sound, A:B in film seconds (76.6s:82.9s) or film bar.beat (37:40), with Flex's painter
        /// → <film>--excerpt-A-B.mp4
        #[arg(long)]
        range: Option<String>,
        /// mix the sound again and put it into the last render of the whole film (the picture is copied, not repainted)
        #[arg(long, conflicts_with_all = ["fast", "range", "scene", "pipeline"])]
        audio_only: bool,
    },
    /// A person cut out of a photo or a clip (macOS Vision): the person instance only (background text and signs dropped),
    /// smoothed over time, defringed; a clip with alpha (ProRes 4444) or a PNG, for `{video, alpha: true}` layers
    Cutout {
        file: PathBuf,
        #[arg(short, long)]
        out: Option<PathBuf>,
        /// a stretch of a video (seconds, 12.5 or 12.5s)
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: Option<String>,
        /// keep background text and signs
        #[arg(long)]
        keep_text: bool,
        /// temporal smoothing, in frames (0 = off)
        #[arg(long, default_value_t = 3)]
        smooth: u32,
        /// alpha under this (0–1) becomes transparent
        #[arg(long, default_value_t = 0.08)]
        floor: f64,
        /// also write a preview over a checkerboard
        #[arg(long)]
        preview: bool,
        #[arg(long)]
        json: bool,
    },
    /// Where sung syllables and letters start (energy, pitch, fricatives): file seconds, and for a project's track or stem
    /// film seconds and bar.beat. For spelled letters and words Whisper can't hear
    Onsets {
        file: PathBuf,
        #[arg(long)]
        from: String,
        #[arg(long)]
        to: String,
        /// the project (for film seconds and bar.beat); default: the folder the file is in, if it's a project
        #[arg(long)]
        project: Option<PathBuf>,
        /// how many to expect (the strongest that many)
        #[arg(long)]
        expect: Option<usize>,
        /// seconds between two onsets at least
        #[arg(long, default_value_t = 0.12)]
        min_gap: f64,
        #[arg(long)]
        json: bool,
    },
    /// A cell-shaped crop of a photo centred on its subject (Vision face / person), never enlarged past --max
    Crop {
        file: PathBuf,
        /// the cell in px, W:H (e.g. 1080:1350)
        #[arg(long)]
        cell: String,
        /// face, person or centre
        #[arg(long, default_value = "face")]
        subject: String,
        #[arg(long, default_value_t = 1.3)]
        max: f64,
        /// where the subject's centre sits in the cell, X:Y fractions (default by subject: face 0.5:0.42, person 0.5:0.57, centre 0.5:0.5)
        #[arg(long)]
        place: Option<String>,
        #[arg(short, long)]
        out: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// A labelled contact sheet of a video (or a folder of images); with --ref, each frame beside the reference's same
    /// frame and their difference
    Sheet {
        file: PathBuf,
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        fps: Option<f64>,
        #[arg(long)]
        cols: Option<u32>,
        #[arg(long)]
        thumb: Option<u32>,
        /// no time / frame labels
        #[arg(long)]
        no_label: bool,
        #[arg(long = "ref")]
        reference: Option<PathBuf>,
        #[arg(short, long)]
        out: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Read the track for cutting to: tempo and the grid (its phase checked on the drum stem's kicks), each stem's
    /// activity per bar, the vocal's phrases and words (local Whisper) as bar.beat
    Music {
        dir: PathBuf,
        /// the music key in audio.json (default: the only one)
        key: Option<String>,
        /// download the Whisper model if it isn't there yet (~1.6 GB)
        #[arg(long)]
        lyrics: bool,
        /// convert on the analysed grid: bar.beat (15.2.5) → seconds, or seconds (33.3s) → bar.beat
        #[arg(long)]
        at: Option<String>,
        /// the audio as a picture (stems over bar lines, hits, sung words), for eyes that can't listen
        #[arg(long)]
        sheet: bool,
        /// the sheet's stretch, song seconds
        #[arg(long)]
        from: Option<f64>,
        #[arg(long)]
        to: Option<f64>,
        #[arg(short, long)]
        out: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// The text in an image or a PDF (macOS's own text recognition, offline); --json adds each line's box in the image's
    /// pixels (origin top left), so a label in a screenshot can be found and framed
    Read {
        file: PathBuf,
        /// quicker, less accurate
        #[arg(long)]
        fast: bool,
        /// recognition languages, e.g. --lang en-US --lang fr-FR (default: the system's)
        #[arg(long = "lang")]
        langs: Vec<String>,
        #[arg(long)]
        json: bool,
    },
    /// What is said or sung in any audio, word by word with times (local Whisper). A project's track or stem also gets
    /// bar.beat (after flex music). Times: seconds, or 12.5s
    Transcribe {
        file: PathBuf,
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: Option<String>,
        /// the language: en (default), another code, or auto (Whisper guesses)
        #[arg(long)]
        language: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// The film's sound without rendering the picture (seconds, not minutes): the whole mix, or one layer as mixed (music:
    /// the edit, levelled and ducked; voice; sfx), optionally a stretch of it. Prints the file and its loudness
    Mix {
        dir: PathBuf,
        /// where to write it (default ~/Downloads/flex-videos/<film>/<film>[--layer].wav)
        #[arg(short, long)]
        out: Option<PathBuf>,
        /// one layer: music, voice or sfx
        #[arg(long)]
        only: Option<String>,
        /// a stretch: film seconds (12.5s) or a film bar.beat (15, 15.2, 15.2.5)
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Where each cut sits against the music: every change of item (card, take, scene), its distance to the nearest beat
    /// and declared hit (ms). Measurement only: whether a cut should be on a beat is the film's call
    Cuts {
        dir: PathBuf,
        /// only the cuts between beats (more than 40 ms from every beat and declared hit)
        #[arg(long)]
        off: bool,
        #[arg(long)]
        json: bool,
    },
    /// Where the narration's words land: each line's words in film seconds and bar.beat (local Whisper, cached), with how
    /// far each is off the beat and whether the song's lead vocal sings over it
    Narration {
        dir: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// One card on its own, with the project's look: without a type, the cards the project can use (defaults, length);
    /// with one, a still (--at ms, or -o x.png) or the whole card as a clip (-o x.mp4)
    Card {
        dir: PathBuf,
        #[arg(name = "type")]
        card: Option<String>,
        /// params as JSON, over the card's defaults
        #[arg(long)]
        params: Option<String>,
        /// length (ms; default the card's)
        #[arg(long)]
        dur: Option<u32>,
        /// a still at this moment (ms into the card)
        #[arg(long)]
        at: Option<u32>,
        #[arg(short, long)]
        out: Option<PathBuf>,
        #[arg(long)]
        width: Option<u32>,
        #[arg(long)]
        json: bool,
    },
    /// How the music dips under each narration line, measured on the mix: levels before, during and after, the dip,
    /// attack, release, pumping, and the voice over the music (dB). Numbers only
    Duck {
        dir: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// What moves if the film grows or shrinks at a point (bars added to or cut from the music edit): every later scene,
    /// item, narration line and marker, with its film time and bar.beat before and after. A preview; nothing is changed
    Shift {
        dir: PathBuf,
        /// the point: film seconds (52.3s) or a film bar.beat (23.1)
        #[arg(long)]
        at: String,
        /// how much: bars (+7, -2) or seconds (+3.5s)
        #[arg(long, allow_hyphen_values = true)]
        by: String,
        #[arg(long)]
        json: bool,
    },
    /// The film's beat grid through its music edit (film bars, not song bars: a repeated bar plays twice). --at converts:
    /// a film bar.beat (15.2.5), film seconds (52.3s) or a song second (song:33.2s)
    Grid {
        dir: PathBuf,
        #[arg(long)]
        at: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Keys Flex passes to the tools it runs, kept in Flex's support folder: `flex key set openai` (reads the key from stdin),
    /// `flex key remove openai`, `flex key` (which voice engine is in use)
    Key {
        action: Option<String>,
        name: Option<String>,
    },
    /// The takes' camera plans as the film paints them (zoom segments and effects, take ms and film s); with a take and
    /// a block id, edit it in the take's edl.json (any edit locks the plan)
    Camera {
        dir: PathBuf,
        take: Option<String>,
        id: Option<String>,
        /// new start / end (take ms)
        #[arg(long)]
        start: Option<f64>,
        #[arg(long)]
        end: Option<f64>,
        /// move both by this much (ms, negative = earlier)
        #[arg(long, allow_hyphen_values = true)]
        shift: Option<f64>,
        #[arg(long)]
        on: bool,
        #[arg(long)]
        off: bool,
        /// set an effect's (or a zoom's) parameter: --param title="Read-only" --param delay=250 (a JSON value, else text)
        #[arg(long = "param")]
        params: Vec<String>,
        /// lock / unlock the take's plan (unlocked, the next capture's automatic plan replaces it)
        #[arg(long)]
        lock: bool,
        #[arg(long)]
        unlock: bool,
        #[arg(long)]
        json: bool,
    },
    /// List the project's journeys, their takes' versions (* = the pick) and the data state
    Journeys {
        dir: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Record a journey into a new take version (a dry run first warms the app up), then report its timing.
    /// The film keeps its pick until `flex pick`; preview the new version with --take TAKE=vN.
    Capture {
        dir: PathBuf,
        /// the journey (journeys/<name>.ts) or its take's name
        journey: String,
        /// rehearse only: no recording, screenshots per mark
        #[arg(long)]
        dry: bool,
        /// pixel density (default: the project's capture.dpr, else 2; 3 for 4K)
        #[arg(long)]
        dpr: Option<u32>,
        /// skip the warm-up dry run
        #[arg(long)]
        no_warm: bool,
        /// go ahead with a journey that writes to the app's data
        #[arg(long)]
        yes: bool,
        /// capture even if the data state isn't the one the journey needs
        #[arg(long)]
        force: bool,
        #[arg(long)]
        json: bool,
    },
    /// A take's timing: each beat's lateness, and (for a version) each mark's offset against the pick
    Report {
        dir: PathBuf,
        take: String,
        /// a version (v2); default the pick
        version: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Make a take version the one the film uses; the pick's locked camera plan comes along, shifted by each mark's offset
    Pick {
        dir: PathBuf,
        take: String,
        version: String,
        #[arg(long)]
        json: bool,
    },
    /// Every page as each seat (capture.personas + capture.walk): screenshots and a contact sheet in storyboard/, to
    /// plan beats from what is actually on screen
    Walk {
        dir: PathBuf,
        /// a view of the pages the project declares (capture.walk.views): a theme, a phone
        #[arg(long)]
        view: Option<String>,
        /// whole pages, not one screen
        #[arg(long)]
        full: bool,
        /// pixel density (default 1)
        #[arg(long)]
        dpr: Option<u32>,
        #[arg(long)]
        json: bool,
    },
    /// One page as a persona sees it, as a still for cards: assets/freezes/<name>.png (2× by default). The page: a URL, or a
    /// path under capture.walk.base; --element clips to one element
    Freeze {
        dir: PathBuf,
        persona: String,
        page: String,
        #[arg(long)]
        name: Option<String>,
        /// a view the project declares (capture.walk.views): a theme, a phone
        #[arg(long)]
        view: Option<String>,
        #[arg(long)]
        full: bool,
        /// clip to this element (CSS selector)
        #[arg(long)]
        element: Option<String>,
        /// wait for this element before the shot (CSS selector)
        #[arg(long)]
        wait: Option<String>,
        #[arg(long)]
        dpr: Option<u32>,
        #[arg(long)]
        json: bool,
    },
    /// Delete old take versions: keeps the pick, v0 and the newest --keep; lists them without --yes
    Prune {
        dir: PathBuf,
        take: Option<String>,
        #[arg(long, default_value_t = 2)]
        keep: u32,
        #[arg(long)]
        yes: bool,
        #[arg(long)]
        json: bool,
    },
    /// The app's data state, and the project's staging scripts; run one by name
    Stage {
        dir: PathBuf,
        script: Option<String>,
        /// go ahead with a script that writes to the app's data
        #[arg(long)]
        yes: bool,
        #[arg(long)]
        json: bool,
    },
}

/// run `server/capture.mts`, its output passed straight through; exits with its status
fn capture_cmd(dir: &std::path::Path, cmd: &str, rest: Vec<String>) -> Result<()> {
    let st = flex_core::capture::command(dir, cmd, &rest)?.status()?;
    if !st.success() { exit(st.code().unwrap_or(1)); }
    Ok(())
}

/// "812" → frame 812; "12.5s" → the frame at 12.5 s
fn frame_at(m: &flex_core::Manifest, at: &str) -> Result<u32> {
    let f = if let Some(s) = at.strip_suffix('s') { (s.parse::<f64>()? * m.fps as f64).round() as u32 } else { at.parse()? };
    anyhow::ensure!(f < m.frames, "frame {f} is past the end ({} frames)", m.frames);
    Ok(f)
}

fn scene_range(m: &flex_core::Manifest, scene: &Option<String>) -> Result<std::ops::Range<u32>> {
    Ok(match scene {
        None => 0..m.frames,
        Some(id) => {
            let s = m.scenes.iter().find(|s| &s.id == id).ok_or_else(|| anyhow::anyhow!("no scene \"{id}\" (scenes: {})", m.scenes.iter().map(|s| s.id.as_str()).collect::<Vec<_>>().join(", ")))?;
            s.first..s.first + s.frames
        }
    })
}

/// stdin is a terminal (then prompt for a key; piped, read it quietly)
fn atty_stdin() -> bool { std::io::IsTerminal::is_terminal(&std::io::stdin()) }

/// The command being run, recorded in the project's activity trail (flex_core::activity) when it ends.
static RECORDING: std::sync::Mutex<Option<flex_core::activity::Recorder>> = std::sync::Mutex::new(None);

fn finish(outcome: Result<i32, String>) {
    if let Some(r) = RECORDING.lock().ok().and_then(|mut g| g.take()) { r.end(outcome); }
}

/// Exit with a code, recording the command first (use this, never std::process::exit).
fn exit(code: i32) -> ! {
    finish(Ok(code));
    std::process::exit(code)
}

fn main() -> Result<()> {
    let argv: Vec<String> = std::env::args().collect();
    *RECORDING.lock().unwrap() = Some(flex_core::activity::Recorder::begin(&argv));
    let r = run();
    finish(match &r { Ok(()) => Ok(0), Err(e) => Err(format!("{e:#}")) });
    r
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    set_variants(&cli.variants)?;
    if !cli.takes.is_empty() { std::env::set_var("FLEX_TAKE_VERSIONS", cli.takes.join(",")); }
    match cli.cmd {
        Cmd::Assets(a) => assets::run(a)?,
        Cmd::Library { cmd: Some(LibraryCmd::Pull { keys, all, stems }), .. } => {
            use flex_core::library;
            let songs = library::songs();
            let keys: Vec<String> = if all { songs.iter().map(|s| s.key.clone()).collect() } else { keys };
            if keys.is_empty() { anyhow::bail!("name the songs to pull (flex library lists them), or --all"); }
            for k in &keys {
                let Some(p) = library::ensure(k)? else { anyhow::bail!("no song \"{k}\" in Flex's library (flex library lists them)") };
                println!("{k:<20} {}", p.display());
                if stems { println!("{:<20} {}", "", library::ensure_stems(k)?.display()); }
            }
        }
        Cmd::Library { json, cmd: None } => {
            let assets = flex_core::project::bundled_pipeline()?.join("assets");
            let lib: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(assets.join("library.json"))?)?;
            let mut rows = vec![];
            for (key, t) in lib["music"].as_object().into_iter().flatten() {
                // the tempo and length from the track's grid when the library doesn't say
                let grid: serde_json::Value = std::fs::read_to_string(assets.join("music").join(format!("{key}.grid.json"))).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
                rows.push(serde_json::json!({ "key": key, "kind": "bundled", "bpm": t["bpm"].as_f64().or(grid["bpm"].as_f64()), "duration": grid["duration"].as_f64(),
                    "mood": t["mood"], "feel": t["feel"], "licence": t["licence"], "attribution": t["attribution"], "downloaded": true }));
            }
            // Flex's songs: downloaded on first use
            for s in flex_core::library::songs() {
                let mut r = serde_json::to_value(&s)?;
                r["kind"] = "song".into();
                r["downloaded"] = flex_core::library::downloaded(&s).into();
                r["hasStems"] = flex_core::library::has_stems(&s.key).into();
                rows.push(r);
            }
            if json { println!("{}", serde_json::to_string_pretty(&rows)?); } else {
                for r in &rows {
                    let bpm = r["bpm"].as_f64().map(|b| format!("{b:.0} BPM")).unwrap_or_else(|| "? BPM".into());
                    let len = r["duration"].as_f64().map(|d| format!("{}:{:02}", d as u32 / 60, d as u32 % 60)).unwrap_or_default();
                    let kind = match (r["kind"].as_str(), r["downloaded"].as_bool()) { (Some("song"), Some(true)) => "song, here", (Some("song"), _) => "song", _ => "bundled" };
                    let vocals = r["vocals"].as_str().map(|v| format!("{v} · ")).unwrap_or_default();
                    println!("  {:<24} {:>8} {:>6}  {:<10}  {vocals}{}  ({})", r["key"].as_str().unwrap_or(""), bpm, len, kind, r["mood"].as_str().unwrap_or(""), r["licence"].as_str().unwrap_or(""));
                }
                println!("use one: music: {{ key: \"<key>\" }} in project.ts (a song downloads the first time a film uses it; a track's attribution goes into the film's credits)");
            }
        }
        Cmd::Script { dir, json } => {
            let Some(sc) = flex_core::script::open(&dir)? else { anyhow::bail!("no script.json in {} (docs/making-a-film.md: the script)", dir.display()) };
            if json { println!("{}", serde_json::to_string_pretty(&sc)?); } else {
                for b in &sc.beats {
                    println!("{:>7.2}–{:<7.2} {:<9} {:<26} {:<7} {} panel{}{}", b.start, b.end, b.at, b.title, b.status, b.panels.len(), if b.panels.len() == 1 { "" } else { "s" }, if b.planned { "  (planned: past the film's end)" } else { "" });
                    for l in &b.narration { println!("{:>26} “{}”", l.at, l.text); }
                }
                for n in &sc.notes { println!("  ! {n}"); }
                println!("{} beats, {} panels, {} narration lines{}", sc.beats.len(), sc.beats.iter().map(|b| b.panels.len()).sum::<usize>(),
                    sc.beats.iter().map(|b| b.narration.len()).sum::<usize>(), if sc.notes.is_empty() { String::new() } else { format!(", {} notes", sc.notes.len()) });
            }
        }
        Cmd::Storyboard { dir, sheet, animatic, cols, width } => {
            let p = Project::open(&dir)?;
            let Some(sc) = flex_core::script::open(&p.dir)? else { anyhow::bail!("no script.json in {}", p.dir.display()) };
            let out = flex_core::tools::out_dir(&p.dir);
            std::fs::create_dir_all(&out)?;
            let sheet = match (&sheet, &animatic) { (None, Some(_)) => None, _ => Some(sheet.map(|s| std::path::absolute(s)).transpose()?.unwrap_or_else(|| out.join("storyboard.png"))) };
            if let Some(s) = sheet { flex_core::script::sheet(&p.dir, &sc, &s, cols, width.unwrap_or(480))?; println!("sheet → {}", s.display()); }
            if let Some(a) = animatic {
                let a = std::path::absolute(a)?;
                flex_core::script::animatic(&p.dir, &sc, p.music_file.as_deref(), sc.length, &a, width.unwrap_or(1280))?;
                println!("animatic → {} ({:.1}s{})", a.display(), sc.length, if sc.length > sc.duration + 0.01 { format!(", the film {:.1}s and the plan past it", sc.duration) } else { String::new() });
            }
            for n in &sc.notes { println!("  ! {n}"); }
        }
        Cmd::Activity(a) => activity::run(a)?,
        Cmd::Open { dir, json } => {
            let p = Project::open(&dir)?;
            if json {
                let scenes: Vec<_> = p.scenes.iter().map(|s| serde_json::json!({
                    "id": s.id, "start": s.start, "end": s.end,
                    "file": s.file.as_ref().map(|f| f.strip_prefix(&p.dir).unwrap_or(f).to_string_lossy().into_owned()),
                    "items": s.items.iter().map(|i| i.label()).collect::<Vec<_>>(),
                })).collect();
                println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                    "name": p.name, "dir": p.dir, "pipeline": p.pipeline, "duration": p.duration,
                    "music": { "key": p.music.key, "file": p.music_file, "segments": p.music.segments }, "scenes": scenes,
                }))?);
            } else {
                println!("{}  {:.2}s  ·  {} scenes  ·  music {}", p.name, p.duration, p.scenes.len(), p.music.key);
                println!("  pipeline  {}", p.pipeline.display());
                if let Some(f) = &p.music_file { println!("  track     {}", f.strip_prefix(&p.dir).unwrap_or(f).display()); }
                if let Some(s) = &p.music.segments { println!("  edit      {} stretches", s.len()); }
                for s in &p.scenes {
                    let items: Vec<_> = s.items.iter().map(|i| i.label()).collect();
                    println!("  {:>6.2} – {:>6.2}  {:<14} {}", s.start, s.end, s.id, items.join(", "));
                }
            }
        }
        Cmd::Frame { dir, at, out, width } => {
            // the app's warm session, when it has the project open (no server to start)
            if let Some((mut c, p)) = app::warm(&dir, !cli.variants.is_empty() || !cli.takes.is_empty()) {
                let f = app::frame_in(&p, &at)?;
                let out = std::path::absolute(&out)?;
                let v = c.call(&flex_core::control::Request::Frame { project: p["dir"].as_str().unwrap_or("").into(), frame: f, width, out: out.clone() }).map_err(|e| anyhow::anyhow!(e))?;
                for sk in v["skipped"].as_array().into_iter().flatten() { eprintln!("  ! left out: {}", sk.as_str().unwrap_or("")); }
                println!("{} · frame {f} ({:.2}s, {}) · {} layers · painted in {} ms (in the Flex app)", out.display(), v["t"].as_f64().unwrap_or(0.), v["scene"].as_str().unwrap_or("?"), v["layers"], v["ms"]);
                return Ok(());
            }
            let s = Session::open(&dir)?;
            let f = frame_at(s.manifest(), &at)?;
            let t = Instant::now();
            match s.server.layers(f)? {
                FrameLayers::Placeholder(why) => anyhow::bail!("frame {f} has nothing to paint yet: {why}"),
                FrameLayers::Error(e) => anyhow::bail!("frame {f}: the scene's code threw:\n{e}"),
                FrameLayers::Layers(layers) => {
                    let p = flex_core::paint::paint_in(&layers, s.manifest().size, width.unwrap_or(s.manifest().size[0])).map_err(|e| anyhow::anyhow!(e))?;
                    flex_core::paint::save(&p.pixmap, &out, 92).map_err(|e| anyhow::anyhow!(e))?;
                    for sk in p.skipped { eprintln!("  ! left out: {sk}"); }
                    println!("{} · frame {f} ({:.2}s, {}) · {} layers · painted in {} ms", out.display(), f as f64 / s.manifest().fps as f64,
                        s.manifest().scene_at(f).map(|x| x.id.as_str()).unwrap_or("?"), layers.len(), t.elapsed().as_millis());
                }
            }
        }
        Cmd::Warm { dir, scene, width } => {
            let s = Session::open(&dir)?;
            let range = scene_range(s.manifest(), &scene)?;
            let t = Instant::now();
            let pr = app::progress("painting");
            let r = s.warm(range, width, |d, n| pr(d as u32, n as u32))?;
            println!("painted {} frames at {width} wide in {:.1}s ({} placeholder, {} failed)", r.painted, t.elapsed().as_secs_f64(), r.placeholders, r.errors.len());
            for e in r.errors.iter().take(5) { eprintln!("  ✗ {e}"); }
            print_status(&s, width);
        }
        Cmd::Status { dir, width, json } => {
            // the app's view, when it's running and has the project (or, without a folder, every project it has open)
            let mut c = app::client(false, false)?;
            let shown = match (&mut c, &dir) {
                (Some(c), None) => {
                    let v = c.call(&flex_core::control::Request::Status { project: None }).map_err(|e| anyhow::anyhow!(e))?;
                    let ps = v["projects"].as_array().cloned().unwrap_or_default();
                    if json { println!("{}", serde_json::to_string_pretty(&ps)?); } else if ps.is_empty() { println!("Flex is running with no project open"); } else { for p in &ps { println!("{}", app::describe(p)); } }
                    true
                }
                (Some(c), Some(d)) => match app::project(c, &std::fs::canonicalize(d)?) {
                    Some(p) => { if json { println!("{}", serde_json::to_string_pretty(&p)?); } else { println!("{}", app::describe(&p)); } true }
                    None => false,
                },
                (None, None) => anyhow::bail!("Flex isn't running: name a project folder (flex status <dir>)"),
                (None, Some(_)) => false,
            };
            if !shown {
                let d = dir.unwrap();
                anyhow::ensure!(!json, "--json reports the app's view, and Flex doesn't have {} open", d.display());
                let s = Session::open(&d)?;
                print_status(&s, width);
            }
        }
        Cmd::Show { dir, at, scene } => {
            let dirc = std::fs::canonicalize(&dir)?;
            anyhow::ensure!(dirc.join("project.ts").exists(), "{} isn't a Flex project (no project.ts)", dirc.display());
            let mut c = app::client(true, true)?.ok_or_else(|| anyhow::anyhow!("Flex isn't running"))?;
            let project = dirc.to_string_lossy().into_owned();
            // open it first (the window loads the film), then move the playhead with what the app knows of it
            let v = c.call(&flex_core::control::Request::Show { project: project.clone(), frame: None }).map_err(|e| anyhow::anyhow!(e))?;
            let p = v["status"].clone();
            let frame = match (&at, &scene) {
                (_, Some(id)) => Some(p["scenes"].as_array().into_iter().flatten().find(|x| x["id"].as_str() == Some(id.as_str())).and_then(|x| x["first"].as_u64())
                    .ok_or_else(|| anyhow::anyhow!("no scene \"{id}\" (scenes: {})", p["scenes"].as_array().into_iter().flatten().filter_map(|x| x["id"].as_str()).collect::<Vec<_>>().join(", ")))? as u32),
                (Some(a), None) if a.contains('.') && !a.ends_with('s') => Some(((film_at(&dirc, a)? * p["fps"].as_f64().unwrap_or(30.)).round()) as u32),
                (Some(a), None) => Some(app::frame_in(&p, a)?),
                (None, None) => None,
            };
            let p = match frame {
                Some(f) => c.call(&flex_core::control::Request::Show { project, frame: Some(f) }).map_err(|e| anyhow::anyhow!(e))?["status"].clone(),
                None => p,
            };
            println!("{}", app::describe(&p));
        }
        Cmd::Diff { dir, at, keep } => {
            let s = Session::open(&dir)?;
            let m = s.manifest();
            let frames: Vec<u32> = if at.is_empty() {
                m.scenes.iter().filter(|x| x.items.iter().all(|i| i.paintable)).map(|x| x.first + x.frames / 2).collect()
            } else { at.iter().map(|a| frame_at(m, a)).collect::<Result<_>>()? };
            let dirp = keep.clone().unwrap_or_else(|| std::env::temp_dir().join("flex-diff"));
            std::fs::create_dir_all(&dirp)?;
            println!("{:>6}  {:<14} {:>9} {:>9}  {:>8}  {:>9}", "frame", "scene", "pipeline", "playhead", "mean Δ", "> 16 off");
            for f in frames {
                let FrameLayers::Layers(layers) = s.server.layers(f)? else { println!("{f:>6}  (nothing to paint)"); continue };
                let rf = dirp.join(format!("{f}.pipeline.png"));
                let t = Instant::now(); s.server.reference(f, &rf)?; let tp = t.elapsed().as_millis();
                let t = Instant::now(); let p = flex_core::paint::paint_in(&layers, m.size, m.size[0]).map_err(|e| anyhow::anyhow!(e))?; let tr = t.elapsed().as_millis();
                let ours = dirp.join(format!("{f}.playhead.png"));
                flex_core::paint::save(&p.pixmap, &ours, 95).map_err(|e| anyhow::anyhow!(e))?;
                let d = flex_core::paint::compare(&rf, &p.pixmap, keep.as_ref().map(|k| k.join(format!("{f}.diff.png"))).as_deref()).map_err(|e| anyhow::anyhow!(e))?;
                println!("{f:>6}  {:<14} {:>7} ms {:>7} ms  {:>6.2}/255 {:>8.2}%", m.scene_at(f).map(|x| x.id.as_str()).unwrap_or("?"), tp, tr, d.mean, d.over * 100.);
            }
            if keep.is_some() { println!("images in {}", dirp.display()); }
        }
        Cmd::Accept { dir, film, every, max_mean, keep, json } => {
            let s = Session::open(&dir)?;
            let m = s.manifest();
            let fps = m.fps as f64;
            // the frames to check: each scene's first and last, and every `every` seconds between
            let mut frames: Vec<u32> = Vec::new();
            for sc in &m.scenes {
                if sc.frames == 0 { continue; }
                let (a, b) = (sc.first, sc.first + sc.frames - 1);
                frames.push(a);
                let step = ((every * fps).round() as u32).max(1);
                let mut f = a + step; while f < b { frames.push(f); f += step; }
                frames.push(b);
            }
            frames.sort(); frames.dedup();
            let dirp = keep.clone().unwrap_or_else(|| std::env::temp_dir().join("flex-accept"));
            std::fs::create_dir_all(&dirp)?;
            let mut rows = Vec::new(); let mut fails = 0usize; let mut placeholders = 0usize;
            if !json { println!("{:>6} {:>8}  {:<14} {:>8}  {:>9}  {}", "frame", "time", "scene", "mean Δ", "> 16 off", ""); }
            for f in &frames {
                let f = *f; let t = f as f64 / fps;
                let scene = m.scene_at(f).map(|x| x.id.clone()).unwrap_or_default();
                let layers = match s.server.layers(f)? {
                    FrameLayers::Layers(l) => l,
                    FrameLayers::Placeholder(why) => { placeholders += 1; fails += 1; rows.push(serde_json::json!({"frame": f, "scene": scene, "placeholder": why})); if !json { println!("{f:>6} {t:>7.2}s  {scene:<14} placeholder: {why}"); } continue }
                    FrameLayers::Error(e) => { fails += 1; rows.push(serde_json::json!({"frame": f, "scene": scene, "error": e})); if !json { println!("{f:>6} {t:>7.2}s  {scene:<14} ERROR: {}", e.lines().next().unwrap_or("")); } continue }
                };
                let p = flex_core::paint::paint_in(&layers, m.size, m.size[0]).map_err(|e| anyhow::anyhow!(e))?;
                let rf = dirp.join(format!("{f}.film.png"));
                // the film's frame f: ffmpeg returns the first frame at or after the time, so aim a quarter frame before f
                let st = std::process::Command::new("ffmpeg").args(["-v", "error", "-y", "-ss", &format!("{:.4}", ((f as f64 - 0.25) / fps).max(0.0)), "-i"]).arg(&film)
                    .args(["-frames:v", "1", "-vf", &format!("scale={}:{}:flags=lanczos", m.size[0], m.size[1])]).arg(&rf).status()?;
                if !st.success() { anyhow::bail!("ffmpeg couldn't read frame {f} of {}", film.display()); }
                if keep.is_some() { flex_core::paint::save(&p.pixmap, &dirp.join(format!("{f}.flex.png")), 95).map_err(|e| anyhow::anyhow!(e))?; }
                let d = flex_core::paint::compare(&rf, &p.pixmap, None).map_err(|e| anyhow::anyhow!(e))?;
                let bad = d.mean > max_mean; if bad { fails += 1; }
                rows.push(serde_json::json!({"frame": f, "time": t, "scene": scene, "mean": d.mean, "over16": d.over, "ok": !bad}));
                if !json { println!("{f:>6} {t:>7.2}s  {scene:<14} {:>6.2}/255 {:>8.2}%  {}", d.mean, d.over * 100., if bad { "✗" } else { "" }); }
            }
            // the sound: Flex's mix against the film's, by loudness (same cues and levels → within a fraction of a LU)
            let mix = dirp.join("flex-mix.wav");
            let mut audio = serde_json::json!(null);
            if s.server.mix(&mix).is_ok() {
                let lufs = |p: &std::path::Path| -> Option<f64> {
                    let o = std::process::Command::new("ffmpeg").args(["-nostats", "-i"]).arg(p).args(["-af", "ebur128", "-f", "null", "-"]).output().ok()?;
                    let e = String::from_utf8_lossy(&o.stderr);
                    e.lines().rev().find(|l| l.trim_start().starts_with("I:")).and_then(|l| l.split_whitespace().nth(1)?.parse().ok())
                };
                if let (Some(a), Some(b)) = (lufs(&mix), lufs(&film)) {
                    let ok = (a - b).abs() <= 0.5; if !ok { fails += 1; }
                    audio = serde_json::json!({"flex_lufs": a, "film_lufs": b, "ok": ok});
                    if !json { println!("mix: Flex {a:.1} LUFS, film {b:.1} LUFS  {}", if ok { "" } else { "✗" }); }
                }
            } else { fails += 1; if !json { println!("mix: failed"); } }
            let summary = serde_json::json!({"frames": rows.len(), "fails": fails, "placeholders": placeholders, "max_mean": max_mean, "audio": audio, "rows": rows});
            if json { println!("{summary}"); } else { println!("{} frames checked, {fails} failing, {placeholders} placeholder(s){}", frames.len(), if keep.is_some() { format!(" · pairs in {}", dirp.display()) } else { String::new() }); }
            if fails > 0 { exit(1); }
        }
        Cmd::Watch { dir, width, at } => {
            let e = flex_core::Engine::open(&dir, width);
            let mut last_gen = 0; let mut last_line = String::new();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(200));
                let st = e.state();
                if let (Some(a), Some(s)) = (&at, e.session()) { if let Ok(f) = frame_at(s.manifest(), a) { e.set_playhead(f); } }
                if let Some(err) = &st.error { let l = format!("✗ {err}"); if l != last_line { println!("{l}"); last_line = l; } continue; }
                if st.generation != last_gen {
                    last_gen = st.generation;
                    println!("reload {} · {} frames changed · {} ms", st.generation, st.changed, st.last_reload_ms);
                }
                let snd = if st.mixing { "  mixing…".to_string() } else if let Some(m) = &st.mix { format!("  sound: {} ({} lines)", m.file_name().unwrap_or_default().to_string_lossy(), st.voice.len()) } else if let Some(e) = &st.mix_error { format!("  ✗ mix: {}", e.lines().next().unwrap_or("")) } else { String::new() };
                let l = st.scenes.iter().map(|(id, n, t)| format!("{id} {n}/{t}")).collect::<Vec<_>>().join(" · ") + if st.painting { "  painting…" } else { "" } + &snd;
                if l != last_line { println!("  {l}"); last_line = l; }
            }
        }
        Cmd::Doctor { json } => {
            let checks = flex_core::doctor::run();
            if json { println!("{}", serde_json::to_string_pretty(&checks)?); } else {
                for c in &checks {
                    println!("{} {:<34} {}", if c.ok { "✓" } else if c.required { "✗" } else { "·" }, c.name, c.detail);
                    if !c.ok { println!("  {:<34} fix: {}", "", c.fix); }
                }
            }
            if checks.iter().any(|c| c.required && !c.ok) { exit(1); }
        }
        Cmd::New { dir, music, name, feel, licence } => {
            let c = flex_core::new::create(&dir, name.as_deref(), &music, feel.as_deref(), licence.as_deref())?;
            println!("{} → {}", c.name, c.dir.display());
            for f in &c.files { println!("  {f}"); }
            println!("next: flex music {0}   (the track, read for cutting)\n      flex open {0}  ·  the app: open the folder", dir.display());
        }
        Cmd::Run { dir, tool, args } => {
            let Some(tool) = tool else {
                let p = flex_core::project::find_pipeline(&std::fs::canonicalize(&dir)?)?;
                for (k, s) in flex_core::tools::list(&p) { println!("  {k:<16} {s}"); }
                return Ok(());
            };
            let st = flex_core::tools::command(&dir, &tool, &args)?.status()?;
            if !st.success() { exit(st.code().unwrap_or(1)); }
        }
        Cmd::Render { dir, size, audio_only: true, .. } => {
            let dirc = std::fs::canonicalize(&dir)?;
            let (_, tag) = flex_core::project::output_size(flex_core::project::frame_size(&dirc), size.as_deref()).map_err(|e| anyhow::anyhow!(e))?;
            let film = flex_core::tools::project_name(&dirc);
            let out = flex_core::tools::out_dir(&dirc).join(format!("{film}{tag}.mp4"));
            anyhow::ensure!(out.exists(), "no render of the whole film yet ({}): render it first", out.display());
            let t0 = Instant::now();
            let mix = std::env::temp_dir().join(format!("flex-render-mix-{}.wav", std::process::id()));
            eprintln!("mixing the sound…");
            flex_core::Server::start(&dirc)?.mix(&mix)?;
            let tmp = out.with_extension("rendering.mp4");
            let st = std::process::Command::new("ffmpeg").args(["-v", "error", "-y", "-i"]).arg(&out).arg("-i").arg(&mix)
                .args(["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]).arg(&tmp)
                .env("PATH", flex_core::project::login_path()).status()?;
            let _ = std::fs::remove_file(&mix);
            if !st.success() { let _ = std::fs::remove_file(&tmp); anyhow::bail!("ffmpeg couldn't put the sound in"); }
            // the picture is copied whole (no -shortest: it cut the last frames at a packet boundary); check it
            let frames = |f: &std::path::Path| std::process::Command::new("ffprobe").args(["-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0"]).arg(f)
                .env("PATH", flex_core::project::login_path()).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
            let (before, after) = (frames(&out), frames(&tmp));
            if before != after { let _ = std::fs::remove_file(&tmp); anyhow::bail!("the new file has {after:?} frames, the render {before:?}: kept the render as it was"); }
            std::fs::rename(&tmp, &out)?;
            println!("→ {} (new sound, same picture; {:.0} s)", out.display(), t0.elapsed().as_secs_f64());
        }
        Cmd::Render { dir, scene, size, range: Some(range), .. } => {
            anyhow::ensure!(scene.is_none(), "--range is a stretch of the whole film; leave out --scene");
            let dirc = std::fs::canonicalize(&dir)?;
            let (a, b) = range.split_once(':').ok_or_else(|| anyhow::anyhow!("--range A:B (film seconds like 76.6s, or bar.beat like 37), not \"{range}\""))?;
            let (a, b) = (film_at(&dirc, a)?, film_at(&dirc, b)?);
            anyhow::ensure!(b > a, "--range: the end comes before the start");
            let part = flex_core::render::Part::Range { from: a, to: b };
            let r = match render_in_app(&dirc, &part, size.as_deref(), true, !cli.variants.is_empty() || !cli.takes.is_empty())? {
                Some(r) => r,
                None => {
                    let s = Session::open_unkeyed(&dirc)?;
                    flex_core::render::render_film(&s, &part, size.as_deref(), |m| eprintln!("{m}"), app::progress("painting"))?
                }
            };
            for n in &r.notes { eprintln!("  note: {n}"); }
            println!("→ {} ({:.2}–{:.2} s; {:.0} s)", r.out.display(), a, b, r.secs);
        }
        Cmd::Render { dir, scene, size, fast, pipeline, .. } => {
            let dirc = std::fs::canonicalize(&dir)?;
            let part = match &scene { Some(id) => flex_core::render::Part::Scene { id: id.clone() }, None => flex_core::render::Part::Film };
            // through the app when it has the film open (its warm session); it says when the film needs the pipeline
            let in_app = if pipeline { None } else { render_in_app(&dirc, &part, size.as_deref(), fast, !cli.variants.is_empty() || !cli.takes.is_empty())? };
            // Flex's painter renders what its preview shows (one engine for both); the pipeline renders captured takes
            let painter = if pipeline || in_app.is_some() { None } else {
                let s = Session::open_unkeyed(&dirc)?;
                let why = flex_core::render::painter_refuses(&s);
                if fast { let b = flex_core::render::blockers(&s); anyhow::ensure!(b.is_empty(), "Flex's painter can't render this film yet ({}): render without --fast", b.join("; ")); }
                (fast || why.is_empty()).then_some(s)
            };
            let done = match (in_app, painter) {
                (Some(r), _) => Some(r),
                (None, Some(s)) => Some(flex_core::render::render_film(&s, &part, size.as_deref(), |m| eprintln!("{m}"), app::progress("painting"))?),
                (None, None) => None,
            };
            if let Some(r) = done {
                for n in &r.notes { eprintln!("  note: {n}"); }
                println!("→ {} (Flex's painter, {:.0} s)", r.out.display(), r.secs);
            } else {
                let mut a = vec!["@folder".to_string()];
                if let Some(s) = scene { a.push("--scene".into()); a.push(s); }
                let mut c = flex_core::tools::command(&dir, "video", &a)?;
                if let Some(s) = size { c.env("OUT_SIZE", s); } // the pipeline scales the film's frame (FLEX_FRAME) by it
                let st = c.status()?;
                if !st.success() { exit(st.code().unwrap_or(1)); }
                println!("→ {}", flex_core::tools::out_dir(&dirc).display());
            }
        }
        Cmd::Music { dir, key, lyrics, at, sheet, from, to, out, json } => {
            let mut a: Vec<String> = key.into_iter().collect();
            if sheet { a.push("--sheet".into()); }
            if let Some(f) = from { a.push("--from".into()); a.push(f.to_string()); }
            if let Some(t) = to { a.push("--to".into()); a.push(t.to_string()); }
            if let Some(o) = out { a.push("-o".into()); a.push(std::path::absolute(&o)?.to_string_lossy().into_owned()); } // the script runs in the pipeline: a path relative to here
            if let Some(x) = at { a.push("--at".into()); a.push(x); }
            if lyrics { a.push("--lyrics".into()); }
            if json { a.push("--json".into()); }
            let st = flex_core::tools::music(&dir, &a)?.status()?;
            if !st.success() { exit(st.code().unwrap_or(1)); }
        }
        Cmd::Cutout { file, out, from, to, keep_text, smooth, floor, preview, json } => {
            let r = flex_core::cutout::run(&flex_core::cutout::Options { input: file, out, from: secs_opt(from)?, to: secs_opt(to)?, keep_text, smooth, floor, preview })?;
            if json { println!("{}", serde_json::to_string(&r)?); } else { println!("{}", r.summary()); for n in &r.notes { println!("  note: {n}"); } }
        }
        Cmd::Onsets { file, from, to, project, expect, min_gap, json } => {
            let o = flex_core::onsets::run(&flex_core::onsets::Options { file, from: secs_opt(Some(from))?.unwrap(), to: secs_opt(Some(to))?.unwrap(), project, expect, min_gap })?;
            if json { println!("{}", serde_json::to_string(&o)?); } else {
                for x in &o { println!("{:>9.3} s{}{}  {:<9} {:.2}", x.t, x.film.map(|f| format!("  film {f:>8.3} s")).unwrap_or_default(), x.at.as_ref().map(|a| format!("  {a:<8}")).unwrap_or_default(), x.kind, x.strength); }
            }
        }
        Cmd::Crop { file, cell, subject, max, place, out, json } => {
            let pair = |s: &str, what: &str| -> Result<(f64, f64)> { let (a, b) = s.split_once(':').ok_or_else(|| anyhow::anyhow!("{what}: A:B, not \"{s}\""))?; Ok((a.trim().parse()?, b.trim().parse()?)) };
            let (cw, ch) = pair(&cell, "--cell")?;
            let subject = match subject.as_str() { "face" => flex_core::crop::Subject::Face, "person" => flex_core::crop::Subject::Person, "centre" | "center" => flex_core::crop::Subject::Centre, x => anyhow::bail!("--subject: face, person or centre, not \"{x}\"") };
            let r = flex_core::crop::run(&flex_core::crop::Options { input: file, cell: (cw as u32, ch as u32), subject, max, place: place.map(|p| pair(&p, "--place")).transpose()?, out })?;
            if json { println!("{}", serde_json::to_string(&r)?); } else { println!("{}", r.summary()); }
        }
        Cmd::Sheet { file, from, to, fps, cols, thumb, no_label, reference, out, json } => {
            let r = flex_core::sheet::run(&flex_core::sheet::Options { input: file, from: secs_opt(from)?, to: secs_opt(to)?, fps, cols, thumb, label: !no_label, reference, out })?;
            if json { println!("{}", serde_json::to_string(&r)?); } else { println!("{}", r.summary()); for (t, d) in &r.diffs { println!("  {t:>8.3} s  Δ {d:.2}"); } }
        }
        Cmd::Read { file, fast, langs, json } => {
            let t = flex_core::read::run(&file, fast, &langs)?;
            if json { println!("{}", serde_json::to_string(&t)?); } else { print!("{}", t.plain()); }
        }
        Cmd::Transcribe { file, from, to, language, json } => {
            let secs = |s: Option<String>| -> Result<Option<f64>> { s.map(|x| x.trim_end_matches('s').parse::<f64>().map_err(|_| anyhow::anyhow!("a time in seconds, not \"{x}\""))).transpose() };
            let words = flex_core::transcribe::run(&file, secs(from)?, secs(to)?, language.as_deref())?;
            if json { println!("{}", serde_json::to_string(&serde_json::json!({ "ok": true, "file": file, "words": words }))?); } else {
                let mut line = u32::MAX;
                for w in &words {
                    if w.line != line { if line != u32::MAX { println!(); } line = w.line; }
                    print!("{} ", match &w.at { Some(a) => format!("{}[{:.2}s {a}]", w.word, w.start), None => format!("{}[{:.2}s]", w.word, w.start) });
                }
                println!();
                if words.is_empty() { println!("(nothing heard)"); }
            }
        }
        Cmd::Mix { dir, out, only, from, to, json } => {
            if let Some(o) = &only { anyhow::ensure!(["music", "voice", "sfx"].contains(&o.as_str()), "--only music, voice or sfx, not \"{o}\""); }
            let dirc = std::fs::canonicalize(&dir)?;
            let film = flex_core::tools::project_name(&dirc);
            let out = out.unwrap_or_else(|| flex_core::tools::out_dir(&dirc).join(format!("{film}{}.wav", only.as_ref().map(|o| format!("--{o}")).unwrap_or_default())));
            if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
            let t0 = Instant::now();
            let srv = flex_core::Server::start(&dirc)?;
            let full = std::env::temp_dir().join(format!("flex-mix-{}.wav", std::process::id()));
            match &only { Some(o) => srv.mix_only(&full, o)?, None => srv.mix(&full)? };
            // a stretch, by film seconds or film bar.beat
            let when = |s: &Option<String>| -> Result<Option<f64>> {
                let Some(s) = s else { return Ok(None) };
                if let Some(x) = s.strip_suffix('s') { return Ok(Some(x.parse::<f64>().map_err(|_| anyhow::anyhow!("{s}: not a time"))?)); }
                let p = Project::open(&dirc)?;
                let g = flex_core::filmgrid::FilmGrid::load(&p.dir, &p.music, p.duration)?;
                g.parse_at(s).map(Some).ok_or_else(|| anyhow::anyhow!("{s}: seconds (12.5s) or a film bar.beat (15.2)"))
            };
            let (a, b) = (when(&from)?, when(&to)?);
            let mut ff = std::process::Command::new("ffmpeg");
            ff.args(["-v", "error", "-y"]);
            if let Some(a) = a { ff.args(["-ss", &a.to_string()]); }
            if let Some(b) = b { ff.args(["-to", &b.to_string()]); }
            ff.arg("-i").arg(&full).arg(&out);
            anyhow::ensure!(ff.status()?.success(), "ffmpeg couldn't write {}", out.display());
            let _ = std::fs::remove_file(&full);
            // its loudness (integrated, true peak)
            let o = std::process::Command::new("ffmpeg").args(["-hide_banner", "-nostats", "-i"]).arg(&out).args(["-af", "ebur128=peak=true", "-f", "null", "-"]).output()?;
            let log = String::from_utf8_lossy(&o.stderr);
            let grab = |k: &str| log.lines().rev().find_map(|l| l.trim().strip_prefix(k).map(|r| r.trim().to_string()));
            let (lufs, peak) = (grab("I:"), grab("Peak:"));
            if json { println!("{}", serde_json::json!({ "ok": true, "file": out, "only": only, "from": a, "to": b, "lufs": lufs, "truePeak": peak, "seconds": t0.elapsed().as_secs_f64() })); }
            else { println!("{} · {} · peak {} · {:.1} s", out.display(), lufs.unwrap_or_default(), peak.unwrap_or_default(), t0.elapsed().as_secs_f64()); }
        }
        Cmd::Cuts { dir, off, json } => {
            let dirc = std::fs::canonicalize(&dir)?;
            let srv = flex_core::Server::start(&dirc)?;
            let cuts: Vec<_> = flex_core::cuts::check(&dirc, &srv.manifest)?.into_iter().filter(|c| !off || !c.on).collect();
            if json { println!("{}", serde_json::to_string(&cuts)?); } else {
                println!("{:>8}  {:<10} {:<44} {:<22} {:>7}", "film", "bar.beat", "cut", "nearest", "from it");
                for c in &cuts {
                    // a scene change shows the scenes; a change inside one, the scene and its items
                    let (sa, la) = c.from.split_once('/').unwrap_or((&c.from, ""));
                    let (sb, lb) = c.to.split_once('/').unwrap_or((&c.to, ""));
                    let what = if c.scene { format!("| {sa} → {sb}") } else { format!("  {sa}: {la} → {lb}") };
                    let what: String = if what.chars().count() > 44 { what.chars().take(43).collect::<String>() + "…" } else { what };
                    println!("{:>7.3}s  {:<10} {:<44} {:<22} {:>+5} ms {}", c.t, c.at, what, c.nearest, c.off_ms,
                        if c.on { "" } else if c.declared { "between beats (a declared cut)" } else { "between beats" });
                }
                let n = cuts.iter().filter(|c| !c.on).count();
                println!("{} cuts, {} more than {} ms from every beat and declared hit (± 17 ms is the frame grid)", cuts.len(), n, flex_core::cuts::OFF_MS);
            }
        }
        Cmd::Narration { dir, json } => {
            let dirc = std::fs::canonicalize(&dir)?;
            let srv = flex_core::Server::start(&dirc)?;
            let lines = flex_core::narration::check(&dirc, &srv)?;
            if json { println!("{}", serde_json::to_string(&lines)?); } else {
                for l in &lines {
                    println!("{:>7.2}s  {:<9} “{}”{}", l.t, l.at, l.text, if l.over_singing.is_empty() { String::new() } else { format!("  ← over singing: {}", l.over_singing.join(" ")) });
                    println!("          {}", l.words.iter().map(|w| format!("{}[{} {:+}ms]", w.word, w.at, w.off_beat_ms)).collect::<Vec<_>>().join(" "));
                }
                if lines.is_empty() { println!("(no narration)"); }
            }
        }
        Cmd::Card { dir, card, params, dur, at, out, width, json } => {
            let mut a: Vec<String> = card.into_iter().collect();
            if let Some(p) = params { a.push("--params".into()); a.push(p); }
            if let Some(d) = dur { a.push("--dur".into()); a.push(d.to_string()); }
            if let Some(t) = at { a.push("--at".into()); a.push(t.to_string()); }
            if let Some(o) = out { a.push("-o".into()); a.push(std::path::absolute(&o)?.to_string_lossy().into_owned()); } // the script runs in the pipeline: a path relative to here
            if let Some(w) = width { a.push("--width".into()); a.push(w.to_string()); }
            if json { a.push("--json".into()); }
            let st = flex_core::tools::card(&dir, &a)?.status()?;
            if !st.success() { exit(st.code().unwrap_or(1)); }
        }
        Cmd::Duck { dir, json } => {
            let st = flex_core::tools::duck(&dir, &if json { vec!["--json".into()] } else { vec![] })?.status()?;
            if !st.success() { exit(st.code().unwrap_or(1)); }
        }
        Cmd::Shift { dir, at, by, json } => {
            let dirc = std::fs::canonicalize(&dir)?;
            let srv = flex_core::Server::start(&dirc)?;
            let m = &srv.manifest;
            let music = flex_core::Music { key: m.music.key.clone(), segments: m.music.segments.clone(), from: m.music.from, tracks: m.music.tracks.clone() };
            let g = flex_core::filmgrid::FilmGrid::load(&dirc, &music, m.duration)?;
            let t0 = if let Some(x) = at.strip_suffix('s') { x.parse::<f64>()? } else { g.parse_at(&at).ok_or_else(|| anyhow::anyhow!("{at}: film seconds (52.3s) or a film bar.beat (23.1)"))? };
            let bar = g.beat * 4.0;
            let (delta, bars) = if let Some(x) = by.strip_suffix('s') { (x.trim_start_matches('+').parse::<f64>()?, None) } else { let n: f64 = by.trim_start_matches('+').parse()?; (n * bar, Some(n)) };
            let after = |t: f64| -> String {
                let a = g.at(t);
                // whole bars: the same beat, n bars on; anything else moves things off the grid they were placed on
                match (bars, a.split_once('.')) { (Some(n), Some((b, rest))) if n.fract() == 0.0 => b.parse::<i64>().map(|b| format!("{}.{rest}", b + n as i64)).unwrap_or(a), _ => "off-grid".into() }
            };
            let mut rows: Vec<(f64, String, String)> = vec![];
            for sc in &m.scenes { for it in &sc.items { if it.start >= t0 - 1e-6 { rows.push((it.start, if it.start == sc.start { format!("scene {}", sc.id) } else { format!("  {} item {}", sc.id, it.label) }, String::new())); } } }
            if let Some(mk) = &m.markers {
                for h in &mk.hits { if h.t >= t0 - 1e-6 { rows.push((h.t, format!("hit {}", h.label), String::new())); } }
                for s in &mk.sections { if s.start >= t0 - 1e-6 { rows.push((s.start, format!("section {}", s.id), String::new())); } }
            }
            for v in srv.cues()?["voice"].as_array().cloned().unwrap_or_default() {
                let t = v["t"].as_f64().unwrap_or(0.0) / 1000.0;
                if t >= t0 - 1e-6 { rows.push((t, format!("line “{}”", v["text"].as_str().unwrap_or("").chars().take(36).collect::<String>()), String::new())); }
            }
            for (i, (f, s)) in g.starts.iter().zip(&g.segments).enumerate() { if *f >= t0 - 1e-6 && *f > 0.0 {
                let what = if i > 0 && g.tracks[i] != g.tracks[i - 1] { format!("music switch → {} (song {:.2} s)", g.tracks[i], s[0]) } else { format!("music edit join (song {:.2} s)", s[0]) };
                rows.push((*f, what, String::new())); } }
            rows.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
            if json {
                println!("{}", serde_json::json!({ "ok": true, "at": t0, "by": delta, "moves": rows.iter().map(|(t, what, _)| serde_json::json!({ "what": what, "t": t, "to": t + delta, "at": g.at(*t), "toAt": after(*t) })).collect::<Vec<_>>() }));
            } else {
                println!("at {:.3} s (bar {}), {} {:.3} s{}: {} things move; the film becomes {:.2} s", t0, g.at(t0), if delta >= 0.0 { "+" } else { "−" }, delta.abs(), bars.map(|n| format!(" ({n:+} bars)")).unwrap_or_default(), rows.len(), m.duration + delta);
                for (t, what, _) in &rows { println!("  {:>8.3} → {:>8.3} s   {:<9} → {:<9}  {}", t, t + delta, g.at(*t), after(*t), what); }
                println!("(a preview: the project's files are unchanged; the music edit's new stretch and the times above are the film's own edits)");
            }
        }
        Cmd::Grid { dir, at, json } => {
            let p = Project::open(&dir)?;
            let g = flex_core::filmgrid::FilmGrid::load(&p.dir, &p.music, p.duration)?;
            if let Some(a) = at {
                let (film, song): (Vec<f64>, Option<f64>) = if let Some(x) = a.strip_prefix("song:") {
                    let t: f64 = x.trim_end_matches('s').parse()?;
                    (g.to_film(t), Some(t))
                } else if let Some(x) = a.strip_suffix('s') {
                    let t: f64 = x.parse()?;
                    (vec![t], g.to_song(t))
                } else {
                    let t = g.parse_at(&a).ok_or_else(|| anyhow::anyhow!("no film bar.beat {a} (bars 1–{})", g.bars.len()))?;
                    (vec![t], g.to_song(t))
                };
                if json {
                    println!("{}", serde_json::json!({ "ok": true, "film": film.iter().map(|t| serde_json::json!({ "t": t, "at": g.at(*t) })).collect::<Vec<_>>(), "song": song }));
                } else {
                    if film.is_empty() { println!("song {:.3} s: the edit doesn't play it", song.unwrap_or(0.0)); }
                    for t in &film { println!("film {t:.3} s = bar {}{}", g.at(*t), song.map(|s| format!(" · song {s:.3} s")).unwrap_or_default()); }
                }
                return Ok(());
            }
            if json {
                println!("{}", serde_json::json!({ "ok": true, "bpm": g.bpm, "beat": g.beat, "corrected": g.corrected, "bars": g.bars,
                    "segments": g.segments.iter().zip(&g.starts).zip(&g.tracks).map(|((s, f), k)| serde_json::json!({ "song": s, "film": f, "at": g.at(*f), "track": k })).collect::<Vec<_>>() }));
            } else {
                println!("{} · {} bpm · {} film bars over {:.2} s{}", p.name, g.bpm, g.bars.len(), p.duration,
                    if g.corrected { "" } else { " · grid not phase-checked (run flex music)" });
                if g.segments.len() > 1 {
                    println!("the music edit ({} stretches):", g.segments.len());
                    for ((s, f), k) in g.segments.iter().zip(&g.starts).zip(&g.tracks) { println!("  film {:>7.3} s  bar {:<8} ← {k} {:.3}–{:.3} s", f, g.at(*f), s[0], s[1]); }
                }
            }
        }
        Cmd::Key { action, name } => {
            let name = name.unwrap_or_else(|| flex_core::secrets::OPENAI.into());
            match action.as_deref() {
                Some("set") => {
                    let mut k = String::new();
                    if atty_stdin() { eprint!("{name} key: "); }
                    std::io::stdin().read_line(&mut k)?;
                    anyhow::ensure!(!k.trim().is_empty(), "no key given");
                    flex_core::secrets::set(&name, &k)?;
                    println!("saved the {name} key (Flex keeps it in its support folder, readable only by you)");
                }
                Some("remove") => { flex_core::secrets::remove(&name)?; println!("removed the {name} key"); }
                None | Some("show") => {
                    println!("{name} key: {}", if flex_core::secrets::get(&name).is_some() { "saved" } else { "not set" });
                    println!("voice: {}", flex_core::secrets::voice_engine(None));
                }
                Some(a) => anyhow::bail!("flex key set|remove|show, not \"{a}\""),
            }
        }
        Cmd::Camera { dir, take, id, start, end, shift, on, off, params, lock, unlock, json } => {
            if let (Some(t), Some(id)) = (&take, &id) {
                let params = params.iter().map(|kv| {
                    let (k, v) = kv.split_once('=').ok_or_else(|| anyhow::anyhow!("--param takes key=value, not \"{kv}\""))?;
                    Ok((k.to_string(), serde_json::from_str(v).unwrap_or_else(|_| serde_json::Value::String(v.to_string()))))
                }).collect::<Result<Vec<_>>>()?;
                let e = flex_core::camera::Edit { start, end, shift, enabled: if on { Some(true) } else if off { Some(false) } else { None }, params };
                let (s, en) = flex_core::camera::edit(&dir, t, id, &e)?;
                if json { println!("{}", serde_json::json!({ "ok": true, "take": t, "id": id, "start": s, "end": en })); }
                else { println!("{t} {id}: {s}–{en} ms (the plan is locked)"); }
                return Ok(());
            }
            if let (Some(t), true) = (&take, lock || unlock) {
                flex_core::camera::set_locked(&dir, t, lock)?;
                println!("{t}: {}", if lock { "locked" } else { "unlocked: the next capture's automatic plan replaces it" });
                return Ok(());
            }
            let s = Session::open(&dir)?;
            let m = s.manifest();
            let clips: Vec<_> = m.scenes.iter().flat_map(|sc| sc.items.iter().filter_map(move |it| it.take.as_ref().map(|c| (sc, it, c))))
                .filter(|(_, _, c)| take.as_ref().is_none_or(|t| t == &c.take)).collect();
            if json {
                let out: Vec<_> = clips.iter().map(|(sc, it, c)| serde_json::json!({ "scene": sc.id, "start": it.start, "camera": c })).collect();
                println!("{}", serde_json::to_string_pretty(&out)?);
                return Ok(());
            }
            for (scene, it, c) in clips {
                println!("{} → {} [{:.2}–{:.2} s of the take, film {:.2} s]{}{}", scene.id, c.take, c.from, c.to, it.start,
                    if c.locked { " · locked" } else { "" }, if c.patched { " · the scene patches this plan" } else { "" });
                let film = |ms: f64| it.start + ms / 1000.0 - c.from;
                for (kind, list) in [("zoom", &c.segments), ("effect", &c.effects)] {
                    for b in list {
                        let what = if kind == "zoom" { format!("×{} {}", b.scale.unwrap_or(1.0), b.kind.clone().unwrap_or_default()) } else { b.effect_type.clone().unwrap_or_default() };
                        println!("  {:<4} {:<6} {:>6}–{:<6} ms  film {:>7.2}–{:<7.2}  {}{}", b.id.as_deref().unwrap_or("?"), kind, b.start, b.end, film(b.start), film(b.end), what, if b.enabled { "" } else { "  (off)" });
                    }
                }
            }
        }
        Cmd::Journeys { dir, json } => capture_cmd(&dir, "journeys", if json { vec!["--json".into()] } else { vec![] })?,
        Cmd::Capture { dir, journey, dry, dpr, no_warm, yes, force, json } => {
            let mut a = vec![journey];
            for (on, f) in [(dry, "--dry"), (no_warm, "--no-warm"), (yes, "--yes"), (force, "--force"), (json, "--json")] { if on { a.push(f.into()); } }
            if let Some(d) = dpr { a.push("--dpr".into()); a.push(d.to_string()); }
            capture_cmd(&dir, "run", a)?
        }
        Cmd::Report { dir, take, version, json } => {
            let mut a = vec![take]; a.extend(version);
            if json { a.push("--json".into()); }
            capture_cmd(&dir, "report", a)?
        }
        Cmd::Pick { dir, take, version, json } => {
            let mut a = vec![take, version];
            if json { a.push("--json".into()); }
            capture_cmd(&dir, "pick", a)?
        }
        Cmd::Walk { dir, view, full, dpr, json } => {
            let mut a = vec![];
            if let Some(v) = view { a.push("--view".into()); a.push(v); }
            if let Some(d) = dpr { a.push("--dpr".into()); a.push(d.to_string()); }
            if full { a.push("--full".into()); }
            if json { a.push("--json".into()); }
            capture_cmd(&dir, "walk", a)?
        }
        Cmd::Freeze { dir, persona, page, name, view, full, element, wait, dpr, json } => {
            let mut a = vec![persona, page];
            for (k, v) in [("--name", name), ("--view", view), ("--element", element), ("--wait", wait), ("--dpr", dpr.map(|d| d.to_string()))] { if let Some(v) = v { a.push(k.into()); a.push(v); } }
            if full { a.push("--full".into()); }
            if json { a.push("--json".into()); }
            capture_cmd(&dir, "freeze", a)?
        }
        Cmd::Prune { dir, take, keep, yes, json } => {
            let mut a: Vec<String> = take.into_iter().collect();
            a.push("--keep".into()); a.push(keep.to_string());
            if yes { a.push("--yes".into()); }
            if json { a.push("--json".into()); }
            capture_cmd(&dir, "prune", a)?
        }
        Cmd::Stage { dir, script, yes, json } => {
            let mut a: Vec<String> = script.into_iter().collect();
            if yes { a.push("--yes".into()); }
            if json { a.push("--json".into()); }
            capture_cmd(&dir, "stage", a)?
        }
        Cmd::Joins { dir, json } => {
            let s = Session::open(&dir)?;
            let joins = flex_core::joins::check(&s)?;
            if json { println!("{}", serde_json::to_string_pretty(&joins)?); } else {
                println!("{:>6} {:>8}  {:<28} {:>8} {:>9}", "frame", "time", "join", "mean Δ", "baseline");
                for j in &joins {
                    let name = format!("{} → {}", j.prev, j.scene);
                    match &j.unknown {
                        Some(why) => println!("{:>6} {:>7.2}s  {name:<28} not checked: {why}", j.frame, j.t),
                        None => println!("{:>6} {:>7.2}s  {name:<28} {:>6.2}/255 {:>6.2}/255  {}", j.frame, j.t, j.mean, j.baseline, if j.cut { "cut (intended)" } else if j.jumps { "✗ jump" } else { "seamless" }),
                    }
                }
                let n = joins.iter().filter(|j| j.jumps).count();
                let c = joins.iter().filter(|j| j.cut).count();
                println!("{} joins, {n} jump{}, {c} intended cut{}", joins.len(), if n == 1 { "" } else { "s" }, if c == 1 { "" } else { "s" });
            }
        }
        Cmd::Play { dir, to_dir, scene, width } => {
            let s = Session::open(&dir)?;
            let range = scene_range(s.manifest(), &scene)?;
            let t = Instant::now();
            let pr = app::progress("painting");
            let r = s.warm(range.clone(), width, |d, n| pr(d as u32, n as u32))?;
            std::fs::create_dir_all(&to_dir)?;
            let mut n = 0;
            for f in range.clone() {
                if let Some(p) = s.cached(f, width) { std::fs::copy(&p, to_dir.join(format!("{f:06}.jpg")))?; n += 1; }
            }
            println!("{n} of {} frames → {} ({} newly painted, {:.1}s)", range.len(), to_dir.display(), r.painted, t.elapsed().as_secs_f64());
        }
    }
    Ok(())
}

fn print_status(s: &Session, width: u32) {
    for (scene, e) in &s.errors { println!("  ✗ {scene}: {}", e.lines().next().unwrap_or("")); }
    for (id, n, total) in s.status(width) {
        let sc = s.manifest().scenes.iter().find(|x| x.id == id).unwrap();
        let note = if sc.items.iter().all(|i| i.paintable) { String::new() } else { format!("  ({})", sc.items.iter().filter(|i| !i.paintable).map(|i| i.label.as_str()).collect::<Vec<_>>().join(", ")) };
        let bar: String = (0..20).map(|i| if (i as u32) * total < n * 20 { '█' } else { '·' }).collect();
        println!("  {id:<14} {bar} {n:>4}/{total:<4}{note}");
    }
}

#[cfg(test)]
mod tests {
    /// every command's flags parse together (a flag name used twice, e.g. a command's own and a global one, panics at
    /// run time, for every invocation of that command)
    #[test]
    fn the_cli_is_well_formed() { <super::Cli as clap::CommandFactory>::command().debug_assert(); }
}

/// "12.5" or "12.5s" → seconds
fn secs_opt(s: Option<String>) -> Result<Option<f64>> {
    s.map(|x| x.trim().trim_end_matches('s').parse::<f64>().map_err(|_| anyhow::anyhow!("a time in seconds, not \"{x}\""))).transpose()
}

/// a film time: seconds ("76.6s" or "76.6") or a film bar.beat ("37", "37.2.5"; anything with a second dot or no
/// fraction is read as bar.beat when the project has a grid)
fn film_at(dir: &std::path::Path, s: &str) -> Result<f64> {
    let s = s.trim();
    if let Some(x) = s.strip_suffix('s') { return x.parse::<f64>().map_err(|_| anyhow::anyhow!("{s}: not a time")); }
    let p = Project::open(dir)?;
    let g = flex_core::filmgrid::FilmGrid::load(&p.dir, &p.music, p.duration)?;
    g.parse_at(s).ok_or_else(|| anyhow::anyhow!("{s}: film seconds (12.5s) or a film bar.beat (15.2)"))
}

/// Render through the Flex app when it has the film open (and runs it as this command would): its warm session paints,
/// and the author sees the progress. None: render here (the app isn't running, hasn't the film, runs a variant, or says
/// the film needs the pipeline and `fast` wasn't given).
fn render_in_app(dir: &std::path::Path, part: &flex_core::render::Part, size: Option<&str>, fast: bool, variants: bool) -> Result<Option<flex_core::render::Rendered>> {
    let Some((mut c, p)) = app::warm(dir, variants) else { return Ok(None) };
    eprintln!("rendering in the Flex app (its session; the author sees the progress)");
    let prog = app::progress("painting");
    let req = flex_core::control::Request::Render { project: p["dir"].as_str().unwrap_or("").into(), part: part.clone(), size: size.map(String::from), fast };
    match c.call_streaming(&req, |v| {
        if let Some(m) = v["say"].as_str() { eprintln!("{m}"); }
        if let Some(d) = v["progress"].as_array() { prog(d[0].as_u64().unwrap_or(0) as u32, d[1].as_u64().unwrap_or(0) as u32); }
    }) {
        Ok(v) => Ok(Some(serde_json::from_value(v["rendered"].clone())?)),
        Err(e) => {
            let v: serde_json::Value = serde_json::from_str(&e).unwrap_or_default();
            if v["pipeline"].as_bool() == Some(true) || v["standalone"].as_bool() == Some(true) { return Ok(None); }
            anyhow::bail!("{}", v["error"].as_str().map(String::from).unwrap_or(e))
        }
    }
}
