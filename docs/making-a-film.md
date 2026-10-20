---
title: Making a film
---

# Making a film with Flex

The path from an empty folder to a rendered film, for an agent or the author. Every step is a `flex` command with a text
answer, or `--json` for agents. The app shows the same project live while you work: open the folder in Flex.app.

## Tools measure; the film decides

Flex's tools report what can be measured: the grid's phase on the kicks, onsets and their strength, word times,
loudness, a cut's distance from the nearest beat, whether the picture jumps. They don't make musical or visual calls.
Those are the film's own work, made by the agent (and the author's taste), and recorded in the project so they're
visible and reversible:
- which beat is "1": `audio.json` `"downbeat"`, from `flex music`'s evidence;
- which hits to cut on;
- whether an energy step is a drop;
- whether a cut belongs on the beat;
- what the lyrics are;
- the look.

## 0. The machine

If `flex` prints "can't open …", the shell is older than Flex's install and found macOS's unrelated `/usr/bin/flex`:
open a new terminal, or call `~/.flex/bin/flex`.

```sh
flex doctor                 # Flex's pipeline copy, node, ffmpeg, Chromium, the voice engine, local Whisper; each with its fix
flex key set openai         # optional: narration by OpenAI instead of Kokoro (kept in Flex's support folder; also Flex › Settings)
```

Tools run with your login shell's PATH (the `python3`, `node` and `mlx_whisper` a terminal gets).

**Flex › Install flex Command…** links the app's own `flex` to `~/.flex/bin` and its agent skill (`/flex`) into
`~/.claude/skills`, so the command always matches the app. `scripts/install-cli.sh` builds one from a checkout instead.

## The app and the command

The Flex app serves a socket the `flex` command talks to, so an agent sees what the author sees:

```sh
flex status                       # the projects open in the app: the playhead (time, frame, scene), what's painted
flex status <dir> --json          # one of them, machine-readable (and any render running there)
flex show <dir> 22.5s             # open it in the app (starting it if needed) and move the playhead: 22.5s, a frame, 37.2
flex show <dir> --scene <id>      # ... to a scene's start
```

With the app open on the project (and no `--variant` or `--take` on either side), `flex frame` and `flex render` run in
the app's warm session: no server to start, the author sees a render's progress on the transport, and the result is
the same as running them alone. Without the app, every command works on its own.

## From an app's e2e suite

