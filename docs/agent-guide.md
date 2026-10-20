---
id: agent-guide
number: 1
title: Agent guide
category: contributing
categoryTitle: Working on the code
description: How to build, test and iterate on this codebase quickly.
---

# Agent guide: build, test and iterate fast

**Making a film rather than working on Flex?** Read [making-a-film.md](making-a-film.md).

What the app does is in the [feature list](features/README.md): read it before changing
behaviour, and after meaningful feature work ask the author whether to update it.
`scripts/docs.sh` serves `docs/` as a site (a page is any Markdown file with frontmatter).

## The map

| Layer | Where | Language | Owns |
|---|---|---|---|
| Engine | `crates/flex-core` | Rust | projects (finding the pipeline, the outline), later the preview server's supervisor, the frame cache, prefetch |
| CLI | `crates/flex-cli` | Rust | `flex` |
| Bridge | `crates/flex-ffi` | Rust (UniFFI proc-macros) | the records and calls Swift sees |
| App | `app/Flex` | SwiftUI + AppKit | windows, the viewer, the timeline |
| Outline reader | `server/outline.mts` | TypeScript, run by the pipeline's tsx | a project's outline as JSON; embedded in `flex-core` |
| Server | `server/serve.mts` | TypeScript, run by the pipeline's tsx | what goes in each frame ([server.md](server.md)); embedded in `flex-core` |
| Painter | `crates/flex-core/src/paint.rs`, `roundmask.rs`, `vips.rs` | Rust (resvg, tiny-skia; the pipeline's libvips at film size) | a frame's layers → pixels, at any width; byte-exact with the pipeline at the film's size |
| Engine | `crates/flex-core/src/engine.rs` | Rust | one open project: session, cache-filling painter (playhead first), watcher → reload |

**The rule:** process logic lives in Rust, and drawing knowledge lives in the pipeline. If the
UI needs a value, add it to the engine and expose it through `flex-ffi`.

## Loops, fastest first

```sh
cargo test -p flex-core                         # ~1 s; opens the real sample when it's there
cargo build -p flex-cli && target/debug/flex open samples/circles-overview
scripts/build-core.sh --debug                 # Rust → XCFramework + Swift bindings (after any flex-ffi change)
scripts/build-app.sh                          # + xcodegen + xcodebuild → dist/Flex.app
scripts/package.sh                            # Release build: quit Flex, install to /Applications, relaunch (Debug: add Debug)

target/release/flex frame samples/circles-overview 12.5s -o x.png [--width 960]
target/release/flex warm samples/circles-overview [--scene slides]     # paint into the cache, all cores
target/release/flex status samples/circles-overview
target/release/flex diff samples/circles-overview [frame…] --keep /tmp/d   # vs the pipeline's own paint
target/release/flex watch samples/circles-overview --at 8s                 # live refresh: edit a scene file
target/release/flex journeys samples/circles-overview                      # capture: docs/capture.md
target/release/flex capture samples/circles-overview pool-back --dry        # (the circles app must be running)
```

`FLEX_SUPPORT=<dir>` points the cache and the embedded scripts somewhere else (use a scratch
folder for timing runs). The cache is `<support>/cache/p<PAINTER_VERSION>/<width>/<key>.jpg`:
**bump `PAINTER_VERSION` in `frames.rs` whenever the painter's output changes**, or old frames keep
showing (keys are content hashes of the layers, not of the painter).

## Opening a project

`Project::open` (`crates/flex-core/src/project.rs`):

1. finds the pipeline from `project.ts`'s import of `…/fancy-e2e-videos/lib/project.ts`,
   resolved from the project folder (so a copied project keeps working as long as it sits at
   the same depth);
2. runs `<pipeline>/node_modules/.bin/tsx <support>/server/outline.mts <project>` with a login
   PATH (a GUI app starts with a bare one). It takes about a second;
3. maps each scene to `scenes/NN-<id>.ts` and the track to its `audio.json` entry.

The support folder is `~/Library/Application Support/Flex` (`FLEX_SUPPORT` overrides).

## Driving the app

```sh
swiftc -O scripts/uidrive.swift -o target/dev/uidrive
open -g dist/Flex.app --args -openProject "$PWD/samples/hello-flex" -ApplePersistenceIgnoreState YES
target/dev/uidrive window            # id x y w h
target/dev/uidrive shot out.png      # window-only screenshot, works in the background
```

`-openProject <path>` opens a project window at launch; `-startAt <frame>` puts the playhead there;
`-autoplay YES -mute YES` plays silently (to check playback without sound on the author's Mac). `uidrive click`/`key` act on whatever
is in front: check that Flex is the front app before every click, or don't click.

## Traps

- **The pipeline only finds projects linked into `fancy-e2e-videos/projects/`** (looks and
  audio are registered by scanning that folder). Reading the outline works without a link,
  but rendering frames won't. PLAN.md has the fix as a pipeline hand-off item.
- **tiny-skia applies `fill_path`'s transform to the shader too.** An image pattern's transform is
  in layer space; adding the frame's scale to it painted every image at the wrong size below 1920
  wide (`paint_tests.rs` guards it).
- **The app's Debug build compiles Rust in the dev profile.** Dependencies are opt-level 3 and
  `flex-core` 2 (`Cargo.toml`), or resvg is many times slower.
- **Scenes start on `round(start × fps)`.** Map frames to scenes by frame ranges, never by
  comparing times (23.91 s isn't on a frame).
- SourceKit shows "cannot find type" errors for the generated bindings until the first
  `scripts/build-core.sh`. The build is the truth.

## Samples

- `samples/hello-flex`: ten seconds of built-in title cards, in git. Use it for screenshots in
  the docs and for tests (`paints_hello_flex`).
- `samples/circles-overview`: the real film, KinPay product content, **never in git or in the
  docs' screenshots**. `scripts/copy-sample.sh` refreshes it from the KinPay repo, where
  another session keeps editing it, so it can be mid-change (a scene that throws is normal).

## Releasing

`scripts/release.sh <patch|minor|major> --publish`: bumps the version in `app/project.yml` and
`Cargo.toml`, archives a universal Release build with the hardened runtime, signs it with
Developer ID through Xcode's account, waits for notarization, staples and zips it
(`dist/Flex-<version>.zip`), commits "Release X.Y.Z", pushes and creates the GitHub release.
`--dry-run` prints the plan. The tree must be clean; commit trailers go in
`FLEX_RELEASE_TRAILERS`.
