// Flex (patch 22): a phone take (recorded with `export const device = "iphone"`, lib/capture.ts) painted in Flex's own
// iPhone, the device `flex mockup` frames screens in. For a card's render:
//   layers.push(...phoneLayers(ctx, { take: "pay-a-friend", at: takeMs, x: W / 2, y: H / 2, height: 0.86 * H }));
// It draws: a soft shadow, the take's frame at `at` (take ms) clipped to the screen's rounded corners, the device (its
// screen cut out, the Dynamic Island put back), the status bar with light or dark glyphs by the colour the take recorded
// behind it, and the touch: a dot that glides to each tap ahead of it, presses, and fades after the last.
// The device's parts are drawn once by Flex (`FLEX_DEVICE_FRAMES`, from server/devices/iphone-frame.css).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { clamp, ease, fmt, lerp } from "./effects/kit.ts";
import { frameSvg } from "./presets/title-opening.ts";
import type { Layer, SceneCtx } from "./presets/types.ts";
import { mediaSize } from "./presets/broll-still.ts";

type Ev = {
  device?: { w: number; h: number; dpr: number };
  frames: { t: number; file: string }[];
  clicks: { t: number; x: number; y: number }[];
  bars?: { t: number; c: string }[];
  finds?: { t: number; name: string; text: string; rect: { x: number; y: number; w: number; h: number } }[];
};
export type PhoneTouch = false | { label?: string; fill?: string; ink?: string };
export type PhoneOpts = {
  /** the take (its name, as `flex capture` and `flex pick` call it; or an absolute folder), recorded in a device */
  take: string;
  /** take time, ms */
  at: number;
  /** the device's centre, film px, and its body's height in film px */
  x: number; y: number; height: number;
  /** draw the touch (default), optionally carrying a role pill (Figma-style); false: none */
  touch?: PhoneTouch;
  /** the shadow under the device (default true) */
  shadow?: boolean;
  /** Flex (patch 27): the device the take is painted in (a key of Flex's device parts: iphone (default), android,
   *  android-tablet) and its finish (android: graphite, porcelain, sage) */
  device?: string; finish?: string;
};

/** a take's folder: by name in the film's takes (FLEX_TAKES, set by Flex, versions previewed with --take included) */
const takeDir = (name: string) => (isAbsolute(name) ? name : join(process.env.FLEX_TAKES ?? "takes", name));
const TAKES = new Map<string, Ev>();
function take(dir: string): Ev {
  if (!TAKES.has(dir)) {
    const f = join(dir, "events.json");
    if (!existsSync(f)) throw new Error(`phoneLayers: no take at ${dir} (flex capture its journey)`);
    TAKES.set(dir, JSON.parse(readFileSync(f, "utf8")));
  }
  return TAKES.get(dir)!;
}
type Frame = { pad: number; side: number; screen: { w: number; h: number; r: number }; bars?: { top: number; bottom: number }; finishes?: string[] };
const FRAMES = new Map<string, Frame>();
const URIS = new Map<string, string>();
/** a device's parts (Flex draws them): the iPhone's in FLEX_DEVICE_FRAMES itself, any other device's in a subfolder (patch 27) */
function parts(device = "iphone"): { dir: string; f: Frame } {
  const root = process.env.FLEX_DEVICE_FRAMES;
  if (!root || !existsSync(join(root, "frame.json"))) throw new Error("phoneLayers: no device frames yet (Flex draws them when the project has a phone take: capture one, or run flex mockup --overlays)");
  const dir = device === "iphone" ? root : join(root, device);
  if (!existsSync(join(dir, "frame.json"))) throw new Error(`no device "${device}" in Flex's device parts (${root}): iphone, android, android-tablet`);
  if (!FRAMES.has(dir)) FRAMES.set(dir, JSON.parse(readFileSync(join(dir, "frame.json"), "utf8")));
  return { dir, f: FRAMES.get(dir)! };
}
/** the device's body in a finish: device-<finish>.png when the device comes in finishes, else device.png */
const bodyFile = (f: Frame, finish?: string) => {
  if (!finish || !f.finishes) return "device.png";
  if (!f.finishes.includes(finish)) throw new Error(`no finish "${finish}" (${f.finishes.join(", ")})`);
  return `device-${finish}.png`;
};
const uri = (dir: string, f: string) => {
  const p = join(dir, f);
  if (!URIS.has(p)) URIS.set(p, `data:image/png;base64,${readFileSync(p).toString("base64")}`);
  return URIS.get(p)!;
};
const lastAt = <T extends { t: number }>(xs: T[], t: number): T | undefined => { let r: T | undefined; for (const x of xs) { if (x.t <= t) r = x; else break; } return r ?? xs[0]; };

