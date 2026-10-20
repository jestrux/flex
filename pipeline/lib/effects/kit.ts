// Shared helpers for effect modules: Fuchi's tokens, easing, springs, a seeded random
// generator, draw-on dashes, shadow filters, arrow geometry, and a text width estimate.
// Lanes use these; add to this file only via the orchestrator.
import type { Pt } from "./types.ts";

// ── tokens (from Fuchi; no theme file there, constants were inline) ─────────────────────
export const TOKENS = {
  orange: "#FF9F0A",   // web "ink": underline, link, slate act label
  coral: "#FF453B",    // preset callout arrow
  red: "#FF5252",      // annotate default
  green: "#34C759",    // check
  blue: "#0A84FF",     // lower third accent bar
  white: "#FFFFFF",
  card: "rgba(0,0,0,0.82)",       // lower third, toast
  pill: "rgba(20,20,24,0.82)",    // odometer ticks
  band: "rgba(10,10,14,0.88)",    // slate band
  swatches: ["#FF5252", "#FF9F0A", "#FFD60A", "#32D74B", "#0A84FF", "#BF5AF2", "#FFFFFF"],
  highlighter: ["#FF5A8C", "#FF9E33", "#FFE040"],
  font: "Helvetica Neue, Helvetica, Arial, sans-serif",
  serif: "New York, Georgia, Times New Roman, serif",
};

// ── numbers ───────────────────────────────────────────────────────────────────────────
/** a callout's colour: built-in looks keep their own palette; a custom look uses its callout token (or accent) */
export const calloutColor = (feel: { name: string; color: { accent: string; callout?: string } }, builtin: string) =>
  ["clean", "modern", "professional"].includes(feel.name) ? builtin : feel.color.callout ?? feel.color.accent;
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** progress of t through [start, start+dur], clamped to 0..1 */
export const prog = (t: number, start: number, dur: number) => (dur <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / dur));
export const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

// ── easing ────────────────────────────────────────────────────────────────────────────
/** CSS cubic-bezier(x1,y1,x2,y2) as a function of 0..1 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u ** 2 * (1 - u) + u ** 3;
  const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u ** 2 * (1 - u) + u ** 3;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 30; i++) { u = (lo + hi) / 2; if (bx(u) < x) lo = u; else hi = u; }
    return by(u);
  };
}
export const ease = {
  linear: (u: number) => clamp(u),
  /** Fuchi's draw-on curve: cubic-bezier(.4,0,.2,1) */
  standard: cubicBezier(0.4, 0, 0.2, 1),
  /** Fuchi's Core Animation exit default */
  inOut: cubicBezier(0.42, 0, 0.58, 1),
  outBack: cubicBezier(0.34, 1.56, 0.64, 1),
  power2Out: (u: number) => 1 - (1 - clamp(u)) ** 3,
  power3Out: (u: number) => 1 - (1 - clamp(u)) ** 4,
  power2In: (u: number) => clamp(u) ** 3,
  outCubic: (u: number) => 1 - (1 - clamp(u)) ** 3,
};

/** analytic damped spring 0→1 (Core Animation / Framer style: mass, stiffness, damping), t in ms */
export function spring(t: number, o: { stiffness: number; damping: number; mass?: number }) {
  if (t <= 0) return 0;
  const m = o.mass ?? 1, w0 = Math.sqrt(o.stiffness / m), zeta = o.damping / (2 * Math.sqrt(o.stiffness * m)), s = t / 1000;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * s) * (Math.cos(wd * s) + ((zeta * w0) / wd) * Math.sin(wd * s));
  }
  return 1 - Math.exp(-w0 * s) * (1 + w0 * s); // critically/over-damped approximation
}

/** opacity for a fade-in of `inMs` at the start and a fade-out of `outMs` after `dur` */
export function fadeInOut(t: number, dur: number, inMs: number, outMs: number) {
  const a = inMs > 0 ? clamp(t / inMs) : 1;
  const b = t <= dur ? 1 : outMs > 0 ? 1 - clamp((t - dur) / outMs) : 0;
  return Math.min(a, b);
}

