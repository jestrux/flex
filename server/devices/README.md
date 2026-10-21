# Handoff: Apple device frames (iPhone, iPad, Mac)

## Overview
CSS-only device frames for placing app screenshots in — marketing pages, docs, READMEs, decks. No image assets; everything is drawn with CSS so it scales losslessly.

- **iPhone** — Pro 6.3″, Pro Max 6.9″; five finishes; outline alternative; optional status bar (light / dark)
- **iPad** — Pro 13″, Pro 11″, mini; portrait and landscape; space gray / silver; optional status bar (light / dark)
- **Mac** — MacBook Pro 14″ and 16″ (space black / silver), Studio Display 27″; optional menu bar (light / dark)

## About the design files
The `.css` and `demo*.html` files are **ready to use as-is** (plain CSS + HTML, no dependencies). Port them into the codebase's conventions if preferred — a React/Vue component wrapping the same markup, or CSS Modules — but keep the geometry and colour values exactly. Each demo shows every variant of its family.

## Fidelity
High-fidelity. Reproduce exactly.

## Shared conventions
- Block/element/modifier classes: `.iphone`, `.ipad`, `.mac` + `__screen` + modifiers.
- **1 CSS px = 1 point** at default scale. Set `--device-scale` on the figure or any ancestor to resize; everything (radii, buttons, notch, stand) scales with it:
  ```css
  .hero .ipad { --device-scale: .5; }
  ```
  (`--iphone-scale` still works on `.iphone` for backwards compatibility.)
- The screen accepts `<img>`, `<video>`, `<picture>` or arbitrary content; media is `object-fit: cover` and fills the screen exactly.
- `--shadow` modifier on any family adds a soft drop shadow via `filter: drop-shadow`.
- Buttons protrude 3 pt outside the body; leave at least 3 pt of horizontal room (or `overflow: visible` on the parent). The Mac base/stand sits in the figure's bottom margin, so no extra spacing is needed.

---

## iPhone — `iphone-frame.css`
```html
<figure class="iphone iphone--pro iphone--black">
  <div class="iphone__screen">
    <img src="screenshot.png" alt="Describe the screen">
  </div>
  <span class="iphone__buttons" aria-hidden="true"></span>
</figure>
```
Size: `iphone--pro` (402 × 874 pt, default) · `iphone--pro-max` (440 × 956 pt)
Finish: `iphone--black` (default) · `iphone--silver` · `iphone--natural` · `iphone--blue` · `iphone--orange`
Style: `iphone--outline` — flat 2 pt stroke in `currentColor`, light screen background
Extras: `iphone--shadow`

Status bar (optional child of `.iphone__screen`): `<div class="iphone__status">9:41</div>` — white time + signal / Wi‑Fi / battery, 62 pt tall. Add `iphone__status--dark` for black glyphs on light screenshots. Omit when the screenshot already has one. Glyphs are a single SVG mask filled with `currentColor`.

Screenshot sizes (@3x): Pro 1206 × 2622 px · Pro Max 1320 × 2868 px.
The frame draws the Dynamic Island (126 × 37 pt, 11 pt from the top, r 20); iOS screenshots don't include it. Safe areas: top 62 pt, bottom 34 pt.

Geometry (pt): Pro screen 402 × 874 r 60, body 438 × 910 r 78 · Pro Max screen 440 × 956 r 62, body 476 × 992 r 80. Rail 4, bezel 14. Buttons — Pro: action top 150 (3 × 30), volume top 200 / 272 (3 × 62), power right top 222 (3 × 100); Pro Max: 160, 212 / 284, power 236 (3 × 104).

Finishes: rail is a 135° gradient, bezel `#050506`.
- Black `#5c5c60 → #1a1a1d 30% → #1a1a1d 70% → #5c5c60`, button `#2a2a2e`
- Silver `#ffffff → #c4c4c8 → #dadade → #ffffff`, button `#cfcfd3`
- Natural `#e2dbd0 → #9e968a → #b1a99b → #e2dbd0`, button `#a69e91`
- Blue `#6a7ea8 → #1f2d4c → #2a3b60 → #6a7ea8`, button `#2f4068`
- Orange `#ffc08c → #d4601a → #e8742c → #ffc08c`, button `#dd6b24`

---

