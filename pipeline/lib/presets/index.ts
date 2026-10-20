// Preset registry. Every planned preset is registered (stubs until its lane lands), so
// lanes only edit their own lib/presets/<name>.ts.
import type { CardModule, TransitionModule } from "./types.ts";
import titleOpening from "./title-opening.ts";
import titleChapter from "./title-chapter.ts";
import titleClosing from "./title-closing.ts";
import brollStill from "./broll-still.ts";
import brollDevice from "./broll-device.ts";
import brollClip from "./broll-clip.ts";
import brollPip from "./broll-pip.ts";
import cut from "./tx-cut.ts";
import crossfade from "./tx-crossfade.ts";
import push from "./tx-push.ts";
import zoomThrough from "./tx-zoom-through.ts";
import blurDissolve from "./tx-blur-dissolve.ts";
import canvasSwap from "./tx-canvas-swap.ts";

export const CARDS: Record<string, CardModule> = Object.fromEntries(
  [titleOpening, titleChapter, titleClosing, brollStill, brollDevice, brollClip, brollPip].map((m) => [m.type, m]));
export const TRANSITIONS: Record<string, TransitionModule> = Object.fromEntries(
  [cut, crossfade, push, zoomThrough, blurDissolve, canvasSwap].map((m) => [m.type, m]));
