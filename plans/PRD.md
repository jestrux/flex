# Playhead — PRD

Oct 16, 2026 · Walter Kimaro (drafted with Claude)

*Playhead* is a working name.

## Overview

Playhead is a native Mac app for watching and steering a **fancy-e2e-videos project while it is being built**. You open a
project folder and play it straight away, with sound, and scrub the timeline. When the agent changes a scene, the app shows
the change seconds later, with no waiting for a full render. Finished renders appear next to the live preview as they're
produced.

**The problem.** Today a film like `circles-overview` exists only as code until someone runs a full render (minutes), then
watches an mp4 in a separate player and describes feedback in chat as timestamps. Reviewing is slow and lossy:
- every small change costs a render;
- experiments ("labs") live in copied folders;
- the tools used along the way (music splicing, hit finding, transcription, loudness checks) are invisible one-off scripts.

**Goals**

- Open a project folder and **play it live**: picture, music, narration and sound effects in sync, scrubbable, loopable per
  scene.
- **Follow the agent's work.** The project folder is the single source of truth. When files change, only the affected
  scenes refresh. Renders show up as they're made.
- **One timeline:** the song's waveform with its beat grid and hit markers, scenes as blocks, and lanes for narration and
  sound effects.
- **Labs inside the project:** variants of a scene that borrow everything else from the main film and never touch it until
  promoted.
- **Tools as panels:** the agent's working tools (splicer, hit finder, transcriber, loudness, stills, checks) available in
  the app.
- **Review in place:** questions and notes pinned to timestamps, answered in the app, readable by the agent from disk.
- Same stack and conventions as Switchboard and Screenshot Studio:
  - a Rust engine as a library + CLI;
  - a SwiftUI shell;
  - a web view where drawing is web-native.

**Non-goals for v1**

- **Authoring motion in the app.** Scenes stay code the agent writes. The app plays, comments and makes a few safe data edits.
- **Replacing the renderer.** The final mp4 still comes from fancy-e2e-videos. The app's picture is a preview.
- **Cross-platform, cloud sync, multi-user editing.**
- **Merging into Screenshot Studio.** Playhead is its own app.

## MVP scope

The MVP is done when the sample project **`circles-overview`** opens in Playhead and you can do all of these:

1. **Play it** from the start with music and narration, at full speed once the preview cache is warm.
2. **Scrub** anywhere and **loop one scene** (click its block).
3. **See an edit land:** change a value in `scenes/02-into-the-app.ts` (or `hits.ts`) in an editor, and see that scene's
   preview refresh by itself within seconds while the other scenes stay cached.
4. **See renders arrive:** when `npm run video circles-overview` finishes (started by the agent or from the app), the new
   mp4 appears in the Renders list and plays in an A/B view against the preview.

Not in the MVP:
- labs;
- the tool panels;
- review notes;
- asset drop;
- any editing.

## Core concepts

| Concept | What it is | Where it lives |
| --- | --- | --- |
| **Project** | One film: a folder with `project.ts`, `look.ts`, `scenes/`, `hits.ts`, `audio.json`, assets. Linked into fancy-e2e-videos as `projects/<name>` | e.g. `~/Documents/web/kinpay-circles/release-videos/overview/` |
| **Scene** | A slice of the film's timeline (`start → end`, film seconds) holding one or more items | `scenes/NN-<id>.ts` |
| **Item** | What fills a scene: a **card** (code-drawn, a function of time) or a **take** (a screen recording + camera + effects) | cards in `look.ts`/`cards/`; takes in fancy-e2e-videos `takes/<take>/` |
| **Track** | The music and its **edit**: stretches of the song played back to back (`segments`), level-matched joins | `audio.json` + `hits.ts` `EDIT` |
| **Hit map** | Measured musical events (riff notes, sung words, drops, kicks) and the bar grid, in film time | `hits.ts` (`HIT`, `bar()`, `fbar()`) |
| **Cue** | A timed narration line (text, voice file, duration) or sound effect (key, level) | scenes (`say`), journeys (`narrate`), card `sfx`, take clicks |
| **Lab** | A variant of one scene: its own scene file, card params or take; everything else is inherited from main | `labs/<lab>/` inside the project (new; see Labs) |
| **Render** | A finished mp4 of the film or one scene, plus its subtitles, credits and `check` report | `~/Downloads/fancy-e2e-videos/<project>[--<scene>].mp4` |
| **Note** | A review question or answer pinned to a time (and optionally a scene or region of the frame) | `review/notes.json` in the project (new) |

