// A track, read for cutting to: the beat grid (tempo from the pipeline's analysis, its phase checked against the drum
// stem's kicks), what each stem plays bar by bar, where the lead vocal sings, and what it sings (local Whisper, word times),
// all on the film's grid as bar.beat. Replaces the one-off numpy scripts the first agent-made film needed.
//   music.mts <project> [<key>] [--lyrics] [--json]
//   music.mts <project> [<key>] --at <bar.beat | 12.5s>      (convert on the analysed grid)
//   music.mts <project> [<key>] --sheet [--from s --to s] [-o f.png]   (the audio as a picture)
// Writes, next to the track: <track>.grid.json (the pipeline's grid, phase-corrected; `snap` and the planner read it),
// <track>.music.json (all of the below), <track>.lyrics.json (Whisper's words, cached by the stem's size and date).
// Runs with Flex's tool env (FLEX_PIPELINE, FLEX_PROJECTS: crates/flex-core/src/tools.rs).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PIPE = process.env.FLEX_PIPELINE!;
const imp = (p: string) => import(pathToFileURL(join(PIPE, p)).href);
const out = ((w) => (s: string) => w(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
const argv = process.argv.slice(2), flag = (f: string) => argv.includes(`--${f}`), pos = argv.filter((a, i) => !a.startsWith("-") && !(i > 0 && ["--at", "--from", "--to", "-o"].includes(argv[i - 1])));
const DIR = resolve(pos[0] ?? ".");
const fail = (m: string): never => { if (flag("json")) out(JSON.stringify({ ok: false, error: m })); else console.error(`!! ${m}`); process.exit(1); };

const audio = existsSync(join(DIR, "audio.json")) ? JSON.parse(readFileSync(join(DIR, "audio.json"), "utf8")) : fail(`no audio.json in ${DIR}`);
const keys = Object.keys(audio.music ?? {});
const key = pos[1] ?? (keys.length === 1 ? keys[0] : fail(`which track? (${keys.join(", ") || "audio.json has no music"})`));
const entry = audio.music?.[key] ?? fail(`no music "${key}" in audio.json (${keys.join(", ")})`);
const track = join(DIR, entry.file);

// --at <bar.beat | seconds>: convert on the track's analysed grid (from <track>.music.json, without analysing again)
const atArg = (() => { const i = argv.indexOf("--at"); return i >= 0 ? argv[i + 1] : null; })();
if (atArg) {
  const mf = track.replace(/\.[^./]+$/, ".music.json");
  if (!existsSync(mf)) fail(`no ${basename(mf)} yet: run flex music first`);
  const m = JSON.parse(readFileSync(mf, "utf8"));
  const bm = atArg.match(/^(\d+)(?:\.(\d+(?:\.\d+)?))?$/), secs = atArg.match(/^(\d+(?:\.\d+)?)s$/);
  if (bm) { const t = m.firstDownbeat + (Number(bm[1]) - 1) * m.bar + (Number(bm[2] ?? 1) - 1) * m.beat; out(flag("json") ? JSON.stringify({ ok: true, at: atArg, t: Math.round(t * 1000) / 1000 }) : `${atArg} = ${t.toFixed(3)} s`); }
  else if (secs) { const t = Number(secs[1]), rel = (t - m.firstDownbeat) / m.bar, bar = Math.floor(rel) + 1, beat = Math.round(((rel - Math.floor(rel)) * 4 + 1) * 100) / 100;
    out(flag("json") ? JSON.stringify({ ok: true, t, bar, beat }) : `${t} s = bar ${bar} beat ${beat}`); }
  else fail(`--at takes bar.beat (15.2.5) or seconds (33.3s), not "${atArg}"`);
  process.exit(0);
}

// ── the pipeline's grid: tempo, beats, sections ─────────────────────────────────────────────────────────────────────────
const { analyse, gridPath } = await imp("lib/music.ts");
const g = analyse(key);

// ── decode helpers (ffmpeg does the filtering) ────────────────────────────────────────────────────────────────────────
const SR = 22050;
function decode(file: string, af = ""): Float32Array {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, ...(af ? ["-af", af] : []), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const b = r.stdout as Buffer;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
}
/** energy per hop (dB-ish, log), and its rise (onset strength) */
function envelope(x: Float32Array, hop: number) {
  const n = Math.floor(x.length / hop), e = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j]; e[i] = Math.log1p(1e4 * s / hop); }
  const on = new Float64Array(n); for (let i = 1; i < n; i++) on[i] = Math.max(0, e[i] - e[i - 1]);
  return { e, on, fps: SR / hop };
}
const at = (arr: Float64Array, fps: number, t: number) => arr[Math.round(t * fps)] ?? 0;

