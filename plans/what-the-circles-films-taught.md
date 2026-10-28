# What the Circles films taught: the hand-built tools, made Flex's own (2026-10-28)

Flex `main`. Two KinPay Circles films (`release-videos/circles/overview-60`, the 95 s cut, and `overview-ussd`, the
2:27 long version) were finished with Flex, but a lot of their work was done by hand or with tools invented inside the
project folders. Each of those is a gap in Flex. This plan takes every generic one into Flex, extracting the generic
behaviour from the specific thing we built. The films stay as they are: they are the evidence, not the target.

Pipeline changes follow the seam ([docs/pipeline-seam.md](../docs/pipeline-seam.md)): edit Flex's copy in `pipeline/`,
save the change as the next numbered patch in `pipeline-patches/`, never touch fancy-e2e-videos.

## Where each gap came from

| # | Gap | Hand-built in the Circles films | Flex today |
|---|---|---|---|
| 1 | Footage stutters on frame boundaries | `F2 = 1/60` offsets and `HOLD` in `scenes/cut.ts`, hours of looking at repeated frames | `video_frame` takes `floor(at × 30) + 1`: a time a hair under a boundary shows the previous frame twice |
| 2 | Nothing finds repeated or skipped frames | contact sheets and eyes | `flex joins` checks scene cuts only |
| 3 | A music edit can't match two songs' loudness or line one up | `audio/gen-music.sh`, `gen-song-music.sh`, `gen-ext-music.sh` (ffmpeg by hand: +3.4 dB, a 0.09 s offset, limiter) | `segments` + `tracks` + shaped `joins` exist; no per-segment gain or offset |
| 4 | Joins where two bass lines fight | heard by the author (0:49, 1:06) | `flex music` measures stems per bar, but never against the edit's joins |
| 5 | A song's map, reused across films | `song-map/` (analyse.py, features.py, transcribe.py, curation.json, song-map.md/json) copied by hand | `flex music` prints, per project; nothing beside the song |
| 6 | Hits to sync to | read off the map by hand (the drop at 14.31, the slams) | `flex cuts` measures against hits you declare |
| 7 | Beat arithmetic in every project | `bar()`, `fbeat()` redefined in each `cut.ts` | `flex grid` converts, but nothing for code |
| 8 | Text on screen long enough to read | `scripts/reading-check.py` (a regex over `cut.ts`, skips expressions) | `check.ts` checks narration speed only |
| 9 | Phone takes from a web app | `phone/_rec.mjs`, `phone/frame.mjs`, `cards/phone.ts`, copied across three films | `flex capture` is a 1440 × 810 desktop browser; `flex mockup` has the phone frame |
| 10 | Pages with no clock, recorded state by state; text found for a lens | `ussd/_rec.mjs` (`window.show`, keys, `finds`) | journeys can `evaluate`; nothing records where a phrase sits |
| 11 | A magnifying lens whose subject escapes the glass | `cards/desk.ts` lens + escapes (grow, clamp in frame), `cards/ussd.ts` bands | none |
| 12 | Figures that roll | `scripts/make-count-frames.mjs` (a PNG per frame), `Roll` in `desk.ts` | none |
| 13 | Comparing music variants under one picture | `~/Downloads/circles-tape-variants`, `circles-rap-mock` (hand-written pages) | `--variant` flags exist; no page |
| 14 | A scene-by-scene review checklist with clips | `scripts/review-doc.mjs` (474 lines) | the board (`review/`) has no per-scene clips |

Left in the projects (KinPay-only): `seed-org`, `stills.mjs`, `make-book-plain`, `chapters.mjs`, the review notes.

## Phase 1 — Footage that never stutters (gaps 1, 2)

- `video_frame` (Rust) and `videoFrame` (pipeline, patch 19) pick frame `floor(at × 30 + 1e-6) + 1`, so a source time
  that lands on a boundary through float error gets its own frame. Bump `PAINTER_VERSION`.
- `flex stutter <dir> [--scene id] [--json]`: walk every film frame's video layers (from the plan, no painting), map
  each to its source frame, and report per scene: **repeats** (the film moves on, the source frame doesn't, for 1–2
  frames: a stutter; longer runs are holds, listed as such), **skips** (the source jumps 2+ frames), and segments whose
  source plays faster or slower than 1:1.