## Architecture

The scenes are TypeScript that draw with fancy-e2e-videos' own compositor, and Node already runs them. So the app does
**not** re-implement drawing. It runs a **preview server** that is part of fancy-e2e-videos and asks it for frames. That keeps
the preview faithful: the same code, the same fonts, the same compositor as the final render.

```
┌──────────────── Playhead.app (SwiftUI + AppKit) ────────────────────────┐
│  Viewer (frames + A/B with renders) │ Timeline │ Inspector │ Tool panels │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  intents in / state + frames out
                    UniFFI bridge (ph-ffi)
                               │
┌──────────── ph-core (Rust library) ─────────────┐     ┌──────────┐
│ Project index (manifest, scenes, cues, renders) │ ◄── │  ph CLI  │
│ File watcher (FSEvents) → invalidation          │     └──────────┘
│ Frame cache (proxy frames on disk, by hash)     │
│ Prefetch scheduler (around the playhead, idle   │
│   fill of the whole timeline)                   │
│ Audio player (the mix + cue scrubbing)          │
│ Supervisor for the preview server + render jobs │
└───────────┬────────────────────────┬────────────┘
            │ HTTP / stdio           │ reads
┌───────────▼──────────────┐   ┌─────▼──────────────────────────────┐
│ preview server (Node,    │   │ Project folder (source of truth)   │
│ inside fancy-e2e-videos) │──►│ scenes, look, hits, audio, assets, │
│ manifest · frame · mix · │   │ labs/, review/                     │
│ render · tools           │   └────────────────────────────────────┘
└──────────────────────────┘
```

The rules, as in your other apps:
- **Rust** owns the project, the cache and the processes. Swift renders and drives.
- **The preview server** owns all knowledge of how a film is drawn and mixed. If the pipeline changes, Playhead doesn't.
- **The app and the CLI** are two front ends on `ph-core`, so everything except drawing can be built and tested from the
  terminal first.

## The project contract (what the app reads)

The app reads the project **only through the preview server's manifest**, never by parsing TypeScript itself. The manifest
is plain JSON the server regenerates on every relevant file change:

