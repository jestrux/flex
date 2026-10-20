// Focus mask — ported from Fuchi FocusMask.swift (render): a 0.55 black veil over the whole
// frame with the target cut out (even-odd), plus a thin white border; or "outline" = a bold
// white border alone. Fuchi snaps on/off and uses square corners; here the veil and border
// fade in/out and the hole eases in from slightly larger ("focus pull"). radius 0 = Fuchi-exact.
import type { EffectModule, Pt } from "./types.ts";
import { SHADOWS, clamp, ease, fmt, lerp, prog, shadow } from "./kit.ts";

const FADE_IN = 300, EXIT = 300, PULL = 450;

/** rounded-rect subpath (output px), clockwise; r clamped to half the short side */
function rrect(x: number, y: number, w: number, h: number, r: number) {
  r = clamp(r, 0, Math.min(w, h) / 2);
  if (r <= 0) return `M${fmt(x)} ${fmt(y)}H${fmt(x + w)}V${fmt(y + h)}H${fmt(x)}Z`;
  const a = (ex: number, ey: number) => `A${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(ex)} ${fmt(ey)}`;
  return `M${fmt(x + r)} ${fmt(y)}H${fmt(x + w - r)}${a(x + w, y + r)}V${fmt(y + h - r)}${a(x + w - r, y + h)}`
    + `H${fmt(x + r)}${a(x, y + h - r)}V${fmt(y + r)}${a(x + r, y)}Z`;
}

const spotlight: EffectModule = {
  type: "spotlight",
  label: "Focus mask", use: `Focus a region and push the rest back: dim for big regions (a sheet, a panel), outline for a row/control, blur for a frosted look. Not for a single small button (use arrow).`,
  defaults: { style: "dim", pad: 10, radius: 12, pull: 24 },
  hold: 3000,
  exit: EXIT,
  space: "page",
  render(item, ctx) {
    const r = item.target.rect;
    if (!r) return "";
    const p = item.params ?? {};
    const outline = p.style === "outline", blur = p.style === "blur";
    const tIn = ease.standard(prog(ctx.t, 0, FADE_IN));
    const tOut = ctx.t <= ctx.dur ? 1 : 1 - ease.standard(prog(ctx.t, ctx.dur, EXIT));
    const a = Math.min(tIn, tOut);
    if (a <= 0) return "";

    const pull = Number(p.pull ?? 24) * (1 - ease.standard(prog(ctx.t, 0, PULL)));
    const pad = Number(p.pad ?? 10) + pull;
    const tl: Pt = ctx.toOut({ x: r.x - pad, y: r.y - pad });
    const w = ctx.px(r.w + pad * 2), h = ctx.px(r.h + pad * 2);
    const rad = ctx.px(Number(p.radius ?? 12) + pull * 0.5);
    const hole = rrect(tl.x, tl.y, w, h, rad);
    const sid = `${ctx.uid}-sh`;

    // outline on light UIs: pass color (e.g. the feel's accent) and a wider width — white vanishes on white
    const border = outline
      ? { color: p.color ?? "rgba(255,255,255,0.95)", width: Number(p.width ?? 2.5), sh: SHADOWS.focusOutline }
      : { color: p.color ?? "rgba(255,255,255,0.6)", width: Number(p.width ?? 1.5), sh: SHADOWS.focusDim };
    // blur: the renderer blurs the footage outside the hole (pre); the veil is just a light tint
    const veil = outline ? "" : `<path d="M0 0H${ctx.out.w}V${ctx.out.h}H0Z ${hole}" fill="#000" fill-opacity="${blur ? 0.3 : 0.55}" fill-rule="evenodd"/>`;
    return `<g opacity="${fmt(a)}"><defs>${shadow(sid, border.sh, ctx.px, ctx.out)}</defs>${veil}`
      + `<path d="${hole}" fill="none" stroke="${border.color}" stroke-width="${fmt(ctx.px(border.width))}" filter="url(#${sid})"/></g>`;
  },
  // blur style (Fuchi's .hudWindow frosted mask): blur everything outside the hole
  pre(item, ctx) {
    const r = item.target.rect, p = item.params ?? {};
    if (!r || p.style !== "blur") return null;
    const tIn = ease.standard(prog(ctx.t, 0, FADE_IN)), tOut = ctx.t <= ctx.dur ? 1 : 1 - ease.standard(prog(ctx.t, ctx.dur, EXIT));
    const pull = Number(p.pull ?? 24) * (1 - ease.standard(prog(ctx.t, 0, PULL))), pad = Number(p.pad ?? 10) + pull;
    const tl = ctx.toOut({ x: r.x - pad, y: r.y - pad });
    return { blur: ctx.out.w / 1920 * Number(p.blur ?? 22), opacity: Math.min(tIn, tOut),
      hole: { x: tl.x, y: tl.y, w: ctx.px(r.w + pad * 2), h: ctx.px(r.h + pad * 2), r: ctx.px(Number(p.radius ?? 12) + pull * 0.5) } };
  },
};
export default spotlight;
