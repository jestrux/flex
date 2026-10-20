// Zoom through — the camera flies into the next scene: a scales up (1 → ~1.6) and blurs as it
// rushes past, b arrives slightly over-scaled and blurred and settles to 1 and sharp, and the
// two dissolve (linear light) through the middle. Professional is a gentle push-in; Modern
// and Bold punch harder with more blur.
//   params: { scale?: a's end scale, from?: b's start scale, blur?: peak blur (px @1080p),
//             cx?, cy?: zoom centre as fractions (default 0.5, 0.5) }
import type { Feel } from "../feels.ts";
import type { TransitionModule } from "./types.ts";
import { blendLinear, inOutCurve, smoothstep, zoomBlur } from "./tx-crossfade.ts";

const LOOK: Record<string, { scale: number; from: number; blur: number; window: [number, number] }> = {
  clean: { scale: 1.35, from: 1.08, blur: 10, window: [0.3, 0.7] },
  modern: { scale: 1.6, from: 1.15, blur: 16, window: [0.32, 0.68] },
  professional: { scale: 1.22, from: 1.05, blur: 6, window: [0.25, 0.75] },
};
const look = (f: Feel) => LOOK[f.base] ?? LOOK.modern;

const zoomThrough: TransitionModule = {
  kind: "transition", type: "zoom-through", label: "Zoom through", defaults: {}, ms: 700,
  async mix(a, b, u, { out, feel, params }) {
    if (u <= 0) return a;
    if (u >= 1) return b;
    const L = look(feel);
    const S = Number(params.scale ?? L.scale), B0 = Number(params.from ?? L.from), peak = Number(params.blur ?? L.blur) * (out.h / 1080);
    const cx = Number(params.cx ?? 0.5), cy = Number(params.cy ?? 0.5);
    const e = inOutCurve(feel)(u);
    const ea = 0.5 * e + 0.5 * u ** 1.6, eb = e;   // a starts pushing in early, b decelerates into place
    const m = smoothstep(L.window[0], L.window[1], e);
    const sa = 1 + (S - 1) * ea, sb = B0 + (1 - B0) * eb;
    const blurA = peak * smoothstep(0, 0.6, e), blurB = peak * (1 - smoothstep(0.4, 1, e));
    const [fa, fb] = await Promise.all([
      m < 0.999 ? zoomBlur(a, out, sa, blurA, cx, cy) : Promise.resolve(a),
      m > 0.001 ? zoomBlur(b, out, sb, blurB, 0.5, 0.5) : Promise.resolve(b),
    ]);
    if (m <= 0.001) return fa === a ? Buffer.from(a) : fa;
    if (m >= 0.999) return fb === b ? Buffer.from(b) : fb;
    return blendLinear(fa, fb, m);
  },
};
export default zoomThrough;
