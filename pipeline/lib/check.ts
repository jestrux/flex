// `npm run check <video|take>` — the automated review. Turns ART_DIRECTION.md rules into checks
// with timestamps, so an agent can fix a video without anyone watching it first.
// Reads build/<video>/timeline.json (sequences) or takes/<take>/timeline.json (single takes),
// the audio stems the mixer kept, the take events/edit lists, and the output video.
// Exits 1 if anything FAILs. Writes check.json next to the timeline.
import "./looks.ts"; // register looks/*.ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gridPath } from "./music.ts";
import { SIZE_TAG } from "./output.ts";
import { join } from "node:path";
import { AUDIO, type SfxLine, type VoiceLine } from "./audio.ts";
import { library, loudness } from "./assets.ts";
import { EFFECTS } from "./effects/index.ts";
import type { Events } from "./capture.ts";
import type { Edl } from "./plan.ts";

type Sev = "FAIL" | "WARN" | "INFO";
type Finding = { sev: Sev; rule: string; at?: number; msg: string };
const ROOT = join(import.meta.dirname, "..");

/** thresholds — keep in sync with ART_DIRECTION.md */
export const RULES = {
  voiceGapMin: 0.15,        // s between lines: less sounds like an overlap/rush
  voiceSilenceWarn: 9,      // s with no narration while narration exists elsewhere
  wpmMax: 190,              // words per minute in a single line
  staticWarn: 4, staticFail: 6,       // s of frozen picture with no narration over it
  staticVoicedWarn: 6, staticVoicedFail: 9, // s of frozen picture while narration plays (a held frame under a line is fine, briefly)
  cardHoldWarn: 7.5, // a mid-video title card sitting still (with or without its line): past this it's a wait
  finalHoldWarn: 7, // the closing card: long enough to read and let the track ring out, not a wait
  cursorDrift: { minMs: 900, maxSpeed: 260 }, // a move this long and this slow reads as wandering
  voiceTol: 1.0,            // LUFS tolerance on the narration stem
  separationMin: 14,        // dB music must sit under the voice while speaking
  truePeakMax: -1.0,        // dBTP on the final mix
  sfxOverVoice: 0,          // dB: a sound effect may not be louder than the voice
  effectMinMs: 600,         // effects shorter than this are a flicker
};

