// Coin rain — Fuchi's money rain (OverlayStage.rain, coins): a line emitter across the top
// drops gold and silver KinPay coins for `emit` seconds; they fall with gravity and leave
// off the bottom (no fade). Closed-form + seeded, so frames are deterministic. Screen space.
import type { EffectModule } from "./types.ts";
import { fmt, rng } from "./kit.ts";

const COINS = { gold: { face: "#EDBD40", rim: "#B8871F" }, silver: { face: "#D4D6DE", rim: "#9499A6" } };
type C = { tb: number; x: number; v: number; spin: number; rot0: number; s: number; kind: keyof typeof COINS; wob: number };
const cache = new Map<string, C[]>();
function coins(seed: string, W: number, emit: number): C[] {
  const key = `${seed}|${W}|${emit}`; let cs = cache.get(key); if (cs) return cs;
  const r = rng(seed), n = Math.round(emit * 16); cs = []; // 2 types × 8/s
  for (let i = 0; i < n; i++) cs.push({ tb: (i / n) * emit + r() * 0.05, x: r() * W, v: 150 + (r() * 2 - 1) * 80, spin: (r() * 2 - 1) * 2, rot0: r() * 360, s: 0.9 + (r() * 2 - 1) * 0.25, kind: i % 2 ? "silver" : "gold", wob: r() * 6 });
  cache.set(key, cs); return cs;
}
/** Ø30 coin centred on 0,0: face, rim 2.2, inner ring, heavy "K" */
const coin = (c: { face: string; rim: string }, squash: number) =>
  `<g transform="scale(${fmt(squash)} 1)"><circle r="13.9" fill="${c.face}" stroke="${c.rim}" stroke-width="2.2"/><circle r="9.5" fill="none" stroke="${c.rim}" stroke-opacity="0.6" stroke-width="1"/>`
  + `<text y="4.6" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial" font-weight="900" font-size="13" fill="${c.rim}">K</text></g>`;

export default {
  type: "coin-rain", label: "Coin rain", use: `Money moments (payout, repayment complete). Rare.`, space: "screen", hold: 6000, exit: 4000,
  defaults: { scale: 1.5 },
  render(item, ctx) {
    const W = ctx.view.w, H = ctx.view.h, t = ctx.t / 1000, k = Number(item.params.scale ?? 1.5);
    const emit = Math.max(0.5, (item.end - item.start) / 1000);
    const parts: string[] = [];
    for (const c of coins(item.id, W, emit)) {
      const a = t - c.tb; if (a < 0) continue;
      const y = -30 + c.v * a + 0.5 * 240 * a * a; if (y > H + 40) continue;
      const o = ctx.toOut({ x: c.x, y }), sz = ctx.px(c.s * k);
      const squash = Math.max(0.18, Math.abs(Math.cos(c.wob + a * 3.2))); // coins turn as they fall
      parts.push(`<g transform="translate(${fmt(o.x)} ${fmt(o.y)}) rotate(${fmt(c.rot0 + (c.spin * a * 180) / Math.PI)}) scale(${fmt(sz)})">${coin(COINS[c.kind], squash)}</g>`);
    }
    return parts.join("");
  },
  // Fuchi plays the coin pour for ~8 s then fades; here it lasts the rain plus the last coins' fall
  sounds: (item) => [{ at: 0, sound: "coins", dur: Math.min(9000, item.end - item.start + 2500), fade: 900 }],
} satisfies EffectModule;
