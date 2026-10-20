// Sequences: a video made of items — title cards, takes (or a range of one), B-roll — with
// transitions at the joins and one feel for the whole video. Each item renders to its own
// clip (1080p30, silent); each transition mixes the tail of one clip with the head of the
// next on decoded frames; voice (takes' narration + `say` lines on cards) and one music bed
// are laid out over the whole timeline.
//
//   npx tsx lib/sequence.ts <video>   (videos/<video>.ts default-exports a Sequence)
import sharp from "sharp";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "./render.ts";
import { OUT as OUT_SIZE, SIZE_TAG } from "./output.ts";
import "./looks.ts";
import { feelNamed, type FeelName } from "./feels.ts";
import { CARDS, TRANSITIONS } from "./presets/index.ts";
import { paint } from "./presets/layers.ts";
import { voiceFor } from "./voice.ts";
import { finalPath } from "./build.ts";
import { effectSounds, keystrokes } from "./effects/sounds.ts";
import { finish } from "./build.ts";
import { validate, type CardParams, type CardType, type TransitionParams, type TransitionType } from "./params.ts";
import { musicKey, type MusicRef, type SfxDuck, type SfxLine, type VoiceLine } from "./audio.ts";
import { endingTail, grid as musicGrid } from "./music.ts";
import { needDisk } from "./disk.ts";
import type { Events } from "./capture.ts";
import type { Edl } from "./plan.ts";

type CardItem = { [K in CardType]: { kind: K extends `title-${string}` ? "title" : "broll"; type: K; params?: Partial<CardParams[K]>; dur?: number; bars?: number; say?: string; sayAt?: number; sayOver?: boolean; sfx?: CardSfx[] } }[CardType];
/** a sound a card plays: at = ms from the card's start; sound = a library sfx key (npm run fx:list) */
export type CardSfx = { at: number; sound: string; db?: number; duck?: SfxDuck; gain?: number }; // duck: the music dipped under it; gain: dB as it is (Flex, patch 09)
type TxItem = { [K in TransitionType]: { kind: "transition"; type: K; ms?: number; params?: Partial<TransitionParams[K]> } }[TransitionType] | { kind: "transition"; type?: undefined; ms?: number; params?: undefined };
/** one of your look's cards — build it with card(look.cards.x, params, { bars }) from lib/look.ts */
/*  sayAt: ms into the card when its line starts (default 300) — e.g. keep a payoff line off a drop that lands on the card's cut
    sayOver: the line may run past the card's end into the next item (the card keeps its own length; the next item's
    first line must start after it ends — the overlap check still warns) */
export type LookCardItem = { kind: "title" | "broll"; type: `${string}/${string}`; params?: Record<string, unknown>; dur?: number; bars?: number; say?: string; sayAt?: number; sayOver?: boolean; sfx?: CardSfx[] };
export type SeqItem =
  | CardItem
  | LookCardItem
  | { kind: "take"; take: string; from?: number | string; to?: number | string; bars?: number; align?: { mark: string; bar?: number; beat?: number; nearest?: "bar" | "beat" }; noTrim?: boolean; patch?: (edl: Edl) => Edl; mute?: boolean; cursor?: false; bgPhase?: number } /* bars: this take lasts exactly N bars; align: shift the take so `mark` lands on that bar/beat of the film (default: the next bar line; nearest: "bar" | "beat" = the nearest line of that kind the take can reach without cutting a line) */   // seconds within the take, or a label: a c.mark() label, or a camera segment's label/id (cuts on the segment's start, lead included); patch = variant edits; mute = drop its narration (keep effect sounds)
  | TxItem;

export type { Edl };
export { segs, noEffects } from "./patch.ts"; // patch helpers (import them from lib/patch.ts)

export type Sequence = {
  name: string;
  /** Flex (patch 16): a scene rendered alone — the item that follows it in the whole film (null: it ends the film).
   *  The scene's last card then holds or cuts exactly as it does in the film, instead of playing as the film's end. */
  after?: SeqItem | null;
  /** a built-in feel (clean | modern | professional) or your look's name (looks/<name>.ts) */
  feel: FeelName | (string & {});
  /** canvas for takes: "feel" = on, with the feel's background (default); "edl" = each take's own; "off" */
  canvas?: "feel" | "edl" | "off";
  /** library key, or { key, from } to start the track at `from` s (pick a downbeat: npm run music:show <key>) */
  music?: MusicRef;
  /** cut to the music: every join (and the end) lands on the nearest bar line / beat of the track.
   *  Cards stretch or shrink (never below their voice line); takes are trimmed (never cutting
   *  narration) or hold their last frame. Default "bar" when there is music. */
  snap?: "bar" | "beat" | "off";
  items: SeqItem[];
};

const ROOT = join(import.meta.dirname, "..");
const OUT = OUT_SIZE, FPS = 30; // lib/output.ts (OUT_SIZE)
const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const probeDur = (f: string) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

