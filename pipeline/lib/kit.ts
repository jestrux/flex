// The building blocks for a look's own cards and effects: timing, easing, text measuring and
// fitting, SVG text, the frame's background. Mechanics only — no built-in look's styling, so
// what you build looks like the product, not like our presets. See DESIGN.md.
export { clamp, lerp, prog, fmt, ease, spring, fadeInOut, rng, esc, drawOn, shadow, textWidth, cubicBezier } from "./effects/kit.ts";
export {
  W, layoutH, bgLayer, frameSvg, easeOf, exitU, inU, lsShift, fitSize, fitLines, widthOf, text, textLines, textAttrs, fam, letters, springRise, glowFilter,
  type TextOpts, type Pose,
} from "./presets/title-opening.ts";
export type { SceneCtx, Layer, Rect } from "./presets/types.ts";
/** an image's/video's pixel size (PNG/JPEG header, ffprobe) — e.g. the export's 6400×3600 for zoomToFull */
export { mediaSize } from "./presets/broll-still.ts";
export type { Ctx, EffectItem, Pt } from "./effects/types.ts";
export type { Feel } from "./feels.ts";

/** baselines that centre a block of text lines optically on cy (cap height ≈ 0.72 em; line pitch lh).
 *  centreBlock(H / 2, 3, 120, 126) → the 3 baselines, so the visible block sits centred, not high. */
export function centreBlock(cy: number, lines: number, size: number, lh = size * 1.05, cap = 0.72) {
  const h = cap * size + (lines - 1) * lh, top = cy - h / 2;
  return Array.from({ length: lines }, (_, i) => top + cap * size + i * lh);
}
/** lay rows out top-down with gaps and centre the whole stack on cy: give each row its height,
 *  get back each row's top. stack(H / 2, [kicker 28, title 2×126, sub 40], 18) */
/*  gap: one gap for all rows, or one per space between rows ([kicker→title, title→subtitle]) */
export function stack(cy: number, heights: number[], gap: number | number[] = 16) {
  const g = (i: number) => (Array.isArray(gap) ? gap[i] ?? gap[gap.length - 1] ?? 0 : gap);
  const total = heights.reduce((a, h) => a + h, 0) + heights.slice(1).reduce((a, _, i) => a + g(i), 0);
  let y = cy - total / 2;
  return heights.map((h, i) => { const top = y; y += h + g(i); return top; });
}

/** the payoff move: an image shown whole inside `frame` (layout px, 1920-wide) at u = 0, zooming
 *  smoothly (log-space) to a true 100% crop — one image pixel per output pixel — around `focus`
 *  (0..1 within the image) at u = 1, filling `to` (default: the whole frame; a band like
 *  { x: 0, y: 340, w: 1920, h: 400 } ends on a strip). Returns an image layer for this frame.
 *  imgW/imgH: the PNG's size (read it once with sharp's metadata()).
 *  o.keep: a box in IMAGE px (e.g. the headline + helper) that stays whole in the window at every
 *  frame of the move — with no `to`, the move ends on a band shaped like the box (nothing under the
 *  headline, like a laptop bezel, creeps in), inset from the frame's sides like a card (o.inset,
 *  default 64 — an edge-to-edge strip on the stage reads as a letterbox) with the look's corner
 *  radius (o.radius, layout px; the layer comes back with it — draw any shadow/backing on the
 *  returned rect with the same radius); the centre follows the zoom (the focus point stays put on screen) and is
 *  clamped so the box is never sliced. If the box is wider/taller than a 1:1 window, the end widens
 *  just enough to hold it (whole beats 1:1; it says so once).
 *    layers.push(zoomToFull(ctx, src, 6400, 3600, sheetRect, ease.inOut(prog(ctx.t, 1200, 2400)), { x: .5, y: .2 },
 *      { x: 0, y: 340, w: 1920, h: 400 }, { keep: { x: 1500, y: 300, w: 3400, h: 900 } }))  */
