// Still (Ken Burns) — Phase 5 lane G. A still image as a cutaway with a slow Ken Burns move,
// framed per feel. The Ken Burns move is the image layer's crop changing over t, so the
// source is never stretched (crop aspect always matches the target rect).
// Also exports the shared B-roll helpers (media sizing, cover crops, per-feel framing and
// captions) used by broll-device / broll-clip / broll-pip.
//   clean:        framed card (rounded, soft shadow, hairline border) on the light canvas
//   modern:       full-bleed with a vignette + lime caption pill (card on the canvas if the
//                 still's aspect is far from the frame's, so nothing important is cropped)
//   professional: letterboxed with a thin caption line in the lower bar
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import type { CardModule, Layer, Rect, SceneCtx } from "./types.ts";
import type { Feel } from "../feels.ts";
import { backgroundSvg, BACKGROUNDS } from "../canvas.ts";
import { clamp, ease, esc, fmt, lerp, textWidth } from "../effects/kit.ts";

// ── media ───────────────────────────────────────────────────────────────────────────────
export type Media = { file: string; video: boolean; at: number; w: number; h: number };
export const isVideo = (p: string) => /\.(mp4|mov|m4v|webm|mkv)$/i.test(p);

const sizeCache = new Map<string, { w: number; h: number }>();
/** pixel size of an image (PNG/JPEG header) or video (ffprobe), cached; 1920×1080 if unknown */
export function mediaSize(file: string): { w: number; h: number } {
  const hit = sizeCache.get(file); if (hit) return hit;
  let s = { w: 1920, h: 1080 };
  try {
    if (isVideo(file)) {
      const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]).toString().trim().split(",").map(Number);
      if (w > 0 && h > 0) s = { w, h };
    } else {
      const fd = openSync(file, "r"), buf = Buffer.alloc(256 * 1024), n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
      if (buf.readUInt32BE(0) === 0x89504e47) s = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      else if (buf[0] === 0xff && buf[1] === 0xd8) {
        for (let i = 2; i + 9 < n;) {
          if (buf[i] !== 0xff) { i++; continue; }
          const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
          if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { s = { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; break; }
          i += 2 + len;
        }
      }
    }
  } catch { /* keep the fallback */ }
  sizeCache.set(file, s);
  return s;
}

/** resolve a params path into a media descriptor; `at` = video time (s) for this frame */
export function media(src: string, ctx: SceneCtx, start = 0): Media {
  const file = ctx.asset(String(src)), video = isVideo(file), { w, h } = mediaSize(file);
  return { file, video, at: start + ctx.t / 1000, w, h };
}

export function mediaLayer(m: Media, rect: Rect, crop: Rect, radius = 0, opacity = 1): Layer {
  return m.video ? { video: m.file, at: m.at, rect, crop, radius, opacity } : { image: m.file, rect, crop, radius, opacity };
}

/** crop (source fractions) that covers a rw×rh rect without distortion, zoomed in by `zoom`
 *  and positioned at (fx, fy) ∈ 0..1 of the slack (0.5 = centred) */
export function coverCrop(sw: number, sh: number, rw: number, rh: number, zoom = 1, fx = 0.5, fy = 0.5): Rect {
  const sa = sw / sh, ra = rw / rh;
  let w = 1, h = 1;
  if (sa > ra) w = ra / sa; else h = sa / ra;
  w /= Math.max(1, zoom); h /= Math.max(1, zoom);
  return { x: clamp(fx) * (1 - w), y: clamp(fy) * (1 - h), w, h };
}

