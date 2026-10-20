// Lower third — a feel-aware preset family (name / topic / step), plus the faithful Fuchi card.
//
// params
//   variant  "name" (title = name, subtitle = role) | "topic" (one label, optional kicker)
//            | "step" (kicker "Step 3 of 3", title "Export") — default "name"
//   style    "feel" (default: designed per ctx.feel) | "fuchi" (the original Fuchi card)
//   title, subtitle, kicker
//
// style "feel" — one design per feel, authored in 1080p output px and scaled to the frame
// (screen space: ctx.px maps viewport CSS px → output px, so k = ctx.px(view.w / 1920)).
// Lower-left, title-safe: left edge 56, bottom edge 96 above the frame bottom (at 1080p).
//   clean         white card, hairline border, accent dot + kicker, fade + 14px rise (standard)
//   modern        frosted dark card, lime bar + lime pill kicker, heavy type, spring slide
//                 with staggered lines
//   professional  slim one-row navy band: small-caps kicker | serif title | small-caps role,
//                 hairline accent drawn along the top, slow fade + drift (power3Out)
//                 with a leading edge (outCubic)
// Step kickers like "Step 3 of 3" also get progress pips (clean, modern).
// Exit: opacity fade over feel.motion.out.
//
// style "fuchi" — port of Fuchi OverlayStage.lowerThird() (Core Animation, y-up bottom-left)
// to y-down SVG, unchanged:
//   card: h 86 with subtitle / 62 without; w = max(text width) + 64; bottom edge 96 above the
//   screen bottom; final left x 56; black 0.82, radius 14; accent bar 6 wide, radius 3, blue.
//   title bold 28 white, subtitle medium 16 white .75, both at x 26. Fuchi's CATextLayers
//   hang from the top of their frames: title frame top = 12 (both layouts), subtitle frame
//   top = 52; baselines below are frame top + the font's ascent (~0.95em, SF/Helvetica Neue).
//   in: spring on x (damping 18, stiffness 220, mass 1) from fully off-screen left to 56.
//   out: linear opacity fade 450ms (CABasicAnimation default timing).
import type { Ctx, EffectItem, EffectModule } from "./types.ts";
import type { Feel } from "../feels.ts";
import { TOKENS, clamp, ease, esc, fmt, lerp, spring, textWidth } from "./kit.ts";

const ASCENT = 0.95;
const family = (f: string) => esc(f.split(",").map((s) => s.trim()).map((s) => (/\s/.test(s) ? `'${s}'` : s)).join(", "));

// ── the faithful Fuchi card (style "fuchi") ──────────────────────────────────────────────
function renderFuchi(item: EffectItem, ctx: Ctx): string {
  const title = String(item.params.title ?? "");
  const subtitle = String(item.params.subtitle ?? "");
  if (!title && !subtitle) return "";
  const hasSub = subtitle.length > 0;

  const a = ctx.t <= ctx.dur ? 1 : 1 - clamp((ctx.t - ctx.dur) / 450);
  if (a <= 0) return "";

  const textW = Math.max(textWidth(title, 28, "bold"), hasSub ? textWidth(subtitle, 16, "medium") : 0);
  const w = textW + 64, h = hasSub ? 86 : 62;
  const x = lerp(-w, 56, spring(ctx.t, { damping: 18, stiffness: 220, mass: 1 }));
  const y = ctx.view.h - 96 - h;
  if (x + w <= 0) return "";

  const o = ctx.toOut({ x, y }), p = ctx.px;
  const font = family(TOKENS.font);
  const titleBase = 12 + 28 * ASCENT, subBase = 52 + 16 * ASCENT;
  return `<g opacity="${fmt(a)}" transform="translate(${fmt(o.x)} ${fmt(o.y)})">`
    + `<rect width="${fmt(p(w))}" height="${fmt(p(h))}" rx="${fmt(p(14))}" fill="${TOKENS.card}"/>`
    + `<rect width="${fmt(p(6))}" height="${fmt(p(h))}" rx="${fmt(p(3))}" fill="${TOKENS.blue}"/>`
    + `<text x="${fmt(p(26))}" y="${fmt(p(titleBase))}" font-family="${font}" font-size="${fmt(p(28))}" font-weight="700" fill="#fff">${esc(title)}</text>`
    + (hasSub ? `<text x="${fmt(p(26))}" y="${fmt(p(subBase))}" font-family="${font}" font-size="${fmt(p(16))}" font-weight="500" fill="#fff" fill-opacity="0.75">${esc(subtitle)}</text>` : "")
    + `</g>`;
}

// ── shared helpers for the feel designs (all lengths in 1080p px, inside a scaled group) ───
type Content = { kicker: string; title: string; sub: string; step: { n: number; of: number } | null };

