// flex duck: how the music dips under each narration line, measured on the mix as the pipeline makes it (the music layer
// after its ducking, and the voice layer). Numbers only; whether a dip is too deep or pumps is the film's call.
//   duck.mts <project> [--json]
// Per line: the music's level before the line (the 1.5 s up to it), during it (median) and after it; the dip (dB);
// attack (ms until the music is within 1 dB of its level during the line) and release (ms after the line until it's back
// within 1 dB of its level after); pumping (the music's spread during the line, dB: high = audible breathing); and how far
// the voice sits above the music (dB).
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = ((w) => (s: string) => w(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
const argv = process.argv.slice(2), JSONOUT = argv.includes("--json");
const DIR = resolve(argv.find((a) => !a.startsWith("-")) ?? ".");
const { planSequence, mixSequence } = await import(pathToFileURL(join(import.meta.dirname, "timeline.mts")).href);

const plan = await planSequence(DIR);
const work = mkdtempSync(join(tmpdir(), "flex-duck-"));
const SR = 8000, HOP = 400; // 50 ms windows
function levels(file: string) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const b = r.stdout as Buffer, x = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)), n = Math.floor(x.length / HOP), db = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * HOP; j < (i + 1) * HOP; j++) s += x[j] * x[j]; db[i] = 10 * Math.log10(s / HOP + 1e-12); }
  return db;
}
try {
  const music = join(work, "music.wav"), voice = join(work, "voice.wav");
  await mixSequence(plan, music, "music");
  await mixSequence(plan, voice, "voice");
  const M = levels(music), V = levels(voice), fps = SR / HOP;
  const span = (a: Float64Array, t0: number, t1: number) => Array.from(a.slice(Math.max(0, Math.round(t0 * fps)), Math.max(0, Math.round(t1 * fps))));
  const median = (v: number[]) => { const s = [...v].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const lines = plan.voice.map((l: any) => {
    const t = l.t / 1000, e = t + l.dur; // the plan's voice lines: t in ms, dur in seconds
    const before = median(span(M, t - 1.5, t - 0.1)), during = median(span(M, t + 0.3, e)), after = median(span(M, e + 0.6, e + 2));
    const dv = span(M, t, e), within = (x: number, lvl: number) => Math.abs(x - lvl) <= 1;
    const attackI = dv.findIndex((x) => within(x, during)), rel = span(M, e, e + 2.5), releaseI = rel.findIndex((x) => within(x, after));
    const mid = span(M, t + 0.3, e), mean = mid.reduce((p, q) => p + q, 0) / Math.max(1, mid.length);
    const spread = Math.sqrt(mid.reduce((p, q) => p + (q - mean) ** 2, 0) / Math.max(1, mid.length));
    const vo = median(span(V, t, e).filter((x) => x > -60));
    return { text: l.text, t: Math.round(t * 100) / 100, dur: Math.round(l.dur * 1000) / 1000, before: r1(before), during: r1(during), after: r1(after), dip: r1(before - during),
      attackMs: attackI < 0 ? null : Math.round((attackI / fps) * 1000), releaseMs: releaseI < 0 ? null : Math.round((releaseI / fps) * 1000),
      pumping: r1(spread), voiceOverMusic: r1(vo - during) };
  });
  if (JSONOUT) out(JSON.stringify({ ok: true, lines }));
  else {
    out(`  film     music before → during → after (dBFS)   dip   attack  release  pumping  voice over music`);
    for (const l of lines) out(`${String(l.t.toFixed(2)).padStart(7)}s  ${String(l.before).padStart(6)} → ${String(l.during).padStart(6)} → ${String(l.after).padStart(6)}   ${String(l.dip).padStart(5)}  ${String(l.attackMs ?? "—").padStart(5)} ms ${String(l.releaseMs ?? "—").padStart(6)} ms  ${String(l.pumping).padStart(5)} dB  ${String(l.voiceOverMusic).padStart(6)} dB   “${l.text.slice(0, 40)}${l.text.length > 40 ? "…" : ""}”`);
    if (!lines.length) out("(no narration)");
  }
} finally { rmSync(work, { recursive: true, force: true }); }
process.exit(0);
