// Music analysis: tempo, beat grid, bars, and energy sections — so a video can be cut to its
// music (pick the track first, then pace the edit to its grid). No dependencies: ffmpeg decodes
// mono PCM, then a spectral-flux onset envelope → autocorrelation tempo → beat phase → bars
// (4/4, downbeat = strongest low-end) → per-bar energy → sections where the energy steps.
//
//   npm run music:analyse              → assets/music/<key>.grid.json for every library track
//   npm run music:analyse -- <key>     → one track
//   import { grid, snap } from "./music.ts"  → use the grid in a sequence
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { ASSETS, library, music as musicAsset } from "./assets.ts";

export type Section = { start: number; end: number; energy: number; label: "intro" | "low" | "mid" | "high" | "drop" | "outro" };
export type Grid = { key: string; duration: number; bpm: number; beat: number; bar: number; firstBeat: number; beats: number[]; downbeats: number[]; energy: number[]; sections: Section[] };

const SR = 22050, HOP = 512, N = 2048;

function decode(file: string): Float32Array {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const b = r.stdout as Buffer;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
// in-place radix-2 FFT (re, im)
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}

export function analyse(key: string): Grid {
  const a = musicAsset(key), x = decode(a.path), frames = Math.floor((x.length - N) / HOP);
  const fps = SR / HOP, win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const onset = new Float64Array(frames), low = new Float64Array(frames), rms = new Float64Array(frames);
  let prev = new Float64Array(N / 2);
  const lowBin = Math.round((150 * N) / SR);
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N); let e = 0;
    for (let i = 0; i < N; i++) { const v = x[f * HOP + i]; re[i] = v * win[i]; e += v * v; }
    rms[f] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float64Array(N / 2); let flux = 0, lo = 0;
    for (let k = 1; k < N / 2; k++) { mag[k] = Math.log1p(1000 * Math.hypot(re[k], im[k])); const d = mag[k] - prev[k]; if (d > 0) flux += d; if (k <= lowBin && d > 0) lo += d; }
    onset[f] = flux; low[f] = lo; prev = mag;
  }
  // normalise onset (subtract a moving mean so tempo isn't biased by loud sections)
  const W = Math.round(fps), on = new Float64Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0, c = 0; for (let j = Math.max(0, f - W); j < Math.min(frames, f + W); j++) { s += onset[j]; c++; } on[f] = Math.max(0, onset[f] - s / c); }
  // tempo: autocorrelation over 70–180 BPM, gently weighted towards 115 BPM (log-gaussian prior)
  let best = 0, bestLag = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * fps; let s = 0;
    for (let f = Math.ceil(2 * lag); f < frames; f++) { const l1 = f - lag, l2 = f - 2 * lag, i1 = Math.floor(l1), i2 = Math.floor(l2);
      s += on[f] * ((on[i1] * (1 - (l1 - i1)) + on[i1 + 1] * (l1 - i1)) + 0.5 * (on[i2] * (1 - (l2 - i2)) + on[i2 + 1] * (l2 - i2))); }
    s *= Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.9) ** 2);
    if (s > best) { best = s; bestLag = lag; }
  }
  // anchor on the source's declared BPM when there is one (folded into 70–180), else the estimate;
  // then fine-search tempo (±2.5%) and phase together: over a whole track a 1% tempo error
  // drifts a beat per minute, so the comb must be exact
  let anchor = a.bpm ?? 60 / (bestLag / fps);
  while (anchor < 70) anchor *= 2; while (anchor > 180) anchor /= 2;
  const comb = (lag: number, o: number) => { let s = 0; for (let t = o; t < frames; t += lag) { const i = Math.round(t); s += (on[i] ?? 0) + 0.5 * ((on[i - 1] ?? 0) + (on[i + 1] ?? 0)); } return s; };
  let lagBest = (60 / anchor) * fps, phase = 0, ps = -1;
  for (let b = anchor * 0.975; b <= anchor * 1.025; b += anchor * 0.0005) {
    const lag = (60 / b) * fps;
    for (let o = 0; o < lag; o += 1) { const s = comb(lag, o); if (s > ps) { ps = s; phase = o; lagBest = lag; } }
  }
  for (let o = Math.max(0, phase - 1); o <= phase + 1; o += 0.1) { const s = comb(lagBest, o); if (s > ps) { ps = s; phase = o; } }
  bestLag = lagBest;
  const beat = bestLag / fps, bpm = Math.round((60 / beat) * 100) / 100;
  const beats: number[] = []; for (let t = phase; t < frames; t += bestLag) beats.push(Math.round((t / fps) * 1000) / 1000);
  // downbeat: which of 4 beat positions carries the most low-end onset
  let db = 0, dbs = -1;
  for (let k = 0; k < 4; k++) { let s = 0; for (let i = k; i < beats.length; i += 4) s += low[Math.round(beats[i] * fps)] ?? 0; if (s > dbs) { dbs = s; db = k; } }
  const downbeats = beats.filter((_, i) => i % 4 === db % 4);
  // energy per bar (dB RMS), then sections where it steps by ≥ 3 dB between 2-bar windows
  const energy = downbeats.map((t, i) => { const a0 = Math.round(t * fps), a1 = Math.round((downbeats[i + 1] ?? t + 4 * beat) * fps); let s = 0, c = 0; for (let f = a0; f < Math.min(a1, frames); f++) { s += rms[f] ** 2; c++; } return Math.round(10 * Math.log10(s / Math.max(1, c) + 1e-9) * 10) / 10; });
  const cuts = [0];
  for (let i = 2; i < energy.length - 1; i++) { const before = (energy[i - 1] + energy[i - 2]) / 2, after = (energy[i] + energy[i + 1]) / 2; if (Math.abs(after - before) >= 2.5 && i - cuts[cuts.length - 1] >= 4) cuts.push(i); }
  const sorted = [...energy].sort((p, q) => p - q), pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const duration = x.length / SR, lo = pct(0.1), hi = pct(0.95); // robust range: ignore silent tails / one-off peaks
  const sections: Section[] = cuts.map((c, j) => {
    const end = cuts[j + 1] ?? energy.length, e = energy.slice(c, end).reduce((s, v) => s + v, 0) / (end - c), rel = (e - lo) / Math.max(1, hi - lo);
    const start = j === 0 ? 0 : downbeats[c], prevE = j > 0 ? energy.slice(cuts[j - 1], c).reduce((s, v) => s + v, 0) / (c - cuts[j - 1]) : e;
    const label: Section["label"] = j === 0 && cuts.length > 1 && e < (energy.slice(cuts[1]).reduce((s, v) => s + v, 0) / Math.max(1, energy.length - cuts[1])) - 2 ? "intro"
      : j === cuts.length - 1 && j > 0 && e < prevE - 3 ? "outro" : j > 0 && e - prevE >= 4 ? "drop" : rel > 0.75 ? "high" : rel > 0.45 ? "mid" : "low";
    return { start: Math.round(start * 100) / 100, end: Math.round((cuts[j + 1] !== undefined ? downbeats[cuts[j + 1]] : duration) * 100) / 100, energy: Math.round(e * 10) / 10, label };
  });
  return { key, duration: Math.round(duration * 100) / 100, bpm, beat: Math.round(beat * 10000) / 10000, bar: Math.round(4 * beat * 10000) / 10000, firstBeat: beats[0], beats, downbeats, energy, sections };
}