const zoomNotes = new Set<string>();
export function zoomToFull(ctx: import("./presets/types.ts").SceneCtx, src: string, imgW: number, imgH: number,
  frame: { x: number; y: number; w: number; h: number }, u: number, focus = { x: 0.5, y: 0.5 }, to?: { x: number; y: number; w: number; h: number },
  o: { keep?: { x: number; y: number; w: number; h: number }; clear?: { x: number; y: number; w: number; h: number }[]; inset?: number; radius?: number } = {}) {
  const k = ctx.out.w / 1920, t = Math.min(1, Math.max(0, u));
  const H = (1920 * ctx.out.h) / ctx.out.w;
  // with a kept box and no `to`, end on a band shaped like the box (+ margin), centred — a full 16:9
  // end would show whatever sits under the headline (a laptop bezel) as a dark band
  // the band is as tall, IN IMAGE PX, as the kept box plus a margin — so at the end nothing above or below
  // it shows (o.clear: boxes in image px the end window must not reach, e.g. the device under a headline)
  let bandH = H;
  const inset = o.keep && !to ? (o.inset ?? 64) : 0, bandW = 1920 - 2 * inset;
  if (o.keep) {
    const wImg = Math.max(bandW * k, o.keep.w * 1.06);
    // the margin around the box: 25 % (no clear boxes: a laptop bezel may sit just under it); with
    // clear boxes up to 60 %, as far as they allow — more air reads as a crop, not a strip
    let hImg = o.keep.h * (o.clear?.length ? 1.6 : 1.25);
    if (o.clear?.length) {
      const kcy = o.keep.y + o.keep.h / 2;
      const above = o.clear.filter((c) => c.y + c.h <= o.keep!.y + 1).map((c) => c.y + c.h), below = o.clear.filter((c) => c.y >= o.keep!.y + o.keep!.h - 1).map((c) => c.y);
      const room = 2 * Math.min(above.length ? kcy - Math.max(...above) : Infinity, below.length ? Math.min(...below) - kcy : Infinity);
      hImg = Math.max(o.keep.h * 1.02, Math.min(hImg, room - 4));
    }
    bandH = Math.min(H - 2 * inset, Math.round((hImg * bandW) / wImg));
  }
  const end = to ?? { x: inset, y: Math.round((H - bandH) / 2), w: bandW, h: bandH };
  // the on-screen rect moves from `frame` to `end`
  const R = { x: frame.x + (end.x - frame.x) * t, y: frame.y + (end.y - frame.y) * t, w: frame.w + (end.w - frame.w) * t, h: frame.h + (end.h - frame.h) * t };
  // the visible window in image pixels: whole image (fit to the rect's aspect) → output-sized window, in log space
  const aspect = R.w / R.h, endAspect = end.w / end.h, w0 = Math.min(imgW, imgH * aspect);
  let w1 = Math.min(w0, end.w * k);
  if (imgW < end.w * k * 0.97) { const n = `zoomToFull: the image is ${imgW} px wide — narrower than the ${Math.round(end.w * k)} px end, so the "100 %" end is an upscale (soft). Export bigger (the app's 3× scale) or end on a narrower band (to)`; if (!zoomNotes.has(n)) { zoomNotes.add(n); console.log(`  · ${n}`); } }
  const K = o.keep;
  if (K && o.clear?.some((c) => c.y < K.y + K.h - 1 && c.y + c.h > K.y + 1 && c.x < K.x + K.w && c.x + c.w > K.x)) { const n = `zoomToFull: a clear box overlaps the keep box — it's neither above nor below it, so it's ignored. Pad clear boxes away from the headline, not into it`; if (!zoomNotes.has(n)) { zoomNotes.add(n); console.warn(`  ! ${n}`); } }
  if (K && !to && !o.clear?.length) { const n = `zoomToFull: a keep box with no clear boxes — the window passes over whatever sits under the headline (a laptop bezel, the devices) on its way in. Pass clear: [the helper, the devices] (Hero: s.payoffBoxes() measures them)`; if (!zoomNotes.has(n)) { zoomNotes.add(n); console.log(`  · ${n}`); } }
  { const fa = frame.w / frame.h, ia = imgW / imgH; if (Math.abs(fa / ia - 1) > 0.03) { const n = `zoomToFull: frame ${Math.round(frame.w)}×${Math.round(frame.h)} isn't the image's shape (${imgW}×${imgH}) — at u = 0 the image is cropped to the frame, and a shadow drawn on the returned rect won't match the picture; give frame the image's aspect`; if (!zoomNotes.has(n)) { zoomNotes.add(n); console.log(`  · ${n}`); } } }
  if (K && to) { const need = (to.w * K.h * 1.25) / (K.w * 1.06); if (to.h > need * 1.3) { const n = `zoomToFull: your \`to\` band (${Math.round(to.h)} px tall) is taller than the kept box needs (≈ ${Math.round(need)} px) — the end crop shows what's above/below the headline (a laptop bezel). Drop \`to\` (it then ends on a box-shaped band) or use h ≈ ${Math.round(need)}`; if (!zoomNotes.has(n)) { zoomNotes.add(n); console.log(`  · ${n}`); } } }
  if (K) { // whole beats 1:1: widen the end window until the kept box fits (6% margin)
    const need = Math.max(K.w * 1.06, K.h * 1.02 * endAspect); // the height margin is already in the band (1.06 here overshot the band's clear room)
    if (need > w1) { const n = `zoomToFull: the kept box (${Math.round(K.w)}×${Math.round(K.h)} px) can't be whole at 1:1 in a ${Math.round(end.w * k)}×${Math.round(end.h * k)} window — ending at ${(end.w * k / need * 100).toFixed(0)}% instead`; if (!zoomNotes.has(n)) { zoomNotes.add(n); console.log(`  · ${n}`); } w1 = Math.min(imgW, need); }
  }
  const ww = Math.exp(Math.log(w0) + (Math.log(w1) - Math.log(w0)) * t); let wh = ww / aspect;
  // the centre follows the zoom (s = how much of the width change is done), so the focus point
  // drifts smoothly instead of racing ahead of the zoom and slicing the subject mid-move
  const s = w0 === w1 ? t : (w0 - ww) / (w0 - w1);
  // with a kept box the move ends centred ON it (focus only steers when there's no box)
  const fx = K ? K.x + K.w / 2 : focus.x * imgW, fy = K ? K.y + K.h / 2 : focus.y * imgH;
  let cx = imgW / 2 + (fx - imgW / 2) * s, cy = imgH / 2 + (fy - imgH / 2) * s;
  // clear boxes stay out of the window through the move too, as far as it can (the window is taller than
  // the end band until it lands: without this a laptop bezel creeps along its bottom in the last second)
  if (K && o.clear?.length) {
    for (const c of o.clear) {
      if (c.y >= K.y + K.h - 1 && cy + wh / 2 > c.y) cy = c.y - wh / 2; // below the box: lift the window
      if (c.y + c.h <= K.y + 1 && cy - wh / 2 < c.y + c.h) cy = c.y + c.h + wh / 2; // above: lower it
    }
  }
  if (K) { // keep the box inside the window (centre on it when it's bigger than the window) — the box wins
    cx = K.w <= ww ? Math.min(K.x + ww / 2, Math.max(K.x + K.w - ww / 2, cx)) : K.x + K.w / 2;
    cy = K.h <= wh ? Math.min(K.y + wh / 2, Math.max(K.y + K.h - wh / 2, cy)) : K.y + K.h / 2;
  }
  cx = Math.min(imgW - ww / 2, Math.max(ww / 2, cx)); cy = Math.min(imgH - wh / 2, Math.max(wh / 2, cy));
  // a clear box under the headline that the window can't rise away from (its top is at the image top): trim the
  // window's bottom instead — the shot gets shorter on screen a little early rather than dragging the laptop lid
  // along its bottom edge. The limit eases in (whole image at the start, the clear line by 60 % of the move).
  if (K && o.clear?.length && t > 0) {
    const below = o.clear.filter((c) => c.y >= K.y + K.h - 1).map((c) => c.y);
    if (below.length) {
      const lim = Math.min(...below), top = cy - wh / 2, over = cy + wh / 2 - lim;
      if (over > 0) {
        // a big slice of the devices is a picture; a thin strip along the bottom is a flaw: ramp the trim in as the
        // slice shrinks (≤ 80 % of the window → starts, ≤ 55 % → gone: the clear line sits ~130 px above the drawn lid, so a gentler ramp still left a lid strip), and by 60 % of the move at the latest
        const frac = over / wh, sr = Math.min(1, Math.max(0, (0.8 - frac) / 0.25)), st = Math.min(1, t / 0.6);
        const cut = over * Math.max(sr * sr * (3 - 2 * sr), st * st * (3 - 2 * st)), nh = wh - cut;
        if (cut > 0 && nh > K.y + K.h - top) { const f = nh / wh; R.y += (R.h * (1 - f)) / 2; R.h *= f; wh = nh; cy = top + nh / 2; }
      }
    }
  }
  return { image: src, rect: { x: R.x * k, y: R.y * k, w: R.w * k, h: R.h * k }, crop: { x: (cx - ww / 2) / imgW, y: (cy - wh / 2) / imgH, w: ww / imgW, h: wh / imgH }, radius: (o.radius ?? 0) * k, alpha: undefined as boolean | undefined };
}

