# Assets panel and activity trail: two lanes (2026-10-17)

Flex `main`. Built as two parallel lanes over a scaffold; the source of truth for what each panel is: PLAN.md "After the
MVP: assets" and "After the MVP: agents", item 5. The principle holds: tools measure, the film decides. Neither panel
judges the film; they show what is there and what happened.

## Confirmed asks
1. **Assets panel:** a grid of everything the film is made from, each previewable on its own in a source viewer apart
   from the film's viewer: audio (song, stems, sounds; waveform, play, loudness; words where a transcription exists),
   takes and their versions (the raw recording, the timing report), the agent's tools (cards with sample values), labs,
   looks, freezes and stills, renders. Nothing registered by hand: whatever is a file in the project shows up; what an
   agent made is marked.
2. **Activity trail:** every `flex` command (what ran, arguments, outcome, duration, what it made) in
   `<project>/.flex/activity.jsonl`; every change to the project's files with its diff; the agents' own accounts from
   Claude Code transcripts, read-only, each subagent its own lane. The Activity panel: a lane per agent, events live with
   thumbnails, a click jumps to the frame, the diff or the asset. Flex records; it never restricts.

## Spine vs lanes
- **Spine (orchestrator):** the scaffold below, all git, the per-lane merge gate, UI capture windows, PLAN/README/docs
  index, and the cross-lane seam (an activity event revealing an asset).
- **Lanes:** A (assets) and B (activity), each in its own git worktree (`~/Documents/web/flex-lanes/<lane>`), so builds
  never collide. Lanes never run git.

## Lane map (owned paths are disjoint)

| Lane | Owned paths |
|---|---|
| **A: assets** | `crates/flex-core/src/assets.rs` (+ `crates/flex-core/src/assets/` if split), `crates/flex-ffi/src/assets.rs`, `crates/flex-cli/src/assets.rs`, `app/Flex/Assets.swift` (+ any `app/Flex/Assets*.swift`), `docs/features/08-assets.md`, tests under `crates/flex-core/tests/assets*` |
| **B: activity** | `crates/flex-core/src/activity.rs` (+ `crates/flex-core/src/activity/`), `crates/flex-ffi/src/activity.rs`, `crates/flex-cli/src/activity.rs`, `app/Flex/Activity.swift` (+ any `app/Flex/Activity*.swift`), `docs/features/09-activity.md`, tests under `crates/flex-core/tests/activity*` |

**Orchestrator-owned:** `crates/*/src/lib.rs`, `crates/flex-cli/src/main.rs`, every other existing file (engine, server,
project, Timeline, ProjectWindow, Player), `app/Flex/Panels.swift`, Cargo manifests, `server/`, `pipeline*`, PLAN.md,
README, docs index, git.

## Phase 0: scaffold (done)
- `flex_core::{assets, activity}` declared; `activity::Recorder::{begin(argv), end(outcome)}` is the CLI's contract.
- The CLI records every command: `main()` calls `Recorder::begin` first and `end` last, and `exit(code)` (never
  `std::process::exit`) records before exiting. `flex assets <dir>` and `flex activity <dir>` dispatch to the lane files.
- FFI: `mod assets; mod activity;` in flex-ffi; each lane's records and functions live in its own file.
- App: `ProjectStore.side` (the side panel, `-panel assets|activity` at launch), `store.assets: AssetsStore`,
  `store.activity: ActivityStore`, `SidePanelView` (Panels.swift) left of the viewer, `SourceSlot` between it and the
  viewer, toolbar buttons ⌥⌘1 / ⌥⌘2. The seam: `store.reveal(asset:)` (calls `AssetsStore.reveal`) and
  `store.seek(seconds:)`.

## Phase 1: lanes (parallel)
Briefs: in the orchestrator's session. Each lane builds and tests in its own worktree; UI screenshots only inside a
capture window (a lock: `mkdir /tmp/flex-ui-lock`, one lane at a time).

## Phase 2: merge gate (per lane, serial)
Only the lane's paths changed → `cargo test --workspace` → `scripts/build-app.sh` → a screenshot → commit the lane's
paths, push.

## Phase 3: integration
An activity event for a freeze or a render opens it in the assets panel; an event with a film time seeks the playhead;
a `flex` command run by an agent appears in the trail and what it made appears in the grid. Then PLAN.md status, the
docs index, push.
