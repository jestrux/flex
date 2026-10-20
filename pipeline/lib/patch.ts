// Helpers for a take's `patch` in a sequence (variant edits without recapturing).
//   import { segs, noEffects } from "../lib/patch.ts";
//   { kind: "take", take: "x", patch: segs({ z3: { scale: 1.2 }, reveal: { inMs: 2400 } }) }
//   { kind: "take", take: "x", patch: (e) => noEffects(segs({ z1: { enabled: false } })(e)) }
import type { Edl } from "./plan.ts";

/** change camera segments by id or label (see takes/<take>/edl.json, or the dry-run camera sheet) */
export const segs = (changes: Record<string, Partial<Edl["segments"][number]>>) => (e: Edl): Edl =>
  ({ ...e, segments: e.segments.map((g) => ({ ...g, ...(changes[g.id] ?? (g.label ? changes[g.label] : undefined) ?? {}) })) });

/** drop a take's recorded overlays (keep the camera) */
export const noEffects = (e: Edl): Edl => ({ ...e, effects: [] });
