// Caption — "the line": a serif sentence near the bottom, revealed letter by letter.
// Port of Fuchi's the-line.html (GSAP SplitText):
//   600 4.2vw/1.25 serif, white, centred, max-width 82vw, 13vh above the bottom;
//   text-shadow 0 2px 18px rgba(0,0,0,.7) (+ 0 0 2px rgba(0,0,0,.5));
//   per char: y +0.6em→0, opacity 0→1, blur(6px)→0, 700ms power3.out, stagger 28ms;
//   out: whole line fades 800ms power2.in.
// params.size (vw, default 4.2) shrinks it for subtitle use.
//
// Lines are wrapped with kit.textWidth (an estimate, so wrapping can differ slightly from a
// browser). Within a line, glyph placement is exact: each animating char is drawn as the whole
// line (text-anchor middle) with every other char transparent, so the font engine does the
// kerning; settled chars share one element.
// Blur approximation: a per-char feGaussianBlur on every frame is costly in librsvg, so blur is
// quantised to 3 shared filters (≈4.5/3/1.5px at 0.25/0.5/0.75 of 6px) and applied only while a
// char's remaining blur is ≥0.75px; settled chars carry no blur filter.
import type { EffectModule } from "./types.ts";
import { clamp, ease, esc, fmt, prog, textWidth } from "./kit.ts";
import { TOKENS } from "./kit.ts";

const family = (f: string) => esc(f.split(",").map((s) => s.trim()).map((s) => (/\s/.test(s) ? `'${s}'` : s)).join(", "));

function masked(chars: string[], show: (i: number) => boolean) {
  let out = "", run = "", vis: boolean | null = null;
  const flush = () => { if (run) out += vis ? `<tspan>${esc(run)}</tspan>` : `<tspan fill="none">${esc(run)}</tspan>`; run = ""; };
  chars.forEach((c, i) => { const v = show(i); if (v !== vis) { flush(); vis = v; } run += c; });
  flush();
  return out;
}

// kit.textWidth is Helvetica-shaped; measured against the rendered Georgia 600 it runs ~4–6%
// narrow (e.g. 1122 est vs ~1170 actual CSS px at 4.2vw; 1163 vs ~1237 at 2.2vw), so pad it.
/** greedy word wrap with the kit's width estimate */
function wrap(text: string, size: number, maxW: number) {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, size, "bold", "serif") > maxW) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

const BLUR_LEVELS = [0.75, 0.5, 0.25]; // fraction of 6px

const mod: EffectModule = {
  type: "caption",
  label: "Caption", use: `The one-line takeaway, on a dark backing. Not for long sentences.`,
  defaults: { text: "The member sees exactly what the ledger holds.", size: 4.2, backing: true },
  hold: 5000,
  exit: 800,
  space: "screen",
  render(item, ctx) {
    const t = ctx.t;
    const text = String(item.params.text ?? "");
    if (!text.trim()) return "";
    const a = t <= ctx.dur ? 1 : 1 - ease.power2In(clamp((t - ctx.dur) / 800));
    if (a <= 0) return "";

    const vw = ctx.view.w / 100, vh = ctx.view.h / 100, p = ctx.px;
    const size = (Number(item.params.size) || 4.2) * vw, lh = 1.25 * size;
    const lines = wrap(text, size, 82 * vw);
    const blockTop = ctx.view.h - 13 * vh - lines.length * lh;
    const cx = ctx.toOut({ x: ctx.view.w / 2, y: 0 }).x;
    const attrs = `x="${fmt(cx)}" text-anchor="middle" font-family="${family(TOKENS.serif)}" font-size="${fmt(p(size))}" font-weight="600" fill="#fff" xml:space="preserve"`;
    const uid = ctx.uid;

    let body = "", k = 0; // k = SplitText char index (spaces aren't animated chars)
    let usedBlur = false;
    lines.forEach((line, li) => {
      const chars = [...line];
      const base = blockTop + li * lh + (lh - 1.14 * size) / 2 + 0.92 * size; // Georgia-ish ascent/descent
      const by = ctx.toOut({ x: 0, y: base }).y;
      const pr = chars.map((c) => (c === " " ? -1 : ease.power3Out(prog(t, k++ * 28, 700))));
      if (pr.some((v) => v >= 1)) body += `<text ${attrs} y="${fmt(by)}">${masked(chars, (i) => pr[i] >= 1)}</text>`;
      pr.forEach((v, i) => {
        if (v <= 0 || v >= 1) return;
        const rem = 1 - v; // remaining fraction of blur / rise
        const lvl = BLUR_LEVELS.findIndex((l) => rem >= l - 0.125);
        const f = lvl >= 0 && rem * 6 >= 0.75 ? ` filter="url(#${uid}-b${lvl})"` : "";
        if (f) usedBlur = true;
        body += `<text ${attrs} y="${fmt(by + p(0.6 * size * rem))}" opacity="${fmt(v)}"${f}>${masked(chars, (j) => j === i)}</text>`;
      });
    });
    if (!body) return "";

    const defs = `<filter id="${uid}-sh" x="-20%" y="-60%" width="140%" height="220%">`
      + `<feDropShadow dx="0" dy="${fmt(p(2))}" stdDeviation="${fmt(p(9))}" flood-color="#000" flood-opacity="0.7"/>`
      + `<feDropShadow dx="0" dy="0" stdDeviation="${fmt(p(1))}" flood-color="#000" flood-opacity="0.5"/></filter>`
      + (usedBlur ? BLUR_LEVELS.map((l, i) => `<filter id="${uid}-b${i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${fmt(p(6 * l))}"/></filter>`).join("") : "");
    // backing: a dark rounded panel behind the block, so the caption reads over any footage
    // (Fuchi's shadow-only caption was designed for a dark desktop; on light UI it vanishes)
    let back = "";
    if (item.params.backing !== false) {
      const wMax = Math.max(...lines.map((l) => textWidth(l, size, "bold", "serif")));
      const padX = 0.9 * size, padY = 0.45 * size;
      const tl = ctx.toOut({ x: ctx.view.w / 2 - wMax / 2 - padX, y: blockTop - padY });
      const w = p(wMax + 2 * padX), h = p(lines.length * lh + 2 * padY);
      const ba = ease.power3Out(clamp(t / 450)) * 0.84;
      back = `<rect x="${fmt(tl.x)}" y="${fmt(tl.y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(p(0.55 * size))}" fill="rgba(12,10,20,${fmt(ba)})"/>`;
    }
    return `<g opacity="${fmt(a)}"><defs>${defs}</defs>${back}<g filter="url(#${uid}-sh)">${body}</g></g>`;
  },
};
export default mod;
