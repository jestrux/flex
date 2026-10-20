// A take's frame as layers, for Flex's painter: what the pipeline's render.ts composites per frame (lib/render.ts
// `frame`), expressed as the pipeline's Layer[] instead of pixels. Order, lowest first, as render.ts:
//   the stage (background, panel, window shadow) · the recording (rounded, in the window) · the animated stage grid
//   (outside the window) and the window border · the take's effects · the click ripple · the cursor (and its trail).
// Everything is in a 1920 × 1080 layout frame; the painter scales it to any width.
//
// This mirrors render.ts on purpose and must stay in step with it: `flex diff` against the pipeline's render checks it
// (docs/pipeline-seam.md). Raster-only effects (composePre, e.g. blur-focus) are not layers yet: they are reported, not
// drawn.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PIPE = process.env.FLEX_PIPELINE!;               // Flex's copy of the pipeline (pipeline/)
const imp = (p: string) => import(pathToFileURL(join(PIPE, p)).href);
const { makeCamera } = await imp("lib/camera.ts");
const { composeEffects, composePre } = await imp("lib/effects/compose.ts");
const { backgroundOf, backgroundSvg, panelSvg, shadowSvg } = await imp("lib/canvas.ts");
const { slashGridSvg } = await imp("lib/slashgrid.ts");
const { feelOf } = await imp("lib/feels.ts");
const { CURSORS, CURSOR, ripple, pressScale } = await imp("lib/render.ts");

// the film's frame: FLEX_FRAME=WxH for a vertical film (frame.json, set by the engine), else 1920 × 1080
const [FW, FH] = /^\d+x\d+$/.test(process.env.FLEX_FRAME ?? "") ? process.env.FLEX_FRAME!.split("x").map(Number) : [1920, 1080];
const OUT = { w: FW, h: FH };
type Layer = { svg: string } | { image: string; rect: { x: number; y: number; w: number; h: number }; radius?: number; alpha?: boolean };

/** strip the outer <svg …> … </svg> of a whole document, keeping what's inside */
const inner = (doc: string) => doc.replace(/^\s*<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const frameSvg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT.w}" height="${OUT.h}" viewBox="0 0 ${OUT.w} ${OUT.h}">${body}</svg>`;

type TakeOpts = { take: string; dir: string; edl: Record<string, unknown> };

/** one take, opened once: its events, its edl (with the sequence's overrides), its camera and cursor timing */
export function openTake(o: TakeOpts) {
  const ev = JSON.parse(readFileSync(join(o.dir, "events.json"), "utf8"));
  const edl = { ...JSON.parse(readFileSync(join(o.dir, "edl.json"), "utf8")), ...o.edl };
  const { w: W, h: H } = ev.viewport;
  const cam = makeCamera(edl, W, H);
  const freeze = ev.freeze ?? [];
  const frameAt = (t0: number) => {
    const fz = freeze.find((f: any) => t0 >= f.from && t0 < f.to); const t = fz ? fz.from - 1 : t0;
    let lo = 0, hi = ev.frames.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ev.frames[m].t <= t) lo = m; else hi = m - 1; }
    return ev.frames[lo];
  };
  const moves = ev.cursor.filter((c: any, i: number, a: any[]) => i === 0 || Math.hypot(c.x - a[i - 1].x, c.y - a[i - 1].y) > 0.5).map((c: any) => c.t)
    .concat(ev.clicks.map((c: any) => c.t)).sort((a: number, b: number) => a - b);
  const lastMove = (t: number) => { let lo = 0, hi = moves.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (moves[m] <= t) { r = moves[m]; lo = m + 1; } else hi = m - 1; } return r; };
  const nextMove = (t: number) => moves.find((m: number) => m > t) ?? Infinity;
  const cursorAlpha = (t: number) => {
    if (edl.cursor === false) return 0;
    const idle = t - lastMove(t), back = nextMove(t) - t;
    const hide = idle > CURSOR.idleHideAfter ? Math.min(1, (idle - CURSOR.idleHideAfter) / CURSOR.idleFade) : 0;
    const show = back < CURSOR.showFade && idle > CURSOR.idleHideAfter ? 1 - back / CURSOR.showFade : 0;
    return Math.max(0, 1 - hide + show * hide);
  };
  const cursorAt = (t: number) => {
    const c = ev.cursor; if (!c.length) return null;
    const i = c.findIndex((p: any) => p.t > t);
    if (i === 0) return { ...c[0], k: c[0].k ?? "arrow" }; if (i < 0) return { ...c[c.length - 1], k: c[c.length - 1].k ?? "arrow" };
    const a = c[i - 1], b = c[i], u = (t - a.t) / Math.max(1, b.t - a.t);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, k: a.k ?? "arrow" };
  };
  return { ev, edl, W, H, cam, frameAt, cursorAlpha, cursorAt, dir: o.dir };
}
export type OpenTake = ReturnType<typeof openTake>;

