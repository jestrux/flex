// Paint a card's layers onto one raw RGB frame (Node). Images are cached decoded; video
// frames are pre-extracted once per (file, fps) into .cache/frames/.
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Layer, Rect } from "./types.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const imgCache = new Map<string, { buf: Buffer; w: number; h: number }>();
async function decoded(file: string) {
  let c = imgCache.get(file);
  if (!c) { const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }); c = { buf: data, w: info.width, h: info.height }; imgCache.set(file, c); if (imgCache.size > 40) imgCache.delete(imgCache.keys().next().value!); }
  return c;
}

/** frames of a video file at `fps`, extracted once; returns the jpg for time `at` (s). Flex (patch 11): `alpha` keeps
 *  the clip's transparency as PNGs (a cut-out); extraction goes to a temp folder renamed when complete, as Flex's painter */
export function videoFrame(file: string, at: number, fps = 30, alpha = false) {
  const dir = join(process.env.FLEX_WORK ?? ROOT, ".cache", "frames", createHash("sha1").update(`${file}|${fps}${alpha ? "|alpha" : ""}`).digest("hex").slice(0, 12));
  const ext = alpha ? "png" : "jpg", count = () => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).length : 0);
  if (!count()) {
    const tmp = `${dir}.partial`;
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `fps=${fps}`, ...(alpha ? ["-pix_fmt", "rgba"] : ["-q:v", "2"]), join(tmp, `f%06d.${ext}`)]);
    rmSync(dir, { recursive: true, force: true }); renameSync(tmp, dir);
  }
  const n = count();
  const i = Math.min(n, Math.max(1, Math.floor(at * fps) + 1));
  return join(dir, `f${String(i).padStart(6, "0")}.${ext}`);
}

/** an image decoded once to raw RGBA (big transparent renders are cropped every frame) */
const alphaCache = new Map<string, Promise<{ buf: Buffer; w: number; h: number }>>();
function decodedAlpha(file: string) {
  if (alphaCache.size > 40) alphaCache.delete(alphaCache.keys().next().value!); // video frames are each a file (patch 11)
  if (!alphaCache.has(file)) alphaCache.set(file, sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => ({ buf: data, w: info.width, h: info.height })));
  return alphaCache.get(file)!;
}

async function placed(file: string, rect: Rect, crop?: Rect, radius = 0, opacity = 1) {
  const src = await decoded(file);
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const left = Math.max(0, Math.round(c.x * src.w)), top = Math.max(0, Math.round(c.y * src.h));
  const width = Math.max(1, Math.min(src.w - left, Math.round(c.w * src.w))), height = Math.max(1, Math.min(src.h - top, Math.round(c.h * src.h)));
  const W = Math.max(1, Math.round(rect.w)), H = Math.max(1, Math.round(rect.h));
  let img = sharp(src.buf, { raw: { width: src.w, height: src.h, channels: 3 } }).extract({ left, top, width, height }).resize(W, H, { fit: "cover" }).ensureAlpha();
  if (radius > 0 || opacity < 1) {
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${radius}" fill="#fff" fill-opacity="${opacity}"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
  }
  return img.png().toBuffer();
}

/** paint layers in order onto a black frame; returns raw RGB out.w × out.h */
export async function paint(layers: Layer[], out: { w: number; h: number }): Promise<Buffer> {
  const comps: sharp.OverlayOptions[] = [];
  // a placed picture (its top-left at x, y): turned `rotate` degrees clockwise about its centre (Flex, patch 13), then
  // clipped to the frame (sharp needs overlays inside the base)
  const put = async (buf: Buffer, x: number, y: number, rotate?: number) => {
    if (rotate) {
      const m0 = await sharp(buf).metadata();
      buf = await sharp(buf).rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const m1 = await sharp(buf).metadata();
      x = Math.round(x + (m0.width! - m1.width!) / 2); y = Math.round(y + (m0.height! - m1.height!) / 2);
    }
    const meta = await sharp(buf).metadata();
    const cx = Math.max(0, -x), cy = Math.max(0, -y);
    const cw = Math.min(meta.width! - cx, out.w - Math.max(0, x)), ch = Math.min(meta.height! - cy, out.h - Math.max(0, y));
    if (cw <= 0 || ch <= 0) return;
    comps.push({ input: cx || cy || cw < meta.width! || ch < meta.height! ? await sharp(buf).extract({ left: cx, top: cy, width: cw, height: ch }).png().toBuffer() : buf, left: Math.max(0, x), top: Math.max(0, y) });
  };
  for (const L of layers) {
    if ("svg" in L) comps.push({ input: Buffer.from(L.svg), left: 0, top: 0 });
    else if (L.alpha && ("image" in L || "video" in L)) { // keep transparency: (crop,) resize the PNG with its alpha, fade by opacity
      const r = L.rect, W = Math.max(1, Math.round(r.w)), H = Math.max(1, Math.round(r.h));
      const src = await decodedAlpha("video" in L ? videoFrame(L.video, L.at, 30, true) : L.image), c = L.crop ?? { x: 0, y: 0, w: 1, h: 1 };
      const left = Math.max(0, Math.round(c.x * src.w)), top = Math.max(0, Math.round(c.y * src.h));
      const width = Math.max(1, Math.min(src.w - left, Math.round(c.w * src.w))), height = Math.max(1, Math.min(src.h - top, Math.round(c.h * src.h)));
      let img = sharp(src.buf, { raw: { width: src.w, height: src.h, channels: 4 } }).extract({ left, top, width, height }).resize(W, H, { fit: "fill" });
      // rounded corners on the alpha path too (an opaque export with alpha: true lost its radius)
      if ((L.radius ?? 0) > 0) img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${L.radius}" fill="#fff"/></svg>`), blend: "dest-in" }]);
      if ((L.opacity ?? 1) < 1) img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from([255, 255, 255, Math.round(255 * (L.opacity ?? 1))]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: "dest-in" }]);
      await put(await img.png().toBuffer(), Math.round(r.x), Math.round(r.y), L.rotate);
    }
    else {
      const file = "video" in L ? videoFrame(L.video, L.at) : L.image;
      const r = L.rect, buf = await placed(file, r, L.crop, L.radius ?? 0, L.opacity ?? 1);
      await put(buf, Math.round(r.x), Math.round(r.y), L.rotate);
    }
  }
  return sharp({ create: { width: out.w, height: out.h, channels: 3, background: "#000" } }).composite(comps).removeAlpha().raw().toBuffer();
}