/** the ink box of an SVG drawing (rendered once, trimmed to what's painted on a white ground): where
 *  the ink starts and how big it is, in the SVG's px. For measuring type/marks exactly (e.g. to align
 *  a word's ink to a logo). Uses the pipeline's sharp, so looks outside this repo don't need it. */
export async function inkBox(svg: string): Promise<{ left: number; top: number; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const { info } = await sharp(Buffer.from(svg), { density: 72 }).trim().toBuffer({ resolveWithObject: true });
  return { left: -(info.trimOffsetLeft ?? 0), top: -(info.trimOffsetTop ?? 0), width: info.width, height: info.height };
}

/** a CSS linear-gradient as an SVG <linearGradient>, mapped exactly the way CSS maps an angle onto a box
 *  (so a card's surface continues the product's own — e.g. an export's background — with no seam).
 *  deg: the CSS angle (165 for `linear-gradient(165deg, …)`); box: the shape it fills, in the SVG's px;
 *  stops: colours, evenly spaced, or [colour, offset 0..1] pairs.
 *    defs += cssGradient("sheet", 165, rect, ["#7c3aed", "#3b1a78"]) … fill="url(#sheet)" */
export function cssGradient(id: string, deg: number, box: { x: number; y: number; w: number; h: number }, stops: (string | [string, number])[]) {
  const a = (deg * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const L = Math.abs(box.w * dx) + Math.abs(box.h * dy), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const st = stops.map((s, i) => { const [c, o] = Array.isArray(s) ? s : [s, stops.length > 1 ? i / (stops.length - 1) : 0]; return `<stop offset="${+o.toFixed(4)}" stop-color="${c}"/>`; }).join("");
  const f = (n: number) => +n.toFixed(2);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(cx - (dx * L) / 2)}" y1="${f(cy - (dy * L) / 2)}" x2="${f(cx + (dx * L) / 2)}" y2="${f(cy + (dy * L) / 2)}">${st}</linearGradient>`;
}

