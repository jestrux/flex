# The narration booth: a real voice for a film's narration

A film's narration is synthetic today (OpenAI or Kokoro, `pipeline/lib/voice.ts`). The booth sends that narration
out to a person and brings their voice back in, the way `flex new --music` brings outside music in:

1. **Package out:** Flex builds a recording booth from the film it already knows: the picture under music only, every
   narration line with its text and timing, the scenes, the word timings.
2. **Record:** a voice artist records in the booth (teleprompter, count-in, the original narration to practise
   against, a chosen run of lines, level, playback).
3. **Bring back in:** the takes come back keyed by line. The agent cleans and checks them, a recorded line stands in
   for the synthetic one, the film re-fits its timing to her reading, and it re-renders with the usual checks.

**The person works with an agent, not with Flex's commands.** They say "I want a real voice on this film". The agent
opens the booth, they record, and they come back and say "done". The agent then:
1. cleans and checks every take;
2. renders;
3. reports, for example "12 of 13 in; line 7 skips 'eight', line 3 clipped: reopen the booth for those two?";
4. on a yes, opens the booth with just those lines chosen.

**This plan is the local booth, opened in Chrome.** Publishing it as a link for someone else (Fuchi's backend or a
Kazzi artifact with an audio capability) comes after. It reuses the same page and the same intake, with a different
transport.

## Where it comes from

The booth was built by hand for the CRDB welcome tour (6 Nov 2026), and it worked:
- page: `career-path/frontend/public/voice-booth/index.html`;
- tutorial film: `career-path/videos/booth-tutorial`.

Doing it by hand showed what Flex should own:

| Done by hand | Flex should do it |
|---|---|
| Copied line times out of the `.srt` into the page; re-copied after every re-voice | Read them from the film |
| Ran `flex narration` and merged Whisper's split words ("nine box", "70 -20 -10") by hand | Word timings mapped to the script's own words |
| Rendered a music-only copy with `flex mix --only music` and ffmpeg | A music-only picture as part of packaging |
| A one-off Python server, because a `file://` page can't choose a mic or an output, can't seek the film, and can't send takes back | `flex booth` serves it on `localhost` |
| The artist saves one WAV the length of the film, and we place it by hand | Takes land in the project per line, already in place |
| A slower reading than the narrator's meant moving scene boundaries by hand (the ash re-voice moved three scenes by a beat or two) | Flex re-fits the timing where a recorded line runs long |

## Decisions

- **Chrome, served on `http://localhost`.** A localhost origin is a secure context: the microphone and output
  choices work (`getUserMedia`, `setSinkId`), and Chrome remembers the permission. A `file://` page does neither
  reliably. WebKit (an in-app window) can't choose an output device, so the earphones choice would be lost. An
  in-app window is a later option, not this plan.
- **Flex runs its own small web server for the booth.** It is separate from the pipeline server, which speaks JSON
  lines over stdin and stdout to the engine (`docs/server.md`). `flex booth <dir>`:
  1. starts the server on a free port;
  2. prints the URL;
  3. opens Chrome;
  4. stops it with Ctrl+C, or when the app closes it.

  It serves:
  - the booth page and the film's media, with byte ranges so the film can seek;
  - an endpoint the page sends each take to.
- **A recorded line replaces a synthetic line by the line's identity, not its text.** A recorded file is chosen
  before the TTS cache is consulted. One small change, at `voiceFor` and the capture's `narrate`, so a take, a card's
  `say` and the captions all use it.
- **Several takes per line, one keeper.** The newest take is the keeper unless the author or the artist picks
  another. Nothing is overwritten.

## Phases

Each phase ends on its verifiables.

### P0 · The film's narration as data

- Add `flex narration <dir> --lines --json`. For every narration line in the film it gives:
  - a stable line id;
  - the text;
  - the scene;
  - the film start and end;
  - word starts mapped onto the script's own words (Whisper's split numbers and hyphenations merged back).
- It works for both kinds of line: a take's `c.narrate` lines (from the take's events) and a card's `say` lines.

**Verifiables**
- On `career-path/videos/welcome-tour`:
  - 13 lines;
  - the starts match `welcome-tour.srt` to within 10 ms;
  - every line's word count equals its text's.
- A unit test: "70 -20 -10" maps to "seventy-twenty-ten", and "nine box." maps to "9-box.".
- Line ids survive a re-render. A text edit to one line changes only that line's id.

### P1 · Package out: `flex booth <dir>`

- Build the booth into `<project>/booth/`:
  - the page, generalised from the CRDB booth with the film's lines, scenes and words injected;
  - the picture with music only (the mix without the voice);
  - the picture with the original narration, for practising.
- Serve it on `localhost`, open Chrome, and print the URL.
- The booth's features, carried over:
  - teleprompter;
  - count-in;
  - play continuously;
  - original narration (practice);
  - choose lines;
  - Back 2s, Restart line, From the top;
  - mic and output choice, level and Auto, playback;
  - Music & beeps.

**Verifiables**
- `flex booth career-path/videos/welcome-tour` opens Chrome on `http://localhost:<port>/`, and the page lists the
  13 lines with their scenes.
- A range request for the picture returns 206, and seeking works.
- In Playwright with a fake microphone, as in the tutorial's journey:
  - the device menus list the stand-in devices;
  - the meter moves;
  - a two-line run records.
- Re-running `flex booth` after a re-voice picks up the new timings with no hand edits.

### P2 · Takes come back

- The page sends each take to the booth server as it's recorded: the line id, the audio (WAV), where it started in
  film time, and its length. The server writes it to `<project>/audio/takes/<line-id>/<n>.wav` and records it in
  `audio.json` under `takes`, with the keeper.
