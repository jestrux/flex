// example-walk — a look made from Frame Studio itself (DESIGN.md, Custom).
// Sampled with `npm run look:tokens -- http://localhost:5191 --name example-walk` (+ `--click '[data-mode-btn="Hero"]'`):
//   ink  --ink #16161d · muted --muted #6e6c78 (darkened one step to #5d5b66: 4.49:1 on the stage fails)
//   accent --accent #7c3aed · Hero sheet: linear-gradient(165deg, #7c3aed, #3b1a78) (.heroSheet)
//   stage --field-hover #e8e8ee with the product's .stage dot grid rgba(24,24,48,.09)/20px (raised to .14, 3 px)
//   radius 12 px (buttons, mode cards) · shadow --e3 0 28px 80px rgba(22,22,48,.22) · line --line #e7e6ec
//   fonts: Geist / Geist Mono (self-hosted web fonts, not installed) → SF Pro Display/Text, .SF NS Mono
// The cards ARE the product's composition surface: the violet Hero sheet, headline centred over it, the way
// Frame Studio lays out a Hero. The payoff shows the real export with the app's own label strip above it.
import { defineCard, defineLook } from "../lib/look.ts";
import {
  W, layoutH, bgLayer, frameSvg, inU, exitU, fitLines, text, textLines, fmt, ease, prog, widthOf, stack,
  cssGradient, cropZoom, shadow, mediaSize, grainFilter,
} from "../lib/kit.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const T = {
  ink: "#16161d", sub: "#5d5b66", accent: "#7c3aed", deep: "#3b1a78", white: "#ffffff", line: "#e7e6ec", soft: "#f2ecfe",
  sans: "SF Pro Text, Helvetica Neue, Arial, sans-serif", display: "SF Pro Display, Helvetica Neue, Arial, sans-serif",
  mono: ".SF NS Mono, Menlo, monospace",
};
// the one radius: 12 CSS px in the 1440-wide app = 16 px in the 1920-wide layout
const R = 12 * (1920 / 1440);
// the size scale: title · body · label
const SIZE = { title: 168, body: 50, label: 28, cta: 44 };
const SHADOW = { color: "#161630", opacity: 0.22, radius: 80, dy: 28 };

