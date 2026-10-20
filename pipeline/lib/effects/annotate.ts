// Annotate mark — Fuchi Annotator.markLayer: a single stroked mark (arrow with open barbs,
// line, ellipse, rounded rect, or pen polyline), round caps/joins, tight drop shadow.
// Fuchi snaps marks in (they're drawn live by hand); here the stroke draws on along its
// length over 500ms (`drawOn: false` snaps), then fades out over 800ms after the hold.
//
// Geometry from the target (viewport CSS px):
//   ellipse / rect: target.rect (inscribed, grown by `pad`), else the box of points[0..1]
//   line:  points[0]→points[1]; with only a rect, an underline 4px below the rect
//   arrow: points[0]→points[1]; with a rect or one point, the callout placement used by
//          the arrow effect (tip on the rect edge, tail up-right; `from`/`fromPoint` apply)
//   pen:   points (2+) as a polyline
import type { EffectModule, Pt, Rect } from "./types.ts";
import { arrowBarbs, arrowGeometry, clamp, drawOn, ease, fadeInOut, fmt, pathD, polyLen, prog, shadow, SHADOWS, TOKENS, calloutColor, type ArrowStyle } from "./kit.ts";
import { calloutEnds } from "./arrow.ts";

const DRAW_MS = 500, EXIT_MS = 800;

/** kit.shadow with a userSpaceOnUse region: the kit's objectBoundingBox region (-50%/200%)
 *  collapses to nothing for a perfectly horizontal or vertical path (zero-height/width bbox),
 *  which makes the whole stroke vanish. Drop this once the kit helper is fixed. */
type Shape = "arrow" | "line" | "ellipse" | "rect" | "pen";
const SHAPES: Shape[] = ["arrow", "line", "ellipse", "rect", "pen"];

const boxOf = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

/** ellipse path starting near the top (≈ -100°), clockwise in y-down, plus its perimeter */
function ellipsePath(c: Pt, rx: number, ry: number) {
  const a0 = (-100 * Math.PI) / 180;
  const at = (a: number) => ({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });
  const p0 = at(a0), p1 = at(a0 + Math.PI);
  const d = `M${fmt(p0.x)} ${fmt(p0.y)} A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(p1.x)} ${fmt(p1.y)} A${fmt(rx)} ${fmt(ry)} 0 0 1 ${fmt(p0.x)} ${fmt(p0.y)}`;
  const h = ((rx - ry) / (rx + ry)) ** 2;
  return { d, len: Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))) }; // Ramanujan
}

/** rounded rect path starting at the top-left, clockwise, plus its perimeter */
function rectPath(x: number, y: number, w: number, h: number, r0: number) {
  const r = Math.min(r0, w / 2, h / 2), f = fmt, A = `A${f(r)} ${f(r)} 0 0 1`;
  const d = `M${f(x + r)} ${f(y)} H${f(x + w - r)} ${A} ${f(x + w)} ${f(y + r)} V${f(y + h - r)} ${A} ${f(x + w - r)} ${f(y + h)}`
    + ` H${f(x + r)} ${A} ${f(x)} ${f(y + h - r)} V${f(y + r)} ${A} ${f(x + r)} ${f(y)}`;
  return { d, len: 2 * (w + h) - 8 * r + 2 * Math.PI * r };
}

const annotate: EffectModule = {
  type: "annotate",
  label: "Annotate mark", use: `Hand-drawn marks: rect/ellipse to circle a small thing, line to underline, arrow (barbs) for a quick pointer, pen for a freehand loop. Use when a callout arrow is too formal.`,
  defaults: { shape: "rect", thickness: 4, style: "straight", drawOn: true, pad: 0 },
  hold: 5000,
  exit: EXIT_MS,
  space: "page",
  render(item, ctx) {
    const p = item.params ?? {}, tg = item.target ?? {};
    const shape: Shape = SHAPES.includes(p.shape) ? p.shape : "rect";
    const a = fadeInOut(ctx.t, ctx.dur, 0, EXIT_MS);
    if (a <= 0) return "";
    const th = clamp(Number(p.thickness) || 4, 1, 16);
    const pts = tg.points ?? [];
    let d = "", len = 0;

    if (shape === "ellipse" || shape === "rect") {
      const r0 = tg.rect ?? (pts.length >= 2 ? boxOf(pts[0], pts[1]) : null); if (!r0) return "";
      const pad = Number(p.pad) || 0;
      const tl = ctx.toOut({ x: r0.x - pad, y: r0.y - pad }), w = ctx.px(r0.w + 2 * pad), h = ctx.px(r0.h + 2 * pad);
      if (w < 1 || h < 1) return "";
      ({ d, len } = shape === "ellipse"
        ? ellipsePath({ x: tl.x + w / 2, y: tl.y + h / 2 }, w / 2, h / 2)
        : rectPath(tl.x, tl.y, w, h, ctx.px(3)));
    } else if (shape === "pen") {
      if (pts.length < 2) return "";
      const q = pts.map((pt) => ctx.toOut(pt));
      d = pathD(q); len = polyLen(q);
    } else {
      let from: Pt, to: Pt;
      if (pts.length >= 2) { from = pts[0]; to = pts[1]; }
      else if (shape === "line") {
        const r = tg.rect; if (!r) return "";
        from = { x: r.x, y: r.y + r.h + 4 }; to = { x: r.x + r.w, y: r.y + r.h + 4 };
      } else {
        const e = calloutEnds(tg, { ...p, gap: p.gap ?? 4 }); if (!e) return "";
        from = e.tail; to = e.tip;
      }
      const f = ctx.toOut(from), t = ctx.toOut(to);
      if (Math.hypot(t.x - f.x, t.y - f.y) < 1) return "";
      if (shape === "line") { d = pathD([f, t]); len = polyLen([f, t]); }
      else {
        const style: ArrowStyle = p.style === "curved" || p.style === "wavy" ? p.style : "straight";
        const g = arrowGeometry(f, t, style, { headMax: 0, k: ctx.px(1), wavyFullLength: true });
        const shaft = style === "straight" ? [f, t] : g.shaft;
        const bl = ctx.px(Math.max(12, 3.5 * th));
        const [b1, b2] = arrowBarbs(t, g.dir, bl);
        d = `${pathD(shaft)} M${fmt(t.x)} ${fmt(t.y)} L${fmt(b1.x)} ${fmt(b1.y)} M${fmt(t.x)} ${fmt(t.y)} L${fmt(b2.x)} ${fmt(b2.y)}`;
        len = polyLen(shaft) + 2 * bl;
      }
    }

    const u = p.drawOn === false ? 1 : ease.standard(prog(ctx.t, 0, DRAW_MS));
    if (u <= 0.001) return "";
    const dash = u < 1 ? ` ${drawOn(len, u)}` : "";
    const id = `${ctx.uid}-sh`;
    return `<g opacity="${fmt(a)}"><defs>${shadow(id, SHADOWS.annotate, ctx.px, ctx.out)}</defs>`
      + `<path d="${d}" fill="none" stroke="${p.color ?? calloutColor(ctx.feel, TOKENS.red)}" stroke-width="${fmt(ctx.px(th))}" stroke-linecap="round" stroke-linejoin="round"${dash} filter="url(#${id})"/></g>`;
  },
};
export default annotate;
