# Plan

What is left to build. The product is in [plans/PRD.md](plans/PRD.md); its MVP is the
`circles-overview` sample playing live, refreshing on an edit, and showing renders.

Decided with the author (2026-10-16):

- The app opens a project folder and runs everything itself. **Flex owns its server**
  ([docs/server.md](docs/server.md)), shipped inside the app: it calls the pipeline's own code
  for what goes in a frame and never copies it.
- **Rust paints.** Measured on the sample's slowest frames: the pipeline's paint takes 29 ms
  (sting) to 3.8 s (slides); resvg + tiny-skia take 4–400 ms, 3.6–9.5× faster on one core, and
  17–950 frames/s on all cores, within 0.03–1.5/255 of the pipeline's pixels. Building a frame's
  layers costs 0–10 ms, so painting is the whole cost.
- Frames are cached **by a key of their layers** (content hash), not by scene: an edit repaints
  exactly the frames it changed.
- Audio plays in Swift (AVFoundation); while it plays, its clock is the film's clock and the engine is
  told the playhead. The timeline is drawn in SwiftUI.
- The sample lives in `samples/circles-overview`, out of git.

## Done (2026-10-19): a composite music film as a Flex project

Turn a Python-assembled vertical music film (Final 1, below) into one Flex project. The Flex side delivers
multi-track music with a stitched grid, ducks on sound effects, `{video}` layers in the painter and a safe render swap
(items from "From two vertical music films" below). The project side ports the PIL sections to cards. It's accepted
against the delivered film.

**Status: done 2026-10-19 ✅** — accepted against the approved film. Phase 0 grew to include
five first-party tools (`flex cutout`, `onsets`, `crop`, `sheet`, `render --range` / `--audio-only`) and every
product limitation the port hit (layer rotate, shaped joins, stereo, unique scene ids, explicit card lengths, exact
card time, solo scene renders as in the film, painter cover).

## The principle: AI does the work, the author brings taste (2026-10-16)

AI agents will do most of the work on every film: write the journeys, stage the data, capture, build the cards, cut the
music, place the narration, run the labs, merge, render. The author interjects with feel, taste and small visual tweaks.
So every part of Flex and the pipeline must be as usable by an agent as by a person:

- **Every action has a CLI and a machine-readable result.** Anything the app does (open, play range, paint a frame or
  still, run a journey, stage data, compare takes, check joins, render, export) is a `flex` command with JSON output, so
  an agent can do it and read the outcome without the UI.
- **Agents can see.** Stills, contact sheets and join diffs on demand, at any size, so an agent checks its own work
  visually before reporting (the circles session lived on stills and frame diffs).
- **Taste comes in as structured notes.** The author's notes (time, region, still, text) are files an agent reads and
  answers, not chat paraphrase.
- **Guardrails are explicit.** Writes to real data, renders that fill the disk, and releases need a confirm from the
  author; everything else an agent may run freely.
- **The final acceptance test is the walkthrough film (section 7), made end to end by an agent.** Before it, the first
  agent-made film (below) proves the loop on a real product.

## The first agent-made film: Circles, the in-circle surface (decided 2026-10-16)

The first film an agent makes end to end, a milestone before the final acceptance test (the Flex walkthrough, section 7):
**the next phase of KinPay Circles, the in-circle surface** (design hand-off `~/Downloads/circles-design-handoffs/04-circle/`: `BRIEF.md`,
`_SHARED-CONTEXT.md`, `MOBILE-PATTERNS.md` and 19 reference screenshots). One role-adaptive shell
(`/circles/:circleId/…`), nine tabs seen from three seats (manager, member, overseer: Overview, Contributions, Loans,
Members + the MemberSheet, Reports, Configuration, Onboarding, Recommender, Statement), desktop and mobile, light and
dark.

- **Why this one first:** it is a web app, so the existing browser capture records it today (journeys, data staging, beat
  sync, retime), the kind of film most projects will be. A film about Flex itself needs native Mac window capture, which
  Flex does not have yet (Screenshot Studio's walkthrough recorder relies on macOS screen recording, which does not come
  across with the port); the walkthrough stays the final test once native capture exists.
- **How:** an agent makes it end to end with Flex and its CLI: reads the hand-off, writes the script and the shot list,
  writes journeys against the real app (local stack, e2e personas for manager / member / overseer, data staged by the
  project's own e2e scripts, never a reseed), captures at 3×, builds the cards on the circles-overview look (its shared
  pieces: window, lift, stage grid, brand), cuts the music, places narration, runs labs where a beat is open, checks its
  own work with stills and join diffs, and renders. The author gives taste: notes, lab picks, small tweaks.
- **It lives next to circles-overview** in the `release-videos` repo (`circles/<name>`), reusing its shared modules.
- **Done when** the film is approved by the author and every point where the agent got stuck, guessed or needed a person
  for something mechanical is logged and fixed in Flex or the pipeline.
- **Order:** after the MVP and capture (it needs both); it then drives labs, agents and audio from real use.
- **How it is run (the author, 2026-10-16):** a separate agent gets only the folders: the hand-off, the music
  (`~/Desktop/Kinpay/Kinpay Circles Music/Kinpay, Kinpay Circles/`: `full.mp3` + 9 stems) and Flex. It finds and processes
  everything itself with Flex's and the pipeline's tools (the audio analysis, fitting the cut to the beats), so the test
  shows whether those tools work. The orchestrating session does not pre-chew any of it. Its gap log is
  `circles/in-circle/GAPS.md`.
