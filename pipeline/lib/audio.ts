// The mixer. Every layer is set to a measured target, not a guessed multiplier:
//   voice  → AUDIO.voice LUFS (the whole narration stem is measured, then gained to target)
//   sfx    → each sound normalised from its library loudness to AUDIO.sfx, ± its per-use dB
//   music  → the track normalised from its library loudness to AUDIO.bed, ducked under the voice
// then summed and true-peak limited. Stems are kept (audio/voice.wav, sfx.wav, music.wav,
// mix.wav) so `npm run check` can measure exactly what was mixed.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loudness, music as musicAsset, sfx as sfxAsset } from "./assets.ts";

/** loudness targets (LUFS) — see ART_DIRECTION.md §Sound for the reasoning */
export const AUDIO = {
  voice: -16,      // narration: the anchor (web/YouTube speech standard)
  bed: -27,        // music between lines: clearly present, never competing (11 dB under voice)
  lead: -16,       // music when it IS the soundtrack (little or no narration: teasers, reels)
  leadBelow: 0.25, // narration covering less than this share of the video → music leads
  duckDb: 9,       // extra music reduction while someone speaks (→ ~20 dB under the voice)
  underVoiceMin: 16, // dB the (pre-duck) music must sit under the voice during each line; louder passages get dipped further
  sfx: -21,        // a sound effect's own loudness: noticeable, 5 dB under the voice
  truePeak: -1.5,  // limiter ceiling (dBTP)
  musicFadeIn: 1.5, musicFadeOut: 1.6, // s
};

export type VoiceLine = { t: number; file: string; dur: number; text: string };          // t ms
/** the music dipped under a sound (Flex, patch 09): `curve` = [s after the sound starts, dB] points, linear between them
 *  (0 dB before the first and after the last); or the shorthand { db, attack, hold, release } (seconds) */
