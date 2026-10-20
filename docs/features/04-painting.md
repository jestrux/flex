---
id: painting
number: 4
title: Painting and the cache
category: features
description: The Rust painter, frames cached by their contents, and checking against the pipeline.
---

# Painting and the cache

## The painter

- **What:** Flex asks the pipeline what goes in each frame (its layers: SVG and images, the
  same `Layer[]` the pipeline paints) and paints them itself, in Rust (resvg and tiny-skia), on
  every core. On circles-overview's slowest frames that is 3.6–9.5× faster than the pipeline's
  own paint on one core, and the whole film's paintable frames fill the cache in 10–20 s.
- **State:** Nothing to set. The preview is 960 wide.
- **Limits:** Video layers (`broll-clip`) aren't painted yet; the frame shows without them.

## Frames cached by their contents

- **What:** Each frame has a key: a hash of its layers and of the files they name. Frames are
  cached by key, so an edit repaints exactly the frames it changed, held frames are painted
  once, and a project and its copy share frames.
- **State:** `~/Library/Application Support/Flex/cache/p<painter>/<width>/<key>.jpg`. Safe to
  delete at any time. `FLEX_SUPPORT=<dir>` moves it (and the server scripts).
- **Limits:** The cache is never trimmed yet; delete it when it grows.

## Checking against the pipeline

- **What:** `flex diff` paints frames both ways, Flex's and the pipeline's own `paint()`, and
  reports the difference. On the samples it is 0–2/255 on average, with the visible differences
  along the edges of fine text.
- **Reach it:** `flex diff <project> [frame…] --keep <dir>` ([the CLI](06-cli.md)).
