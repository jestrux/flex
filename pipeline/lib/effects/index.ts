// Effect registry. Every planned effect is registered here (stubs until its lane lands),
// so lanes only ever edit their own lib/effects/<name>.ts.
import type { EffectModule } from "./types.ts";
import arrow from "./arrow.ts";
import annotate from "./annotate.ts";
import spotlight from "./spotlight.ts";
import underline from "./underline.ts";
import link from "./link.ts";
import highlighter from "./highlighter.ts";
import halo from "./halo.ts";
import lowerThird from "./lower-third.ts";
import slate from "./slate.ts";
import caption from "./caption.ts";
import step from "./step.ts";
import confetti from "./confetti.ts";
import coinRain from "./coin-rain.ts";
import odometer from "./odometer.ts";

export const EFFECTS: Record<string, EffectModule> = Object.fromEntries(
  [arrow, annotate, spotlight, underline, link, highlighter, halo, lowerThird, slate, caption, step, confetti, coinRain, odometer].map((m) => [m.type, m]),
);
export type { EffectItem, EffectModule, Ctx, Pt, Rect, EffectTarget } from "./types.ts";