- `flex stutter <mp4>`: the same on a render, from the pixels (consecutive frames identical where the frames around
  them move).

**Verifiables**
- `cargo test -p flex-core` green, with a test: a source time of `k/30 − 1e-12` maps to frame `k + 1`.
- On overview-ussd with its `F2` offsets removed (in a scratch copy), `flex stutter` reports 0 repeats in motion and end;
  the old build's frame mapping reports the repeats we saw.
- `flex stutter` on a render of the 90 s film lists no stutter; on a clip with a doubled frame (made with ffmpeg) it
  names that frame.

## Phase 2 — Music (gaps 3–7)

- **Per-segment gain** (patch 20): `music.gains?: number[]` (dB per segment; a raised segment is limited so it can't
  clip) and `music.match` (level each track to the first segment's: `true` by what each plays in the edit, or a
  reference stretch per track, `{ "new": [20, 36], "old": [20, 36] }`, where the songs play the same thing). An
  alignment offset needs nothing new: segments already take exact song seconds.
- **Join check:** `flex music <dir> --joins`: for every join of the edit, each stem's level in the bar before (the
  outgoing song) and after (the incoming one), from each track's `.music.json`. Flags two bass lines meeting, a join
  off its song's bar lines (the bar's "1" moves), and the lead vocal singing through (a softer note); a whole-bar
  repeat or skip of the same song is a repeat, not a fight. For a fight, bar lines within two bars where the bass rests.
  (No `--edit` analysis: the check reads the tracks' own maps, so the edit's stems never need cutting.)
- **The song map:** `flex music <dir> <key> --map` writes `<song>.map.json` and `<song>.map.md` beside the song:
  the grid and its drift per bar (strong drum and bass hits against the nearest 16th), each bar's stems, mix level,
  hits and words, drops (drums and bass resting between bars that play), slams (the biggest one-beat rises, silence
  floored at −60 dB), entries, sung lines; merged with `<song>.curation.json` (section names, best moments, notes),
  which Flex creates empty once and never writes over.
- **Hits:** `flex cuts <dir> --suggest`: each scene change's nearest slam or drop return within a bar, placed through
  the edit, and the song's hits no scene change lands on.