## iPad — `ipad-frame.css`
```html
<figure class="ipad ipad--13 ipad--landscape ipad--gray">
  <div class="ipad__screen">
    <img src="screenshot.png" alt="Describe the screen">
  </div>
  <span class="ipad__buttons" aria-hidden="true"></span>
</figure>
```
Size: `ipad--13` (iPad Pro 13″, 1032 × 1376 pt, default) · `ipad--11` (iPad Pro 11″, 834 × 1210 pt) · `ipad--mini` (744 × 1133 pt)
Orientation: portrait by default · `ipad--landscape` swaps the dimensions and rotates camera + buttons
Finish: `ipad--gray` (space gray, default) · `ipad--silver`
Extras: `ipad--shadow`

Screenshot sizes (@2x): 13″ 2064 × 2752 · 11″ 1668 × 2420 · mini 1488 × 2266 (swap for landscape).
Status bar (optional child of `.ipad__screen`): `<div class="ipad__status">9:41  Mon Jun 9</div>` — 24 pt tall, time/date left, Wi‑Fi + battery right, white; add `ipad__status--dark` for black glyphs on light screenshots. Omit when the screenshot already has one. The camera dot sits in the bezel: long edge for 13″ / 11″ (right in portrait, top in landscape), short edge for mini.

Geometry (pt): rail 4; bezel 40 (13″ / 11″) or 52 (mini); screen r 18; body r = 18 + bezel + rail (62 / 74). Body: 13″ 1120 × 1464 · 11″ 922 × 1298 · mini 856 × 1245. Buttons, portrait: top button on the top edge, right 64, 54 × 3; volume keys on the right edge, top 96 and 148, 3 × 42 each. Landscape: top button left edge top 64 (3 × 54); volume on the top edge left 96 / 148 (42 × 3).

Finishes: Space gray rail `#8a8a8f → #4a4a4f 30% → #55555a 70% → #8a8a8f`, button `#55555a`; Silver as iPhone.

---

## Mac — `mac-frame.css`
```html
<figure class="mac mac--14 mac--black">
  <div class="mac__screen">
    <img src="screenshot.png" alt="Describe the screen">
  </div>
  <span class="mac__base" aria-hidden="true"></span>
</figure>
```
Model: `mac--14` (MacBook Pro 14″, 1512 × 982 pt, default) · `mac--16` (1728 × 1117 pt) · `mac--display` (Studio Display 27″, 2560 × 1440 pt)
Finish: `mac--black` (space black, default) · `mac--silver` — the display is always silver
Extras: `mac--shadow`

Screenshot sizes (@2x): 14″ 3024 × 1964 · 16″ 3456 × 2234 · display 5120 × 2880. Capture the full screen including the menu bar; the frame draws the notch (196 × 36 pt, r 10 bottom corners) over it, matching the real menu-bar gap.

Menu bar (optional child of `.mac__screen`, for screenshots that lack one):
```html
<div class="mac__menubar"><strong>Finder</strong><span>File</span><span>Edit</span><span>View</span><span>Go</span><span>Window</span><span>Help</span><time>Mon Jun 9  9:41 AM</time></div>
```
37 pt tall on MacBook Pro, 24 pt on the display. Default is a translucent dark bar with white glyphs (Apple logo left, Wi‑Fi / battery / search / Control Center right); add `mac__menubar--dark` for black glyphs on a translucent light bar. Edit the app name, menus and time freely.

Geometry (pt): MacBook lid = screen + 25 on each side (rail 3 + bezel 22), lid r 30 top corners, screen r 12 top corners, bottom corners square. Base (`.mac__base`): 22 tall, 8 wider than the lid each side, r 12 bottom corners, thumb scoop 160 × 7 centred. Studio Display: rail 4 + bezel 50, body r 20, screen r 2, camera dot 10 at top 20; stand neck 240 × 160 centred under the body, foot 480 × 20.

Finishes: Space black rail `#5a5a5f → #2a2a2e 30% → #2a2a2e 70% → #5a5a5f`, base `#3b3b40 → #202024`; Silver rail as iPhone, base `#ececef → #c8c8cc`. Bezel `#050506`.

---

## Integration notes
- **React / Next:** `className="ipad ipad--13 ipad--landscape"`; import the CSS files once globally (plain class selectors, no scoping needed).
- **Tailwind:** keep the CSS files as-is (`calc()`-heavy, doesn't translate to utilities). Add via `@import` or `<link>`.
- **Static image export:** render a demo in a headless browser at device-pixel-ratio 2–3 and screenshot the figure; the shadow variants need ~60 pt of padding below.
- **Backgrounds:** dark finishes read best on light / neutral grounds; silver works on both.

## Files
- `iphone-frame.css` · `demo.html`
- `ipad-frame.css` · `demo-ipad.html`
- `mac-frame.css` · `demo-mac.html`
- `../Device Frames.dc.html` — design preview of every frame (same geometry, with drop-to-preview screenshot slots)
