---
id: cli
number: 6
title: The flex command
category: features
description: Everything the app does to a project, from the terminal.
---

# The `flex` command

Build it with `cargo build --release -p flex-cli`; it is `target/release/flex`. Every command
takes a project folder.

| Command | Does |
|---|---|
| `flex open <dir> [--json]` | The film's outline: scenes, their times, items and files, the music and its edit |
| `flex frame <dir> <frame\|12.5s> -o x.png [--width 960]` | Paint one frame |
| `flex warm <dir> [--scene id] [--width 960]` | Paint every frame (or a scene's) into the cache, on all cores |
| `flex status [<dir>] [--json]` | With the app running: the projects it has open, the author's playhead (time, frame, scene), what's painted, any render running. Without it: how much of each scene is painted, and scenes that didn't draw |
| `flex library [--json]` | Flex's own music library: each track's and song's key, tempo, length, mood and licence, and whether a song is downloaded |
| `flex library pull <key>… [--all] [--stems]` | Download songs now (they download the first time a film uses them anyway), with their stems |
| `flex show <dir> [AT \| --scene <id>]` | Open the project in the app (starting it if needed) and move its playhead: a frame, film seconds (`22.5s`) or a bar.beat |
| `flex diff <dir> [frame…] [--keep dir]` | Compare Flex's painting with the pipeline's |
| `flex watch <dir> [--at 8s]` | Keep the cache painted and print each reload, as the app does |
| `flex play <dir> --to-dir d [--scene id]` | Write the film's frames as numbered JPEGs |
| `flex joins <dir> [--json]` | Check every scene boundary: seamless, a jump, or a declared cut ([Timeline](03-timeline.md)) |
| `flex script <dir> [--json]` | The film's script (`script.json`) on its clock: beats, narration, panels, and what can be measured ([Storyboard](10-storyboard.md)) |
| `flex storyboard <dir> [--sheet x.png] [--animatic x.mp4]` | The script's panels as one sheet, or as an animatic over the track |

Every command also takes `--variant NAME=VALUE` (repeatable) to run the film with a variant
flag it declares, e.g. `flex frame <dir> 4290 -o end.png --variant END=dark`. Commands that
write a file take an explicit path (`-o`, `--to-dir`, `--film`), and none opens a dialog.

With the app open on a project, `flex frame` and `flex render` run in the app's warm session (no server to start; the
author sees a render's progress on the transport). **Flex › Install flex Command…** links the app's own `flex` to
`~/.flex/bin` and the `/flex` agent skill into `~/.claude/skills`. Progress prints one line per tenth when piped.
