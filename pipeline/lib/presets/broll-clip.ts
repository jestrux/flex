// Video clip — Phase 5 lane G. A video file played from params.start (s) for the card's
// length, framed per feel exactly like broll-still (card / full-bleed + vignette /
// letterbox / full-bleed + band), with a subtle push instead of Ken Burns.
import type { CardModule } from "./types.ts";
import { clamp, ease } from "../effects/kit.ts";
import { framed, media } from "./broll-still.ts";

const mod: CardModule = {
  kind: "broll", type: "broll-clip", label: "Video clip",
  defaults: { src: "assets/broll/sample-clip.mp4", start: 0, push: 0.03, fit: "auto" },
  dur: 4000,
  render(params, ctx) {
    const m = media(params.src, ctx, Number(params.start ?? 0));
    const u = clamp(ctx.t / Math.max(1, ctx.dur));
    const f = framed(m, ctx, { fit: params.fit, zoom: 1 + Number(params.push ?? 0.03) * ease.inOut(u), fy: params.focusY, caption: params.caption });
    return [...f.base, ...f.caption];
  },
};
export default mod;
