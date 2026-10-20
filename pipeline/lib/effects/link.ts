// Link wire — ported from Fuchi's link.html: an orange arc between two points, lifted by
// min(160, dist/4), with end dots and optional labels. Draws on over 900ms
// (cubic-bezier(.4,0,.2,1)); dot a pops at the start, dot b when the stroke arrives; fade 600ms.
import type { EffectModule, Pt } from "./types.ts";
import { TOKENS, drawOn, ease, esc, fadeInOut, fmt, polyLen, prog, shadow, textWidth, calloutColor } from "./kit.ts";

const DRAW = 900, EXIT = 600, POP = 260;
const WIRE_SHADOW = { opacity: 0.5, radius: 8, dy: 2 };   // drop-shadow(0 2px 8px rgba(0,0,0,.5))
const TEXT_SHADOW = { opacity: 0.8, radius: 4, dy: 1 };   // drop-shadow(0 1px 4px rgba(0,0,0,.8))

const link: EffectModule = {
  type: "link",
  label: "Link wire", use: `Show that two things are connected (the link and the page it opens). Labels on pills.`,
  defaults: { labels: [], bend: 1, labelPill: true },
  hold: 4000,
  exit: EXIT,
  space: "page",
  render(item, ctx) {
    const P = item.target.points;
    if (!P || P.length < 2) return "";
    const p = item.params ?? {};
    const alpha = fadeInOut(ctx.t, ctx.dur, 0, EXIT);
    if (alpha <= 0) return "";
    const color = p.color ?? calloutColor(ctx.feel, TOKENS.orange);

    // geometry in CSS px (Fuchi's constants are CSS px), then to output
    const [A, B] = P;
    const bend = Number(p.bend ?? 1);
    const lift = Math.min(160, Math.hypot(B.x - A.x, B.y - A.y) * 0.25) * bend;
    const C = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 - lift };
    const a = ctx.toOut(A), b = ctx.toOut(B), c = ctx.toOut(C);
    const q = (t: number): Pt => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
    const len = polyLen(Array.from({ length: 65 }, (_, i) => q(i / 64))) + 1;

    const u = ease.standard(prog(ctx.t, 0, DRAW));
    const arrive = DRAW * 0.92; // the eased stroke is visually at b by here
    const popA = ease.outBack(prog(ctx.t, 0, POP)), popB = ease.outBack(prog(ctx.t, arrive, POP));
    const labels: string[] = Array.isArray(p.labels) ? p.labels : [];
    const ws = `${ctx.uid}-ws`, ts = `${ctx.uid}-ts`;

    const dot = (o: Pt, s: number, label?: string) => {
      if (s <= 0) return "";
      const op = Math.min(1, s * 1.5);
      const ly = o.y - ctx.px(20) - ctx.px(6) * (1 - Math.min(1, s));
      // labelPill: a dark capsule behind the label so it reads on light UIs (Fuchi drew on a dark desktop)
      const pill = label && p.labelPill !== false ? (() => { const w = ctx.px(textWidth(label, 15, "medium") + 22), h = ctx.px(26);
        return `<rect x="${fmt(o.x - w / 2)}" y="${fmt(ly - h * 0.72)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(h / 2)}" fill="${TOKENS.pill}" opacity="${fmt(op)}"/>`; })() : "";
      const tag = label ? pill + `<text x="${fmt(o.x)}" y="${fmt(ly)}" text-anchor="middle" font-family="${TOKENS.font}" font-weight="600" font-size="${fmt(ctx.px(15))}" fill="#fff" opacity="${fmt(op)}"${p.labelPill !== false ? "" : ` filter="url(#${ts})"`}>${esc(label)}</text>` : "";
      return `<circle cx="${fmt(o.x)}" cy="${fmt(o.y)}" r="${fmt(Math.max(0, ctx.px(9) * s))}" fill="${color}" filter="url(#${ws})"/>${tag}`;
    };

    return `<g opacity="${fmt(alpha)}"><defs>${shadow(ws, WIRE_SHADOW, ctx.px, ctx.out)}${shadow(ts, TEXT_SHADOW, ctx.px, ctx.out)}</defs>`
      + (u > 0 ? `<path d="M${fmt(a.x)} ${fmt(a.y)}Q${fmt(c.x)} ${fmt(c.y)} ${fmt(b.x)} ${fmt(b.y)}" fill="none" stroke="${color}" stroke-width="${fmt(ctx.px(5))}" stroke-linecap="round" ${drawOn(len, u)} filter="url(#${ws})"/>` : "")
      + dot(a, popA, labels[0]) + dot(b, popB, labels[1]) + `</g>`;
  },
};
export default link;
