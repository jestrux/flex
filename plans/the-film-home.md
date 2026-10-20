# The film's home: the review board becomes the project window (2026-10-20)

Flex `main`. The prototype is `review/index.html` (with `review/DESIGN.md` and the stand-in writer `review/flex-review`);
it works today from disk and served. This plan turns it into the window a person opens a Flex project in.

## Why

Most people making a film with Flex don't want an After Effects workflow. They ask an agent for a film, keep working on
something else, and want to **see the film as it gets made, end to end, and be told when something needs them**: a
lab to pick, a song to choose, a render to sign off. The preview, timeline and frame-level tools stay, one step away,
for whoever wants them.

So the board stops being a review step and becomes the product's front door, built into the app:

- **The project window opens on the board.** The current preview / timeline window becomes the editor view behind it
  ("Open in Flex" switches to it at the moment in question).
- **It's still HTML**, hosted by the app in a web view: agents are good at HTML, and the board renders from data the
  agent writes with `flex review …`. Agents may also draw their own cards.
- **The film so far** is a page like the others: a preview card at the top of the sidebar opens it. It always plays
  end to end on the song: built scenes from their renders, the rest as storyboard panels, the scene being built with
  its progress.
- **Live, and quiet until it matters.** Updates land in place as the agent works. Notifications only for what needs the
  author, new versions and finished scenes.
- **Every page is a list beside the sidebar and the selected thing in the main area** (Needs you, Everything, each
  stage, Agent activity, the film so far's scenes).

## What's already built (the prototype)

In `review/index.html`, verified from disk and served (`review/flex-review serve`):

- The Screening-room design (Claude Design handoff, `review/DESIGN.md`): inbox, cards for every body kind, the agent's
  stance (recommends / unsure / your call / going ahead), custom audio and video players with bar math, the storyboard
  ruler, review mode, Send, what a pick changes in the film (`options[].out`), the prompt-card loop (copy → making it →
  bring it back → the agent reads it → choose A/B), Open in Flex both ways, live arrival, typing protection, versions,
  offline, light and dark.
- The film so far (`project.film.scenes`, `working.item` / `working.progress`), notifications (drawn in the page),
  agent-drawn cards (`body.custom` in a sandboxed frame, a `postMessage` API), every page as list + detail, and a
  *Simulate the agent* panel for prototype data (`project.demo`).
- The writer: `add` (with `--rec/--why/--basis/--unsure/--unsure-at/--changed`), `stage`, `song` (ffmpeg peaks), `settle`,
  `working`, `log`, `list`, `remove`, `serve` (POST answers, uploads, `flex show` / `flex status`), `answers`.

## Decisions

1. **The board ships inside Flex.app**, versioned with it; a project holds only its data (`<project>/review/data.js`,
   `data.json`, `media/`, `cards/`, `inbox/`, `answers.json`). `flex review export <dir>` copies the page beside the data
   for the browser fallback (sharing, no app).
2. **No localhost server in the app.** The web view loads the board from a custom URL scheme (`flex://board/…`) whose
   handler serves the bundled page and the project's files. The page talks to the app through a message bridge
   (`window.webkit.messageHandlers.flex`); the HTTP routes the prototype uses (`answers`, `upload`, `flex/show`,
   `flex/state`) become bridge messages. The page keeps its HTTP path for `flex review serve` and its copy path for disk.
3. **Push, not poll.** The app watches `<project>/review/` (and the scene renders) and hands the page the new data the
   moment it changes. The page's 3 s poll stays only for the browser fallback.
4. **The agent hears the author without chat.** Send writes `answers.json` and wakes any `flex review wait`; the agent
   blocks on it (or polls `flex review answers --since`).
5. **The film so far is renders, not live painting.** Each built scene is rendered once (cached by its layers key, as
   frames are); the film-so-far player plays scene clips in order on the song, with panels for the rest. No whole-film
   render until sign-off.
6. **Custom cards are a slot, not a takeover.** `body.custom` (an HTML file in `review/cards/`) draws the body; the board
   still owns the title, stance, decision, notes, handled state and Send. Sandboxed (`allow-scripts` only), themed by a
   `theme` message, talking back with `height`, `pick`, `note`, `show`.

## Phases (each ends on its verifiables)

### 1. `flex review` in the CLI
Port the writer to `flex-cli` (`crates/flex-core/src/review.rs` + `crates/flex-cli/src/review.rs`): `init`, `stage`,
`add`, `song`, `settle`, `working [--item --progress]`, `scene <id> --status built|building|panel [--progress]`, `log`,
`list`, `remove`, `answers [--since]`, `wait [--timeout]`, `export`. Same files and fields as the prototype
(`review/DESIGN.md` §8–10). Peaks from Flex's own audio decoding, not ffmpeg.
*Verifiable:* the prototype's `data.json` round-trips byte-for-byte through `flex review` commands; `wait` returns when
`answers.json` gains a send; tests under `crates/flex-core/tests/review*`.

### 2. The app hosts the board
A `WKWebView` project view (`app/Flex/Board.swift`), the scheme handler, the bridge (answers, uploads by drag onto the
window, show → the editor view at a time, state), the editor view behind a toggle. The page detects the bridge and runs
in app mode (no copy-for-chat, real Send).
*Verifiable:* opening a project shows the board; Send in the app lands in `answers.json` and wakes `flex review wait`;
dragging two mp3s onto a prompt card lands them in `review/inbox/`; Open in Flex switches to the editor at that frame.

### 3. Live push
File watching on `review/` and the scene renders; the app calls the page's ingest with the new data; typing protection
and the waiting bar as today.
*Verifiable:* `flex review add` shows the card within 250 ms with the app open; a note being typed keeps focus.

### 4. The film so far from scene renders
`flex render --scene <id>` (exists as `--range`) writes `<project>/renders/scenes/<id>.mp4`, keyed by the scene's layers;
`flex review scene` marks it built and points `project.film.scenes[].video` at it; storyboard panels come from the
storyboard card's frames. The player chains clips on the song clock (the prototype's player already does this with one
cut).
*Verifiable:* building a scene updates the film so far in place, without stopping playback; a scene whose layers didn't
change isn't re-rendered.

