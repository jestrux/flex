// npm run music:show <key> — the track as a bar map: tempo, sections, energy per bar, and
// suggested start points (`music: { key, from }`) for a video of a given length.
import { grid } from "./music.ts";
import { music } from "./assets.ts";
// --rise-at <s>: list `from` values that put a rise (a louder section) <s> seconds into the video
import { flags } from "./args.ts";
const F = flags("music:show", ["rise-at"]), argv = F.positional, riseAt = F.get("rise-at") !== undefined ? Number(F.get("rise-at")) : null;
const key = argv[0]; if (!key) throw new Error("usage: music:show <key> [videoSeconds] [--rise-at <s>]  — e.g. --rise-at 28 = the rise lands 28 s INTO THE VIDEO (not track time)");
const len = Number(argv[1] ?? 60), g = grid(key), a = music(key);
/** nearest downbeat: a `from` on a downbeat keeps every later bar line where the grid says */
const onBar = (t: number) => g.downbeats.reduce((b, d) => (Math.abs(d - t) < Math.abs(b - t) ? d : b), g.downbeats[0]);
console.log(`${key} — ${a.mood}\n  ${g.bpm} BPM · bar ${g.bar.toFixed(2)}s · beat ${g.beat.toFixed(3)}s · ${g.duration.toFixed(0)}s long · ${a.licence}${a.feel ? ` · ${a.feel}` : ""}\n`);
console.log("  sections:"); for (const s of g.sections) console.log(`    ${s.label.padEnd(6)} ${s.start.toFixed(2).padStart(7)}s → ${s.end.toFixed(2).padStart(7)}s  (${Math.round((s.end - s.start) / g.bar)} bars, ${s.energy} dB)`);
const srt = [...g.energy].sort((p, q) => p - q), lo = srt[Math.floor(0.1 * srt.length)], hi = srt[Math.floor(0.95 * srt.length)];
console.log("\n  energy per bar (█ = loud; relative to this track — a blank is quieter, not silent):");
for (let i = 0; i < g.energy.length; i += 16) console.log(`    ${g.downbeats[i].toFixed(1).padStart(6)}s  ${g.energy.slice(i, i + 16).map((e) => " ▁▂▃▄▅▆▇█"[Math.max(0, Math.min(8, Math.round(((e - lo) / Math.max(1, hi - lo)) * 8)))]).join("")}`);
// suggestions: start at a section start so the video spans whole sections; prefer ones where a
// rise happens ~60–80% through (a payoff near the end) for teasers, steady energy for walkthroughs
console.log(`\n  ${len}s windows starting on a section (bars ≈ ${(len / g.bar).toFixed(1)}):`);
for (const s of g.sections) {
  const from = onBar(s.start);
  if (from + len > g.duration) continue;
  const inside = g.sections.filter((x) => x.start > from + 0.1 && x.start < from + len).map((x) => `${x.label}@+${(x.start - from).toFixed(1)}s`);
  console.log(`    from ${from.toFixed(2)}s  ${inside.join(" ") || "(one section — steady)"}`);
}
if (riseAt !== null) {
  console.log(`\n  rises landing at +${riseAt}s (a section ≥ 2 dB louder than the one before):`);
  let n = 0;
  g.sections.forEach((s, i) => {
    const prev = g.sections[i - 1]; if (!prev || s.energy < prev.energy + 2) return;
    const from = onBar(s.start - riseAt); if (from < 0 || from + len > g.duration + 4) return;
    n++; console.log(`    from ${from.toFixed(2)}s  → ${s.label} (+${(s.energy - prev.energy).toFixed(0)} dB) at +${(s.start - from).toFixed(1)}s${from + len > g.duration ? "  (track ends early: use ending \"tail\")" : ""}`);
  });
  if (!n) console.log("    (none — this track has no clear rise; pick another or plan around its sections)");
}
