// Still in a device — Phase 5 lane G. The still inside a simple SVG device (phone or laptop;
// params.device, default auto: tall → phone) centred on the feel's canvas, scaling/rising in
// and then floating gently. The image layer sits in the screen rect with the screen's radius;
// the bezel is an SVG layer on top with the screen cut out (even-odd).
//   clean: silver aluminium, soft shadow · modern: midnight with a lime/pink glow behind ·
//   professional: space grey, restrained
import type { CardModule, Layer, Rect, SceneCtx } from "./types.ts";
import { clamp, fmt, lerp } from "../effects/kit.ts";
import { caption, coverCrop, easeOf, feelBg, kOf, media, mediaLayer, softShadow, svgDoc } from "./broll-still.ts";

const rrPath = (r: Rect, rad: number) => {
  const { x, y, w, h } = r, q = Math.min(rad, w / 2, h / 2);
  return `M${fmt(x + q)} ${fmt(y)}H${fmt(x + w - q)}A${fmt(q)} ${fmt(q)} 0 0 1 ${fmt(x + w)} ${fmt(y + q)}V${fmt(y + h - q)}A${fmt(q)} ${fmt(q)} 0 0 1 ${fmt(x + w - q)} ${fmt(y + h)}H${fmt(x + q)}A${fmt(q)} ${fmt(q)} 0 0 1 ${fmt(x)} ${fmt(y + h - q)}V${fmt(y + q)}A${fmt(q)} ${fmt(q)} 0 0 1 ${fmt(x + q)} ${fmt(y)}Z`;
};

type Mat = { frame: string; frameEdge: string; glass: string; base: [string, string]; notch: string; sheen: number };
const MATS: Record<string, Mat> = {
  clean: { frame: "#D7DAE0", frameEdge: "#B8BDC6", glass: "#0B0B0F", base: ["#EEF0F3", "#C3C8D0"], notch: "#AEB4BE", sheen: 0.12 },
  modern: { frame: "#2A2342", frameEdge: "#4B3F73", glass: "#07060C", base: ["#3A3158", "#1C1730"], notch: "#120E22", sheen: 0.1 },
  professional: { frame: "#4B5563", frameEdge: "#6B7280", glass: "#0A0D12", base: ["#9CA3AF", "#5B6370"], notch: "#4B5563", sheen: 0.08 },
};

function glow(ctx: SceneCtx, cx: number, cy: number, r: number, op: number): Layer {
  const id = `${ctx.uid}-dglow`;
  return { svg: svgDoc(ctx, `<defs><radialGradient id="${id}"><stop offset="0" stop-color="#C4F042" stop-opacity="${fmt(0.38 * op)}"/><stop offset="0.45" stop-color="#EC4899" stop-opacity="${fmt(0.22 * op)}"/><stop offset="1" stop-color="#EC4899" stop-opacity="0"/></radialGradient></defs>`
    + `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(r * 1.25)}" ry="${fmt(r)}" fill="url(#${id})"/>`) };
}

