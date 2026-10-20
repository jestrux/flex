// The "slash spin" grid: a field of short separate slashes, each spinning half a turn (45° → 225°) in turn, so the spin
// ripples across the grid as a diagonal wave. The film's animated base layer (replaces stage.ts HATCH).
// After the videographer reference "02 · Slash spin (original)" (~/Downloads/02 · Slash spin (original)-html/Main.dc.html):
// 25 × 14 cells of 40 px at 960 × 540, a 2 × 18 px rounded slash per cell, @keyframes {0%,25% 45deg} {55%,100% 225deg}
// with cubic-bezier(.7,0,.3,1), a 4 s cycle, each cell delayed by −(x+y)·0.06·dur/4 s, every 9th diagonal in the accent.
//
// Pure and self-contained (no imports): slashGridSvg(t, opts) is a function of t alone, so any frame renders the same, and
// it can move to fancy-e2e-videos lib/ unchanged. The grid lives in WORLD space (layout px, 1920 wide = 1 px at 1080p):
// pass `view` to look at it through a camera (pan + zoom with the stage), and `offset` to carry the phase across cuts.

export type SlashGridOpts = {
  /** the drawing's size in its own units (a card's layout: 1920 × 1080) */
  w: number; h: number;
  /** the grid pitch, world px (80 = the reference's 40 at 960 wide) */
  cell: number;
  /** the vertical spacing, if different from `cell` (e.g. 1080 / 14 so rows straddle both the top and bottom frame edges) */
  cellY?: number;
  /** a vignette in screen space: each slash's opacity × lerp(center, edge, smoothstep(inner, 1, r)), r = 0 at the frame centre,
   *  1 at the corners (elliptical). e.g. { center: 0.15, edge: 0.75, inner: 0.25 }: faint in the middle, building towards the edges,
   *  never full contrast */
  vignette?: { center: number; edge: number; inner?: number };
  /** one slash's length and thickness, world px (rounded ends: rx = width / 2) */
  len: number; width: number;
  /** the slashes' colour and opacity */
  color: string; opacity: number;
  /** the accent colour (every `accentEvery`-th diagonal), its opacity; accentEvery 0 = no accent */
  accent: string; accentOpacity: number; accentEvery: number;
  /** one cycle, ms (a whole number of beats: 2400 = one bar at 100 BPM) */
  period: number;
  /** the cycle's shape, as fractions of the period: hold at 45° until holdFrac, turn for turnFrac, hold at 225° */
  holdFrac: number; turnFrac: number;
  /** the delay between neighbouring diagonals, ms (the reference: 0.015 × period). The wave crosses n diagonals in n · waveStep */
  waveStep: number;
  /** the turn's easing, a CSS cubic-bezier (x1, y1, x2, y2) */
  ease: [number, number, number, number];
  /** the angles, degrees (screen: clockwise; 45 = "/"). 45 → 225 is half a turn, so 225 looks like 45 and the loop is seamless */
  from: number; to: number;
  /** +1: the wave runs from bottom-right to top-left (the reference: higher x+y leads); −1: top-left to bottom-right */
  dir: 1 | -1;
  /** a phase shift, ms, added to t (carry the wave across a cut: pass the time the previous shot ended on) */
  offset: number;
  /** where cell (0, 0)'s centre sits, world px; the grid repeats every `cell` from there in both directions */
  origin: { x: number; y: number };
  /** the camera: the world point at the drawing's top-left, and drawing units per world px (1 = at rest) */
  view: { x: number; y: number; scale: number };
  /** music: the world point whose slash is at `landPhase` of its turn exactly when (t + offset) is a multiple of period —
   *  e.g. the frame centre, so the flip there lands on every downbeat. Omit for the reference's raw timing. */
  land?: { x: number; y: number };
  /** where in the turn the beat lands (0 = it starts turning, 0.5 = mid-turn, its fastest moment, 1 = it settles) */
  landPhase: number;
  /** a background colour drawn first (omit to draw only the slashes) */
  bg?: string;
  /** an overall fade (0..1), multiplies both opacities */
  fade: number;
  /** ripples: rings spreading out from a point (world px) from t0 (ms, same clock as t), e.g. something landing on the
   *  grid. As the ring passes a slash it spins it by `spin`° extra, stretches it by `grow`, and lights it in `color`;
   *  the ring weakens as it travels (gone by `reach` world px) */
  ripples?: SlashRipple[];
  /** a cleared space: slashes inside the ellipse (centre x, y; radii rx, ry; world px) fade out, with a soft edge `feather`
   *  (world px) — e.g. a clean ground for text. `amount` 0..1 (animate it, or the radii, to open the space up) */
  clear?: { x: number; y: number; rx: number; ry: number; feather?: number; amount?: number };
};
export type SlashRipple = { x: number; y: number; t0: number; speed?: number; width?: number; spin?: number; grow?: number; color?: string; reach?: number };
const RIPPLE = { speed: 1.3, width: 90, spin: 90, grow: 0.7, reach: 2100 }; // ≈ 1.2 s (two beats at 100 BPM) to cross a 1080p frame
/** a ripple's strength (0..1) at world point (wx, wy) at time t */
function rippleAt(rp: SlashRipple, wx: number, wy: number, t: number) {
  const age = t - rp.t0; if (age < 0) return 0;
  const sp = rp.speed ?? RIPPLE.speed, w = rp.width ?? RIPPLE.width, reach = rp.reach ?? RIPPLE.reach;
  const front = age * sp, d = Math.hypot(wx - rp.x, wy - rp.y);
  if (front > reach + 3 * w) return 0;
  const z = (d - front) / w, fall = Math.max(0, 1 - d / reach);
  return Math.exp(-z * z) * fall * fall * (d <= front + 3 * w ? 1 : 0);
}