- **Setup patched before the hand-over (2026-10-17):** an agent should only meet a film's own puzzles (a missing e2e
  route or script, a staging step), not holes in the setup. Added:
  - `flex doctor`;
  - `flex new`;
  - `flex music`: replaces the one-off numpy scripts the first, stopped attempt wrote;
  - personas and `flex walk`;
  - `flex run` (any pipeline tool with Flex's environment);
  - `flex render`;
  - patch 06: the pipeline's build/, cache, projects and output folders come from Flex;
  - tools run with the login shell's PATH (Flex's own PATH put Homebrew's python3, without Kokoro, first);
  - mlx-whisper installed as a tool, with the model downloaded;
  - the OpenAI key (Settings, `flex key`), with a per-project Kokoro pin;
  - docs/making-a-film.md.
- **Gaps already seen while scoping (before the hand-over):**
  - no `flex new` to start a project;
  - personas and their logins are tribal knowledge (journeys-e2e/scratch-audit-setup.ts), and there is no way to declare
    them;
  - no "walk every tab as each seat" storyboard tool;
  - no local Whisper on this machine, though the plan assumes one;
  - journeys import the pipeline by a relative path four folders up.

## Update, 2026-10-16 (afternoon): what the circles-overview session learned

The plan above was written against the morning's copy of the film. A long day on `circles-overview` since then changed a
few assumptions. Decided with the author:

- **Flex is self-contained from other projects, not from the pipeline.** It ships its own copy of the pipeline runtime
  (fancy-e2e-videos `lib/`, `looks/`, the sound manifests), synced wholesale from a pinned commit, and needs no
  fancy-e2e-videos checkout. It still uses the machine's global tools: Kokoro or OpenAI for narration, the local Whisper
  model for transcription, ffmpeg. Details: [docs/pipeline-seam.md](docs/pipeline-seam.md).
- **The plan / layers / mix split lives in Flex's copy, as patches** (decided later the same day: fancy-e2e-videos is not
  touched from here; another agent works there). `scripts/sync-pipeline.sh` copies the pipeline's working tree, then
  re-applies Flex's small patches (`pipeline-patches/*.patch`: a plan-only mode in `renderSequence`, exported helpers in
  `render.ts`, the takes and voice-cache paths). A patch that no longer applies fails the sync loudly. Then Flex deletes its stop-gaps: the server's
  own card layout (items end to end by `dur`), its copy of `resolveAt`, its own cue collection. These already drifted: since
  the morning the pipeline gained per-key typing sounds, `sayOver` (a line doesn't stretch its card), music
  `underVoice`/`role`, the animated stage grid + border drawn per frame around takes, grid ripples and cleared spaces,
  `OUT_SIZE=4k` (layout stays 1920 wide; `OUT_K` scales), `CAPTURE_DPR` (takes at 3×).
- **Takes become paintable** through `layersAt`: the recorded frame, the camera's crop, the canvas, grid and border, the
  cursor and ripple, the effects. That is about 40% of circles-overview (Home, how it works, pool-up).
- **The sample is stale.** The film is now 9 scenes (sting · into-the-app · ui-tour · book · home · how-it-works · pool-up ·
  reports · outro), 2:23. It lives in the `Kinpay-Me/release-videos` repo under `circles/overview` (plus `circles/overview-lab-*`);
  `copy-sample.sh` should copy from there.

What to add to the plan, from how the film was actually made:

1. **Variants.** A/B all day was env flags (`END=dark|white`, `ROLL=steps`, `FINISH`, `MONEY`, `OUT_SIZE`). Projects declare
   them (`variants: { END: ["white", "dark"] }` in project.ts, a pipeline addition); Flex shows them as toggles and A/Bs
   them without code edits.
2. **Labs as siblings with a target.** Labs were sibling project folders (13 today: `overview-lab-*`), each with its own
   project/look, importing shared pieces from `../overview`, with their own music window (`from: 19.11`). Merging one meant
   porting files, adding a music-edit segment and retiming everything after it. Rather than `labs/<id>/` only, read a lab's
   `target` (`{ project: "../overview", section: "book" }`) to play it in place over the right stretch, and compare several
   labs side by side (the author compared 3–4 at a time).
3. **Timeline lanes from the project, not the analysed grid.** Each project defines its film-time grid in `hits.ts`
   (`SECTIONS`, `fbar`, `HIT`, the music `EDIT`). The song's analysed `.grid.json` sits ≈0.25 s off the film's kick grid (it
   is why `check` reports false "off the beat" warnings). The project exports markers; Flex draws them.
4. **A join lane.** The day's most common bug was at scene seams (a stale frame at a cut, a grid jump, a one-frame offset
   during a camera move). Diff the frames either side of every scene boundary and flag jumps. Seams belong on still moments.
5. **One painter, promoted from Later.** A full 4K render takes ~2 h because the pipeline re-renders every frame each run.
   Final renders through Flex's painter and key cache would be incremental and 4–10× faster. Lossless **stills** at any
   size come free (the author wanted posters; the session had to hand-write one).
6. **Smaller:** debounce server restarts (several agents edit a project at once); cap the frame cache (the disk ran low);
   a render queue with progress; review notes (`review/notes.json`) for the author's timestamped feedback.

Order from here: refresh the sample → vendor `lib/` with the sync script, the patches and
import redirect, delete the stop-gaps → finish the MVP (lanes from markers, renders + A/B, variants, the join lane,
stills) → capture → the first agent-made film (Circles, in-circle) → labs → agents (notes first) → audio tools → one painter for final renders → Screenshot Studio → the walkthrough film.

## The MVP, redefined (2026-10-16)

