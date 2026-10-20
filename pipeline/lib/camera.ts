// The camera as a pure function of time: camAt(edl, t) → { cx, cy, s } in viewport CSS px.
// Shared by the renderer and the editor preview so both show exactly the same move.
import type { Edl, Segment } from "./plan.ts";
import { worldOf } from "./canvas.ts";

export type CamState = { cx: number; cy: number; s: number };
const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

export function makeCamera(edl: Edl, W: number, H: number) {
  // with the canvas on, the camera's resting view is the whole stage (recording + padding);
  // s stays "viewport widths per frame width", so s = 1 fills the frame with the window
  const world = worldOf(edl.canvas, W, H);
  const ID: CamState = { cx: W / 2, cy: H / 2, s: W / world.w };
  const segs = edl.segments.filter((s) => s.enabled).sort((a, b) => a.start - b.start);
  const T = edl.transition;
  const mix = (a: CamState, b: CamState, u: number): CamState => {
    const e = ease(u);
    // scale moves in log space (feels even); centre follows linearly
    return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * e) };
  };
  const target = (g: Segment): CamState => ({ cx: g.cx, cy: g.cy, s: g.scale });
  const memo = new Map<number, CamState>();

  function at(t: number): CamState {
    let i = -1;
    for (let k = 0; k < segs.length && segs[k].start <= t; k++) i = k;
    if (i < 0) return ID;
    const g = segs[i];
    // where the camera was when this segment began (mid-transition, a previous hold, or wide)
    let from = memo.get(i);
    if (!from) { from = i === 0 ? ID : at(g.start - 0.001); memo.set(i, from); }
    const chained = from.s > ID.s + 0.001;
    const dur = g.inMs ?? (chained ? T.pan : T.in);
    if (t < g.start + dur && t <= g.end) return mix(from, target(g), (t - g.start) / dur);
    if (t <= g.end) return target(g);
    // a push cut short (the segment ended before it arrived) leaves from where it got to, not its target
    const reached = g.end < g.start + dur ? mix(from, target(g), (g.end - g.start) / dur) : target(g);
    return mix(reached, ID, (t - g.end) / (g.outMs ?? T.out));
  }
  /** the crop for a camera state (viewport CSS px, may extend into the padding), clamped to the world */
  function crop(c: CamState) {
    const w = W / c.s, h = H / c.s;
    return { x: Math.min(world.x + world.w - w, Math.max(world.x, c.cx - w / 2)), y: Math.min(world.y + world.h - h, Math.max(world.y, c.cy - h / 2)), w, h };
  }
  return { at, crop, world, rest: ID };
}