/** the violet Hero sheet, inset from the frame like a composition on the stage */
function sheet(ctx: Parameters<typeof bgLayer>[0], id: string) {
  const H = layoutH(ctx), m = 72, box = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  const defs = cssGradient(`${id}g`, 165, box, [T.accent, T.deep]) + grainFilter(`${id}n`, 0.04)
    + shadow(`${id}s`, SHADOW, (n) => n, { w: W, h: H });
  const body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${fmt(R)}" fill="${T.accent}" filter="url(#${id}s)"/>`
    + `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${fmt(R)}" fill="url(#${id}g)" filter="url(#${id}n)"/>`;
  return { defs, body, box, H };
}

/** one entrance for everything: fade + a 14 px rise, the product's own calm ease; exit mirrors it */
function pose(ctx: Parameters<typeof bgLayer>[0], early = true) {
  const u = inU(ctx, early ? -ctx.feel.motion.in * 0.85 : 0) * (1 - exitU(ctx));
  return { op: u, dy: (1 - u) * 14 };
}

function titleCard(p: { title: string; subtitle?: string; cta?: string; image?: string }, ctx: Parameters<typeof bgLayer>[0], id: string) {
  const s = sheet(ctx, id), { op, dy } = pose(ctx);
  const maxW = s.box.w - 240;
  const img = p.image ? ctx.asset(p.image) : "", hasImg = !!img && existsSync(img);
  // with a device: the Hero layout — headline block in the top of the sheet, the phone rising from its bottom edge
  // the closing card's CTA is a real button (r45's 28 px pill read as a footnote): the phone sits lower to make room
  const phoneTop = p.cta ? 560 : 500, textCy = hasImg ? s.box.y + (phoneTop - s.box.y) / 2 + 8 : s.box.y + s.box.h / 2;
  const t = fitLines(p.title, hasImg ? 150 : SIZE.title, maxW, 110, -0.01, 600, T.display);
  const tl = t.size * 1.04;
  const sub = p.subtitle ? fitLines(p.subtitle, SIZE.body, maxW, 40, 0, 400, T.sans) : null;
  const heights = [0.72 * t.size + (t.lines.length - 1) * tl];
  if (sub) heights.push(0.72 * sub.size + (sub.lines.length - 1) * sub.size * 1.25);
  const ctaH = 96; if (p.cta) heights.push(ctaH);
  const tops = stack(textCy, heights, [48, 44]);
  let out = textLines(W / 2, tops[0] + heights[0], t.lines, tl, { size: t.size, family: T.display, weight: 600, fill: T.white, ls: -0.01, anchor: "middle" });
  if (sub) out += textLines(W / 2, tops[1] + heights[1], sub.lines, sub.size * 1.25, { size: sub.size, family: T.sans, weight: 400, fill: T.white, anchor: "middle", extra: `fill-opacity="0.9"` });
  if (p.cta) {
    // the app's primary button, inverted onto the violet sheet: white pill, accent label
    const y = tops[tops.length - 1], cw = widthOf(p.cta, SIZE.cta, 0, 500, T.sans) * 1.06 + 112;
    out += `<rect x="${fmt(W / 2 - cw / 2)}" y="${fmt(y)}" width="${fmt(cw)}" height="${ctaH}" rx="${fmt(R)}" fill="${T.white}"/>`
      + text(W / 2, y + ctaH / 2 + SIZE.cta * 0.36, p.cta, { size: SIZE.cta, family: T.sans, weight: 500, fill: T.accent, anchor: "middle" });
  }
  const layers: ReturnType<typeof bgLayer>[] = [bgLayer(ctx), { svg: frameSvg(ctx, `<g opacity="${fmt(op)}" transform="translate(0 ${fmt(dy)})">${s.body}</g>`, s.defs) }];
  if (hasImg) {
    // the real export (soft shadow + transparent corners: alpha), cut by the sheet's bottom edge like a Hero lineup
    const k = ctx.out.w / 1920, { w: iw, h: ih } = mediaSize(img), pw = 600, ph = (pw * ih) / iw;
    const bottom = s.box.y + s.box.h, vis = Math.min(1, (bottom - phoneTop) / ph);
    layers.push({ image: img, alpha: true, opacity: op, crop: { x: 0, y: 0, w: 1, h: vis },
      rect: { x: (W / 2 - pw / 2) * k, y: (phoneTop + dy) * k, w: pw * k, h: ph * vis * k } });
  }
  layers.push({ svg: frameSvg(ctx, `<g opacity="${fmt(op)}" transform="translate(0 ${fmt(dy)})">${out}</g>`) });
  return layers;
}

export default defineLook({
  name: "example-walk",
  label: "Frame Studio walk",
  source: "http://localhost:5191 (Frame Studio: CSS variables --ink/--muted/--accent/--field-hover/--e3, .heroSheet gradient, .stage dots) via npm run look:tokens",
  tokens: {
    font: { sans: T.sans, display: T.display, displayWeight: 600, bodyWeight: 400, tracking: -0.01, mono: T.mono },
    color: { ink: T.ink, sub: T.sub, accent: T.accent, card: T.white, cardInk: T.ink, cardBorder: T.line, callout: T.ink, line: T.line, soft: T.soft },
    shadow: { color: "rgba(22,22,48,0.22)", blur: 60, dy: 21 },
    radius: 12,
    motion: { in: 450, out: 450, ease: "standard", stagger: 0 },
    transition: { type: "crossfade", ms: 500 },
    canvas: { type: "solid", color: "#e8e8ee", dots: { color: "rgba(24, 24, 48, 0.14)", gap: 27, size: 3 } },
  },
  cards: {
    opening: defineCard({
      kind: "title", label: "Opening", dur: 5000,
      defaults: { title: "Frame Studio", subtitle: undefined as string | undefined, image: undefined as string | undefined },
      sample: { title: "Frame Studio", subtitle: "Your app screens, ready to ship.", image: "takes/example-walk-a/device.png" },
      render: (p, ctx) => titleCard(p, ctx, `o${ctx.uid}`),
    }),
    closing: defineCard({
      kind: "title", label: "Closing", dur: 5000,
      defaults: { title: "Frame Studio", subtitle: undefined as string | undefined, cta: undefined as string | undefined, image: undefined as string | undefined },
      sample: { title: "Frame Studio", subtitle: "Screens in. Launch images out.", cta: "kinpay-app-screenshots.fly.dev", image: "takes/example-walk-a/device.png" },
      render: (p, ctx) => titleCard(p, ctx, `c${ctx.uid}`),
    }),
    /** the payoff: the real exported PNG as a file — whole, then the devices crop away and it zooms to a 1:1 band
     *  of the headline. The app's own label strip rides above it ("Hero · Trio  6400 × 3600 · PNG"). */
    payoff: defineCard({
      kind: "broll", label: "Payoff", dur: 8000,
      defaults: { src: "", keep: "", name: "Hero · Trio", dims: "6400 × 3600 · PNG", crop: 1500, zoom: 3900 }, // the whole file reads in 1.5 s (it follows a hard cut from the same hero); the 1:1 band then holds ≈ 2.4 s (≤ 3 s)
      sample: { src: "takes/example-walk-c/export.png", keep: "takes/example-walk-c/keep.json" },
      render(p, ctx) {
        const H = layoutH(ctx), k = ctx.out.w / 1920;
        const src = p.src ? ctx.asset(p.src) : "";
        const layers: ReturnType<typeof bgLayer>[] = [bgLayer(ctx)];
        if (!src || !existsSync(src)) {
          layers.push({ svg: frameSvg(ctx, text(W / 2, H / 2, "(no export yet)", { size: SIZE.label, family: T.mono, weight: 400, fill: T.sub, anchor: "middle" })) });
          return layers;
        }
        const { w: iw, h: ih } = mediaSize(src);
        const kp = p.keep && existsSync(ctx.asset(p.keep)) ? JSON.parse(readFileSync(ctx.asset(p.keep), "utf8")) : null;
        const keep = kp?.keep ?? { x: iw * 0.2, y: ih * 0.08, w: iw * 0.6, h: ih * 0.14 };
        // the whole file, as big as the stage allows under its label strip
        const fw = 1520, fh = (fw * ih) / iw, frame = { x: (W - fw) / 2, y: (H - fh) / 2 + 22, w: fw, h: fh };
        const { op, dy } = pose(ctx, true);
        const cu = ease.inOut(prog(ctx.t, p.crop, 900)), zu = ease.inOut(prog(ctx.t, p.crop + 1000, p.zoom));
        const img = cropZoom(ctx, src, iw, ih, frame, cu, zu, { keep, clear: kp?.clear, radius: R });
        const r = { x: img.rect.x / k, y: img.rect.y / k + dy, w: img.rect.w / k, h: img.rect.h / k };
        // the look's one shadow under the file (drawn only as a shadow: a backing rect would show as a hairline)
        const sh = shadow(`p${ctx.uid}`, SHADOW, (n) => n, { w: W, h: H });
        const under = `<rect x="${fmt(r.x + 2)}" y="${fmt(r.y + 2)}" width="${fmt(r.w - 4)}" height="${fmt(r.h - 4)}" rx="${fmt(R)}" fill="${T.deep}" filter="url(#p${ctx.uid})" opacity="${fmt(op)}"/>`;
        // the label strip, as the app draws it above a composition: the name in ink, the size in mono
        const ly = r.y - 22, nw = widthOf(p.name, SIZE.label, 0, 600, T.sans);
        const total = nw + 18 + widthOf(p.dims, SIZE.label * 0.86, 0, 400, T.mono) * 1.04, lx = W / 2 - total / 2;
        const label = text(lx, ly, p.name, { size: SIZE.label, family: T.sans, weight: 600, fill: T.ink })
          + text(lx + nw + 18, ly, p.dims, { size: SIZE.label * 0.86, family: T.mono, weight: 400, fill: T.sub });
        layers.push({ svg: frameSvg(ctx, under, sh) });
        layers.push({ ...img, rect: { x: img.rect.x, y: img.rect.y + dy * k, w: img.rect.w, h: img.rect.h }, opacity: op });
        layers.push({ svg: frameSvg(ctx, `<g opacity="${fmt(op)}">${label}</g>`) });
        return layers;
      },
    }),
  },
  effects: {},
});
