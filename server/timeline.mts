// A project's timeline, its frames' layers and its mix, from Flex's copy of the pipeline (pipeline/, patched:
// pipeline-patches/). Nothing here re-implements the pipeline's timing: planSequence runs the pipeline's own
// renderSequence in plan-only mode (02-plan-only.patch) and keeps what it decided.
//   planSequence(dir)      → the plan: every clip's film start and length, card or take, and every cue
//   layersAt(plan, frame)  → that frame's Layer[] (a card's own render, or a take as layers: take-layers.mts)
//   mixSequence(plan, out) → the film's sound, mixed by the pipeline's mixAudio
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openTake, takeLayers, type OpenTake } from "./take-layers.mts";

const PIPE = process.env.FLEX_PIPELINE!;
const imp = (p: string) => import(pathToFileURL(p).href);
// the film's frame: FLEX_FRAME=WxH for a vertical film (frame.json, set by the engine), else 1920 × 1080
const [FW, FH] = /^\d+x\d+$/.test(process.env.FLEX_FRAME ?? "") ? process.env.FLEX_FRAME!.split("x").map(Number) : [1920, 1080];
const FPS = 30, OUT = { w: FW, h: FH };

export type PlannedClip = {
  index: number; scene: string; label: string; kind: string; start: number; dur: number; f0: number; f1: number;
  card?: { type: string; params: Record<string, unknown>; cardDur: number; held: boolean; cutNext: boolean; uid: string };
  take?: { take: string; from: number; to: number; pad: number; edl: Record<string, unknown> };
};
export type Plan = {
  name: string; dir: string; fps: number; frames: number; total: number; feel: any; music: any;
  clips: PlannedClip[]; joins: { type: string; ms: number }[];
  voice: { t: number; file: string; dur: number; text: string }[]; sfx: { t: number; key: string; db?: number }[];
  scenes: { id: string; start: number; end: number; first: number; frames: number }[];
  takesDir: string; variants: Record<string, string[]>; markers: unknown; out: string | null; warnings: string[];
};

/** the project's takes: as the server set them (FLEX_TAKES, with any versions previewed), else its own takes/ folder, else the pipeline's */
export function takesDirFor(dir: string) { return process.env.FLEX_TAKES ?? (existsSync(join(dir, "takes")) ? join(dir, "takes") : join(PIPE, "takes")); }

/** a session folder that links the project under its name, so the pipeline's look and audio discovery find it (04-projects-dir.patch) */
export function projectsDirFor(dir: string, name: string) {
  const d = mkdtempSync(join(tmpdir(), "flex-projects-"));
  symlinkSync(dir, join(d, name));
  return d;
}

export async function planSequence(dir: string): Promise<Plan> {
  const mod = await imp(join(dir, "project.ts")), project = mod.default;
  const { toSequence } = await imp(join(PIPE, "lib/project.ts"));
  const { renderSequence } = await imp(join(PIPE, "lib/sequence.ts"));
  const { feelNamed } = await imp(join(PIPE, "lib/feels.ts"));
  const seq = toSequence(project);
  const planned = await renderSequence(seq, { planOnly: true });
  const feel = feelNamed(project.feel);

  // which scene each sequence item belongs to (the sequence is every scene's items, end to end)
  const sceneOf: string[] = project.scenes.flatMap((s: any) => s.items.map(() => s.id));
  const clips: PlannedClip[] = planned.clips.map((c: any, k: number) => {
    const start = planned.starts[k], f0 = Math.round(start * FPS);
    return { index: c.item, scene: sceneOf[c.item] ?? "?", label: c.label, kind: c.take ? "take" : "card", start, dur: c.dur, f0, f1: 0, card: c.card, take: c.take };
  });
  const frames = Math.round(planned.total * FPS);
  clips.forEach((c, k) => { c.f1 = k + 1 < clips.length ? clips[k + 1].f0 : frames; });
  const warnings: string[] = [];
  if (planned.joins.some((j: any) => j.type !== "cut" && j.ms > 0)) warnings.push("transitions other than cuts are shown as cuts for now");

  const scenes = project.scenes.map((s: any) => {
    const mine = clips.filter((c) => c.scene === s.id);
    const first = mine.length ? mine[0].f0 : Math.round(s.start * FPS), last = mine.length ? mine[mine.length - 1].f1 : Math.round(s.end * FPS);
    return { id: s.id, start: first / FPS, end: last / FPS, first, frames: last - first };
  });
  return { name: project.name, dir, fps: FPS, frames, total: planned.total, feel, music: planned.music, clips, joins: planned.joins,
    voice: planned.voice, sfx: planned.sfx, scenes, takesDir: takesDirFor(dir),
    variants: mod.variants ?? project.variants ?? {}, markers: mod.markers ?? project.markers ?? null, out: project.out ?? null, warnings };
}