/** is a CSS colour dark (the status bar wants white glyphs over it)? rgb()/rgba()/#hex; anything else counts as light */
export function darkColour(c: string): boolean {
  let rgb: number[] | null = null;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) rgb = m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
  else if (/^#[0-9a-f]{6}$/i.test(c)) { const n = parseInt(c.slice(1), 16); rgb = [n >> 16, (n >> 8) & 255, n & 255]; }
  if (!rgb || rgb.some((v) => Number.isNaN(v))) return false;
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 150;
}

/** where a found phrase sits on the device on screen (film px), for a lens or a callout: c.find(text, name) in the take */
export function phoneFind(o: Omit<PhoneOpts, "at" | "touch" | "shadow">, name: string) {
  const T = take(takeDir(o.take)), { f } = parts(o.device), hit = T.finds?.find((x) => x.name === name);
  if (!hit) throw new Error(`phoneFind: no find "${name}" in ${o.take} (c.find in its journey)`);
  const s = o.height / (f.screen.h + 2 * f.side), sx = o.x - (f.screen.w / 2) * s, sy = o.y - (f.screen.h / 2) * s;
  return { x: sx + hit.rect.x * s, y: sy + hit.rect.y * s, w: hit.rect.w * s, h: hit.rect.h * s };
}

/** the take's frame at `at` and where its screen sits on the frame (film px): a lens's source (lensLayers' `src`) */
export function phoneScreen(o: Omit<PhoneOpts, "touch" | "shadow">) {
  const dirT = takeDir(o.take), T = take(dirT), { f } = parts(o.device), fr = lastAt(T.frames, o.at);
  if (!fr) throw new Error(`phoneScreen: ${o.take} has no frames`);
  const s = o.height / (f.screen.h + 2 * f.side), dpr = T.device?.dpr ?? 3;
  return { file: join(dirT, "frames", fr.file), rect: { x: o.x - (f.screen.w / 2) * s, y: o.y - (f.screen.h / 2) * s, w: f.screen.w * s, h: f.screen.h * s }, px: { w: f.screen.w * dpr, h: f.screen.h * dpr } };
}

/** two recorded frames this close (ms) are one motion: the film blends between them */
export const BLEND_GAP = 80;

const REST = { x: 0.64, y: 0.86 }, GLIDE = 650, LAND = 80;

export function phoneLayers(ctx: SceneCtx, o: PhoneOpts): Layer[] {
  const dirT = takeDir(o.take), T = take(dirT), { dir, f } = parts(o.device);
  const k = ctx.out.w / 1920, SCR = f.screen, IN = f.pad + f.side;
  const s = o.height / (SCR.h + 2 * f.side), c = { x: o.x, y: o.y };
  const BODY = { w: SCR.w + 2 * f.side, h: SCR.h + 2 * f.side }, CANVAS = { w: SCR.w + 2 * IN, h: SCR.h + 2 * IN };
  const bx = c.x - (BODY.w / 2) * s, by = c.y - (BODY.h / 2) * s, sx = c.x - (SCR.w / 2) * s, sy = c.y - (SCR.h / 2) * s;
  const out: Layer[] = [];
  if (o.shadow !== false) out.push({ svg: frameSvg(ctx, `<rect x="${fmt(bx)}" y="${fmt(by + 30 * s)}" width="${fmt(BODY.w * s)}" height="${fmt(BODY.h * s)}" rx="${fmt((SCR.r + f.side) * s)}" fill="#000" opacity="0.45" filter="url(#phsh)"/>`,
    `<filter id="phsh" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${fmt(30 * s)}"/></filter>`) });
  const fr = lastAt(T.frames, o.at);
  const scr = { x: sx * k, y: sy * k, w: SCR.w * s * k, h: SCR.h * s * k };
  if (fr) out.push({ image: join(dirT, "frames", fr.file), radius: SCR.r * s * k, rect: scr });
  // in motion (a scroll), Chrome may deliver frames only every ~50 ms: a 30 fps film would show some twice. Between two
  // frames that close, the next one fades in over the gap; a longer gap is a screen that didn't change (it cuts on time)
  const nx = fr && T.frames[T.frames.indexOf(fr) + 1];
  if (fr && nx && nx.t - fr.t <= BLEND_GAP && o.at > fr.t) out.push({ image: join(dirT, "frames", nx.file), radius: SCR.r * s * k, rect: scr, opacity: (o.at - fr.t) / (nx.t - fr.t) });
  const over = (file: string) => `<image href="${uri(dir, file)}" x="${fmt(c.x - (CANVAS.w / 2) * s)}" y="${fmt(c.y - (CANVAS.h / 2) * s)}" width="${fmt(CANVAS.w * s)}" height="${fmt(CANVAS.h * s)}"/>`;
  const bar = lastAt(T.bars ?? [], o.at)?.c ?? "rgb(255, 255, 255)";
  let fx = over(bodyFile(f, o.finish)) + over(darkColour(bar) ? "status-light.png" : "status-dark.png");
  if (o.touch !== false) fx += touchSvg(T.clicks, o.at, sx, sy, s, SCR, o.touch || undefined);
  out.push({ svg: frameSvg(ctx, fx) });
  return out;
}

