// Chapter card — between sections ("Act II — The pair"). Designs itself per feel:
//   clean        left-aligned act label + title, a hairline drawn across the frame with an accent lead
//   modern       a giant outlined numeral behind, lime act label, the title revealed by a masked wipe with a glowing lime edge
//   professional centred small-caps act over a hairline ◆ hairline ornament, serif title, slow fades
// Params: { title, act? }. "Act II" splits into a label ("Act") and a numeral ("II"). Pure function of t.
import type { CardModule, SceneCtx } from "./types.ts";
import { clamp, ease, fmt, prog, spring } from "../effects/kit.ts";
import { W, layoutH, bgLayer, frameSvg, exitU, inU, fitSize, fitLines, widthOf, text, lsShift, glowFilter, type TextOpts } from "./title-opening.ts";

type P = { title: string; act: string; label: string; num: string };

function clean(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, x0 = 168;
  const tSize = fitSize(p.title, 136, W - 2 * x0 - 200, f.font.tracking), aS = 28;
  const aH = p.act ? aS + 40 : 0, tH = tSize * 0.74;
  const top = H / 2 - (aH + tH + 64) / 2;
  const out = exitU(ctx), op = 1 - out, lift = -12 * out;
  const line = (i: number) => { const u = inU(ctx, 60 + i * 110); return { dy: (1 - u) * 24 + lift, op: u * op }; };
  let s = "", i = 0;
  if (p.act) {
    const l = line(i++);
    s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">${text(x0, top + aS * 0.74, p.act.toUpperCase(), { size: aS, family: f.font.sans, weight: 600, fill: c.accent, ls: 0.16 })}</g>`;
  }
  { const l = line(i++);
    s += `<g transform="translate(0 ${fmt(l.dy)})" opacity="${fmt(l.op)}">${text(x0 - tSize * 0.05, top + aH + tH, p.title, { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, ls: f.font.tracking })}</g>`; }
  // the rule: a hairline across the frame, with a short accent lead, drawn left → right
  const ry = top + aH + tH + 64, ru = ease.standard(prog(t, 150, 1000)), lu = ease.standard(prog(t, 100, 600));
  s += `<rect x="${x0}" y="${fmt(ry)}" width="${fmt((W - 2 * x0) * ru)}" height="1.5" fill="${c.ink}" opacity="${fmt(0.14 * op)}"/>`;
  s += `<rect x="${x0}" y="${fmt(ry - 1)}" width="${fmt(120 * lu)}" height="3.5" fill="${c.accent}" opacity="${fmt(op)}"/>`;
  if (p.num) { // the numeral, right-aligned at the rule's far end, arriving as the rule reaches it
    const nu = ease.standard(prog(t, 650, 500)), nS = 64;
    s += `<g opacity="${fmt(nu * op)}" transform="translate(0 ${fmt((1 - nu) * 14)})">${text(W - x0, ry - 26, arabic(p.num), { size: nS, family: f.font.display, weight: 300, fill: c.sub, anchor: "end", extra: `font-variant-numeric="tabular-nums"` })}</g>`;
  }
  return frameSvg(ctx, s);
}

function modern(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, id = ctx.uid, cx = W / 2, cy = H / 2;
  const sp = f.motion.spring ?? { stiffness: 220, damping: 18 };
  const tSize = fitSize(p.title, 190, 1600, f.font.tracking), aS = 30;
  const aH = p.act ? aS + 48 : 0, tH = tSize * 0.72;
  const top = cy - (aH + tH) / 2, base = top + aH + tH;
  const ou = prog(t, ctx.dur - f.motion.out, f.motion.out), sc = 1 + 0.06 * ease.power2In(ou), op = 1 - ease.inOut(ou);
  let s = "";
  // giant outlined numeral behind
  if (p.num) {
    const num = arabic(p.num), nS = fitSize(num, 820, 1600), nu = spring(t, { stiffness: 120, damping: 20 }), ns = 1.18 - 0.18 * nu;
    s += `<g opacity="${fmt(clamp(nu) * 0.9)}" transform="translate(${cx} ${fmt(cy)}) scale(${fmt(ns)}) translate(${-cx} ${fmt(-cy)})">`
      + text(cx, cy + nS * 0.36, num, { size: nS, family: f.font.display, weight: f.font.displayWeight, fill: "none", anchor: "middle", ls: f.font.tracking, extra: `stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="2.5"` }) + `</g>`;
  }
  if (p.act) {
    const u = ease.power3Out(prog(t, 0, 520)), ls = 0.3 + 0.5 * (1 - u);
    s += `<g opacity="${fmt(u)}">${text(cx + lsShift(aS, ls), top + aS * 0.74, p.act.toUpperCase(), { size: aS, family: f.font.sans, weight: 800, fill: c.accent, ls, anchor: "middle" })}</g>`;
  }
  // masked wipe: a clip grows left → right on a spring; a glowing lime edge leads it
  const tw = widthOf(p.title, tSize, f.font.tracking), x1 = cx - tw / 2 - 30, x2 = cx + tw / 2 + 30;
  const wu = clamp(spring(t - 120, sp), 0, 1.04), ex = x1 + (x2 - x1) * wu;
  const edgeOp = clamp((t - 120) / 80) * (1 - ease.standard(prog(t, 520, 300)));
  const defs = glowFilter(`${id}-glow`, 14, H) + glowFilter(`${id}-tglow`, 40, H)
    + `<clipPath id="${id}-w"><rect x="0" y="0" width="${fmt(Math.max(0, ex))}" height="${fmt(H)}"/></clipPath>`;
  const tOpts: TextOpts = { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, ls: f.font.tracking, anchor: "middle" };
  const tx = cx + lsShift(tSize, f.font.tracking);
  const gu = ease.standard(prog(t, 450, 600));
  if (gu > 0) s += `<g opacity="${fmt(0.38 * gu)}" filter="url(#${id}-tglow)">${text(tx, base, p.title, { ...tOpts, fill: c.accent })}</g>`;
  s += `<g clip-path="url(#${id}-w)"><g transform="translate(${fmt(-40 * (1 - clamp(wu)))} 0)">${text(tx, base, p.title, tOpts)}</g></g>`;
  if (edgeOp > 0.01) {
    const ey = base - tSize * 0.86, eh = tSize * 1.1;
    s += `<rect x="${fmt(ex - 5)}" y="${fmt(ey)}" width="10" height="${fmt(eh)}" rx="5" fill="${c.accent}" opacity="${fmt(edgeOp)}" filter="url(#${id}-glow)"/>`
      + `<rect x="${fmt(ex - 4)}" y="${fmt(ey)}" width="8" height="${fmt(eh)}" rx="4" fill="${c.accent}" opacity="${fmt(edgeOp)}"/>`;
  }
  return frameSvg(ctx, `<g opacity="${fmt(op)}" transform="translate(${cx} ${fmt(cy)}) scale(${fmt(sc)}) translate(${-cx} ${fmt(-cy)})">${s}</g>`, defs);
}