**Status (2026-10-16 evening): the MVP is complete** and on `main` (all six items below).
`flex accept samples/circles-overview --film <the pipeline's render>`: 85 frames across all 9 scenes, 0 failing, 0
placeholders, every scene 0.5–1.6/255 mean against the rendered film (compression), the mix −17.0 vs −16.7 LUFS. A cold
warm-up paints all 3,970 unique frames at 960 px in 136 s (faster than the film's 143 s). The app: timeline lanes from the
project's markers (sections, bars, hits, the edit's joins, the waveform, narration), the join lane (`flex joins`: 8 joins,
0 jumps, 1 intended cut), variants (END white/dark, `--variant` on every command), renders with A/B (side by side or wipe;
renders folder defaults to `~/Downloads/flex-videos/<project>/`, chosen per project), still export at any width (save
panel). Not yet seen by hand: the Renders and variant dropdowns and the Export Still sheet (verified through launch
options and the CLI, not clicked).


**Done means: `circles-overview` previews end to end, picture and sound, with no placeholders.** All 9 scenes, 2:23, at
any width up to 4K, matching the pipeline's render.

What that takes, beyond what is built (in order):

1. **Vendor the pipeline** (`scripts/sync-pipeline.sh`: the pipeline's `lib/`, `looks/`, sound library and
   `package.json` into `pipeline/`, then `pipeline-patches/`; a `pipeline/SOURCE` stamp with the commit and whether the tree
   was dirty), the import redirect (a Node resolve hook: any `…/fancy-e2e-videos/lib/…` import goes to `pipeline/lib/`), and
   Flex-owned `server/timeline.mts`: `planSequence` (the patched `renderSequence` in plan-only mode), `layersAt` (cards
   through their own `render`; takes as layers: the recorded frame, the crop, the stage grid and border, cursor, ripple,
   effects) and `mixSequence` (`mixAudio` on the plan's cues). Takes live in the project (`<project>/takes/`); the
   project declares `variants` and `markers`.
2. **Delete the server's stop-gaps** (own layout, copied `resolveAt`, own cue collection). The server becomes a thin caller.
3. **Paint takes.** A take frame is image + crop + SVG: the recorded frame (`takes/<take>/frames/*.jpg`, 3× = 4320 px
   wide since 2026-10-16), the camera's crop of it (Lanczos downscale, which the painter already has), the canvas, the
   animated stage grid clipped outside the window, the window border, the cursor with its press and click ripple, and
   the take's effects. Checked on this film: its take effects (`chapter`, `step`, `drop`, `now`, `lift`) are plain SVG;
   none needs the raster blur op (`composePre`), and every join is a hard cut, so neither raster ops nor transition
   compositing is needed for the MVP. Retimed takes (`_retime`: frames dropped and moved after clicks) are just a
   different `frames` list.
4. **The sample, complete.** `copy-sample.sh` copies the project from the `release-videos` repo (`circles/overview`)
   **with its takes** (about 230 MB at 3×; out of git as now) and the shared music and sound files.
5. **Acceptance test, scripted:** for every scene, `flex diff` on a spread of frames (first, last, every 2 s, both sides of
   every scene boundary) against the pipeline's own paint at 1080p and 4K; the manifest has no `paintable: false`; the
   mix equals the pipeline's render mix (same cues, same loudness within 0.1 LU); plays in real time from a warm cache.
6. **Then the MVP UI left:** timeline lanes from the project's markers (sections, bars, hits, the edit's joins), the join
   lane, variants as toggles (the film ends WHITE by default, `END=dark` the alternative), renders list with A/B, still
   export at any size.

## Right after the MVP: capture (screen recordings of real apps)

Most films are screen recordings of a real product the author has the code and e2e access for. Capture ships first after
the MVP. How it works today (fancy-e2e-videos `lib/capture.ts`, vendored with the pipeline; Playwright + Chromium as a
global tool), and where it hurt on circles-overview:

- A **journey** (`<project>/journeys/<take>.ts`) drives the real app: logs a persona in through the app's API, then clicks
  and types **on beats** (`b.click(n, …)`, `b.type(n, text)` lands the last key on beat n), marks moments (`beat-…`), and
  holds the picture over page loads (`c.freezeFrom`). `--dry` rehearses selectors without frames.
- **Data is staged by the project's e2e scripts**, never by reseeding: `fill-circle`, `add-pending`, and a write
  that must happen exactly once (`RECORD=1` records a real payment) with its undo (`revert-payment` through the backend's e2e
  route). Takes depend on the data state (Home before the payment, pool-back after).
- After capture: `_retime` (a navigation click shows the new page on the next frame), the camera plan (`edl.json`: zoom
  segments, effects; `locked` keeps hand edits), per-scene patches (`navSafe` framings).
- **What hurt (2026-10-16, re-capturing three takes at 3×):** the app's load times varied run to run (a page 1.6 s one
  take, 9 s the next), so beats ran up to 4–6 s late and Home took three tries; each retake's start shifted by
  −58 to +134 ms, so the locked camera plans were shifted by hand; comparing a retake with the original meant a script.

**Status (2026-10-16 night): first cut done** ([docs/capture.md](docs/capture.md)). Done: the CLI (`flex journeys`, `capture`,
`report`, `pick` and `stage`, all with `--json`), versions under `takes/.versions/`, with the existing take kept as v0. Also:
- the warm-up dry run;
- the beat log (patch 05) and the timing report;
- previewing a version in the film (`--take`, the eye);
- the locked camera plan carried over piecewise on pick (tested);
- data states with a check command, refusing the wrong state and asking before writes;
- retime built in;
- the app's Capture panel (⌥⌘C) with a live view.