// ── stems ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// a track's own stems (`music.<key>.stems`, when the project has more than one song), else the project's
const stemDir = join(DIR, typeof entry.stems === "string" ? entry.stems : typeof audio.stems === "string" ? audio.stems : "audio/stems/");
const stems = existsSync(stemDir) ? readdirSync(stemDir).filter((f) => /\.(wav|mp3|flac|m4a)$/i.test(f)).sort() : [];
const find = (re: RegExp) => stems.find((f) => re.test(f));
const drums = find(/drum/i), lead = find(/lead.*vocal|vocal.*lead/i) ?? find(/vocal/i);
const notes: string[] = [];
if (!stems.length) notes.push(`no stems (${stemDir}): the grid's phase is the full mix's guess; no per-stem map or vocal phrases`);

// the grid's phase, checked against the kicks: fold the drum stem's low band (< 120 Hz) over the beat
let shiftMs = 0, downIdx = 0;
let kick: { on: Float64Array; fps: number } | null = null;
if (drums) {
  const k = envelope(decode(join(stemDir, drums), "lowpass=f=120,lowpass=f=120"), 128);
  let best = -1, bestOff = 0;
  for (let off = -g.beat / 2; off < g.beat / 2; off += 0.005) {
    let s = 0; for (const b of g.beats) s += at(k.on, k.fps, b + off) + 0.5 * (at(k.on, k.fps, b + off - 1 / k.fps) + at(k.on, k.fps, b + off + 1 / k.fps));
    if (s > best) { best = s; bestOff = off; }
  }
  shiftMs = Math.round(bestOff * 1000);
  kick = k;
}
// the downbeat is a musical call (which beat is "1"), so Flex doesn't make it: the project records it (audio.json
// "downbeat": a song second on beat 1, chosen by whoever cuts the film), and Flex shows the evidence for each of the four
// candidates below. Until it's chosen, bar 1 is simply the first beat.
let downFrom = "not chosen yet: bar 1 is the first beat";
const chosen = typeof entry.downbeat === "number";
const shiftedBeats = g.beats.map((b: number) => Math.round((b + shiftMs / 1000) * 1000) / 1000).filter((b: number) => b >= 0);
downIdx = 0;
if (chosen) {
  let n = 0; shiftedBeats.forEach((b: number, i: number) => { if (Math.abs(b - entry.downbeat) < Math.abs(shiftedBeats[n] - entry.downbeat)) n = i; });
  downIdx = n % 4; downFrom = `chosen: audio.json "downbeat" ${entry.downbeat} s`;
}
const beats = g.beats.map((b: number) => Math.round((b + shiftMs / 1000) * 1000) / 1000).filter((b: number) => b >= 0);
const downbeats = beats.filter((_: number, i: number) => i % 4 === downIdx % 4);
const d0 = downbeats[0], barLen = g.bar, beatLen = g.beat;
/** t → "bar.beat" on the film's grid (bar 1 = the first downbeat; beats in quarters) */
const pos4 = (t: number) => {
  const rel = (t - d0) / barLen, bar = Math.floor(rel) + 1, beat = ((rel - Math.floor(rel)) * 4) + 1;
  const b = Math.round(beat * 4) / 4;
  // before bar 1: the pickup, counted back from bar 1 ("pickup -0.25" = a quarter beat before it)
  if (bar < 1) return `pickup ${(-Math.round(((d0 - t) / beatLen) * 4) / 4).toString()}`;
  return b >= 5 ? `${bar + 1}.1` : `${bar}.${b}`;
};
/** ms from the nearest beat (negative: early) */
const offBeat = (t: number) => { let n = beats[0]; for (const b of beats) if (Math.abs(b - t) < Math.abs(n - t)) n = b; return Math.round((t - n) * 1000); };
writeFileSync(gridPath(key), JSON.stringify({ ...g, beats, downbeats, firstBeat: beats[0], phase: { shiftMs, from: drums ? `drum stem kicks (${drums})` : "the full mix" } }));

