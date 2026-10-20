// circles-kinpay — a custom look for KinPay Circles teasers.
//
// DARK, lime-on-dark: a near-black after-hours stage, one lime pop per frame, Space-Grotesk-style
// display type. Cool, edgy, premium — it pairs with an Afro-fusion track. The look is built from
// KinPay's own brand tokens (the real app values, supplied by the brief; the app's public pages
// behind auth, so not re-sampled with look:tokens).
//
// Roles (DESIGN rule 2 — the accent appears once per frame, everything else neutral):
//   lime  #D5FC31  — THE accent: the title underline, the K brand mark. One per surface.
//   purple #7B27C9 — secondary: the stage's after-hours glow (atmosphere, never type).
//   ink   #F1F0F6  — foreground type;  sub #9E9CB2 — muted meta/helper.
//   card  #15151F on stage #0B0B14, hairline rgba(255,255,255,.08).
//
// Fonts — KinPay ships Space Grotesk / Inter / JetBrains Mono, none installed on this machine
// (fc-list: no Space Grotesk / Inter / JetBrains). The renderer is sharp/librsvg on fontconfig and
// can't use the app's self-hosted web fonts, so each is mapped to its closest installed face:
//   Space Grotesk (display) → SF Pro Display   (the nearest installed geometric-grotesque display)
//   Inter         (body)    → SF Pro Text       (the standard neutral UI sans substitute)
//   JetBrains Mono(numbers) → .SF NS Mono / Menlo
import { defineCard, defineEffect, defineLook } from "../lib/look.ts";
import { W, layoutH, bgLayer, frameSvg, inU, exitU, fitLines, text, textLines, fmt, ease, prog, stack, widthOf, shadow, clamp } from "../lib/kit.ts";
import type { SceneCtx, Ctx } from "../lib/kit.ts";

// KinPay brand tokens (the app's real values)
const LIME = "#D5FC31", INK = "#F1F0F6", SUB = "#9E9CB2";
const CARD = "#15151F", STAGE = "#0B0B14", LINE = "rgba(255,255,255,0.08)";
const DISPLAY = "SF Pro Display, Helvetica Neue, Arial, sans-serif"; // Space Grotesk →
const SANS = "SF Pro Text, Helvetica Neue, Arial, sans-serif";       // Inter →
const MONO = ".SF NS Mono, Menlo, monospace";                        // JetBrains Mono →

// one type scale for every card and overlay (layout px at 1920 wide): title · body · label · meta
const SIZE = { title: 170, titleMin: 118, body: 46, label: 30, meta: 28 };

/** the one motion: rise 28 px + fade with the look's ease, staggered by motion.stagger; the exit is
 *  the mirror. Opening/closing start ~85 % underway at t = 0, so a hard cut lands on a composed card
 *  (its thumbnail — DESIGN rule 7). A teaser cuts, so every card may be a first frame. */
function rowShow(ctx: SceneCtx, i: number, early: boolean) {
  const f = ctx.feel, st = f.motion.stagger;
  const u = inU(ctx, (early ? -f.motion.in * 0.85 : 0) + i * st), x = exitU(ctx);
  return { op: clamp(u * (1 - x)), dy: (1 - u) * 28 - x * 28 };
}
/** a slow 1.4 % push over the card's whole life — a teaser is never dead still (same on every card) */
const drift = (ctx: SceneCtx) => 1 + 0.014 * ease.inOut(prog(ctx.t, 0, ctx.dur));

/** the title card: kicker (mono meta) · title (display ink) · a lime underline (the accent) · sub.
 *  Opening and closing share it exactly (DESIGN rule 8 — same layout, same type). */
