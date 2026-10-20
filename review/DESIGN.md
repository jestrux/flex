# Flex Review: DESIGN.md

The **Screening room** direction is a dark room where only the media is lit. The chrome sits in two quiet greys. Lime means one thing: *your move*.
This file is the source of truth for `review/index.html`. Everything ships inline: no network fonts, no CDNs, works from `file://`.

---

## 1. Colour

Tokens live on `:root` as CSS custom properties. Dark is the default. Light applies under `[data-theme="light"]` and under
`prefers-color-scheme: light` when the author hasn't chosen.

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0A0A0C` | `#F5F5F2` | the room (page background) |
| `--rail` | `#0E0E11` | `#EDEDEA` | sidebar |
| `--surface` | `#131317` | `#FFFFFF` | cards, inputs |
| `--raised` | `#1A1A1F` | `#FAFAF8` | agent-stance block, selected row |
| `--hover` | `#1E1E24` | `#F0F0EC` | hover / pressed fill |
| `--line` | `#26262D` | `#E0DFDA` | borders, dividers |
| `--line-2` | `#2E2E36` | `#D6D5CF` | control borders, journey line |
| `--ink` | `#F2F1EC` | `#141417` | primary text |
| `--ink-2` | `#B3B2BC` | `#4F4E57` | secondary text |
| `--ink-3` | `#8B8A95` | `#6A6973` | meta, captions (≥ 4.5:1 on `--bg` and `--surface`) |
| `--wave` | `#4A4A55` | `#B9B8B2` | waveform outside the selection |
| `--media` | `#000000` | `#0A0A0C` | behind every frame and player, **in both themes** |
| `--accent` | `#D5FC31` | `#D5FC31` | lime fills (count pill) |
| `--accent-line` | `#D5FC31` | `#5F7A00` | needs-you ring, selected outline, handled check |
| `--accent-soft` | `rgba(213,252,49,.09)` | `rgba(140,180,0,.12)` | selected option fill, playhead progress |
| `--on-accent` | `#12140A` | `#12140A` | text on lime |
| `--btn-bg` | `#D5FC31` | `#141417` | the one primary button |
| `--btn-ink` | `#12140A` | `#D5FC31` | its label |
| `--time` | `#B8A6FF` | `#5A3FD0` | timecodes, bar.beat, note pins, "your way" |
| `--time-soft` | `rgba(184,166,255,.14)` | `rgba(90,63,208,.10)` | pin chips |
| `--ok` | `#5FD99A` | `#13804A` | passing checks, live dot |
| `--warn` | `#FFB547` | `#A85D00` | warn checks, **agent unsure**, offline |
| `--warn-soft` | `rgba(255,181,71,.08)` | `rgba(168,93,0,.07)` | unsure block, offline bar |
| `--warn-line` | `rgba(255,181,71,.38)` | `rgba(168,93,0,.35)` | unsure border, "leaning" dashed outline |
| `--bad` | `#FF6B6B` | `#C4302B` | failing checks |

**Rules**
- Lime is used for the needs-you ring, the one primary action, the handled check and the selected option. It's never body text.
- In light, lime flips: the primary button is ink with a lime label, and rings and outlines use olive `--accent-line`.
- Violet is time and position (`0:41.07`, `71.4`, pins). It also marks an answer that differs from the agent's pick ("your way"), because that's a choice, not a warning.
- Amber is uncertainty and trouble only: the agent being unsure, warn checks, offline.
- Media always sits on black, even in light, so frames are judged against the same ground.

## 2. Type

System stacks only.