- **Beat helpers** (patch 21): `lib/beats.ts`: `beats({ bpm, downbeat })` → `bar(n)`, `beat(k)` (from bar 1's "1"),
  `at("6.3.5")`, `of(t)`, `snap(t)`; `projectBeats(dir)` from audio.json (bar 1 = the first "1" from the start).

**Verifiables**
- The 90 s film's music rebuilt as a `segments` + `tracks` + `gains` edit in a scratch copy of overview-60: `flex mix
  --only music` matches `count-me-in-60song.flac` within 0.5 LU and the join times within 5 ms.
- `flex music --joins` on the long version's first cut (joins at 50.3 and 67.1, from git history) flags both; on the
  shipped edit it flags none.
- `flex music --map` on the 4-minute song reproduces the hand-made map's sections and bar times (±1 beat), and keeps a
  hand-written curation block across a re-run.
- `beats()` gives `bar(6) = 14.31`, and `beat(k + 20)` equals every circles `fbeat(k)`; a unit test
  (`server/tests/beats.test.ts`).

## Phase 3 — Reading time (gap 8)

- `flex reading <dir> [--scene id] [--min-height 28] [--json]`: paint frames every 100 ms at half size (from the cache),
  read their text (macOS Vision, as `flex read`), follow each line of display text (cap height ≥ `--min-height` film
  px, so a screen recording's UI labels don't count) from its first frame to its last, and flag each line on screen for
  less than 0.3 s a word + 0.7 s. Lines read inside a magnifier count too, so a lens closing too early is caught.
- Its own command, not a `flex check` WARN: it paints and reads the whole film (about a minute), too slow for a check
  that runs on every edit. `--slack` (0.4 s) is the time a line reads while fading but isn't recognised yet.

**Verifiables**
- On overview-ussd, `flex reading` agrees with `scripts/reading-check.py` on every line the script can see, and finds
  at least one the script skipped (an expression `out`) or proves there is none.
- A scratch scene with a 5-word line held 1.2 s is flagged; held 2.3 s is not.
- Time for the long film < 3 min on this Mac.

## Phase 4 — Phone takes and pages with states (gaps 9, 10)

- **A phone in capture** (patch 22): a journey's `capture(take, fn, { device: "iphone" })` (and `capture.device` in
  project config) records in the iPhone `flex mockup` uses: 402 × 874 pt at 3×, touch, its safe areas (CDP
  `Emulation.setSafeAreaInsetsOverride`, 62 / 34), the clock fixable (`clock: "2026-10-18T15:00"`), taps recorded as
  events (the scene draws the touch), and the colour behind the status bar sampled through the take (`bars`).
- **A phone layer** (patch 22): `phoneLayers(take, { x, y, height, at })` in the kit frames a take in Flex's own device
  frame (the same CSS as `flex mockup`, rendered once into the support folder), with the status bar's glyphs picked by
  `bars`, and the taps drawn.
- **Text finds:** `c.find(text, name?)` records the box of a phrase on screen at that moment into the take's marks
  (`finds`), so a lens can target `find: "K 550.00"` instead of pixel boxes.
- **States on beats:** the documented pattern for pages with no clock (a page exposing its states, a journey setting one
  per beat with `c.state(fn)`, which waits for paint): the USSD handset as the example, in `docs/capture.md`.

**Verifiables**
- The 90 s film's `chanda-shareout` take recorded with `device: "iphone"` gives the same screen pixels as
  `phone/_rec.mjs` (≤ 2/255) and the same row box.
- A scene using `phoneLayers` paints the take in the frame the same as `cards/phone.ts` at the same size (≤ 3/255),
  status bar glyphs light over the purple home.
- `c.find("K 6,152.50")` gives the box `phone/_rec.mjs` measured (±2 px).

## Phase 5 — Lens and figures (gaps 11, 12)

- **A lens** (patch 23) in the kit: `lensLayers({ at, out, target: Box | {find}, mag, shape: "circle" | "band",
  escape?: Box[], grow = 0.45 })`. Escapes are drawn magnified past the rim and clamped inside the frame (24 px margin,
  an optional `keepRight`); a lens open for less than 2 s warns in `flex check` (`lens-short`).
- **Rolling figures** (patch 23): `counterLayer({ at, dur, from, to, format, box, font, size, ink, bg })`, drawn live
  (no PNG per frame), easing like the desk's `Roll`; usable inside a lens escape.

**Verifiables**
- A scratch card with `lensLayers` on the desk still at 61 s of the 90 s film paints within 4/255 of the shipped frame.
- `counterLayer` from 0 to 5,250 in `K #,##0.00` over 1.4 s: frames at 0, 0.7 and 1.4 s read `K 0.00`, a middle value
  and `K 5,250.00` (`flex read`).
- An escape placed off the right edge is drawn inside the frame.

## Phase 6 — Review pages (gaps 13, 14)

- `flex compare <dir> --variant NAME=a --variant NAME=b … [--moments 38.3,57.5] [-o folder]`: renders the picture
  once, mixes each variant's sound (`flex mix`), muxes one mp4 per variant, and writes a page: synced players (one
  sounds at a time), the music edit of each as a timeline, moment buttons. Projects declare the variants already.
- `flex clips <dir> [--notes notes.json] [-o folder]`: a clip per scene from the latest render, and a checklist page
  (scene, time, clip, notes per scene, a box per item, feedback to copy back), the generic part of `review-doc.mjs`.

**Verifiables**
- On a scratch copy of overview-60 with two music variants, `flex compare` writes a page whose players play the same
  picture with different music; looked at with /browse.
- `flex clips` on overview-60 writes 9 clips whose lengths match the scenes (±1 frame) and a page that loads with
  /browse.

## Phase 7 — Reinstall, then an agent tries it

- Reinstall Flex from this tree (`scripts/package.sh`, `scripts/install-cli.sh`, `scripts/sync-skill.sh`), so the
  installed app, `flex` and the skill are this build. Update `docs/features/`, `docs/capture.md`, the skill's
  reference pages.
- Hand a fresh agent a brief (no knowledge of this plan): a short film in a scratch folder from a sample app and a
  library song, asking for things that need each phase (a phone take, a lens on a figure, text that must read, music
  cut from two places, a variant to compare). Watch its transcript for what it used, what it missed and where it was
  tripped, then fix what it hit.

