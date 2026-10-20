// Slate — an act-title band across the frame. Port of Fuchi's slate.html (GSAP):
//   band: full width, top 38%, height 24vh, rgba(10,10,14,.88), shadow 0 8px 40px rgba(0,0,0,.5);
//     grows scaleY 0→1 about its centre over 500ms power3.out (children scale with it, as in CSS).
//   act (params.act): 600 1.2vw, letter-spacing .34em, uppercase, orange; from letter-spacing 1em
//     + opacity 0 over 900ms power2.out after 200ms.
//   title (params.title): 700 3.4vw/1.1 serif, white; per character rise 0.5em + fade, 600ms
//     power3.out, stagger 30ms, after 350ms.
//   content is a centred column with a 1.2vh gap; out: band fades 600ms power2.in.
//
// Per-character placement: rather than trusting a width estimate for every glyph, each
// animating character is drawn as the WHOLE string (text-anchor middle) with every other
// character transparent, so the font engine lays out kerning/advances exactly and the char
// lands where it does in the settled string. Settled characters share one such element.
import type { EffectModule } from "./types.ts";
import { TOKENS, clamp, ease, esc, fmt, lerp, prog, shadow } from "./kit.ts";

const family = (f: string) => esc(f.split(",").map((s) => s.trim()).map((s) => (/\s/.test(s) ? `'${s}'` : s)).join(", "));

/** the string as tspans with only the chars in `show` visible */
function masked(chars: string[], show: (i: number) => boolean) {
  let out = "", run = "", vis: boolean | null = null;
  const flush = () => { if (run) out += vis ? `<tspan>${esc(run)}</tspan>` : `<tspan fill="none">${esc(run)}</tspan>`; run = ""; };
  chars.forEach((c, i) => { const v = show(i); if (v !== vis) { flush(); vis = v; } run += c; });
  flush();
  return out;
}

const mod: EffectModule = {
  type: "slate",
  label: "Slate", use: `A chapter break inside a take ('Act II — The pair'). Prefer a title-chapter card between takes.`,
  defaults: { title: "Title", act: "" },
  hold: 4000,
  exit: 600,
  space: "screen",
  render(item, ctx) {
    const t = ctx.t;
    const title = String(item.params.title ?? "");
    const act = String(item.params.act ?? "").toUpperCase();
    const s = ease.power3Out(prog(t, 0, 500));
    const a = t <= ctx.dur ? 1 : 1 - ease.power2In(clamp((t - ctx.dur) / 600));
    if (s <= 0.001 || a <= 0) return "";

    const vw = ctx.view.w / 100, vh = ctx.view.h / 100, p = ctx.px;
    const top = ctx.view.h * 0.38, bh = 24 * vh, cy = ctx.toOut({ x: 0, y: top + bh / 2 }).y;
    const o = ctx.toOut({ x: 0, y: top }), cx = ctx.toOut({ x: ctx.view.w / 2, y: 0 }).x;

    // content column: act line (normal line-height ≈ 1.2) + gap + title line (1.1), centred
    const actSize = 1.2 * vw, actLH = act ? 1.2 * actSize : 0;
    const tSize = 3.4 * vw, tLH = title ? 1.1 * tSize : 0;
    const gap = act && title ? 1.2 * vh : 0;
    const colTop = top + bh / 2 - (actLH + gap + tLH) / 2;
    // baselines: line top + half-leading + ascent (Helvetica Neue .95/.21; Georgia .92/.22)
    const actBase = colTop + (actLH - 1.16 * actSize) / 2 + 0.95 * actSize;
    const tBase = colTop + actLH + gap + (tLH - 1.14 * tSize) / 2 + 0.92 * tSize;

    const id = `${ctx.uid}-sh`;
    let body = `<rect x="0" y="${fmt(o.y)}" width="${fmt(ctx.out.w)}" height="${fmt(p(bh))}" fill="${TOKENS.band}" filter="url(#${id})"/>`;

    if (act) {
      const u = ease.power2Out(prog(t, 200, 900));
      if (u > 0) {
        const ls = lerp(1, 0.34, u) * actSize;
        // CSS letter-spacing trails the last letter too; shift by half of it so it centres the same way
        body += `<text x="${fmt(cx + p(ls) / 2)}" y="${fmt(ctx.toOut({ x: 0, y: actBase }).y)}" text-anchor="middle" font-family="${family(TOKENS.font)}" font-size="${fmt(p(actSize))}" font-weight="600" letter-spacing="${fmt(p(ls))}" fill="${TOKENS.orange}" opacity="${fmt(u)}">${esc(act)}</text>`;
      }
    }

    if (title) {
      const chars = [...title];
      const by = ctx.toOut({ x: 0, y: tBase }).y;
      const attrs = `x="${fmt(cx)}" text-anchor="middle" font-family="${family(TOKENS.serif)}" font-size="${fmt(p(tSize))}" font-weight="700" fill="#fff" xml:space="preserve"`;
      const pr = chars.map((_, i) => ease.power3Out(prog(t, 350 + i * 30, 600)));
      if (pr.some((v) => v >= 1)) body += `<text ${attrs} y="${fmt(by)}">${masked(chars, (i) => pr[i] >= 1)}</text>`;
      pr.forEach((v, i) => {
        if (v <= 0 || v >= 1 || chars[i] === " ") return;
        body += `<text ${attrs} y="${fmt(by + p(0.5 * tSize * (1 - v)))}" opacity="${fmt(v)}">${masked(chars, (j) => j === i)}</text>`;
      });
    }

    return `<g opacity="${fmt(a)}"><defs>${shadow(id, { opacity: 0.5, radius: 40, dy: 8 }, p, ctx.out)}</defs>`
      + `<g transform="translate(0 ${fmt(cy)}) scale(1 ${fmt(s)}) translate(0 ${fmt(-cy)})">${body}</g></g>`;
  },
};
export default mod;
