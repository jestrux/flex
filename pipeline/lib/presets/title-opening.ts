// Opening title — the film's first card. Designs itself per feel:
//   clean        left-aligned sans, accent rule + kicker, lines fade-rise in sequence, a footer hairline
//   modern       heavy display type rising letter by letter out of a mask (spring), lime kicker pill, glow
//   professional centred serif, small-caps kicker between hairlines, inset frame, slow power3 fades
// Params: { title, kicker?, subtitle? }. Pure function of t.
//
// This file also exports the small helpers the other title cards (chapter, closing) share.
import type { CardModule, Layer, SceneCtx } from "./types.ts";
import type { Feel } from "../feels.ts";
import { backgroundSvg, BACKGROUNDS } from "../canvas.ts";
import { clamp, ease, esc, fmt, prog, spring, textWidth } from "../effects/kit.ts";

// ── shared helpers (title-chapter / title-closing import these) ─────────────────────────
/** layout width; the SVG viewBox is W × (W·h/w), scaled to ctx.out */
export const W = 1920;
export const layoutH = (ctx: SceneCtx) => (W * ctx.out.h) / ctx.out.w;

/** a font-family list safe inside an SVG attribute */
export const fam = (f: string) => esc(f.split(",").map((s) => s.trim()).map((s) => (/\s/.test(s) ? `'${s}'` : s)).join(", "));

/** the feel's canvas background as a layer */
export const bgLayer = (ctx: SceneCtx): Layer => ({ svg: backgroundSvg((BACKGROUNDS[ctx.feel.canvas] ?? BACKGROUNDS.modern).bg, ctx.out.w, ctx.out.h) });

/** wrap a body in a full-frame SVG with the shared layout viewBox */
export const frameSvg = (ctx: SceneCtx, body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.out.w}" height="${ctx.out.h}" viewBox="0 0 ${W} ${fmt(layoutH(ctx))}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;

export const easeOf = (feel: Feel) => ease[feel.motion.ease] ?? ease.standard;
/** 0 → 1 over the card's last `outMs` (default feel.motion.out) */
/** 0 → 1 over the card's exit. The last card holds to the cut (0). A custom look's exit mirrors its
 *  entrance (same easing, reversed — DESIGN rule 4); the built-in looks keep their tuned exits. */
export const exitU = (ctx: SceneCtx, outMs = ctx.feel.motion.out) => {
  if (ctx.last) return 0;
  const u = prog(ctx.t, ctx.dur - outMs, outMs);
  return ["clean", "modern", "professional"].includes(ctx.feel.name) ? ease.inOut(u) : 1 - clamp(easeOf(ctx.feel)(1 - u));
};
/** entrance progress of something that starts at `start` ms, with the feel's ease and length */
export const inU = (ctx: SceneCtx, start = 0, len = ctx.feel.motion.in) => easeOf(ctx.feel)(prog(ctx.t, start, len));

type Wt = "regular" | "medium" | "bold" | number; // a number = a CSS weight (≥650 bold, ≥500 medium)
/** largest font size ≤ max so `text` fits in maxW (tracking in em per char) */
export function fitSize(text: string, max: number, maxW: number, tracking = 0, weight: Wt = "bold", family?: string) {
  const em = textWidth(text, 1, weight, family) + tracking * [...text].length;
  return Math.min(max, maxW / Math.max(0.01, em));
}
/** one line, or the best 2- (then 3-) line split when fewer lines would be smaller than `min` */
export function fitLines(text: string, max: number, maxW: number, min: number, tracking = 0, weight: Wt = "bold", family?: string) {
  const words = text.split(/\s+/).filter(Boolean);
  const size = (ls: string[]) => Math.min(...ls.map((l) => fitSize(l, max, maxW, tracking, weight, family)));
  let best = { lines: [text], size: fitSize(text, max, maxW, tracking, weight, family) };
  if (best.size >= min || words.length < 2) return best;
  for (let i = 1; i < words.length; i++) {
    const ls = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    if (size(ls) > best.size) best = { lines: ls, size: size(ls) };
  }
  if (best.size >= min || words.length < 3) return best;
  for (let i = 1; i < words.length - 1; i++) for (let j = i + 1; j < words.length; j++) {
    const ls = [words.slice(0, i).join(" "), words.slice(i, j).join(" "), words.slice(j).join(" ")];
    if (size(ls) > best.size) best = { lines: ls, size: size(ls) };
  }
  return best;
}
/** stacked lines; `last` is the LAST line's baseline, `lh` the line pitch */
export const textLines = (x: number, last: number, lines: string[], lh: number, o: TextOpts) =>
  lines.map((ln, i) => text(x, last - (lines.length - 1 - i) * lh, ln, o)).join("");