/** the take's layers at take time t (ms); from = the clip's start in the take (ms, for the grid's film-time phase) */
export function takeLayers(tk: OpenTake, t: number, from: number): { layers: Layer[]; warnings: string[] } {
  const { ev, edl, W, H, cam } = tk, warnings: string[] = [];
  const c = cam.at(t), r = cam.crop(c), world = cam.world;
  const z = OUT.w / r.w;                                     // layout px per CSS px at this zoom
  const canvas = edl.canvas?.on ? edl.canvas : null;
  const layers: Layer[] = [];
  const toOut = (wx: number, wy: number) => ({ x: (wx - r.x) * z, y: (wy - r.y) * z });

  // 1 · the stage: background, panel, window shadow, drawn over the whole world at this zoom
  if (canvas) {
    const bg = backgroundOf(canvas), ww = world.w * z, wh = world.h * z, o = toOut(world.x, world.y);
    const href = bg.type === "image" ? `data:image/${bg.src.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(bg.src).toString("base64")}` : undefined;
    let body = `<g transform="translate(${o.x.toFixed(3)} ${o.y.toFixed(3)})"><svg x="0" y="0" width="${ww}" height="${wh}">${inner(backgroundSvg(bg, ww, wh, href))}</svg>`;
    if (canvas.panel) body += `<svg x="0" y="0" width="${ww}" height="${wh}">${inner(panelSvg(canvas, W, H, z))}</svg>`;
    if (canvas.shadow) body += `<svg x="0" y="0" width="${ww}" height="${wh}">${inner(shadowSvg(canvas, W, H, z))}</svg>`;
    layers.push({ svg: frameSvg(body + "</g>") });
  }

  // 2 · the recording, rounded, where the window sits in the world (or filling the frame with the canvas off)
  const f = tk.frameAt(t), rec = toOut(canvas ? world.x + world.mx : 0, canvas ? world.y + world.my : 0);
  layers.push({ image: join(tk.dir, "frames", f.file), rect: { x: rec.x, y: rec.y, w: W * z, h: H * z }, radius: canvas ? canvas.radius * z : 0, alpha: false });

  // 3 · the stage's animated parts: the slash grid (outside the window) and the window border
  if (canvas) {
    const bgA = backgroundOf(canvas), sg = bgA.type !== "image" ? bgA.slashgrid : undefined, bd = canvas.border;
    if (sg || bd) {
      const g = 1920 / world.w;
      const wx = (0 - r.x) * z, wy = (0 - r.y) * z, ww = W * z, wh = H * z, wr = canvas.radius * z;
      const rr = (x: number, y: number, w: number, h: number, q: number) => `M${x + q} ${y}H${x + w - q}A${q} ${q} 0 0 1 ${x + w} ${y + q}V${y + h - q}A${q} ${q} 0 0 1 ${x + w - q} ${y + h}H${x + q}A${q} ${q} 0 0 1 ${x} ${y + h - q}V${y + q}A${q} ${q} 0 0 1 ${x + q} ${y}Z`;
      let svg = "";
      if (sg) {
        const tg = (canvas.phase ?? 0) + (t - from);
        svg += `<defs><clipPath id="og"><path fill-rule="evenodd" clip-rule="evenodd" d="M-10 -10H${OUT.w + 10}V${OUT.h + 10}H-10Z ${rr(wx, wy, ww, wh, wr)}"/></clipPath></defs>`
          + `<g clip-path="url(#og)">${slashGridSvg(tg, { ...sg, w: 1920, h: 1080, view: { x: (r.x - world.x) * g, y: (r.y - world.y) * g, scale: world.w / r.w } })}</g>`;
      }
      if (bd) { const bw = bd.width * (world.w / r.w); svg += `<path d="${rr(wx - bw / 2, wy - bw / 2, ww + bw, wh + bw, wr + bw / 2)}" fill="none" stroke="${bd.color}" stroke-opacity="${bd.opacity ?? 1}" stroke-width="${bw.toFixed(2)}"/>`; }
      layers.push({ svg: frameSvg(svg) });
    }
  }

  // 4 · the take's effects (arrows, steps, chapters, lifts …), in output px
  const fctx = { crop: r, view: { w: W, h: H }, out: OUT, cursor: ev.cursor, feel: feelOf(edl.feel) };
  const fx = composeEffects(edl.effects, t, fctx);
  if (fx) layers.push({ svg: fx });
  const pre = composePre(edl.effects, t, fctx);
  if (pre.length) warnings.push(`take ${f.file}: ${pre.length} raster effect(s) (blur-focus) not drawn yet`);

  // 5 · the click ripple and the cursor (with a faint trail on fast moves)
  const p = tk.cursorAt(t), clk = feelOf(edl.feel).click;
  if (p) {
    const at = (svg: string, x: number, y: number, size: number) => frameSvg(`<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${inner(svg)}</svg>`);
    const click = ev.clicks.find((cl: any) => t >= cl.t && t - cl.t < 500);
    if (click) {
      const prog = (t - click.t) / 500, rs = Math.round(70 * Math.min(1.6, z / (OUT.w / W)));
      layers.push({ svg: at(ripple(rs, prog, clk?.ripple).toString(), Math.round((click.x - r.x) * z - rs / 2), Math.round((click.y - r.y) * z - rs / 2), rs) });
    }
    const press = click ? pressScale(t - click.t, clk?.press) : 1;
    const size = Math.round(40 * Math.sqrt(z / (OUT.w / W)) * press);
    const hot = CURSORS[p.k as keyof typeof CURSORS].hot, alpha = tk.cursorAlpha(t);
    const cursor = (q: { x: number; y: number }, a: number) => {
      if (a <= 0.01) return;
      const cx = Math.round((q.x - r.x) * z - (size * hot[0]) / 32), cy = Math.round((q.y - r.y) * z - (size * hot[1]) / 32);
      layers.push({ svg: frameSvg(`<svg x="${cx}" y="${cy}" width="${size}" height="${size}" viewBox="0 0 32 32"><g opacity="${a.toFixed(3)}"><filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.3" flood-opacity=".35"/></filter>${CURSORS[p.k as keyof typeof CURSORS].body}</g></svg>`) });
    };
    const prev = tk.cursorAt(t - 30), speed = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) / 0.03 : 0;
    if (speed > CURSOR.trailSpeed && alpha > 0.5)
      for (let g = CURSOR.trailGhosts; g >= 1; g--) { const q = tk.cursorAt(t - g * CURSOR.trailStepMs); if (q) cursor(q, 0.16 * (1 - g / (CURSOR.trailGhosts + 1)) * alpha); }
    cursor(p, alpha);
  }
  return { layers, warnings };
}
