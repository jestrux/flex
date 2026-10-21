---
name: flex
description: Make, check and render a Flex film (a project with a project.ts) with the `flex` command, and show the author a frame in the Flex app. Build a walkthrough, demo or release video of an app from its code (frontend, backend and e2e folders): Flex records the running app on the music's beat itself, paint and look at frames, read the music's grid, measure cuts against the beat, cut people out of clips, render the film or an excerpt and check it with flex accept. Also device mockups without a film: an app's screens (HTML pages, a URL, or screenshots) wrapped in iPhone, iPad or Mac frames, light and dark, as PNGs. Use when the user mentions Flex, asks for a walkthrough, demo or release video or film of an app or its flows, a film project, a render, a frame or scene of a film, device-wrapped or framed screenshots or mockups of an app's screens, or asks where they are in the Flex app, and `flex` is installed.
---

# Flex

Flex is a Mac app and a `flex` command for films made in code: a project is a folder with a `project.ts` (scenes, cards,
the music edit), and every frame is painted from it. The author watches the film live in the Flex app while you work;
the app repaints whatever you change.

Check it is installed: `command -v flex && flex --version`. If `flex` prints "can't open …", the shell found macOS's
unrelated `/usr/bin/flex`: call `~/.flex/bin/flex`. If it is missing, ask the author to choose **Flex › Install flex
Command…** in the app. Do not build it yourself unless you are working on Flex's own code.

## Starting a film from an app's code

"Build me a walkthrough video for <these folders>" means a new Flex film whose footage is recorded from the running
app. Flex records it itself: journeys (scripts that drive the app on the music's beat) and `flex capture`. The folders
may be one repo or several (a frontend, a backend, an e2e suite). Work in this order, showing the author each step.

1. **Find the setup** before planning anything (read only; start nothing):
   - which folder is the frontend, the backend, the end-to-end suite. A suite may be Playwright or Cypress
     (`playwright.config.*`, `cypress.config.*`) or the team's own harness: a `flows/`, `e2e/` or `tests/` folder, a
     runner script in `package.json`, a `run.ts`;
   - how each runs locally (README, `package.json` scripts, `docker-compose.yml`, `.env.example`, a `start.sh`), its
     URL and port, and **every service the tests need that isn't in the folders you were given** (an auth server, a
     second API: look at the env URLs and the start scripts). Check which already answer (`curl` a health URL);
   - each repo's branch (`git branch --show-current`) and how fresh it is;
   - how the tests sign a user in (an API login, an auth fixture, a saved `storageState`), which test users exist, how
     long a session lasts, and how the tests seed or reset data (and which flows wipe data as their first step);
   - the flows worth filming, **by name and purpose only**: selectors come later, for the flows the author picks;
   - films and video plans that already exist near the code (a folder with a `project.ts`, a video plan, the suite's
     own recorder): reuse their personas and staging scripts rather than starting over. Flex makes this film; a suite
     that records its own videos is a source of flows, not a second tool to use.
   No end-to-end suite: say so, and plan the journeys from the app's routes and what `flex walk` shows.