Proven on circles-overview's pool-back: dry run, then a real 3× capture into v1 (both beats within 2 ms), joins clean with
v1 in place, pick v1 and back to v0 restoring the plan exactly. The panel's buttons have not been clicked by hand yet
(synthetic clicks don't reach the app here).

Since then (same night):
- the camera lane: every take's zooms and effects as the film paints them, with a popover to nudge them by a frame or a
  beat, turn them on or off, and lock;
- `flex camera` to list and edit the plan by id;
- `flex prune`.

Left:
- dragging blocks on the lane, and adding or deleting one;
- freezes as a first-class step (7);
- two versions playing side by side (4).

What Flex adds:

1. **Journeys panel:** the project's journeys; run dry or for real, at a chosen density (`CAPTURE_DPR`, 3× for 4K), with
   the live browser view while it records.
2. **Data states:** the project declares its staging scripts and the states they produce ("before the payment", "after");
   Flex shows the current state, runs a script by button, and puts a confirm in front of anything that writes for real
   (the once-only take and its undo).
3. **Warm-up and timing report:** a warm-up pass before the real take (cold dev servers were the main cause of late
   beats); after each take, every beat's lateness against the journey's grid and against the previous take, late ones
   in red, with "retake".
4. **Keep the best take:** takes are versioned (`takes/<take>/v<n>`); compare two takes side by side in the film; pick one.
   On a pick, the camera plan and effects shift automatically by the new take's mark offsets (piecewise, per mark, not one
   global delta).
5. **Camera plan on the timeline:** zoom segments and effects as blocks on the take's lane, editable, with lock; the
   framing patches visible.
6. **Retime built in:** the click-opens-next-frame rule applied after every capture, no manual step.
7. **Freezes:** freeze a page to a still for cards (the freeze flow), from the same personas and data states.

## After the MVP: assets (the project's pieces, each previewable on its own) (asked for 2026-10-17)

The editing-app staple (Premiere's Project panel, Resolve's Media Pool, Final Cut's browser): a grid of everything the
film is made from. Click one and it plays in a **source viewer**, apart from the film's own viewer, so you can judge a
piece without touching the timeline. Later, drag it in. It gathers what other sections list piecemeal.

- **Audio:** the song, its stems, the sound effects. Each has a waveform, play and measured loudness. Where a
  transcription exists, the words light up as they are sung or spoken, on the beat grid, with the hooks marked (from
  `flex music`).
- **Takes:** each journey's take with its versions. It plays the raw recording, with the timing report beside it (from
  capture).
- **Tools the model makes for this film:** cards and animation pieces (circles-overview's lift, the pool count-up, the
  book sequence). Each previews alone, looping, with sample values. Today a card is only ever seen inside a scene.
- **Labs:** each plays as its own little film (from the labs section).
- **The rest:** looks, brand pieces (logo, fonts, people and faces), stills and freezes, finished renders.

**AI-first:** nothing is registered by hand. Whatever the agent writes into the project shows up because it is a file: a
card under `cards/`, a lab folder, a sound in `audio.json`, a take. A piece can carry its own preview (sample params and a
length: an exported `preview` beside the card), so the author can review the model's tools one by one. The same grid
is the shared library once Flex absorbs Screenshot Studio (product screens, brand, people, templates).

**Status (2026-10-17): built** (docs/features/08-assets.md). The grid by kind with folded image folders, the source viewer
(audio with its words lit as they play, take versions raw with their timing report, cards looping with their sample
values, stills with element boxes, renders), `flex assets [--preview]`, and a card's own sample values
(`export const previews`). Left: dragging an asset into the film; "made by an agent" marks (from the activity trail);
labs played as films in the source viewer (a lab opens as its own project for now).

## After the MVP: labs (no agents needed)

A lab is a film in its own right: an isolated exploration of one beat (today: sibling project folders, `overview-lab-*`,
13 on 2026-10-16; each with its own `project.ts` and look, importing shared pieces from `../overview`, running its own
stretch of the music with `from:`). Flex treats a lab as a first-class project, with or without agents behind it.

1. **Open a lab on its own:** it plays like any film (its own music window, scenes, sound). A lab can also be opened from
   its parent: a "Labs" list per project (found by `target`, below, or by sibling folders importing it).
