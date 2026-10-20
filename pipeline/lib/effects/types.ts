// The effect contract. An effect is an item in edl.effects; its module turns (item, time)
// into an SVG fragment in output pixels. Everything here is pure: same inputs → same frame.
//
// Units: targets and params are authored in viewport CSS px (Fuchi's point values carry
// over 1:1). Use ctx.toOut() for positions and ctx.px() for lengths (stroke widths, radii,
// offsets) so the effect moves and scales with the camera zoom.

import type { Feel } from "../feels.ts";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** what the effect points at, captured when the journey asked for it */
export type EffectTarget = {
  rect?: Rect;      // an element's box (arrow tip, spotlight hole, underline span, lower third: none)
  points?: Pt[];    // explicit points (link wire ends, annotate drag, highlighter samples)
};

export type EffectItem = {
  id: string;
  type: string;               // registry key, e.g. "arrow"
  start: number;              // ms on the take timeline: effect begins its entrance
  end: number;                // ms: effect begins its exit (the module's `exit` tail plays after)
  enabled: boolean;
  target: EffectTarget;
  params: Record<string, any>; // module defaults merged with the journey's params
  label?: string;
};

export type Ctx = {
  /** ms since the item's start (may exceed dur during the exit tail) */
  t: number;
  /** ms from start to end (the hold, before the exit tail) */
  dur: number;
  /** absolute take time in ms (for cursor lookups) */
  now: number;
  /** output frame size in px */
  out: { w: number; h: number };
  /** viewport size in CSS px */
  view: { w: number; h: number };
  /** the camera's crop in CSS px, and output px per CSS px at this zoom */
  crop: Rect;
  z: number;
  /** CSS px point → output px */
  toOut(p: Pt): Pt;
  /** CSS px length → output px (scales with zoom) */
  px(n: number): number;
  /** recorded cursor samples between two absolute times (CSS px) */
  cursorPath(from: number, to: number): { t: number; x: number; y: number }[];
  /** a unique prefix for SVG ids (gradients, filters, masks) inside this fragment */
  uid: string;
  /** where the recording's window is on the output frame right now (output px, clipped to the
   *  frame): with the canvas on it sits inset on the stage, and grows as the camera zooms. Place
   *  screen overlays relative to it (e.g. inside its bottom-left, clear of the app's own chrome). */
  window: Rect;
  /** the video's feel (fonts, colours, motion). Feel-aware effects (lower thirds) read it. */
  feel: Feel;
};

/** blur the frame everywhere except a rounded hole (output px), faded by opacity */
export type PreOp = { blur: number; hole: { x: number; y: number; w: number; h: number; r: number }; opacity: number };

export type EffectModule = {
  type: string;
  label: string;
  /** when to use it (shown by `npm run fx:list`; from ART_DIRECTION.md) */
  use?: string;
  /** default params; the editor shows these keys */
  defaults: Record<string, any>;
  /** default hold in ms when the journey doesn't give one */
  hold: number;
  /** ms the exit animation runs after `end` */
  exit: number;
  /**
   * "page": attached to the page — moves and scales with the camera (arrows, spotlight, ink).
   * "screen": a title-safe overlay that ignores the camera (lower third, slate, caption).
   * "auto": "page" when the item has a target, else "screen" (e.g. a check).
   */
  space?: "page" | "screen" | "auto";
  /** SVG fragment in output px ("" = nothing this frame) */
  render(item: EffectItem, ctx: Ctx): string;
  /**
   * frame operations applied to the picture *before* the SVG overlays (things SVG can't do
   * over a raster, like blurring the footage). Output px. Renderer-only; the editor ignores it.
   */
  pre?(item: EffectItem, ctx: Ctx): PreOp | null;
  /** sound effects: `at` in ms from the item's start (may use item.end - item.start for exits); file under assets/sfx */
  sounds?(item: EffectItem): { at: number; sound: string; db?: number; dur?: number; fade?: number }[]; // sound = assets/library.json sfx key; db = offset from the sfx target; dur/fade ms cut the clip and fade its tail
};