// ── deterministic randomness (particles must render identically every time) ───────────
export function rng(seed: number | string) {
  let h = typeof seed === "number" ? seed >>> 0 : [...seed].reduce((a, c) => (Math.imul(a ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
  return () => { h += 0x6d2b79f5; let x = h; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

// ── SVG helpers ───────────────────────────────────────────────────────────────────────
export const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const pts = (p: Pt[]) => p.map((q) => `${fmt(q.x)},${fmt(q.y)}`).join(" ");
export const pathD = (p: Pt[]) => p.map((q, i) => `${i ? "L" : "M"}${fmt(q.x)} ${fmt(q.y)}`).join(" ");

/** stroke-dasharray/offset attributes revealing `u` (0..1) of a path of length `len` */
export const drawOn = (len: number, u: number) => `stroke-dasharray="${fmt(len)} ${fmt(len)}" stroke-dashoffset="${fmt(len * (1 - clamp(u)))}"`;

/** length of a polyline */
export const polyLen = (p: Pt[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y) : 0), 0);

/**
 * A drop-shadow filter def. Fuchi's Core Animation shadows (opacity, radius, offset in pt,
 * y-down here) map to feGaussianBlur stdDeviation ≈ radius/2. Pass ctx.px for scaling and
 * ctx.out for the region. Use as: `<defs>${shadow(id, …)}</defs>` then `filter="url(#id)"`.
 * The region is the whole frame in user space: a bbox-relative region collapses to nothing
 * on perfectly horizontal/vertical strokes (zero-height/width bounding box).
 */
export function shadow(id: string, o: { opacity: number; radius: number; dy: number; dx?: number; color?: string }, px: (n: number) => number, out: { w: number; h: number } = { w: 1920, h: 1080 }) {
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${out.w}" height="${out.h}"><feDropShadow dx="${fmt(px(o.dx ?? 0))}" dy="${fmt(px(o.dy))}" stdDeviation="${fmt(px(o.radius) / 2)}" flood-color="${o.color ?? "#000"}" flood-opacity="${o.opacity}"/></filter>`; // color: a look's shadow tint (e.g. its --e2 colour)
}
/** Fuchi's shadow presets */
export const SHADOWS = {
  arrow: { opacity: 0.35, radius: 6, dy: 3 },
  annotate: { opacity: 0.35, radius: 2, dy: 1 },
  giantCursor: { opacity: 0.4, radius: 5, dy: 3 },
  focusDim: { opacity: 0.25, radius: 4, dy: 0 },
  focusOutline: { opacity: 0.5, radius: 4, dy: 0 },
  ink: { opacity: 0.45, radius: 6, dy: 2 },   // web drop-shadow(0 2px 6px rgba(0,0,0,.45))
};

// ── arrow geometry (Fuchi PointerTheatre.arrowLayer / Annotator.markLayer), y-down ─────
export type ArrowStyle = "straight" | "curved" | "wavy";
/**
 * Shaft points + head for an arrow from → to (output px). Returns the shaft as a polyline
 * (curved/wavy sampled), the neck point, and the unit direction of the head.
 *   head length h = min(headMax, 0.4L); curved bend = min(90·k, 0.25L) to the right-hand side;
 *   wavy: amp = min(11·k, 0.07L), waves = max(2, floor((L-h)/(70·k))), 48 samples.
 * `k` scales Fuchi's px constants (pass ctx.px(1)).
 */
export function arrowGeometry(from: Pt, to: Pt, style: ArrowStyle, o: { headMax: number; k: number; wavyFullLength?: boolean }) {
  const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
  const u = { x: dx / L, y: dy / L }, perp = { x: u.y, y: -u.x }; // y-down perpendicular (Fuchi's (-uy,ux) in y-up)
  const h = Math.min(o.headMax, 0.4 * L);
  if (style === "curved") {
    const bend = Math.min(90 * o.k, 0.25 * L);
    const c = { x: (from.x + to.x) / 2 + perp.x * bend, y: (from.y + to.y) / 2 + perp.y * bend };
    const tEnd = Math.max(0.5, 1 - h / L);
    const q = (t: number) => ({ x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * c.x + t * t * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * c.y + t * t * to.y });
    const shaft = Array.from({ length: 41 }, (_, i) => q((i / 40) * tEnd));
    const hd = { x: to.x - c.x, y: to.y - c.y }, hl = Math.hypot(hd.x, hd.y) || 1;
    return { shaft, neck: shaft[shaft.length - 1], dir: { x: hd.x / hl, y: hd.y / hl }, h, L };
  }
  if (style === "wavy") {
    const len = o.wavyFullLength ? L : L - h;
    const amp = Math.min(11 * o.k, 0.07 * L), waves = Math.max(2, Math.floor(len / (70 * o.k)));
    const shaft = Array.from({ length: 49 }, (_, i) => {
      const t = i / 48, off = Math.sin(t * waves * 2 * Math.PI) * amp * Math.sin(Math.PI * t);
      return { x: from.x + u.x * len * t + perp.x * off, y: from.y + u.y * len * t + perp.y * off };
    });
    return { shaft, neck: shaft[shaft.length - 1], dir: u, h, L };
  }
  const neck = { x: to.x - u.x * h, y: to.y - u.y * h };
  return { shaft: [from, neck], neck, dir: u, h, L };
}
/** filled triangular head (callout arrow): tip + two neck corners, width = 0.85h */
export function arrowHead(tip: Pt, dir: Pt, h: number): Pt[] {
  const p = { x: dir.y, y: -dir.x }, w = 0.85 * h, n = { x: tip.x - dir.x * h, y: tip.y - dir.y * h };
  return [tip, { x: n.x + p.x * w / 2, y: n.y + p.y * w / 2 }, { x: n.x - p.x * w / 2, y: n.y - p.y * w / 2 }];
}
/** open barbs (annotate arrow): two lines of length len at angle(dir reversed) ± 0.82π */
export function arrowBarbs(tip: Pt, dir: Pt, len: number): [Pt, Pt] {
  const a = Math.atan2(dir.y, dir.x);
  return [0.82, -0.82].map((k) => ({ x: tip.x + Math.cos(a + k * Math.PI) * len, y: tip.y + Math.sin(a + k * Math.PI) * len })) as [Pt, Pt];
}

// ── text width estimate (no DOM in Node) — Helvetica-ish average advance per char, in em ──
const NARROW = new Set("iljtfrI.,:;'!|() ".split(""));
const WIDE = new Set("mwMWOQGD@%".split(""));
/** pass a font family (or "serif") as `family`: serif faces (Georgia, New York) run ~5% wider */
export const isSerif = (family?: string) => !!family && /serif|georgia|new york|times/i.test(family) && !/sans-serif/i.test(family);
/** measured width factors per font stack (filled by lib/looks.ts for each look's fonts): real ÷ estimate */
export const FONT_SCALE: Record<string, { regular: number; bold: number }> = {};
export const isMono = (family?: string) => !!family && /mono|menlo|courier|consolas|monaco|code/i.test(family.split(",")[0]);
/** an estimate (no DOM in Node): Helvetica-shaped proportions, serif ×1.05, monospace exactly 0.6 em per char */
export function textWidth(s: string, size: number, w: "regular" | "medium" | "bold" | number = "regular", family?: string) {
  if (isMono(family)) return [...s].length * 0.6 * size;
  const weight = typeof w === "number" ? (w >= 650 ? "bold" : w >= 500 ? "medium" : "regular") : w;
  const fs = family ? FONT_SCALE[family] : undefined, fk = fs ? (weight === "bold" ? fs.bold : weight === "medium" ? (fs.bold + fs.regular) / 2 : fs.regular) : 1;
  return fk * estimate(s, size, weight, family);
}
function estimate(s: string, size: number, weight: "regular" | "medium" | "bold", family?: string) {
  const base = (weight === "bold" ? 0.6 : weight === "medium" ? 0.57 : 0.55) * (isSerif(family) ? 1.05 : 1);
  let em = 0;
  for (const ch of s) em += NARROW.has(ch) ? base * 0.5 : WIDE.has(ch) ? base * 1.45 : ch === ch.toUpperCase() && /[A-Z]/.test(ch) ? base * 1.18 : base;
  return em * size;
}