### 5. Notifications
`UNUserNotificationCenter` when the window isn't frontmost (in-page banners when it is, as in the prototype), the dock
badge = open count, a click opens the card or the scene. What notifies: a card that needs the author, a new version of
one, a scene built, the render ready. Nothing else. Later: the menu-bar extra (count + "Open board").
*Verifiable:* with another app frontmost, `flex review add` raises one notification; clicking it focuses the card.

### 6. Agent-drawn cards
Freeze the `body.custom` contract in `review/DESIGN.md`, add a CSP for the frame, and two examples in the skill (a cut
map, a type specimen).
*Verifiable:* a custom card renders in both themes, resizes to its content, and its `pick` / `note` / `show` messages work.

### 7. The skill
Teach the flex skill the board: the stages, when to ask vs settle, writing stances (`--rec` with evidence, `--unsure`
with where to look), `out` vs `then`, prompt cards, `working` progress, `wait`. The generic request ("make me a video")
runs the same walkthrough through the board.
*Verifiable:* a fresh agent given only the skill makes a short film whose every gate goes through the board.

### 8. Design follow-up (Claude Design)
Brief: the film so far page and its sidebar card, the list-pane versions of Everything / stages / activity,
notifications, the custom-card frame, and the app-mode Send (no copy path). The prototype's screenshots are the brief's
"current state".

## Open questions
- **Does Send go straight to the agent** (`wait`), or does the author still paste in chat when the agent isn't
  waiting? Proposal: both; the drawer says which.
- **Who decides a scene is built:** the agent (`flex review scene --status built`) or Flex (all its frames rendered)?
  Proposal: the agent marks it; Flex renders the clip.
- **One window or two** for board and editor: a toggle in one window (proposed) or separate windows.
- **The browser fallback's future:** keep `export` for sharing a board, or drop it once the app is the only host.
