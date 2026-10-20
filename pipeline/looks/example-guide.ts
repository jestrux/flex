// example-guide — the custom look for the worked-example quick guide (a hero image in three steps).
// Every token is sampled from the running app (npm run look:tokens -- http://localhost:5191 --click '[data-mode-btn="Hero"]'):
// the cards ARE the product's own composition — a Hero sheet (its 165° violet gradient, big white headline, helper
// line) — so the opening frame reads as Frame Studio before a word is spoken. The payoff shows the export the way the
// app labels a composition ("Hero · Trio  6400 × 3600 · PNG": semibold name + mono meta).
import { readFileSync, existsSync } from "node:fs";
import { defineCard, defineEffect, defineLook } from "../lib/look.ts";
import { W, layoutH, bgLayer, frameSvg, inU, exitU, fitLines, text, fmt, ease, prog, cssGradient, grainFilter, shadow, widthOf, cropZoom, mediaSize, stack, type SceneCtx } from "../lib/kit.ts";

// Geist is self-hosted by the app (not installed here), so the renderer can't use it: SF is the closest installed face
const SANS = "SF Pro Text, Helvetica Neue, Arial, sans-serif";
const DISPLAY = "SF Pro Display, Helvetica Neue, Arial, sans-serif";
const MONO = ".SF NS Mono, Menlo, monospace"; // Geist Mono → SF Mono (hidden system face: dotted name)
const VIOLET = ["#7c3aed", "#3b1a78"] as const; // .heroSheet linear-gradient(165deg, …)
const R = 16; // --radius 12 CSS px × the capture's 1920/1440 scale: one radius for cards, chips and the payoff
const SHADOW = "#161630"; // --e2's tint

type Box = { x: number; y: number; w: number; h: number };

/** the Hero-sheet card (opening and closing share it: DESIGN rule 8) — a mono kicker, a big white headline,
 *  a helper line, stacked by their visible cap heights so the block is optically centred on the sheet */
function sheetCard(p: { kicker?: string; title: string; helper?: string }, ctx: SceneCtx) {
  const f = ctx.feel, H = layoutH(ctx);
  // ~85 % of the entrance has happened by frame 0: the thumbnail is the composed card, not a fade (DESIGN rule 7)
  const u = inU(ctx, -f.motion.in * 0.85), show = u * (1 - exitU(ctx));
  const rise = (1 - u) * 28; // rises into place, leaves by fading — the studio's own calm ease-out, no bounce
  const sheet: Box = { x: 64, y: 64, w: W - 128, h: H - 128 };
  // "|" breaks the title by hand: two balanced lines read bigger (and break better) than one long fitted line
  const fit = p.title.includes("|")
    ? (() => { const ls = p.title.split("|").map((t) => t.trim()); return { lines: ls, size: Math.min(150, ...ls.map((l) => (sheet.w - 260) / Math.max(1, widthOf(l, 1, -0.01, 700, DISPLAY)))) }; })()
    : fitLines(p.title, 150, sheet.w - 260, 120, -0.01, 700, DISPLAY);
  const { lines, size } = fit;
  // size scale: title ≥ 120 · helper 52 · kicker 44 — the kicker reads from a phone, still clearly third in rank
  const lh = size * 1.06, helperSize = 52, kickSize = 44;
  const rows: { h: number; draw: (top: number) => string }[] = [];
  if (p.kicker) rows.push({ h: kickSize * 0.72, draw: (t) => text(W / 2, t + kickSize * 0.72, p.kicker!, { size: kickSize, family: MONO, weight: 500, fill: "#ffffff", anchor: "middle", ls: 0.02 }) });
  rows.push({ h: 0.72 * size + (lines.length - 1) * lh, draw: (t) => lines.map((l, i) => text(W / 2, t + 0.72 * size + i * lh, l, { size, family: DISPLAY, weight: 700, fill: "#ffffff", anchor: "middle", ls: -0.01 })).join("") });
  if (p.helper) rows.push({ h: helperSize * 0.72, draw: (t) => text(W / 2, t + helperSize * 0.72, p.helper!, { size: helperSize, family: SANS, weight: 400, fill: "#ffffff", anchor: "middle" }) });
  // title → helper gets more air than kicker → title: the title's descenders ("steps") eat into the visible gap
  const tops = stack(sheet.y + sheet.h / 2, rows.map((r) => r.h), p.kicker ? [72, 92] : [92]);
  const body = rows.map((r, i) => r.draw(tops[i])).join("");
  // grain: the big violet gradient bands after encoding — a zero-mean grain on the shape repairs it (not decoration)
  const defs = cssGradient("egSheet", 165, sheet, [...VIOLET]) + grainFilter("egGrain", 0.04)
    + shadow("egSh", { opacity: 0.22, radius: 80, dy: 28, color: SHADOW }, (n) => n, { w: W, h: H });
  const svg = `<g opacity="${fmt(show)}" transform="translate(0 ${fmt(rise)})">`
    + `<rect x="${sheet.x}" y="${sheet.y}" width="${sheet.w}" height="${sheet.h}" rx="${R}" fill="${VIOLET[1]}" filter="url(#egSh)"/>`
    + `<rect x="${sheet.x}" y="${sheet.y}" width="${sheet.w}" height="${sheet.h}" rx="${R}" fill="url(#egSheet)" filter="url(#egGrain)"/>`
    + body + `</g>`;
  return [bgLayer(ctx), { svg: frameSvg(ctx, svg, defs) }];
}