/** the brand default: off-white slashes, a modest opacity, a lime accent, one wave per bar at 100 BPM, landing mid-frame */
export const SLASH_DEFAULT: SlashGridOpts = {
  w: 1920, h: 1080, cell: 80, len: 36, width: 4,
  color: "#F2F2EE", opacity: 0.2, accent: "#D5FC31", accentOpacity: 0.8, accentEvery: 9,
  period: 2400, holdFrac: 0.25, turnFrac: 0.3, waveStep: 0.015 * 2400,
  ease: [0.7, 0, 0.3, 1], from: 45, to: 225, dir: 1, offset: 0,
  origin: { x: 40, y: 60 }, view: { x: 0, y: 0, scale: 1 },
  land: { x: 960, y: 540 }, landPhase: 0.5, bg: "#0B0B14", fade: 1,
};
/** variants (spread over the default) */
export const SLASH_VARIANTS = {
  lime: {},
  /** vibrant purples (brand #7B27C9 is too dark to pop on the stage): candidates */
  violet: { accent: "#A855F7", accentOpacity: 0.95 },
  orchid: { accent: "#C026D3", accentOpacity: 1 },
  fuchsia: { accent: "#D946EF", accentOpacity: 0.95 },
  /** under narration: dimmer, and one wave per two bars */
  quiet: { opacity: 0.11, accentOpacity: 0.4, period: 4800, waveStep: 0.015 * 4800 },
} satisfies Record<string, Partial<SlashGridOpts>>;
/** the final presets for the merge */
export const SLASH_QUIET: SlashGridOpts = { ...SLASH_DEFAULT, ...SLASH_VARIANTS.quiet };
export const SLASH_PURPLE: SlashGridOpts = { ...SLASH_DEFAULT, ...SLASH_VARIANTS.fuchsia };
/** the reference's own values, scaled from 960 × 540 to 1920 × 1080 (for the fidelity check) */
export const SLASH_REFERENCE: SlashGridOpts = {
  ...SLASH_DEFAULT, color: "#F2F2EE", opacity: 1, accent: "#FF6B3D", accentOpacity: 1, period: 4000, waveStep: 60,
  origin: { x: 0, y: 20 }, land: undefined, bg: "#0B0B0C",
};

const bezier = ([x1, y1, x2, y2]: [number, number, number, number]) => {
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u ** 2 * (1 - u) + u ** 3;
  const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u ** 2 * (1 - u) + u ** 3;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 40; i++) { u = (lo + hi) / 2; if (bx(u) < x) lo = u; else hi = u; }
    return by(u);
  };
};
const mod = (a: number, n: number) => ((a % n) + n) % n;
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** the slash angle (degrees) of the cell on diagonal d (= i + j) at time t */
export function slashAngle(t: number, d: number, o: SlashGridOpts, ease = bezier(o.ease)) {
  const ph = mod(t + phaseShift(o) + o.dir * d * o.waveStep, o.period) / o.period; // the CSS animation's progress, 0..1
  const u = (ph - o.holdFrac) / o.turnFrac;
  return ph < o.holdFrac ? o.from : u >= 1 ? o.to : o.from + (o.to - o.from) * ease(u);
}
/** the shift that puts `land`'s cell at landPhase of its turn on t = 0 (mod period), plus `offset` */
function phaseShift(o: SlashGridOpts) {
  if (!o.land) return o.offset;
  const dl = Math.round((o.land.x - o.origin.x) / o.cell) + Math.round((o.land.y - o.origin.y) / (o.cellY ?? o.cell));
  return o.offset + (o.holdFrac + o.landPhase * o.turnFrac) * o.period - o.dir * dl * o.waveStep;
}

/** the grid at time t (ms) as an SVG fragment (a <g>) in the drawing's units: embed it in a card's frame. Only the cells in
 *  view are drawn (≈ 330 at rest at 1080p), each a rounded rect turned about its centre. */
