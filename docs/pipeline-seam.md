---
id: pipeline-seam
number: 2
title: What Flex needs from fancy-e2e-videos
category: guides
description: The hand-off to the pipeline, so projects open from any folder and plan, layers and mix are separate steps.
---

# What Flex needs from fancy-e2e-videos

Flex (a Mac app over a Rust engine, `~/Documents/web/flex`) previews a film while it is being built. It owns its server,
cache and painter. From the pipeline it needs **what goes in a frame, when, and how it sounds**: nothing else.

## The model (decided 2026-10-16)

**Flex carries its own copy of the pipeline.** It is independent of other projects (no fancy-e2e-videos checkout needed),
not of the pipeline: the timing rules (bar snapping, voice-led lengths, `sayOver`, offsets, transitions, align) and the card
code are the pipeline's and change every round, so Flex runs the pipeline's code and never re-implements it.

- **Vendored, patched, never hand-edited.** `scripts/sync-pipeline.sh` copies fancy-e2e-videos' working tree (`lib/`,
  `looks/`, the sound library, `package.json`) into `pipeline/`, re-applies `pipeline-patches/`, and stamps `pipeline/SOURCE`
  (commit, dirty or not, date). Nothing in `pipeline/` is edited by hand: a change is a patch, or a fix in fancy-e2e-videos
  followed by a re-sync. The pipeline changed about a dozen times in one day (2026-10-16), so a
  hand-patched copy drifts within a day.
- **Import redirect.** Project files import the pipeline by relative path (`../../../../fancy-e2e-videos/lib/look.ts`). Flex's
  server registers a Node resolve hook that maps any `…/fancy-e2e-videos/lib/…` import to its bundled copy, so projects
  open unchanged from any folder.
- **Parity check after every sync.** `flex diff <project> <frames…>` paints a few frames per scene both ways (Flex's
  painter vs. the pipeline's `paint()` through the vendored copy) and reports the difference.
- **Global tools stay global.** Narration through Kokoro (local) or OpenAI when a key is set, the local Whisper model for
  transcription, ffmpeg for encode and mix. Flex uses the voice cache and generates missing lines through the same code the
  pipeline uses.

## 1. Projects from any folder

Today a project is found, and its look and audio registered, only through `projects/<name>` symlinks. Upstream:

- Every command takes a project **folder path** as well as a name.
- The project being run registers **its own** `look.ts` and `audio.json` from its own folder.
- A project's **takes live in the project** (`<project>/takes/<take>/`), so a project folder is complete on its own.

## 2. Plan, layers, mix: the split (in Flex's copy, as patches)

`renderSequence` plans the timeline and loops frames into ffmpeg in one function, and take composition lives inside
`render.ts`'s frame loop; neither is exported. fancy-e2e-videos is not changed from Flex (another agent works there), so the
split is **small patches on Flex's copy** (`pipeline-patches/`), re-applied by every sync, plus Flex-owned code
(`server/timeline.mts`) on top. The patches stay minimal so they keep applying: a plan-only mode in `renderSequence` (plan
and collect the cues, render nothing, delete nothing), exported cursor/ripple helpers in `render.ts`, the takes and
voice-cache paths from the environment, and a capture beat log (`events.beats`, and the dry-run folder from
`FLEX_DRY`; see [capture.md](capture.md)). Flex exposes:

```ts
export async function planSequence(seq: Sequence): Promise<Timeline>
export function layersAt(tl: Timeline, frame: number): FrameLayers
export async function mixSequence(tl: Timeline, out: string): Promise<{ file: string }>
```

- **`Timeline`**: per item its film start and end (after snapping, voice sizing, `sayOver`, offsets, align), its card or take,
  its params, the transition into the next; the cues (voice lines, sound effects incl. per-key typing and clicks, the music:
  key, file, edit, `underVoice`, `role`); the output size (`OUT_SIZE`, layout always 1920 wide). Plain JSON.
- **`layersAt(tl, frame)`**: a card's `Layer[]`; a **take's** layers: the recorded frame, the camera's crop, the canvas,
  the animated stage grid and window border, the cursor, its press and ripple, the effects; a transition's two sides plus
  its progress.
- **`mixSequence(tl, out)`**: the mix as today, without picture.

Flex's server then only calls these: its own card layout, its copy of `resolveAt` and its cue collection go.

## 3. Also, small

- **Variants:** `variants: { END: ["white", "dark"], … }` in project.ts, read by `planSequence` (today they are env flags).
- **Markers:** a project exports its film-time grid (sections, bars, hits, the music edit) for Flex's timeline lanes. The
  analysed `.grid.json` is ≈0.25 s off the film's kick grid and must not be used for the grid lane.

## 4. What each frame depends on

A frame's `Layer[]` names every file it reads, so Flex hashes the layers plus those files' size and mtime. For anything a
card reads that is not in its layers (a data JSON read at import time, a font), Flex restarts its worker when a project file
changes (debounced: several agents may be editing at once).

## 5. Later, optional

- **One painter** for final renders too: incremental (only changed frames), 4–10× faster. Promoted in PLAN.md.
- **Labs** declare a `target` (`{ project: "../overview", section: "book" }`) so Flex plays them in place.