/** modern: stacked lines rising letter by letter out of per-line masks (clipPath def + body) */
export function risingLines(o: { id: string; x: number; last: number; lines: string[]; lh: number; size: number; opts: TextOpts; t: number; feel: Feel; lineDelay?: number }) {
  const n = o.lines.length, base = (i: number) => o.last - (n - 1 - i) * o.lh;
  const def = `<clipPath id="${o.id}">${o.lines.map((_, i) => `<rect x="0" y="${fmt(base(i) - o.size)}" width="${W}" height="${fmt(o.size * 1.24)}"/>`).join("")}</clipPath>`;
  const body = `<g clip-path="url(#${o.id})">${o.lines.map((ln, i) => letters({ text: ln, x: o.x, y: base(i), attrs: textAttrs(o.opts), t: o.t - i * (o.lineDelay ?? 120), stagger: o.feel.motion.stagger, settle: 900, pose: springRise(o.feel, o.size * 0.95, 90) })).join("")}</g>`;
  return { def, body };
}
/** estimated advance width incl. tracking (em) */
export const widthOf = (s: string, size: number, tracking = 0, weight: Wt = "bold", family?: string) => textWidth(s, size, weight, family) + tracking * size * [...s].length;

/** the string as tspans with only the chars in `show` visible (exact kerning per letter) */
export function masked(chars: string[], show: (i: number) => boolean) {
  let out = "", run = "", vis: boolean | null = null;
  const flush = () => { if (run) out += vis ? `<tspan>${esc(run)}</tspan>` : `<tspan fill="none">${esc(run)}</tspan>`; run = ""; };
  chars.forEach((c, i) => { const v = show(i); if (v !== vis) { flush(); vis = v; } run += c; });
  flush();
  return out;
}

export type Pose = { dx?: number; dy?: number; op: number };
/**
 * Per-letter animation (Lane D slate technique): every animating letter is the whole string
 * with the other letters fill="none", so the font engine places it exactly where it sits in
 * the settled line. `pose(lt)` gets each letter's local time (t − i·stagger). Once `settle`
 * ms have passed after the last letter starts, the line is drawn as one element.
 */
export function letters(o: { text: string; x: number; y: number; attrs: string; t: number; stagger: number; settle: number; pose: (lt: number) => Pose }) {
  const chars = [...o.text], n = chars.length;
  const base = `x="${fmt(o.x)}" y="${fmt(o.y)}" ${o.attrs} xml:space="preserve"`;
  if (o.t >= (n - 1) * o.stagger + o.settle) return `<text ${base}>${esc(o.text)}</text>`;
  let s = "";
  chars.forEach((c, i) => {
    if (c === " ") return;
    const p = o.pose(o.t - i * o.stagger);
    if (p.op <= 0.002) return;
    s += `<text ${base} transform="translate(${fmt(p.dx ?? 0)} ${fmt(p.dy ?? 0)})" opacity="${fmt(clamp(p.op))}">${masked(chars, (j) => j === i)}</text>`;
  });
  return s;
}

export type TextOpts = { size: number; family: string; weight: number; fill: string; ls?: number; anchor?: "start" | "middle" | "end"; extra?: string };
export function textAttrs(o: TextOpts) {
  return `font-family="${fam(o.family)}" font-size="${fmt(o.size)}" font-weight="${o.weight}" fill="${o.fill}"${o.ls ? ` letter-spacing="${fmt(o.ls * o.size)}"` : ""}${o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : ""}${o.extra ? ` ${o.extra}` : ""}`;
}
/** a text element; ls = letter-spacing in em */
export const text = (x: number, y: number, s: string, o: TextOpts) => `<text ${textAttrs(o)} x="${fmt(x)}" y="${fmt(y)}" xml:space="preserve">${esc(s)}</text>`;
/** centred text with letter-spacing trails the last char; shift by half to re-centre */
export const lsShift = (size: number, ls = 0) => (ls * size) / 2;

/** a soft blur filter (userSpace region = whole frame) */
export const glowFilter = (id: string, std: number, h: number) =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${fmt(h)}"><feGaussianBlur stdDeviation="${fmt(std)}"/></filter>`;

/** spring rise for one letter: from `drop` px below, with a quick fade */
export const springRise = (feel: Feel, drop: number, fadeMs = 140) => (lt: number): Pose => {
  const sp = feel.motion.spring ?? { stiffness: 220, damping: 18 };
  return lt <= 0 ? { op: 0 } : { dy: (1 - spring(lt, sp)) * drop, op: clamp(lt / fadeMs) };
};