function titleCard(p: { kicker: string; title: string; sub: string }, ctx: SceneCtx, early: boolean) {
  const f = ctx.feel, H = layoutH(ctx);
  const fit = fitLines(p.title, SIZE.title, W - 360, SIZE.titleMin, f.font.tracking, f.font.displayWeight, f.font.display);
  const size = fit.size, lh = size * 1.05;

  const rows: { h: number; draw: (top: number) => string }[] = [];
  if (p.kicker) rows.push({ h: SIZE.label, draw: (top) =>
    text(W / 2, top + SIZE.label * 0.74, p.kicker.toUpperCase(), { size: SIZE.label, family: f.font.mono!, weight: 500, fill: f.color.sub, ls: 0.22, anchor: "middle" }) });
  rows.push({ h: 0.72 * size + (fit.lines.length - 1) * lh, draw: (top) =>
    textLines(W / 2, top + 0.72 * size + (fit.lines.length - 1) * lh, fit.lines, lh,
      { size, family: f.font.display, weight: f.font.displayWeight, fill: f.color.ink, ls: f.font.tracking, anchor: "middle" }) });
  // the lime underline: the look's single accent, a rounded bar centred under the title
  const barW = 108, barH = 9;
  rows.push({ h: barH, draw: (top) => `<rect x="${fmt(W / 2 - barW / 2)}" y="${fmt(top)}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="${f.color.accent}"/>` });
  if (p.sub) rows.push({ h: SIZE.body * 0.72, draw: (top) =>
    text(W / 2, top + SIZE.body * 0.72, p.sub, { size: SIZE.body, family: f.font.sans, weight: f.font.bodyWeight, fill: f.color.sub, anchor: "middle" }) });

  const gaps = rows.slice(1).map((r, i) => (r.h === barH ? 44 : rows[i].h === barH ? 40 : rows[i].h === SIZE.label ? 36 : 42));
  const tops = stack(H / 2, rows.map((r) => r.h), gaps);
  const k = drift(ctx);
  const body = rows.map((r, i) => { const s = rowShow(ctx, i, early); return `<g opacity="${fmt(s.op)}" transform="translate(0 ${fmt(s.dy)})">${r.draw(tops[i])}</g>`; }).join("");
  return [bgLayer(ctx), { svg: frameSvg(ctx, `<g transform="translate(${W / 2} ${fmt(H / 2)}) scale(${fmt(k)}) translate(${-W / 2} ${fmt(-H / 2)})">${body}</g>`) }];
}

/** the KinPay K mark: a lime tile with a dark K (the app's brand mark). s = tile size in the given space. */
function kMark(x: number, y: number, s: number, f: SceneCtx["feel"] | Ctx["feel"]) {
  const r = Math.round(s * 0.26);
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(s)}" height="${fmt(s)}" rx="${r}" fill="${f.color.accent}"/>`
    + text(x + s / 2, y + s * 0.71, "K", { size: s * 0.6, family: f.font.display, weight: 700, fill: STAGE, anchor: "middle" });
}

