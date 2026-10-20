// example-teaser — a Custom look for the Frame Studio teaser, sampled from the product itself
// (npm run look:tokens -- http://localhost:5191, plus Hero mode for the sheet gradient). Three cards, no overlays:
// a music-led teaser has no narration for a lower third to support.
//
//   brand — the product's own composition surface (Hero's sheet gradient 165deg #7c3aed → #3b1a78) with white
//           display type. The opening, the reveal on the rise and the closing card: the same surface three times
//           makes them read as one idea arriving (DESIGN rule 8), and frame 0 is already an on-brand thumbnail.
//   word  — an intertitle on the studio's own stage (#efeff3 + its dot grid): one line in ink, ONE word in the
//           accent — the word the next shot proves ("device" → the laptop). With an empty title it is the hush bar.
//   file  — the payoff: the exported PNG presented as a FILE (labelled the way the app labels a composition),
//           then cropZoom into its 1:1 headline band, so the viewer feels the 6400 px instead of reading it.
// One motion for everything: a short fade + 18 px rise on the product's own ease, mirrored out.
import { existsSync, readFileSync } from "node:fs";
import { defineCard, defineLook } from "../lib/look.ts";
import { W, layoutH, bgLayer, frameSvg, inU, exitU, fitSize, widthOf, text, fmt, ease, prog, esc, fam, cssGradient, grainFilter, cropZoom, mediaSize, stack } from "../lib/kit.ts";
import type { SceneCtx, Layer } from "../lib/kit.ts";

const T = {
  ink: "#16161d", // --ink
  sub: "#63616d", // --muted #6e6c78, one step darker: the product's own value is 4.49:1 on its stage (rule 9)
  accent: "#7c3aed", // --accent
  deep: "#3b1a78", // Hero sheet gradient end (.heroSheet)
  soft: "#f2ecfe", // --accent-soft
  stage: "#efeff3", // --stage
  line: "#e7e6ec", // --line
};
// the product's Geist is a self-hosted web font the SVG renderer can't load: SF Pro is the closest installed face
const DISPLAY = "SF Pro Display, Helvetica Neue, Arial, sans-serif";
const SANS = "SF Pro Text, Helvetica Neue, Arial, sans-serif";
const MONO = ".SF NS Mono, Menlo, monospace"; // for Geist Mono: the app sets sizes and meta in mono, so the file label does too
const TRACK = -0.015; // Geist's tight display set, approximated on SF Pro Display
const SIZE = { title: 168, body: 44, label: 28 }; // the one size scale (rule 1); 168 px reads from a phone (rule 11)

/** the one motion: fade + rise, already ~85 % underway at t = 0 — every card here arrives on a hard cut, and a
 *  card entering from nothing would flash an empty stage on each cut (DESIGN rule 7) */
function pose(ctx: SceneCtx) {
  const u = inU(ctx, -ctx.feel.motion.in * 0.85), x = exitU(ctx);
  const show = u * (1 - x), dy = (1 - u) * 18 - x * 18;
  return { show, dy };
}

/** a line of text with one word (the first match of `hi`) set in another colour */
function lineWithAccent(x: number, y: number, s: string, hi: string | undefined, size: number, fill: string, hiFill: string) {
  const attrs = `font-family="${fam(DISPLAY)}" font-size="${fmt(size)}" font-weight="600" letter-spacing="${fmt(TRACK * size)}" text-anchor="middle"`;
  const i = hi ? s.indexOf(hi) : -1;
  // letter-spacing trails the last char: shift by half to re-centre
  const xx = x - (TRACK * size) / 2;
  if (i < 0) return `<text ${attrs} fill="${fill}" x="${fmt(xx)}" y="${fmt(y)}" xml:space="preserve">${esc(s)}</text>`;
  const a = s.slice(0, i), b = s.slice(i, i + hi!.length), c = s.slice(i + hi!.length);
  return `<text ${attrs} fill="${fill}" x="${fmt(xx)}" y="${fmt(y)}" xml:space="preserve">${esc(a)}<tspan fill="${hiFill}">${esc(b)}</tspan>${esc(c)}</text>`;
}

