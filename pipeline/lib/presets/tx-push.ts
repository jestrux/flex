// Slide / push — b pushes a out of frame. Both move at 100% (no gap, no overlap), on the
// feel's in-out curve. a dims a little as it leaves and b casts a soft shadow onto a along the
// seam, so the leading edge reads as a sheet sliding over. Pure row/column copies: ~10ms/frame.
//   params: { dir: "left" | "right" | "up" | "down" (content moves that way; b enters from the
//             opposite edge), dim?: 0..1 (how dark a gets by the end), shadow?: boolean }
import type { Feel } from "../feels.ts";
import type { TransitionModule } from "./types.ts";
import { inOutCurve } from "./tx-crossfade.ts";

type Dir = "left" | "right" | "up" | "down";
const LOOK: Record<string, { dim: number; shadow: number; seam: number }> = {
  clean: { dim: 0.12, shadow: 0.22, seam: 70 },
  modern: { dim: 0.28, shadow: 0.38, seam: 90 },
  professional: { dim: 0.16, shadow: 0.26, seam: 80 },
};
const look = (f: Feel) => LOOK[f.base] ?? LOOK.modern;

const push: TransitionModule = {
  kind: "transition", type: "push", label: "Slide / push", defaults: { dir: "left" }, ms: 600,
  async mix(a, b, u, { out, feel, params }) {
    if (u <= 0) return a;
    if (u >= 1) return b;
    const { w: W, h: H } = out;
    const dir: Dir = (["left", "right", "up", "down"] as const).includes(params.dir) ? params.dir : "left";
    const e = inOutCurve(feel)(u);
    const L = look(feel);
    const dim = typeof params.dim === "number" ? params.dim : L.dim;
    const shadowAmt = params.shadow === false ? 0 : L.shadow * Math.min(1, e * 6); // eases in so u≈0 stays a
    const seamPx = Math.max(1, L.seam * (W / 1920));
    const horiz = dir === "left" || dir === "right";
    const span = horiz ? W : H;
    const off = Math.round(e * span);                 // how far b has come in, px
    if (off <= 0) return a;
    if (off >= span) return b;
    const o = Buffer.allocUnsafe(W * H * 3);
    const row = W * 3;

    // a's multiplier (0..256) by its distance d from the seam, in px of output
    const base = 1 - dim * e;
    const mult = (d: number) => {
      let m = base;
      if (shadowAmt > 0 && d < seamPx) { const k = 1 - d / seamPx; m *= 1 - shadowAmt * k * k; }
      return Math.round(m * 256);
    };

    if (horiz) {
      const aw = W - off;                             // visible width of a
      // a's columns (in output space) and their multipliers
      const colM = new Uint16Array(aw);
      for (let x = 0; x < aw; x++) colM[x] = mult(dir === "left" ? aw - 1 - x : x);
      for (let y = 0; y < H; y++) {
        const r = y * row;
        if (dir === "left") {
          // out[0..aw) = a[off..W), out[aw..W) = b[0..off)
          for (let x = 0, si = r + off * 3, di = r; x < aw; x++) { const m = colM[x]; o[di++] = (a[si++] * m) >> 8; o[di++] = (a[si++] * m) >> 8; o[di++] = (a[si++] * m) >> 8; }
          b.copy(o, r + aw * 3, r, r + off * 3);
        } else {
          // out[0..off) = b[W-off..W), out[off..W) = a[0..aw)
          b.copy(o, r, r + aw * 3, r + row);
          for (let x = 0, si = r, di = r + off * 3; x < aw; x++) { const m = colM[x]; o[di++] = (a[si++] * m) >> 8; o[di++] = (a[si++] * m) >> 8; o[di++] = (a[si++] * m) >> 8; }
        }
      }
    } else {
      const ah = H - off;
      for (let y = 0; y < ah; y++) {
        const m = mult(dir === "up" ? ah - 1 - y : y);
        const src = (dir === "up" ? y + off : y) * row, dst = (dir === "up" ? y : y + off) * row;
        for (let i = 0; i < row; i++) o[dst + i] = (a[src + i] * m) >> 8;
      }
      if (dir === "up") b.copy(o, ah * row, 0, off * row);   // b's top rows enter at the bottom
      else b.copy(o, 0, ah * row, H * row);                  // b's bottom rows enter at the top
    }
    return o;
  },
};
export default push;