let CARDS: Record<string, any> | null = null;
const takes = new Map<string, OpenTake>();

/** what frame n of the film is made of, without painting it */
export async function layersAt(plan: Plan, frame: number): Promise<{ scene: string; layers: any[]; warnings?: string[] }> {
  CARDS ??= (await imp(join(PIPE, "lib/presets/index.ts"))).CARDS;
  const c = plan.clips.find((x) => frame >= x.f0 && frame < x.f1) ?? plan.clips[plan.clips.length - 1];
  const local = Math.round(((frame - c.f0) * 1000) / FPS);
  if (c.card) {
    const m = CARDS![c.card.type];
    if (!m) throw new Error(`unknown card ${c.card.type}`);
    // the card's clock exactly as the pipeline's render gives it (frame × 1000 / fps, not rounded to the ms: a cut timed
    // on n/30 s would otherwise land a frame late in Flex's preview)
    const out = m.render(c.card.params, { t: ((frame - c.f0) * 1000) / FPS, dur: c.card.cardDur, out: OUT, feel: plan.feel, uid: c.card.uid, last: c.card.held, cutNext: c.card.cutNext,
      asset: (a: string) => (a.startsWith("/") ? a : join(PIPE, a)) });
    for (const l of out) if ("image" in l && !l.image.startsWith("/")) l.image = join(PIPE, l.image);
    for (const l of out) if ("video" in l && !l.video.startsWith("/")) l.video = join(PIPE, l.video);
    return { scene: c.scene, layers: out };
  }
  const t = c.take!;
  const id = `${t.take}:${c.index}`;
  let tk = takes.get(id);
  // the take's real folder (not a session link), so its frames' keys stay the same across sessions
  if (!tk) { tk = openTake({ take: t.take, dir: realpathSync(join(plan.takesDir, t.take)), edl: t.edl }); takes.set(id, tk); }
  const tt = Math.min(t.to * 1000, t.from * 1000 + local);           // the take holds its last frame through its pad
  const r = takeLayers(tk, tt, t.from * 1000);
  return { scene: c.scene, layers: r.layers, ...(r.warnings.length ? { warnings: r.warnings } : {}) };
}

/** the film's sound: the plan's cues, mixed by the pipeline's mixAudio (loudness, ducking, the music edit). `only`: one
 *  layer as mixed (music: the edit, levelled and ducked; voice: the narration; sfx: the sound effects) */
export async function mixSequence(plan: Plan, out: string, only?: "music" | "voice" | "sfx") {
  const { mixAudio } = await imp(join(PIPE, "lib/audio.ts"));
  mkdirSync(join(out, ".."), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "flex-mix-"));
  try {
    const P = mixAudio(work, { total: plan.total, voice: plan.voice, sfx: plan.sfx, music: plan.music });
    copyFileSync(only ? P[only] : P.mix, out);
  } finally { rmSync(work, { recursive: true, force: true }); }
  return { file: out };
}