// what each stem plays, bar by bar (level 0–8 relative to the stem's own loudest bar)
const bars = downbeats.length;
const activity: Record<string, number[]> = {};
// the hits: each stem's onsets that stand out (a kick, a snare fill, a stab, a vocal entry), strength 0–1 against the
// stem's own strongest; and its entries (it starts playing after a bar or more of rest)
type Hit = { stem: string; t: number; at: string; strength: number; entry?: boolean };
const hitList: Hit[] = [];
/** each stem's energy over time (for the sheet) */
const envs: Record<string, { e: Float64Array; fps: number }> = {};
const stemName = (f: string) => f.replace(/\.[^.]+$/, "").replace(/^\d+\s*/, "");
for (const f of stems) {
  const name = stemName(f);
  const { e, on, fps } = envelope(decode(join(stemDir, f)), 256);
  envs[name] = { e, fps };
  const lv = downbeats.map((t: number, i: number) => { const a = Math.round(t * fps), b = Math.round((downbeats[i + 1] ?? t + barLen) * fps); let s = 0, c = 0; for (let q = a; q < Math.min(b, e.length); q++) { s += e[q]; c++; } return c ? s / c : 0; });
  const mx = Math.max(...lv, 1e-9);
  activity[name] = lv.map((v) => Math.round((v / mx) * 8));
  // peaks of the onset strength: a local maximum (±60 ms), well above the stem's typical onset (mean + 3σ)
  const n = on.length, mean = on.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(on.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const w = Math.round(0.06 * fps), thr = mean + 3 * sd, peaks: { t: number; v: number }[] = [];
  for (let i = w; i < n - w; i++) {
    if (on[i] < thr) continue;
    let top = true; for (let j = i - w; j <= i + w; j++) if (on[j] > on[i]) { top = false; break; }
    if (top && (!peaks.length || i / fps - peaks[peaks.length - 1].t > 0.1)) peaks.push({ t: i / fps, v: on[i] });
  }
  const pm = Math.max(...peaks.map((p) => p.v), 1e-9);
  for (const p of peaks) { const st = Math.round((p.v / pm) * 100) / 100; if (st >= 0.35) hitList.push({ stem: name, t: Math.round(p.t * 1000) / 1000, at: pos4(p.t), strength: st }); }
  // entries: the first onset of a bar after a silent bar (level 0–1 of 8)
  activity[name].forEach((l, i) => {
    if (i === 0 || l < 3 || activity[name][i - 1] > 1) return;
    const a = downbeats[i] - beatLen, first = peaks.find((p) => p.t >= a && p.t < downbeats[i] + barLen);
    if (first) hitList.push({ stem: name, t: Math.round(first.t * 1000) / 1000, at: pos4(first.t), strength: Math.round((first.v / pm) * 100) / 100, entry: true });
  });
}
hitList.sort((a, b) => a.t - b.t);

// where the lead vocal sings: phrases (above 20 dB under its loud passages, ≥ 0.25 s, gaps < 0.3 s merged)
const phrases: { start: number; end: number; at: string }[] = [];
if (lead) {
  const { e, fps } = envelope(decode(join(stemDir, lead), "highpass=f=150"), 256);
  const sorted = Array.from(e).sort((a, b) => a - b), loud = sorted[Math.floor(sorted.length * 0.95)];
  const thr = loud * 0.35;
  let s = -1;
  for (let i = 0; i <= e.length; i++) {
    const on = i < e.length && e[i] > thr;
    if (on && s < 0) s = i;
    if (!on && s >= 0) { const a = s / fps, b = i / fps; const last = phrases[phrases.length - 1];
      if (last && a - last.end < 0.3) last.end = b; else phrases.push({ start: a, end: b, at: "" }); s = -1; }
  }
  for (let i = phrases.length - 1; i >= 0; i--) if (phrases[i].end - phrases[i].start < 0.25) phrases.splice(i, 1);
  for (const p of phrases) { p.start = Math.round(p.start * 100) / 100; p.end = Math.round(p.end * 100) / 100; p.at = pos4(p.start); }
}

// what it sings: local Whisper on the lead vocal, one sung stretch at a time (a whole-stem pass skips loud choruses),
// word times (cached). What Whisper heard is reported as heard (it isn't prompted with the song's words: a prompt makes it
// repeat them); reading the lyrics (brand words misheard, hooks, lines) is the film's own work.
/** line: which sung stretch the word is in */
type Word = { word: string; start: number; end: number; line?: number; at?: string; offBeatMs?: number };
let words: Word[] = [];
const lyricsFile = track.replace(/\.[^./]+$/, ".lyrics.json");
const MODEL = "mlx-community/whisper-large-v3-turbo";
if (lead) {
  const st = statSync(join(stemDir, lead)), stamp = `v2:${st.size}:${st.mtimeMs}`;
  const cached = existsSync(lyricsFile) ? JSON.parse(readFileSync(lyricsFile, "utf8")) : null;
  if (cached?.stamp === stamp) words = cached.words;
  else {
    // Flex's one Whisper path (server/whisper.py, also `flex transcribe`), run with mlx-whisper's python: both from tools.rs
    const py = process.env.FLEX_WHISPER_PY, script = process.env.FLEX_WHISPER;
    const ready = existsSync(join(process.env.HOME!, ".cache/huggingface/hub", `models--${MODEL.replace("/", "--")}`));
    if (!py || !script) notes.push("no lyrics: mlx_whisper is not installed (uv tool install mlx-whisper; flex doctor)");
    else if (!ready && !flag("lyrics")) notes.push(`no lyrics: the Whisper model isn't downloaded yet (~1.6 GB); run again with --lyrics to fetch it`);
    else {
      // the stretches: the vocal's phrases, at most 4 bars each (split on bar lines)
      const chunks: [number, number][] = [];
      for (const p of phrases) {
        let a = p.start;
        while (a < p.end - 0.2) { const lim = a + 4 * barLen, b = lim >= p.end ? p.end : (downbeats.find((d: number) => d > lim - barLen && d <= lim) ?? lim); chunks.push([a, b]); a = b; }
      }
      console.error(`  transcribing ${lead}: ${chunks.length} sung stretches (local Whisper)…`);
      const r = spawnSync(py, [script], { input: JSON.stringify({ file: join(stemDir, lead), model: MODEL, chunks, language: "en" }), encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, HF_HUB_DISABLE_XET: "1" } });
      const last = (r.stdout || "").trim().split("\n").pop() ?? "";
      if (r.status !== 0 || !last.startsWith("[")) notes.push(`no lyrics: Whisper failed (${(r.stderr || "").trim().split("\n").pop()})`);
      else { words = JSON.parse(last); writeFileSync(lyricsFile, JSON.stringify({ stamp, model: MODEL, stem: lead, words }, null, 1)); }
    }
  }
  for (const w of words) { w.at = pos4(w.start); w.offBeatMs = offBeat(w.start); }
  // with words, phrases are the sung stretches' words, split again at a pause of 0.35 s or more
  if (words.length) {
    phrases.length = 0;
    for (const w of words) {
      const last = phrases[phrases.length - 1] as any;
      if (last && last.line === w.line && w.start - last.end < 0.35) { last.end = w.end; last.text += ` ${w.word}`; }
      else phrases.push({ start: w.start, end: w.end, at: w.at!, text: w.word, line: w.line } as any);
    }
  } else for (const p of phrases as any[]) p.text = "";
}