function professional(p: P, ctx: SceneCtx) {
  const f = ctx.feel, c = f.color, H = layoutH(ctx), t = ctx.t, cx = W / 2;
  const tSize = fitSize(p.title, 124, 1500, 0, "medium"), aS = 22;
  const aH = p.act ? aS + 30 + 62 : 0, tH = tSize * 0.7;
  const top = H / 2 - (aH + tH) / 2;
  const op = 1 - exitU(ctx);
  const fade = (start: number) => { const u = ease.power3Out(prog(t, start, f.motion.in)); return { dy: (1 - u) * 10, op: u * op }; };
  let s = "";
  if (p.act) {
    const l = fade(0), y = top + aS * 0.72;
    s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">${text(cx + lsShift(aS, 0.34), y, p.act.toUpperCase(), { size: aS, family: f.font.sans, weight: 500, fill: c.accent, ls: 0.34, anchor: "middle" })}</g>`;
  }
  // ornament: hairline ◆ hairline, growing out from the centre
  const oy = top + (p.act ? aS + 30 : -64), hu = ease.power3Out(prog(t, 120, 1100)), hl = 130 * hu, d = 5;
  const orn = `<rect x="${fmt(cx - 18 - hl)}" y="${fmt(oy)}" width="${fmt(hl)}" height="1" fill="${c.sub}"/>`
    + `<rect x="${fmt(cx + 18)}" y="${fmt(oy)}" width="${fmt(hl)}" height="1" fill="${c.sub}"/>`
    + `<path d="M${cx} ${fmt(oy + 0.5 - d)} L${cx + d} ${fmt(oy + 0.5)} L${cx} ${fmt(oy + 0.5 + d)} L${cx - d} ${fmt(oy + 0.5)} Z" fill="${c.accent}"/>`;
  s += `<g opacity="${fmt(0.8 * op * ease.power3Out(prog(t, 120, 700)))}">${orn}</g>`;
  { const l = fade(220);
    s += `<g opacity="${fmt(l.op)}" transform="translate(0 ${fmt(l.dy)})">${text(cx, top + aH + tH, p.title, { size: tSize, family: f.font.display, weight: f.font.displayWeight, fill: c.ink, anchor: "middle" })}</g>`; }
  return frameSvg(ctx, s);
}


const DESIGNS = { clean, modern, professional };

const mod: CardModule = {
  kind: "title",
  type: "title-chapter",
  label: "Chapter card",
  defaults: { title: "Chapter", act: "" },
  dur: 2500,
  render(params, ctx) {
    const act = String(params.act ?? "").trim(), parts = act.split(/\s+/).filter(Boolean);
    const p: P = { title: String(params.title ?? ""), act, label: parts.length > 1 ? parts.slice(0, -1).join(" ") : "", num: parts.length ? parts[parts.length - 1] : "" };
    return [bgLayer(ctx), { svg: (DESIGNS[ctx.feel.base] ?? modern)(p, ctx) }];
  },
};
export default mod;

/** "II" → "02", "3" → "03"; anything else unchanged */
export function arabic(n: string) {
  const R: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
  let v = 0;
  if (/^\d+$/.test(n)) v = Number(n);
  else if (/^[IVXL]+$/i.test(n)) { const u = n.toUpperCase(); for (let i = 0; i < u.length; i++) { const a = R[u[i]], b = R[u[i + 1]] ?? 0; v += a < b ? -a : a; } }
  return v > 0 ? String(v).padStart(2, "0") : n;
}