A film of an app usually starts from its end-to-end tests: they already know how to log in, which data a flow needs and
which selectors find each control. A film doesn't run those tests; it records **journeys** (section 4), written from
them: the tests' seating (cookies, a login), selectors and data setup reused, their assertions left out, and every step
timed to the music with the capture API (`lib/capture.ts` in Flex's pipeline copy). Put the film project beside the
e2e folder, not inside it. Before recording, settle with the author the song, the audience, the flows and their order,
and the length; plan them as a script on the song's bars; and check each user's view with `flex walk`. The worked
example ships with Flex's agent skill: `skills/flex/examples/app-walkthrough` (a persona's login, a journey on the beat,
the take's scene, cards).

## 1. Start the project

```sh
flex new <dir> --music <song.mp3> [--name <film>] [--feel clean|modern|professional]
flex library                     # or one of Flex's own tracks and songs: tempo, length, mood, licence (music: { key } in project.ts)
```

This creates:
- `project.ts`;
- the song in `audio/`, registered in `audio.json`, with a `stems/` folder next to the song copied too;
- one placeholder scene;
- `journeys/`.

It opens and plays at once. Films land in `~/Downloads/flex-videos/<film>/`. To share a look with another film, import
its pieces (see Composite films, below).

## Finding the song

The film is cut to its song, so the song comes first. Settle it with the author before planning; it's their choice and
their licence. Three ways:

- **Their own file.** `flex new <dir> --music <file>`.
- **A Creative Commons track.** Search a free library with the film's mood and tempo, and check each track's licence:

  | Source | Licence |
  |---|---|
  | incompetech.com (Kevin MacLeod) | CC BY 4.0: credit required (Flex's own tracks come from here) |
  | Pixabay Music | Pixabay Content Licence: free, no attribution; read its restrictions |
  | YouTube Audio Library | per track; some need attribution |
  | Free Music Archive | per track; avoid NC (non-commercial) for anything commercial |

  `flex library` lists the tracks Flex ships with (`music: { key: "carefree" }` in `project.ts`) and Flex's own songs
  (made in Suno for Flex, with vocals, chants or instrumental; free in any film, no credit needed: LICENSE-MUSIC.md). A song downloads the first time
  a film names it, with its grid; `flex library pull <key> --stems` fetches it ahead with its stems (in
  `~/Library/Application Support/Flex/library/<key>/stems/`). A good start, but every Flex film can use them, so a film
  that should sound like its own picks a track of its own.
- **Generated in Suno**, on the author's account. Write them the prompt: the style and mood, the tempo (BPM), the length,
  and the structure the plan needs (an intro, the build, the drop where the reveal lands, a clean ending), instrumental
  under narration. Ask for the stems too (drums, bass, vocals) and put them in the `stems/` folder `flex new` makes:
  `flex music` reads the grid and the vocal's words from them. Who may use the song depends on the author's Suno plan
  (paid plans allow commercial use, the free plan doesn't; check its current terms).

Record where the song came from in `audio.json`, beside the track: `"licence"`, `"source"` (the URL, or how it was
made) and, for CC BY, `"attribution"` (the exact credit line). A render writes them into `<film>.credits.txt`; put that
line in the video's description or on an end card. Never publish a film whose song's licence is unknown.

## 2. Read the music

```sh
flex music <dir> [--lyrics]
```

This gives:
- the tempo;
- the beat grid, its phase checked on the drum stem's kicks (the full-mix analysis is often ~¼ beat off);
- a bar-by-bar map of what each stem plays;
- the vocal's sung lines and every word with its time and `bar.beat` (local Whisper on the lead-vocal stem).

The words are what Whisper heard, sung line by sung line. Reading them (a brand word misheard, the hooks, which line
lands where) is the film's own work. `--lyrics` downloads the Whisper model the first time (~1.6 GB). It writes
`<track>.grid.json` (the pipeline snaps to it), `.music.json` and `.lyrics.json` beside the track. Time scenes and hits
against this; scene `start`/`end` are song seconds. `flex music <dir> --at 15.2` (bar.beat → seconds) or `--at 33.9s`
(seconds → bar.beat) converts on the grid.

Any audio, any stretch, word by word: `flex transcribe <file> [--from 33 --to 43] [--json]` (local Whisper). A stem or the
project's track gets bar.beat on each word too; a narration line gets its word times (to put a word on a beat). Whisper
hears sung audio differently in different windows: if a stretch comes back thin, try a shorter or shifted window.

A narration line's real length, before anything is recorded (the same voice and cache the film uses):
`flex run <dir> say "A line." ["Another."] [--bars <music key>]`. Fit lines to their windows first; a line that outruns
its take is otherwise only caught when the project loads.

### Two songs, sound effects and a hand mix

**A film across two songs.** The music edit can name a track per stretch: `music: { key: "intro", segments: [[0, 66.184],
[65.695, 119.16]], tracks: ["intro", "main"] }` plays `intro` from 0 to 66.184, then `main` from its own 65.695 (both keys in
`audio.json`, each with its `<track>.grid.json`). The joins crossfade (120 ms), so switch songs where they match: the
same key, a drumless gap, a bar line. The film grid follows: `flex grid` shows the switch, and after it the bars and
beats are the second song's own (so `cuts`, `narration` and bar.beat everywhere are right on both sides).

**A sound that ducks the music.** A card's sound can dip the music under it: `sfx: [{ at, sound, duck: { db: -9,
attack: 0.02, hold: 0.5, release: 0.15 } }]`, or a curve of `[seconds after the sound starts, dB]` points
(`duck: { curve: [[0, 0], [0.05, -4], [0.255, -9], [0.805, -9], [0.955, -3], [2.95, -3], [3.15, 0]] }`), linear between
them, at 5 ms resolution. Measure it with `flex mix <dir> --only music --from … --to …`.

**Shaped joins and stereo.** `joins: [{ out: 0.25, in: 0.12 }]` (one per join) lets the outgoing stretch play on `out`
s past the join, fading to silence, while the incoming one fades in over `in` s (linear); `null` is a butt cut. Without
it every join is a 120 ms crossfade. `stereo: true` keeps the music and sound effects in stereo (the voice stays mono,
centred); the default is mono stems.

**A hand mix.** By default the music is levelled to its role (bed or lead), faded in and out, and each sound is
levelled to −21 LUFS. A film mixed by hand gives a fixed `gain` in dB instead: `music: { …, gain: 0 }` plays the songs
at their own level with no automatic fades, and a sound's `gain: 0` plays the clip as it is.

## The script and the storyboard

The film's plan, before it is built: `script.json` in the project, its beats on the film's bars. Flex places it, shows it
(the storyboard lane, and the viewer as an animatic wherever the film isn't built: [Storyboard](features/10-storyboard.md))
and measures it; writing it and drawing its panels is the film's own work.

```json
{ "beats": [
  { "id": "into", "title": "Into the app", "at": "30.1", "status": "built" },
  { "id": "paying-in", "title": "Paying in", "at": "34.1", "status": "sketch",
    "picture": "Chanda records her payment; it lands pending", "music": "…", "sounds": "…", "proves": "…",
    "narration": [{ "text": "A member pays in from her phone.", "at": "34.2" }],
    "panels": [{ "sketch": "storyboard/sketches/03-record.svg", "caption": "The record sheet", "at": "34.1" },
               { "sketch": "storyboard/sketches/03-pending.svg" }] } ] }
