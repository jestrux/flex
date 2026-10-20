// Closing card — the end card / call to action. Designs itself per feel:
//   clean        centred sans title with an accent tick above, subtitle, a white CTA pill with an arrow; gentle fade-rise
//   modern       the title springs up letter by letter out of a mask, glowing lime CTA pill pops in on a spring
//   professional centred serif inside the inset hairline frame (bookends the opening), italic subtitle, a hairline-boxed CTA
// Params: { title, subtitle?, cta? } (cta: e.g. a URL). Pure function of t.
import type { CardModule, SceneCtx } from "./types.ts";
import { clamp, ease, fmt, prog, spring } from "../effects/kit.ts";
import { W, layoutH, bgLayer, frameSvg, exitU, inU, fitSize, fitLines, widthOf, text, textLines, risingLines, lsShift, glowFilter, blockWipe, wipeRect, type TextOpts } from "./title-opening.ts";

type P = { title: string; subtitle: string; cta: string; arrow?: boolean }; // arrow: false drops the → after the cta
const ARROW = "→";

function clean(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, cx = W / 2;
  const { lines, size: tSize } = fitLines(p.title, 128, 1500, 96, f.font.tracking), lh = tSize * 1.04, sS = 38, cS = 30, ch = 76;
  const tickH = 52, dsc = tSize * 0.2, sH = p.subtitle ? dsc + 32 + sS : 0, cH = p.cta ? 64 + ch : 0, tH = tSize * 0.74 + (lines.length - 1) * lh;
  const top = H / 2 - (tickH + tH + sH + cH) / 2;
  const out = exitU(ctx), op = 1 - out, lift = -12 * out;
  const line = (i: number) => { const u = inU(ctx, 60 + i * 110); return { dy: (1 - u) * 24 + lift, op: u * op }; };
  let s = "";
  const ku = inU(ctx, 0); // accent tick
  s += `<rect x="${fmt(cx - 22 * ku)}" y="${fmt(top)}" width="${fmt(44 * ku)}" height="4" rx="2" fill="${c.accent}" opacity="${fmt(op)}"/>`;
  let y = top + tickH + tH, i = 0;
  { const l = line(i++); s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">${textLines(cx + lsShift(tSize, f.font.tracking), y, lines, lh, { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, ls: f.font.tracking, anchor: "middle" })}</g>`; }
  if (p.subtitle) { y += dsc + 32 + sS * 0.95; const l = line(i++); s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">${text(cx, y, p.subtitle, { size: sS, family: f.font.sans, weight: f.font.bodyWeight, fill: c.sub, anchor: "middle" })}</g>`; }
  if (p.cta) {
    const l = line(i++), label = p.arrow === false ? p.cta : `${p.cta}  ${ARROW}`, cw = widthOf(label, cS, 0, "medium") + 72, py = y + 64 - (p.subtitle ? 0 : 20);
    s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">`
      + `<rect x="${fmt(cx - cw / 2)}" y="${fmt(py + 3)}" width="${fmt(cw)}" height="${ch}" rx="${f.radius}" fill="${c.ink}" opacity="0.06"/>`
      + `<rect x="${fmt(cx - cw / 2)}" y="${fmt(py)}" width="${fmt(cw)}" height="${ch}" rx="${f.radius}" fill="${c.card}" stroke="${c.cardBorder ?? "none"}" stroke-width="1.5"/>`
      + text(cx, py + ch / 2 + cS * 0.36, label, { size: cS, family: f.font.sans, weight: 600, fill: c.accent, anchor: "middle" }) + `</g>`;
  }
  return frameSvg(ctx, s);
}

function modern(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, id = ctx.uid, cx = W / 2, cy = H / 2;
  const sp = f.motion.spring ?? { stiffness: 220, damping: 18 };
  const { lines, size: tSize } = fitLines(p.title, 190, 1640, 130, f.font.tracking), lh = tSize, sS = 40, cS = 36, ch = 88;
  const dsc = tSize * 0.2, sH = p.subtitle ? dsc + 36 + sS : 0, cH = p.cta ? 72 + ch : 0, tH = tSize * 0.72 + (lines.length - 1) * lh;
  const top = cy - (tH + sH + cH) / 2, base = top + tH;
  const ou = prog(t, ctx.dur - f.motion.out, f.motion.out), sc = 1 + 0.06 * ease.power2In(ou), op = 1 - ease.inOut(ou);
  const defs = glowFilter(`${id}-glow`, 44, H) + glowFilter(`${id}-pglow`, 26, H);
  const tOpts: TextOpts = { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, ls: f.font.tracking, anchor: "middle" };
  const tx = cx + lsShift(tSize, f.font.tracking);
  let s = "";
  const gu = ease.standard(prog(t, 380, 700));
  if (gu > 0) s += `<g opacity="${fmt(0.36 * gu)}" filter="url(#${id}-glow)">${textLines(tx, base, lines, lh, { ...tOpts, fill: c.accent })}</g>`;
  const rise = risingLines({ id: `${id}-m`, x: tx, last: base, lines, lh, size: tSize, opts: tOpts, t, feel: f });
  s += rise.body;
  let y = base;
  if (p.subtitle) {
    y += dsc + 36 + sS * 0.9; const u = ease.power3Out(prog(t, 320, 600));
    s += `<g transform="translate(0 ${fmt((1 - u) * 20)})" opacity="${fmt(u)}">${text(cx, y, p.subtitle, { size: sS, family: f.font.sans, weight: f.font.bodyWeight, fill: c.sub, anchor: "middle" })}</g>`;
  }
  if (p.cta) {
    const label = p.arrow === false ? p.cta : `${p.cta}  ${ARROW}`, cw = widthOf(label, cS) + 88, py = y + 72 - (p.subtitle ? 0 : 24), pcy = py + ch / 2;
    const ps = Math.max(0, spring(t - 480, sp)), pulse = 0.55 + 0.2 * Math.sin(Math.max(0, t - 1100) / 260);
    if (ps > 0) s += `<g transform="translate(${cx} ${fmt(pcy)}) scale(${fmt(ps)}) translate(${-cx} ${fmt(-pcy)})" opacity="${fmt(clamp((t - 480) / 120))}">`
      + `<rect x="${fmt(cx - cw / 2)}" y="${fmt(py)}" width="${fmt(cw)}" height="${ch}" rx="${ch / 2}" fill="${c.accent}" opacity="${fmt(pulse)}" filter="url(#${id}-pglow)"/>`
      + `<rect x="${fmt(cx - cw / 2)}" y="${fmt(py)}" width="${fmt(cw)}" height="${ch}" rx="${ch / 2}" fill="${c.accent}"/>`
      + text(cx, pcy + cS * 0.36, label, { size: cS, family: f.font.sans, weight: 700, fill: "#1E1B4B", anchor: "middle" }) + `</g>`;
  }
  return frameSvg(ctx, `<g opacity="${fmt(op)}" transform="translate(${cx} ${fmt(cy)}) scale(${fmt(sc)}) translate(${-cx} ${fmt(-cy)})">${s}</g>`, defs + rise.def);
}

function professional(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, cx = W / 2;
  const { lines, size: tSize } = fitLines(p.title, 124, 1500, 96, 0, "medium"), lh = tSize * 1.12, sS = 36, cS = 24, ch = 64;
  const sH = p.subtitle ? 96 + sS : 0, cH = p.cta ? 80 + ch : 0, tH = tSize * 0.7 + (lines.length - 1) * lh;
  const top = H / 2 - (tH + sH + cH) / 2;
  const op = 1 - exitU(ctx);
  const fade = (start: number) => { const u = ease.power3Out(prog(t, start, f.motion.in)); return { dy: (1 - u) * 10, op: u * op }; };
  let s = "";
  const fu = ease.power3Out(prog(t, 0, 1200)); // the opening's inset frame, as a bookend
  s += `<rect x="56" y="56" width="${W - 112}" height="${fmt(H - 112)}" fill="none" stroke="${c.sub}" stroke-width="1" opacity="${fmt(0.22 * fu * op)}"/>`;
  let y = top + tH;
  { const l = fade(0); s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">${textLines(cx, y, lines, lh, { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, anchor: "middle" })}</g>`; }
  const hy = y + 50, hu = ease.power3Out(prog(t, 250, 1100));
  s += `<rect x="${fmt(cx - 180 * hu)}" y="${fmt(hy)}" width="${fmt(360 * hu)}" height="1" fill="${c.sub}" opacity="${fmt(0.6 * op)}"/>`;
  y = hy;
  if (p.subtitle) {
    y += 46 + sS * 0.8; const l = fade(300);
    s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">${text(cx, y, p.subtitle, { size: sS, family: f.font.display, weight: 400, fill: c.sub, anchor: "middle", extra: `font-style="italic"` })}</g>`;
  }
  if (p.cta) {
    const l = fade(560), cw = widthOf(p.cta, cS, 0.14, "medium") + 96, py = y + (p.subtitle ? 64 : 46);
    s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">`
      + `<rect x="${fmt(cx - cw / 2)}" y="${fmt(py)}" width="${fmt(cw)}" height="${ch}" rx="${f.radius}" fill="none" stroke="${c.accent}" stroke-opacity="0.55" stroke-width="1"/>`
      + text(cx + lsShift(cS, 0.14), py + ch / 2 + cS * 0.36, p.cta, { size: cS, family: f.font.sans, weight: 500, fill: c.accent, ls: 0.14, anchor: "middle" }) + `</g>`;
  }
  return frameSvg(ctx, s);
}


const DESIGNS = { clean, modern, professional };

const mod: CardModule = {
  kind: "title",
  type: "title-closing",
  label: "Closing card",
  defaults: { title: "Thanks for watching", subtitle: "", cta: "" },
  dur: 4000,
  render(params, ctx) {
    const p: P = { title: String(params.title ?? ""), subtitle: String(params.subtitle ?? ""), cta: String(params.cta ?? ""), arrow: params.arrow !== false };
    return [bgLayer(ctx), { svg: (DESIGNS[ctx.feel.base] ?? modern)(p, ctx) }];
  },
};
export default mod;