/** where a track's beat grid lives: assets/music/<key>.grid.json, or next to a project's own track */
export const gridPath = (key: string) => { const a = library().music[key]; return a && isAbsolute(a.file) ? a.file.replace(/\.[^./]+$/, ".grid.json") : join(ASSETS, "music", `${key}.grid.json`); };
/** the analysed grid for a library track (run `npm run music:analyse` first) */
export function grid(key: string): Grid {
  const p = gridPath(key); if (!existsSync(p)) throw new Error(`no beat grid for "${key}" — run npm run music:analyse -- ${key}`);
  return JSON.parse(readFileSync(p, "utf8"));
}
/** nearest beat (or downbeat) to t seconds, optionally offset by the track's start offset */
export function snap(g: Grid, t: number, to: "beat" | "bar" = "beat", offset = 0) {
  const xs = to === "bar" ? g.downbeats : g.beats; let b = xs[0];
  for (const v of xs) { if (Math.abs(v - offset - t) < Math.abs(b - offset - t)) b = v; }
  return b - offset;
}
/**
 * The track's own ending, for `music: { ending: "tail" }`: the last `n` bars before the music
 * stops, plus its ring-out. Returns where that tail starts in the track and how long it runs.
 */
export function endingTail(g: Grid, n = Math.max(1, Math.min(4, Math.floor(4 / g.bar)))) { // ≤ ~4 s of bars (the closing card holds ≤ ~5.5 s)
  const ref = [...g.energy].sort((a, b) => a - b)[Math.floor(g.energy.length / 2)];
  let last = g.energy.length - 1; while (last > n && g.energy[last] < ref - 15) last--; // last bar with music in it
  const start = g.downbeats[Math.max(0, last - n + 1)];
  const end = Math.min(g.duration, g.downbeats[last] + g.bar + 1.5); // the final bar + up to 1.5 s of ring-out
  return { start, len: end - start, bars: n };
}
/** seconds for n bars / beats of this track */
export const bars = (g: Grid, n: number) => n * g.bar;
export const beats = (g: Grid, n: number) => n * g.beat;

if (process.argv[1]?.endsWith("music.ts")) {
  const keys = process.argv[2] ? [process.argv[2]] : Object.keys(library().music);
  for (const k of keys) {
    const g = analyse(k);
    writeFileSync(gridPath(k), JSON.stringify(g));
    console.log(`${k.padEnd(18)} ${String(g.bpm).padStart(6)} BPM  bar ${g.bar.toFixed(2)}s  first beat ${g.firstBeat.toFixed(2)}s  ${g.sections.map((s) => `${s.label}@${s.start.toFixed(0)}`).join(" ")}`);
  }
}