```

- **Positions** are film `bar.beat` (`"34.2"`, `"13.2.5"`), on the grid `flex music` read, or seconds (`"31.4s"`). A beat
  runs from its `at` to its `to`, else to the next beat, else to the film's end.
- **Plan past the end.** A position past the film's last bar carries the grid on at the track's tempo, four beats a bar,
  so the rest of the film can be boarded before it exists: those beats are *planned*. The app's timeline and playback
  run on to the plan's length; the last planned beat runs a bar unless it has a `to`.
- **Panels** run from their `at`, or spread evenly over the beat when none gives one. A sketch is an SVG (framing, the
  device, an arrow for a camera move, a caption) or a PNG/JPG, by convention under `storyboard/sketches/`.
- **`status`** is the film's call: anything but `built` shows the beat's panels in the viewer; `built` shows the film's
  frames. Mark a beat built once its scene is.

```sh
flex script <dir> [--json]          # the beats on the clock; notes: unparsed positions, overlaps, gaps, missing sketches,
                                     # narration outside its beat
flex storyboard <dir> [--sheet x.png]           # every panel on one sheet, with its beat and bars
flex storyboard <dir> --animatic x.mp4          # the panels over the track, the plan's length
```

## 3. See the app as each seat

Declare who the app is seen as, and the pages, in `capture.json` (or `export const capture` in `project.ts`):

```json
{ "personas": { "manager": { "cookies": "node scripts/cookies.mjs manager" } },
  "walk": { "base": "http://localhost:3000/", "seats": { "manager": ["", "settings"] } } }