export function check(name: string) {
  const tl = [join(process.env.FLEX_WORK ?? ROOT, "build", name + SIZE_TAG, "timeline.json"), join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), name, "timeline.json")].find(existsSync);
  if (!tl) throw new Error(`no timeline for "${name}" — build it first (npm run video ${name} / npm run build ${name})`);
  const T = JSON.parse(readFileSync(tl, "utf8")) as { name: string; out: string; total: number; voice: VoiceLine[]; sfx: SfxLine[]; music: string | null; audio: Record<string, string>; credits: string[];
    clips?: { label: string; start: number; dur: number; take?: string; from?: number; to?: number; effects?: Edl["effects"]; segments?: Edl["segments"] }[]; lastCard?: boolean; joins?: { after: number; type: string; ms: number }[] };
  const F: Finding[] = [];
  const add = (sev: Sev, rule: string, msg: string, at?: number) => F.push({ sev, rule, msg, at });

  // ── narration ────────────────────────────────────────────────────────────────────────
  const V = [...T.voice].sort((a, b) => a.t - b.t);
  for (let i = 1; i < V.length; i++) {
    const end = V[i - 1].t + V[i - 1].dur * 1000, gap = (V[i].t - end) / 1000;
    if (gap < -0.05) add("FAIL", "voice-overlap", `narration overlaps by ${(-gap).toFixed(2)}s: "${V[i].text.slice(0, 50)}"`, V[i].t / 1000);
    else if (gap < RULES.voiceGapMin) add("WARN", "voice-breath", `only ${gap.toFixed(2)}s between lines — no breath`, V[i].t / 1000);
    else if (gap > RULES.voiceSilenceWarn) add("WARN", "voice-silence", `${gap.toFixed(1)}s without narration — make sure the picture carries it`, end / 1000);
  }
  for (const l of V) {
    const words = l.text.trim().split(/\s+/).length, wpm = (words / l.dur) * 60;
    if (wpm > RULES.wpmMax) add("WARN", "voice-rushed", `${Math.round(wpm)} wpm: "${l.text.slice(0, 50)}" — split it or shorten it`, l.t / 1000);
    if (!/[.!?…"'”]$/.test(l.text.trim())) add("WARN", "voice-sentence", `line doesn't end a sentence: "${l.text.slice(-40)}"`, l.t / 1000);
    if (existsSync(l.file)) { const tail = loudness(l.file, { from: Math.max(0, l.dur - 0.12), dur: 0.12 }); if (tail.peak > -12) add("WARN", "voice-cutoff", `line may end abruptly (tail peak ${tail.peak} dBTP): "${l.text.slice(-40)}"`, (l.t + l.dur * 1000) / 1000); }
  }

  // ── audio levels (stems kept by the mixer) ──────────────────────────────────────────
  const A = T.audio;
  if (A?.mix && existsSync(A.mix)) {
    const mix = loudness(A.mix);
    if (mix.peak > RULES.truePeakMax) add("FAIL", "mix-peak", `mix true peak ${mix.peak} dBTP > ${RULES.truePeakMax}`);
    add("INFO", "mix", `mix ${mix.lufs} LUFS, peak ${mix.peak} dBTP`);
    if (mix.lufs < AUDIO.voice - 4) add("FAIL", "mix-quiet", `the whole video is quiet (${mix.lufs} LUFS; aim for ${AUDIO.voice} ± 2) — a music-only video needs the music to lead`);
    if (V.length) {
      const voice = loudness(A.voice);
      if (Math.abs(voice.lufs - AUDIO.voice) > RULES.voiceTol) add("FAIL", "voice-level", `narration ${voice.lufs} LUFS, target ${AUDIO.voice}`);
      // music under speech: measure the ducked bed over the longest spoken stretches
      if (T.music) for (const l of V.filter((x) => x.dur >= 2).slice(0, 12)) {
        const m = loudness(A.music, { from: l.t / 1000, dur: l.dur }), v = loudness(A.voice, { from: l.t / 1000, dur: l.dur });
        if (v.lufs - m.lufs < RULES.separationMin) add("WARN", "music-separation", `music only ${(v.lufs - m.lufs).toFixed(1)} dB under the voice`, l.t / 1000);
      }
      // each sound effect vs the voice
      for (const s of T.sfx) {
        const m = loudness(A.sfx, { from: s.t / 1000, dur: Math.min(1.5, (s.cut ?? 1500) / 1000) });
        if (m.lufs > AUDIO.voice + RULES.sfxOverVoice) add("FAIL", "sfx-level", `"${s.key}" is louder than the narration (${m.lufs} LUFS)`, s.t / 1000);
      }
    }
  } else add("WARN", "audio-stems", "no mixer stems — rebuild with the current pipeline to check levels");

  // ── licences ─────────────────────────────────────────────────────────────────────────
  const lib = library();
  const used = [...new Set(T.sfx.map((s) => s.key))].map((k) => ({ k, a: lib.sfx[k] })).concat(T.music ? [{ k: T.music, a: lib.music[T.music] }] : []);
  for (const { k, a } of used) {
    if (!a) add("FAIL", "asset", `"${k}" isn't in assets/library.json`);
    else if (a.licence === "unknown") add("WARN", "licence", `"${k}" has an unknown licence — fine internally, not for publishing`);
  }
  if (T.credits?.length) add("INFO", "credits", `attribution required → ${T.out.replace(/\.mp4$/, ".credits.txt")} (put it in the description or an end card)`);

  // ── picture ──────────────────────────────────────────────────────────────────────────
  // no film (a render failed, the old one was removed): everything below would be stale or skipped
  if (!existsSync(T.out)) add("FAIL", "no-film", `${T.out} doesn't exist — the last render failed (scroll up to its error) or hasn't run; this report is from the timeline only`);
  else if ([join(ROOT, "videos", `${name}.ts`)].some((f) => existsSync(f) && statSync(f).mtimeMs > statSync(T.out).mtimeMs + 1000)) add("WARN", "stale-film", `videos/${name}.ts changed after ${T.out} was rendered — this report is about the old film; re-render (npm run video ${name})`);
  else if (statSync(T.out).mtimeMs < statSync(tl).mtimeMs - 1000) add("FAIL", "stale-film", `${T.out} is older than its timeline — the last render didn't finish; re-render before trusting this report`);
  if (existsSync(T.out)) {
    const fr = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", T.out, "-an", "-vf", `freezedetect=n=0.0015:d=${RULES.staticWarn}`, "-f", "null", "-"], { encoding: "utf8" }).stderr ?? "";
    const starts = [...fr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]), durs = [...fr.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => +m[1]);
    starts.forEach((s, i) => {
      const d = durs[i] ?? T.total - s; if (T.lastCard && s + d >= T.total - 0.2) { // the final held card
        if (d > RULES.finalHoldWarn) add("WARN", "ending", `the closing card sits still for ${d.toFixed(1)}s — ≤ ${RULES.finalHoldWarn}s: its length is its bars (+ the music tail, which counts toward them) or its spoken line, whichever is longer: give it fewer bars, shorten the line, or lengthen the transition into it`, s);
        return;
      }
      // how much of the frozen stretch has narration over it
      const voiced = V.reduce((acc, l) => acc + Math.max(0, Math.min(s + d, (l.t + l.dur * 1000) / 1000) - Math.max(s, l.t / 1000)), 0) / d > 0.4; // a card holding while its line plays counts as voiced
      // a title card holding still is designed stillness: it may hold through its line (≤ cardHold)
      // motion the pixel test can't see (a cursor gliding, an overlay entering): if it keeps coming
      // at least every 3 s through the stretch, the picture isn't really static
      const beats: number[] = [];
      for (const c of T.clips ?? []) {
        if (!c.take || s + d < c.start || s > c.start + c.dur) continue;
        const evp = join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), c.take, "events.json"); if (!existsSync(evp)) continue;
        const ev = JSON.parse(readFileSync(evp, "utf8")) as { cursor: { t: number; x: number; y: number }[]; typing?: { from: number; to: number }[] };
        const toV = (ms: number) => c.start + ms / 1000 - (c.from ?? 0);
        let last: { x: number; y: number } | null = null;
        for (const q of ev.cursor) { if (last && Math.hypot(q.x - last.x, q.y - last.y) > 24) beats.push(toV(q.t)); last = q; }
        for (const e of c.effects ?? []) if (e.enabled) beats.push(toV(e.start));
        for (const ty of ev.typing ?? []) for (let ms = ty.from; ms <= ty.to; ms += 500) beats.push(toV(ms)); // typed text changes too finely for the pixel test
      }
      const inside = [s, ...beats.filter((b) => b > s && b < s + d).sort((x, y) => x - y), s + d];
      const maxGap = Math.max(...inside.slice(1).map((b, j) => b - inside[j]));
      if (maxGap <= 3) { add("INFO", "static", `picture near-still for ${d.toFixed(1)}s but the cursor/overlays/typing keep moving (gaps ≤ ${maxGap.toFixed(1)}s) — fine`, s); return; }
      const onCard = (T.clips ?? []).some((c) => c.label.startsWith("title ") && s >= c.start - 0.3 && s + d <= c.start + c.dur + 0.6);
      const [warn, fail] = onCard ? [RULES.cardHoldWarn, RULES.cardHoldWarn + 3] : voiced ? [RULES.staticVoicedWarn, RULES.staticVoicedFail] : [RULES.staticWarn, RULES.staticFail];
      const cover = V.reduce((acc, l) => acc + Math.max(0, Math.min(s + d, (l.t + l.dur * 1000) / 1000) - Math.max(s, l.t / 1000)), 0) / d;
      if (d >= warn) add(d >= fail ? "FAIL" : "WARN", "static", `picture static for ${d.toFixed(1)}s${voiced ? " under narration" : cover > 0.05 ? ` (narration covers only ${Math.round(cover * 100)}% of it)` : " with no narration"} — add motion, an effect, or cut`, s);
    });
    // measure the hard cuts in the RENDERED film (not the plan): each must land within a frame of
    // where the timeline put it — catches picture/music drift
    // a "cut" whose frames either side match (one scene continuing into the next, e.g. two cards drawing the
    // same picture at the join) is a seamless join, not a visible cut: don't measure it as one
    const frameAt = (t: number) => spawnSync("ffmpeg", ["-v", "error", "-ss", t.toFixed(3), "-i", T.out, "-frames:v", "1", "-vf", "scale=160:-1,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 }).stdout as Buffer;
    const seamless = (t: number) => { const a = frameAt(Math.max(0, t - 1.5 / 30)), b = frameAt(t + 0.5 / 30); if (!a?.length || a.length !== b?.length) return false;
      let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length < 4; };
    const allCuts = (T.joins ?? []).filter((j) => j.type === "cut" && T.clips?.[j.after + 1]);
    const cuts = existsSync(T.out) ? allCuts.filter((j) => !seamless(T.clips![j.after + 1].start)) : allCuts;
    if (allCuts.length > cuts.length) add("INFO", "sync", `${allCuts.length - cuts.length} seamless join(s) (the picture carries straight on): not measured as cuts — ${allCuts.filter((j) => !cuts.includes(j)).map((j) => `"${T.clips![j.after + 1].label}" @${T.clips![j.after + 1].start.toFixed(2)}s`).join(", ")}`);
    if (cuts.length) {
      const sc = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", T.out, "-an", "-vf", "scale=320:-1,select='gt(scene,0.2)',showinfo", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? "";
      const found = [...sc.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
      let worst = 0;
      for (const j of cuts) {
        const want = T.clips![j.after + 1].start, near = found.reduce((p, f) => (Math.abs(f - want) < Math.abs(p - want) ? f : p), Infinity);
        if (!isFinite(near) || Math.abs(near - want) > 0.5) continue; // a soft cut (similar pictures) — can't measure
        const off = Math.round((near - want) * 1000); worst = Math.max(worst, Math.abs(off));
        if (Math.abs(off) > 40) add("FAIL", "sync", `the cut into "${T.clips![j.after + 1].label}" is ${off > 0 ? "+" : ""}${off} ms off its planned time in the rendered film — picture and music have drifted`, near);
      }
      add("INFO", "sync", `hard cuts measured in the rendered film: worst offset ${worst} ms from the timeline (≤ 1 frame is fine)`);
      // …and against the MUSIC: each hard cut should sit within half a frame of a bar (or beat) line
      if (T.music) {
        const gp = gridPath(T.music);
        if (existsSync(gp)) {
          const grid = JSON.parse(readFileSync(gp, "utf8")) as { beats: number[]; downbeats: number[] }, mf = (T as { musicFrom?: number }).musicFrom ?? 0;
          let worstM = 0;
          for (const j of cuts) {
            const t = T.clips![j.after + 1].start, near = grid.beats.map((b) => b - mf).reduce((p, b) => (Math.abs(b - t) < Math.abs(p - t) ? b : p), Infinity);
            const off = Math.round((t - near) * 1000); worstM = Math.max(worstM, Math.abs(off));
            if (Math.abs(off) > 25) add("WARN", "sync", `the cut into "${T.clips![j.after + 1].label}" sits ${off > 0 ? "+" : ""}${off} ms off the music's beat`, t);
          }
          add("INFO", "sync", `hard cuts vs the music: worst ${worstM} ms from a beat (≤ 17 ms = within half a frame)`);
        }
      }
    }
    // the first frame is the thumbnail: warn when it's a near-empty stage (a card fading in from nothing)
    const f0 = spawnSync("ffmpeg", ["-v", "error", "-i", T.out, "-frames:v", "1", "-vf", "scale=192:108,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 }).stdout as Buffer;
    if (f0?.length) {
      const px = [...f0], mean = px.reduce((a, v) => a + v, 0) / px.length, sd = Math.sqrt(px.reduce((a, v) => a + (v - mean) ** 2, 0) / px.length);
      if (sd < 6) add("WARN", "thumbnail", `the first frame is nearly empty (σ ${sd.toFixed(1)}) — it's the thumbnail: start the opening card's entrance before t = 0 (DESIGN rule 7)`, 0);
    }
    // ending: the last second must not fade to black
    const bl = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-sseof", "-1.2", "-i", T.out, "-an", "-vf", "blackdetect=d=0.2:pix_th=0.12", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? "";
    if (/black_start/.test(bl)) add("FAIL", "ending", "the video fades/cuts to black at the end — hold the last card to the final frame");
  }

  // ── takes: cursor + effects (mapped to video time) ──────────────────────────────────
  for (const c of T.clips ?? []) {
    if (!c.take) continue;
    const dir = join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), c.take);
    const ev: Events = JSON.parse(readFileSync(join(dir, "events.json"), "utf8"));
    const edl: Edl = JSON.parse(readFileSync(join(dir, "edl.json"), "utf8"));
    const from = (c.from ?? 0) * 1000, to = (c.to ?? ev.duration / 1000) * 1000;
    const at = (t: number) => c.start + (t - from) / 1000;
    // marks labelled "beat…" are changes meant to land on a beat: measure them against the music
    if (T.music) {
      const gp = gridPath(T.music);
      if (existsSync(gp)) {
        const grid = JSON.parse(readFileSync(gp, "utf8")) as { beats: number[] }, mf = (T as { musicFrom?: number }).musicFrom ?? 0;
        for (const m of ev.marks.filter((x) => /^beat/i.test(x.label) && x.t >= from && x.t <= to)) {
          const ft = at(m.t), nearest = grid.beats.map((b) => b - mf).reduce((p, b) => (Math.abs(b - ft) < Math.abs(p - ft) ? b : p), Infinity);
          const off = Math.round((ft - nearest) * 1000);
          add(Math.abs(off) > 60 ? "WARN" : "INFO", "beat", `"${m.label}" lands ${off >= 0 ? "+" : ""}${off} ms from the beat${Math.abs(off) > 60 ? " — align the take (take item align), or measure the control's repaint lag (npm run lag) and pass it to b.click" : ""} (b.click marks the visible change: click + lag)`, ft);
        }
      }
    }
    // screen overlays (lower thirds, chips, captions): never over a zoomed picture, never two at once
    const fx = (c.effects ?? edl.effects ?? []).filter((e) => e.enabled && e.end > from && e.start < to);
    const segsC = (c as { segments?: Edl["segments"] }).segments ?? edl.segments; // the sequence's patched camera, if any
    // a camera move that starts in the last moments of a cut range shows as a jolt across the cut
    if (c.label.startsWith("take")) for (const g of segsC.filter((x) => x.enabled)) {
      for (const edge of [g.start, g.end]) if (edge > to - 700 && edge < to - 40) add("WARN", "camera", `the camera starts moving ${((to - edge) / 1000).toFixed(2)}s before this take is cut ("${g.label ?? g.id}") — it reads as a jolt across the cut. End the range before the move (or delay the move).`, at(edge));
    }
    const isScreen = (e: { type: string; target?: { rect?: unknown; points?: unknown[] } }) => { const m = EFFECTS[e.type]; const tg = !!(e.target?.rect || e.target?.points?.length); return m && (m.space === "screen" || (m.space === "auto" && !tg)); };
    const screen = fx.filter(isScreen);
    for (const e of screen) {
      const exitMs = EFFECTS[e.type]?.exit ?? 0;
      const z = segsC.filter((g) => g.enabled && g.scale >= 1.25 && !(g.label ?? "").startsWith("control-clip") /* a clipped panel insert (and pushes on it): plain surface around the band */ && g.start < e.end + exitMs && g.end > e.start + 300)[0];
      if (z) add("WARN", "overlay", `screen overlay "${e.label ?? e.type}" is up while the camera is zoomed in (×${z.scale}, "${z.label ?? z.id}") — in a zoom the window fills the frame, so it sits over the subject. Show it while wide, let it leave, then push in.`, at(Math.max(e.start, z.start)));
    }
    for (let i = 0; i < screen.length; i++) for (let j = i + 1; j < screen.length; j++) {
      const a2 = screen[i], b2 = screen[j], ov = Math.min(a2.end, b2.end) - Math.max(a2.start, b2.start);
      if (ov > 200) add("WARN", "overlay", `two screen overlays at once ("${a2.label ?? a2.type}" and "${b2.label ?? b2.type}", ${(ov / 1000).toFixed(1)}s overlap) — end one before the next (hold, or effectStart → done())`, at(Math.max(a2.start, b2.start)));
    }
    // cursor moves: runs of samples ≤60 ms apart
    let run: typeof ev.cursor = [];
    const flush = () => {
      if (run.length > 2) {
        const ms = run[run.length - 1].t - run[0].t, dist = run.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - run[i].x, p.y - run[i].y), 0);
        if (ms >= RULES.cursorDrift.minMs && dist / (ms / 1000) < RULES.cursorDrift.maxSpeed && dist > 40) add("WARN", "cursor-drift", `cursor drifts ${Math.round(dist)}px over ${(ms / 1000).toFixed(1)}s — move briskly, then wait`, at(run[0].t));
      }
      run = [];
    };
    for (const p of ev.cursor.filter((p) => p.t >= from && p.t <= to)) { if (run.length && p.t - run[run.length - 1].t > 60) flush(); run.push(p); }
    flush();
    // the effects actually rendered for this clip (a sequence may patch them), else the take's own
    for (const e of c.effects ?? edl.effects ?? []) {
      if (!e.enabled || e.end < from || e.start > to) continue;
      const m = EFFECTS[e.type];
      if (!m) { add("FAIL", "effect", `unknown effect "${e.type}"`, at(e.start)); continue; }
      if (e.end - e.start + m.exit < RULES.effectMinMs) add("WARN", "effect-brief", `${e.type} is on screen ${e.end - e.start} ms — a flicker`, at(e.start));
      const r = e.target?.rect;
      if (r && m.space !== "screen" && (r.x + r.w < 0 || r.y + r.h < 0 || r.x > ev.viewport.w || r.y > ev.viewport.h)) add("FAIL", "effect-offscreen", `${e.type} target is off screen`, at(e.start));
      if (e.type === "caption" && e.params.backing === false) add("WARN", "contrast", "caption without a backing — only OK over dark footage", at(e.start));
      if (e.type === "link" && e.params.labelPill === false && (e.params.labels ?? []).length) add("WARN", "contrast", "link labels without pills — only OK over dark footage", at(e.start));
      if (e.type === "halo" && (e.params.intensity ?? 1) < 1.5) add("WARN", "contrast", "halo at Fuchi's default intensity is near-invisible on light UI — raise `intensity`", at(e.start));
    }
  }

  // ── report ───────────────────────────────────────────────────────────────────────────
  const order = { FAIL: 0, WARN: 1, INFO: 2 };
  F.sort((a, b) => order[a.sev] - order[b.sev] || (a.at ?? 0) - (b.at ?? 0));
  const mmss = (s?: number) => s === undefined ? "     " : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  const n = (s: Sev) => F.filter((f) => f.sev === s).length;
  console.log(`\ncheck ${name}  (${T.total.toFixed(1)}s)  →  ${n("FAIL")} fail · ${n("WARN")} warn · ${n("INFO")} info\n`);
  for (const f of F) console.log(`  ${f.sev.padEnd(4)} ${mmss(f.at)}  ${f.rule.padEnd(17)} ${f.msg}`);
  writeFileSync(tl.replace(/timeline\.json$/, "check.json"), JSON.stringify({ name, total: T.total, findings: F }, null, 1));
  return F;
}

if (process.argv[1]?.endsWith("check.ts")) {
  const name = process.argv[2]; if (!name) throw new Error("usage: check.ts <video|take>");
  const f = check(name);
  process.exit(f.some((x) => x.sev === "FAIL") ? 1 : 0);
}