/* ── Flex (patch 27): a screen recording (a video) in a device, its own bars replaced by the device's ─────────────── */
export type RecordingOpts = {
  /** the recording (an mp4 the film plays, e.g. an Android screenrecord) and the time in it, seconds */
  video: string; at: number;
  /** the device it plays in (default android) and its finish */
  device?: string; finish?: string;
  /** the device's centre and its body's height, film px (1920-wide layout units, as phoneLayers) */
  x: number; y: number; height: number;
  /** the recording's own status and navigation bars, in device points: covered with the app's colour under them and
   *  the device's clean bars drawn over (default: the device's bars; false: the recording is shown as it is) */
  bars?: { top: number; bottom: number } | false;
  /** draw the device's status bar and gesture pill over the covered bars (default true); false leaves the bands plain */
  status?: boolean;
  /** the punch-hole camera (default true; Android) */
  camera?: boolean;
  shadow?: boolean; opacity?: number;
};
type BarCols = { fps: number; top: string[]; bottom: string[] };
const BARCOLS = new Map<string, BarCols>();
/** the app's colour just inside the recording's bars, ten times a second, measured once and kept beside the video */
function barColours(video: string, bars: { top: number; bottom: number }, screenH: number): BarCols {
  const key = `${video}|${bars.top}|${bars.bottom}`;
  if (BARCOLS.has(key)) return BARCOLS.get(key)!;
  const cache = `${video}.bars-${bars.top}-${bars.bottom}.json`;
  if (existsSync(cache)) { const c = JSON.parse(readFileSync(cache, "utf8")); BARCOLS.set(key, c); return c; }
  const { h } = mediaSize(video), k = h / screenH, FPS = 10;
  // one pass: every frame squeezed to a single column, so each pixel is its row's average colour; then the two rows we need
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-an", "-vf", `fps=${FPS},scale=1:${h}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });
  // just inside each bar: 3 pt below the status bar, 3 pt above the navigation bar
  const yt = Math.min(h - 1, Math.round((bars.top + 3) * k)), yb = Math.max(0, Math.round(h - (bars.bottom + 3) * k));
  const c: BarCols = { fps: FPS, top: [], bottom: [] }, at = (o: number) => `rgb(${raw[o]}, ${raw[o + 1]}, ${raw[o + 2]})`;
  for (let f = 0; (f + 1) * h * 3 <= raw.length; f++) { c.top.push(at((f * h + yt) * 3)); c.bottom.push(at((f * h + yb) * 3)); }
  try { writeFileSync(cache, JSON.stringify(c)); } catch { /* a read-only folder: keep it in memory */ }
  BARCOLS.set(key, c);
  return c;
}

/** a screen recording playing in a device: its shadow, the video in the screen, its own bars covered with the app's colour
 *  and the device's status bar (and Android's gesture pill) drawn over, light or dark by that colour. Pass a camera-moved
 *  x, y and height and the whole device moves with it, the bars staying crisp at any scale. */