/** decode a time range of a clip to raw RGB frames */
function rawFrames(file: string, fromS: number, durS: number): Buffer[] {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, fromS)), "-t", String(durS), "-i", file, "-vf", `fps=${FPS}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 2 * 1024 ** 3 });
  const n = OUT.w * OUT.h * 3, out: Buffer[] = [];
  for (let i = 0; i + n <= buf.length; i += n) out.push(buf.subarray(i, i + n));
  return out;
}
/** encode raw frames (or a frame generator) to an mp4 */
async function encode(file: string, n: number, frame: (i: number) => Promise<Buffer>) {
  const p = spawn("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${OUT.w}x${OUT.h}`, "-r", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-aq-mode", "3", "-pix_fmt", "yuv420p", file], { stdio: ["pipe", "inherit", "pipe"] });
  // ffmpeg warns "Truncating packet of size N to 8192" when reading raw frames from a pipe — harmless; drop just that line
  p.stderr!.on("data", (d: Buffer) => { const t = d.toString().split("\n").filter((x) => x.trim() && !/Truncating packet/.test(x)).join("\n"); if (t) process.stderr.write(t + "\n"); });
  for (let i = 0; i < n; i++) { const b = await frame(i); if (!p.stdin.write(b)) await new Promise((r) => p.stdin.once("drain", r)); }
  p.stdin.end(); await new Promise((r) => p.on("close", r));
}

/** a take's from/to → seconds. A label is a c.mark() label, else a camera segment's label or id (its
 *  start); add an offset in seconds, bars or beats of the video's music: "reveal+2bars", "g2-0.5s" */
function resolveAt(take: string, at: number | string | undefined, ev: Events, edl: Edl, unit: { bar?: number; beat?: number }) {
  if (at === undefined || typeof at === "number") return at;
  // a label, then any number of offsets: "type-0.4s+2bars", "reveal+1bar-2beats". Labels may end in
  // digits (b.type's "beat-typed-20"): an exact label wins, then offsets are peeled off the right until
  // what's left is a real label
  const exists = (l: string) => ev.marks.some((x) => x.label === l) || edl.segments.some((x) => x.label === l || x.id === l);
  let m0 = /^(.*?)((?:[+-]\d*\.?\d+(?:s|bars?|beats?)?)*)$/.exec(at)!;
  if (exists(at)) m0 = Object.assign([at, at, ""], { index: 0, input: at }) as unknown as RegExpExecArray;
  else if (!exists(m0[1])) { let rest = at, tail = ""; for (let m; (m = /[+-]\d*\.?\d+(?:s|bars?|beats?)?$/.exec(rest)); ) { tail = m[0] + tail; rest = rest.slice(0, m.index); if (exists(rest)) { m0 = Object.assign([at, rest, tail], { index: 0, input: at }) as unknown as RegExpExecArray; break; } } }
  const label = m0[1];
  const k = ev.marks.find((x) => x.label === label), g = edl.segments.find((x) => x.label === label || x.id === label);
  if (!k && !g) throw new Error(`take ${take}: no mark or segment "${label}". Marks: ${ev.marks.map((x) => x.label).join(", ") || "(none)"}; segments: ${edl.segments.map((x) => x.label ?? x.id).join(", ")}`);
  let off = 0;
  for (const o of m0[2].matchAll(/([+-])(\d*\.?\d+)(s|bars?|beats?)?/g)) {
    const n = Number(o[2]) * (o[1] === "-" ? -1 : 1), u = o[3] ?? "s";
    const per = u.startsWith("bar") ? unit.bar : u.startsWith("beat") ? unit.beat : 1;
    if (!per) throw new Error(`take ${take}: "${at}" uses ${u} but the video has no music grid`);
    off += n * per;
  }
  return +((k ? k.t : g!.start) / 1000 + off).toFixed(3);
}

/** Flex: what plan-only mode returns (the timeline, its clips and their cues; nothing rendered, nothing deleted) */
export type PlannedClip = { dur: number; voice: VoiceLine[]; sfx: SfxLine[]; label: string; item: number;
  card?: { type: string; params: Record<string, unknown>; cardDur: number; held: boolean; cutNext: boolean; uid: string };
  take?: { take: string; from: number; to: number; pad: number; effects: Edl["effects"]; segments?: Edl["segments"]; edl?: unknown } };
export type Planned = { name: string; feel: string; music: Sequence["music"]; clips: PlannedClip[]; starts: number[];
  joins: { type: string; ms: number; params: Record<string, any> }[]; voice: VoiceLine[]; sfx: SfxLine[]; total: number };