export type SfxDuck = { db?: number; attack?: number; hold?: number; release?: number; curve?: [number, number][] };
export type SfxLine = { t: number; key: string; db?: number; cut?: number; fade?: number; duck?: SfxDuck; gain?: number }; // cut/fade ms; gain: dB as it is, not levelled (patch 09)
const ff = (args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const silent = (out: string, total: number) => ff(["-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono`, "-t", String(total), out]);

/** mix to `dir/audio/*.wav`; returns the mix path. total in seconds. */
/** ending: "fade" (default) fades the bed out; "tail" = splice in the track's real ending (set up by the sequence) */
export type MusicRef = string | false | { key: string; from?: number; ending?: "fade" | "tail"; splice?: { at: number; trackFrom: number };
  /** an edit of the track: these stretches (song seconds) played back to back from film t = 0, each join a 120 ms
   *  crossfade centred on it (so a stretch repeated a whole number of beats back stays on the beat) — e.g.
   *  [[0, 9.17], [8.57, 9.17], [8.57, 58]] holds the 8.57–9.17 beat twice more. `from` is ignored. */
  segments?: [number, number][];
  /** Flex (patch 09): the track each segment plays, one music key per segment (default: `key` for all). Segment times
   *  are that track's own seconds; joins crossfade as usual, so a film can switch songs at a matched gap. */
  tracks?: string[];
  /** dB the music is held under the voice through every narrated stretch (lines < 1.5 s apart merge into one, 400 ms
   *  ramps, so it doesn't pump between lines), before the sidechain duck. Applies whether the music leads or is a bed:
   *  for a film whose narration is a small share (music "lead") with loud sung passages under it. */
  underVoice?: number;
  /** force the music's level role: "lead" (the soundtrack, AUDIO.lead) or "bed" (under narration, AUDIO.bed). Default: by
   *  the narration's share of the video. A song-led film with narrated stretches wants "lead" + underVoice. */
  role?: "lead" | "bed";
  /** Flex (patch 09): play the music at this gain (dB) as it is, not levelled to its role (a film mixed by hand) */
  gain?: number;
  /** Flex (patch 14): the shape of each join of the edit (n − 1 entries): the outgoing stretch plays `out` s past its end,
   *  fading to silence, while the incoming one fades in over `in` s from the join (linear); null = a butt cut. Without
   *  `joins`, every join is a 120 ms crossfade centred on it. */
  joins?: ({ out: number; in: number } | null)[];
  /** Flex (patch 14): keep the music and sound effects in stereo (the voice stays mono, centred). Default: mono stems */
  stereo?: boolean };
export const musicKey = (m?: MusicRef) => (m ? (typeof m === "string" ? m : m.key) : null);

/** dB the mono stems lose when the sum spreads them to stereo (patch 09) */
const PAN_LAW = 3.01;

export function mixAudio(dir: string, o: { total: number; voice: VoiceLine[]; sfx: SfxLine[]; music?: MusicRef }) {
  // mono stems by default; a stereo film keeps its music and sounds in stereo (and needs no pan-law make-up)
  const stereo = typeof o.music === "object" && !!o.music.stereo, CL = stereo ? "stereo" : "mono", PAN = stereo ? 0 : PAN_LAW;
  const A = join(dir, "audio"); mkdirSync(A, { recursive: true });
  const P = { voiceRaw: join(A, "voice-raw.wav"), voice: join(A, "voice.wav"), sfx: join(A, "sfx.wav"), music: join(A, "music.wav"), mix: join(A, "mix.wav") };
  const T = o.total.toFixed(3);

  // 1 · narration stem, gained to target
  if (o.voice.length) {
    const args: string[] = [], f: string[] = [];
    o.voice.forEach((l, i) => { args.push("-i", l.file); f.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${Math.round(l.t)}:all=1[v${i}]`); });
    f.push(`${o.voice.map((_, i) => `[v${i}]`).join("")}amix=inputs=${o.voice.length}:normalize=0,apad=whole_dur=${T},atrim=0:${T}[out]`);
    ff([...args, "-filter_complex", f.join(";"), "-map", "[out]", P.voiceRaw]);
    const g = AUDIO.voice - loudness(P.voiceRaw).lufs;
    ff(["-i", P.voiceRaw, "-af", `volume=${g.toFixed(2)}dB`, P.voice]);
  } else silent(P.voice, o.total);

  // 2 · sound effects stem, each normalised from its measured loudness
  if (o.sfx.length) {
    const args: string[] = [], f: string[] = [];
    o.sfx.forEach((s, i) => {
      const a = sfxAsset(s.key), g = s.gain !== undefined ? s.gain + PAN : AUDIO.sfx - (a.lufs ?? AUDIO.sfx) + (s.db ?? 0);
      const trim = s.cut ? `,atrim=0:${s.cut / 1000},afade=t=out:st=${Math.max(0, (s.cut - (s.fade ?? 600)) / 1000)}:d=${(s.fade ?? 600) / 1000}` : "";
      args.push("-i", a.path);
      f.push(`[${i}:a]aresample=48000,aformat=channel_layouts=${CL},volume=${g.toFixed(2)}dB${trim},adelay=${Math.round(s.t)}:all=1[s${i}]`);
    });
    f.push(`${o.sfx.map((_, i) => `[s${i}]`).join("")}amix=inputs=${o.sfx.length}:normalize=0,apad=whole_dur=${T},atrim=0:${T}[out]`);
    ff([...args, "-filter_complex", f.join(";"), "-map", "[out]", P.sfx]);
  } else silent(P.sfx, o.total);

  // 3 · music bed, normalised, faded, ducked under the (gained) voice
  if (o.music) {
    const spoken = o.voice.reduce((s, l) => s + l.dur, 0) / Math.max(1, o.total);
    const role = (typeof o.music === "object" && o.music.role) || (spoken < AUDIO.leadBelow ? "lead" : "bed");
    const m = musicAsset(musicKey(o.music)!), g = AUDIO[role] - (m.lufs ?? AUDIO[role]), mFrom = typeof o.music === "object" ? o.music.from ?? 0 : 0;
    // sidechain: the voice at -16 LUFS sits ~-20 dBFS; threshold -32 dBFS, ratio 4 → ≈ duckDb of reduction while speaking
    const thr = Math.pow(10, -32 / 20).toFixed(4), ratio = (1 / (1 - AUDIO.duckDb / 12)).toFixed(2);
    const splice = typeof o.music === "object" && o.music.splice ? o.music.splice : null;
    const segs = typeof o.music === "object" && o.music.segments?.length ? o.music.segments : null;
    const joins = typeof o.music === "object" ? o.music.joins : undefined;
    if (segs && joins) { // the edit with shaped joins: each stretch faded and placed at its film start, then summed
      const bed = join(A, "music-edited.wav"), n = segs.length;
      const trk = typeof o.music === "object" ? o.music.tracks : undefined;
      const pathOf = (i: number) => (trk?.[i] && trk[i] !== musicKey(o.music) ? musicAsset(trk[i]).path : m.path);
      let F = 0; const args: string[] = [], f: string[] = [];
      segs.forEach(([a, b], i) => {
        const jIn = i > 0 ? joins[i - 1] : null, jOut = i < n - 1 ? joins[i] : null, out = jOut?.out ?? 0, inn = jIn?.in ?? 0, len = b - a + out;
        args.push("-ss", String(a), "-t", String(len), "-i", pathOf(i));
        f.push(`[${i}:a]aresample=48000,aformat=channel_layouts=${CL}${inn > 0 ? `,afade=t=in:st=0:d=${inn}:curve=tri` : ""}${out > 0 ? `,afade=t=out:st=${(b - a).toFixed(4)}:d=${out}:curve=tri` : ""},adelay=${Math.round(F * 1000)}:all=1[j${i}]`);
        F += b - a;
      });
      ff([...args, "-filter_complex", `${f.join(";")};${segs.map((_, i) => `[j${i}]`).join("")}amix=inputs=${n}:normalize=0,atrim=0:${F.toFixed(4)}[out]`, "-map", "[out]", bed]);
      m.path = bed;
    } else if (segs) { // the edit: each stretch, widened 60 ms into each join, crossfaded 120 ms → exactly the stretches' lengths end to end
      const bed = join(A, "music-edited.wav"), X = 0.06, n = segs.length;
      const trk = typeof o.music === "object" ? o.music.tracks : undefined;
      const pathOf = (i: number) => (trk?.[i] && trk[i] !== musicKey(o.music) ? musicAsset(trk[i]).path : m.path);
      const inputs = segs.flatMap(([a, b], i) => { const s0 = i > 0 ? a - X : a, e0 = i < n - 1 ? b + X : b; return ["-ss", String(Math.max(0, s0)), "-t", String(e0 - Math.max(0, s0)), "-i", pathOf(i)]; });
      const f = n === 1 ? ["[0:a]anull[x0]"] : segs.slice(1).map((_, i) => `${i === 0 ? "[0:a]" : `[x${i - 1}]`}[${i + 1}:a]acrossfade=d=${2 * X}:c1=tri:c2=tri[x${i}]`);
      ff([...inputs, "-filter_complex", `${f.join(";")};[x${Math.max(0, n - 2)}]aresample=48000,aformat=channel_layouts=${CL}[out]`, "-map", "[out]", bed]);
      m.path = bed;
    }
    if (splice) { // A = [from, from+at) then B = the track's ending from trackFrom, 120 ms crossfade on the bar
      const bed = join(A, "music-spliced.wav");
      ff(["-ss", String(mFrom), "-t", String(splice.at + 0.12), "-i", m.path, "-ss", String(splice.trackFrom - 0.12), "-i", m.path, "-filter_complex",
        `[0:a][1:a]acrossfade=d=0.12:c1=tri:c2=tri,aresample=48000,aformat=channel_layouts=${CL}[out]`, "-map", "[out]", bed]);
      m.path = bed; // the rest of the chain (gain, duck) runs on the spliced bed
    }
    // the exact stretch of music the video uses (trimmed, faded), measured, then gained to target:
    // a track's average loudness says nothing about the 40 s you picked from it
    const raw = join(A, "music-raw.wav");
    // a fixed gain is a film mixed by hand: the music plays as cut, without the automatic fades (patch 09)
    const fixed = typeof o.music === "object" ? o.music.gain : undefined;
    const fades = fixed !== undefined ? "apad" : `afade=t=in:d=${AUDIO.musicFadeIn},${splice ? "apad" : `afade=t=out:st=${Math.max(0, o.total - AUDIO.musicFadeOut).toFixed(3)}:d=${AUDIO.musicFadeOut}`}`;
    ff([...(mFrom && !splice && !segs ? ["-ss", String(mFrom)] : []), ...(splice || segs ? [] : ["-stream_loop", "-1"]), "-i", m.path, "-af",
      `aresample=48000,aformat=channel_layouts=${CL},atrim=0:${T},${fades}`, "-t", T, raw]);
    // (the stems are mono and the sum spreads them to stereo at -3 dB: a fixed gain puts that back, so gain 0 plays the
    // file at its own level)
    const g2 = fixed !== undefined ? fixed + PAN : AUDIO[role] - loudness(raw).lufs;
    // adaptive dip: where the track gets louder under a line (a drop, a chorus), bring it down
    // further for that line, with 300 ms ramps; the sidechain duck then works on top
    const dips: string[] = [];
    const uv = typeof o.music === "object" ? o.music.underVoice : undefined;
    // the spans to hold under: each line (default), or with underVoice the narrated stretches (lines < 1.5 s apart merged)
    const spans = uv === undefined ? o.voice.map((l) => ({ t: l.t, dur: l.dur }))
      : [...o.voice].sort((a, b) => a.t - b.t).reduce((acc: { t: number; dur: number }[], l) => {
        const last = acc[acc.length - 1];
        if (last && l.t - (last.t + last.dur) < 1500) last.dur = Math.max(last.dur, l.t + l.dur - last.t); else acc.push({ t: l.t, dur: l.dur });
        return acc; }, []);
    const ramp = uv === undefined ? 0.3 : 0.4;
    if (role === "bed" || uv !== undefined) for (const l of spans) {
      const under = loudness(raw, { from: l.t / 1000, dur: Math.max(0.5, l.dur) }).lufs + g2;
      const extra = under - (AUDIO.voice - (uv ?? AUDIO.underVoiceMin));
      if (extra > 0.5) {
        const a = (l.t / 1000).toFixed(3), b = (l.t / 1000 + l.dur).toFixed(3), r = Math.pow(10, -extra / 20).toFixed(4);
        dips.push(`(1-(1-${r})*clip((t-${a}+${ramp})/${ramp},0,1)*clip((${b}+${ramp}-t)/${ramp},0,1))`);
      }
    }
    // Flex (patch 09): the music dipped under each sound that asks for it (a piecewise-linear dB curve per sound)
    for (const s of o.sfx) {
      if (!s.duck) continue;
      const d = s.duck, t0 = s.t / 1000;
      const pts: [number, number][] = d.curve ?? (() => { const a = d.attack ?? 0.02, h = d.hold ?? 0.5, r = d.release ?? 0.15, db = d.db ?? -9; return [[0, 0], [a, db], [a + h, db], [a + h + r, 0]]; })();
      // dB(t) as nested ifs over the segments, then 10^(dB/20)
      let expr = "0";
      for (let k = pts.length - 2; k >= 0; k--) {
        const [ta, da] = pts[k], [tb, dbb] = pts[k + 1], A0 = (t0 + ta).toFixed(4), B0 = (t0 + tb).toFixed(4);
        const seg = tb > ta ? `(${da}+(${dbb - da})*(t-${A0})/${(tb - ta).toFixed(4)})` : `${dbb}`;
        expr = `if(between(t,${A0},${B0}),${seg},${expr})`;
      }
      dips.push(`pow(10,(${expr})/20)`);
    }
    // (volume re-evaluates once per audio frame, ~85 ms here: 5 ms frames keep a duck's edges where they were asked for)
    const dip = dips.length ? `,asetnsamples=n=240:p=0,volume='${dips.join("*")}':eval=frame` : "";
    ff(["-i", raw, "-i", P.voice, "-filter_complex",
      `[0:a]volume=${g2.toFixed(2)}dB${dip}[bed];[1:a]aformat=channel_layouts=${CL}[key];[bed][key]sidechaincompress=threshold=${thr}:ratio=${ratio}:attack=40:release=500:makeup=1[out]`, "-map", "[out]", "-t", T, P.music]);
    void g;
  } else silent(P.music, o.total);

  // 4 · sum + true-peak limit, stereo 48 kHz
  const lim = Math.pow(10, AUDIO.truePeak / 20).toFixed(4);
  ff(["-i", P.voice, "-i", P.sfx, "-i", P.music, "-filter_complex",
    `[0:a]aformat=channel_layouts=${CL}[v0];[1:a]aformat=channel_layouts=${CL}[s0];[2:a]aformat=channel_layouts=${CL}[m0];[v0][s0][m0]amix=inputs=3:normalize=0,alimiter=limit=${lim}:attack=5:release=60:level=disabled,aformat=sample_rates=48000:channel_layouts=stereo[out]`, "-map", "[out]", "-t", T, P.mix]);
  return P;
}

/** attribution lines for every licensed asset used (CC BY requires credit) */
export function credits(o: { music?: MusicRef; sfx: SfxLine[] }) {
  const lines: string[] = [], seen = new Set<string>();
  if (o.music) { const m = musicAsset(musicKey(o.music)!); lines.push(`Music: ${m.attribution ?? m.source} [${m.licence}]`); }
  for (const s of o.sfx) { if (seen.has(s.key)) continue; seen.add(s.key); const a = sfxAsset(s.key); if (a.licence !== "CC0" || !a.source.startsWith("synthesised")) lines.push(`Sound "${s.key}": ${a.attribution ?? a.source} [${a.licence}]`); }
  return lines;
}