/** the bold "block wipe": a solid block grows across its span, then retracts from the left, revealing what's under it */
export function blockWipe(t: number, start: number, len: number) {
  const a = ease.outCubic(prog(t, start, len * 0.5)), b = ease.outCubic(prog(t, start + len * 0.5, len * 0.5));
  return { from: b, to: a, revealed: a >= 1 };
}
/** the block for a blockWipe over [x, x+w] (rect attrs x/width), or "" when invisible */
export function wipeRect(w: { from: number; to: number }, x: number, width: number, y: number, h: number, fill: string) {
  const bx = x + w.from * width, bw = x + w.to * width - bx;
  return bw > 0.5 ? `<rect x="${fmt(bx)}" y="${fmt(y)}" width="${fmt(bw)}" height="${fmt(h)}" fill="${fill}"/>` : "";
}

// ── designs ─────────────────────────────────────────────────────────────────────────────
type P = { title: string; kicker: string; subtitle: string };

function clean(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, x0 = 168;
  const { lines, size: tSize } = fitLines(p.title, 150, W - 2 * x0, 100, f.font.tracking), lh = tSize * 1.04;
  const kS = 26, sS = 40;
  const dsc = tSize * 0.2, kH = p.kicker ? kS + 44 : 0, sH = p.subtitle ? dsc + 30 + sS * 1.1 : 0, tH = tSize * 0.74 + (lines.length - 1) * lh;
  const top = H / 2 - (kH + tH + sH) / 2;
  const out = exitU(ctx), lift = -14 * out, op = 1 - out;
  const line = (i: number) => { const u = inU(ctx, 80 + i * 110); return { dy: (1 - u) * 26 + lift, op: u * op }; };
  let s = "", i = 0;
  if (p.kicker) {
    const u = inU(ctx, 0), l = line(i++), y = top + kS * 0.74;
    s += `<rect x="${x0}" y="${fmt(y - kS * 0.37 - 2)}" width="${fmt(44 * u)}" height="4" rx="2" fill="${c.accent}" opacity="${fmt(op)}"/>`;
    s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">${text(x0 + 64, y, p.kicker.toUpperCase(), { size: kS, family: f.font.sans, weight: 600, fill: c.accent, ls: 0.16 })}</g>`;
  }
  { const l = line(i++), y = top + kH + tH;
    s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">${textLines(x0 - tSize * 0.05, y, lines, lh, { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, ls: f.font.tracking })}</g>`; }
  if (p.subtitle) {
    const l = line(i++), y = top + kH + tH + dsc + 30 + sS * 0.95;
    s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">${text(x0, y, p.subtitle, { size: sS, family: f.font.sans, weight: f.font.bodyWeight, fill: c.sub })}</g>`;
  }
  // footer hairline, drawn left → right
  const fu = ease.standard(prog(t, 200, 1100));
  s += `<rect x="${x0}" y="${fmt(H - 120)}" width="${fmt((W - 2 * x0) * fu)}" height="1.5" fill="${c.ink}" opacity="${fmt(0.12 * op)}"/>`;
  return frameSvg(ctx, s);
}

function modern(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, id = ctx.uid;
  const { lines, size: tSize } = fitLines(p.title, 210, 1640, 140, f.font.tracking), lh = tSize * 1.0;
  const pillS = 26, sS = 40;
  const dsc = tSize * 0.2, pillH = p.kicker ? pillS + 28 + 56 : 0, sH = p.subtitle ? dsc + 36 + sS : 0, tH = tSize * 0.72 + (lines.length - 1) * lh;
  const top = H / 2 - (pillH + tH + sH) / 2, cx = W / 2;
  const base = top + pillH + tH;
  const ou = prog(t, ctx.dur - f.motion.out, f.motion.out), sc = 1 + 0.06 * ease.power2In(ou), op = 1 - ease.inOut(ou);
  const defs = glowFilter(`${id}-glow`, 46, H) + glowFilter(`${id}-pglow`, 18, H);
  let s = "";
  if (p.kicker) {
    const k = p.kicker.toUpperCase(), kw = widthOf(k, pillS, 0.14) + 48, ph = pillS + 28, py = top, pcy = py + ph / 2;
    const ps = Math.max(0, spring(t, f.motion.spring ?? { stiffness: 220, damping: 18 }));
    s += `<g transform="translate(${fmt(cx)} ${fmt(pcy)}) scale(${fmt(ps)}) translate(${fmt(-cx)} ${fmt(-pcy)})" opacity="${fmt(clamp(t / 120))}">`
      + `<rect x="${fmt(cx - kw / 2)}" y="${fmt(py)}" width="${fmt(kw)}" height="${fmt(ph)}" rx="${fmt(ph / 2)}" fill="${c.accent}" opacity="0.5" filter="url(#${id}-pglow)"/>`
      + `<rect x="${fmt(cx - kw / 2)}" y="${fmt(py)}" width="${fmt(kw)}" height="${fmt(ph)}" rx="${fmt(ph / 2)}" fill="${c.accent}"/>`
      + text(cx + lsShift(pillS, 0.14), pcy + pillS * 0.36, k, { size: pillS, family: f.font.sans, weight: 800, fill: "#1E1B4B", ls: 0.14, anchor: "middle" }) + `</g>`;
  }
  const tOpts: TextOpts = { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, ls: f.font.tracking, anchor: "middle" };
  const tx = cx + lsShift(tSize, f.font.tracking);
  const gu = ease.standard(prog(t, 380, 700)); // glow under the settled title
  if (gu > 0) s += `<g opacity="${fmt(0.42 * gu)}" filter="url(#${id}-glow)">${textLines(tx, base, lines, lh, { ...tOpts, fill: c.accent })}</g>`;
  const rise = risingLines({ id: `${id}-m`, x: tx, last: base, lines, lh, size: tSize, opts: tOpts, t: t - 90, feel: f });
  s += rise.body;
  if (p.subtitle) {
    const u = ease.power3Out(prog(t, 380, 600));
    s += `<g transform="translate(0 ${fmt((1 - u) * 22)})" opacity="${fmt(u)}">${text(cx, base + dsc + 36 + sS * 0.9, p.subtitle, { size: sS, family: f.font.sans, weight: f.font.bodyWeight, fill: c.sub, anchor: "middle" })}</g>`;
  }
  const cy = H / 2;
  return frameSvg(ctx, `<g opacity="${fmt(op)}" transform="translate(${cx} ${fmt(cy)}) scale(${fmt(sc)}) translate(${-cx} ${fmt(-cy)})">${s}</g>`, defs + rise.def);
}

function professional(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, cx = W / 2;
  const { lines, size: tSize } = fitLines(p.title, 128, 1500, 96, 0, "medium"), lh = tSize * 1.12, kS = 22, sS = 38;
  const kH = p.kicker ? kS + 52 : 0, sH = p.subtitle ? 84 + sS : 0, tH = tSize * 0.7 + (lines.length - 1) * lh;
  const top = H / 2 - (kH + tH + sH) / 2;
  const op = 1 - exitU(ctx);
  const fade = (start: number) => { const u = ease.power3Out(prog(t, start, f.motion.in)); return { dy: (1 - u) * 12, op: u * op }; };
  let s = "";
  const fu = ease.power3Out(prog(t, 0, 1200)); // inset hairline frame
  s += `<rect x="56" y="56" width="${W - 112}" height="${fmt(H - 112)}" fill="none" stroke="${c.sub}" stroke-width="1" opacity="${fmt(0.22 * fu * op)}"/>`;
  if (p.kicker) {
    const k = p.kicker.toUpperCase(), l = fade(0), y = top + kS * 0.72, kw = widthOf(k, kS, 0.32, "medium");
    const hl = 90 * ease.power3Out(prog(t, 150, 1100)), gap = 28;
    s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">${text(cx + lsShift(kS, 0.32), y, k, { size: kS, family: f.font.sans, weight: 500, fill: c.accent, ls: 0.32, anchor: "middle" })}`
      + `<rect x="${fmt(cx - kw / 2 - gap - hl)}" y="${fmt(y - kS * 0.36)}" width="${fmt(hl)}" height="1" fill="${c.accent}" opacity="0.7"/>`
      + `<rect x="${fmt(cx + kw / 2 + gap)}" y="${fmt(y - kS * 0.36)}" width="${fmt(hl)}" height="1" fill="${c.accent}" opacity="0.7"/></g>`;
  }
  { const l = fade(180), y = top + kH + tH;
    s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">${textLines(cx, y, lines, lh, { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, anchor: "middle" })}</g>`; }
  if (p.subtitle) {
    const hu = ease.power3Out(prog(t, 420, 1000)), y = top + kH + tH + 52;
    s += `<rect x="${fmt(cx - 160 * hu)}" y="${fmt(y)}" width="${fmt(320 * hu)}" height="1" fill="${c.sub}" opacity="${fmt(0.6 * op)}"/>`;
    const l = fade(420);
    s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">${text(cx, y + 32 + sS * 0.8, p.subtitle, { size: sS, family: f.font.display, weight: 400, fill: c.sub, anchor: "middle", extra: `font-style="italic"` })}</g>`;
  }
  return frameSvg(ctx, s);
}


const DESIGNS = { clean, modern, professional };

const mod: CardModule = {
  kind: "title",
  type: "title-opening",
  label: "Opening title",
  defaults: { title: "Title", kicker: "", subtitle: "" },
  dur: 3500,
  render(params, ctx) {
    const p: P = { title: String(params.title ?? ""), kicker: String(params.kicker ?? ""), subtitle: String(params.subtitle ?? "") };
    return [bgLayer(ctx), { svg: (DESIGNS[ctx.feel.base] ?? modern)(p, ctx) }];
  },
};
export default mod;