// the evidence for each candidate downbeat (beat k of every 4): measurements, no verdict
//   kick: the drum stem's low-band onsets on those beats (share of all four)
//   jumps: the biggest rises in the mix's energy (a drop, an entry) that land on them (share)
//   lines: sung lines (or vocal phrases) that start within an eighth of a beat of them (count)
const evidence = [0, 1, 2, 3].map((k) => {
  const on = (b: number, i: number) => i % 4 === k;
  const kickSum = kick ? shiftedBeats.reduce((s: number, b: number, i: number) => s + (on(b, i) ? at(kick!.on, kick!.fps, b) : 0), 0) : 0;
  return { k, bar1: shiftedBeats[k], kick: kickSum, jumps: 0, lines: 0 };
});
{
  const kt = evidence.reduce((s, e) => s + e.kick, 0) || 1; for (const e of evidence) e.kick = Math.round((e.kick / kt) * 100) / 100;
  const x = decode(track), rms: number[] = [];
  for (let i = 0; i + 1 < shiftedBeats.length; i++) { const a = Math.round(shiftedBeats[i] * SR), b = Math.round(shiftedBeats[i + 1] * SR); let q = 0; for (let j = a; j < b && j < x.length; j++) q += x[j] * x[j]; rms.push(10 * Math.log10(q / Math.max(1, b - a) + 1e-12)); }
  const jumps: [number, number][] = [];
  for (let i = 2; i + 2 < rms.length; i++) jumps.push([(rms[i] + rms[i + 1]) / 2 - (rms[i - 1] + rms[i - 2]) / 2, i]);
  const top = jumps.sort((a, b) => b[0] - a[0]).slice(0, 8).filter(([v]) => v > 0), jt = top.reduce((s, [v]) => s + v, 0) || 1;
  for (const [v, i] of top) evidence[i % 4].jumps += v / jt;
  for (const e of evidence) e.jumps = Math.round(e.jumps * 100) / 100;
  for (const p of phrases) { let n = 0; shiftedBeats.forEach((b: number, i: number) => { if (Math.abs(b - p.start) < Math.abs(shiftedBeats[n] - p.start)) n = i; }); if (Math.abs(shiftedBeats[n] - p.start) < beatLen / 8) evidence[n % 4].lines++; }
}