- In the booth, each line shows its takes, which one is the keeper, and lets the artist pick or delete one.
- `flex takes <dir>` lists them: line, number of takes, keeper, length against the original.

**Verifiables**
- Recording lines 1–2 twice leaves `audio/takes/<id>/1.wav` and `2.wav` for each, with `2` as the keeper.
  `flex takes` shows exactly that.
- Restarting a line mid-take leaves no partial take. Back 2s cuts the take.
- Killing the server mid-session loses at most the take in progress, and the booth says so when it reconnects.

### P3 · Bring back in: the film uses her voice

- At `voiceFor` and `c.narrate`, the keeper take for a line is used instead of the TTS file.
- The `.srt`, the loudness checks and `flex narration` all see the recorded line.
- **Re-fit.** Where a recorded line runs past its window:
  - the next line moves later;
  - a scene gives time back from the end of the film;
  - or the author is told what doesn't fit, with how much.

  Built on the existing checks (`check.ts`'s line overlap) and the music grid (scene changes stay on beats).
- **Cleaned and checked on the way in** (`flex takes <dir> --process`, run by the agent after "done"):
  - **Measure first, fix only as much as needed.** Each take is measured for noise floor, room echo (reverb time),
    loudness range, peaks and clipping. Only what's out of range is processed, and only by as much as it needs.
    Never processing a listener would notice.
  - **Clean:**
    - a high-pass for rumble;
    - de-click and de-pop, including plosives;
    - light broadband noise reduction from the take's own silence;
    - de-ess only if needed.
  - **Echo:** a light de-reverb where the room is audible. Local and open source, for example WPE (`nara_wpe`) or
    DeepFilterNet; the tool is picked in P3 by listening tests. A take with too much echo to clean without artefacts
    is **flagged, not forced**, with a suggestion: re-record somewhere softer (a closet of clothes, under a duvet, a
    room with curtains and a sofa). The booth shows that tip before the first take.
  - **Audibility:** quiet words and trailing endings are evened up with gentle levelling (upward compression),
    without lifting the background between words.
  - **Too loud:** loud words come down with a gentle compressor, and a true-peak limiter stops anything distorting.
    A word that clipped in the recording itself can't be restored, so it's flagged for a re-take.
  - **Trim** the silence and breaths before and after the line, keeping a natural lead-in.
  - **Level** to the voice target (−16 LUFS). Flag any take that **clipped** when recorded (true peak at 0 dBFS).
  - **Check against the script:** Whisper on the take, compared word by word with the line's text. Misreads,
    missing words and ad-libs are flagged, never silently used.
  - **Align:** the speech's real onset sits on the line's start.
  - The raw take is kept beside the processed one, so nothing is lost.
  - **Report per line** what was done and what's flagged, for example "line 4: lifted 3 dB, light de-reverb; line 7:
    skips 'eight'". `flex takes <dir>` shows it.

**Verifiables**
- **Processing** (fixtures: a clean take, one with a click and hum, a roomy one, a heavily echoing one, one with a
  quiet trailing phrase, one with a shouted word, one clipped, one that skips a word):
  - the clean take passes unchanged except for its level;
  - the click and the hum are gone;
  - the roomy take's measured reverb time drops, and the voice still passes a listening check;
  - the heavily echoing take is flagged with the re-record tip, not processed into artefacts;
  - the quiet phrase comes up to within 4 dB of the rest of the line;
  - the shouted word comes down, and no sample exceeds −1 dBTP;
  - the clipped take is flagged;
  - the skipped word is flagged with the missing text.

  Processed takes measure −16 ±1 LUFS, the raw files are untouched, and the per-line report names every fix
  applied.
- With every line taken, `flex render welcome-tour` uses no TTS file. The render log names the takes, the captions
  match her reading, and loudness passes.
- With lines 4–6 taken, only those three change. The other lines are byte-identical in the voice stem.
- A deliberately long take (2 s over its window) is either re-fitted with scene changes still on beats
  (`flex cuts` shows them on the grid), or reported with the shortfall in seconds.

### P4 · In the app and the skill

- The project window gets **Open booth** (and a takes badge per line on the timeline). It launches `flex booth` in
  Chrome.
- The Flex skill gets the loop:
  1. "a real voice for this film's narration";
  2. `flex booth`;
  3. the person records and says "done";
  4. `flex takes --process`;
  5. report the flagged lines, and offer to reopen the booth on just those (`flex booth <dir> --lines 3,7`);
  6. render and check.
- A generic version of the booth tutorial film (`career-path/videos/booth-tutorial`) as Flex's own "how to record in
  the booth" film.

**Verifiables**
- From the app, Open booth starts the server and opens Chrome. Closing the project stops it.
- A fresh agent, given only the skill and a film, takes it through the loop to a render with recorded lines.
- The skill's reference documents `flex booth`, `flex takes`, the take layout and the re-fit rules.

## After this plan: publishing

The same page, served from a link instead of `localhost`, for an artist who isn't at your Mac:
- **Hosting.** Either Fuchi's backend (media upload with hash dedup, an event row per take) or a Kazzi artifact.
  Kazzi needs a new capability for this: microphone permission in its frame, and audio uploads (its task attachments
  already go to S3 through presigned URLs).
- **Access.** A link the artist opens with no account, like Kazzi's answerers.
- **Sync.** `flex takes --pull` brings the published takes into the project.

## Out of scope

- An in-app WebKit booth window (output device choice is the blocker).
- Editing audio inside Flex beyond levelling and light cleaning.
