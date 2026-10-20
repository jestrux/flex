// Canvas swap — Screen Studio switching windows on the stage: a shrinks (1 → ~0.86) to reveal
// the feel's canvas background, gaining rounded corners and a soft shadow; then a slides off
// (fading a touch) as b slides in at the same reduced scale, and b grows back to full frame.
// The three phases overlap so it reads as one move. Modern's outBack lets the slide overshoot.
//   params: { dir?: "left" | "right" (default "left": a exits left, b enters from the right),
//             scale?: the reduced scale (default per feel) }
import sharp from "sharp";
import type { Feel } from "../feels.ts";
import type { Frame, TransitionModule } from "./types.ts";
import { backgroundSvg, BACKGROUNDS } from "../canvas.ts";
import { clamp } from "../effects/kit.ts";
import { inOutCurve, raw, toRaw3 } from "./tx-crossfade.ts";

const LOOK: Record<string, { scale: number; radius: number; shadow: number; gap: number }> = {
  clean: { scale: 0.86, radius: 18, shadow: 0.32, gap: 90 },
  modern: { scale: 0.84, radius: 22, shadow: 0.5, gap: 110 },
  professional: { scale: 0.88, radius: 10, shadow: 0.42, gap: 80 },
};
const look = (f: Feel) => LOOK[f.base] ?? LOOK.modern;

const bgCache = new Map<string, Promise<Buffer>>();
function background(feel: Feel, W: number, H: number) {
  const key = `${feel.canvas}|${W}x${H}`;
  let p = bgCache.get(key);
  if (!p) {
    const bg = (BACKGROUNDS[feel.canvas] ?? BACKGROUNDS.modern).bg;
    p = toRaw3(sharp(Buffer.from(backgroundSvg(bg, W, H))).resize(W, H));
    bgCache.set(key, p);
  }
  return p;
}

type Win = { f: Frame; k: number; cx: number; opacity: number };

/** one window as clipped RGBA + its integer placement on the W×H stage, or null if off-stage */
async function windowLayer(w: Win, W: number, H: number, radius: number) {
  const ww = Math.max(2, Math.round(W * w.k)), wh = Math.max(2, Math.round(H * w.k));
  const left = Math.round(w.cx - ww / 2), top = Math.round((H - wh) / 2);
  const x0 = Math.max(0, left), y0 = Math.max(0, top), x1 = Math.min(W, left + ww), y1 = Math.min(H, top + wh);
  if (x1 - x0 < 1 || y1 - y0 < 1 || w.opacity <= 0.002) return null;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ww}" height="${wh}"><rect width="${ww}" height="${wh}" rx="${radius.toFixed(2)}" fill="#fff" fill-opacity="${clamp(w.opacity).toFixed(3)}"/></svg>`);
  let rgba = await raw(w.f, W, H).resize(ww, wh, { kernel: "lanczos3" }).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).raw().toBuffer();
  if (x0 !== left || y0 !== top || x1 !== left + ww || y1 !== top + wh)
    rgba = await raw(rgba, ww, wh, 4).extract({ left: x0 - left, top: y0 - top, width: x1 - x0, height: y1 - y0 }).raw().toBuffer();
  return { input: rgba, raw: { width: x1 - x0, height: y1 - y0, channels: 4 as const }, left: x0, top: y0, rect: { left, top, ww, wh } };
}

/** soft drop shadows for the windows, drawn at quarter res and upscaled (cheap, it's blurry) */
async function shadowLayer(rects: { left: number; top: number; ww: number; wh: number; a: number }[], W: number, H: number, radius: number) {
  const q = 4, sw = Math.round(W / q), sh = Math.round(H / q);
  const blur = 26 * (H / 1080) / q, dy = 18 * (H / 1080) / q;
  const body = rects.map((r) => `<rect x="${(r.left / q).toFixed(2)}" y="${(r.top / q + dy).toFixed(2)}" width="${(r.ww / q).toFixed(2)}" height="${(r.wh / q).toFixed(2)}" rx="${(radius / q).toFixed(2)}" fill="#000" fill-opacity="${r.a.toFixed(3)}" filter="url(#s)"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${blur.toFixed(2)}"/></filter></defs>${body}</svg>`;
  const buf = await sharp(Buffer.from(svg)).resize(W, H, { kernel: "linear" }).ensureAlpha().raw().toBuffer();
  return { input: buf, raw: { width: W, height: H, channels: 4 as const }, left: 0, top: 0 };
}

const canvasSwap: TransitionModule = {
  kind: "transition", type: "canvas-swap", label: "Canvas swap", defaults: { dir: "left" }, ms: 900,
  async mix(a, b, u, { out, feel, params }) {
    if (u <= 0) return a;
    if (u >= 1) return b;
    const { w: W, h: H } = out;
    const L = look(feel);
    const s = clamp(Number(params.scale ?? L.scale), 0.5, 0.98);
    const sign = params.dir === "right" ? -1 : 1;
    const io = inOutCurve(feel), slideCurve = inOutCurve(feel, true);
    const ph = (a0: number, a1: number) => clamp((u - a0) / (a1 - a0));
    const shrink = io(ph(0, 0.38)), slide = slideCurve(ph(0.22, 0.78)), grow = io(ph(0.62, 1));
    const kA = 1 + (s - 1) * shrink, kB = s + (1 - s) * grow;
    const gap = L.gap * (W / 1920);
    const D = W / 2 + (W * s) / 2 + gap;                 // a fully off-stage when slide = 1
    const cxA = W / 2 - sign * D * slide, cxB = W / 2 + sign * D * (1 - slide);
    const opA = 1 - 0.35 * clamp(slide * 1.4 - 0.3);      // a fades a touch as it leaves
    // corner radius + shadow strength follow how far each window is from full frame
    const depth = (k: number) => clamp((1 - k) / (1 - s));
    const R = L.radius * (W / 1920);
    const winA: Win = { f: a, k: kA, cx: cxA, opacity: opA }, winB: Win = { f: b, k: kB, cx: cxB, opacity: 1 };
    // radius is shared by the mask and the shadow, so use each window's own depth
    const [bg, la, lb] = await Promise.all([
      background(feel, W, H),
      windowLayer(winA, W, H, R * depth(kA)),
      windowLayer(winB, W, H, R * depth(kB)),
    ]);
    const layers = [la, lb].filter((l): l is NonNullable<typeof l> => !!l);
    if (!layers.length) return Buffer.from(bg);
    const shadowRects = [
      la && { ...la.rect, a: L.shadow * depth(kA) * opA },
      lb && { ...lb.rect, a: L.shadow * depth(kB) },
    ].filter((r): r is NonNullable<typeof r> => !!r && r.a > 0.005);
    const comps: sharp.OverlayOptions[] = [];
    if (shadowRects.length) comps.push(await shadowLayer(shadowRects, W, H, R));
    for (const l of layers) comps.push({ input: l.input, raw: l.raw, left: l.left, top: l.top });
    return toRaw3(raw(bg, W, H).composite(comps));
  },
};
export default canvasSwap;
