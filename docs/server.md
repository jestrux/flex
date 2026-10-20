---
id: server
number: 1
title: Flex's server
category: guides
categoryTitle: Guides
description: The Node process that runs a project's pipeline and says what goes in each frame.
---

# Flex's server

The bridge between the Rust engine and a project's pipeline. It is a Node process that runs the
pipeline's own code and answers **what goes in a frame**. It never paints: the engine paints,
caches and plays. The script is `server/serve.mts`, embedded in `flex-core` and written to the
support folder (`~/Library/Application Support/Flex/server/`) when it changes.

## Starting it

The engine starts it for a project; nobody runs it by hand.

```sh
FLEX_PIPELINE=<pipeline> <pipeline>/node_modules/.bin/tsx --import <support>/server/redirect.mjs <support>/server/serve.mts <project-dir>
```

- `<pipeline>` is **Flex's own copy** of fancy-e2e-videos (`pipeline/` in the repo, `Contents/Resources/pipeline` in the
  app; `scripts/sync-pipeline.sh` refreshes it and re-applies `pipeline-patches/`). No fancy-e2e-videos checkout is needed.
- `--import redirect.mjs` registers a resolve hook: any import whose path runs through a `fancy-e2e-videos` folder (projects
  import `../../../../fancy-e2e-videos/lib/…`) resolves into `<pipeline>` instead, always.
- The environment: `FLEX_PIPELINE`; `FLEX_VOICE_CACHE` (`<support>/voice`; `scripts/seed-voices.sh` fills it);
  `FLEX_TAKES` (the project's own `takes/`, else the pipeline's); `FLEX_PROJECTS` (a session folder linking the project, so
  the pipeline's look and audio discovery find it); and any **variant** flags (`END=dark`), from `Server::start_with`.
- `cwd` is the pipeline; `PATH` is a login path (`project::login_path`).
- It speaks **JSON lines over stdin/stdout**: one request per line in, one response per line out, in order. Anything else
  the pipeline prints goes to stderr, which the engine keeps as the server's log.
- On start it plans the film with the pipeline's own planner (`timeline.mts`: `renderSequence` in plan-only mode) and
  prints one `ready` line (below) or an `error` line, then waits for requests. It exits when stdin closes.
- **Reloading:** Node can't drop modules it has imported, so the engine **restarts** the server when a file in the project
  changes (about a second). A restart is the reload.

Several servers can run for one project (workers). They are independent.

## Messages

Every request has an `id` and an `op`; its response has the same `id` and either `ok: true` and
the result, or `ok: false` and `error` (a message, with the first lines of the stack).

### `ready` (sent once, unasked)

```json
{ "id": 0, "ok": true, "op": "ready", "manifest": { … } }
```

### `manifest`

```json
{ "id": 1, "op": "manifest" }
→ { "id": 1, "ok": true, "manifest": {
    "name": "circles-overview", "fps": 30, "size": [1920, 1080], "frames": 2173, "duration": 72.44,
    "music": { "key": "circles-overview-mix", "file": "/…/audio/count-me-in-2.mp3", "segments": [[0, 8.16], …] },
    "scenes": [
      { "id": "sting", "start": 0, "end": 4.77, "first": 0, "frames": 143,
        "items": [{ "kind": "title", "type": "circles-overview/sting", "label": "sting", "start": 0, "end": 4.77, "paintable": true }] },
      …
    ],
    "warnings": ["…"] } }
```

- `start`/`end` are film seconds; `first` is the scene's first frame and `frames` its count.
- Every item is paintable: cards through their own `render`, takes as layers (`take-layers.mts`: the stage, the
  recording, the grid and border, effects, ripple, cursor). `variants`, `markers` and `out` come from the project's exports.

### `layers`

```json
{ "id": 2, "op": "layers", "frame": 812 }
→ { "id": 2, "ok": true, "scene": "slides", "layers": [ { "svg": "<svg …>" }, { "image": "/abs/path.png", "rect": {…}, "crop": {…}, "radius": 12, "opacity": 1, "alpha": true } ] }
→ { "id": 2, "ok": true, "scene": "home", "layers": [ { "svg": "…stage…" }, { "image": "/…/takes/circles-home/frames/f000412.jpg", "rect": {…}, "radius": 17.5, "alpha": false }, { "svg": "…grid, border…" }, { "svg": "…effects…" }, { "svg": "…cursor…" } ] }
```

Layers are the pipeline's `Layer` type (`lib/presets/types.ts`) for a 1920 × 1080 frame, with
every image path absolute.

### `keys`

```json
{ "id": 3, "op": "keys", "from": 0, "to": 2173 }
→ { "id": 3, "ok": true, "keys": ["9f2c…", …] }
```

One key per frame in `[from, to)`: a hash of the frame's layers and of the size and mtime of
every file they name. Two frames with the same key look the same, so the engine caches frames
**by key**: an edit re-renders exactly the frames whose layers changed, whichever scene they're
in. Building layers costs 0–10 ms a frame, so keying a whole film takes a few seconds in the
background.

### `cues`

```json
{ "id": 4, "op": "cues" }
→ { "id": 4, "ok": true, "total": 77.23, "music": { "key": "…", "segments": […] },
    "voice": [{ "t": 11956, "dur": 5.2, "text": "Meet KinPay Circles. …", "file": "/…/.cache/voice/….wav", "scene": "into-the-app" }, …],
    "sfx": [{ "t": 8120, "key": "circles-odo-tick-a", "db": -12, "scene": "into-the-app" }, …], "warnings": [] }
```

The cues the pipeline's own planner collected (plan-only `renderSequence`): cards' `say` and `sfx`, takes' narration,
clicks, keystrokes and effect sounds, at their film times (`t`, ms). Voice lines missing from the cache are spoken first.

### `mix`

```json
{ "id": 5, "op": "mix", "out": "/…/mix.wav" } → { "id": 5, "ok": true, "file": "/…/mix.wav", "voice": […], "sfx": […] }
```

The cues, mixed by the pipeline's `mixAudio` (loudness targets, ducking, the music edit's
crossfades, the limiter): the same sound a render gets. Seconds of work; the engine runs it in a
second server so painting carries on, and caches it by the cues.

## The engine's side

- **Painting:** `flex-core`'s painter turns `layers` into pixels. At the film's own size it paints exactly as the
  pipeline does: images placed by ported sharp/libvips arithmetic, SVG layers and rotations through the pipeline's own
  libvips (sharp's bundled build, loaded from `pipeline/node_modules`), every layer composited in float as sharp's one
  composite does — byte for byte the pipeline's frame. At other widths (the preview's) it takes the faster path: resvg
  for SVG, tiny-skia for images, a Lanczos-filtered copy of each image for large downscales. Without the pipeline's
  libvips (or with `FLEX_NO_VIPS=1`) the film-size path uses resvg and tiny-skia for SVG and rotation, within ~1/255.
- **Cache:** `<support>/cache/p<painter version>/<width>/<key>.jpg`. Keys are content hashes, so the cache is shared
  between projects and survives restarts; it can be deleted any time.
- **Prefetch:** frames near the playhead first, then the rest of the film, painted in parallel.
