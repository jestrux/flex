// Render: frames + edl.json → takes/<take>/video.mp4 (1080p30, no audio).
// For each output frame: pick the source frame showing at that time, crop it with the camera
// (eased, clamped), scale to 1920×1080, draw the cursor (+ click ripple) on top, and pipe to
// ffmpeg. Source frames are 2×, so zooms up to ~1.5× are 1:1 or better and 2× stays sharp.
//
//   npx tsx lib/render.ts <take> [--fps 30] [--from 0 --to 20]   (seconds, for quick checks)
import "./looks.ts"; // register looks/*.ts
import sharp from "sharp";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needDisk } from "./disk.ts";
import type { Events } from "./capture.ts";
import type { Edl } from "./plan.ts";
import { makeCamera } from "./camera.ts";
import { composeEffects, composePre } from "./effects/compose.ts";
import { backgroundOf, backgroundSvg, panelSvg, roundMaskSvg, shadowSvg } from "./canvas.ts";
import { slashGridSvg } from "./slashgrid.ts";
import { OUT, OUT_K } from "./output.ts";
import { feelOf } from "./feels.ts";

const OUT_W = OUT.w, OUT_H = OUT.h; // lib/output.ts (OUT_SIZE)
const arg = (k: string, d: number) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? Number(process.argv[i + 1]) : d; };

