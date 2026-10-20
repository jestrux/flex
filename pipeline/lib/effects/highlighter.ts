// Highlighter — Fuchi PointerTheatre appendStroke / finalizeStroke, drawn in post from the
// recorded cursor path. Pen is down from item.start to item.end; the trail in that window
// is split into strokes wherever the cursor rests > 500ms (Fuchi's idle timer). Each stroke
// finalises 500ms after its last kept point, waits 400ms, then fades out over 1600ms.
// Pure: strokes are recomputed from the path every frame.
import type { EffectModule, Pt } from "./types.ts";
import { TOKENS, clamp, fmt, pathD } from "./kit.ts";

const IDLE = 500, WAIT = 400, FADE = 1600, JITTER = 3, MAX_POINTS = 700;

type Stroke = { pts: Pt[]; last: number };

/** split cursor samples (CSS px) into Fuchi strokes */
function strokes(samples: { t: number; x: number; y: number }[]): Stroke[] {
  const out: Stroke[] = [];
  let cur: Stroke | null = null;
  for (const s of samples) {
    if (cur) {
      const l = cur.pts[cur.pts.length - 1];
      if ((s.x - l.x) ** 2 + (s.y - l.y) ** 2 <= JITTER * JITTER) continue; // micro-jitter
      if (s.t - cur.last > IDLE) cur = null;                                  // rested → new stroke
    }
    if (!cur) { cur = { pts: [], last: s.t }; out.push(cur); }
    cur.pts.push({ x: s.x, y: s.y });
    cur.last = s.t;
    if (cur.pts.length > MAX_POINTS) cur.pts.splice(0, cur.pts.length - MAX_POINTS);
  }
  return out;
}

const mod: EffectModule = {
  type: "highlighter",
  label: "Highlighter", use: `Cursor mode: a marker trail while the pointer sweeps a region. Path mode (cam.drawMark): a small hand-drawn mark (wavy line) under 'this one'. Never as decoration.`,
  defaults: { width: 26, opacity: 0.55 },
  hold: 3000,
  exit: IDLE + WAIT + FADE,
  space: "page",
  render(item, ctx) {
    const start = item.start, penUp = Math.min(ctx.now, item.end);
    if (penUp < start) return "";
    const width = Number(item.params.width ?? 26), opacity = Number(item.params.opacity ?? 0.55);
    const [c0, c1, c2] = TOKENS.highlighter;
    const parts: string[] = [];
    // path mode: target.points is a drawn mark (drawn on over params.draw ms, held until end);
    // otherwise the pen follows the recorded cursor between start and end
    const path = item.target.points && item.target.points.length > 1 ? item.target.points : null;
    const draw = Number(item.params.draw ?? 550);
    const samples = path
      ? path.map((q, i) => ({ t: start + (i / (path.length - 1)) * draw, x: q.x, y: q.y })).filter((q) => q.t <= ctx.now)
      : ctx.cursorPath(start, penUp);
    strokes(samples).forEach((s, i) => {
      const fin = path ? Math.max(s.last + IDLE, item.end) - WAIT : s.last + IDLE; // finalised (idle timer fired / held mark)
      const a = ctx.now < fin ? 1 : 1 - clamp((ctx.now - fin - WAIT) / FADE);
      if (a <= 0) return;
      const p = s.pts.map((q) => ctx.toOut(q));
      if (p.length === 1) p.push({ x: p[0].x + 0.01, y: p[0].y }); // a dot still gets round caps
      const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
      const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      const id = `${ctx.uid}-g${i}`;
      // ramp across the stroke's own box, bottom-left → top-right on screen (Fuchi's y-up 0,0 → 1,1)
      parts.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(box.x0)}" y1="${fmt(box.y1)}" x2="${fmt(box.x1 + 0.01)}" y2="${fmt(box.y0)}">`
        + `<stop offset="0" stop-color="${c0}"/><stop offset="0.5" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`
        + `<path d="${pathD(p)}" fill="none" stroke="url(#${id})" stroke-width="${fmt(ctx.px(width))}" stroke-linecap="round" stroke-linejoin="round" opacity="${fmt(opacity * a)}"/>`,
      );
    });
    return parts.length ? `<g>${parts.join("")}</g>` : "";
  },
};
export default mod;
