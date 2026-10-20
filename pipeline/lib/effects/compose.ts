// Compose the effects active at time `now` into one full-frame SVG (output px), or null.
// Shared by the renderer and the editor preview (browser-safe: no Node imports).
import { EFFECTS } from "./index.ts";
import type { Ctx, EffectItem, PreOp, Rect } from "./types.ts";
import { feelOf, type Feel } from "../feels.ts";

export type Cursor = { t: number; x: number; y: number }[];

/** the recording window on the output frame (output px, clipped) for camera crop o.crop */
const windowOf = (o: { crop: Rect; view: { w: number; h: number }; out: { w: number; h: number } }): Rect => {
  const wz = o.out.w / o.crop.w, wx = -o.crop.x * wz, wy = -o.crop.y * wz;
  const x = Math.max(0, wx), y = Math.max(0, wy);
  return { x, y, w: Math.min(o.out.w, wx + o.view.w * wz) - x, h: Math.min(o.out.h, wy + o.view.h * wz) - y };
};
type Opts = { crop: Rect; view: { w: number; h: number }; out: { w: number; h: number }; cursor: Cursor; feel?: Feel };
/** active items at `now` with their ctx */
function active(items: EffectItem[] | undefined, now: number, o: Opts) {
  const feel = o.feel ?? feelOf(), full: Rect = { x: 0, y: 0, w: o.view.w, h: o.view.h };
  const out: { it: EffectItem; ctx: Ctx }[] = [];
  const win = windowOf(o);
  for (const it of items ?? []) {
    if (!it.enabled) continue;
    const m = EFFECTS[it.type]; if (!m) continue;
    if (now < it.start || now > it.end + m.exit) continue;
    const hasTarget = !!(it.target?.rect || it.target?.points?.length);
    const screen = m.space === "screen" || (m.space === "auto" && !hasTarget);
    const crop = screen ? full : o.crop, z = o.out.w / crop.w;
    out.push({ it, ctx: { t: now - it.start, dur: it.end - it.start, now, out: o.out, view: o.view, crop, z,
      toOut: (p) => ({ x: (p.x - crop.x) * z, y: (p.y - crop.y) * z }), px: (n) => n * z,
      cursorPath: (from, to) => o.cursor.filter((c) => c.t >= from && c.t <= to), uid: `fx-${it.id}`, window: win, feel } });
  }
  return out;
}
/** frame ops (e.g. blur outside a hole) for the effects active at `now` */
export function composePre(items: EffectItem[] | undefined, now: number, o: Opts): PreOp[] {
  return active(items, now, o).map(({ it, ctx }) => EFFECTS[it.type].pre?.(it, ctx) ?? null).filter((x): x is PreOp => !!x && x.opacity > 0);
}

export function composeEffects(items: EffectItem[] | undefined, now: number, o: {
  crop: Rect; view: { w: number; h: number }; out: { w: number; h: number }; cursor: Cursor; feel?: Feel;
}): string | null {
  const feel = o.feel ?? feelOf();
  if (!items?.length) return null;
  const parts: string[] = [];
  const full: Rect = { x: 0, y: 0, w: o.view.w, h: o.view.h }, win = windowOf(o);
  for (const it of items) {
    if (!it.enabled) continue;
    const m = EFFECTS[it.type]; if (!m) continue;
    if (now < it.start || now > it.end + m.exit) continue;
    const hasTarget = !!(it.target?.rect || it.target?.points?.length);
    const screen = m.space === "screen" || (m.space === "auto" && !hasTarget);
    const crop = screen ? full : o.crop, z = o.out.w / crop.w;
    const ctx: Ctx = {
      t: now - it.start, dur: it.end - it.start, now, out: o.out, view: o.view, crop, z,
      toOut: (p) => ({ x: (p.x - crop.x) * z, y: (p.y - crop.y) * z }),
      px: (n) => n * z,
      cursorPath: (from, to) => o.cursor.filter((c) => c.t >= from && c.t <= to), window: win,
      uid: `fx-${it.id}`,
      feel,
    };
    try { const s = m.render(it, ctx); if (s) parts.push(s); }
    catch (e) { console.warn(`effect ${it.id} (${it.type}) failed:`, e); }
  }
  if (!parts.length) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.out.w}" height="${o.out.h}" viewBox="0 0 ${o.out.w} ${o.out.h}">${parts.join("")}</svg>`;
}
