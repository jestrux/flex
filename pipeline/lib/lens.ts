// Flex (patch 23): a magnifying lens and rolling figures, for any card. From the KinPay Circles films' desk and USSD
// cards, made general.
//
// lensLayers: an image placed on the frame (a take's frame, a still) magnified around a point, as a round lens or a
// band, opening with a little overshoot and shutting quickly; the frame dims around it. What the lens is about can
// escape the glass: `escape` boxes (on the placed image, film px) are drawn bigger than the lens magnifies them, over
// its rim, with a shadow, and are always kept whole on the frame. `overlay` (SVG drawn in the placed image's
// coordinates) is drawn magnified inside the lens and each escape too, so a counter keeps counting out there.
//   layers.push(...lensLayers(ctx, { src: { file, rect, px }, at: 1200, out: 3600, target: { x: 640, y: 410 }, reach: 60, mag: 2.2,
//                                    escape: [{ x: 600, y: 395, w: 120, h: 30 }] }));
// A lens open for less than 2 s is too short to read what's in it: Flex warns (once per lens).
//
// counterSvg: a figure rolling from one value to another (the film counters' curve), drawn live as SVG text.
//   counterSvg(ctx.t, { at: 300, dur: 1400, from: 0, to: 5250, box: { x: 400, y: 300, w: 300, h: 60 }, format: kwacha })
import { clamp, ease, fmt, lerp, prog } from "./effects/kit.ts";
import { frameSvg, W } from "./presets/title-opening.ts";
import type { Layer, SceneCtx } from "./presets/types.ts";

export type Box = { x: number; y: number; w: number; h: number };
export type LensOpts = {
  /** the image under the lens: its file, where it's drawn on the frame (film px), and its own pixel size */
  src: { file: string; rect: Box; px: { w: number; h: number } };
  /** card ms it opens and starts to shut (it shuts over 300 ms) */
  at: number; out: number;
  /** the point it magnifies (film px, on the placed image) and how far around it the lens sees (film px) */
  target: { x: number; y: number }; reach: number;
  /** how much it magnifies */
  mag: number;
  /** "circle" (default) or "band": a strip `bandW` film px wide (default 3 × reach × mag), 2 × reach × mag high */
  shape?: "circle" | "band"; bandW?: number;
  /** where the lens sits on the frame (default: over its target) */
  centre?: { x: number; y: number };
  /** boxes (film px on the placed image) drawn out of the glass, `grow` bigger than the lens magnifies (0.45) */
  escape?: (Box & { push?: { x: number; y: number } })[]; grow?: number;
  /** the frame area escapes stay inside (default: the whole frame less 24 px) */
  keep?: Box;
  /** how much the rest of the frame dims while it's open (0.5) */
  dim?: number;
  /** SVG in the placed image's coordinates (film px), drawn magnified in the lens and each escape */
  overlay?: string;
  /** the lens's paper under the image (a transparent image shows it), default white */
  paper?: string;
};

const backOut = (u: number) => { const c = 1.4, v = u - 1; return 1 + (c + 1) * v * v * v + c * v * v; };
const warned = new Set<string>();

/** where the lens is and how open, at card time t (null: closed) */
export function lensState(o: LensOpts, t: number) {
  if (t < o.at || t > o.out + 300) return null;
  const open = backOut(clamp((t - o.at) / 450)), shut = 1 - ease.power2In(prog(t, o.out, 300));
  const k = Math.max(0, open) * shut, c = o.centre ?? o.target;
  return { cx: c.x, cy: c.y, k, o: clamp((t - o.at) / 200) * shut, pop: ease.power3Out(prog(t, o.at + 250, 420)) * shut };
}