export function recordingLayers(ctx: SceneCtx, o: RecordingOpts): Layer[] {
  const { dir, f } = parts(o.device ?? "android");
  const k = ctx.out.w / 1920, SCR = f.screen, IN = f.pad + f.side, op = o.opacity ?? 1;
  const s = o.height / (SCR.h + 2 * f.side), c = { x: o.x, y: o.y };
  const BODY = { w: SCR.w + 2 * f.side, h: SCR.h + 2 * f.side }, CANVAS = { w: SCR.w + 2 * IN, h: SCR.h + 2 * IN };
  const bx = c.x - (BODY.w / 2) * s, by = c.y - (BODY.h / 2) * s, sx = c.x - (SCR.w / 2) * s, sy = c.y - (SCR.h / 2) * s;
  const out: Layer[] = [];
  if (o.shadow !== false) out.push({ svg: frameSvg(ctx, `<rect x="${fmt(bx)}" y="${fmt(by + 30 * s)}" width="${fmt(BODY.w * s)}" height="${fmt(BODY.h * s)}" rx="${fmt((SCR.r + f.side) * s)}" fill="#000" opacity="${fmt(0.45 * op)}" filter="url(#rcsh)"/>`,
    `<filter id="rcsh" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${fmt(30 * s)}"/></filter>`) });
  out.push({ video: o.video, at: o.at, rect: { x: sx * k, y: sy * k, w: SCR.w * s * k, h: SCR.h * s * k }, radius: SCR.r * s * k, opacity: op });
  const bars = o.bars === false ? null : o.bars ?? f.bars ?? { top: 0, bottom: 0 };
  let top = "rgb(255, 255, 255)", bottom = top, fx = "";
  if (bars) {
    const cols = barColours(o.video, bars, SCR.h), i = Math.max(0, Math.min(cols.top.length - 1, Math.round(o.at * cols.fps)));
    top = cols.top[i] ?? top; bottom = cols.bottom[i] ?? bottom;
    // the bands sit inside the screen's rounded corners: clip them to the screen's shape
    const clip = `<clipPath id="rcsc"><rect x="${fmt(sx)}" y="${fmt(sy)}" width="${fmt(SCR.w * s)}" height="${fmt(SCR.h * s)}" rx="${fmt(SCR.r * s)}"/></clipPath>`;
    out.push({ svg: frameSvg(ctx, `<g clip-path="url(#rcsc)" opacity="${fmt(op)}"><rect x="${fmt(sx)}" y="${fmt(sy)}" width="${fmt(SCR.w * s)}" height="${fmt(bars.top * s)}" fill="${top}"/>`
      + `<rect x="${fmt(sx)}" y="${fmt(sy + (SCR.h - bars.bottom) * s)}" width="${fmt(SCR.w * s)}" height="${fmt(bars.bottom * s)}" fill="${bottom}"/></g>`, clip) });
  }
  const over = (file: string) => existsSync(join(dir, file)) ? `<image href="${uri(dir, file)}" x="${fmt(c.x - (CANVAS.w / 2) * s)}" y="${fmt(c.y - (CANVAS.h / 2) * s)}" width="${fmt(CANVAS.w * s)}" height="${fmt(CANVAS.h * s)}"/>` : "";
  fx += over(bodyFile(f, o.finish));
  if (o.camera !== false) fx += over("camera.png");
  if (bars && o.status !== false) fx += over(darkColour(top) ? "status-light.png" : "status-dark.png") + over(darkColour(bottom) ? "nav-light.png" : "nav-dark.png");
  out.push({ svg: frameSvg(ctx, op < 1 ? `<g opacity="${fmt(op)}">${fx}</g>` : fx) });
  return out;
}

/** iOS "show touches": a dark see-through dot with a white rim, gliding to each tap ahead of it (screen points) */
function touchSvg(taps: Ev["clicks"], tt: number, sx: number, sy: number, s: number, SCR: Frame["screen"], role?: { label?: string; fill?: string; ink?: string }) {
  if (!taps.length) return "";
  const first = taps[0], lastTap = taps[taps.length - 1], start = first.t - LAND - GLIDE - 250;
  if (tt < start || tt > lastTap.t + 500) return "";
  let x = REST.x * SCR.w, y = REST.y * SCR.h, from = { x, y }, i = 0;
  for (; i < taps.length && taps[i].t - LAND <= tt; i++) from = { x: taps[i].x, y: taps[i].y };
  ({ x, y } = from);
  if (i < taps.length) {
    const to = taps[i], g0 = Math.max(i ? taps[i - 1].t + 350 : start + 250, to.t - LAND - GLIDE);
    const u = ease.inOut(clamp((tt - g0) / Math.max(1, to.t - LAND - g0)));
    x = lerp(from.x, to.x, u); y = lerp(from.y, to.y, u);
  }
  const op = clamp((tt - start) / 250) * (1 - clamp((tt - lastTap.t - 250) / 250));
  const near = taps.reduce((m, tp) => Math.min(m, Math.abs(tt - tp.t)), Infinity);
  const r = 19 * s * (1 - 0.18 * Math.max(0, 1 - near / 160)), px = sx + x * s, py = sy + y * s;
  let g = `<g opacity="${fmt(op)}"><circle cx="${fmt(px)}" cy="${fmt(py)}" r="${fmt(r)}" fill="#14101C" fill-opacity="0.34" stroke="#FFFFFF" stroke-opacity="0.92" stroke-width="${fmt(2.4 * s)}"/>`;
  if (role?.label) {
    const fs = 26, h = 44, w = role.label.length * fs * 0.62 + 32, rx = px + r * 0.75, ry = py + r * 0.75;
    g += `<rect x="${fmt(rx)}" y="${fmt(ry)}" width="${fmt(w)}" height="${h}" rx="${h / 2}" fill="${role.fill ?? "#C8FF3C"}" stroke="#FFFFFF" stroke-width="2"/>`
      + `<text x="${fmt(rx + w / 2)}" y="${fmt(ry + h / 2 + fs * 0.36)}" text-anchor="middle" font-family="Inter, Helvetica, sans-serif" font-weight="700" font-size="${fs}" fill="${role.ink ?? "#14101C"}">${role.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
  }
  return g + "</g>";
}
