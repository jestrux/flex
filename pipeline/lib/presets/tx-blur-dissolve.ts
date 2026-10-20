// Blur dissolve — a defocuses while b fades in from soft to sharp; the blur peaks
// mid-transition. Blur is linear, so the two are blended first (linear light) and the mix is
// blurred once, on a downscaled copy that is upscaled back: one blend + one cheap blur/frame.
//   params: { blur?: peak blur radius (px @1080p) }
import type { Feel } from "../feels.ts";
import type { TransitionModule } from "./types.ts";
import { blendLinear, fadeCurve, zoomBlur } from "./tx-crossfade.ts";

const PEAK: Record<string, number> = { clean: 16, modern: 22, professional: 12 };
const peakOf = (f: Feel) => PEAK[f.base] ?? 18;

const blurDissolve: TransitionModule = {
  kind: "transition", type: "blur-dissolve", label: "Blur dissolve", defaults: {}, ms: 700,
  async mix(a, b, u, { out, feel, params }) {
    if (u <= 0) return a;
    if (u >= 1) return b;
    const peak = Number(params.blur ?? peakOf(feel)) * (out.h / 1080);
    const m = fadeCurve(feel)(u);
    const sigma = peak * Math.sin(Math.PI * u) ** 1.3;   // 0 at both ends, peak in the middle
    const mixed = blendLinear(a, b, m);
    const r = await zoomBlur(mixed, out, 1, sigma);
    return r === a || r === b ? Buffer.from(r) : r;
  },
};
export default blurDissolve;
