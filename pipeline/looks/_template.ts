// PLUMBING ONLY — not a design. Copy to looks/<name>.ts, rename, then replace every token and
// every drawing call with your look (DESIGN.md). Files starting with "_" are never loaded.
//
// How the pieces are wired:
// - a card returns layers for ONE frame at time ctx.t (ms) of ctx.dur; draw in a 1920-wide
//   space: W = 1920 and layoutH(ctx) = the frame height in those units; frameSvg() scales it.
// - an overlay effect returns an SVG fragment in OUTPUT px. space: "screen" (ignores the camera),
//   "page" (stuck to the app, zooms with it) or "auto" (page when the journey gives a target); ctx.t runs past ctx.dur during the
//   exit tail (exit ms). For a screen overlay scale your 1920 layout by k = ctx.out.w / 1920 (frame
//   height in those units: ctx.out.h / k); ctx.window = the recording's rect on screen.
// - measure text with the family: widthOf(s, size, tracking, weight, family) — calibrated per look.
// - entrance/exit: inU(ctx) / exitU(ctx) use the look's motion tokens — use them everywhere.
// - wrap the whole composition in ONE opacity/transform group (nested groups multiply opacity).
import { defineCard, defineEffect, defineLook } from "../lib/look.ts";
import { W, layoutH, bgLayer, frameSvg, inU, exitU, fitLines, text, textLines, fmt, ease, prog } from "../lib/kit.ts";

export default defineLook({
  name: "_template", // must equal the file name
  source: "where the tokens came from (URL / CSS file)",
  tokens: {
    font: { sans: "Helvetica Neue, Arial, sans-serif", display: "Helvetica Neue, Arial, sans-serif", displayWeight: 600, bodyWeight: 400, tracking: 0 },
    color: { ink: "#000000", sub: "#555555", accent: "#0000ff", card: "#ffffff", cardInk: "#000000" },
    radius: 8,
    motion: { in: 500, out: 400, ease: "standard", stagger: 0 },
    transition: { type: "crossfade", ms: 500 },
    canvas: { type: "solid", color: "#eeeeee" },
  },
  cards: {
    title: defineCard({
      kind: "title", label: "Title", dur: 3000,
      defaults: { title: "Title" },
      sample: { title: "A real title of real length" },
      render(p, ctx) {
        // the entrance is ~85% done at frame 0, so the film's first frame (its thumbnail) shows the card
        // essentially composed — the same motion, just underway (DESIGN rule 7)
        const f = ctx.feel, H = layoutH(ctx), show = inU(ctx, -f.motion.in * 0.85) * (1 - exitU(ctx));
        const { lines, size } = fitLines(p.title, 140, W - 240, 96, f.font.tracking), lh = size * 1.05;
        const body = textLines(W / 2, H / 2 + size * 0.35 + ((lines.length - 1) * lh) / 2, lines, lh,
          { size, family: f.font.display, weight: f.font.displayWeight, fill: f.color.ink, ls: f.font.tracking, anchor: "middle" });
        return [bgLayer(ctx), { svg: frameSvg(ctx, `<g opacity="${fmt(show)}">${body}</g>`) }];
      },
    }),
  },
  effects: {
    label: defineEffect({
      label: "Label", hold: 3000, exit: 400, space: "screen",
      defaults: { text: "Label" },
      sample: { text: "A real label" },
      render(item, ctx) {
        const f = ctx.feel, k = ctx.out.w / 1920;
        const show = ease.outCubic(prog(ctx.t, 0, f.motion.in)) * (1 - prog(ctx.t, ctx.dur, f.motion.out)); // in, hold, mirror out
        return `<g opacity="${fmt(show)}">${text(64 * k, ctx.out.h - 80 * k, item.params.text, { size: 32 * k, family: f.font.sans, weight: 500, fill: f.color.ink })}</g>`;
      },
    }),
  },
});
