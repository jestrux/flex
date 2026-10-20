// Confetti — Fuchi's two-cannon burst (OverlayStage.confetti) rebuilt as closed-form
// ballistics with a seeded random generator, so every render of a frame is identical.
// Cannons sit just off-screen left/right, 10% up from the bottom, aimed ±0.85 rad, so the
// arcs peak around the middle of the frame. Screen space (ignores the camera).
import type { EffectModule } from "./types.ts";
import { fmt, rng } from "./kit.ts";

const COLORS = ["#FF453A", "#FF9F0A", "#FFD60A", "#32D74B", "#6AC4DC", "#0A84FF", "#BF5AF2", "#FF375F"];
const SHAPES = ["rect", "streamer", "dot"] as const;
const EMIT = 0.35, RATE = 13 * 24; // s of emission, particles/s per cannon (13/s × 24 cell types)

type P = { tb: number; life: number; x0: number; y0: number; vx: number; vy: number; spin: number; rot0: number; flip: number; s: number; color: string; shape: (typeof SHAPES)[number] };
const cache = new Map<string, P[]>();
function particles(seed: string, W: number, H: number): P[] {
  const key = `${seed}|${W}|${H}`; let ps = cache.get(key); if (ps) return ps;
  const r = rng(seed); ps = [];
  const n = Math.round(EMIT * RATE);
  for (const side of [0, 1]) {
    const x0 = side ? W + 20 : -20, y0 = H - 0.1 * H;
    const base = side ? Math.PI - 0.85 : 0.85; // up-right / up-left (y-up angles)
    for (let i = 0; i < n; i++) {
      const ang = base + (r() - 0.5) * (Math.PI / 8);
      const v = (0.57 + (r() * 2 - 1) * 0.3) * W;
      ps.push({ tb: (i / n) * EMIT, life: 3.6 + (r() * 2 - 1) * 1.0, x0, y0, vx: Math.cos(ang) * v, vy: -Math.sin(ang) * v,
        spin: 6 + (r() * 2 - 1) * 8, rot0: r() * Math.PI * 2, flip: 4 + r() * 8, s: Math.max(0.2, 0.55 + (r() * 2 - 1) * 0.3),
        color: COLORS[Math.floor(r() * COLORS.length)], shape: SHAPES[Math.floor(r() * SHAPES.length)] });
    }
  }
  cache.set(key, ps); return ps;
}

export default {
  type: "confetti", label: "Confetti", use: `Celebrate a genuine finish (once per video, at most). Pairs with a cheer.`, space: "screen", hold: 300, exit: 4600,
  defaults: { scale: 1.6, cheer: false, sound: true }, // particle size multiplier (Fuchi's sizes are in points on a big display)
  render(item, ctx) {
    const W = ctx.view.w, H = ctx.view.h, t = ctx.t / 1000, k = Number(item.params.scale ?? 1.6);
    const parts: string[] = [];
    for (const p of particles(item.id, W, H)) {
      const a = t - p.tb; if (a < 0 || a > p.life) continue;
      const alpha = 1 - 0.32 * a; if (alpha <= 0) continue;
      const x = p.x0 + p.vx * a, y = p.y0 + p.vy * a + 0.5 * 560 * a * a;
      if (x < -40 || x > W + 40 || y > H + 40) continue;
      const o = ctx.toOut({ x, y }), sz = ctx.px(p.s * k);
      const rot = ((p.rot0 + p.spin * a) * 180) / Math.PI, fl = Math.cos(p.flip * a); // tumbling flip
      const [w, h] = p.shape === "rect" ? [11, 7] : p.shape === "streamer" ? [17, 5] : [7, 7];
      const shape = p.shape === "dot"
        ? `<circle r="${fmt(3.5 * sz)}" fill="${p.color}"/>`
        : `<rect x="${fmt((-w / 2) * sz)}" y="${fmt((-h / 2) * sz)}" width="${fmt(w * sz)}" height="${fmt(h * sz)}" rx="${fmt(2 * sz)}" fill="${p.color}"/>`;
      parts.push(`<g transform="translate(${fmt(o.x)} ${fmt(o.y)}) rotate(${fmt(rot)}) scale(1 ${fmt(Math.abs(fl) * 0.85 + 0.15)})" opacity="${fmt(alpha)}">${shape}</g>`);
    }
    return parts.join("");
  },
  // the pop of the cannons, then a short crowd cheer under it
  sounds: (item) => [...(item.params.sound === false ? [] : [{ at: 0, sound: "burst" }]), ...(item.params.cheer ? [{ at: 120, sound: "cheer", db: -2, dur: 3800, fade: 1400 }] : [])], // cheer is opt-in: its licence is unknown
} satisfies EffectModule;
