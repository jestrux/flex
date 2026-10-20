// The canvas: Screen Studio's "window on a stage". When on, the recording sits as a rounded
// window with a soft shadow on a background, with padding around it. The camera then moves
// over the whole stage (the "world": viewport + padding), so zooming out reveals the
// background and zooming in fills the frame with the window. Off = edge to edge, as before.
// Browser-safe (used by the editor preview too).

/** a dot grid over the stage, like a design tool's canvas (gap and size in px at 1920 wide) */
export type Dots = { color: string; gap: number; size: number };
/** a field of fine parallel lines over the stage — the "/ / /" hatch (gap and width in px at 1920 wide; angle in degrees,
 *  45 = "/", default 45) */
export type Hatch = { color: string; gap: number; width: number; angle?: number };
/** an animated "slash spin" grid over the background (lib/slashgrid.ts options; drawn per frame by the renderer, in step
 *  with the camera, never under the window) */
export type SlashGrid = Partial<import("./slashgrid.ts").SlashGridOpts>;
export type Background =
  | { type: "gradient"; angle: number; stops: [string, number][]; glow?: string; dots?: Dots; hatch?: Hatch; slashgrid?: SlashGrid } // glow: soft radial highlight colour
  | { type: "solid"; color: string; dots?: Dots; hatch?: Hatch; slashgrid?: SlashGrid }
  | { type: "image"; src: string }; // path (render) or URL (editor)

export type Canvas = {
  on: boolean;
  preset: string;          // a key of BACKGROUNDS, or "custom"
  background?: Background; // used when preset is "custom"
  padding: number;         // fraction of the stage width on each side (0.06 = 6%)
  radius: number;          // window corner radius, viewport CSS px
  shadow: boolean;         // soft drop shadow under the window
  /** a surface between the background and the window: a rounded panel the window sits on, inset from the stage's edge by
   *  `inset` (fraction of the stage width) so the background shows around it — e.g. a hatch as the lowest layer, the
   *  scene's own ground on the panel, the recording on that. Keep inset < padding. */
  panel?: { color: string; inset: number; radius: number };
  /** a border around the window (e.g. white, so an app shown without a device still reads as a framed window): width in
   *  output px at 1080p when the whole stage is in view; it scales with the camera */
  border?: { color: string; width: number; opacity?: number };
  /** the background's animation phase (ms) at the take's `from`, so an animated grid carries on across scenes */
  phase?: number;
};

/** background presets, named after the feels (Phase 5) plus a couple of brand/wallpaper looks */
export const BACKGROUNDS: Record<string, { label: string; bg: Background }> = {
  clean: { label: "Clean", bg: { type: "gradient", angle: 160, stops: [["#F7F7FA", 0], ["#E6E6EE", 1]] } },
  modern: { label: "Modern", bg: { type: "gradient", angle: 135, stops: [["#8B5CF6", 0], ["#6D28D9", 0.45], ["#1E1B4B", 1]], glow: "rgba(236,72,153,0.45)" } },
  professional: { label: "Professional", bg: { type: "gradient", angle: 180, stops: [["#1E293B", 0], ["#0B1120", 1]], glow: "rgba(56,189,248,0.18)" } },
  kinpay: { label: "KinPay", bg: { type: "gradient", angle: 145, stops: [["#7C3AED", 0], ["#4C1D95", 0.55], ["#1A0B3B", 1]], glow: "rgba(212,245,60,0.35)" } },
  graphite: { label: "Graphite", bg: { type: "solid", color: "#18181B" } },
};

export const DEFAULT_CANVAS: Canvas = { on: true, preset: "modern", padding: 0.06, radius: 14, shadow: true };

export const backgroundOf = (c: Canvas): Background => (c.preset === "custom" && c.background ? c.background : (BACKGROUNDS[c.preset] ?? BACKGROUNDS.modern).bg);

/** the world the camera moves over, in viewport CSS px (origin = recording's top-left) */
export function worldOf(c: Canvas | undefined, W: number, H: number) {
  if (!c?.on) return { x: 0, y: 0, w: W, h: H, mx: 0, my: 0 };
  const Ww = W / (1 - 2 * c.padding), Hw = (Ww * H) / W;
  const mx = (Ww - W) / 2, my = (Hw - H) / 2;
  return { x: -mx, y: -my, w: Ww, h: Hw, mx, my };
}