export default defineLook({
  name: "example-teaser",
  label: "Frame Studio teaser",
  source: "http://localhost:5191 — CSS vars (--ink, --muted, --accent, --accent-soft, --stage, --dot, --line, --e2), .heroSheet gradient (Hero mode), button radius 12px",
  tokens: {
    font: { sans: SANS, display: DISPLAY, displayWeight: 600, bodyWeight: 400, tracking: TRACK, mono: MONO },
    color: { ink: T.ink, sub: T.sub, accent: T.accent, card: "#ffffff", cardInk: T.ink, line: T.line, soft: T.soft },
    shadow: { color: "rgba(22, 22, 48, 0.14)", blur: 32, dy: 12 }, // --e2
    radius: 12,
    motion: { in: 420, out: 420, ease: "standard", stagger: 0 },
    transition: { type: "cut", ms: 0 },
    canvas: { type: "solid", color: T.stage, dots: { color: "rgba(24, 24, 48, 0.14)", gap: 27, size: 3 } },
  },
  cards: {
    brand: defineCard({
      kind: "title", label: "Brand (Hero sheet)", dur: 3100,
      defaults: { title: "Frame Studio", kicker: undefined as string | undefined, subtitle: undefined as string | undefined },
      sample: { title: "Frame Studio", subtitle: "Mockups, boards and heroes from your app's screens." },
      render(p, ctx) {
        const H = layoutH(ctx), { show, dy } = pose(ctx);
        const defs = cssGradient("etSheet", 165, { x: 0, y: 0, w: W, h: H }, [T.accent, T.deep]) + grainFilter("etGrain", 0.04);
        const size = Math.min(SIZE.title, fitSize(p.title, SIZE.title, W - 320, TRACK, 600, DISPLAY));
        const rows: number[] = [], gaps: number[] = [];
        if (p.kicker) { rows.push(SIZE.label * 0.75); gaps.push(44); }
        rows.push(size * 0.72);
        if (p.subtitle) { gaps.push(52); rows.push(SIZE.body * 0.72); }
        const tops = stack(H / 2, rows, gaps);
        let i = 0, body = "";
        if (p.kicker) { const k = p.kicker.toUpperCase(); body += text(W / 2 + (0.16 * SIZE.label) / 2, tops[i++] + SIZE.label * 0.75, k, { size: SIZE.label, family: MONO, weight: 500, fill: "#ffffff", ls: 0.16, anchor: "middle" }); }
        body += lineWithAccent(W / 2, tops[i++] + size * 0.72, p.title, undefined, size, "#ffffff", "#ffffff");
        if (p.subtitle) body += text(W / 2, tops[i++] + SIZE.body * 0.72, p.subtitle, { size: SIZE.body, family: SANS, weight: 400, fill: T.soft, anchor: "middle" });
        return [{ svg: frameSvg(ctx, `<rect width="${W}" height="${fmt(H)}" fill="url(#etSheet)" filter="url(#etGrain)"/><g opacity="${fmt(show)}" transform="translate(0 ${fmt(dy)})">${body}</g>`, defs) }];
      },
    }),
    word: defineCard({
      kind: "title", label: "Intertitle (stage)", dur: 1550,
      defaults: { title: "On any device.", accent: undefined as string | undefined },
      sample: { title: "On any device.", accent: "device" },
      render(p, ctx) {
        const H = layoutH(ctx), { show, dy } = pose(ctx);
        const size = Math.min(SIZE.title, fitSize(p.title, SIZE.title, W - 360, TRACK, 600, DISPLAY));
        const base = H / 2 + (size * 0.72) / 2;
        return [bgLayer(ctx), { svg: frameSvg(ctx, `<g opacity="${fmt(show)}" transform="translate(0 ${fmt(dy)})">${lineWithAccent(W / 2, base, p.title, p.accent, size, T.ink, T.accent)}</g>`) }];
      },
    }),
    file: defineCard({
      kind: "broll", label: "Payoff (the exported file)", dur: 7700,
      defaults: { src: "takes/example-teaser-hero/export.png", keep: "takes/example-teaser-hero/keep.json", name: "Hero · Duo", meta: "6400 × 3600 · PNG", crop: 1500, zoom: 2500 },
      sample: { src: "takes/example-teaser-hero/export.png" },
      render(p, ctx) {
        const H = layoutH(ctx), k = ctx.out.w / W, src = ctx.asset(p.src), layers: Layer[] = [bgLayer(ctx)];
        const { show, dy } = pose(ctx);
        if (!existsSync(src)) return [...layers, { svg: frameSvg(ctx, text(W / 2, H / 2, "(no export yet)", { size: SIZE.label, family: MONO, weight: 400, fill: T.sub, anchor: "middle" })) }];
        const { w: iw, h: ih } = mediaSize(src);
        const kp = ctx.asset(p.keep), boxes = existsSync(kp) ? JSON.parse(readFileSync(kp, "utf8")) : null;
        // the file, whole: 1400 wide, centred with its label strip above it
        const fw = 1400, fh = (fw * ih) / iw, labH = 46, fy = (H - fh - labH) / 2 + labH + dy, fx = (W - fw) / 2;
        const frame = { x: fx, y: fy, w: fw, h: fh };
        const cu = ease.inOut(prog(ctx.t, p.crop, 900)), zu = ease.inOut(prog(ctx.t, p.crop + 1000, p.zoom));
        const img = boxes?.keep
          ? cropZoom(ctx, src, iw, ih, frame, cu, zu, { keep: boxes.keep, clear: boxes.clear, radius: 12 })
          : { image: src, rect: { x: fx * k, y: fy * k, w: fw * k, h: fh * k }, radius: 12 * k, alpha: undefined as boolean | undefined };
        const r = img.rect, sh = ctx.feel.shadow!;
        // the look's one shadow, on the image's rect (inset 2 px so no hairline shows round the picture)
        const shadowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.out.w}" height="${ctx.out.h}"><defs><filter id="etShadow" filterUnits="userSpaceOnUse" x="0" y="0" width="${ctx.out.w}" height="${ctx.out.h}"><feDropShadow dx="0" dy="${fmt(sh.dy * k)}" stdDeviation="${fmt((sh.blur * k) / 2)}" flood-color="rgb(22,22,48)" flood-opacity="0.14"/></filter></defs><rect x="${fmt(r.x + 2)}" y="${fmt(r.y + 2)}" width="${fmt(r.w - 4)}" height="${fmt(r.h - 4)}" rx="${fmt(12 * k)}" fill="${T.stage}" filter="url(#etShadow)" opacity="${fmt(show)}"/></svg>`;
        layers.push({ svg: shadowSvg }, { ...img, alpha: true, opacity: show });
        // the label: the app's own grammar — name in ink, size + format in the mono face; leaves as the crop starts
        const lab = show * (1 - ease.inOut(prog(ctx.t, p.crop - 200, 420)));
        if (lab > 0.002) {
          const nw = widthOf(p.name, SIZE.label, 0, 600, SANS);
          const ly = fy - 18;
          layers.push({ svg: frameSvg(ctx, `<g opacity="${fmt(lab)}">${text(fx, ly, p.name, { size: SIZE.label, family: SANS, weight: 600, fill: T.ink })}${text(fx + nw + 18, ly, p.meta, { size: SIZE.label * 0.86, family: MONO, weight: 400, fill: T.sub })}</g>`) });
        }
        return layers;
      },
    }),
  },
  effects: {},
});