export async function renderSequence(seq: Sequence, opts: { planOnly?: boolean } = {}): Promise<any> {
  const planOnly = !!opts.planOnly; // Flex: plan and collect the cues; render nothing, delete nothing
  if (!planOnly) needDisk(ROOT, 0.8, "video render");
  const feel = feelNamed(seq.feel);
  const k0 = seq.music === false ? null : musicKey(seq.music ?? "carefree"), g0 = k0 ? musicGrid(k0) : null, unit = { bar: g0?.bar, beat: g0?.beat };
  seq = { ...seq, items: seq.items.map((it) => {
    if (it.kind !== "take" || (typeof it.from !== "string" && typeof it.to !== "string")) return it;
    const tdir = join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), it.take), ev: Events = JSON.parse(readFileSync(join(tdir, "events.json"), "utf8")), edl: Edl = JSON.parse(readFileSync(join(tdir, "edl.json"), "utf8"));
    return { ...it, from: resolveAt(it.take, it.from, ev, edl, unit), to: resolveAt(it.take, it.to, ev, edl, unit) };
  }) };
  seq.items.forEach((it, i) => { if (it.kind !== "take" && it.type) validate(it.type, it.params as Record<string, unknown>, `${seq.name} item ${i + 1}`);
    if (it.kind === "take") { const e: Edl = JSON.parse(readFileSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), it.take, "edl.json"), "utf8")); (it.patch ? it.patch(e) : e).effects?.forEach((f, j) => validate(f.type, f.params, `${it.take} edl effect ${j + 1}`)); } });
  const dir = join(process.env.FLEX_WORK ?? ROOT, "build", seq.name + SIZE_TAG); if (!planOnly) mkdirSync(dir, { recursive: true });
  // a failed render must never leave the previous film behind for `check` to pass against: check reads the timeline,
  // so that goes now; the film itself stays watchable until the new one replaces it (Flex, patch 10)
  if (!planOnly && !process.argv.includes("--plan")) rmSync(join(dir, "timeline.json"), { force: true });
  console.log(`● sequence "${seq.name}" · feel ${feel.label} · canvas ${seq.canvas ?? "feel"}`);

  // the length of the transition after item i (0 for a cut or the end)
  // every length is a whole number of frames, or the picture drifts against the music (a frame
  // lost per item adds up: 0.33 s by the end of a 60 s film)
  const fq = (ms: number) => (Math.round((ms * FPS) / 1000) * 1000) / FPS;
  const txAfter = (i: number) => { const n = seq.items[i + 1]; if (n?.kind !== "transition") return 0; const tp = n.type ?? feel.transition.type; return tp === "cut" ? 0 : fq(n.ms ?? (n.type && n.type !== feel.transition.type ? TRANSITIONS[tp]?.ms ?? 0 : feel.transition.ms)); }; // as the render (below): the look's own transition type keeps the look's timing — planning with the preset's ms put every take after the join off by the difference (r30: aligned beats +105 ms)
  // 0 · plan durations, and snap joins to the music grid
  const mKey = seq.music === false ? null : musicKey(seq.music ?? "carefree"), mFrom = typeof seq.music === "object" && seq.music ? seq.music.from ?? 0 : 0;
  const snapTo = seq.snap ?? (mKey ? "bar" : "off");
  // a crossfade between two cards (or a card and a panel insert) double-exposes their type (r44: two violet title
  // sheets overlaid for 0.6 s) — the docs say cut or push; say so where it happens
  seq.items.forEach((it, i) => { if (it.kind !== "transition" || (it.type ?? feel.transition.type) !== "crossfade") return;
    const a = seq.items[i - 1], b2 = seq.items[i + 1]; if (a && b2 && a.kind !== "take" && b2.kind !== "take" && a.kind !== "transition" && b2.kind !== "transition")
      console.warn(`  ! item ${i + 1}: a crossfade between two cards double-exposes their type — use a push or a cut (type: "push" / "cut")`); });
  const idx = seq.items.map((it, i) => (it.kind === "transition" ? -1 : i)).filter((i) => i >= 0);
  const ovAfter = (i: number) => txAfter(i) / 1000;
  // first/last: when the item's narration starts / ends, from its own start (s)
  type Plan = { base: number; min: number; max: number; dur: number; first: number; last: number };
  const plans = new Map<number, Plan>();
  for (const i of idx) {
    const it = seq.items[i];
    if (it.kind === "take") {
      const ev: Events = JSON.parse(readFileSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), it.take, "events.json"), "utf8"));
      const from = (it.from as number | undefined) ?? 0, to = (it.to as number | undefined) ?? ev.duration / 1000, base = to - from;
      if (to > ev.duration / 1000 + 0.05 || from < 0 || to <= from)
        throw new Error(`take ${it.take}: range ${from.toFixed(2)}–${to.toFixed(2)}s is outside the take (0–${(ev.duration / 1000).toFixed(2)}s). Ask for less, or hold the last frame by letting the music snap pad it.`);
      // a range must not cut a narration line (it would run on under the next item)
      if (!it.mute) for (const l of ev.narration) {
        const ls = l.t / 1000, le = ls + l.dur;
        if ((ls < to && le > to + 0.05) || (ls < from - 0.05 && le > from))
          throw new Error(`${seq.name}: take ${it.take} [${from}–${to}s] cuts the line "${l.text.slice(0, 50)}" (${ls.toFixed(1)}–${le.toFixed(1)}s). `
            + `End before ${ls.toFixed(1)}s or after ${(le + 0.3).toFixed(1)}s, start after ${(le).toFixed(1)}s, or mute the take.`);
      }
      const mine = it.mute ? [] : ev.narration.filter((l) => l.t / 1000 >= from && l.t / 1000 < to);
      const lastVoice = Math.max(0, ...mine.map((l) => l.t / 1000 + l.dur - from));
      const first = mine.length ? Math.min(...mine.map((l) => l.t / 1000 - from)) : Infinity;
      if (it.bars && mKey) { // an exact length in bars: the snap may trim to it or hold the last frame up to it
        const want = it.bars * musicGrid(mKey).bar;
        // with align, the take's start moves (and its lines with it): checked after the shift, below
        if (!it.align && want + 0.05 < lastVoice + 0.3) throw new Error(`take ${it.take}: bars: ${it.bars} (${want.toFixed(1)}s) is shorter than its narration (${(lastVoice + 0.3).toFixed(1)}s)`);
        plans.set(i, { base, min: Math.max(1, Math.min(want, lastVoice + 0.3)), max: want + 2.5, dur: want, first, last: lastVoice });
      } else plans.set(i, { base, min: (it as { noTrim?: boolean }).noTrim ? base : Math.max(1, lastVoice + 0.3), max: base + 2.5, dur: base, first, last: lastVoice }); // noTrim: the snap may hold the last frame, never cut the range short
    } else if (it.kind !== "transition") {
      const m = CARDS[it.type];
      const v = it.say ? await voiceFor(it.say) : null;
      const sayAt = ("sayAt" in it && typeof it.sayAt === "number" ? it.sayAt : 300) / 1000;
      const over = "sayOver" in it && !!it.sayOver; // the line may run on into the next item: it doesn't size the card
      // a silent card lasts at least 1.2 s unless it says how long it is (Flex, patch 15: an explicit dur / bars was
      // silently stretched to 1.2 s, moving every later item)
      const need = v && !over ? (sayAt * 1000 + v.dur * 1000 + 500 + txAfter(i)) / 1000 : it.dur !== undefined || it.bars ? 0 : 1.2;
      const g = mKey && it.bars ? musicGrid(mKey) : null;
      const want = it.bars && g ? it.bars * g.bar : (it.dur ?? m?.dur ?? 3000) / 1000;
      const lastWithTail = i === idx[idx.length - 1] && typeof seq.music === "object" && !!seq.music && seq.music.ending === "tail"; // the tail holds its line
      const needAtJoin = need - txAfter(i) / 2000; // joins read mid-transition (as the snap measures)
      if (it.bars && g && needAtJoin > want + 0.001 && !lastWithTail) { const grow = Math.max(it.bars + 1, Math.ceil(needAtJoin / g.bar - 0.02)); console.warn(`  ! ${it.type} (item ${i + 1}): its line needs ${need.toFixed(1)}s (sayAt ${sayAt.toFixed(1)} + voice ${v ? v.dur.toFixed(1) : 0} + 0.5 breath + half the outgoing ${txAfter(i)} ms transition) but ${it.bars} bar(s) = ${want.toFixed(1)}s — it will grow to ${grow} bars, which moves every later join (and where the music's moments land). Give it bars: ${grow}, shorten the line, lower sayAt, or shorten the outgoing transition.`); }
      plans.set(i, { base: want, min: need, max: Infinity, dur: Math.max(want, need), first: v ? sayAt : Infinity, last: v && !over ? sayAt + v.dur : 0 });
    }
  }
  // narration must never collide across a join: item i must last long enough that its last line
  // (+ a 0.3 s breath) ends before the next item's first line starts, given the transition overlap
  idx.forEach((i, k) => {
    const j = idx[k + 1]; if (j === undefined) return;
    const a = plans.get(i)!, b = plans.get(j)!; if (!a.last || b.first === Infinity) return;
    const need = a.last + 0.3 + ovAfter(i) - b.first;
    if (need > a.min) { a.min = need; a.max = Math.max(a.max, need); a.dur = Math.max(a.dur, need); }
  });
  if (mKey && snapTo !== "off") {
    const g = musicGrid(mKey), lines = (snapTo === "bar" ? g.downbeats : g.beats).map((t) => t - mFrom).filter((t) => t > 0.05);
    let start = 0;
    idx.forEach((i, k) => {
      const pl = plans.get(i)!, ov = k < idx.length - 1 ? ovAfter(i) : 0, last = k === idx.length - 1;
      // align: shift this take so a mark inside it lands exactly on a bar (or beat) line of the film
      const itA = seq.items[i];
      if (itA.kind === "take" && itA.align) {
        const evA: Events = JSON.parse(readFileSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), itA.take, "events.json"), "utf8"));
        const mk = evA.marks.find((x) => x.label === itA.align!.mark);
        if (!mk) throw new Error(`take ${itA.take}: align mark "${itA.align.mark}" not found. Marks: ${evA.marks.map((x) => x.label).join(", ")}`);
        const from0 = (itA.from as number | undefined) ?? 0, markFilm = start + (mk.t / 1000 - from0);
        const byBeat = itA.align.beat !== undefined || itA.align.nearest === "beat";
        const grid = byBeat ? g.beats.map((t) => t - mFrom) : g.downbeats.map((t) => t - mFrom);
        const target = itA.align.nearest ? undefined : itA.align.bar !== undefined ? g.downbeats.map((t) => t - mFrom).filter((t) => t >= -0.01)[itA.align.bar] : itA.align.beat !== undefined ? g.beats.map((t) => t - mFrom).filter((t) => t >= -0.01)[itA.align.beat] : grid.find((t) => t >= markFilm - 0.01); // bar/beat N counts from the film's start
        // forgiving: if the asked target needs lead-in the take doesn't have, or would cut a line, use
        // the nearest line of the same kind (bar or beat) that works, and say which
        // valid: the mark stays inside the take (target at/after the take's start), the start doesn't
        // run before the capture, and it doesn't cut a narration line
        // …and doesn't drop a line: no narration may start between the old and the new start
        const okFrom = (tg: number) => { const f = from0 + (markFilm - tg); return tg >= start - 0.01 && f >= 0 && mk.t / 1000 >= f - 0.001
          && !evA.narration.some((l) => l.t / 1000 < f && l.t / 1000 + l.dur > f)
          && (itA.mute || !evA.narration.some((l) => l.t / 1000 >= Math.min(from0, f) - 0.01 && l.t / 1000 < Math.max(from0, f) && f > from0)); };
        let tgt = target;
        if (tgt === undefined || !okFrom(tgt)) {
          const pool = (byBeat ? g.beats : g.downbeats).map((t) => t - mFrom).filter((t) => t >= -0.01);
          // nearest: the line that leaves ≈ 0.6 s of lead-in before the mark (it trims the take's dead pre-roll);
          // otherwise the line nearest where the mark falls untrimmed
          const aim = itA.align.nearest ? start + 0.6 : markFilm;
          const ok = pool.filter(okFrom).sort((x, y) => Math.abs(x - aim) - Math.abs(y - aim));
          if (!ok.length) {
            // how much quiet the take lacks before its first line for the nearest usable line
            // a later line needs the take to start earlier than its capture: short by (tg - start) - mark
            const need = pool.filter((tg) => tg >= markFilm - 0.01).map((tg) => tg - start - mk.t / 1000).filter((x) => x > 0);
            const more = need.length ? Math.min(...need) : 1.5;
            throw new Error(`take ${itA.take}: no ${byBeat ? "beat" : "bar"} can take "${itA.align.mark}" without cutting a line or needing more lead-in. align sets the take's \`from\` itself, so shifting \`from\` by hand doesn't help: recapture with ≥ ${(more + 0.3).toFixed(1)} s of quiet (c.pause) before the first narration line, or move the item to start on a later bar`);
          }
          const why = tgt === undefined ? "it's past the music" : (() => { const f = from0 + (markFilm - tgt!); return f < 0 ? `the take would need ${(-f).toFixed(2)}s more lead-in before the mark` : tgt! < start + 0.05 ? "it's before the take starts" : "the start would cut or drop a narration line"; })();
          if (!itA.align.nearest) console.log(`  ♪ align: ${itA.take} "${itA.align.mark}" can't go on ${tgt === undefined ? "that line" : tgt.toFixed(2) + "s"} (${why}) — using the nearest that works, ${ok[0].toFixed(2)}s`);
          tgt = ok[0];
        }
        const from1 = +(from0 + (markFilm - tgt)).toFixed(3); // move later in the take = mark earlier in the film
        const d = from1 - from0;
        itA.from = from1; pl.base -= d; if (!itA.bars) pl.dur -= d; /* bars: keep the asked length */ if (pl.first !== Infinity) pl.first -= d; pl.last -= d;
        pl.min = (itA as { noTrim?: boolean }).noTrim ? pl.base : Math.max(1, pl.last + 0.3); // noTrim survives the shift
        if (itA.bars && pl.last + 0.3 > pl.dur + 0.05) throw new Error(`take ${itA.take}: bars: ${itA.bars} (${pl.dur.toFixed(1)}s) is shorter than its narration once aligned (the last line ends ${(pl.last + 0.3).toFixed(1)}s after the aligned start) — give it bars: ${Math.ceil((pl.last + 0.3) / g.bar - 0.02)}, or end it on a mark (to: "<mark>+Ns")`);
        console.log(`  ♪ align: ${itA.take} "${itA.align.mark}" → ${tgt.toFixed(2)}s (from ${from0.toFixed(2)} → ${from1.toFixed(2)}s)`);
      }
      // the moment the cut reads (middle of the transition, or the end of the video)
      const nominal = start + pl.dur - ov / 2;
      const ok = (t: number) => { const d = t - start + ov / 2; return d >= pl.min - 0.021 && d <= pl.max + 1e-6; }; // half a frame of slack: a range ending on a bar line keeps that bar (r41)
      const cand = lines.filter(ok).sort((a, b) => Math.abs(a - nominal) - Math.abs(b - nominal))[0];
      if (cand !== undefined) pl.dur = cand - start + ov / 2;
      // the snap held a take's last frame for a while: a frozen picture (often "Rendering…" after an Export) — say so
      if (cand !== undefined && itA.kind === "take" && pl.dur - pl.base > 1) console.warn(`  ! ${itA.take}: the bar snap holds its last frame ${(pl.dur - pl.base).toFixed(1)} s (a still picture). End the range later (to: "<mark>+Ns"), or move the last line so the take ends just before a bar line`);
      if (cand !== undefined && itA.kind === "take" && !itA.bars /* bars: N asks for that length — trimming to it is the point */ && pl.dur < pl.base - 0.05) { const evT: Events = JSON.parse(readFileSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), itA.take, "events.json"), "utf8")); const f0 = (itA.from as number | undefined) ?? 0, cutAt = f0 + pl.dur;
        const lost = evT.marks.filter((m) => m.label !== "end" && m.t / 1000 > cutAt && m.t / 1000 <= f0 + pl.base); if (lost.length) console.warn(`  ! ${itA.take}: the bar snap trims ${(pl.base - pl.dur).toFixed(1)} s off its end, cutting ${lost.map((m) => `"${m.label}"`).join(", ")} — noTrim: true keeps them`); }
      if (cand === undefined) console.warn(`  ! can't land item ${i + 1} on a ${snapTo} line (needs ${pl.min.toFixed(1)}–${pl.max === Infinity ? "∞" : pl.max.toFixed(1)}s) — left at ${pl.dur.toFixed(2)}s`);
      if (!last) start += pl.dur - ov;
    });
    console.log(`  ♪ ${mKey}${mFrom ? ` from ${mFrom}s` : ""} · ${g.bpm} BPM · joins snapped to ${snapTo}s`);
    // ending "tail": the last card holds through the track's real final bars + ring-out
    if (typeof seq.music === "object" && seq.music && seq.music.ending === "tail") {
      const tail = endingTail(g), lastI = idx[idx.length - 1], pl = plans.get(lastI)!;
      const lastStart = start; // where the last item starts
      // splice on a bar line: the tail's first bar replaces the card's last bars; if the card is no
      // longer than the tail, splice one whole bar into the card (never mid-bar)
      // the tail counts toward fitting the closing card's line: splice after the fewest whole bars
      // that (with the tail) hold its line, or the card's own bars minus the tail, whichever is longer
      // the tail may start on the card's first bar line when it alone covers the card's line (a short close)
      const own = Math.round(pl.base / g.bar), needBars = Math.max(0, Math.ceil((pl.min - tail.len) / g.bar - 0.02));
      const at = lastStart + Math.max(needBars, own - tail.bars, 0) * g.bar;
      pl.dur = at + tail.len - lastStart;
      seq.music = { ...seq.music, splice: { at, trackFrom: tail.start } };
      const ring = Math.max(0, tail.len - tail.bars * g.bar);
      console.log(`  ♪ ending: the track's last ${tail.bars} bar(s) spliced at ${at.toFixed(2)}s${ring > 0.05 ? ` + ${ring.toFixed(1)}s ring-out` : " (the track ends on its last bar — no ring-out, that's normal)"}; the closing card runs ${(at + tail.len - lastStart).toFixed(1)}s`);
    }
  }

  if (typeof seq.music === "object" && seq.music && seq.music.ending === "tail" && snapTo === "off") console.warn(`  ! ending: "tail" needs snap on (bar or beat) — with snap: "off" the music fades instead`);
  // frame-align: each join lands on the frame nearest its planned time (absolute, so rounding never accumulates)
  {
    // E = exact planned start, S = its frame-rounded start; round each join from the EXACT time so
    // errors never carry from one item to the next (≤ half a frame, always)
    let E = 0, S = 0;
    idx.forEach((i, k) => {
      const pl = plans.get(i)!, ov = k < idx.length - 1 ? ovAfter(i) : 0, last = k === idx.length - 1;
      const nextE = E + pl.dur - (last ? 0 : ov), B = Math.round(nextE * FPS) / FPS;
      pl.dur = +(B - S + (last ? 0 : ov)).toFixed(6);
      E = nextE; S = B;
    });
  }
  // --plan: print the timeline (bars, joins, the music's sections, narration) and stop — no render
  if (process.argv.includes("--plan") || process.env.npm_config_plan === "true") {
    const g = mKey ? musicGrid(mKey) : null, bar = g?.bar ?? 0;
    const at = (t: number) => `${t.toFixed(2).padStart(6)}s${bar ? ` bar ${(t / bar).toFixed(1).padStart(5)}` : ""}`;
    let t = 0;
    console.log(`\n  plan for "${seq.name}"${g ? ` · ${mKey} from ${mFrom}s · bar ${bar.toFixed(2)}s` : ""}`);
    idx.forEach((i, k) => {
      const it = seq.items[i], pl = plans.get(i)!, ov = k < idx.length - 1 ? ovAfter(i) : 0;
      const name = it.kind === "take" ? `take ${it.take} [${(it.from as number ?? 0).toFixed(2)}–${(((it.from as number) ?? 0) + Math.min(pl.base, pl.dur)).toFixed(2)}s]` : `${it.kind} ${it.type}`;
      console.log(`    ${at(t)}  ${name.padEnd(48)} ${pl.dur.toFixed(2)}s${pl.first !== Infinity ? `  voice ${(t + pl.first).toFixed(1)}–${(t + pl.last).toFixed(1)}s` : ""}`);
      // where the take's marks land in the film, as film beats (the numbers align: { beat } takes)
      if (it.kind === "take") {
        const evp = join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), it.take, "events.json");
        if (existsSync(evp)) {
          const from = (it.from as number) ?? 0, beats = g ? g.beats.map((x) => x - mFrom).filter((x) => x >= -0.01) : [];
          for (const m of (JSON.parse(readFileSync(evp, "utf8")) as Events).marks) {
            const ft = t + (m.t / 1000 - from); if (ft < t - 0.01 || ft > t + pl.dur + 0.01) continue;
            let bi = -1, off = 0; if (beats.length) { bi = beats.reduce((bk, x, j) => (Math.abs(x - ft) < Math.abs(beats[bk] - ft) ? j : bk), 0); off = Math.round((ft - beats[bi]) * 1000); }
            console.log(`             · "${m.label}" at ${at(ft)}${bi >= 0 ? `  = beat ${bi}${off ? ` ${off > 0 ? "+" : ""}${off} ms` : ""}` : ""}`);
          }
        }
      }
      t += pl.dur - ov;
    });
    const total = t + (ovAfter(idx[idx.length - 1]) || 0);
    console.log(`    ${at(total)}  end (total ${total.toFixed(1)}s)`);
    if (g) for (const s of g.sections) { const v = s.start - mFrom; if (v > 0 && v < total) console.log(`    music: ${s.label.padEnd(6)} (${s.energy} dB) starts at ${at(v)}`); }
    return null;
  }

  // 1 · clips + the transitions between them
  type Clip = { file: string; dur: number; voice: VoiceLine[]; sfx: SfxLine[]; label: string; take?: { take: string; from: number; to: number; effects: Edl["effects"]; segments?: Edl["segments"] }; flex?: Partial<PlannedClip> };
  const lastIdx = seq.items.reduce((acc, x, i) => (x.kind !== "transition" ? i : acc), -1);
  const clips: Clip[] = [], joins: { type: string; ms: number; params: Record<string, any> }[] = [];
  let pending: SeqItem | null = null;
  for (const [i, it] of seq.items.entries()) {
    if (it.kind === "transition") { pending = it; continue; }
    if (clips.length) {
      const tx = pending as Extract<SeqItem, { kind: "transition" }> | null;
      const type = tx ? tx.type ?? feel.transition.type : "cut";
      const m = TRANSITIONS[type]; if (!m) throw new Error(`unknown transition "${type}"`);
      joins.push({ type, ms: type === "cut" ? 0 : fq(tx?.ms ?? (tx?.type && tx.type !== feel.transition.type ? m.ms : feel.transition.ms)) /* the look's own transition type keeps the look's timing */, params: { ...m.defaults, ...(tx?.params ?? {}) } });
    }
    pending = null;
    const file = join(dir, `clip-${String(i).padStart(2, "0")}.mp4`);
    if (it.kind === "take") {
      const tdir = join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), it.take);
      const ev: Events = JSON.parse(readFileSync(join(tdir, "events.json"), "utf8"));
      const edl: Edl = (it.patch ?? ((e: Edl) => e))(JSON.parse(readFileSync(join(tdir, "edl.json"), "utf8")));
      // a patch can move zooms back onto a kept-clear region (keepClear is applied when planning, not here)
      if (it.patch) for (const g of edl.segments.filter((x) => x.enabled)) {
        const cw = ev.viewport.w / g.scale, l = g.cx - cw / 2, r = g.cx + cw / 2;
        // only regions still up once the camera has arrived (a sheet released just after the segment starts doesn't count)
        for (const a of (ev.avoid ?? []).filter((x) => x.t <= g.start && (x.until === undefined || x.until > g.start + 500)).map((x) => x.rect)) {
          const aR = a.x + a.w, contains = l <= a.x + 3 && r >= aR - 3, crosses = !contains && ((l < aR && r > aR && l > a.x) || (r > a.x && l < a.x && r < aR)); // ±3 px: a panel insert's left edge rounds to just inside the window
          if (crosses && !contains) console.warn(`  ! ${it.take}: patched zoom "${g.label ?? g.id}" (×${g.scale}) shows a sliver of a kept-clear region (x ${Math.round(a.x)}–${Math.round(aR)}) — raise its scale or move cx`);
        }
        const ch = ev.viewport.h / g.scale, mx = ev.viewport.w * 0.068, my = ev.viewport.h * 0.068;
        if (l < -mx - 1 || r > ev.viewport.w + mx + 1 || g.cy - ch / 2 < -my - 1 || g.cy + ch / 2 > ev.viewport.h + my + 1) console.warn(`  ! ${it.take}: patched zoom "${g.label ?? g.id}" (×${g.scale}) reaches past the recording (the camera will clamp and the framing shifts) — raise the scale or move cx/cy`);
      }
      const canvas = seq.canvas === "off" ? { ...(edl.canvas ?? { padding: 0.06, radius: 14, shadow: true, preset: feel.canvas }), on: false }
        : seq.canvas === "edl" ? edl.canvas : { ...(edl.canvas ?? { padding: 0.06, radius: 14, shadow: true }), on: true, preset: feel.canvas,
          ...(["clean", "modern", "professional"].includes(feel.name) ? {} : { radius: feel.radius }), // a custom look's window takes its own radius
          ...(feel.stage?.padding !== undefined ? { padding: feel.stage.padding } : {}), ...(feel.stage?.panel ? { panel: feel.stage.panel } : {}),
          ...(feel.stage?.border ? { border: feel.stage.border } : {}), ...(it.bgPhase !== undefined ? { phase: it.bgPhase } : {}) }; // bgPhase: the animated background's phase (ms) at the take's start
      const pl = plans.get(i)!, from = (it.from as number | undefined) ?? 0, to = from + Math.min(pl.base, pl.dur), pad = Math.max(0, pl.dur - pl.base);
      console.log(`  · take ${it.take} [${from}–${to.toFixed(2)}s${pad ? ` + hold ${pad.toFixed(2)}s` : ""}]`);
      const takeEdl = { feel: seq.feel, canvas: canvas as Edl["canvas"], effects: edl.effects, segments: edl.segments, transition: edl.transition, cursor: it.cursor ?? edl.cursor };
      if (!planOnly) await render(it.take, { edl: takeEdl, out: file, from, to, pad });
      const inRange = <T extends { t: number }>(l: T) => l.t / 1000 >= from - 0.05 && l.t / 1000 < to;
      const shift = <T extends { t: number }>(l: T) => ({ ...l, t: l.t - from * 1000 });
      clips.push({ file, dur: Math.round((to - from + pad) * FPS) / FPS, label: `take ${it.take}`, take: { take: it.take, from, to, effects: edl.effects, segments: edl.segments },
        flex: { item: i, take: { take: it.take, from, to, pad, effects: edl.effects, segments: edl.segments, edl: takeEdl } },
        voice: (it.mute ? [] : ev.narration).filter(inRange).map(shift),
        // the look's click sound (feel.click.sound) on every click of the take
        // and the look's typing sounds (feel.typing) on every keystroke
        sfx: [...effectSounds(edl.effects), ...(feel.click?.sound ? ev.clicks.map((c) => ({ t: c.t, key: feel.click!.sound!, db: feel.click!.db ?? -6 })) : []),
          ...(feel.typing?.sounds.length ? keystrokes(ev.typing).map((t, k) => ({ t, key: feel.typing!.sounds[k % feel.typing!.sounds.length], db: feel.typing!.db ?? -6 })) : [])].filter(inRange).map(shift).sort((a, b) => a.t - b.t) });
    } else {
      const m = CARDS[it.type]; if (!m) throw new Error(`unknown ${it.kind} preset "${it.type}"`);
      const params = { ...m.defaults, ...(it.params ?? {}) };
      // a card is never shorter than its line: voice + a breath + the transition that eats its tail
      const v = it.say ? await voiceFor(it.say) : null;
      const dur = Math.round(plans.get(i)!.dur * 1000);
      // the last card holds: render as if it were longer, so its exit never plays — the video cuts on it
      // …and so does a card followed by a hard cut: an exit fading toward the empty stage right before a cut
      // reads as a flash (nothing crossfades over it)
      const inFilm = i === lastIdx && seq.after !== undefined; // a scene's last card, rendered alone: as it plays in the film
      const nx = inFilm ? seq.after ?? undefined : seq.items[i + 1], cutNext = !!nx && (nx.kind === "transition" ? (nx.type ?? feel.transition.type) === "cut" : true);
      const last = i === lastIdx && !nx, held = last || cutNext, cardDur = last ? dur + feel.motion.out + 400 : dur;
      console.log(`  · ${it.kind} ${it.type} (${dur}ms${last ? ", held to the end" : cutNext ? ", holds to the hard cut" : ""})`);
      const n = Math.round((dur / 1000) * FPS);
      if (!planOnly) await encode(file, n, (f) => paint(m.render(params, { t: (f * 1000) / FPS, dur: cardDur, out: OUT, feel, uid: `c${i}`, last: held, cutNext, asset: (p) => (p.startsWith("/") ? p : join(ROOT, p)) }), OUT));
      clips.push({ file, dur: n / FPS, label: `${it.kind} ${it.type}`, flex: { item: i, card: { type: it.type, params, cardDur, held, cutNext, uid: `c${i}` } }, voice: v ? [{ t: it.sayAt ?? 300, ...v, text: it.say! }] : [], sfx: (it.sfx ?? []).filter((x) => x.at < dur).map((x) => ({ t: x.at, key: x.sound, db: x.db, duck: x.duck, gain: x.gain })) });
    }
  }

  // 2 · transitions: clip i overlaps clip i+1 by the join's length
  const parts: { file: string; inS: number; outS: number }[] = [];
  const starts: number[] = [];
  let tl = 0, headCut = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i], j = joins[i], ov = (j?.ms ?? 0) / 1000;
    starts.push(tl - headCut);
    parts.push({ file: c.file, inS: headCut, outS: c.dur - ov });
    tl += c.dur - headCut - ov;
    if (j && ov > 0) {
      const tf = join(dir, `tx-${String(i).padStart(2, "0")}-${j.type}.mp4`);
      const A = planOnly ? [] : rawFrames(c.file, c.dur - ov, ov), B = planOnly ? [] : rawFrames(clips[i + 1].file, 0, ov);
      const n = planOnly ? Math.round(ov * FPS) : Math.min(A.length, B.length);
      const m = TRANSITIONS[j.type];
      console.log(`  ⇢ ${j.type} ${j.ms}ms`);
      if (!planOnly) await encode(tf, n, (f) => m.mix(A[f], B[f], n <= 1 ? 1 : f / (n - 1), { out: OUT, feel, params: j.params }));
      parts.push({ file: tf, inS: 0, outS: n / FPS });
      tl += n / FPS; headCut = n / FPS;
    } else headCut = 0;
  }

  if (planOnly) {
    const voice = clips.flatMap((c, i) => c.voice.map((l) => ({ ...l, t: starts[i] * 1000 + l.t }))).sort((a, b) => a.t - b.t);
    const sfx = clips.flatMap((c, i) => c.sfx.map((l) => ({ ...l, t: starts[i] * 1000 + l.t }))).sort((a, b) => a.t - b.t);
    const planned: Planned = { name: seq.name, feel: seq.feel, music: seq.music, starts, joins, voice, sfx, total: tl,
      clips: clips.map((c) => ({ dur: c.dur, voice: c.voice, sfx: c.sfx, label: c.label, item: c.flex?.item ?? -1, card: c.flex?.card, take: c.flex?.take })) };
    return planned;
  }
  // 3 · join the parts into one silent video
  const silent = join(dir, "video.mp4");
  const inputs = parts.flatMap((p) => ["-i", p.file]);
  const filt = parts.map((p, i) => `[${i}:v]trim=${p.inS.toFixed(4)}:${p.outS.toFixed(4)},setpts=PTS-STARTPTS[v${i}]`).join(";") + ";" + parts.map((_, i) => `[v${i}]`).join("") + `concat=n=${parts.length}:v=1:a=0[v]`;
  ff([...inputs, "-filter_complex", filt, "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-aq-mode", "3", "-pix_fmt", "yuv420p", "-r", String(FPS), silent]);
  const total = probeDur(silent);

  // 4 · voice + music over the whole timeline, subtitles
  const voice = clips.flatMap((c, i) => c.voice.map((l) => ({ ...l, t: starts[i] * 1000 + l.t }))).sort((a, b) => a.t - b.t);
  const sfx = clips.flatMap((c, i) => c.sfx.map((l) => ({ ...l, t: starts[i] * 1000 + l.t }))).sort((a, b) => a.t - b.t);
  // voice lines must never overlap (`npm run check` fails on it too)
  for (let i = 1; i < voice.length; i++) {
    const prevEnd = voice[i - 1].t + voice[i - 1].dur * 1000;
    if (voice[i].t < prevEnd - 50) console.warn(`  ! narration overlap ${((prevEnd - voice[i].t) / 1000).toFixed(2)}s at ${(voice[i].t / 1000).toFixed(1)}s: "${voice[i].text.slice(0, 40)}…"`);
  }
  const outFile = finish({ name: seq.name, dir, video: silent, total, voice, sfx, music: seq.music === false ? false : seq.music ?? "carefree", 
    extra: { kind: "sequence", feel: seq.feel, clips: clips.map((c, i) => ({ label: c.label, start: starts[i], dur: c.dur, ...(c.take ?? {}) })),
      joins: joins.map((j, i) => ({ after: i, type: j.type, ms: j.ms })), lastCard: seq.items.at(-1)?.kind !== "take" } });
  return outFile;
}

// the command line lives in lib/video-run.ts (an entry module of its own, so a video file can import
// from this one without an import cycle)