2. **Report and ask, in one message:** what step 1 found, then the questions only the author can answer: the song (their
   own file, a Creative Commons track, or one they generate in Suno from a prompt you write: reference/making-a-film.md,
   "Finding the song"; Flex's own tracks, `flex library`, as a fallback), who the film is for, which flows in what order, the length,
   narration or not, which branch to film, whether data may be reseeded, and where the project should live (default: a
   new folder beside the code's folders, e.g. `<parent>/videos/<film>`). Don't invent these.
3. **Get the app running** with the commands found in step 1, on the branch the author chose, and check each URL
   answers. Don't run anything that resets or seeds data without the author's yes.
4. **Start the project** where the author said: `flex new <dir> --music <song>` (it writes the imports for this
   machine), then `flex music <dir>`; `flex show <dir>` opens it in the app.
5. **Plan on the music:** `script.json`, one beat per flow step on the song's bars (`flex script`, `flex storyboard`).
   Get the author's nod before recording.
6. **Personas:** in `capture.personas`, a command printing each user's browser cookies as JSON, ported from the tests'
   login (`scripts/cookies.mjs` in the example). The command runs every time a journey seats that user (and for each
   `flex walk`), so it should log in fresh rather than replay a saved cookie: sessions expire. Cookie values are
   whatever the app expects (a token, URL-encoded JSON). Then `capture.walk` and `flex walk <dir>`; look at the sheet.
7. **Journeys**, one per take, in `journeys/<name>.ts`: not the tests, but the same flows driven for the camera on the
   beat (`c.start`, `c.beat`, `b.click`, `b.type`, `c.focus`, marks), with the tests' selectors and seating and none of
   their assertions. The full API is the pipeline's `lib/capture.ts` (`flex open <dir>` prints the pipeline's folder).
   A test's setup that seeds or wipes data never goes in a journey: it becomes a staging script in `capture.scripts`
   with `writes: true`, and each journey declares the state it `needs` (reference/capture.md), so Flex asks the author
   before running it.
8. **Record each take:** `flex capture <dir> <journey> --dry`, look at its screenshots, then capture, `flex report`
   (late beats), `flex pick`. Fix late beats in the journey and capture again.
9. **Scenes:** add each take's scene once its take is captured (a scene can't play a take that doesn't exist yet),
   with cards around them (`flex card <dir>` lists them). Then the loop below; `flex render`, `flex accept`, and
   `flex show` the author what to judge.

**The example:** [examples/app-walkthrough](examples/app-walkthrough/) is a small film in this shape (a persona login, a
journey on the beat, the take's scene, cards, a script). Read it before writing the first journey. Its imports resolve
inside Flex; in a new project keep the import prefix `flex new` wrote.

## Device mockups (no film needed)

Screens in Apple device frames, as transparent PNGs, from a design hand-off, a running app or screenshots:

```sh
flex mockup <folder>                         # every .html page in it (else every image), in an iPhone, light
flex mockup <folder> --theme both --sheet    # light and dark, plus sheet.png with them all, to look at together
flex mockup page.html https://app.example/x --device iphone,ipad --landscape   # several devices; iPad on its side
flex mockup shot.png --status none           # a screenshot that already has its status bar
```

- A page is captured at the device's own size with its safe areas (the status bar and home indicator don't cover it),
  in the colour scheme asked for; a screenshot is placed as it is. Output: `~/Downloads/flex-mockups/<folder>/` unless
  `-o`, one PNG per screen, device and theme (`<page>-<device>-<theme>.png`).
- Devices: `iphone` (default), `iphone-max`, `ipad`, `ipad-11`, `ipad-mini`, `mac`, `mac-16`, `display`. Finishes
  (`--finish`): iPhone black, silver, natural, blue, orange; iPad gray, silver; Mac black, silver. `--shadow`, `--bg`.
- The status bar (menu bar on a Mac) is `auto`: dark glyphs over a light screen, light over a dark one.
- Look at the results (open `sheet.png`) before reporting, and say where they are.

## The author's view

```sh
flex status                     # every project open in the app: the playhead (time, frame, scene), what's painted
flex status <dir> --json        # one project, machine-readable (also any render running in the app)
flex show <dir> 22.5s           # open it in the app and move the playhead there: 22.5s, a frame number, a bar.beat (37.2)
flex show <dir> --scene chorus   # ... or to a scene's start
```

- When the author says "this frame", "here" or "what I'm looking at", read `flex status` first; never guess the time.
- After changing something, `flex show` the moment so the author sees it, and say what to look at.

## The loop

```sh
flex open <dir>                         # the outline: music, scenes and their times
flex frame <dir> 22.5s -o /tmp/f.png    # paint one frame, then LOOK at the image before saying anything about it
flex sheet <mp4|folder> --from 20 --to 30 [--ref other.mp4]   # a labelled contact sheet; --ref pairs and diffs
flex cuts <dir>                         # each cut's distance from the beat and the declared hits
flex grid <dir> --at 15.2               # film bar.beat ↔ seconds through the music edit
flex music <dir>                        # tempo, grid, stems, the vocal's words (once per track)
flex library                            # Flex's own tracks and songs: tempo, length, mood, licence
flex library pull <key> --stems         # a song (and its stems) now; songs otherwise download on first use
flex render <dir> --range 20s:30s       # an excerpt with its sound, for review (seconds or bar.beat)
flex render <dir> [--scene <id>]        # the film → ~/Downloads/flex-videos/<film>/<film>.mp4 (+ .srt, .credits.txt)
flex accept <dir> --film <mp4>          # paint frames across every scene and compare with a render; the mix's loudness
```

- With the app open on the project, `flex frame` and `flex render` run in the app's warm session (no server to start,
  and the author sees the render's progress). Without it they run on their own. Either way the result is the same.
- A card film renders with Flex's painter in a few minutes; a film with captured takes renders through the pipeline.
- `flex accept` reports ~2/255 against a render: that is the video codec, not a difference.

## Rules

- **Tools measure; the film decides.** The grid, onsets, cut distances and loudness are evidence. Which beat is "1",
  which hits to cut on and the look are the film's calls, written into the project where they can be seen and undone.
- **Look before you report.** Paint the frame or make the contact sheet and read the image. Never describe a frame, a
  cut or a render you haven't looked at, and never call a film done while a visible flaw remains.
- **Change the project, not Flex's state.** Edit the project's files (`project.ts`, `scenes/`, `cards/`, `audio.json`);
  never write into a project's `.flex/` folder or Flex's support folder by hand.
- **`FLEX_SUPPORT` is a full path** (`"$HOME/Library/Application Support/<name>"`), and only when the project's README
  asks for one. A bare name makes a folder in the current directory.
- **Renders replace renders.** A render writes beside the last one and swaps it in when done; copy a delivered master
  elsewhere before re-rendering if the author needs the old one.
- **Media stay where they are.** Projects link their photos, clips and stems in (a project's README says how); don't
  copy media into a repo.

## Reference

- [reference/making-a-film.md](reference/making-a-film.md): the whole path, from an empty folder to a rendered film:
  the music, the script, cards, takes, checks and renders, media tools, composite films, voice.
- [reference/capture.md](reference/capture.md): recording an app's journeys into takes.