export function lensLayers(ctx: SceneCtx, o: LensOpts): Layer[] {
  if (o.out - o.at < 2000) {
    const key = `${o.src.file}@${o.at}`;
    if (!warned.has(key)) { warned.add(key); console.warn(`  ! lens at ${o.at} ms is open ${((o.out - o.at) / 1000).toFixed(1)} s: under 2 s, too short to read what's in it`); }
  }
  const st = lensState(o, ctx.t);
  if (!st || st.k <= 0.001) return [];
  const H = ctx.out.h * (W / ctx.out.w), kx = ctx.out.w / W;
  const band = o.shape === "band", m = o.mag;
  // the lens is kept whole on the frame too (at its full size, so it doesn't drift as it opens)
  const keep0 = o.keep ?? { x: 24, y: 24, w: W - 48, h: H - 48 }, hw = band ? (o.bandW ?? 3 * o.reach * m) / 2 : o.reach * m, hh = o.reach * m;
  st.cx = clamp(st.cx, keep0.x + hw, keep0.x + keep0.w - hw); st.cy = clamp(st.cy, keep0.y + hh, keep0.y + keep0.h - hh);
  const R = o.reach * m * st.k, bw = (o.bandW ?? 3 * o.reach * m) * st.k;
  const lens = band ? { x: st.cx - bw / 2, y: st.cy - R, w: bw, h: 2 * R, r: Math.min(18, R) } : { x: st.cx - R, y: st.cy - R, w: 2 * R, h: 2 * R, r: R };
  // a film point on the placed image → its place in the lens
  const map = (x: number, y: number) => ({ x: st.cx + (x - o.target.x) * m, y: st.cy + (y - o.target.y) * m });
  // the lens's window onto the image: what it shows, as a crop of the image (0–1)
  const S = o.src, sx = S.px.w / S.rect.w, sy = S.px.h / S.rect.h;
  const view = { x: o.target.x - lens.w / (2 * m), y: o.target.y - lens.h / (2 * m), w: lens.w / m, h: lens.h / m };
  const crop = { x: ((view.x - S.rect.x) * sx) / S.px.w, y: ((view.y - S.rect.y) * sy) / S.px.h, w: (view.w * sx) / S.px.w, h: (view.h * sy) / S.px.h };
  const shape = band ? `<rect x="${fmt(lens.x)}" y="${fmt(lens.y)}" width="${fmt(lens.w)}" height="${fmt(lens.h)}" rx="${fmt(lens.r)}"/>`
    : `<circle cx="${fmt(st.cx)}" cy="${fmt(st.cy)}" r="${fmt(R)}"/>`;
  const out: Layer[] = [];
  const dim = o.dim ?? 0.5;
  const hole = band ? `M${fmt(lens.x)} ${fmt(lens.y)}h${fmt(lens.w)}v${fmt(lens.h)}h${fmt(-lens.w)}Z` : `M${fmt(st.cx - R)} ${fmt(st.cy)}a${fmt(R)} ${fmt(R)} 0 1 0 ${fmt(2 * R)} 0a${fmt(R)} ${fmt(R)} 0 1 0 ${fmt(-2 * R)} 0Z`;
  out.push({ svg: frameSvg(ctx, `<path fill-rule="evenodd" fill="#08070E" opacity="${fmt(dim * st.o)}" d="M0 0H${W}V${H}H0Z ${hole}"/>`
    + `<g transform="translate(0 18)" opacity="${fmt(0.5 * st.o)}" filter="url(#lnsh)">${shape.replace("/>", ` fill="#000"/>`)}</g>`
    + `<g opacity="${fmt(st.o)}">${shape.replace("/>", ` fill="${o.paper ?? "#FFFFFF"}"/>`)}</g>`,
    `<filter id="lnsh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>`) });
  out.push({ image: S.file, rect: { x: lens.x * kx, y: lens.y * kx, w: lens.w * kx, h: lens.h * kx }, crop, radius: lens.r * kx, opacity: st.o });
  const ov = (tx: number, ty: number, s: number, clip: string, id: string) => o.overlay
    ? [{ svg: frameSvg(ctx, `<g clip-path="url(#${id})"><g transform="translate(${fmt(tx)} ${fmt(ty)}) scale(${fmt(s)})">${o.overlay}</g></g>`, `<clipPath id="${id}">${clip}</clipPath>`) }] : [];
  const z = map(0, 0);
  out.push(...ov(z.x, z.y, m, shape, "lnov"));
  out.push({ svg: frameSvg(ctx, `<g opacity="${fmt(st.o)}">${shape.replace("/>", ` fill="none" stroke="#FFFFFF" stroke-width="5"/>`)}</g>`) });
  // the subject escapes the glass
  const keep = o.keep ?? { x: 24, y: 24, w: W - 48, h: H - 48 };
  for (const [i, b] of (o.escape ?? []).entries()) {
    if (st.pop <= 0) continue;
    const g = m * (1 + (o.grow ?? 0.45) * st.pop), c = map(b.x + b.w / 2, b.y + b.h / 2);
    const cx = c.x + (b.push?.x ?? 0) * st.pop, cy = c.y + (b.push?.y ?? 0) * st.pop;
    const r = { x: cx - (b.w * g) / 2, y: cy - (b.h * g) / 2 - 6 * st.pop, w: b.w * g, h: b.h * g };
    r.x = clamp(r.x, keep.x, keep.x + keep.w - r.w); r.y = clamp(r.y, keep.y, keep.y + keep.h - r.h);
    out.push({ svg: frameSvg(ctx, `<rect x="${fmt(r.x)}" y="${fmt(r.y + 10)}" width="${fmt(r.w)}" height="${fmt(r.h)}" rx="10" fill="#000" opacity="${fmt(0.35 * st.pop)}" filter="url(#lnesh)"/>`,
      `<filter id="lnesh" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="12"/></filter>`) });
    out.push({ image: S.file, rect: { x: r.x * kx, y: r.y * kx, w: r.w * kx, h: r.h * kx },
      crop: { x: ((b.x - S.rect.x) * sx) / S.px.w, y: ((b.y - S.rect.y) * sy) / S.px.h, w: (b.w * sx) / S.px.w, h: (b.h * sy) / S.px.h }, radius: 8 * kx, opacity: st.pop });
    out.push(...ov(r.x - b.x * g, r.y - b.y * g, g, `<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" rx="8"/>`, `lnes${i}`));
  }
  return out;
}

