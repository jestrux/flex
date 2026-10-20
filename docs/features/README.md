---
id: features
number: 1
title: Feature list
category: overview
categoryTitle: Feature list
description: Everything Flex does today, by area, and what is not built yet.
---

# Feature list

The record of what Flex does. Each area has its own page, and each feature says what it does,
how to reach it, where its state lives and its limits.

Run `scripts/docs.sh` to browse these pages (http://localhost:5197). The Markdown files in
`docs/` are the source, so reading them directly works just as well.


## Areas

![A film open in Flex](../media/film.png)


| Area | What is in it |
|---|---|
| [Projects](01-projects.md) | Opening a film's folder, Recent, finding its pipeline, the two samples |
| [Playback](02-playback.md) | The viewer, play and pause over the music, scrubbing, looping a scene, keys |
| [Timeline](03-timeline.md) | Scene blocks, paint bars, sections, bars and hits, the music edit's joins, the waveform, the join check, scenes that didn't draw |
| [Painting and the cache](04-painting.md) | The Rust painter, frames cached by their contents, checking against the pipeline |
| [Live refresh](05-live-refresh.md) | Edit a file, and only the frames it changed repaint |
| [The flex command](06-cli.md) | Everything above from the terminal |
| [Variants, renders and stills](07-compare-export.md) | Switching a variant, A/B against a finished render, exporting a still at any size |
| [Assets](08-assets.md) | Everything the film is made from in a grid, each playable alone in the source viewer; `flex assets` |
| [Activity trail](09-activity.md) | Every flex command, file change and agent step on one clock, a lane per agent and subagent; `flex activity` |
| [Storyboard](10-storyboard.md) | The film's script (`script.json`) as a lane of panels, the viewer as an animatic where the film isn't built, the plan past the film's end; `flex script`, `flex storyboard` |

## Not built yet

- A sound-effect lane on the timeline.
- Labs, review notes, tool panels and safe edits ([PRD](../../plans/PRD.md)).