export function slashGridSvg(t: number, opts: Partial<SlashGridOpts> = {}): string {
  const o: SlashGridOpts = { ...SLASH_DEFAULT, ...opts };
  const ease = bezier(o.ease), v = o.view, s = v.scale;
  const L = o.len * s, Wd = o.width * s, r = Wd / 2, reach = Math.max(L, Wd) / 2 / s; // world px a slash can reach from its centre
  const i0 = Math.floor((v.x - reach - o.origin.x) / o.cell), i1 = Math.ceil((v.x + o.w / s + reach - o.origin.x) / o.cell);
  const cy = o.cellY ?? o.cell;
  const j0 = Math.floor((v.y - reach - o.origin.y) / cy), j1 = Math.ceil((v.y + o.h / s + reach - o.origin.y) / cy);
  const angles = new Map<number, number>(); // one angle per diagonal
  let line = "", acc = "", rip = "";
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const wx = o.origin.x + i * o.cell, wy = o.origin.y + j * cy;
    const x = (wx - v.x) * s, y = (wy - v.y) * s;
    if (x < -L || y < -L || x > o.w + L || y > o.h + L) continue;
    const d = i + j;
    let a = angles.get(d); if (a === undefined) { a = slashAngle(t, d, o, ease); angles.set(d, a); }
    // the cleared space: 0 inside the ellipse, 1 outside, a smooth edge between
    let cm = 1;
    if (o.clear && (o.clear.amount ?? 1) > 0) {
      const c = o.clear, f = c.feather ?? 60, e = Math.hypot((wx - c.x) / Math.max(1, c.rx), (wy - c.y) / Math.max(1, c.ry));
      const u = Math.max(0, Math.min(1, (e - 1) * Math.min(c.rx, c.ry) / f + 0.5)), sm = u * u * (3 - 2 * u);
      cm = 1 - (c.amount ?? 1) * (1 - sm);
      if (cm < 0.01) continue;
    }
    // the ripples: the strongest ring at this slash
    let k = 0, kc: string | undefined;
    for (const rp of o.ripples ?? []) { const v = rippleAt(rp, wx, wy, t); if (v > k) { k = v; kc = rp.color; } }
    let vo = "";
    if (o.vignette) {
      const vg = o.vignette, nx = (x - o.w / 2) / (o.w / 2), ny = (y - o.h / 2) / (o.h / 2), rr = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2);
      const u = Math.max(0, Math.min(1, (rr - (vg.inner ?? 0)) / (1 - (vg.inner ?? 0)))), sm = u * u * (3 - 2 * u);
      vo = ` opacity="${f2((vg.center + (vg.edge - vg.center) * sm) * cm)}"`;
    } else if (cm < 1) vo = ` opacity="${f2(cm)}"`;
    if (k > 0.02) {                                                // lit by a ripple: spun, stretched, in the ripple's colour
      const rp0 = o.ripples![0], Lk = L * (1 + k * (rp0.grow ?? RIPPLE.grow)), ak = a + k * (rp0.spin ?? RIPPLE.spin);
      rip += `<rect x="${f2(-Wd / 2)}" y="${f2(-Lk / 2)}" width="${f2(Wd)}" height="${f2(Lk)}" rx="${f2(r)}" fill="${kc ?? o.accent}" opacity="${f2(Math.min(1, k * 1.15) * cm)}" transform="translate(${f2(x)} ${f2(y)}) rotate(${f2(ak)})"/>`;
      if (k > 0.6) continue;                                       // fully lit: the ripple's slash replaces it
    }
    const el = `<rect x="${f2(-Wd / 2)}" y="${f2(-L / 2)}" width="${f2(Wd)}" height="${f2(L)}" rx="${f2(r)}"${vo} transform="translate(${f2(x)} ${f2(y)}) rotate(${f2(a)})"/>`;
    if (o.accentEvery > 0 && mod(d, o.accentEvery) === 0) acc += el; else line += el;
  }
  const bg = o.bg ? `<rect width="${o.w}" height="${o.h}" fill="${o.bg}"/>` : "";
  return `<g>${bg}<g fill="${o.color}" fill-opacity="${f2(o.opacity * o.fade)}">${line}</g>`
    + (acc ? `<g fill="${o.accent}" fill-opacity="${f2(o.accentOpacity * o.fade)}">${acc}</g>` : "")
    + (rip ? `<g fill-opacity="${f2(o.fade)}">${rip}</g>` : "") + `</g>`;
}

/** the same as a standalone SVG document (w × h px), e.g. for a still */
export function slashGridDocument(t: number, opts: Partial<SlashGridOpts> = {}, px?: { w: number; h: number }): string {
  const o = { ...SLASH_DEFAULT, ...opts };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px?.w ?? o.w}" height="${px?.h ?? o.h}" viewBox="0 0 ${o.w} ${o.h}">${slashGridSvg(t, o)}</svg>`;
}

/** a camera push: the view that shows the world at `scale` centred on (cx, cy), for a w × h drawing */
export const viewAt = (cx: number, cy: number, scale: number, w = 1920, h = 1080) => ({ x: cx - w / 2 / scale, y: cy - h / 2 / scale, scale });