function content(params: Record<string, any>): Content {
  const variant = String(params.variant ?? "name");
  const kicker = String(params.kicker ?? "").trim();
  const title = String(params.title ?? "").trim();
  const subtitle = String(params.subtitle ?? "").trim();
  const c: Content = variant === "topic"
    ? { kicker, title: title || subtitle, sub: "", step: null }
    : { kicker, title, sub: subtitle, step: null };
  if (variant === "step") {
    const m = /(\d+)\s*(?:of|\/)\s*(\d+)/i.exec(c.kicker);
    if (m) { const n = Number(m[1]), of = Number(m[2]); if (of >= 2 && of <= 8 && n >= 1 && n <= of) c.step = { n, of }; }
  }
  return c;
}

/** text width with weight, tracking (em) and serif adjustments over kit.textWidth */
function measure(s: string, size: number, weight: number, o: { tracking?: number; serif?: boolean } = {}) {
  let w = textWidth(s, size, weight >= 650 ? "bold" : weight >= 500 ? "medium" : "regular");
  if (weight >= 800) w *= 1.06;
  if (weight >= 900) w *= 1.04;
  if (o.serif) w *= 1.06;
  return w + (o.tracking ?? 0) * size * Math.max(0, [...s].length - 1);
}

type TextOpts = { size: number; weight: number; fill: string; font: string; tracking?: number; opacity?: number };
function text(x: number, y: number, s: string, o: TextOpts) {
  const ls = o.tracking ? ` letter-spacing="${fmt(o.tracking * o.size)}"` : "";
  const op = o.opacity !== undefined && o.opacity < 1 ? ` fill-opacity="${fmt(o.opacity)}"` : "";
  return `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${family(o.font)}" font-size="${fmt(o.size)}" font-weight="${o.weight}" fill="${o.fill}"${ls}${op}>${esc(s)}</text>`;
}

/** a soft drop shadow in local (scaled) units, region relative to the shape it's put on */
const softShadow = (id: string, opacity: number, blur: number, dy: number) =>
  `<filter id="${id}" x="-30%" y="-60%" width="160%" height="240%"><feDropShadow dx="0" dy="${fmt(dy)}" stdDeviation="${fmt(blur / 2)}" flood-color="#000" flood-opacity="${opacity}"/></filter>`;

type Layout = { body: string; w: number; h: number; dx: number; dy: number; opacity: number };
type Design = (c: Content, ctx: Ctx, f: Feel) => Layout;

// ── clean: white card, hairline border, accent dot, fade + rise ──────────────────────────
const clean: Design = (c, ctx, f) => {
  const id = ctx.uid;
  const padX = 28, padY = 22, dotGap = 14, dot = 9, indent = padX + dot + dotGap;
  const kSize = 15, tSize = 36, sSize = 21, kTrack = 0.1, tTrack = f.font.tracking;
  const kicker = c.kicker.toUpperCase();
  const tw = Math.max(
    c.kicker ? measure(kicker, kSize, 600, { tracking: kTrack }) + (c.step ? 14 + c.step.of * 22 : 0) : 0,
    c.title ? measure(c.title, tSize, f.font.displayWeight, { tracking: tTrack }) : 0,
    c.sub ? measure(c.sub, sSize, f.font.bodyWeight) : 0,
  );
  const w = indent + tw + padX + 4;
  let y = padY, body = "", firstMid = 0;
  if (c.kicker) {
    const base = y + kSize * 0.78;
    firstMid = base - kSize * 0.36;
    body += text(indent, base, kicker, { size: kSize, weight: 600, fill: f.color.accent, font: f.font.sans, tracking: kTrack });
    if (c.step) {
      const x0 = indent + measure(kicker, kSize, 600, { tracking: kTrack }) + 14;
      for (let i = 0; i < c.step.of; i++) body += `<rect x="${fmt(x0 + i * 22)}" y="${fmt(firstMid - 2.5)}" width="16" height="5" rx="2.5" fill="${i < c.step.n ? f.color.accent : f.color.cardBorder ?? "#E5E7EB"}"/>`;
    }
    y += kSize + 10;
  }
  if (c.title) {
    const base = y + tSize * 0.8;
    if (!c.kicker) firstMid = base - tSize * 0.36;
    body += text(indent, base, c.title, { size: tSize, weight: f.font.displayWeight, fill: f.color.cardInk, font: f.font.display, tracking: tTrack });
    y += tSize * 1.02;
  }
  if (c.sub) {
    y += 6;
    body += text(indent, y + sSize * 0.8, c.sub, { size: sSize, weight: f.font.bodyWeight, fill: f.color.sub, font: f.font.sans });
    y += sSize * 1.02;
  }
  const h = y + padY;
  const card = `<defs>${softShadow(`${id}-sh`, 0.16, 28, 10)}</defs>`
    + `<rect width="${fmt(w)}" height="${fmt(h)}" rx="${f.radius}" fill="${f.color.card}" filter="url(#${id}-sh)"/>`
    + `<rect x="0.5" y="0.5" width="${fmt(w - 1)}" height="${fmt(h - 1)}" rx="${f.radius}" fill="none" stroke="${f.color.cardBorder ?? "rgba(0,0,0,0.1)"}" stroke-width="1"/>`
    + `<circle cx="${fmt(padX + dot / 2)}" cy="${fmt(firstMid)}" r="${fmt(dot / 2)}" fill="${f.color.accent}"/>`;
  const u = ease.standard(clamp(ctx.t / f.motion.in));
  return { body: card + body, w, h, dx: 0, dy: (1 - u) * 14, opacity: u };
};

