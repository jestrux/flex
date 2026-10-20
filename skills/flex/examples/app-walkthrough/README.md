# app-walkthrough: the shape of a film recorded from an app

A 30-second walkthrough: a title card, one take recorded from the running app on the music's beat, and a closing card,
on Flex's own track "carefree". As shipped it plays the two cards: `scenes/02-tour.ts` joins `project.ts` once its take
is captured (a scene can't play a take that doesn't exist yet; until then `script.json` plans it).

| File | What it is |
|---|---|
| `project.ts` | the scenes in order, the music, and `capture`: the personas (who the app is seen as), the walk, the journeys |
| `scripts/cookies.mjs` | a persona's login: prints that user's browser cookies as JSON. Port the e2e suite's own login here |
| `journeys/tour.ts` | one take: the app driven on the beat for the camera (not a test: no assertions) |
| `scenes/01-intro.ts`, `scenes/03-outro.ts` | built-in cards |
| `scenes/02-tour.ts` | the take, cut from its `beat-start` mark (add it to `project.ts` after the capture) |
| `script.json` | the plan on the music's bars, before anything is recorded |

To start a real one, don't copy this folder: run `flex new <dir> --music <song>` (it writes the imports for this machine),
then bring these pieces across. Every `…/fancy-e2e-videos/lib/…` import resolves to Flex's own copy of the pipeline.

The loop for this film:

```sh
flex walk <dir>                       # every page as each persona: storyboard/walk/, a contact sheet
flex capture <dir> tour --dry         # rehearse: a screenshot per mark
flex capture <dir> tour               # record a version of the take
flex report <dir> tour v1             # late beats; then flex pick <dir> tour v1, and add the tour scene
flex show <dir> --scene tour          # the author watches it in the app
flex render <dir> && flex accept <dir> --film ~/Downloads/flex-videos/app-walkthrough/app-walkthrough.mp4
```