const result = {
  ok: true, key, track: entry.file, duration: g.duration, bpm: g.bpm, beat: beatLen, bar: barLen,
  phase: { shiftMs, from: drums ?? null }, downbeat: { chosen, from: downFrom, evidence }, firstDownbeat: d0, bars,
  // section starts snapped to the corrected bar lines (the analysis finds them on its own, uncorrected grid)
  // where the mix's energy steps (the analysis' sections, without its names: whether a step is a drop is the film's call):
  // the start on the corrected bar lines, the stretch's energy and the step from the one before (dB)
  sections: g.sections.map((s: any, i: number, all: any[]) => { const t = s.start < d0 ? 0 : downbeats.reduce((n: number, d: number) => Math.abs(d - s.start) < Math.abs(n - s.start) ? d : n, downbeats[0]);
    return { start: Math.round(t * 1000) / 1000, end: s.end, at: t === 0 ? "start" : pos4(t), energy: s.energy, step: i ? Math.round((s.energy - all[i - 1].energy) * 10) / 10 : null }; }),
  stems: activity, hits: hitList, phrases, words, notes,
};
writeFileSync(track.replace(/\.[^./]+$/, ".music.json"), JSON.stringify(result, null, 1));
// --sheet [--from s --to s]: the audio as a picture an agent can read (it can't listen): each stem's energy as a band,
// bar lines (numbered) and beats, hits as dots sized by strength (rings: entries), the sung words under the lead vocal
if (flag("sheet")) {
  const num = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(String(argv[i + 1]).replace(/s$/, "")) : null; };
  const A = num("from") ?? 0, B = num("to") ?? g.duration, names = Object.keys(envs);
  const W = 2400, L = 150, rowH = 64, top = 46, H = top + names.length * rowH + 70, x = (t: number) => L + ((t - A) / (B - A)) * (W - L - 20);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#101014"/>`;
  for (const b of beats) if (b >= A && b <= B) svg += `<line x1="${x(b)}" y1="${top}" x2="${x(b)}" y2="${H - 60}" stroke="#ffffff" stroke-opacity="0.07"/>`;
  downbeats.forEach((d: number, i: number) => { if (d < A || d > B) return; svg += `<line x1="${x(d)}" y1="${top - 8}" x2="${x(d)}" y2="${H - 60}" stroke="#ffffff" stroke-opacity="0.3"/><text x="${x(d) + 3}" y="${top - 12}" fill="#cfcfd6" font-family="Helvetica" font-size="15">${i + 1}</text>`; });
  names.forEach((n, r) => {
    const y0 = top + r * rowH, { e, fps } = envs[n], mx = Math.max(...Array.from(e), 1e-9);
    svg += `<text x="10" y="${y0 + rowH / 2 + 5}" fill="#cfcfd6" font-family="Helvetica" font-size="15">${esc(n)}</text>`;
    let pts = "", step = Math.max(1, Math.floor(((B - A) * fps) / (W - L)));
    for (let i = Math.floor(A * fps); i < Math.min(e.length, B * fps); i += step) { const h = (e[i] / mx) * (rowH - 12) / 2; pts += `${x(i / fps).toFixed(1)},${(y0 + rowH / 2 - h).toFixed(1)} `; }
    for (let i = Math.min(e.length, Math.floor(B * fps)) - 1; i >= Math.floor(A * fps); i -= step) { const h = (e[i] / mx) * (rowH - 12) / 2; pts += `${x(i / fps).toFixed(1)},${(y0 + rowH / 2 + h).toFixed(1)} `; }
    svg += `<polygon points="${pts}" fill="hsl(${(r * 47) % 360} 70% 62%)" fill-opacity="0.75"/>`;
    for (const h of hitList.filter((q) => q.stem === n && q.t >= A && q.t <= B)) svg += h.entry
      ? `<circle cx="${x(h.t)}" cy="${y0 + rowH / 2}" r="9" fill="none" stroke="#c8ff3c" stroke-width="2.5"/>`
      : `<circle cx="${x(h.t)}" cy="${y0 + rowH / 2}" r="${(2 + 4 * h.strength).toFixed(1)}" fill="#ffffff" fill-opacity="${(0.3 + 0.6 * h.strength).toFixed(2)}"/>`;
  });
  let lastX = -1e9, lane = 0;
  for (const w of words.filter((q) => q.start >= A && q.start <= B)) {
    const wx = x(w.start); lane = wx - lastX < 70 ? (lane + 1) % 3 : 0; lastX = wx;
    svg += `<line x1="${wx}" y1="${H - 62}" x2="${wx}" y2="${H - 54 + lane * 16}" stroke="#c8ff3c" stroke-opacity="0.6"/><text x="${wx + 2}" y="${H - 44 + lane * 16}" fill="#c8ff3c" font-family="Helvetica" font-size="14">${esc(w.word)}</text>`;
  }
  svg += `<text x="10" y="22" fill="#ffffff" font-family="Helvetica" font-size="17">${esc(key)} · ${A.toFixed(2)}–${B.toFixed(2)} s (song time) · ${g.bpm} bpm · bars numbered on the grid · dots: hits (size = strength) · rings: entries · lime: sung words</text></svg>`;
  const sharp = (await imp("node_modules/sharp/lib/index.js")).default;
  const file = (() => { const i = argv.indexOf("-o"); return i >= 0 ? resolve(argv[i + 1]) : track.replace(/\.[^./]+$/, `.sheet${num("from") !== null || num("to") !== null ? `-${A}-${B}` : ""}.png`); })();
  await sharp(Buffer.from(svg)).png().toFile(file);
  out(flag("json") ? JSON.stringify({ ok: true, sheet: file }) : `sheet → ${file}`);
  process.exit(0);
}

