// Collect the sound effects a take's effects declare → timeline lines for the mixer (lib/audio.ts).
import { EFFECTS } from "./index.ts";
import type { EffectItem } from "./types.ts";
import type { SfxLine } from "../audio.ts";

export function effectSounds(items: EffectItem[] | undefined): SfxLine[] {
  const out: SfxLine[] = [];
  for (const it of items ?? []) {
    if (!it.enabled) continue;
    for (const s of EFFECTS[it.type]?.sounds?.(it) ?? []) out.push({ t: it.start + s.at, key: s.sound, db: s.db, cut: s.dur, fade: s.fade });
  }
  return out;
}

/** the keystroke times (take ms) of a take's typing: each key's recorded time, or, for takes captured before keys were
 *  recorded, keys spaced evenly through the stretch (≈ 85 ms apart, as the capture's paced typing) */
export function keystrokes(typing: { from: number; to: number; keys?: number[] }[] | undefined): number[] {
  return (typing ?? []).flatMap((s) => {
    if (s.keys?.length) return s.keys;
    const n = Math.max(1, Math.round((s.to - s.from) / 85) + 1), step = n > 1 ? (s.to - s.from) / (n - 1) : 0;
    return Array.from({ length: n }, (_, i) => Math.round(s.from + i * step));
  });
}