2. **In place:** a lab declares `target: { project: "../overview", section: "book" }`; Flex plays it inside the parent film
   over the target section (the parent's neighbours for context, the lab in the middle), with A/B against main.
3. **Compare wall:** 2–4 labs of the same target playing in sync, side by side, same music. The author compared 3–4
   directions at a time (before, via numbered mp4s in a Downloads folder).
4. **Combine:** mark cut points across labs ("3b up to the share-out, then all of 3c"); the recipe is saved with the
   project and can be previewed as a virtual lab before anyone builds it.
5. **Merge is a retime, previewed:** promoting a lab is not a file swap. On circles-overview it meant adding a music-edit
   segment, shrinking the neighbouring scene and shifting everything after it by 7 bars. Flex shows the new timeline
   (sections, music edit, every later scene's new times) before it is applied, and the join lane after.
6. **Lab-only tools:** a lab can also be made by hand: "new lab from this section" copies the section's scene as a starting
   point with the target set.

## After the MVP: agents (the main agent and its sub-agents)

How the circles film was made: a main agent runs the spine (shared files, the music edit, merges, renders) while
sub-agents run lanes (one scene each) and labs (one direction each); the author directs by watching and writing
timestamped notes, which the main agent relays. Flex is the surface for that loop.

1. **Notes anchored to the picture:** click a frame, drag a region or a time range, write the note. Saved with the time,
   region and a still, in `review/notes.json`. Replaces screenshots pasted into chat.
2. **Notes become work:** each note goes to the main agent's inbox, or straight to the agent that owns that scene or lab,
   by the ownership map (`lanes.json`: lane or lab → owned files), the same map that keeps two agents out of one file.
3. **Agents panel:** who is working on what, their checkpoints and reports, their renders as they land (the author's "how
   are we doing?" answered on screen), and a render queue with progress.
4. **A file protocol first:** notes, each lab's status and report in its folder, ownership in `lanes.json`; the Claude Code
   session watches the files. Launching agent sessions from Flex (Switchboard-style terminals in a drawer) comes later.

5. **The activity trail (asked for 2026-10-17): follow along, without taking the agent's agency away.** Flex records; it
   doesn't restrict. Three sources, lined up on one clock:
   - **Every `flex` command:** what ran, its arguments, the outcome, the duration, and what it made (a still, a render,
     a take version). Kept in `<project>/.flex/activity.jsonl`. It works because agents do their work through Flex's
     tools.
   - **Every change to the project's files:** the watcher already sees them; each change is kept with its diff.
   - **The agent's own account:** Claude Code's session transcripts (`~/.claude/projects/…/*.jsonl`), followed
     read-only: its messages, tool calls and checkpoints. A spawned subagent has its own transcript, so it gets its
     own lane.

   **The app's Activity panel:**
   - one lane per agent, the main one and each subagent;
   - events as they happen, with thumbnails of stills and renders;
   - a click jumps to the frame, the file diff or the asset.

   **Agency:** the agent stays free to invent: one-off scripts, its own cards and tools, labs, a way around a gap. The
   only rule is that the work lives in the project and runs through `flex run` or the project's declared scripts, not
   loose files in /tmp. Then what it invents shows up:
   - in the trail;
   - in the assets grid, marked as made by an agent;
   - in its GAPS.md.

   The author answers with notes on the timeline, which go to the agent that owns that scene or lab (item 2).

   **Status (2026-10-17): built** (docs/features/09-activity.md). `.flex/activity.jsonl` (every command, ~2 ms; changes
   with diffs from a shadow of the project's text files, also with the app closed), Claude Code transcripts read-only
   (a lane per agent and subagent; agents that only read the project dimmed), `flex activity`, the Activity panel
   (live, seeks to a film time, opens what a command made in the assets panel, diffs inline), and the assets grid's
   "made by" marks. Known limits: two agents of one session running the same subcommand at the same instant can swap
   lanes (Claude Code gives a command its session, not its subagent); a command run from a script lands in the main
   lane.

## After the MVP: audio (what the circles film actually used)

The plan so far plays the pipeline's mix and draws narration and sound-effect lanes. The film's audio work went much
further; each of these was a one-off script or a manual measurement:

1. **Stems:** the song's 8 aligned stems (lead and backing vocals, drums, bass, guitar, keys, percussion, synth) as lanes,
   soloable, so hits are found by eye and ear (`audio/stems/`).
2. **The music edit as a lane you can edit:** the edit's segments (16 on circles-overview: repeated bars, inserted
   stretches), its joins and crossfades, and a join finder that suggests splice points by matching levels and spectra at
   kicks, previewed before saving (today hand-measured, then written into `hits.ts`).
3. **The film's own grid and hits:** sections, film bars and hits from the project's markers, in film time through the
   edit (one song second can play several times), never from the analysed `.grid.json` (≈0.25 s off the kick grid).
4. **Narration with word timing:** each line's words on the lane (from Whisper or the voice engine's timings), so a
   word can be dragged onto a beat ("share" on the share-out's downbeat was measured by hand from voice energy), with
   `sayAt`/`sayOver`, the breath between lines, and regenerate or change voice (Kokoro, or OpenAI when a key is set).
5. **Onsets and transcription:** find a sung word's onset in the vocal stem ("Count" at song 52.67 s), transcribe
   the song (local Whisper) to place lyrics on the timeline.
6. **Ducking and loudness:** see the duck under each line (`underVoice`, `role`), tune it live, and read the film's
   loudness (LUFS, true peak) and each sound's measured level.
7. **Sound effects:** the project's library (`audio.json`) with each sound's loudness; the synthesised ones regenerated
   from their scripts (`audio/sfx/gen-*.sh`); place, nudge and level a sound on the lane; subtitles (`.srt`) exported.
8. **Audio effects (none today):** the mixer splices a declared music edit (crossfades at the joins), fades, ducks
   under the voice and sets loudness, and that's all. To add, per music segment, per stem or per sound effect:
   - filters (a low-pass sweep into a drop, a telephone band);
   - distortion and saturation;
   - stutter and repeat;
   - a tape stop or riser;
   - reverse;
   - pitch and tempo (fit a stretch to a scene without changing the key).

   Each is declared in the project like the edit, so it is previewed through Flex's mix and checked by `flex check`.
   **Stems as playable layers** belong here too: drop the vocals for a narrated stretch, keep only drums under a card.
9. **The splice finder (item 2, made concrete):** given a target length or a "repeat bars 13–14", it suggests splice
   points on downbeats where the stems match (level, spectrum, what is playing). It scores each join for an audible
   click or level jump, then plays just that join. The circles-overview edit (16 segments) was hand-measured.

## After the MVP: one tool, two faces (agreed 2026-10-17)

The gaps an agent would hit making a film (from circles-overview's audio work and the first agent-made film). Each is
built once and shown twice: the agent calls it as a `flex` command and reads text or JSON; the author sees the same
answer in the app, on the timeline or in the assets panel. What the author looks at is what the agent checked.

| # | Gap | For the agent (CLI) | For the author (app) |
|---|---|---|---|
| 1 | Hearing the edit without a render | `flex mix <dir> -o x.wav [--from --to]` in seconds | already: the preview plays the mix; add solo of the music, the voice or the effects |
| 2 | Film time through a music edit (a song second can play twice) | bar.beat in film time everywhere (`flex music --at`, `transcribe`, reports); the edit's map from film to song | the ruler counts film bars; hover shows the song second too |
| 3 | The song's hits | `flex music` lists the onsets per stem (kick, snare fill, stab, a vocal entry) with bar.beat and strength | hits lane, filterable by stem; snap targets for cuts |
| 4 | Changing the edit moves everything after it | `flex retime <dir> --at <bar> --bars +7` previews the new times of every later scene, then applies | the labs "merge is a retime" preview: old and new timeline side by side |
| 5 | Where the narration's words land in the film | each line's words in film time and bar.beat, flagged over a sung line | the narration lane shows its words; drag a word onto a beat |
| 6 | Does each cut land where it's aimed | a per-cut report: cut vs the beat or hit it's aimed at, ms off | each cut marked on the timeline, green on the beat, amber when off, with the ms |
| 7 | Looking at audio (an agent can't listen, but it reads images) | `flex music --sheet [--from --to]`: an image of the stems over bar lines, hits and words marked | the same view as the audio asset's preview and the timeline's expanded audio lanes |
| 8 | Ducking per line | the dip under each line: depth, attack, release, pumping | the duck drawn on the music lane under each line, tunable |
| 9 | Slow renders (≈2 h at 4K) | final renders from Flex's painter and frame cache, incremental | a render queue with progress |
| 10 | Seeing one card alone | `flex card <dir> <card> [--params] -o x.mp4/png` | the assets panel's source viewer |
| 11 | Freezing a page for a card | `flex freeze <dir> <persona> <url>`: a self-contained still of the page, by persona | freezes in the assets panel beside the takes |

**Status (2026-10-17):** built, as measurements and mechanics only (tools measure, the film decides):
- `flex mix` (1), `flex grid` (2), `flex cuts` (6);
- hits and entries in `flex music` (3), `flex narration` (5), `flex music --sheet` (7);
- `flex shift`, a preview (4), and `flex duck` (8);
- `flex card` (10), `flex freeze` (11), `flex render --fast` (9);
- timeline views: cut marks, film bars, hits and entries, word ticks, ducking bands.

Left from the first agent film's GAPS.md: these are pipeline features (to do as patches or upstream):
- looks extending other looks, and sound effects shared between projects;
- an overlay option to hide during a camera push;
- telling `check` that two overlays share the screen on purpose.

**Order:** 1, 2 and 6 first (small, and the biggest time sinks), then 3, 5 and 7 (they share the onset and word
data), then 4 with labs, 8 with the audio section, 10 and 11 with the assets panel, 9 with "one painter".

## After the MVP: Flex absorbs Screenshot Studio (decided 2026-10-16)

Flex becomes the one place to make visual things: a still, a video, or a still taken from a video. One model: **a canvas
you compose, and an output you choose** (a screenshot or slide is a one-frame canvas; a film is canvases over time; a
poster is one frame or region of a film at any size).

- **Two document types, one app:** film projects (folders) and shot documents (`.studioshot`), sharing one library
  (product screens, brand, people, templates).
- **One export:** any frame of either as PNG, PDF, slides or video, at any size (the poster the circles session had to
  hand-write a script for).
- **Live links:** a shot placed in a film is an asset reference (edit the shot, its film frames repaint through the key
  cache); a film frame can seed a shot document (posters, thumbnails).
- **The move:** Screenshot Studio's `st-core` and SwiftUI views come into Flex; its web renderer comes along as the shot
  renderer, and its headless renderer (`st` / `studio-render`) replaces the Downloads hand-off for device shots.
  Screenshot Studio keeps working until Flex reaches parity, then retires.
- **Rendering:** two renderers at first (web for shots, Rust for films; a shot enters a film as a rendered image). Later,
  port device frames and compositions to `Layer[]` so everything goes through one painter, which is also the path to
  incremental final renders.

## From two vertical music films: what they taught Flex (2026-10-18)

Two finished TikTok films (9:16, photos and phone clips cut to Suno songs), made by five agents in parallel with the
author reviewing. Vertical frames are already in (`frame.json`). The rest is below, ordered fixes → tools → card kits →
workflows → checks. **The reference code for every item is in the author's own (private) films repo:**

- Final 1: a Python assembler stitching Flex renders and its own sections, plus the trimmed Flex projects it renders
  from (Film B's opening, Film A's dancer).
- Final 2: a pure Flex project (`project.ts`, `look.ts`, `cards/`, `scenes/`, `tools/`).
- `REVIEW.html`: the review page the author worked from.

### 1. Fixes (they cost real time; do first)
| Problem | Fix | Where | Reference |
|---|---|---|---|
| `flex render` empties the output folder at start; anything playing the old file (the review page) broke for ~15 min | render to a temp file and swap on completion; keep the old file until then | `crates/flex-cli` render, pipeline patch 09 (out path) | Final 2 `README.md` (the render step's warning) |
| `{svg}` `<image href="/abs/path">` draws in Flex's painter, blank in the pipeline render (data: URIs work in both) | make them agree; `flex diff` flags the mismatch | painter + pipeline patch | Final 2's slam and closer cards (data-URI images) |
| `{video}` layers aren't painted by Flex; every agent pre-extracted frames to JPEGs and drew `{image}` | paint `{video}` through a frame cache, or `flex clip <file> --from --to` → frames | `paint.rs` / new command | Final 2 `tools/prep_clips.sh`, Final 1 `film-a-dancer/tools/prep_clips.sh` |
| the pipeline re-normalises the whole film; a designed loud ending lost ~3 dB of its lead | per-section loudness intent or a keep-dynamics option | pipeline mix, `audio.json` | Final 2 `tools/closer_audio.py` |
| one tempo grid per track; spliced songs (113 → 115 BPM) got a wrong grid | grid built from music segments, including across two tracks | `filmgrid.rs`, music segments | Final 1 `final-1/render.py` + `final-1/songs.py` (the song switch) |
| the disk filled and stalled agents mid-render | `flex clean` (work folders, superseded scene renders) and a pre-render disk check in `doctor` | CLI | — |

### 2. Tools (each was hand-rolled 2–4 times)
- **`flex cutout <image|video> [--from --to]`**: macOS Vision person segmentation with temporal smoothing, fringe removal,
  an alpha floor, and dropping background text and signs. Ref: Final 1 `film-a-dancer/tools/cutout.swift` +
  `defringe.py`, Final 2 `tools/cutout.swift`, Final 1 `film-b-opening/scripts/segment.swift`, `segment-dir.swift`,
  `clean-cutouts.py` (temporal smoothing; a head in front of a masthead).
- **`flex onsets <audio|stem> --from --to`**: syllable and letter onsets from energy, pitch and fricatives, in film s and
  bar.beat. Whisper fails on sung spelled letters and Swahili; "letters land on the sung onset, not the grid" needed this
  every time. Ref: Final 1 `final-1/part2.py` (the outro's spelled-out names), Final 2 `tools/cut_audio.py` + `scenes/params-*.ts` (the break's syllables).
- **`flex crop --cell W:H --subject`**: a crop centred on the subject with a magnification ceiling. Ref: Final 1
  `final-1/make_picks.py` (the best-four cells).
- **`flex sheet <video|dir> --from --to --fps [--label]`**: labelled contact sheets and frame strips. Ref: Final 2
  `tools/still.ts`, `tools/sheet.py`, Final 1 `film-b-opening/scripts/sheet.py`, `final-1/render.py --sheet`.
- **`flex render --range a:b`** (a review excerpt with its audio) **and `--audio-only`** (re-mux the audio without
  re-painting). Ref: Final 1 `final-1/render.py --audio-only`.
- **`flex sfx place <clip> --at <beat> --duck <curve>`**: a stinger on a beat, with a duck curve on the song. Ref: Final
  1 `final-1/make_clock_it_clip.py` + the duck in `final-1/render.py`, `film-b-opening/scripts/mix-master.py`.
- **`flex assets`**: group bursts (near-duplicates) and tag people ("solo" / "with others") so rules like "no near-duplicate
  beside the held piece" and "group shots only in the chorus" can be checked. Ref: Final 1 `film-a-dancer/cards/gallery.ts`
  (the burst groups).

### 3. Card kits (reusable picture grammar; a Flex-owned `kits/` folder plus a catalogue page with stills)
- **Gallery wall + pick:** rows at depth, picture lights; a pick lifts, turns, lands on a beat, holds and returns; burst
  dedupe. Ref: Final 1 `film-a-dancer/cards/gallery.ts` + `timeline.ts`.
- **Contact-sheet wall:** film strips, taped prints, a grease-pencil circle, focus pull. Ref: Final 1 `film-b-opening/cards/`
  `wall.ts`, `chorus.ts`, `chorus2.ts`, `scripts/build-wall.py`.
- **Club wall:** light boxes in parallax, a scan beam, a reticle lock. Ref: Final 2 `cards/clubwall.ts`.
- **Letter windows and reflow:** a word as a mask over photos; its syllable windows reflow (AB/CD/EFG ↔ A/BCD/EFG). Ref: Final 1
  `film-b-opening/cards/opening.ts`, `spell2.ts`, `type.ts`, `scripts/font-metrics.py`; `final-1/letters.py`,
  `final-1/part2.py` (outro letters).
- **Kinetic type on audio:** a slam on a syllable; a held note growing letters; a typed paragraph that wraps, driven by
  the audio. Ref: Final 2's slam and closer cards; Final 1 `final-1/letters.py`.
- **Interrupt:** the same shot and type cut in over the timeline, which resumes underneath. Ref: Final 2 `cards/chorus.ts` (the chorus
  inserts) and `scenes/params-*.ts`.
- **Cover and stack:** a cover with the cut-out head in front of the masthead; a stack whose under-covers each peek a
  face. Ref: Final 1 `final-1/render.py` + `final-1/draw.py` (the magazine stacks), `film-b-opening/cards/chorus.ts` (the
  cover), `scripts/segment.swift`.
- **Grid search → land:** the grid hunts, then expands the chosen cells. Ref: Final 1 `final-1/part2.py`.
- **Text-mask closer:** type zooming out of depth with the image inside the letters, centred. Ref: Final 2 `cards/closer.ts`.
- **Outline type on a beat:** a word under a card, landing per word and cut out sharp. Ref: Final 1 `film-b-opening/cards/chorus2.ts` (the clock-it page) + `final-1/make_clock_it_clip.py`.

### 4. Workflows
- **`flex review`, the review board:** one page with the videos inline, decisions as buttons in context, notes, and a
  copy-to-chat box; it replaces itself as renders update and handles missing files. It was the main loop with the
  author. Generate it from a project's renders plus `review/questions.json`. Ref: the films' `REVIEW.html`.
- **Film studio (multi-agent):** a shared brief plus a brief per film; checkpoints ending in a report with evidence and
  numbered questions; an "author rules" list every agent inherits; excerpt renders until the final pass; the orchestrator
  prototypes small taste moments itself, then hands exact numbers to the owner. It becomes a skill
  (`~/.claude/skills/film-studio`) built on lane-orchestration.
- **Variants stay buildable:** an alternative is a flag in the builder (Final 1's variant switch), never a fork.
- **Composite films:** Final 1 stitched two films' renders with new sections in Python. Flex should compose timelines
  natively (sections from other projects, song switches at matched gaps).

### 5. Guidance and checks (`docs/making-a-film.md` + `flex check`)
- Type in the bottom ~20% or under the right-hand UI column → warn.
- Media enlarged past a ceiling (photos about 1.3×, isolated cut-outs about 1.8×) → warn.
- The same photo or burst within a few seconds → warn.
- Letters or words off their sung onset by more than ~40 ms → warn (`flex onsets`).
- Static stretches → warn (a motion scan).
- Craft notes for the doc:
  - WhatsApp-compressed photos: crop around the subject; centre the subject.
  - Pick the downbeat yourself from the stems.
  - Splice songs at related tempos (¾, 4/3) inside drumless gaps.
  - Make a stinger in Suno (DJ ad-lib), not TTS.
  - You can end early, the way a band cuts a song.

**Status (2026-10-19):** done in the composite-film work: the render swap, `{video}`
layers (with alpha), the grid across two tracks, `flex cutout`, `flex onsets`, `flex crop`, `flex sheet`, `flex render
--range` / `--audio-only`, and sound ducks (most of `flex sfx place`: what's left is placing by beat from the CLI).
Still to do: the `<image href>` mismatch, per-section loudness, `flex clean`, `flex review`, `flex assets` grouping, the
card kits, the workflows and the checks.

## 0. Scaffold ✅ 2026-10-16

Workspace (`flex-core`, `flex-ffi`, `flex-cli`), app shell, scripts, docs. Opening a project folder
finds its pipeline and shows the outline.

## 1. Pipeline hand-off: [docs/pipeline-seam.md](docs/pipeline-seam.md)

Built in fancy-e2e-videos, not from here: projects (and their takes) from any folder, and
`renderSequence` split into plan / layers-at-frame / mix. Until then Flex's server lays out
card scenes itself and shows takes as placeholders.

## 2. The painter (`flex-core::paint`) ✅ 2026-10-16

`Layer[]` → pixels: resvg for SVG layers (fonts loaded once), tiny-skia for image layers (crop,
radius, opacity, alpha), a Lanczos-filtered downscale cache so 3× screenshots shrink as sharply
as sharp does. `flex diff <project> <frame…>` paints a frame both ways and reports the difference.

## 3. The server and the frame cache ✅ 2026-10-16

`server/serve.mts` (JSON lines: `manifest`, `layers`, `keys`), supervised by `flex-core`
(start, restart on a project change, its log). The cache: `<support>/cache/p<painter version>/<width>/<key>.jpg`.
CLI: `flex frame <project> <frame|time> -o x.png`, `flex warm <project>`, `flex play <project> --to-dir`.

## 4. Live refresh ✅ 2026-10-16 (engine and `flex watch`; the app shows it, not yet driven by hand)

Watch the project folder → restart the server → new keys → repaint only the frames whose key
changed, nearest the playhead first. Per-scene status: cached / painting / stale.

## 5. The MVP app ✅ 2026-10-16

Viewer (cached frames, a "painting" badge), play / pause on the music edit's clock, scrub, scene loop, frame and scene
keys, live refresh; the timeline: scenes with paint bars, sections, bars, hits, the edit's joins, the join lane, the
waveform, narration; variants as toggles; renders list with A/B (side by side or wipe); still export. See "The MVP,
redefined" above for the acceptance results.

## 6. Narration and sound ✅ 2026-10-16

The film's real mix in the app: card `say` lines and sound effects, takes' recorded narration and
clicks, the music edit with its crossfades, ducked and levelled by the pipeline's own `mixAudio`.
Until the pipeline seam's `mixSequence` exists, Flex's server collects the cues itself (`cues` and
`mix` in docs/server.md); the line times match the last render's subtitles to the millisecond.
The timeline has a narration lane.

## 7. `samples/flex-walkthrough`: a film about Flex

A fancy-e2e-videos project in `samples/` that walks through the Flex app, using
`samples/hello-flex` as the film being worked on: open the project, play it, scrub, loop a
scene, edit `scenes/03-closing.ts` and watch only its frames repaint, a scene that throws turning
red and recovering. It lives in the repo (no product content), and it doubles as the app's
walkthrough video for the docs and the release.

- The takes are screen recordings of the real app (the journeys drive Flex, not a browser), so
  this needs fancy-e2e-videos to capture a native window, or a recorder like Screenshot Studio's
  `scripts/walkthrough/record.py` producing frames a take can use. Decide which first.
- Once it exists, Flex can open it too: a film about Flex, previewed in Flex.
- **The final acceptance test: an AI agent makes it, end to end.** It proves the pipeline and Flex are AI-friendly: an
  agent writes the journeys, stages the sample, captures, builds the cards and narration, cuts the music, checks its own
  work with stills and join diffs, and renders, using only the `flex` CLI, the docs and the files. The author only gives
  taste: notes on the timeline, a pick between labs, small visual tweaks. Every place the agent gets stuck, guesses, or
  needs a person for something mechanical is logged as a gap and fixed in Flex or the pipeline, not worked around.
- **Needs native Mac window capture** (the journeys drive Flex, not a browser), so it comes last; the Circles in-circle
  film above proves the agent loop on browser capture first.

## Later (PRD milestones 3–5)

Labs, review notes, tool panels, safe edits, asset drop. Optionally, the pipeline paints final
renders with this painter (one compositor).