if (flag("json")) { out(JSON.stringify(result)); process.exit(0); }

// the readable map: one line per bar
const BLOCK = " ▁▂▃▄▅▆▇█", names = Object.keys(activity);
out(`${key}: ${g.bpm} bpm · beat ${beatLen.toFixed(3)} s · bar ${barLen.toFixed(3)} s · ${g.duration} s · bar 1 at ${d0.toFixed(3)} s`);
out(`grid phase: ${drums ? `${shiftMs >= 0 ? "+" : ""}${shiftMs} ms from the analysis, on the kicks of ${drums}` : "the full mix's guess (no drum stem)"}`);
out(`downbeat: ${downFrom}`);
out(`  the evidence (choose, then set audio.json "downbeat" to that song second):`);
for (const e of evidence) out(`  ${e.k === downIdx ? "→" : " "} beat 1 at ${e.bar1.toFixed(3)} s   kick ${e.kick.toFixed(2)} · energy jumps ${e.jumps.toFixed(2)} · sung lines starting ${e.lines}`);
out(`energy steps: ${result.sections.map((s: any) => `${s.at} (${s.start} s)${s.step === null ? "" : ` ${s.step >= 0 ? "+" : ""}${s.step} dB`}`).join(" · ")}`);
out("");
out(`bar  time    ${names.map((n) => n.slice(0, 6).padEnd(6)).join(" ")}  hits (16ths)      sung`);
for (let i = 0; i < bars; i++) {
  const t = downbeats[i], tn = downbeats[i + 1] ?? t + barLen;
  const sung = words.filter((w) => w.start >= t && w.start < tn).map((w) => w.word).join(" ");
  // the bar's strongest hit per beat, as a 16-step strip (x: ≥ 0.7, o: weaker)
  const strip = Array.from({ length: 16 }, (_, k) => { const a = t + (k * beatLen) / 4, b = a + beatLen / 4; const h = hitList.filter((x) => !x.entry && x.t >= a - beatLen / 8 && x.t < b - beatLen / 8); const m = Math.max(0, ...h.map((x) => x.strength)); return m >= 0.7 ? "x" : m > 0 ? "o" : "·"; }).join("");
  out(`${String(i + 1).padStart(3)}  ${t.toFixed(2).padStart(6)}  ${names.map((n) => BLOCK[activity[n][i]].repeat(2).padEnd(6)).join(" ")}  ${strip}  ${sung}`);
}
const entries = hitList.filter((h) => h.entry);
if (entries.length) { out(""); out("entries (a stem starts after a bar or more of rest):"); for (const h of entries) out(`  ${h.at.padEnd(8)} ${h.t.toFixed(2).padStart(6)} s  ${h.stem}`); }
if (phrases.length) {
  out("");
  out("vocal phrases:");
  for (const p of phrases as any[]) out(`  ${p.at.padEnd(7)} ${p.start.toFixed(2)}–${p.end.toFixed(2)} s  ${p.text ?? ""}`);
}
for (const n of notes) out(`note: ${n}`);
out(`→ ${basename(track).replace(/\.[^.]+$/, "")}.{grid,music${words.length ? ",lyrics" : ""}}.json beside the track`);