/** the background as an SVG string, w×h px */
/** the hatch as an SVG <pattern> (id "hatch") plus a rect filling w×h with it; k = px per 1920-wide px */
export function hatchFill(hh: Hatch, w: number, h: number, k = w / 1920, x = 0, y = 0) {
  const g = hh.gap * k, sw = hh.width * k;
  return `<defs><pattern id="hatch" width="${g}" height="${g}" patternUnits="userSpaceOnUse" patternTransform="rotate(${hh.angle ?? 45})"><rect x="0" y="0" width="${sw}" height="${g}" fill="${hh.color}"/></pattern></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#hatch)"/>`;
}

export function backgroundSvg(bg: Background, w: number, h: number, imageHref?: string): string {
  if (bg.type !== "image" && bg.hatch) return backgroundSvg({ ...bg, hatch: undefined }, w, h).replace(/<\/svg>$/, `${hatchFill(bg.hatch, w, h)}</svg>`);
  if (bg.type !== "image" && bg.dots) {
    const k = w / 1920, d = bg.dots, g = d.gap * k, r = (d.size * k) / 2;
    const dots = `<defs><pattern id="dots" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><circle cx="${g / 2}" cy="${g / 2}" r="${r}" fill="${d.color}"/></pattern></defs><rect width="100%" height="100%" fill="url(#dots)"/>`;
    return backgroundSvg({ ...bg, dots: undefined }, w, h).replace(/<\/svg>$/, `${dots}</svg>`);
  }
  if (bg.type === "solid") return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg.color}"/></svg>`;
  if (bg.type === "image") return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}"><image href="${imageHref ?? bg.src}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/></svg>`;
  const a = ((bg.angle - 90) * Math.PI) / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
  const stops = bg.stops.map(([c, o]) => `<stop offset="${o}" stop-color="${c}"/>`).join("");
  const glow = bg.glow ? `<radialGradient id="gl" cx="0.18" cy="0.12" r="0.75"><stop offset="0" stop-color="${bg.glow}"/><stop offset="1" stop-color="${bg.glow}" stop-opacity="0"/></radialGradient><rect width="100%" height="100%" fill="url(#gl)"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}">${stops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${glow.replace("<radialGradient", "<defs><radialGradient").replace("</radialGradient>", "</radialGradient></defs>")}</svg>`;
}

/** the window's drop shadow (a blurred rounded rect) as SVG over the world, k px per CSS px */
export function shadowSvg(c: Canvas, W: number, H: number, k: number) {
  const wd = worldOf(c, W, H), ww = wd.w * k, wh = wd.h * k;
  const x = wd.mx * k, y = wd.my * k, w = W * k, h = H * k, r = c.radius * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(ww)}" height="${Math.round(wh)}"><defs><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${28 * k}"/></filter></defs>`
    + `<rect x="${x}" y="${y + 18 * k}" width="${w}" height="${h}" rx="${r}" fill="rgba(0,0,0,0.42)" filter="url(#s)"/>`
    + `<rect x="${x}" y="${y + 2 * k}" width="${w}" height="${h}" rx="${r}" fill="rgba(0,0,0,0.18)" filter="url(#s2)"/><filter id="s2"><feGaussianBlur stdDeviation="${3 * k}"/></filter></svg>`;
}

/** the panel (Canvas.panel) as SVG over the world, k px per CSS px */
export function panelSvg(c: Canvas, W: number, H: number, k: number) {
  const wd = worldOf(c, W, H), ww = wd.w * k, wh = wd.h * k, p = c.panel!, m = p.inset * ww, r = p.radius * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(ww)}" height="${Math.round(wh)}"><rect x="${m}" y="${m}" width="${ww - 2 * m}" height="${wh - 2 * m}" rx="${r}" fill="${p.color}"/></svg>`;
}

/** an alpha mask for the rounded window, w×h px */
export const roundMaskSvg = (w: number, h: number, r: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`;
