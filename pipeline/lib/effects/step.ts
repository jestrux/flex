// Numbered step dot (CleanShot X counter): a filled circle with a number, dropped onto a
// target with a little bounce and a bubble pop, leaving in reverse with a softer pop. Use a
// run of them for "step 1, 2, 3" moments; end each one when its step happens (the cursor
// clicks it), so the dots leave one by one as the cursor follows them.
import type { EffectModule } from "./types.ts";
import { clamp, ease, esc, fmt, shadow, TOKENS, calloutColor } from "./kit.ts";

const IN = 340, OUT = 240;

export default {
  type: "step", label: "Step dot", use: `Numbered dots when narration enumerates steps; end each dot when its step happens so they leave one by one.`, space: "page", hold: 3000, exit: OUT,
  defaults: { n: 1, size: 34, anchor: "center" },
  render(item, ctx) {
    const p = item.params, r = item.target.rect, pt = item.target.points?.[0];
    if (!r && !pt) return "";
    // where the dot sits: the target's centre, or a corner (badge-style)
    const off = p.offset ?? { dx: 0, dy: 0 }; // nudge the dot off what it would cover (CSS px)
    const R0 = (p.size ?? 34) / 2 + 6;
    const at0 = pt ?? (p.anchor === "right" ? { x: r!.x + r!.w + R0, y: r!.y + r!.h / 2 } : p.anchor === "left" ? { x: r!.x - R0, y: r!.y + r!.h / 2 } : p.anchor === "above" ? { x: r!.x + r!.w / 2, y: r!.y - R0 } : p.anchor === "tl" ? { x: r!.x + 6, y: r!.y + 6 } : p.anchor === "tr" ? { x: r!.x + r!.w - 6, y: r!.y + 6 } : { x: r!.x + r!.w / 2, y: r!.y + r!.h / 2 });
    const t = ctx.t, dur = ctx.dur;
    let s: number, dy: number, a: number;
    if (t <= dur) { const u = clamp(t / IN); s = ease.outBack(u); dy = (1 - ease.outCubic(u)) * -16; a = clamp(t / 90); }
    else { const u = clamp((t - dur) / OUT); s = 1 - ease.inOut(u) * 1.0 + Math.sin(u * Math.PI) * 0.08; dy = 0; a = 1 - ease.power2In(u); } // a tiny swell, then shrink away
    if (a <= 0 || s <= 0.01) return "";
    const at = { x: at0.x + off.dx, y: at0.y + off.dy };
    const c = ctx.toOut(at), R = ctx.px(p.size / 2) * s, id = `${ctx.uid}-s`;
    return `<g opacity="${fmt(a)}" transform="translate(0 ${fmt(ctx.px(dy))})"><defs>${shadow(id, { opacity: 0.35, radius: 6, dy: 2 }, ctx.px, ctx.out)}</defs>`
      + `<circle cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(R)}" fill="${p.color ?? calloutColor(ctx.feel, TOKENS.coral)}" stroke="#fff" stroke-width="${fmt(ctx.px(2.5) * s)}" filter="url(#${id})"/>`
      + `<text x="${fmt(c.x)}" y="${fmt(c.y + R * 0.36)}" text-anchor="middle" font-family="${["clean", "modern", "professional"].includes(ctx.feel.name) ? TOKENS.font : ctx.feel.font.sans.replace(/"/g, "'")}" font-weight="700" font-size="${fmt(R * 1.05)}" fill="#fff">${esc(String(p.n))}</text></g>`;
  },
  sounds: (item) => [{ at: 0, sound: "pop" }, { at: item.end - item.start, sound: "pop-out", db: -2 }],
} satisfies EffectModule;