export default defineLook({
  name: "circles-kinpay",
  label: "KinPay Circles",
  source: "KinPay brand tokens (app values): lime #D5FC31, purple #7B27C9, dark canvas #0B0B14 / card #15151F / ink #F1F0F6; Space Grotesk / Inter / JetBrains Mono (not installed → SF Pro Display / SF Pro Text / .SF NS Mono)",
  tokens: {
    font: { sans: SANS, display: DISPLAY, displayWeight: 700, bodyWeight: 400, tracking: -0.02, mono: MONO },
    color: { ink: INK, sub: SUB, accent: LIME, card: CARD, cardInk: INK, callout: LIME, line: LINE, soft: "rgba(213,252,49,0.14)" },
    shadow: { color: "rgba(0,0,0,0.55)", blur: 64, dy: 24 },      // dark cards float on a near-black stage
    radius: 16,                                                    // KinPay's cards
    motion: { in: 520, out: 380, ease: "outCubic", stagger: 70 }, // confident, no bounce
    transition: { type: "cut", ms: 0 },                            // a teaser cuts
    // the after-hours stage: a quiet near-black gradient with a faint deep-purple glow (the secondary
    // brand colour as atmosphere — lime stays the only pop); the recording is the brightest thing on it
    canvas: { type: "gradient", angle: 160, stops: [["#0B0B14", 0], ["#0E0A1A", 1]], glow: "rgba(123,39,201,0.20)" },
  },
  cards: {
    opening: defineCard({
      kind: "title", label: "Opening", dur: 3400,
      defaults: { kicker: "", title: "KinPay Circles", sub: "" },
      sample: { kicker: "KinPay Circles", title: "Your circle, in your pocket.", sub: "Save together. Lend together." },
      render: (p, ctx) => titleCard(p, ctx, true),
    }),
    closing: defineCard({
      kind: "title", label: "Closing", dur: 3400,
      defaults: { kicker: "", title: "KinPay Circles", sub: "" },
      sample: { kicker: "KinPay Circles", title: "Join the circle.", sub: "Available now." },
      render: (p, ctx) => titleCard(p, ctx, true), // a cut can land here too → start underway (rule 7)
    }),
  },
  effects: {
    /** a lower third, bottom-left of the recording: a dark card with a lime K mark, a title and an
     *  optional helper line. The K mark is the frame's one lime. */
    lowerThird: defineEffect({
      label: "Lower third", hold: 3400, exit: 380, space: "screen",
      defaults: { title: "Lower third", sub: "" },
      sample: { title: "Chanda Mwale", sub: "Circle treasurer" },
      render(item, ctx) {
        const f = ctx.feel, k = ctx.out.w / W, P = item.params as { title: string; sub: string };
        const inn = ease.outCubic(prog(ctx.t, 0, f.motion.in)), out = ease.outCubic(prog(ctx.t, ctx.dur, f.motion.out));
        const u = clamp(inn * (1 - out)), dy = (1 - inn) * 24 + out * 24;
        const mark = 72, padX = 32, padY = 26, gap = 24;
        const tw = widthOf(P.title, SIZE.label, 0, 600, f.font.sans);
        const sw = P.sub ? widthOf(P.sub, SIZE.meta, 0, 400, f.font.sans) : 0;
        const textW = Math.max(tw, sw);
        const w = padX * 2 + mark + gap + textW, h = padY * 2 + mark;
        const win = ctx.window;
        const x = win.x / k + 48, y = (win.y + win.h) / k - 48 - h + dy;
        const mx = x + padX, my = y + (h - mark) / 2, txl = mx + mark + gap;
        const ty = P.sub ? y + padY + SIZE.label * 0.78 : y + h / 2 + SIZE.label * 0.34;
        const sh = shadow(`lt-${item.id}`, { opacity: 0.5, radius: 40, dy: 16, color: "rgb(0,0,0)" }, (n) => n, { w: W, h: ctx.out.h / k });
        return `<defs>${sh}</defs><g opacity="${fmt(u)}" transform="scale(${fmt(k)})">`
          + `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${f.radius}" fill="${f.color.card}" stroke="${f.color.line}" stroke-width="1.5" filter="url(#lt-${item.id})"/>`
          + kMark(mx, my, mark, f)
          + text(txl, ty, P.title, { size: SIZE.label, family: f.font.sans, weight: 600, fill: f.color.ink })
          + (P.sub ? text(txl, ty + SIZE.meta + 8, P.sub, { size: SIZE.meta, family: f.font.sans, weight: 400, fill: f.color.sub }) : "")
          + `</g>`;
      },
    }),
    /** a caption, bottom-centre: a dark pill with a lime leading bar (the accent) and one line of ink. */
    caption: defineEffect({
      label: "Caption", hold: 3000, exit: 380, space: "screen",
      defaults: { text: "Caption" },
      sample: { text: "Everyone pays in. Everyone gets a turn." },
      render(item, ctx) {
        const f = ctx.feel, k = ctx.out.w / W, P = item.params as { text: string };
        const inn = ease.outCubic(prog(ctx.t, 0, f.motion.in)), out = ease.outCubic(prog(ctx.t, ctx.dur, f.motion.out));
        const u = clamp(inn * (1 - out)), dy = (1 - inn) * 18 + out * 18;
        const size = SIZE.body, padX = 40, padY = 22, barW = 7, barGap = 24;
        const tw = widthOf(P.text, size, 0, 400, f.font.sans);
        const w = padX * 2 + barW + barGap + tw, h = padY * 2 + size * 0.82;
        const win = ctx.window;
        const x = win.x / k + win.w / k / 2 - w / 2, y = (win.y + win.h) / k - 64 - h + dy;
        const bx = x + padX, tx = bx + barW + barGap, ty = y + padY + size * 0.72;
        const sh = shadow(`cap-${item.id}`, { opacity: 0.5, radius: 36, dy: 14, color: "rgb(0,0,0)" }, (n) => n, { w: W, h: ctx.out.h / k });
        return `<defs>${sh}</defs><g opacity="${fmt(u)}" transform="scale(${fmt(k)})">`
          + `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${f.radius}" fill="${f.color.card}" stroke="${f.color.line}" stroke-width="1.5" filter="url(#cap-${item.id})"/>`
          + `<rect x="${fmt(bx)}" y="${fmt(y + padY)}" width="${barW}" height="${fmt(h - padY * 2)}" rx="${barW / 2}" fill="${f.color.accent}"/>`
          + text(tx, ty, P.text, { size, family: f.font.sans, weight: 400, fill: f.color.ink })
          + `</g>`;
      },
    }),
  },
});
