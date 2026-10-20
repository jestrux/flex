// Production presets: title cards, B-roll and transitions. A preset is one module that
// designs itself per feel (no knobs beyond its params). Pure: same inputs → same frame.
import type { Feel } from "../feels.ts";

export type Rect = { x: number; y: number; w: number; h: number };

/** one thing to paint, in order, onto a full output frame (px) */
export type Layer =
  | { svg: string }                                                     // full-frame SVG (out.w × out.h)
  | { image: string; rect: Rect; crop?: Rect; radius?: number; opacity?: number; alpha?: boolean; rotate?: number } // image file → rect; crop in source fractions 0..1; alpha: keep the image's transparency (an export with its own shadow)
  | { video: string; at: number; rect: Rect; crop?: Rect; radius?: number; opacity?: number; alpha?: boolean; rotate?: number }; // frame of a video file at `at` s (alpha: a cut-out clip, Flex patch 11); rotate: degrees clockwise about the rect's centre (patch 13)

export type SceneCtx = {
  t: number;            // ms since the card/b-roll starts
  dur: number;          // its length in ms
  out: { w: number; h: number };
  feel: Feel;
  uid: string;
  /** the video's final item, or a card followed by a hard cut: it holds to the cut (exitU() returns 0 — no exit animation) */
  last?: boolean;
  /** the join after this card is a hard cut (also sets last) */
  cutNext?: boolean;
  /** resolve an asset path given in params (relative to the project) */
  asset(p: string): string;
};

/** title cards and B-roll: render(params, ctx) → layers for this frame */
export type CardModule = {
  kind: "title" | "broll";
  type: string; label: string;
  defaults: Record<string, any>;
  dur: number;                          // default length, ms
  render(params: Record<string, any>, ctx: SceneCtx): Layer[];
};

/** a raw RGB frame, out.w × out.h × 3 */
export type Frame = Buffer;

/** transitions: mix the outgoing frame A and incoming frame B at progress u (0..1) */
export type TransitionModule = {
  kind: "transition";
  type: string; label: string;
  defaults: Record<string, any>;
  ms: number;                           // default duration
  mix(a: Frame, b: Frame, u: number, ctx: { out: { w: number; h: number }; feel: Feel; params: Record<string, any> }): Promise<Frame>;
};