// macOS-style cursors (arrow, pointing hand, I-beam) in a 32-unit box, scaled per frame.
// hot = the hotspot in box units (where the pointer actually is).
export type CursorKind = "arrow" | "hand" | "text";
const SHADOW = `<filter id="s" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.3" flood-opacity=".35"/></filter>`;
export const CURSORS: Record<CursorKind, { hot: [number, number]; body: string }> = {
  arrow: { hot: [6, 3.5], body: `<path filter="url(#s)" d="M6 3.5 L6 25.5 L11.2 20.6 L14.6 28.3 L18.4 26.7 L15.1 19.1 L22.2 19.1 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>` },
  hand: { hot: [13.2, 3.2], body: `<path filter="url(#s)" d="M11.4 4.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v8.2l.2-.1c.3-.9 1-1.5 1.9-1.5.9 0 1.6.6 1.9 1.4.4-.4.9-.6 1.5-.6.9 0 1.7.6 1.9 1.5.3-.2.7-.3 1.1-.3 1.1 0 2 .9 2 2v5.4c0 4.1-3.3 7.4-7.4 7.4h-1.5c-2.3 0-4.4-1.1-5.8-2.9l-4.1-5.6c-.6-.8-.5-2 .3-2.6.8-.6 1.9-.5 2.5.2l1.9 2.1z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<path d="M15.2 13.4v4.4M18.9 13.6v4.2M22.4 14.6v3.4" stroke="#111" stroke-width="1.2" stroke-linecap="round" fill="none"/>` },
  text: { hot: [16, 16], body: `<g filter="url(#s)"><path d="M12.5 6.5c1.6 0 2.9.4 3.5 1.2.6-.8 1.9-1.2 3.5-1.2M12.5 25.5c1.6 0 2.9-.4 3.5-1.2.6.8 1.9 1.2 3.5 1.2M16 7.7v16.6M13.6 16h4.8" stroke="#fff" stroke-width="3.4" fill="none" stroke-linecap="round"/>`
    + `<path d="M12.5 6.5c1.6 0 2.9.4 3.5 1.2.6-.8 1.9-1.2 3.5-1.2M12.5 25.5c1.6 0 2.9-.4 3.5-1.2.6.8 1.9 1.2 3.5 1.2M16 7.7v16.6M13.6 16h4.8" stroke="#111" stroke-width="1.5" fill="none" stroke-linecap="round"/></g>` },
};
export const CURSOR_SVG = (px: number, k: CursorKind = "arrow", opacity = 1) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32"><g opacity="${opacity.toFixed(3)}">${SHADOW}${CURSORS[k].body}</g></svg>`);
/** cursor polish: idle hide (Screen Studio style) and a soft trail on fast moves */
export const CURSOR = { idleHideAfter: 3200, idleFade: 450, showFade: 160, trailSpeed: 1400 /* CSS px/s */, trailGhosts: 3, trailStepMs: 14 };
const rgb = (hex: string) => { const h = hex.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(","); };
export const ripple = (px: number, p: number, color = "#7C3AED") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">
  <circle cx="${px / 2}" cy="${px / 2}" r="${(px / 2 - 3) * (0.25 + 0.75 * p)}" fill="rgba(${rgb(color)},${0.22 * (1 - p)})" stroke="rgba(${rgb(color)},${0.7 * (1 - p)})" stroke-width="3"/></svg>`);
/** the cursor's scale dt ms after a click: "snap" = 0.86 for 130 ms; "spring" = down to 0.8 in 70 ms, then a damped
 *  spring back (a touch of overshoot), settled by ≈ 350 ms */
export function pressScale(dt: number, mode: "snap" | "spring" = "snap") {
  if (dt < 0) return 1;
  if (mode === "snap") return dt < 130 ? 0.86 : 1;
  if (dt < 70) return 1 - 0.2 * Math.sin((Math.PI / 2) * (dt / 70));
  return 1 - 0.2 * Math.exp(-(dt - 70) / 90) * Math.cos((dt - 70) / 55);
}

/** o.edl overrides fields of the take's edl.json (e.g. feel, canvas); o.out writes elsewhere; o.from/o.to in seconds */
export async function render(take: string, o: { edl?: Partial<Edl>; out?: string; from?: number; to?: number; pad?: number; quiet?: boolean } = {}) {
  needDisk(join(import.meta.dirname, ".."), 0.4, "render");
  const dir = join(process.env.FLEX_TAKES ?? join(import.meta.dirname, "..", "takes"), take);
  const ev: Events = JSON.parse(readFileSync(join(dir, "events.json"), "utf8"));
  const edl: Edl = { ...JSON.parse(readFileSync(join(dir, "edl.json"), "utf8")), ...(o.edl ?? {}) };
  const { w: W, h: H } = ev.viewport;
  const cam = makeCamera(edl, W, H);
  const fps = arg("fps", 30);
  const from = (o.from ?? arg("from", 0)) * 1000, to = Math.min(ev.duration, (o.to ?? arg("to", ev.duration / 1000)) * 1000);
  const n = Math.round(((to - from) / 1000 + (o.pad ?? 0)) * fps); // pad: hold the last frame (cut-to-music); round, not floor — the sequence sizes clips in whole frames
  const meta = await sharp(join(dir, "frames", ev.frames[0].file)).metadata();
  const SW = meta.width!, SH = meta.height!, k = SW / W; // source px per CSS px
  console.log(`● rendering ${take}: ${n} frames @${fps}fps from ${SW}×${SH} source`);

  const freeze = ev.freeze ?? [];
  const frameAt = (t0: number) => {
    const fz = freeze.find((f) => t0 >= f.from && t0 < f.to); const t = fz ? fz.from - 1 : t0; let lo = 0, hi = ev.frames.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ev.frames[m].t <= t) lo = m; else hi = m - 1; } return ev.frames[lo]; };
  // ms since the cursor last moved (or clicked) — drives idle hide
  const moves = ev.cursor.filter((c, i, a) => i === 0 || Math.hypot(c.x - a[i - 1].x, c.y - a[i - 1].y) > 0.5).map((c) => c.t).concat(ev.clicks.map((c) => c.t)).sort((a, b) => a - b);
  const lastMove = (t: number) => { let lo = 0, hi = moves.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (moves[m] <= t) { r = moves[m]; lo = m + 1; } else hi = m - 1; } return r; };
  const nextMove = (t: number) => moves.find((m) => m > t) ?? Infinity;
  const cursorAlpha = (t: number) => {
    if (edl.cursor === false) return 0;
    const idle = t - lastMove(t), back = nextMove(t) - t;
    const hide = idle > CURSOR.idleHideAfter ? Math.min(1, (idle - CURSOR.idleHideAfter) / CURSOR.idleFade) : 0;
    const show = back < CURSOR.showFade && idle > CURSOR.idleHideAfter ? 1 - back / CURSOR.showFade : 0; // fade back in just before moving
    return Math.max(0, 1 - hide + show * hide);
  };
  const cursorAt = (t: number) => {
    const c = ev.cursor; if (!c.length) return null;
    let i = c.findIndex((p) => p.t > t); if (i === 0) return { ...c[0], k: c[0].k ?? "arrow" }; if (i < 0) return { ...c[c.length - 1], k: c[c.length - 1].k ?? "arrow" };
    const a = c[i - 1], b = c[i], u = (t - a.t) / Math.max(1, b.t - a.t);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, k: (a.k ?? "arrow") as CursorKind };
  };

  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${OUT_W}x${OUT_H}`, "-r", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-aq-mode", "3", "-pix_fmt", "yuv420p", "-movflags", "+faststart", o.out ?? join(dir, "video.mp4")], { stdio: ["pipe", "inherit", "pipe"] });
  // ffmpeg warns "Truncating packet of size N to 8192" when reading raw frames from a pipe — harmless; drop just that line
  ff.stderr!.on("data", (d: Buffer) => { const t = d.toString().split("\n").filter((x) => x.trim() && !/Truncating packet/.test(x)).join("\n"); if (t) process.stderr.write(t + "\n"); });

  // The raster the camera crops from: the recording itself, or (canvas on) the whole stage —
  // background + window shadow (built once) with the rounded recording placed on top.
  const world = cam.world, canvas = edl.canvas?.on ? edl.canvas : null;
  const RW = Math.round(world.w * k), RH = Math.round(world.h * k);
  let stageBase: Buffer | null = null, mask: Buffer | null = null;
  if (canvas) {
    const bg = backgroundOf(canvas);
    const bgSvg = backgroundSvg(bg, RW, RH, bg.type === "image" ? `data:image/${bg.src.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(bg.src).toString("base64")}` : undefined);
    const layers: sharp.OverlayOptions[] = [
      ...(canvas.panel ? [{ input: Buffer.from(panelSvg(canvas, W, H, k)), left: 0, top: 0 }] : []), // the panel the window sits on
      ...(canvas.shadow ? [{ input: Buffer.from(shadowSvg(canvas, W, H, k)), left: 0, top: 0 }] : [])];
    stageBase = await sharp(Buffer.from(bgSvg)).resize(RW, RH).composite(layers).removeAlpha().raw().toBuffer();
    mask = await sharp(Buffer.from(roundMaskSvg(SW, SH, canvas.radius * k))).png().toBuffer();
    console.log(`  canvas: ${canvas.preset}, padding ${canvas.padding}, radius ${canvas.radius}, shadow ${canvas.shadow} → stage ${RW}×${RH}`);
  }
  let decoded: { file: string; buf: Buffer } | null = null;
  const source = async (file: string) => {
    if (decoded?.file === file) return decoded.buf;
    const img = sharp(join(dir, "frames", file));
    const buf = !canvas ? await img.removeAlpha().raw().toBuffer()
      : await sharp(stageBase!, { raw: { width: RW, height: RH, channels: 3 } })
          .composite([{ input: await img.ensureAlpha().composite([{ input: mask!, blend: "dest-in" }]).png().toBuffer(), left: Math.round(world.mx * k), top: Math.round(world.my * k) }])
          .removeAlpha().raw().toBuffer();
    decoded = { file, buf };
    return buf;
  };

  async function frame(t: number): Promise<Buffer> {
    const c = cam.at(t), r = cam.crop(c);
    const buf = await source(frameAt(t).file);
    const left = Math.max(0, Math.round((r.x - world.x) * k)), top = Math.max(0, Math.round((r.y - world.y) * k));
    const width = Math.min(RW - left, Math.round(r.w * k)), height = Math.min(RH - top, Math.round(r.h * k));
    const z = OUT_W / r.w; // output px per CSS px at this zoom
    const over: sharp.OverlayOptions[] = [];
    // stage effects sit on the page, under the cursor
    // the stage's animated parts, drawn per frame in output px: the slash grid (clipped to outside the window) and the window border
    if (canvas) {
      const bgA = backgroundOf(canvas), sg = bgA.type !== "image" ? bgA.slashgrid : undefined, bd = canvas.border;
      if (sg || bd) {
        const g = 1920 / world.w;                                           // grid units: 1080p px with the whole stage in view
        const wx = (0 - r.x) * z, wy = (0 - r.y) * z, ww = W * z, wh = H * z, wr = canvas.radius * z;
        const rr = (x: number, y: number, w: number, h: number, q: number) => `M${x + q} ${y}H${x + w - q}A${q} ${q} 0 0 1 ${x + w} ${y + q}V${y + h - q}A${q} ${q} 0 0 1 ${x + w - q} ${y + h}H${x + q}A${q} ${q} 0 0 1 ${x} ${y + h - q}V${y + q}A${q} ${q} 0 0 1 ${x + q} ${y}Z`;
        let svg = "";
        if (sg) {
          const tg = (canvas.phase ?? 0) + (t - from);                       // film-time phase: carries on across scenes
          svg += `<defs><clipPath id="og"><path fill-rule="evenodd" clip-rule="evenodd" d="M-10 -10H${OUT_W + 10}V${OUT_H + 10}H-10Z ${rr(wx, wy, ww, wh, wr)}"/></clipPath></defs>`
            + `<g clip-path="url(#og)"><g transform="scale(${OUT_K})">${slashGridSvg(tg, { ...sg, w: 1920, h: 1080, view: { x: (r.x - world.x) * g, y: (r.y - world.y) * g, scale: world.w / r.w } })}</g></g>`; // drawn in 1080p units, scaled to the output
        }
        if (bd) { const bw = bd.width * OUT_K * (world.w / r.w); svg += `<path d="${rr(wx - bw / 2, wy - bw / 2, ww + bw, wh + bw, wr + bw / 2)}" fill="none" stroke="${bd.color}" stroke-opacity="${bd.opacity ?? 1}" stroke-width="${bw.toFixed(2)}"/>`; }
        over.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}">${svg}</svg>`), left: 0, top: 0 });
      }
    }
    const fx = composeEffects(edl.effects, t, { crop: r, view: { w: W, h: H }, out: { w: OUT_W, h: OUT_H }, cursor: ev.cursor, feel: feelOf(edl.feel) });
    if (fx) over.push({ input: Buffer.from(fx), left: 0, top: 0 });
    const p = cursorAt(t), clk = feelOf(edl.feel).click;
    if (p) {
      const click = ev.clicks.find((cl) => t >= cl.t && t - cl.t < 500);
      if (click) {
        const prog = (t - click.t) / 500, rs = Math.round(70 * OUT_K * Math.min(1.6, z / (OUT_W / W)));
        const rx = Math.round((click.x - r.x) * z - rs / 2), ry = Math.round((click.y - r.y) * z - rs / 2);
        if (rx >= 0 && ry >= 0 && rx + rs <= OUT_W && ry + rs <= OUT_H) over.push({ input: ripple(rs, prog, clk?.ripple), left: rx, top: ry });
      }
      const press = click ? pressScale(t - click.t, clk?.press) : 1;
      const size = Math.round(40 * OUT_K * Math.sqrt(z / (OUT_W / W)) * press);
      const hot = CURSORS[p.k].hot, alpha = cursorAlpha(t);
      const place = (q: { x: number; y: number }, a: number) => {
        const cx = Math.round((q.x - r.x) * z - (size * hot[0]) / 32), cy = Math.round((q.y - r.y) * z - (size * hot[1]) / 32); // hotspot at the pointer
        if (a > 0.01 && cx >= 0 && cy >= 0 && cx + size <= OUT_W && cy + size <= OUT_H) over.push({ input: CURSOR_SVG(size, p.k, a), left: cx, top: cy });
      };
      // motion trail: faint copies along the recent path when the pointer moves fast
      const prev = cursorAt(t - 30), speed = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) / 0.03 : 0;
      if (speed > CURSOR.trailSpeed && alpha > 0.5)
        for (let g = CURSOR.trailGhosts; g >= 1; g--) { const q = cursorAt(t - g * CURSOR.trailStepMs); if (q) place(q, 0.16 * (1 - g / (CURSOR.trailGhosts + 1)) * alpha); }
      place(p, alpha);
    }
    let base = await sharp(buf, { raw: { width: RW, height: RH, channels: 3 } })
      .extract({ left, top, width, height })
      .resize(OUT_W, OUT_H, { kernel: "lanczos3" }).raw().toBuffer();
    // frame ops that SVG can't do over a raster (blur-focus): blurred copy, masked outside the hole
    for (const op of composePre(edl.effects, t, { crop: r, view: { w: W, h: H }, out: { w: OUT_W, h: OUT_H }, cursor: ev.cursor, feel: feelOf(edl.feel) })) {
      const small = await sharp(base, { raw: { width: OUT_W, height: OUT_H, channels: 3 } }).resize(OUT_W / 4, OUT_H / 4).blur(Math.max(0.3, op.blur / 4)).resize(OUT_W, OUT_H).ensureAlpha().raw().toBuffer();
      const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_W}" height="${OUT_H}"><path fill-rule="evenodd" fill="#fff" fill-opacity="${op.opacity}" d="M0 0H${OUT_W}V${OUT_H}H0Z M${op.hole.x + op.hole.r} ${op.hole.y}h${op.hole.w - 2 * op.hole.r}a${op.hole.r} ${op.hole.r} 0 0 1 ${op.hole.r} ${op.hole.r}v${op.hole.h - 2 * op.hole.r}a${op.hole.r} ${op.hole.r} 0 0 1 ${-op.hole.r} ${op.hole.r}h${-(op.hole.w - 2 * op.hole.r)}a${op.hole.r} ${op.hole.r} 0 0 1 ${-op.hole.r} ${-op.hole.r}v${-(op.hole.h - 2 * op.hole.r)}a${op.hole.r} ${op.hole.r} 0 0 1 ${op.hole.r} ${-op.hole.r}Z"/></svg>`);
      const blurred = await sharp(small, { raw: { width: OUT_W, height: OUT_H, channels: 4 } }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
      base = await sharp(base, { raw: { width: OUT_W, height: OUT_H, channels: 3 } }).composite([{ input: blurred }]).removeAlpha().raw().toBuffer();
    }
    return sharp(base, { raw: { width: OUT_W, height: OUT_H, channels: 3 } })
      .composite(over).removeAlpha().raw().toBuffer();
  }

  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const out = await frame(Math.min(to, from + (i * 1000) / fps));
    if (!ff.stdin.write(out)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % (fps * 5) === 0) process.stdout.write(`\r  ${((i / n) * 100).toFixed(0)}%  `);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`\r✓ video.mp4 · ${(n / fps).toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

if (process.argv[1]?.endsWith("render.ts")) { const take = process.argv[2]; if (!take) throw new Error("usage: render.ts <take>"); await render(take); }
