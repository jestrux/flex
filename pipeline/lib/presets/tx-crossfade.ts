// Crossfade — a → b blended in linear light (no muddy dark dip mid-fade), timed by the feel.
// Also home to the small helpers the other transitions share (curves, linear-light blend,
// raw-frame sharp shortcuts), so lane H stays inside its own files.
import sharp from "sharp";
import type { Feel } from "../feels.ts";
import type { Frame, TransitionModule } from "./types.ts";
import { clamp, cubicBezier, ease } from "../effects/kit.ts";

// ── curves ────────────────────────────────────────────────────────────────────────────
/** the feel's motion ease as a plain out-curve (may overshoot for outBack) */
export function outCurve(feel: Feel): (u: number) => number {
  switch (feel.motion.ease) {
    case "outBack": return ease.outBack;
    case "power3Out": return ease.power3Out;
    case "outCubic": return ease.outCubic;
    case "standard":
    default: return cubicBezier(0.4, 0, 0.2, 1);
  }
}
const curveCache = new Map<string, (u: number) => number>();
/** symmetric in-out built from the feel's out-curve (standard → soft in-out, power3Out →
 *  in-out quart, outCubic → in-out cubic, outBack → snappy in-out, optional end overshoot). `overshoot:false`
 *  clamps to 0..1. Exact at 0 and 1. */
export function inOutCurve(feel: Feel, overshoot = false): (u: number) => number {
  const k = `${feel.name}|${feel.motion.ease}|${overshoot}`;
  let c = curveCache.get(k);
  if (!c) {
    const f = outCurve(feel);
    // outBack overshoots, so mirroring it would hold still at both ends; give it its own
    // snappy in-out instead (with a settle-past-the-end overshoot only when asked)
    if (feel.motion.ease === "outBack") {
      const bz = overshoot ? cubicBezier(0.6, 0, 0.25, 1.2) : cubicBezier(0.65, 0, 0.25, 1);
      c = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : bz(u));
      curveCache.set(k, c);
      return c;
    }
    c = (u: number) => {
      if (u <= 0) return 0; if (u >= 1) return 1;
      const v = u < 0.5 ? (1 - f(1 - 2 * u)) / 2 : (1 + f(2 * u - 1)) / 2;
      return overshoot ? v : clamp(v);
    };
    curveCache.set(k, c);
  }
  return c;
}
/** a softer curve for opacity: halfway between linear and the feel's in-out */
export function fadeCurve(feel: Feel): (u: number) => number {
  const io = inOutCurve(feel);
  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 0.5 * u + 0.5 * io(u));
}
export const smoothstep = (a: number, b: number, u: number) => { const t = clamp((u - a) / (b - a)); return t * t * (3 - 2 * t); };

// ── linear-light blend ────────────────────────────────────────────────────────────────
const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; TO_LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const LN = 4096;
const TO_SRGB = new Uint8Array(LN + 1);
for (let i = 0; i <= LN; i++) { const l = i / LN; const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; TO_SRGB[i] = Math.round(clamp(c) * 255); }

/** (1−m)·a + m·b in linear light; exact a at m≤0 and b at m≥1 */
export function blendLinear(a: Frame, b: Frame, m: number): Frame {
  if (m <= 0) return a;
  if (m >= 1) return b;
  const n = Math.min(a.length, b.length), o = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) {
    const la = TO_LIN[a[i]];
    o[i] = TO_SRGB[((la + (TO_LIN[b[i]] - la) * m) * LN + 0.5) | 0];
  }
  return o;
}

// ── raw-frame sharp shortcuts ─────────────────────────────────────────────────────────
export const raw = (buf: Buffer, w: number, h: number, channels: 3 | 4 = 3) => sharp(buf, { raw: { width: w, height: h, channels } });
export const toRaw3 = (s: sharp.Sharp) => s.removeAlpha().raw().toBuffer();

/**
 * Zoom into a frame by `scale` ≥ 1 (centred on cx, cy as fractions), blur by `sigma` output px,
 * and return a full out.w×out.h raw RGB frame. Blur runs on a downscaled copy (factor picked
 * from sigma) that is upscaled back, so a big blur stays cheap.
 */
export async function zoomBlur(f: Frame, out: { w: number; h: number }, scale: number, sigma: number, cx = 0.5, cy = 0.5): Promise<Frame> {
  const { w: W, h: H } = out;
  const s = Math.max(1, scale);
  if (s < 1.0008 && sigma < 0.4) return f;
  const cw = Math.min(W, Math.max(2, Math.round(W / s))), ch = Math.min(H, Math.max(2, Math.round(H / s)));
  const left = Math.round(clamp(cx * W - cw / 2, 0, W - cw)), top = Math.round(clamp(cy * H - ch / 2, 0, H - ch));
  const d = sigma >= 12 ? 8 : sigma >= 6 ? 4 : sigma >= 2.5 ? 2 : 1;
  let p = raw(f, W, H);
  if (cw !== W || ch !== H) p = p.extract({ left, top, width: cw, height: ch });
  if (d === 1) {
    if (cw !== W || ch !== H) p = p.resize(W, H, { kernel: "cubic" });
    if (sigma >= 0.4) p = p.blur(Math.max(0.3, sigma));
    return toRaw3(p);
  }
  const sw = Math.max(2, Math.round(W / d)), sh = Math.max(2, Math.round(H / d));
  const small = await toRaw3(p.resize(sw, sh, { kernel: "linear" }).blur(Math.max(0.3, sigma / d)));
  return toRaw3(raw(small, sw, sh).resize(W, H, { kernel: "linear" }));
}

// ── the transition ────────────────────────────────────────────────────────────────────
const crossfade: TransitionModule = {
  kind: "transition", type: "crossfade", label: "Crossfade", defaults: {}, ms: 500,
  async mix(a, b, u, { feel }) {
    if (u <= 0) return a;
    if (u >= 1) return b;
    return blendLinear(a, b, fadeCurve(feel)(u));
  },
};
export default crossfade;