/** largest rect of aspect sw/sh inside box, centred */
export function contain(sw: number, sh: number, box: Rect): Rect {
  const s = Math.min(box.w / sw, box.h / sh), w = sw * s, h = sh * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export const easeOf = (f: Feel) => ease[f.motion.ease] ?? ease.standard;
export const kOf = (ctx: SceneCtx) => ctx.out.w / 1920;
export const svgDoc = (ctx: SceneCtx, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.out.w}" height="${ctx.out.h}">${body}</svg>`;
export const feelBg = (ctx: SceneCtx): Layer => ({ svg: backgroundSvg((BACKGROUNDS[ctx.feel.canvas] ?? BACKGROUNDS.modern).bg, ctx.out.w, ctx.out.h) });
export const rr = (r: Rect) => `x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}"`;

/** soft blurred shadow under a rounded rect */
export function softShadow(ctx: SceneCtx, r: Rect, radius: number, o: { opacity: number; blur: number; dy: number; color?: string }, tag = "sh"): Layer {
  const id = `${ctx.uid}-${tag}`, k = kOf(ctx), col = o.color ?? "#000";
  const filt = (i: string, sd: number) => `<filter id="${i}" filterUnits="userSpaceOnUse" x="0" y="0" width="${ctx.out.w}" height="${ctx.out.h}"><feGaussianBlur stdDeviation="${fmt(sd)}"/></filter>`;
  return { svg: svgDoc(ctx, `<defs>${filt(id, o.blur * k)}${filt(`${id}b`, 3 * k)}</defs>`
    + `<rect ${rr({ ...r, y: r.y + o.dy * k })} rx="${fmt(radius)}" fill="${col}" fill-opacity="${o.opacity}" filter="url(#${id})"/>`
    + `<rect ${rr({ ...r, y: r.y + 2 * k })} rx="${fmt(radius)}" fill="${col}" fill-opacity="${fmt(o.opacity * 0.4)}" filter="url(#${id}b)"/>`) };
}


// ── captions ────────────────────────────────────────────────────────────────────────────
export type CaptionPlace = { center?: boolean; below?: number; bar?: { y: number; h: number } };
/** the caption for this feel, animating in from `at` ms */
export function caption(ctx: SceneCtx, text: string | undefined, place: CaptionPlace = {}, at = 300): Layer[] {
  if (!text) return [];
  const { feel, out, t } = ctx, k = kOf(ctx), f = feel.font, c = feel.color;
  const u = clamp((t - at) / feel.motion.in), e = easeOf(feel)(u), lin = clamp(u * 1.6);
  const s = esc(text);
  if (u <= 0) return [];
  if (feel.base === "clean") {
    const size = 34 * k, y = (place.below ?? out.h - 90 * k) + size * 0.35 + (1 - e) * 14 * k;
    const tw = textWidth(text, size, "medium"), x0 = out.w / 2 - tw / 2;
    return [{ svg: svgDoc(ctx, `<g opacity="${fmt(lin)}"><circle cx="${fmt(x0 - 22 * k)}" cy="${fmt(y - size * 0.33)}" r="${fmt(5 * k)}" fill="${c.accent}"/>`
      + `<text x="${fmt(out.w / 2)}" y="${fmt(y)}" text-anchor="middle" font-family="${f.sans}" font-weight="${f.displayWeight}" font-size="${fmt(size)}" letter-spacing="${fmt(f.tracking * size)}" fill="${c.ink}">${s}</text></g>`) }];
  }
  if (feel.base === "modern") {
    const size = 32 * k, padX = 30 * k, h = 68 * k, tw = textWidth(text, size, "bold") * 0.96, w = tw + padX * 2;
    const x = place.center ? out.w / 2 - w / 2 : 96 * k, y = place.center && place.below ? place.below : out.h - 96 * k - h, sc = lerp(0.82, 1, e), cx = place.center ? out.w / 2 : x, cy = y + h / 2;
    return [{ svg: svgDoc(ctx, `<g opacity="${fmt(lin)}" transform="translate(${fmt(cx)} ${fmt(cy + (1 - Math.min(1, e)) * 18 * k)}) scale(${fmt(sc)}) translate(${fmt(-cx)} ${fmt(-cy)})">`
      + `<rect x="${fmt(x)}" y="${fmt(y + 6 * k)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(h / 2)}" fill="#000" fill-opacity="0.28"/>`
      + `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" rx="${fmt(h / 2)}" fill="${c.accent}"/>`
      + `<text x="${fmt(x + padX)}" y="${fmt(y + h / 2 + size * 0.35)}" font-family="${f.display}" font-weight="${f.displayWeight}" font-size="${fmt(size)}" letter-spacing="${fmt(f.tracking * size)}" fill="#14102B">${s}</text></g>`) }];
  }
  if (feel.base === "professional") {
    const size = 30 * k, bar = place.bar ?? { y: out.h - 84 * k, h: 84 * k };
    const own = place.bar ? "" : `<rect x="0" y="${fmt(bar.y)}" width="${out.w}" height="${fmt(bar.h)}" fill="${c.card}"/><rect x="0" y="${fmt(bar.y)}" width="${out.w}" height="${fmt(1.5 * k)}" fill="${c.cardBorder ?? "#334155"}"/>`;
    const x = 96 * k + (1 - e) * 16 * k, cy = bar.y + bar.h / 2, rule = 44 * k * e;
    return [{ svg: svgDoc(ctx, `<g opacity="${fmt(lin)}">${own}<rect x="${fmt(96 * k)}" y="${fmt(cy - 1.5 * k)}" width="${fmt(rule)}" height="${fmt(3 * k)}" fill="${c.accent}"/>`
      + `<text x="${fmt(x + 64 * k)}" y="${fmt(cy + size * 0.34)}" font-family="${f.display}" font-weight="${f.bodyWeight}" font-size="${fmt(size)}" fill="${c.ink}">${s}</text></g>`) }];
  }
  return [];
}

// ── per-feel framing of one media item ─────────────────────────────────────────────────
export type Fit = "auto" | "cover" | "contain";
export type Framed = { base: Layer[]; caption: Layer[]; content: Rect; card: boolean };
/**
 * Frame a media item per feel. `zoom`/`fx`/`fy` drive the crop inside the frame (Ken Burns,
 * push). Returns the layers (background, shadow, media, overlays), the caption separately
 * (so callers can paint things between), and the media rect.
 */
export function framed(m: Media, ctx: SceneCtx, o: { fit?: Fit; zoom?: number; fx?: number; fy?: number; caption?: string; settle?: boolean }): Framed {
  const { feel, out, t } = ctx, k = kOf(ctx), W = out.w, H = out.h, cap = !!o.caption;
  const zoom = o.zoom ?? 1, fx = o.fx ?? 0.5, fy = o.fy ?? 0.5;
  const settle = o.settle === false ? 1 : easeOf(feel)(clamp(t / (feel.motion.in * 1.4)));
  const sa = m.w / m.h;
  const coverOk = (area: Rect) => { const r = sa / (area.w / area.h); return r < 1.3 && r > 1 / 1.3; };
  const wantCover = (area: Rect) => (o.fit === "cover" ? true : o.fit === "contain" ? false : coverOk(area));
  const base: Layer[] = [];
  const settleRect = (r: Rect, from: number) => { const s = lerp(from, 1, settle); return { x: r.x + (r.w * (1 - s)) / 2, y: r.y + (r.h * (1 - s)) / 2, w: r.w * s, h: r.h * s }; };

  if (feel.base === "clean") {
    const box = { x: W * 0.11, y: H * (cap ? 0.07 : 0.09), w: W * 0.78, h: H * (cap ? 0.72 : 0.82) };
    const r = settleRect(contain(m.w, m.h, box), 0.97), rad = 18 * k;
    base.push(feelBg(ctx), softShadow(ctx, r, rad, { opacity: 0.22, blur: 26, dy: 22 }),
      mediaLayer(m, r, coverCrop(m.w, m.h, r.w, r.h, zoom, fx, fy), rad),
      { svg: svgDoc(ctx, `<rect ${rr(r)} rx="${fmt(rad)}" fill="none" stroke="${feel.color.cardBorder}" stroke-width="${fmt(1.5 * k)}"/>`) });
    return { base, caption: caption(ctx, o.caption, { below: r.y + r.h + 64 * k }), content: r, card: true };
  }

  if (feel.base === "professional") {
    const barH = Math.round(H * 0.1), band = { x: 0, y: barH, w: W, h: H - barH * 2 };
    const bars = { svg: svgDoc(ctx, `<rect x="0" y="0" width="${W}" height="${barH}" fill="#05080F"/><rect x="0" y="${H - barH}" width="${W}" height="${barH}" fill="#05080F"/>`
      + `<rect x="0" y="${H - barH}" width="${W}" height="${fmt(1 * k)}" fill="#94A3B8" fill-opacity="0.18"/>`) };
    let r: Rect, card = false;
    if (wantCover(band)) { r = band; base.push(mediaLayer(m, r, coverCrop(m.w, m.h, r.w, r.h, zoom, fx, fy))); }
    else {
      card = true;
      r = settleRect(contain(m.w, m.h, { x: band.x + W * 0.1, y: band.y + 44 * k, w: W * 0.8, h: band.h - 88 * k }), 0.985);
      const rad = feel.radius * k;
      base.push(feelBg(ctx), softShadow(ctx, r, rad, { opacity: 0.5, blur: 30, dy: 18 }), mediaLayer(m, r, coverCrop(m.w, m.h, r.w, r.h, zoom, fx, fy), rad),
        { svg: svgDoc(ctx, `<rect ${rr(r)} rx="${fmt(rad)}" fill="none" stroke="${feel.color.cardBorder}" stroke-width="${fmt(1.5 * k)}"/>`) });
    }
    base.push(bars);
    return { base, caption: caption(ctx, o.caption, { bar: { y: H - barH, h: barH } }), content: r, card };
  }

  const full = { x: 0, y: 0, w: W, h: H };
  if (feel.base === "modern") {
    if (wantCover(full)) {
      const id = `${ctx.uid}-vg`;
      base.push(mediaLayer(m, full, coverCrop(m.w, m.h, W, H, zoom, fx, fy)),
        { svg: svgDoc(ctx, `<defs><radialGradient id="${id}" cx="0.5" cy="0.48" r="0.78"><stop offset="0.55" stop-color="#140C2C" stop-opacity="0"/><stop offset="1" stop-color="#140C2C" stop-opacity="0.62"/></radialGradient>`
          + `<linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#140C2C" stop-opacity="0"/><stop offset="1" stop-color="#140C2C" stop-opacity="${cap ? 0.6 : 0.3}"/></linearGradient></defs>`
          + `<rect width="100%" height="100%" fill="url(#${id})"/><rect width="100%" height="100%" fill="url(#${id}b)"/>`) });
      return { base, caption: caption(ctx, o.caption), content: full, card: false };
    }
    // centred on the stage; with a caption the card leaves room for the pill centred beneath it
    const box = cap ? { x: W * 0.08, y: H * 0.06, w: W * 0.84, h: H * 0.74 } : { x: W * 0.08, y: H * 0.07, w: W * 0.84, h: H * 0.86 };
    const r = settleRect(contain(m.w, m.h, box), 0.95), rad = 22 * k;
    base.push(feelBg(ctx), softShadow(ctx, r, rad, { opacity: 0.5, blur: 40, dy: 30, color: "#0A0418" }),
      mediaLayer(m, r, coverCrop(m.w, m.h, r.w, r.h, zoom, fx, fy), rad),
      { svg: svgDoc(ctx, `<rect ${rr(r)} rx="${fmt(rad)}" fill="none" stroke="#FFFFFF" stroke-opacity="0.16" stroke-width="${fmt(2 * k)}"/>`) });
    return { base, caption: caption(ctx, o.caption, { below: H * 0.06 + H * 0.74 + 30 * k, center: true }), content: r, card: true };
  }

  throw new Error(`broll: no framing for base "${feel.base}"`);
}

// ── Ken Burns ──────────────────────────────────────────────────────────────────────────
export type Move = "in" | "out" | "pan-left" | "pan-right";
/** zoom + focus for a Ken Burns move at progress u (0..1), eased "linear-ish" */
export function kenBurns(move: Move, u: number, amount = 0.08) {
  const v = lerp(u, ease.inOut(u), 0.4);
  if (move === "out") return { zoom: 1 + amount * (1 - v), fx: 0.5, fy: 0.5 };
  if (move === "pan-left") return { zoom: 1 + amount * 1.25, fx: lerp(0.85, 0.15, v), fy: 0.5 };
  if (move === "pan-right") return { zoom: 1 + amount * 1.25, fx: lerp(0.15, 0.85, v), fy: 0.5 };
  return { zoom: 1 + amount * v, fx: 0.5, fy: 0.5 };
}

const mod: CardModule = {
  kind: "broll", type: "broll-still", label: "Still (Ken Burns)",
  defaults: { src: "assets/broll/pair.png", move: "in", fit: "auto" },
  dur: 3500,
  render(params, ctx) {
    const m = media(params.src, ctx);
    const kb = kenBurns((params.move ?? "in") as Move, clamp(ctx.t / Math.max(1, ctx.dur)), Number(params.amount ?? 0.08));
    const f = framed(m, ctx, { fit: params.fit, zoom: kb.zoom, fx: kb.fx, fy: params.focusY ?? kb.fy, caption: params.caption });
    return [...f.base, ...f.caption];
  },
};
export default mod;
