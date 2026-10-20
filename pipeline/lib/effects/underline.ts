// Underline — ported from Fuchi's underline.html: an orange marker stroke with a hand-drawn
// wobble, drawn on under the target over 650ms (cubic-bezier(.4,0,.2,1)), fades out 600ms.
import type { EffectModule, Pt } from "./types.ts";
import { SHADOWS, TOKENS, drawOn, ease, fadeInOut, fmt, polyLen, prog, shadow, calloutColor } from "./kit.ts";

const DRAW = 650, EXIT = 600;

const cubic = (p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt => {
  const m = 1 - t;
  return { x: m ** 3 * p0.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t ** 3 * p1.x, y: m ** 3 * p0.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t ** 3 * p1.y };
};

const underline: EffectModule = {
  type: "underline",
  label: "Underline", use: `Emphasise a number or phrase the narration says out loud (e.g. the amount on a card).`,
  defaults: { overhang: 8, gap: 6, width: 6 },
  hold: 4000,
  exit: EXIT,
  space: "page",
  render(item, ctx) {
    const r = item.target.rect;
    if (!r) return "";
    const p = item.params ?? {};
    const a = fadeInOut(ctx.t, ctx.dur, 0, EXIT);
    const u = ease.standard(prog(ctx.t, 0, DRAW));
    if (a <= 0 || u <= 0) return "";

    // Fuchi's box: the line runs x 20 → w+20 at baseline y 24, wobbling between y 16 and 30.
    // Here: x from (rect.x − overhang) for span w, baseline 4px below (bottom + gap), so the
    // wobble's highest point sits about `gap` below the rect. Points in CSS px, then to output.
    const oh = Number(p.overhang ?? 20), w = r.w + oh * 2, x0 = r.x - oh - 20;
    const by = r.y + r.h + Number(p.gap ?? 6) + 4;
    const P = (bx: number, yy: number) => ctx.toOut({ x: x0 + bx, y: by + (yy - 24) * 0.75 });
    const p0 = P(20, 24), c1 = P(w * 0.25, 16), c2 = P(w * 0.45, 30), p1 = P(w * 0.62, 22);
    const c4 = P(w * 0.9, 18), p2 = P(w + 20, 24);
    const c3 = { x: 2 * p1.x - c2.x, y: 2 * p1.y - c2.y }; // S reflects the previous control
    const d = `M${fmt(p0.x)} ${fmt(p0.y)}C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p1.x)} ${fmt(p1.y)}`
      + `S${fmt(c4.x)} ${fmt(c4.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
    const samples: Pt[] = [];
    for (let i = 0; i <= 32; i++) samples.push(cubic(p0, c1, c2, p1, i / 32));
    for (let i = 1; i <= 32; i++) samples.push(cubic(p1, c3, c4, p2, i / 32));
    const len = polyLen(samples) + 1;
    const sid = `${ctx.uid}-sh`;
    return `<g opacity="${fmt(a)}"><defs>${shadow(sid, SHADOWS.ink, ctx.px, ctx.out)}</defs>`
      + `<path d="${d}" fill="none" stroke="${p.color ?? calloutColor(ctx.feel, TOKENS.orange)}" stroke-width="${fmt(ctx.px(Number(p.width ?? 6)))}" stroke-linecap="round" ${drawOn(len, u)} filter="url(#${sid})"/></g>`;
  },
};
export default underline;