```css
--font-ui:   -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif;
--font-mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;   /* with font-variant-numeric: tabular-nums */
```

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--t-display` | 24 / 30 | 650, -0.02em | view title, card title in review mode |
| `--t-title` | 18 / 24 | 600–650 | inbox title, drawer title, panel caption |
| `--t-card` | 15–16 / 20–22 | 600 | card title |
| `--t-read` | 15 / 25 | 400 | brief and long agent text (max 62ch) |
| `--t-body` | 14 / 21 | 400 | default |
| `--t-ui` | 13 / 18–20 | 500–600 | buttons, rows, options |
| `--t-meta` | 12 / 16–18 | 400 | meta, captions, labels |
| `--t-micro` | 11 / 16 | 600 | badges, kbd, timecodes in chips |

Timecodes, bar.beat, BPM, counts and paths are always mono with tabular figures. No uppercase letter-spaced labels.

## 3. Space, shape, elevation

- **Spacing** (4-base): `4 8 12 16 20 24 32 48`. Card padding is 18–20 and the gap between card regions is 14–16. The page gutter is 24–32.
- **Radii**: `--r-xs 4` (kbd, media in strips), `--r-sm 6` (small controls, frames), `--r-md 8` (buttons, inputs, stance block), `--r-lg 12` (cards, drawer sections), `--r-pill 999` (badges, chips).
- **Elevation**: borders, not shadows. Shadows appear on floating layers only:
  - `--shadow-float: 0 10px 30px rgba(0,0,0,.5)` for the toast and menus
  - `--shadow-drawer: -24px 0 60px rgba(0,0,0,.45)` for the drawer
  - scrim `rgba(5,5,7,.62)`
- **Focus**: `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--ink)` on every focusable element, never `outline: none` alone.
- **Hit targets**: decision buttons 44–48 px tall; icon buttons 28–32 px, with a 44 px hit area by padding.

## 4. Layout

- **Shell**: rail 232 px · inbox list 340 px (Needs you only) · content fills the rest. The window range is 1100–1800 px.
- **Content column**: up to 1240 px. The card body is media-left when the media is vertical (fixed 300–360 px column) and media-top when it's horizontal.
- **Vertical media**: shown at full height in its column, centred on `--media`, never cropped. Fit is the default and Fill is opt-in.
- **Review mode**: full window, media pane on `--media`, a 440 px answer pane and a 36 px key bar.
- **Drawer**: 520 px from the right, over a scrim.

## 5. Motion

| Token | Value | Use |
|---|---|---|
| `--m-fast` | 120 ms `cubic-bezier(.2,0,0,1)` | hover, press, tab switch |
| `--m-base` | 220 ms `cubic-bezier(.2,0,0,1)` | card collapses to Handled, option select, drawer content |
| `--m-drawer` | 260 ms `cubic-bezier(.32,.72,0,1)` | drawer in and out |
| `--m-arrive` | 320 ms in, then a 2.4 s glow fade | live arrival: the row slides in at its place, with a lime ring and glow |
| `--m-toast` | 6 s on screen | "New in Labs: …" |

Honour `prefers-reduced-motion`: replace slides with fades and drop the glow (the New badge stays).

## 6. Status language

| State | Mark | Meaning |
|---|---|---|
| **Needs you** | hollow ring in `--accent-line` | has a question and no answer |
| **To see** | dashed ring in `--ink-3` | no question; look at it, then mark it seen |
| **Handled** | filled check in `--accent-line` | answered, or seen. This replaces *Decided* and *Done*. The card collapses to one row with its answer and Undo. |
| **New** | lime outline badge | `updated` is later than your previous visit |
| **v2** | violet badge | `version` went up. A handled card comes back to Needs you with the old answer ready to keep. |
| **Making it** | half-filled ring in `--accent-line` | a prompt card you've said you're making; still yours, and sorts last in Needs you |
| **Agent working** | spinner, never lime | `project.working` names a stage (or a card, via `working.item`) |
| **Flex link** | `--ok` frame glyph / caret | Flex is open on *this* film; its playhead is shown live. Green means only "live" (the Live dot, the Flex link). |
| **Sent hh:mm** | quiet text | included in a send |
| **Offline** | amber dot and bar | `data.js` can't be read |

**Agent stance** sits in one block directly above the answer:

- **Recommends.** The `rec` option is filled lime and carries the agent's mark. The block reads "I'd …" with the why, plus a basis chip (*Evidence*). Enter accepts.
- **Unsure.** An amber block reads "I'm not sure. Look here:" with a chip that plays `unsure.at` or selects `unsure.panel`. A lean is a dashed amber outline, never filled, and Enter does nothing.
- **Your call.** A neutral block reads "No pick from me. This is your taste."
- **Going ahead.** `project.settled` lines sit at the foot of their stage and in Send. Each has an Object button, which opens a note.
- An answer that differs from `rec` is labelled **your way** (violet) on the card, and "(NOT the recommendation)" in the copied text.

**What a pick leads to** (`options[].out`): sits under the options, before the agent's line. It's headed "What changes in the film" when picked (solid border) and "If you pick …" when previewing on hover or focus (dashed border). Rows read `title · text`, with warnings first in amber (`--warn` title, `--warn-soft` row, ! icon). An option with any warning carries a small amber ! inside its button. Below sits **Then the agent will** … (`options[].then`), one line in `--ink-3` with the agent mark. In Send, the two appear as separate sections: "What changes in the film" (with a warning count) and "What this commits the agent to".

**Prompt cards** (`body.make`) move through: prompt ready → making it → bring it back (served: drop zone with per-file progress; from disk: `review/inbox/<name>…` paths to copy, then "I've saved them" as an answer) → the agent reads it (out of the inbox, spinner) → choose (`body.results`: one lane per result on a shared transport; Tab flips what you hear at the same position; Use A / Use B / Try again, or Use this / Try again / Use the other one for a single result).

**Open in Flex**: a frame-with-play-and-arrow glyph, ink outline, never lime. It appears on time-pinned notes, video transports, the selected storyboard panel and cards with `item.at`. Served: `POST ./flex/show`, then a toast "Flex is at 0:41.07". Otherwise (from disk, or Flex isn't on this film) it copies `flex show <dir> <s>s` and the toast says so. Reverse: "You're at 0:41.07 in Flex · bar · beat" on the open card, with **Note here**; the pin is an ordinary time pin.

**Progress**: one segment per stage, filling with handled ÷ total. The sidebar shows the same journey vertically, with a check, a ring and count, or a spinner.

## 7. Keyboard

| Key | Action |
|---|---|
| `J` / `K` | next / previous card (or row) |
| `1`–`9` | pick option N; toggles in multi |
| `↵` | take the agent's pick (only when it has a `rec` with basis evidence; in multi, confirm) |
| `⇧↵` | in the inbox list, take the pick without opening the card |
| `L` | look where the agent is unsure (seek, or select the panel) |
| `N` | note, pinned to the playhead or selected panel; `⌘↵` saves; `Esc` leaves |
| `E` | mark seen / handled · `U` undo |
| `Space` · `,` `.` · `[` `]` | play/pause · frame step · bar step |
| `←` `→` | previous / next panel in a gallery |
| `Tab` (in compare or audio A/B) | flip A/B (audio keeps the position) |
| `O` | open the focused moment in Flex (or copy `flex show …`) |
| `P` | note at Flex's playhead (served, Flex on this film) |
| `C` · `M` · `X` (prompt cards) | copy all fields · I'm making it · not needed |
| `R` | review mode · `Esc` exit |
| `/` | search · `S` Send to agent · `⌘↵` in the drawer sends · `?` all keys |

Single-letter keys are ignored while a text field has focus.

## 8. Data contract additions (all optional)

```js
window.FLEX_REVIEW = {
  project: { name, meta, intro, dir,
    song?:    { bpm, start, end, sections?: [{ name, at }] },  // waveform, bar ruler, section band
    working?: { stage, text, since, item? },                    // "Agent is working on …" (item: a card id)
    settled?: [{ id, stage, text }] },                          // going ahead unless you object
  stages, // unchanged
  items: [{ /* unchanged fields */
    changed?: "one line: what changed in this version",
    at?: 71.0 | [71.0, 72.8],     // film seconds: enables "Open in Flex" on the card
    body?: { /* unchanged kinds, plus: */
      at?: 18.0,                  // a video excerpt's offset in the film (for Flex and notes)
      make?: { tool: "suno" | "gemini" | "other", name: "closer-stinger",
               versions?: 2, stems?: true },          // a prompt card that expects a file back
      results?: [{ id: "a", label: "Take 1", audio, peaks?: [0..1],
                   bpm?, duration?, sections?: [{ name, at }],
                   stems?: ["vocals", "drums", …] }] }, // the agent's read of what came back
    decision?: { q, multi?,
      options: [{ o, label, sub?, rec?: true,
                  then?: "work this commits the agent to",
                  out?: [["Length", "The film grows to 1:16"],
                         ["Photo 4", "Drops out of the film", true]] }],  // [title, text, warn?]
      why?: ["one or two lines"],
      basis?: "evidence" | "taste",
      unsure?: { why, at?: [startSec, endSec], panel?: index } } }],
  log: [{ t, text, item? }],   // item links an activity line to its card
};
```

- `gallery[].at` keeps today's "bar.beat" string (`"71.4"`). With `project.song`, panels go on the ruler.
- Browser state (localStorage, keyed by `project.dir`) gains pinned notes `{ text, at? | panel? }`, objections to settled items, and send history `[{ t, ids }]`.
- With no `rec` and no `unsure`, a decision reads as *your call*. The agent never pre-selects an answer: `rec` only styles the option.
- Prompt-card answers use `o` values `use:<result id>`, `again`, `other`. "I'm making it" is browser state; "I've saved them" (from disk) is sent as an answer: `saved to review/inbox/`.
- `out` rows sort warnings first. On a multi decision, the rows of every option that's on are merged.
- Bar.beat → film seconds (storyboard panels to Flex): `t = ((bar − 1) + (beat − 1) / 4) × 240 / bpm − song.start`.

## 9. Served by Flex (http/https only)

When `location.protocol` isn't `file:`, these routes light up. Every one degrades: on any failure the board falls back to
the copy / instructions path and says so in a toast.

| Route | Use |
|---|---|
| `POST ./answers` | Send to agent: `{ project: dir, sentAt, answers, text }` |
| `POST ./upload?item=<id>&name=<file>&kind=song\|stems` | one file per request, the raw bytes as the body (not multipart), so each file has its own progress from `XMLHttpRequest.upload.onprogress`. Songs land as `review/inbox/<make.name>-a.mp3`, `-b`, …; stems in `<make.name>-stems/` (a .zip as `<make.name>-stems.zip`). |
| `POST ./flex/show` | `{ at }` in film seconds; moves the Flex app's playhead |
| `GET ./flex/state` | `{ open, here, dir, at, playing, project }`, polled on the same 3 s beat as `data.js`. `here`: Flex has *this* film open; `project`: the film's folder, used for the copied `flex show` command. |

From disk: Send copies text; uploads become `review/inbox/<make.name>-<a|b>.mp3` (+ `-stems/`) paths to copy;
Open in Flex copies `flex show <dir> <at>s`; the Flex indicator and "Note at Flex's playhead" are hidden.

## 10. As built (decisions on the open questions)

- **The routes** above are served today by the stand-in writer: `review/flex-review serve` (the board, `POST ./answers` into
  `review/answers.json`, uploads, and `./flex/show` / `./flex/state` by calling the installed `flex show` / `flex status --json`).
  `flex-review answers` prints the latest send. The real `flex review` command keeps the same routes.
- **Where `rec` / `unsure` come from:** `flex-review add CARD.json --rec <o> --why "…" --basis evidence|taste --unsure "…"
  --unsure-at 19.5,23 --unsure-panel 5 --changed "…"`, or the same fields in the card JSON.
- **Waveforms on `file://`:** the writer precomputes peaks with ffmpeg (`body.audio.peaks`, `body.results[].peaks`,
  `body.takes[].peaks`, and `project.song.peaks` + `duration` via `flex-review song --src …`). Served, the page decodes the
  file itself when peaks are missing; from disk without peaks it draws a flat bar and everything else works.
- **Aliases accepted** (older boards keep rendering): top-level `item.why` / `item.unsure` for the decision's, `unsure.where`
  (a line of where to look), `options[].act` for `then`, `options[].rec: 1`, `body.takes[]` (audio takes with facts and a star),
  `project.settled` as `[id, text]` tuples (shown under Everything), `project.stagesLabel`. A `rec` without `basis` counts as
  evidence unless the card is unsure.
- **Prompt-card answers**: `o: "saved"` ("I've saved them") and `o: "not-needed"`; an upload is reported in Send as
  "uploaded to review/inbox/". A picked recommended option stays lime with a ring; other picks use the soft lime fill.
- **The copied text** gains two blocks after the stages, as in Consequences: "What changes in the film:" (warnings
  prefixed `!`) and "Work this commits you to:".
