// Callout arrow — Fuchi PointerTheatre.firePresetArrow + arrowLayer (CleanShot style):
// coral shaft on a white underlay, filled head with a white edge, soft drop shadow.
// Fuchi fades in 0.2s, holds, fades out 0.6s; we add an optional draw-on (shaft grows from
// the tail, head pops in when it arrives).
//
// Tip placement: with a rect target, the tip sits on the rect's edge where the ray from
// the rect's centre towards the tail leaves it, pushed `gap` px outward (so the head
// touches the element instead of covering it). `tip: "center"` points at the centre
// instead. A point target (points[0]) is the tip itself.
// Tail: tip + `from` ({dx,dy}, default (150,−150) = up-right, Fuchi's (+150,+150) y-up),
// or an absolute `fromPoint` {x,y}. All in viewport CSS px.
import type { EffectModule, Pt, Rect } from "./types.ts";
import { arrowGeometry, arrowHead, clamp, drawOn, ease, fadeInOut, fmt, pathD, polyLen, prog, shadow, SHADOWS, TOKENS, calloutColor, type ArrowStyle } from "./kit.ts";

const DRAW_MS = 450, HEAD_MS = 180, HEAD_AT = 0.82; // head pops when the shaft is ~82% drawn (eased)

/** kit.shadow with a userSpaceOnUse region: the kit's objectBoundingBox region (-50%/200%)
 *  collapses to nothing for a perfectly horizontal or vertical path (zero-height/width bbox),
 *  which makes the whole stroke vanish. Drop this once the kit helper is fixed. */

/** where the ray centre→dir leaves the rect */
function edgePoint(r: Rect, dir: Pt): Pt {
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const sx = dir.x ? r.w / 2 / Math.abs(dir.x) : Infinity, sy = dir.y ? r.h / 2 / Math.abs(dir.y) : Infinity;
  const s = Math.min(sx, sy);
  return Number.isFinite(s) ? { x: c.x + dir.x * s, y: c.y + dir.y * s } : c;
}

/** tip + tail in CSS px, or null when there's nothing to point at */
export function calloutEnds(target: { rect?: Rect; points?: Pt[] }, p: Record<string, any>): { tip: Pt; tail: Pt } | null {
  const off: Pt = { x: p.from?.dx ?? 150, y: p.from?.dy ?? -150 };
  const r = target.rect;
  if (!r) {
    const tip = target.points?.[0]; if (!tip) return null;
    return { tip, tail: p.fromPoint ?? { x: tip.x + off.x, y: tip.y + off.y } };
  }
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  if (p.tip === "center") return { tip: c, tail: p.fromPoint ?? { x: c.x + off.x, y: c.y + off.y } };
  const toward = p.fromPoint ? { x: p.fromPoint.x - c.x, y: p.fromPoint.y - c.y } : off;
  const n = Math.hypot(toward.x, toward.y) || 1, d = { x: toward.x / n, y: toward.y / n };
  const e = edgePoint(r, d), gap = p.gap ?? 4;
  const tip = { x: e.x + d.x * gap, y: e.y + d.y * gap };
  return { tip, tail: p.fromPoint ?? { x: tip.x + off.x, y: tip.y + off.y } };
}

const arrow: EffectModule = {
  type: "arrow",
  label: "Callout arrow", use: `Point at one control the viewer should look at or is about to click. Curved for most; straight for long reaches; wavy for playful. Not for regions (use spotlight).`,
  defaults: { style: "curved", drawOn: true, tip: "edge", gap: 4 },
  hold: 5000,
  exit: 600,
  space: "page",
  render(item, ctx) {
    const p = item.params ?? {};
    const ends = calloutEnds(item.target ?? {}, p); if (!ends) return "";
    const a = fadeInOut(ctx.t, ctx.dur, 200, 600);
    if (a <= 0) return "";
    const style: ArrowStyle = p.style === "straight" || p.style === "wavy" ? p.style : "curved";
    const from = ctx.toOut(ends.tail), to = ctx.toOut(ends.tip);
    const g = arrowGeometry(from, to, style, { headMax: ctx.px(36), k: ctx.px(1) });
    if (g.L < ctx.px(2)) return "";
    const color = p.color ?? calloutColor(ctx.feel, TOKENS.coral);

    // draw-on: shaft reveal u, head scale/opacity
    const draw = p.drawOn !== false;
    const u = draw ? ease.standard(prog(ctx.t, 0, DRAW_MS)) : 1;
    const hu = draw ? prog(ctx.t, DRAW_MS * HEAD_AT, HEAD_MS) : 1;
    const len = polyLen(g.shaft), d = pathD(g.shaft);
    const dash = u < 1 ? ` ${drawOn(len, u)}` : "";
    const shaftOn = u > 0.001;

    // head (Fuchi: neck = tip − endDir·h, width .85h)
    const head = arrowHead(to, g.dir, g.h);
    const hs = draw ? 0.6 + 0.4 * ease.outBack(hu) : 1;
    const nk = { x: to.x - g.dir.x * g.h, y: to.y - g.dir.y * g.h }; // grows out of the shaft end
    const headT = hs !== 1 ? ` transform="translate(${fmt(nk.x)} ${fmt(nk.y)}) scale(${fmt(hs)}) translate(${fmt(-nk.x)} ${fmt(-nk.y)})"` : "";
    const headOp = draw ? clamp(hu * 3) : 1;

    const id = `${ctx.uid}-sh`;
    const lw = (n: number) => fmt(ctx.px(n));
    return `<g opacity="${fmt(a)}"><defs>${shadow(id, SHADOWS.arrow, ctx.px, ctx.out)}</defs><g filter="url(#${id})">`
      + (shaftOn
        ? `<path d="${d}" fill="none" stroke="#fff" stroke-width="${lw(13)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`
        + `<path d="${d}" fill="none" stroke="${color}" stroke-width="${lw(8)}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`
        : "")
      + (headOp > 0
        ? `<path d="${pathD(head)} Z" fill="${color}" stroke="#fff" stroke-width="${lw(2.5)}" stroke-linejoin="round" opacity="${fmt(headOp)}"${headT}/>`
        : "")
      + `</g></g>`;
  },
};
export default arrow;