/** the payoff move in TWO phases, for a headline with devices under it (Hero exports): the whole file, then its
 *  bottom edge rises to the strip the headline lives in (cu 0→1: the devices leave as a crop — no thin lid strip, no
 *  squash), then a log-space zoom of that strip to a true 1:1 band of the kept box (zu 0→1), inset like a card.
 *  frame: the whole file's rect (layout px, the image's aspect); keep/clear in image px (s.payoffBoxes()).
 *    const cu = ease.inOut(prog(ctx.t, 1200, 700)), zu = ease.inOut(prog(ctx.t, 2200, 2800));
 *    layers.push(cropZoom(ctx, src, 6400, 3600, rect, cu, zu, { keep, clear, radius: 16 }))   (after r39's teaser) */
export function cropZoom(ctx: import("./presets/types.ts").SceneCtx, src: string, imgW: number, imgH: number,
  frame: { x: number; y: number; w: number; h: number }, cu: number, zu: number,
  o: { keep: { x: number; y: number; w: number; h: number }; clear?: { x: number; y: number; w: number; h: number }[]; inset?: number; radius?: number }) {
  const k = ctx.out.w / 1920, H = (1920 * ctx.out.h) / ctx.out.w, K = o.keep;
  cu = Math.min(1, Math.max(0, cu)); zu = Math.min(1, Math.max(0, zu));
  const below = (o.clear ?? []).filter((c) => c.y >= K.y + K.h - 1).map((c) => c.y);
  const floorY = below.length ? Math.min(...below) : Math.min(imgH, K.y + K.h * 1.4);
  const inset = o.inset ?? 64, bandW = 1920 - 2 * inset, kcy = K.y + K.h / 2, kcx = K.x + K.w / 2;
  const endH = Math.max(K.h * 1.02, Math.min(K.h * 1.6, 2 * (floorY - kcy) - 4));
  // a keep too tall for a 1:1 band (a board's slide) ends as a narrower card around it, below 1:1, never past the frame
  const wide = Math.max(bandW * k, K.w * 1.06), tall = endH * (bandW / wide) > H - 2 * inset;
  const endW = tall ? Math.min(wide, K.w * 1.06) : wide, sEnd = tall ? (H - 2 * inset) / endH : bandW / endW;
  // the crop phase narrows the window too (the sides of the headline's strip are plain background), so the strip
  // grows on screen as the devices leave instead of shrinking to a thin letterbox (r41); its width stays frame.w
  // …narrowing just enough that the crop ends at the end band's on-screen height: the zoom phase then only widens and
  // sharpens it (a geometric-mean W1 ended the crop on a smaller card that grew again — a visible dip, r45)
  const W1 = Math.min(imgW, Math.max(K.w * 1.1, (floorY * frame.w) / (endH * sEnd)));
  // …but never taller than the frame's room (a keep that fills the file's height: nothing to crop, only to narrow)
  const hMax = Math.max(frame.h, H - 2 * inset), s1 = Math.min(frame.w / W1, hMax / floorY);
  const lg = (a: number, c: number, t: number) => Math.exp(Math.log(a) + (Math.log(c) - Math.log(a)) * t);
  let rect: { x: number; y: number; w: number; h: number }, crop: { x: number; y: number; w: number; h: number };
  // the strip's centre glides to the frame's centre while the devices crop away (parked at the top it read as a letterbox, r40)
  const fc = frame.y + frame.h / 2;
  if (zu <= 0) {
    // the card's on-screen height and width each glide (log) from the whole file to the crop's end — never a bump
    const y1 = imgH + (floorY - imgH) * cu, s = lg(frame.h, floorY * s1, cu) / y1, w1 = Math.min(imgW, Math.max(K.w * 1.05, lg(frame.w, W1 * s1, cu) / s));
    const cx = imgW / 2 + (kcx - imgW / 2) * cu, x0 = Math.min(imgW - w1, Math.max(0, cx - w1 / 2));
    const h = y1 * s, c = fc + (H / 2 - fc) * cu;
    rect = { x: frame.x + (frame.w - w1 * s) / 2, y: c - h / 2, w: w1 * s, h }; crop = { x: x0 / imgW, y: 0, w: w1 / imgW, h: y1 / imgH };
  } else {
    const ww = lg(W1, endW, zu), wh = lg(floorY, endH, zu);
    const bottom = floorY + (kcy + endH / 2 - floorY) * zu, s = lg(s1, sEnd, zu);
    const rw = ww * s, rh = wh * s;
    rect = { x: frame.x + frame.w / 2 + (960 - frame.x - frame.w / 2) * zu - rw / 2, y: H / 2 - rh / 2, w: rw, h: rh };
    const x0 = Math.min(imgW - ww, Math.max(0, kcx - ww / 2)), y0 = Math.max(0, bottom - wh);
    crop = { x: x0 / imgW, y: y0 / imgH, w: ww / imgW, h: wh / imgH };
  }
  return { image: src, rect: { x: rect.x * k, y: rect.y * k, w: rect.w * k, h: rect.h * k }, crop, radius: (o.radius ?? 0) * k, alpha: undefined as boolean | undefined };
}

/** a fine, zero-mean grain for a big gradient, to break up banding (8-bit gradients band in the PNG
 *  and again in the encode). Repair, not decoration (DESIGN rule 10). Returns <filter> defs; put them
 *  in your SVG's defs and apply the filter ON the gradient shape — it adds ±amount/2 noise around the
 *  colour, so the gradient's average colour doesn't shift:
 *    frameSvg(ctx, `<rect … fill="url(#sheet)" filter="url(#grain)"/>`, gradientDefs + grainFilter("grain", .05)) */
export function grainFilter(id = "grain", amount = 0.05) {
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1" result="g"/><feComposite in="SourceGraphic" in2="g" operator="arithmetic" k1="0" k2="1" k3="${amount}" k4="${-amount / 2}"/></filter>`;
}
