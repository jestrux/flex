// Cursor halo — Fuchi PointerTheatre dressLayer (default "spotlight" case): a Ø92 amber
// radial disc riding the cursor. Fuchi snaps it on/off; we add a 200ms fade in, 300ms out.
import type { Ctx, EffectModule, Pt } from "./types.ts";
import { fadeInOut, fmt, lerp } from "./kit.ts";

const IN = 200, OUT = 300;

/** cursor position (CSS px) at ctx.now, interpolated between the neighbouring samples */
export function cursorAt(ctx: Ctx): Pt | null {
  const before = ctx.cursorPath(ctx.now - 200, ctx.now);
  const prev = before.length ? before[before.length - 1] : ctx.cursorPath(-Infinity, ctx.now).at(-1);
  const next = ctx.cursorPath(ctx.now, ctx.now + 200)[0];
  if (prev && next && next.t > prev.t) {
    const u = (ctx.now - prev.t) / (next.t - prev.t);
    return { x: lerp(prev.x, next.x, u), y: lerp(prev.y, next.y, u) };
  }
  const p = prev ?? next;
  return p ? { x: p.x, y: p.y } : null;
}

const mod: EffectModule = {
  type: "halo",
  label: "Cursor halo", use: `A glow around the pointer while it rests on something the narration is talking about. Raise 'intensity' on light UIs.`,
  defaults: { size: 92, intensity: 1, color: "255,217,77" }, // intensity multiplies Fuchi's alphas (raise on light UIs)
  hold: 3000,
  exit: OUT,
  space: "page",
  render(item, ctx) {
    const a = fadeInOut(ctx.t, ctx.dur, IN, OUT);
    if (a <= 0) return "";
    const p = cursorAt(ctx);
    if (!p) return "";
    const c = ctx.toOut(p), r = ctx.px(Number(item.params.size ?? 92) / 2), id = `${ctx.uid}-halo`;
    const k = Math.max(0, Number(item.params.intensity ?? 1)), col = `rgb(${item.params.color ?? "255,217,77"})`;
    return `<defs><radialGradient id="${id}"><stop offset="0" stop-color="${col}" stop-opacity="${fmt(Math.min(1, 0.42 * k))}"/>`
      + `<stop offset="0.55" stop-color="${col}" stop-opacity="${fmt(Math.min(1, 0.2 * k))}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient></defs>`
      + `<circle cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(r)}" fill="url(#${id})" opacity="${fmt(a)}"/>`;
  },
};
export default mod;