const mod: CardModule = {
  kind: "broll", type: "broll-device", label: "Still in a device",
  defaults: { src: "assets/broll/pair.png", device: "auto" },
  dur: 3500,
  render(params, ctx) {
    const { feel, out, t } = ctx, k = kOf(ctx), W = out.w, H = out.h, cap = !!params.caption;
    const m = media(params.src, ctx, Number(params.start ?? 0));
    const dev = params.device === "phone" || params.device === "laptop" ? params.device : m.h > m.w * 1.15 ? "phone" : "laptop";
    const mat = MATS[feel.base] ?? MATS.clean;
    // motion: scale + rise in, then a slow float; slow push inside the screen
    const e = easeOf(feel)(clamp(t / (feel.motion.in * 1.5)));
    const s = lerp(0.9, 1, e), rise = (1 - e) * 48 * k;
    const float = Math.sin((t / 3200) * 2 * Math.PI) * 7 * k * clamp(t / 800);
    const zoom = 1 + 0.03 * clamp(t / Math.max(1, ctx.dur));
    const fy = Number(params.focusY ?? 0);
    const cy0 = H * (cap ? 0.45 : 0.5) + rise + float, cx0 = W / 2;
    const sc = (v: number) => v * k * s;
    const layers: Layer[] = [feelBg(ctx)];

    if (dev === "phone") {
      const sh = sc(cap ? 800 : 860), sw = sh * (9 / 19.5), bz = sc(14), fr = sc(5);
      const screen: Rect = { x: cx0 - sw / 2, y: cy0 - sh / 2, w: sw, h: sh };
      const outer: Rect = { x: screen.x - bz - fr, y: screen.y - bz - fr, w: sw + (bz + fr) * 2, h: sh + (bz + fr) * 2 };
      const sRad = sc(46), oRad = sRad + bz + fr;
      if (feel.base === "modern") layers.push(glow(ctx, cx0, cy0, sh * 0.62, 1));
      layers.push(softShadow(ctx, outer, oRad, { opacity: feel.base === "clean" ? 0.25 : 0.55, blur: 34, dy: 28, color: feel.base === "modern" ? "#0A0418" : "#000" }, "dsh"));
      layers.push(mediaLayer(m, screen, coverCrop(m.w, m.h, sw, sh, zoom, 0.5, fy), sRad));
      const isl = { w: sc(96), h: sc(28) }, iy = screen.y + sc(14), id = `${ctx.uid}-sheen`;
      const btn = (x: number, y: number, h: number) => `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(sc(4))}" height="${fmt(h)}" rx="${fmt(sc(2))}" fill="${mat.frameEdge}"/>`;
      layers.push({ svg: svgDoc(ctx,
        `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${mat.sheen}"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>`
        + (btn(outer.x - sc(3), outer.y + sh * 0.2, sc(60)) + btn(outer.x - sc(3), outer.y + sh * 0.3, sc(60)) + btn(outer.x + outer.w - sc(1), outer.y + sh * 0.26, sc(90)))
        + `<path fill-rule="evenodd" fill="${mat.frame}" d="${rrPath(outer, oRad)} ${rrPath({ x: screen.x - bz, y: screen.y - bz, w: sw + bz * 2, h: sh + bz * 2 }, sRad + bz)}"/>`
        + `<path fill-rule="evenodd" fill="${mat.glass}" d="${rrPath({ x: screen.x - bz, y: screen.y - bz, w: sw + bz * 2, h: sh + bz * 2 }, sRad + bz)} ${rrPath(screen, sRad)}"/>`
        + (`<path fill="none" stroke="${mat.frameEdge}" stroke-width="${fmt(sc(1.5))}" d="${rrPath(outer, oRad)}"/>`)
        + `<rect x="${fmt(cx0 - isl.w / 2)}" y="${fmt(iy)}" width="${fmt(isl.w)}" height="${fmt(isl.h)}" rx="${fmt(isl.h / 2)}" fill="#000"/>`
        + (mat.sheen ? `<path fill="url(#${id})" d="${rrPath(screen, sRad)}"/>` : "")) });
      layers.push(...caption(ctx, params.caption, { below: outer.y + outer.h + 58 * k }));
      return layers;
    }

    // laptop: lid (glass bezel in a thin frame) + a wider base with a thumb notch
    const sw = sc(cap ? 1000 : 1100), sh = sw * 0.625, bz = sc(20), top = sc(26), fr = sc(4);
    const lidH = sh + top + bz + fr * 2, lidW = sw + (bz + fr) * 2, baseH = sc(24), baseW = lidW * 1.16;
    const gy = cy0 - (lidH + baseH) / 2;
    const lid: Rect = { x: cx0 - lidW / 2, y: gy, w: lidW, h: lidH };
    const screen: Rect = { x: lid.x + fr + bz, y: lid.y + fr + top, w: sw, h: sh };
    const base: Rect = { x: cx0 - baseW / 2, y: lid.y + lidH, w: baseW, h: baseH };
    const lRad = sc(22), sRad = sc(6);
    const all: Rect = { x: base.x, y: lid.y, w: baseW, h: lidH + baseH };
    if (feel.base === "modern") layers.push(glow(ctx, cx0, cy0, sh * 0.75, 1));
    layers.push(...([softShadow(ctx, { ...all, x: all.x + sc(30), w: all.w - sc(60) }, sc(30), { opacity: feel.base === "clean" ? 0.24 : 0.55, blur: 36, dy: 26, color: feel.base === "modern" ? "#0A0418" : "#000" }, "dsh")]));
    layers.push(mediaLayer(m, screen, coverCrop(m.w, m.h, sw, sh, zoom, 0.5, fy), sRad));
    const id = `${ctx.uid}-lsheen`, bid = `${ctx.uid}-lbase`;
    const inner: Rect = { x: lid.x + fr, y: lid.y + fr, w: lidW - fr * 2, h: lidH - fr * 2 };
    const baseD = `M${fmt(base.x)} ${fmt(base.y)}H${fmt(base.x + base.w)}V${fmt(base.y + base.h * 0.45)}Q${fmt(base.x + base.w)} ${fmt(base.y + base.h)} ${fmt(base.x + base.w - base.h * 2.2)} ${fmt(base.y + base.h)}H${fmt(base.x + base.h * 2.2)}Q${fmt(base.x)} ${fmt(base.y + base.h)} ${fmt(base.x)} ${fmt(base.y + base.h * 0.45)}Z`;
    const notchW = sc(170);
    layers.push({ svg: svgDoc(ctx,
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${mat.sheen}"/><stop offset="0.4" stop-color="#fff" stop-opacity="0"/></linearGradient>`
      + `<linearGradient id="${bid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mat.base[0]}"/><stop offset="1" stop-color="${mat.base[1]}"/></linearGradient></defs>`
      + `<path fill-rule="evenodd" fill="${mat.frame}" d="${rrPath(lid, lRad)} ${rrPath(inner, Math.max(0, lRad - fr))}"/>`
      + `<path fill-rule="evenodd" fill="${mat.glass}" d="${rrPath(inner, Math.max(0, lRad - fr))} ${rrPath(screen, sRad)}"/>`
      + `<circle cx="${fmt(cx0)}" cy="${fmt(lid.y + fr + top / 2)}" r="${fmt(sc(4))}" fill="#26262c"/>`
      + `<path d="${baseD}" fill="url(#${bid})"/>`
      + (`<rect x="${fmt(base.x)}" y="${fmt(base.y)}" width="${fmt(base.w)}" height="${fmt(sc(2))}" fill="#fff" fill-opacity="0.35"/><path d="M${fmt(cx0 - notchW / 2)} ${fmt(base.y)}h${fmt(notchW)}v${fmt(sc(4))}a${fmt(sc(5))} ${fmt(sc(5))} 0 0 1 ${fmt(-sc(5))} ${fmt(sc(5))}h${fmt(-(notchW - sc(10)))}a${fmt(sc(5))} ${fmt(sc(5))} 0 0 1 ${fmt(-sc(5))} ${fmt(-sc(5))}Z" fill="${mat.notch}"/>`)
      + (mat.sheen ? `<path fill="url(#${id})" d="${rrPath(screen, sRad)}"/>` : "")) });
    layers.push(...caption(ctx, params.caption, { below: base.y + base.h + 58 * k }));
    return layers;
  },
};
export default mod;
