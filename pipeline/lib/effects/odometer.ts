// Odometer — Fuchi's money counter (assets/odometer.html; source lost, rebuilt from its
// constants): a big number springs to running totals as "+amount" tick pills arrive.
// Ticks fire at 900 + i·1300 ms; the value springs (stiffness 70, damping 16) to each running
// total, then to `to`. Number entrance: fade + scale .9→1 (spring 200/20); pills rise 26→0
// (spring 320/22). Screen space, top-centre, on a dark backing card (legible on light UIs).
import type { EffectModule } from "./types.ts";
import { clamp, esc, fmt, spring, textWidth, TOKENS } from "./kit.ts";

const FIRST = 900, GAP = 1300;
type Tick = { amount: number; date?: string };

export default {
  type: "odometer", label: "Odometer", use: `Show a number counting up to a real value (balance paid, people joined) with +amount pills.`, space: "screen", hold: 7000, exit: 700,
  defaults: { label: "Total", prefix: "$", from: 0, to: 0, ticks: [] as Tick[], locale: "en-US" },
  render(item, ctx) {
    const p = item.params, t = ctx.t, ticks: Tick[] = Array.isArray(p.ticks) ? p.ticks : [];
    const a = t <= ctx.dur ? 1 : 1 - clamp((t - ctx.dur) / 700);
    if (a <= 0) return "";
    // value = from + Σ steps, each easing in on its own spring
    const steps: { at: number; d: number }[] = []; let run = Number(p.from ?? 0);
    ticks.forEach((k, i) => { steps.push({ at: FIRST + i * GAP, d: k.amount }); run += k.amount; });
    const to = Number(p.to || run); if (to !== run) steps.push({ at: FIRST + ticks.length * GAP, d: to - run });
    const value = steps.reduce((v, s) => v + s.d * spring(t - s.at, { stiffness: 70, damping: 16 }), Number(p.from ?? 0));
    // "$2,500" but "ZMW 900": symbols hug the number, word prefixes get a space
    const pre = String(p.prefix ?? ""), sep = pre.length > 1 ? " " : "";
    const text = `${pre}${sep}${Math.round(value).toLocaleString(p.locale ?? "en-US")}`;
    const finalText = `${pre}${sep}${Math.round(to).toLocaleString(p.locale ?? "en-US")}`;

    const vw = ctx.view.w / 100, px = ctx.px, cx = ctx.view.w / 2;
    const numSize = 6 * vw, labSize = 1.1 * vw, pillSize = 1.05 * vw;
    const enter = spring(t, { stiffness: 200, damping: 20 }), sc = 0.9 + 0.1 * enter;
    const top = 0.3 * ctx.view.h - numSize * 0.9;
    // backing card sized to the widest the number gets
    const w = Math.max(textWidth(finalText, numSize, "bold") * 0.95, textWidth(String(p.label ?? ""), labSize, "bold") * 1.4) + 8 * vw;
    const pillRows = ticks.length ? 1.9 * pillSize + 1.2 * vw : 0;
    const h = numSize * 1.15 + labSize * 2.2 + pillRows + 2 * vw;
    const c = ctx.toOut({ x: cx, y: 0 }).x, o = (x: number, y: number) => ctx.toOut({ x, y });
    const card = o(cx - w / 2, top - 1.2 * vw);
    let svg = `<g opacity="${fmt(a * clamp(enter * 1.4))}"><rect x="${fmt(card.x)}" y="${fmt(card.y)}" width="${fmt(px(w))}" height="${fmt(px(h))}" rx="${fmt(px(1.4 * vw))}" fill="rgba(14,12,22,0.82)"/>`;
    const labY = o(0, top + labSize).y;
    svg += `<text x="${fmt(c)}" y="${fmt(labY)}" text-anchor="middle" font-family="${TOKENS.font}" font-weight="600" font-size="${fmt(px(labSize))}" letter-spacing="${fmt(px(0.18 * labSize))}" fill="rgba(255,255,255,0.85)">${esc(String(p.label ?? "").toUpperCase())}</text>`;
    const numY = top + labSize * 1.6 + numSize * 0.92;
    svg += `<g transform="translate(${fmt(c)} ${fmt(o(0, numY - numSize * 0.35).y)}) scale(${fmt(sc)}) translate(${fmt(-c)} ${fmt(-o(0, numY - numSize * 0.35).y)})">`
      + `<text x="${fmt(c)}" y="${fmt(o(0, numY).y)}" text-anchor="middle" font-family="${TOKENS.font}" font-weight="800" font-size="${fmt(px(numSize))}" style="font-variant-numeric: tabular-nums" fill="#fff">${esc(text)}</text></g>`;
    // tick pills, in a centred row under the number
    const shown = ticks.map((k, i) => ({ k, at: FIRST + i * GAP })).filter((x) => t >= x.at);
    if (shown.length) {
      const labels = shown.map((x) => `+${x.k.amount.toLocaleString(p.locale ?? "en-US")}${x.k.date ? ` · ${x.k.date}` : ""}`);
      const pw = labels.map((l) => textWidth(l, pillSize, "medium") + 2 * 18 * (vw / 14.4)), gap = 0.8 * vw;
      let x = cx - (pw.reduce((s, v) => s + v, 0) + gap * (pw.length - 1)) / 2;
      const py = numY + 1.2 * vw;
      shown.forEach((s, i) => {
        const e = spring(t - s.at, { stiffness: 320, damping: 22 }), dy = (1 - e) * 26, ps = 0.9 + 0.1 * e, ph = 1.9 * pillSize;
        const tl = o(x, py + dy), mid = o(x + pw[i] / 2, py + ph / 2 + dy);
        svg += `<g opacity="${fmt(clamp(e * 1.5))}" transform="translate(${fmt(mid.x)} ${fmt(mid.y)}) scale(${fmt(ps)}) translate(${fmt(-mid.x)} ${fmt(-mid.y)})">`
          + `<rect x="${fmt(tl.x)}" y="${fmt(tl.y)}" width="${fmt(px(pw[i]))}" height="${fmt(px(ph))}" rx="${fmt(px(ph / 2))}" fill="${TOKENS.pill}" stroke="rgba(255,255,255,0.14)"/>`
          + `<text x="${fmt(mid.x)}" y="${fmt(mid.y + px(pillSize * 0.36))}" text-anchor="middle" font-family="${TOKENS.font}" font-weight="600" font-size="${fmt(px(pillSize))}" fill="#fff">${esc(labels[i])}</text></g>`;
        x += pw[i] + gap;
      });
    }
    return svg + `</g>`;
  },
  sounds: (item) => (Array.isArray(item.params.ticks) ? item.params.ticks : []).map((_: unknown, i: number) => ({ at: FIRST + i * GAP, sound: "pop", db: -3 })),
} satisfies EffectModule;