```

A persona's `cookies` is a command that prints the seat's browser cookies as JSON. Then:

```sh
flex walk <dir>             # every page as each seat → storyboard/walk/ + walk-sheet.png (redirects are marked)
flex walk <dir> --view dark [--full]      # a theme or size the project declares (capture.walk.views), whole pages
```

`capture.walk.elements` (name → CSS selector, e.g. `"loanRow": "table tbody tr"`) records each named element's box beside
every still (`<still>.boxes.json`, CSS px; × dpr for the still's pixels), so a card can cut a region without measuring.

A journey seats a persona with `import { seat } from "flex/personas"`, then `await seat(page, "manager")` in its
`c.start` prep, before the first page loads.

Text in a screenshot, a still or a PDF: `flex read <file> [--json]` (macOS's own text recognition, offline). `--json`
gives each line's box in the image's pixels (origin top left): find a label in a walk shot, then frame or zoom on it.

A page as a persona sees it, as a still for cards: `flex freeze <dir> <persona> <path|url> [--element css] [--view v]`
→ `assets/freezes/<name>.png` (2×). Clip to the element a card needs (a row, a card) rather than shrinking a whole page.

## 4. Record the takes

Journeys in `journeys/<name>.ts`. Data states, staging scripts, versions, the timing report, previews and picks are
covered in [capture.md](capture.md):

```sh
flex capture <dir> <journey> --dry
flex capture <dir> <journey>
flex report <dir> <take> v<n>
flex pick <dir> <take> v<n>
```

The camera plan: `flex camera`, or the camera lane in the app. An effect's parameters: `flex camera <dir> <take> <id> --param delay=250`.

Journey tips:
- `c.view(720, 405, 1)` frames the window edge to edge; `c.unfocus()` is the whole stage at rest.
- Before the metronome starts, park the cursor on the first click target.
- On big tables, role lookups (`getByRole`) can take 0.3–1.5 s and make beats late; text and CSS locators are fast.

## Size

Work at the normal size: captures at 2×, renders at 1080p. 4K is an export choice: re-capture the takes at 3×
(`flex capture … --dpr 3`) and render with `--size 4k` when the film is exported at 4K.

**A vertical film** (TikTok, Reels, Shorts) declares its frame in `frame.json`: `{ "width": 1080, "height": 1920 }`.
Everything follows it: cards get `ctx.out = { w: 1080, h: 1920 }`, `flex frame` paints 1080 × 1920, the app's viewer is
9:16, and `flex render` writes 1080 × 1920 (`--size 1440p` / `4k` scale its short side to 1440 / 2160). Without the
file the frame is 1920 × 1080. Draw against `ctx.out`, never a hard-coded 1920 × 1080: the pipeline's built-in cards
and effects were designed for 16:9, so a vertical film is made of its own cards.

**Clips:** a `{ video: file, at, rect, crop?, radius?, opacity?, alpha?, rotate? }` layer draws the clip's frame at `at` seconds,
in Flex's preview and in the render alike: both read the same frame cache (the clip's frames at 30 fps, extracted once
into the work folder). `alpha: true` keeps a cut-out clip's transparency (ProRes 4444 or any format with alpha; see
`flex cutout`). `rotate` (degrees clockwise about the rect's centre) turns an `{ image }` or `{ video }` layer, in both
renderers. Scene ids must be unique across the film (a composite film's imported scenes included): a duplicate is an
error.

## Cards

A card lasts its `dur` (or `bars`) exactly, short or long; a silent card with neither lasts at least 1.2 s. Its clock
`ctx.t` is the frame's exact time (frame × 1000 / 30 ms, not rounded), in Flex's preview and in the render alike.

`flex card <dir>` lists the cards the project can use (the pipeline's and its look's) with their defaults; `flex card
<dir> <type> [--params '{…}'] [--at ms | -o x.mp4]` renders one alone, as a still or a clip. A look's cards and effects
need distinct names.

`flex assets <dir>` lists everything the film is made from (the song, stems and sounds, takes and versions, cards, the
look, labs, freezes and stills, renders), and `flex assets <dir> --preview <id> -o x.png|x.mp4` shows any one the way the
author sees it in the assets panel. A card previews with its defaults, which may not draw anything (a card that needs a
page). Give it sample values beside your cards: `export const previews = { "<card type>": { params: {…}, dur: 3000 } }`
in `look.ts` or any `cards/*.ts`.

## 5. Check and render

```sh
flex frame <dir> 12.5s -o x.png   ·   flex joins <dir>   ·   flex accept <dir> --film <mp4>
flex render <dir> [--scene <id>]               # 1080p → ~/Downloads/flex-videos/<film>/ (--size 4k on export)
                                                #   a card film: Flex's painter (what the preview shows); takes: the pipeline
flex render <dir> --range 76.6s:83s            # an excerpt with its sound (Flex's painter; or bar.beat: 37:40)
flex render <dir> --audio-only                  # mix again, swap the sound into the last render (picture copied)
flex run <dir> check @                          # any pipeline tool, with Flex's environment (`flex run <dir>` lists them)
flex mix <dir> [--only music|voice|sfx] [--from 15.1 --to 19.1]   # the sound alone, in seconds, with its loudness
flex grid <dir> [--at 15.2 | 52.3s | song:33.2s]                  # film bar.beat through the music edit
flex cuts <dir> [--off]          # each cut's distance from the nearest beat and declared hit
flex narration <dir>             # each line's words in film bar.beat, and any word over the song's singing
flex duck <dir>                  # the music's dip under each line: depth, attack, release, pumping, voice over music
flex shift <dir> --at 43.1 --by +2   # what moves if bars are added or cut at a point (a preview)
```

`flex render <dir> --scene <id>` draws the scene exactly as it plays in the film (its last card holds or cuts as there);
it used to play as the film's end, so a film stitched from scene renders drew differently.

**Which renderer.** A film made only of cards renders with Flex's own painter: the render is exactly the preview (one
engine for both, several times quicker), with its `.srt` and `.credits.txt` beside it. A film with captured takes renders
through the pipeline. `--pipeline` forces the pipeline for a card film; the two paint the same frames byte for byte
(Flex draws SVG and rotations through the pipeline's own libvips/librsvg).

A render writes beside the old film and swaps in when it's complete, so the last good film stays playable (a review
page, a player) until then.

## Media tools

```sh
flex cutout <photo|clip> [--from 5.5 --to 13.4] [-o x.mov] [--preview]   # her, cut out: ProRes 4444 / PNG with alpha
flex onsets <stem> --from 92.4 --to 96.3 [--expect 7] [--project <dir>] # where sung letters and syllables start
flex crop <photo> --cell 1080:1350 [--subject face|person] [--max 1.3]  # a cell centred on her, never over-enlarged
flex sheet <video|folder> --from 76 --to 83 [--fps 2] [--ref other.mp4] # a labelled contact sheet; --ref pairs + Δ
```

- **cutout** keeps the person instance and drops background text and signs (and anything she holds that isn't a person:
  `--keep-text` keeps them). It smooths the mask over time without ghosting fast arms, drops specks and defringes the
  edge. The clip plays in a `{ video, alpha: true }` layer.
- **onsets** is for what Whisper can't hear: sung spelled letters, Swahili, a held note's change. Run it on the lead
  vocal stem; letters land on the sung onset, not the grid. A consonant and its vowel count as one onset at the
  consonant (a sung "haitch" lands on the h). With `--expect N` it keeps the N strongest. A project's track or stem gets
  film seconds and bar.beat (a stem is matched by its `<song> Stems` folder or the song's length).
- **crop** places a face a little above centre (person: centre at 0.57); past `--max` it widens the crop and says so.
- **sheet** takes frames by exact index, labelled `79.000 s · f2370`; `--ref` shows each beside another film's same frame
  with their mean difference (green / amber / red), the way to check a port against a reference.

## Composite films

A film can be made of other films' scenes. Import their scenes (or cards) into `project.ts`, and have the project's
`look.ts` bring in their looks so their cards render here under their own names:

```ts
import filmB from "./film-b/look.ts";
import filmA from "./film-a/look.ts";
export const uses = [filmB, filmA];          // their cards keep their names (film-b/…, film-a/…)
export default defineLook({ name: "<this project>", tokens: filmB.tokens, cards: { /* this film's own */ } });
```

Their media must be where their code looks for it (link it in; don't copy). Scenes are on the film clock: with a music
edit, `start` / `end` are film seconds. Items land on the frame nearest their running total, so place a sound by film
time, not by scene start.

## Voice

Narration is voiced by OpenAI's gpt-4o-mini-tts when there is a key (`flex key set openai`, or `OPENAI_API_KEY`; Flex keeps it in its support folder), else
local Kokoro. Lines are cached per voice, so switching re-voices every line. A film approved with one voice can keep it:
`export const voice = "kokoro"` in `project.ts`.

A project chooses its narrator in `voice.json`: `{ "engine": "openai", "voice": "ash", "style": "…" }`. `voice` is
OpenAI's voice name; `style` tells gpt-4o-mini-tts how to read (tone, pace, energy: "a charismatic product lead at a
launch, upbeat and warm…"). `"engine": "kokoro"` pins Kokoro. Changing either re-voices every line (the cache is per voice
and style), so measure the lines again (`flex run <dir> say …`): an energetic read is often slower than Kokoro's.