export default defineLook({
  name: "example-guide",
  source: "http://localhost:5191 (Frame Studio) — CSS vars --ink/--muted/--accent/--stage/--dot/--e2, .heroSheet gradient, --radius 12px",
  tokens: {
    font: { sans: SANS, display: DISPLAY, displayWeight: 700, bodyWeight: 400, tracking: 0, mono: MONO },
    color: {
      ink: "#16161d",        // --ink
      sub: "#5f5d69",        // --muted #6e6c78 darkened one step: the product's own value is 4.49:1 on --stage (DESIGN rule 9)
      accent: "#7c3aed",     // --accent
      card: "#ffffff",       // --panel
      cardInk: "#16161d",
      line: "#e7e6ec",       // --line
      soft: "#f2ecfe",       // --accent-soft (the selected-option fill)
    },
    shadow: { color: SHADOW, blur: 32, dy: 12 }, // --e2: 0 12px 32px rgba(22,22,48,.14)
    radius: R,
    motion: { in: 520, out: 520, ease: "power3Out", stagger: 0 }, // the studio's quick ease-out
    transition: { type: "push", ms: 500 },
    // --stage + its dot grid; the product's .09 alpha vanishes after encoding, .14 at 3 px survives
    canvas: { type: "solid", color: "#efeff3", dots: { color: "rgba(24, 24, 48, 0.14)", gap: 27, size: 3 } },
  },
  cards: {
    opening: defineCard({
      kind: "title", label: "Opening (Hero sheet)", dur: 4800,
      defaults: { kicker: undefined as string | undefined, title: "Title", helper: undefined as string | undefined },
      sample: { kicker: "Frame Studio · quick guide", title: "A hero image | in three steps", helper: "From app screens to a 6400 px PNG." },
      render: (p, ctx) => sheetCard(p, ctx),
    }),
    closing: defineCard({
      kind: "title", label: "Closing (Hero sheet)", dur: 4800,
      defaults: { kicker: undefined as string | undefined, title: "Title", helper: undefined as string | undefined },
      sample: { kicker: "Frame Studio · quick guide", title: "Three steps.", helper: "One hero image, ready to ship." },
      render: (p, ctx) => sheetCard(p, ctx),
    }),
    // the payoff is the export as a FILE (kind "broll": an image, not a title — rule 11's width check doesn't apply).
    // It's a reveal, not the shot carrying on: labelled like the app labels a composition, then cropZoom — the bottom
    // edge rises to the headline's strip (the devices leave as a crop), then a log zoom to a true 100 % band, so the
    // viewer FEELS "6400 px" instead of reading it.
    payoff: defineCard({
      kind: "broll", label: "Payoff (export → 1:1)", dur: 9600,
      defaults: { src: "takes/example-guide-hero/export.png", keep: "takes/example-guide-hero/keep.json", name: "Hero · Trio", meta: "6400 × 3600 · PNG", crop: 3600, zoom: 4700, zoomMs: 6400 },
      sample: { src: "takes/example-guide-hero/export.png", keep: "takes/example-guide-hero/keep.json" },
      render(p, ctx) {
        const f = ctx.feel, H = layoutH(ctx), k = ctx.out.w / 1920;
        const show = inU(ctx, -f.motion.in * 0.85); // a hard cut lands on it: it must already be there (DESIGN rule 7)
        let size = { w: 6400, h: 3600 };
        try { if (existsSync(p.src)) size = mediaSize(p.src) as { w: number; h: number }; } catch { /* preview before the first export */ }
        let boxes: { keep: Box; clear: Box[] } | null = null;
        try { boxes = existsSync(p.keep) ? JSON.parse(readFileSync(p.keep, "utf8")) : null; } catch { boxes = null; }
        // the whole file, a step smaller than the frame, so it reads as an object on the stage (not more app footage)
        const fw = 1520, fh = Math.round(fw * size.h / size.w), fx = (W - fw) / 2, fy = Math.round((H - fh) / 2 + 26);
        const frame = { x: fx, y: fy, w: fw, h: fh };
        const cu = ease.inOut(prog(ctx.t, p.crop, 900)), zu = ease.inOut(prog(ctx.t, p.zoom, p.zoomMs));
        // the label leaves before the crop starts: it describes the whole file, not the close-up
        const labelOp = show * (1 - ease.inOut(prog(ctx.t, p.crop - 300, 400)));
        const nameW = widthOf(p.name, 30, 0, 600, SANS);
        const label = text(fx, fy - 22, p.name, { size: 30, family: SANS, weight: 600, fill: f.color.ink })
          + text(fx + nameW + 18, fy - 22, p.meta, { size: 26, family: MONO, weight: 400, fill: f.color.sub });
        const img = boxes ? cropZoom(ctx, p.src, size.w, size.h, frame, cu, zu, { keep: boxes.keep, clear: boxes.clear, radius: R })
          : { image: p.src, rect: { x: fx * k, y: fy * k, w: fw * k, h: fh * k }, radius: R * k };
        const r = img.rect; // output px
        const defs = shadow("egPay", { opacity: 0.2, radius: 64, dy: 22, color: SHADOW }, (n) => n * k, ctx.out);
        // the shadow follows the moving image; inset 2 px so no hairline shows round its anti-aliased edge
        const sh = `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.out.w}" height="${ctx.out.h}"><defs>${defs}</defs><g opacity="${fmt(show)}"><rect x="${fmt(r.x + 2)}" y="${fmt(r.y + 2)}" width="${fmt(r.w - 4)}" height="${fmt(r.h - 4)}" rx="${fmt(R * k)}" fill="${VIOLET[1]}" filter="url(#egPay)"/></g></svg>`;
        return [
          bgLayer(ctx),
          { svg: sh },
          { ...img, alpha: true, opacity: show }, // alpha: the PNG's rounded corners are transparent
          { svg: frameSvg(ctx, `<g opacity="${fmt(labelOp)}">${label}</g>`) },
        ] as never;
      },
    }),
  },
  effects: {
    // the step chip — "do these in order" (ART_DIRECTION §1): which step we're on, in the app's selected-option style
    // (accent-soft fill, accent numeral) on a white panel card. It sits in the clipped insert's plain corner, so it
    // never covers the control being clicked.
    step: defineEffect({
      label: "Step chip", hold: 2600, exit: 520, space: "screen",
      defaults: { n: 1, text: "Switch to Hero", corner: "tl" as "tl" | "tr" | "bl" | "br" },
      sample: { n: 2, text: "Write your headline", corner: "tl" },
      render(item, ctx) {
        const f = ctx.feel, k = ctx.out.w / 1920, Hh = ctx.out.h / k;
        const u = ease.outCubic(prog(ctx.t, 0, f.motion.in)), x = ease.outCubic(prog(ctx.t, ctx.dur, f.motion.out));
        const show = u * (1 - x), dy = (1 - u) * 16 + x * 16; // exit mirrors the entrance (DESIGN rule 4)
        const ts = 40, label = item.params.text, tw = widthOf(label, ts, 0, 600, SANS);
        const hgt = 88, dot = 52, padL = 18, gap = 20, padR = 34, w = padL + dot + gap + tw + padR;
        const c = item.params.corner, X = c.endsWith("l") ? 64 : 1920 - 64 - w, Y = c.startsWith("t") ? 64 : Hh - 64 - hgt;
        const defs = shadow("egChip", { opacity: 0.14, radius: 32, dy: 12, color: SHADOW }, (n) => n * k, ctx.out);
        const g = `<g transform="scale(${fmt(k)}) translate(0 ${fmt(dy)})">`
          + `<rect x="${fmt(X)}" y="${fmt(Y)}" width="${fmt(w)}" height="${hgt}" rx="${R}" fill="#ffffff" stroke="${f.color.line}" stroke-width="1.5"/>`
          + `<circle cx="${fmt(X + padL + dot / 2)}" cy="${fmt(Y + hgt / 2)}" r="${dot / 2}" fill="${f.color.soft}" stroke="${f.color.accent}" stroke-width="2"/>`
          + text(X + padL + dot / 2, Y + hgt / 2 + 11, String(item.params.n), { size: 30, family: SANS, weight: 700, fill: f.color.accent, anchor: "middle" })
          + text(X + padL + dot + gap, Y + hgt / 2 + 14, label, { size: ts, family: SANS, weight: 600, fill: f.color.ink })
          + `</g>`;
        return `<defs>${defs}</defs><g opacity="${fmt(show)}"><g filter="url(#egChip)">${g}</g></g>`;
      },
    }),
  },
});
