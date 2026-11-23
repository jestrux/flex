# The device library: every frame KinPay's Frame Studio has, in Flex

Flex frames screens in Apple devices only (`server/devices/{iphone,ipad,mac}-frame.css`, from the "Apple device frames"
handoff), and a film's phone take is always an iPhone (`device.png` + `status-*.png` + `frame.json`, built by
`mockup.mts --overlays`, painted by the pipeline's `phoneLayers`, patch 22). KinPay's Frame Studio grew the same
handoff into a full library. This plan brings that library into Flex, so `flex mockup` and a film's phone takes can
use any of it.

**Why now:** the NCAA series records an Android app. In an iPhone it would show devs an Android app dressed as an
iPhone, and the recorded Android status bar is untidy ("3G", clocks that don't match, missing glyphs). Flex should
draw an Android phone with its own clean status bar, the way it already does for the iPhone.

## Where it comes from

KinPay repo, branch `feat/frame-studio` (commit `11fe0b5`), not checked out on KinPay's current branch:
- `frame-studio-simple/src/frames.css` (822 lines): every family, BEM classes, 1 CSS px = 1 pt, `--device-scale`.
- `frame-studio-simple/src/canvas/Frame.tsx`, `src/model.ts`, `src/panel/DeviceSection.tsx`: how a figure is composed
  (status markup per family, the status bar takes the page's background colour, finishes and notch toggles).
- `frame-studio/src/frames/*.css` and `src/studio/devices.ts`: the full studio's split files and device table.

Read them with `git -C ~/Documents/web/kinpay show 11fe0b5:<path>`; never check that branch out (another session
works in the KinPay tree).

The families, as Frame Studio has them:

| Family | Variants |
|---|---|
| iPhone | Pro, Pro Max · black, silver, natural, blue, orange, KinPay · no-notch · `bare`, `outline` · shadow · status light/dark |
| iPad | 13″, 11″, mini · landscape · space gray, silver · `bare` · shadow · status light/dark |
| Android | phone (412 × 915 pt), tablet (800 × 1280 pt) · landscape · graphite, porcelain, sage · shadow · status light/dark · gesture pill light/dark |
| Mac | MacBook Pro 14″, 16″, Studio Display · space black, silver · no-notch · `bare` · shadow · menu bar light/dark |
| Windows | app window · light, dark · title bar · menu bar · shadow |

Geometry and colours are kept exactly (the handoff's rule): copy the CSS, don't redraw it.

## Phase 1: the frames

Move each family into `server/devices/` as its own file, as Flex has them today: `android-frame.css` and
`windows-frame.css` are new; the iPhone, iPad and Mac files gain Frame Studio's extra variants (KinPay finish,
no-notch, `bare`, `outline`, menu bar light/dark). `server/devices/README.md` documents the new families in the
handoff's format (markup, sizes, finishes, status bar, geometry).

**Verifiable:** a `demo-<family>.html` per family shows every variant (as the handoff's demos do). Each family's
default frame, rendered by Flex and by Frame Studio's own `dist/` page at the same size, matches pixel for pixel
(a diff image, mean ≤ 1/255 away from text antialiasing).

## Phase 2: `flex mockup` uses them

`mockup.mts`'s device table grows `android`, `android-tablet` and `windows` (with their safe areas: Android status
28 pt, gesture bar 24 pt; Windows title bar). `--finish` takes each family's finishes, `--style bare|outline` the plain
frames, `--theme light|dark|both` picks the page's colour scheme **and** the status/menu/title bar glyphs, as today.
`--device all` and `--finish all` expand to every device and every finish, so one command renders the full matrix.
`mockup.rs` and `flex mockup --help` list the new options. `--sheet` lays a run out to look at.

**Verifiable:** `flex mockup <page> --device all --finish all --theme both --sheet` renders every combination; the sheet
is looked at; nothing overflows its screen, every status bar picks the right glyph colour over light and dark pages.

## Phase 3: a phone take can be any phone

`--overlays` builds the parts per device (`devices/<key>/device.png`, `status-light.png`, `status-dark.png`,
`nav-*.png` for Android, `frame.json` with the device's screen, radius, safe areas and parts). The pipeline's
`phoneLayers` (a new pipeline patch beside patch 22, never an edit to fancy-e2e-videos itself) gains:
- `device` (default `iphone`) and `finish`;
- `crop: { top, bottom }`: screen points to cut from a recording that carries its own status or navigation bar
  (an Android screen recording), so the device's painted bars replace them;
- the status bar's clock as a parameter, and light/dark glyphs chosen from the recording's colour under the bar, as
  the iPhone does today.

**Verifiable:** a film frame with an Android recording in the Android frame: the recorded bars gone, the painted bar
crisp mid push-in at 2.3×, glyphs dark over a light screen and light over a dark one.

## Phase 4: the NCAA screens, responsive, rendered by Flex

The screens of NCAA video 1, rebuilt as one interactive, responsive HTML mock: the front door, GMS sign-in, Juma's
Home, the offline banner and Sync, the persona switcher, Paul's, Anna's and the guest's Homes. Each screen has a real
layout at phone (≈ 390), tablet (≈ 834) and desktop (≥ 1280) widths, not a stretched phone; light and dark; tapping
moves between screens and the switcher changes user. It lives with the films
(`~/Documents/web/videos/ncaa-series/screens/`), never in Flex's git: it is NCAA product content, like
`samples/circles-overview`, and Flex's docs keep using `samples/hello-flex`.

**Verifiable:**
- each screen at 390, 834 and 1440: no horizontal overflow, no clipped text, and it looks designed at each size
  (screenshots looked at);
- the renders come from Flex, not the browser: every screen in every device, finish, style and theme
  (`flex mockup screens/ --device all --finish all --theme both --sheet`), and the sheets are looked at.

## Phase 5: docs

Ask the author, then update `docs/features/` (the mockup page and the phone-take page) with screenshots from
`samples/hello-flex`, and the skill's Device mockups section (`skills/flex/SKILL.md`).

## Out of scope

Frame Studio's backgrounds, bento grids, hero line-ups and social screens (a Flex canvas can compose those later);
3D laptops (`laptop-3d.css`).