**Verifiables**
- `flex --version` and the app's About show the new build; `flex stutter --help`, `flex reading --help`, `flex compare
  --help` work from the installed command.
- The agent's report and transcript: which of the new tools it used unprompted, every trip-up listed, each fixed or
  written up below as a follow-up.

## Phase 8 — Clean up ~/Downloads (after the agent trial)

Months of film work left partial work in `~/Downloads`: renders Flex can make again (`flex-videos/`, `flex-mockups/`),
review folders, mocks (`circles-tape-variants`, `circles-rap-mock`, `circles-kwacha-mock`), scratch copies, hand-offs.

- Inventory every top-level item: size, last modified, and what it is (which film or project made it, whether a
  project or Flex can regenerate it and with what command, whether anything links to it: a PLAN.md, a board card, a
  memory, an artifact).
- Sort into **regenerable** (renders, review clips, mock renders: the command that remakes it), **keep** (the author's
  own sources: songs, Suno exports, hand-offs, designs, anything not reproducible), **move** (sources a project needs,
  into that project's folder or the song folder), **unsure**.
- Show the author the list (a page with sizes and the recommendation per item); delete or move only what they approve,
  and nothing in **keep** or **unsure** without a yes item by item. Fix any link that pointed into Downloads.

**Verifiables**
- The inventory page lists every top-level item in ~/Downloads with its class and reason.
- After the approved clean-up: each deleted item's regenerate command runs (spot-check one render and one mock), every
  project still opens (`flex open`) and its media resolve, and no PLAN.md, board card or memory points at a deleted path.

## Status

- 2026-10-28: plan written.
- 2026-10-28: **Phase 1 done ✅** (`frame_index` + patch 19, `PAINTER_VERSION` 8, `flex stutter`). A copy of the 90 s
  film without its `F2` offsets: the old rounding shows 30 repeat-then-skip pairs in the intro and 19 in motion; the new
  one, none. A render with a frame doubled (ffmpeg `freezeframes`) is caught at that frame; a clean one passes. Found on
  the way: the 90 s film rendered today repeats 21 frames in its intro (it never had the offset), exactly the old
  rounding's list, plus two at 54.4 s: its next render with this build fixes the intro (Phase 7).
- 2026-10-28: **Phase 2 done ✅** (patches 20–21, `flex music --joins` / `--map`, `flex cuts --suggest`).
  - The 90 s music as a Flex edit (7 segments, two songs, `gains` +4.1): 0 ms off the hand-made file at every join,
    section loudness within 0.4 LU. The mix ends 0.17 s shorter: room tone at −66 dB trimmed by the existing
    level-and-duck stage, not the edit. `match` with a verse reference per song gives +4.1 dB, as measured by hand
    (`true`, over everything each plays, gives +5.8: why the reference form exists).
  - `--joins` on the long version's first cut flags both joins the author heard (50.31: two bass lines; 67.11: the
    in-point a beat off its bar line), and suggests 131.93 for the first, where the fix went (131.91). The shipped
    edit: no bass fight, no moved "1"; the repeated tail bars read as repeats.
  - `--map` on the 4-minute song finds the hand map's drops (bars 55, 64, 78, 86, 94, 96) and slams (2.1, 6.1, 56.1,
    80.1, 98.2) and its drift (+20–30 ms bars 66–78, +33–46 ms in the guitar break). The hand map's sections and
    treasure, carried into `Combined.curation.json`, survive a re-run.
  - `cuts --suggest` on the 90 s edit names the drop at 14.32 and the slam at 59.93, both used by the film.
- 2026-10-28: **Phase 3 done ✅** (`flex reading`, `flex read`'s batch mode). On the long version, 67 s: 39 of
  `cut.ts`'s 40 card lines found, none it passes flagged (the 40th, "Bwalya dials / *546#.", reads as its first line:
  a line of digits and symbols isn't text). Found what the script can't see: "Loans go out. / And come back." (an
  expression `out`) is on screen 1.6 s for a 2.5 s read in both films, and the USSD/SMS lens bands show 9–13 words for
  ~2.1 s. A/B in a scratch copy: held 2.9 s, the same line passes. Overlapping lines don't count as readable.