export type Counter = {
  at: number; dur: number; from: number; to: number;
  /** where it's drawn (film px): the figure sits on the box's baseline area, left-aligned unless `align` */
  box: Box;
  /** how it's written (default: whole numbers with thousands separators) */
  format?: (n: number) => string;
  size?: number; font?: string; weight?: number; ink?: string;
  /** a fill under it, papering over the figure it replaces (default none) */
  bg?: string;
  align?: "start" | "middle" | "end";
};
/** the figure's value at card time t (the film counters' curve) */
export const counterValue = (c: Counter, t: number) => lerp(c.from, c.to, ease.standard(prog(t, c.at, c.dur)));
/** the counter as SVG at card time t (before `at` it shows `from`) */
export function counterSvg(t: number, c: Counter): string {
  const f = c.format ?? ((n: number) => Math.round(n).toLocaleString("en-US"));
  const size = c.size ?? c.box.h * 0.8, a = c.align ?? "start";
  const x = a === "start" ? c.box.x : a === "middle" ? c.box.x + c.box.w / 2 : c.box.x + c.box.w;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return (c.bg ? `<rect x="${fmt(c.box.x)}" y="${fmt(c.box.y)}" width="${fmt(c.box.w)}" height="${fmt(c.box.h)}" fill="${c.bg}"/>` : "")
    + `<text x="${fmt(x)}" y="${fmt(c.box.y + c.box.h / 2 + size * 0.36)}" text-anchor="${a}" font-family="${c.font ?? "Inter, Helvetica, sans-serif"}" font-weight="${c.weight ?? 700}" font-size="${fmt(size)}" fill="${c.ink ?? "#14101C"}" style="font-variant-numeric: tabular-nums">${esc(f(counterValue(c, t)))}</text>`;
}
/** money as the films wrote it: "K 5,250.00" */
export const money = (prefix = "K ", decimals = 2) => (n: number) => prefix + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