| Field | Meaning |
| --- | --- |
| `name`, `fps` (30), `size` (1920×1080), `duration` | the film |
| `scenes[]` | `id`, `start`, `end` (film s), `items[]` (`kind`: card \| take, label), `hash` (changes when the scene's output would change) |
| `music` | the track key and file, the edit (`segments`), loudness, and the url of the rendered **mix** (see below) |
| `grid` | beats and bars (from the kick grid, `fbar`), plus the analysed grid for comparison |
| `hits[]` | named markers in film time (e.g. `kin`, `drop`, `circles[0..6]`, `drums`, `vocal2`) |
| `cues.voice[]` | `t`, `dur`, `text`, `scene`, voice file |
| `cues.sfx[]` | `t`, `key`, `db`, `scene` |
| `labs[]` | `id`, `scene`, `label`, `hash`, `status` (draft / proposed / promoted) |
| `renders[]` | `file`, `scene` or whole film, `startedAt`, `finishedAt`, `status`, `check` summary, `sourceHash` |
| `notes` | the path of `review/notes.json` |
| `errors[]` | any scene that fails to load or type-check, with its message (shown on that scene's block, the way Switchboard shows a broken config) |

**Scene hashes** are the key to live updates. The server computes each scene's hash from:
- its scene file;
- the cards and look code it uses;
- `hits.ts`;
- its assets (by mtime/size);
- for takes, the take's `edl.json` and `events.json`.

When a hash changes, the app drops only that scene's cached frames.

## Preview engine

**Frames come from the preview server**, which calls the same render functions the pipeline uses and returns a JPEG.

Measured on `circles-overview`, per frame:

| Scene | 960×540 | 1920×1080 |
|---|---|---|
| Sting | 12 ms | 18 ms |
| Finale | 51 ms | 65 ms |
| Intro | 91 ms | 228 ms |
| Slides (in progress, heavy) | 0.8 s | 2.8 s |

Takes come from recorded frames plus a camera and effects, and should sit in the tens of milliseconds.

Some scenes are real-time and some are not, so the app works the way editors do with proxies:

- **Proxy cache.** Frames are rendered at preview size (960×540 by default; 1920 on demand for a still) and cached on disk
  under the project's scene hash and frame number. Playing a cached stretch is instant.
- **Prefetch.** The scheduler renders frames ahead of the playhead first, then fills the whole film in the background.
  Several worker processes run in parallel; the server can run N workers.
- **Invalidation.** A file change → new manifest → changed scene hashes → only those scenes re-render, nearest to the
  playhead first.
- **Status on the timeline.** A thin bar under each scene shows cached, rendering and stale (like a video editor's render
  bar), so you can see a change being drawn.
- **Playback while rendering.** If the playhead outruns the cache, the viewer holds the last frame and shows a small
  "rendering" badge. It never shows a wrong frame.
- **Quality.** The preview is labelled as a preview. A **"Frame"** button asks for a full-size still at the playhead from the
  real compositor, for checking detail.

**Sound.**
- The server renders the **mix** (music edit + narration + sound effects, ducked exactly as the final render) as one audio
  file without any video. That's quick: the voice lines are already cached.
- The app plays it in sync with the frames. A change that moves cues regenerates the mix.
- Scrubbing plays short snippets of the mix.

## Timeline

- **Music lane:** the waveform of the edited track. The edit's joins are marked where the song is spliced.
- **Grid:** beats as ticks, bars as numbered lines (`fbar`).
- **Hit markers:** named flags (e.g. "Kin", "drop", "circles ×7", "drums"), from `hits[]`.
- **Scene lane:** a block per scene with its id and label. Click to select, double-click to loop it, and see a render bar
  under it. A scene with an error shows red with its message.
- **Narration lane:** a block per line with its text. **Sound-effect lane:** small marks per cue (e.g. 19 odometer ticks
  in the intro, one per click in the takes).
- **Labs:** a scene with labs shows a small stack badge. Switching "main ↔ lab" swaps that block's frames.
- **Notes lane:** pins for review notes.
- Keyboard: space play/pause, J/K/L, ←/→ one frame, ⇧←/→ one beat, [ ] previous/next scene, L loop.

## Labs (experiments inside the project)

Today a lab is a whole copied project (`overview-lab-members/`), which drifts from the main film. In Playhead:
- **Where a lab lives:** in `labs/<lab-id>/` inside the project. It holds only what it changes: a replacement scene file,
  extra cards, its own assets, optionally its own music edit.
- **What it inherits:** everything else comes from the main film (look, hits, music, assets, other scenes). Changes to main
  flow into the lab automatically.
- **Where you see it:** in place on the timeline, on its scene (A/B: main or lab), or on its own as a side view that plays
  just that scene with its neighbours for context.
- **Promote** is an explicit action, by the agent or by you on approval. It replaces the main scene with the lab's version
  and archives the lab.
- The preview server renders labs as their own "virtual project", so their frames cache separately and never disturb main.

## Renders

- **Renders list:** every render of the project, whole film or per scene, with time, status, the `check` summary
  (fail/warn counts) and the source hash. A render whose hash no longer matches the files is marked **out of date**.
- **A/B:** play a render against the live preview at the same time, side by side or with a wipe. That's useful for spotting
  what the preview gets wrong, or what changed since the last render.
- **Start a render** from the app (film or selected scene). The log streams into a drawer, like Switchboard's terminals.
- `check` findings become clickable timestamps.

## Tool panels (after the MVP)

Each tool is a preview-server command that already exists, or nearly, as a script. The app gives it a panel and writes
results back as project files.

| Tool | What it does | Backed by |
| --- | --- | --- |
| Hit finder | band-limited onset envelopes of a stem (riff, consonants, bass, kick) to place hit markers | the stems in `audio/stems/` |
| Transcriber | word-level timings of a vocal stem ("Count me in" at 52.68 / 53.04 / 53.40…) | local Whisper (mlx) |
| Music splicer | repeat or cut whole beats or bars, with candidate joins scored by level and spectrum and previewed by ear | `hits.ts` `EDIT` + `segments` |
| Narration fit | the voice length of each line against its scene, with overlap and spill warnings | the TTS voice cache, `say` |
| Loudness | speech-over-music per narrated span, against the 14 dB bar | the mixer + `check` |
| Stills and contact sheets | stills at every join, beat or chosen time | `npm run stills` / `sheet` |
| Face crops | round avatar crops from people photos | the intro's crop script |
| Checks | `npm run check`, with findings on the timeline | `check` |
| Take editor | the existing zoom editor for a take (camera blocks, effects), embedded | `lib/editor.ts` / `editor.html` |

## Assets

A **drop zone** per project:
- audio (registered in `audio.json`, then measured for loudness);
- stems (into `audio/stems/`, and the hit finder offers to analyse);
- images and photos (`assets/`);
- people data (`assets/people/`).

Dropped files are copied into the project, never referenced from where they were dropped.

## Review notes

- **Format:** `review/notes.json` holds notes with time (film s), optional scene, optional frame region, author (you or the
  agent), text, status (open / answered / resolved), and replies.
- **From the agent:** it writes its open questions there, with timestamps, instead of only in chat, and reads your answers
  from the same file.
- **In the app:** notes show on the timeline and in a list. Clicking one jumps to its time and loops a short window around
  it.

## Safe edits (after the MVP)

The animation stays code. The app may change **data** that the scenes read, through the preview server, which writes the
files:
- move a hit marker;
- nudge a scene boundary to another bar;
- edit a narration line's text (the voice regenerates);
- edit slide text;
- change a sound effect's level.

Each edit is a small, reviewable file change the agent can see.

## What fancy-e2e-videos provides (the agent builds this side)

These are pipeline changes, built and owned in fancy-e2e-videos, opt-in, with no change to existing commands:
1. **`npm run serve <project>` (the preview server).** It serves:
   - the manifest;
   - a frame (scene, frame number, size → JPEG);
   - the mix (audio only);
   - start-render and render-status;
   - the tool commands.

   It watches the project folder and pushes "manifest changed" events (server-sent events or a socket). It runs workers
   for parallel frames.
2. **Scene hashing** (above), and a fast **mix-only** path through the existing mixer.
3. **Labs:** `labs/<id>/` resolution in `lib/project.ts`, rendered as a virtual project, plus a promote command.
4. **Review notes:** the agent writes and reads `review/notes.json`.
5. **The sample:** `circles-overview` migrated to the lab layout. Its two current lab folders are already merged into it.

## Milestones

1. **M1, server + CLI.** The preview server (manifest, frame, mix, watch) and `ph-core` with the frame cache and
   prefetch. `ph play circles-overview --to-dir` dumps cached frames, which proves the cache and invalidation from the
   terminal.
2. **M2, the MVP app.** Viewer, timeline (music, grid, hits, scenes, narration, sound effects), play and scrub with sound,
   loop a scene, live refresh on file change, renders list with A/B.
3. **M3, labs.** Lab resolution, A/B per scene, promote.
4. **M4, review and tools.** Notes, the checks panel, stills, loudness, narration fit, then hit finder, transcriber,
   splicer.
5. **M5, safe edits and asset drop.**

## Open questions

- **Picture in the browser too?** A later option is to run the card code directly in the web view for instant scrubbing,
  since most cards are SVG. It needs the pipeline's compositor ported to canvas, and the server stays the source of truth.
  Worth it only if proxy caching feels slow in practice.
- **One app per project or one window per project?** Switchboard's model (a window per project) seems right.
- **Where the frame cache lives:** Application Support (per machine, discardable) is the suggestion, not the project folder.
- **Starting renders from the app vs. only showing them:** a shared render queue avoids two renders fighting over the disk,
  which has run out before.
- **The name.**

## Samples

- **Project:** `~/Documents/web/kinpay-circles/release-videos/overview/` (`circles-overview`), about 70 s, 6 scenes
  (sting, into-the-app, slides, home, how-it-works, finale). Read its `CONTEXT.md`, `PLAN.md`, `NOTES.md` (especially
  "Reproducing and editing the film") and `LEARNINGS.md`.
- **Pipeline:** `~/Documents/web/fancy-e2e-videos` (`AGENTS.md`, `lib/project.ts`, `lib/sequence.ts`,
  `lib/presets/layers.ts` for the compositor, `lib/render.ts` for takes, `lib/audio.ts` for the mix, `lib/editor.ts` for
  the existing take editor).
- **Stack references:** `~/Documents/web/switchboard` and `~/Documents/web/screenshot-studio` (Rust core + UniFFI +
  SwiftUI, a web view for drawing, the `uidrive` UI driver, release scripts).