// ── modern: frosted dark card, lime bar + pill, heavy type, spring slide + stagger ───────
const modern: Design = (c, ctx, f) => {
  const id = ctx.uid, sp = f.motion.spring ?? { stiffness: 220, damping: 18 };
  const padL = 40, padR = 32, padY = 24, bar = 5;
  const pSize = 14, pTrack = 0.08, pH = 30, pPad = 14, tSize = 42, sSize = 22, tTrack = f.font.tracking;
  const kicker = c.kicker.toUpperCase();
  const pillW = c.kicker ? measure(kicker, pSize, 800, { tracking: pTrack }) + pPad * 2 : 0;
  const pipsW = c.step ? 14 + c.step.of * 16 : 0;
  const tw = Math.max(
    pillW + pipsW,
    c.title ? measure(c.title, tSize, f.font.displayWeight, { tracking: tTrack }) : 0,
    c.sub ? measure(c.sub, sSize, f.font.bodyWeight) : 0,
  );
  const w = padL + tw + padR;
  const stagger = Math.max(60, f.motion.stagger * 2.5);
  const line = (i: number, inner: string) => {
    const t0 = ctx.t - 90 - i * stagger, s = spring(t0, sp);
    return `<g opacity="${fmt(clamp(t0 / 180))}" transform="translate(${fmt((1 - s) * -28)} 0)">${inner}</g>`;
  };
  let y = padY, body = "", li = 0;
  if (c.kicker) {
    let k = `<rect x="${padL}" y="${fmt(y)}" width="${fmt(pillW)}" height="${pH}" rx="${pH / 2}" fill="${f.color.accent}"/>`
      + text(padL + pPad, y + pH / 2 + pSize * 0.36, kicker, { size: pSize, weight: 800, fill: "#140C2C", font: f.font.sans, tracking: pTrack });
    if (c.step) {
      const x0 = padL + pillW + 14;
      for (let i = 0; i < c.step.of; i++) k += `<circle cx="${fmt(x0 + i * 16 + 5)}" cy="${fmt(y + pH / 2)}" r="5" fill="${i < c.step.n ? f.color.accent : "rgba(255,255,255,0.22)"}"/>`;
    }
    body += line(li++, k);
    y += pH + 12;
  }
  const textTop = y;
  if (c.title) {
    body += line(li++, text(padL, y + tSize * 0.78, c.title, { size: tSize, weight: f.font.displayWeight, fill: f.color.cardInk, font: f.font.display, tracking: tTrack }));
    y += tSize * 0.98;
  }
  if (c.sub) {
    y += 6;
    body += line(li++, text(padL, y + sSize * 0.8, c.sub, { size: sSize, weight: f.font.bodyWeight, fill: f.color.sub, font: f.font.sans }));
    y += sSize * 1.02;
  }
  const h = y + padY;
  const r = f.radius;
  const card = `<defs>${softShadow(`${id}-sh`, 0.38, 40, 16)}`
    + `<linearGradient id="${id}-gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.13"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.02"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
    + `<rect width="${fmt(w)}" height="${fmt(h)}" rx="${r}" fill="${f.color.card}" filter="url(#${id}-sh)"/>`
    + `<rect width="${fmt(w)}" height="${fmt(h)}" rx="${r}" fill="url(#${id}-gl)"/>`
    + `<rect x="0.75" y="0.75" width="${fmt(w - 1.5)}" height="${fmt(h - 1.5)}" rx="${r}" fill="none" stroke="${f.color.cardBorder ?? "rgba(255,255,255,0.14)"}" stroke-width="1.5"/>`
    + `<rect x="18" y="${fmt(textTop + 4)}" width="${bar}" height="${fmt(Math.max(8, y - textTop - 8))}" rx="${bar / 2}" fill="${f.color.accent}"/>`;
  const s = spring(ctx.t, sp);
  return { body: card + body, w, h, dx: lerp(-(w + 56 + 40), 0, s), dy: 0, opacity: clamp(ctx.t / 120) };
};

// ── professional: slim navy band, serif title, small-caps, hairline accent, slow fade ────
const professional: Design = (c, ctx, f) => {
  const id = ctx.uid;
  const h = 64, padX = 28, gap = 20;
  const scSize = 15, scTrack = 0.16, tSize = 30;
  const border = f.color.cardBorder ?? "rgba(148,163,184,0.25)";
  const parts: { kind: "sc" | "title"; s: string; w: number }[] = [];
  const sc = (s: string) => ({ kind: "sc" as const, s: s.toUpperCase(), w: measure(s.toUpperCase(), scSize, 500, { tracking: scTrack }) });
  if (c.kicker) parts.push(sc(c.kicker));
  if (c.title) parts.push({ kind: "title", s: c.title, w: measure(c.title, tSize, f.font.displayWeight, { serif: true }) });
  if (c.sub) parts.push(sc(c.sub));
  let x = padX, body = "";
  parts.forEach((p, i) => {
    if (i) { body += `<rect x="${fmt(x + gap)}" y="${fmt(h / 2 - 11)}" width="1" height="22" fill="${border}"/>`; x += gap * 2 + 1; }
    body += p.kind === "title"
      ? text(x, h / 2 + tSize * 0.34, p.s, { size: tSize, weight: f.font.displayWeight, fill: f.color.cardInk, font: f.font.display })
      : text(x, h / 2 + scSize * 0.36, p.s, { size: scSize, weight: 500, fill: f.color.sub, font: f.font.sans, tracking: scTrack });
    x += p.w;
  });
  const w = x + padX;
  const u = ease.power3Out(clamp(ctx.t / f.motion.in));
  const line = ease.power3Out(clamp((ctx.t - 150) / (f.motion.in * 1.4)));
  const card = `<defs>${softShadow(`${id}-sh`, 0.3, 24, 8)}<clipPath id="${id}-cl"><rect width="${fmt(w)}" height="${h}" rx="${f.radius}"/></clipPath></defs>`
    + `<rect width="${fmt(w)}" height="${h}" rx="${f.radius}" fill="${f.color.card}" filter="url(#${id}-sh)"/>`
    + `<rect x="0.5" y="0.5" width="${fmt(w - 1)}" height="${h - 1}" rx="${f.radius}" fill="none" stroke="${border}" stroke-width="1"/>`
    + `<rect clip-path="url(#${id}-cl)" width="${fmt(w * line)}" height="2" fill="${f.color.accent}"/>`;
  return { body: card + body, w, h, dx: (1 - u) * -16, dy: 0, opacity: u };
};


const DESIGNS: Record<string, Design> = { clean, modern, professional };

function renderFeel(item: EffectItem, ctx: Ctx): string {
  const f = ctx.feel;
  const c = content(item.params);
  if (!c.title && !c.sub && !c.kicker) return "";
  if (ctx.t < 0) return "";
  const a = ctx.t <= ctx.dur ? 1 : 1 - clamp((ctx.t - ctx.dur) / Math.min(600, f.motion.out));
  if (a <= 0) return "";
  const lay = (DESIGNS[f.base] ?? modern)(c, ctx, f);
  const op = a * clamp(lay.opacity);
  if (op <= 0.001) return "";
  // 1080p units → output px; card's bottom-left sits 56 in from the left, 96 up from the bottom
  const k = ctx.px(ctx.view.w / 1920);
  const frameH = ctx.out.h / k; // frame height in 1080p units (1080 at 16:9)
  const left = 56 + lay.dx, top = frameH - 96 - lay.h + lay.dy;
  if (left + lay.w <= 0) return "";
  return `<g opacity="${fmt(op)}" transform="translate(${fmt(left * k)} ${fmt(top * k)}) scale(${Math.round(k * 10000) / 10000})">${lay.body}</g>`;
}

const mod: EffectModule = {
  type: "lower-third",
  label: "Lower third", use: `Who/what/where labels: variant name (person/product), topic (section), step ('Step 3 of 3'). Designed per feel; style 'fuchi' for the original card.`,
  defaults: { variant: "name", style: "feel", title: "Title", subtitle: "", kicker: "" },
  hold: 6000,
  exit: 600, // the longest feel exit (professional 600); fuchi fades 450
  space: "screen",
  render(item, ctx) {
    return item.params.style === "fuchi" ? renderFuchi(item, ctx) : renderFeel(item, ctx);
  },
};
export default mod;
