// studio-shots — cards that show Screenshot Studio renders in a fancy-e2e-videos film.
//
// Copy this file to fancy-e2e-videos/looks/studio-shots.ts. It is a look only so that its
// cards get registered; no video uses `feel: "studio-shots"`. The cards draw with the
// video's own look (its canvas, fonts and colours arrive as ctx.feel), so they fit any film.
//
//   import { card } from "../lib/look.ts";
//   import shots from "../looks/studio-shots.ts";
//   card(shots.cards.device, { src: "assets/studio/my-product-iphone-pro-home-light.png", caption: "Home" }, { bars: 2 })
//   card(shots.cards.device, { srcs: ["…home-light.png", "…send-dark.png"] }, { dur: 4000 })
//
// Why a card and not broll-still / broll-device: a lone device render is the device and its
// shadow on TRANSPARENCY. The built-in B-roll drops the alpha (the device would sit on a black
// box), and broll-device draws its own SVG phone around a flat screenshot (a phone inside a
// phone). An image layer with `alpha: true` keeps the render's own soft shadow.
// Finished slides and boards are opaque: use the built-in broll-still for those.
import { defineCard, defineLook } from "../lib/look.ts";
import { W, layoutH, bgLayer, frameSvg, inU, exitU, fitLines, textLines, fmt, clamp, lerp } from "../lib/kit.ts";
import type { Layer, SceneCtx } from "../lib/kit.ts";
import { mediaSize } from "../lib/presets/broll-still.ts";

type DeviceP = {
  /** one render (a path relative to the project, or absolute) … */
  src: string;
  /** … or up to three, side by side (they rise in one after another) */
  srcs: string[];
  /** a short line under the devices; "" = none */
  caption: string;
  /** the devices' height as a share of the frame (before the caption takes its room) */
  size: number;
  /** ms between the devices' entrances */
  stagger: number;
  /** px (in a 1920-wide frame) the devices drift up over the card: a slow push of life */
  drift: number;
};

function device(p: DeviceP, ctx: SceneCtx): Layer[] {
  const H = layoutH(ctx), k = ctx.out.w / W, f = ctx.feel;
  const files = (p.srcs?.length ? p.srcs : [p.src]).filter(Boolean).slice(0, 3)
    .map((s) => (s.startsWith("/") ? s : ctx.asset(s)));
  if (!files.length) throw new Error("studio-shots/device: give src or srcs");
  const sizes = files.map(mediaSize);
  const cap = !!p.caption;
  // lay the devices out in a box: one height for all, scaled down to fit the width
  const box = { y: H * (cap ? 0.07 : 0.08), h: H * clamp(p.size, 0.3, 0.92) * (cap ? 0.86 : 1), w: W * 0.86 };
  const gap = 70;
  let h = box.h, ws = sizes.map((s) => (s.w / s.h) * h);
  const total = ws.reduce((a, b) => a + b, 0) + gap * (files.length - 1);
  if (total > box.w) { const s = box.w / total; h *= s; ws = ws.map((w) => w * s); }
  const rowW = ws.reduce((a, b) => a + b, 0) + gap * (files.length - 1);
  const top = box.y + (box.h - h) / 2;
  const out = 1 - exitU(ctx);
  const drift = -p.drift * clamp(ctx.t / Math.max(1, ctx.dur));
  const layers: Layer[] = [bgLayer(ctx)];
  let x = (W - rowW) / 2;
  files.forEach((file, i) => {
    const u = inU(ctx, i * p.stagger, f.motion.in * 1.4);
    const s = lerp(0.92, 1, u), w = ws[i] * s, hh = h * s;
    const y = top + (h - hh) / 2 + (1 - u) * 60 + drift;
    const cx = x + ws[i] / 2;
    layers.push({ image: file, alpha: true, opacity: u * out, rect: { x: (cx - w / 2) * k, y: y * k, w: w * k, h: hh * k } });
    x += ws[i] + gap;
  });
  if (cap) {
    const size0 = 46, { lines, size } = fitLines(p.caption, size0, W * 0.7, 30, f.font.tracking, f.font.displayWeight, f.font.display);
    const u = inU(ctx, 250 + (files.length - 1) * p.stagger), lh = size * 1.15;
    const base = top + h + 70 + size * 0.8 + (lines.length - 1) * lh + (1 - u) * 14;
    layers.push({ svg: frameSvg(ctx, `<g opacity="${fmt(u * out)}">${textLines(W / 2, base, lines, lh,
      { size, family: f.font.display, weight: f.font.displayWeight, fill: f.color.ink, ls: f.font.tracking, anchor: "middle" })}</g>`) });
  }
  return layers;
}

export default defineLook({
  name: "studio-shots",
  source: "not a look: a home for the Screenshot Studio cards (they draw with the video's own look)",
  tokens: {
    font: { sans: "Helvetica Neue, Arial, sans-serif", display: "Helvetica Neue, Arial, sans-serif", displayWeight: 600, bodyWeight: 400, tracking: 0 },
    color: { ink: "#111827", sub: "#4B5563", accent: "#2563EB", card: "#FFFFFF", cardInk: "#111827" },
    radius: 12,
    motion: { in: 600, out: 450, ease: "outCubic", stagger: 0 },
    transition: { type: "crossfade", ms: 500 },
    canvas: "clean",
  },
  cards: {
    device: defineCard<DeviceP>({
      kind: "broll", label: "Screenshot Studio device render(s)", dur: 3800,
      defaults: { src: "", srcs: [], caption: "", size: 0.84, stagger: 220, drift: 18 },
      sample: { caption: "Everything at a glance" },
      render: device,
    }),
  },
});
