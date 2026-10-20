// Picture in picture — Phase 5 lane G. params.src = main (image or video), framed per feel
// like broll-still; params.pip = a second image/video in a small window in a corner
// (params.corner: "br" | "bl" | "tr" | "tl", default "br"), sliding/scaling in after ~400ms.
//   clean: white mat + soft shadow · modern: lime ring + deep shadow, springy pop ·
//   professional: hairline slate border, slow glide
import type { CardModule, Layer, Rect } from "./types.ts";
import { clamp, fmt, lerp } from "../effects/kit.ts";
import { contain, coverCrop, easeOf, framed, kOf, media, mediaLayer, rr, softShadow, svgDoc } from "./broll-still.ts";

const mod: CardModule = {
  kind: "broll", type: "broll-pip", label: "Picture in picture",
  defaults: { src: "assets/broll/app-still.jpg", pip: "assets/broll/pair.png", corner: "br", delay: 400, fit: "auto" },
  dur: 4000,
  render(params, ctx) {
    const { feel, out, t } = ctx, k = kOf(ctx);
    const main = media(params.src, ctx, Number(params.start ?? 0));
    const u = clamp(t / Math.max(1, ctx.dur));
    const f = framed(main, ctx, { fit: params.fit, zoom: 1 + 0.025 * u, fy: params.focusY, caption: params.caption });
    const layers: Layer[] = [...f.base];
    if (params.pip) {
      const pm = media(params.pip, ctx, Number(params.pipStart ?? 0));
      const corner = String(params.corner ?? "br"), right = corner.includes("r"), bottom = corner.includes("b");
      // window size: fits a 560×420 box (scaled to the output), aspect preserved
      const size = contain(pm.w, pm.h, { x: 0, y: 0, w: 560 * k, h: 420 * k });
      // inside the frame for full-bleed; overhanging the main card's corner when framed
      const c = f.content, inset = f.card ? -0.18 * size.w : 56 * k, minM = 28 * k;
      const capRoom = feel.base === "professional" ? out.h * 0.1 + 24 * k : 0; // keep clear of the letterbox bar
      let x = right ? c.x + c.w - inset - size.w : c.x + inset;
      let y = bottom ? c.y + c.h - inset - size.h : c.y + inset;
      x = clamp(x, minM, out.w - minM - size.w);
      y = clamp(y, minM + capRoom, out.h - minM - capRoom - size.h);
      // entry: slides in from the outer corner + scales up, after `delay`
      const p = clamp((t - Number(params.delay ?? 400)) / (feel.motion.in * (feel.base === "professional" ? 1.1 : 1)));
      if (p > 0) {
        const e = easeOf(feel)(p), s = lerp(0.82, 1, e), op = clamp(p * 2.2);
        const dx = (right ? 1 : -1) * (1 - e) * 70 * k, dy = (bottom ? 1 : -1) * (1 - e) * 50 * k;
        const r: Rect = { x: x + dx + (size.w * (1 - s)) / 2, y: y + dy + (size.h * (1 - s)) / 2, w: size.w * s, h: size.h * s };
        const crop = coverCrop(pm.w, pm.h, r.w, r.h, 1, 0.5, Number(params.pipFocusY ?? 0.5));
        const g = (body: string): Layer => ({ svg: svgDoc(ctx, `<g opacity="${fmt(op)}">${body}</g>`) });
        if (feel.base === "clean") {
          const mat = 8 * k, rad = 16 * k, M = { x: r.x - mat, y: r.y - mat, w: r.w + mat * 2, h: r.h + mat * 2 };
          layers.push(softShadow(ctx, M, rad + mat, { opacity: 0.28 * op, blur: 22, dy: 16 }, "pipsh"),
            g(`<rect ${rr(M)} rx="${fmt(rad + mat)}" fill="#FFFFFF"/><rect ${rr(M)} rx="${fmt(rad + mat)}" fill="none" stroke="rgba(17,24,39,0.10)" stroke-width="${fmt(1.5 * k)}"/>`),
            mediaLayer(pm, r, crop, rad, op));
        } else if (feel.base === "modern") {
          const rad = 20 * k;
          layers.push(softShadow(ctx, r, rad, { opacity: 0.6 * op, blur: 34, dy: 24, color: "#0A0418" }, "pipsh"), mediaLayer(pm, r, crop, rad, op),
            g(`<rect ${rr({ x: r.x - 3 * k, y: r.y - 3 * k, w: r.w + 6 * k, h: r.h + 6 * k })} rx="${fmt(rad + 3 * k)}" fill="none" stroke="${feel.color.accent}" stroke-width="${fmt(4 * k)}"/>`));
        } else if (feel.base === "professional") {
          const rad = feel.radius * k;
          layers.push(softShadow(ctx, r, rad, { opacity: 0.55 * op, blur: 26, dy: 14 }, "pipsh"), mediaLayer(pm, r, crop, rad, op),
            g(`<rect ${rr(r)} rx="${fmt(rad)}" fill="none" stroke="#CBD5E1" stroke-opacity="0.55" stroke-width="${fmt(1.5 * k)}"/>`));
        }
      }
    }
    return [...layers, ...f.caption];
  },
};
export default mod;
