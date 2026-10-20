# Capture

Recording a project's **journeys** (Playwright scripts that drive the real app) into takes, from Flex. The pipeline's own
capture does the recording (`pipeline/lib/capture.ts`); Flex runs it on these terms:

- **Versions, never overwrites.** A capture goes to `takes/.versions/<take>/v<n>/`. The film keeps using `takes/<take>/`
  (the *pick*) until you pick another version. The first capture of a take keeps the take the film already had as `v0`
  (an APFS clone, so it costs no disk). The pick's number is in `takes/<take>/.flex-version`.
- **Warm-up.** A real capture runs a dry rehearsal first, so the app's pages and dev servers are warm. On the first film made
  this way, cold servers were the main reason beats landed seconds late. `--no-warm` skips it.
- **After the capture:** the pipeline plans the zooms (kept as `edl.auto.json`), then the project's retime runs
  (`retime: "clicks"`: a navigation click shows the new page on the next frame). Then the timing report is written to `report.json`.
- **Timing report.** It shows each beat-timed step's lateness: `c.beat()`'s `b.at` / `b.click` / `b.type`, logged as
  `events.beats`. Steps more than 40 ms late are flagged. It also shows each mark's offset against the pick, and its
  drift relative to the first mark, which is what the film sees, since scenes cut takes from a mark.
- **Preview before picking.** `--take <take>=v<n>` on any command (`frame`, `warm`, `joins`, `accept`, …), or the eye button
  in the app, plays the film with that version in place of the pick (`FLEX_TAKE_VERSIONS`). Frames whose pictures are
  unchanged keep their cache.
- **Picking keeps the camera plan.** When the pick's `edl.json` is `locked` (hand-tuned), the new version gets it,
  shifted piecewise. Each zoom segment's and effect's start and end move by the offset of the last mark at or before
  them, matching marks by label and occurrence. Unlocked, the version's own plan is used. Edits made to the pick since it
  was picked go back to its version folder, so picking it again brings them back.
- **Data states.** A take shows the app's data as it was when recorded (a home page before a payment is recorded, a
  report after it). The project declares the states, the scripts that stage them, and which state each journey needs. Flex then:
  - shows the current state (from the project's `check` command, else the last script Flex ran);
  - refuses a capture in the wrong state (`--force` to override);
  - asks before anything that writes to the app's data (`--yes`).

**Tip:** before the metronome starts (`c.beat(…)`), park the cursor on the first click target with `c.moveTo(target)`.
The first glide otherwise eats the first beat.

## The project's declaration

`export const capture = { … }` in `project.ts`, or `capture.json` beside it:

```ts
export const capture = {
  dpr: 3,                                   // capture density (3 for 4K takes); --dpr overrides
  retime: "clicks",                         // or false
  check: "node scripts/payment-state.mjs",  // prints the current state's name (optional)
  states: { "before-payment": "…", "after-payment": "…" },
  scripts: {
    "revert-payment": { run: "node scripts/revert-payment.mjs", gives: "before-payment", writes: true, confirm: "…" },
    "refresh-cookie": { run: "node scripts/refresh-cookie.mjs", about: "…" },
  },
  journeys: {                               // by file name: journeys/<name>.ts (export take, run)
    home: { needs: "before-payment" },
    "record-payment": { needs: "before-payment", gives: "after-payment",
      writes: { env: { RECORD: "1" }, confirm: "…" } },  // env set only for the real capture, after --yes
  },
};
```

## Commands

```sh
flex journeys <project> [--json]                       # journeys, versions (* = the pick), the data state
flex stage <project> [<script>] [--yes] [--json]       # the state and scripts; run one
flex capture <project> <journey> --dry                 # rehearse: screenshots per mark in <support>/dry/<project>/<take>
flex capture <project> <journey> [--dpr 3] [--no-warm] [--yes] [--force] [--json]
flex report <project> <take> [v<n>] [--json]           # the timing report (a version: against the pick)
flex joins <project> --take <take>=v<n>                # the film's joins with that version in place
flex pick <project> <take> v<n> [--json]               # the film uses it from now on
flex prune <project> [<take>] [--keep 2] [--yes]       # delete old versions (keeps the pick, v0, the newest --keep)
flex camera <project> [<take>] [--json]                # the takes' camera plans as the film paints them, take ms + film s
flex camera <project> <take> <id> [--start ms] [--end ms] [--shift ms] [--on|--off]   # edit one block (locks the plan)
flex camera <project> <take> --lock | --unlock
```

## The camera plan

A take's `edl.json` holds its zoom segments and effects, each with an `id`, `start` and `end` in take ms. It is the
interface: agents edit it directly or through `flex camera`. The timeline's camera lane shows each take clip's plan as
the film paints it (after the scene's `patch`): zooms on the upper row, effects on the lower. Click a block to nudge its
start, end or both by a frame or a beat, turn it off, or lock or unlock the plan. Any edit locks the plan. When a scene
patches the plan, the lane says so: an edit to `edl.json` may then be overridden by the patch.

With `--json`, each command prints one JSON object (with `ok: false` and `error` when it fails, and `needsConfirm` or
`needsState` when it is waiting for a yes or a state); its log goes to stderr. Agents use this. The app's Capture panel
(⌥⌘C) runs the same commands: Dry Run, Capture with a live view of the frames as they arrive and the log, the Data menu,
and per version: the report, the eye (preview in the film) and Pick.

## How it runs (for working on Flex)

`server/capture.mts` (embedded in flex-core like the server scripts) runs with the pipeline's `tsx` and the import
redirect, so journeys' `…/fancy-e2e-videos/lib/capture.ts` imports load Flex's copy. Capture writes to `FLEX_TAKES/<take>`.
Flex points `FLEX_TAKES` at a session folder whose `<take>` link goes to the new version folder, and points `FLEX_DRY` at
its support folder. The pipeline is never asked where a version lives.

## Not yet

- dragging camera blocks on the lane (today: nudges in the popover), and adding or deleting one;
- freezes (a page frozen to a still for cards): a project's freeze script can be declared in `scripts` for now;
- side-by-side playback of two versions (today: the eye, which swaps one in).
