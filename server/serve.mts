// Flex's server: what goes in each frame of a project, and how it sounds, from Flex's own copy of the pipeline
// (pipeline/, via timeline.mts). It never paints (the engine does). JSON lines over stdin/stdout; see docs/server.md.
//   FLEX_PIPELINE=<pipeline> tsx --import <support>/server/redirect.mjs serve.mts <project-dir>
// The engine sets FLEX_PIPELINE, FLEX_TAKES, FLEX_PROJECTS and FLEX_VOICE_CACHE, and any variant flags (END=dark …).
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DIR = resolve(process.argv[2] ?? ".");
const PIPE = process.env.FLEX_PIPELINE!;
// the film's frame: FLEX_FRAME=WxH for a vertical film (frame.json, set by the engine), else 1920 × 1080
const [FW, FH] = /^\d+x\d+$/.test(process.env.FLEX_FRAME ?? "") ? process.env.FLEX_FRAME!.split("x").map(Number) : [1920, 1080];
const OUT = { w: FW, h: FH };

// keep stdout for replies: the pipeline logs freely
const reply = ((write) => (o: unknown) => write(JSON.stringify(o) + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
const errText = (e: unknown) => String((e as Error)?.stack ?? e).split("\n").slice(0, 6).join("\n");
const imp = (p: string) => import(pathToFileURL(p).href);

// before anything imports the pipeline (its look and audio registries scan FLEX_PROJECTS once, on load): the project's
// takes (patch 01) and a session folder linking the project (patch 04; the link is named after the folder, since a look
// registers under its own name)
import { existsSync, mkdtempSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
process.env.FLEX_TAKES ??= existsSync(join(DIR, "takes")) ? join(DIR, "takes") : join(PIPE, "takes");
// a take version in place of the pick, to preview it in the film before picking it (capture: docs/capture.md):
// FLEX_TAKE_VERSIONS="circles-pool-back=v1,…" → a session folder linking every take, those to takes/.versions/<take>/v<n>
if (process.env.FLEX_TAKE_VERSIONS) {
  const base = process.env.FLEX_TAKES, d = mkdtempSync(join(tmpdir(), "flex-takes-"));
  const over = Object.fromEntries(process.env.FLEX_TAKE_VERSIONS.split(",").filter(Boolean).map((kv) => kv.split("=")));
  for (const t of readdirSync(base)) if (!t.startsWith(".")) symlinkSync(over[t] ? join(base, ".versions", t, over[t]) : join(base, t), join(d, t));
  for (const t of Object.keys(over)) if (!existsSync(join(base, ".versions", t, over[t]))) console.warn(`no version ${over[t]} of ${t}`);
  process.env.FLEX_TAKES = d;
}
if (!process.env.FLEX_PROJECTS) { const d = mkdtempSync(join(tmpdir(), "flex-projects-")); symlinkSync(DIR, join(d, basename(DIR))); process.env.FLEX_PROJECTS = d; }
const { planSequence, layersAt, mixSequence } = await imp(join(import.meta.dirname, "timeline.mts"));

let plan: any, manifest: Record<string, unknown>;

/** a take clip's camera plan as the film paints it (the take's edl.json after the scene's patch), its stretch of the take
 *  (seconds), and whether the patch changed it (then edits to edl.json may not show) */
function cameraOf(t: any) {
  const file = join(process.env.FLEX_TAKES!, t.take, "edl.json");
  let own: any = null; try { own = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const pick = (e: any) => ({ segments: (e?.segments ?? []).map((g: any) => ({ id: g.id, start: g.start, end: g.end, scale: g.scale, kind: g.kind, enabled: g.enabled !== false })),
    effects: (e?.effects ?? []).map((f: any) => ({ id: f.id, type: f.type, start: f.start, end: f.end, enabled: f.enabled !== false })) });
  const eff = pick(t.edl), mine = pick(own);
  return { take: t.take, from: t.from, to: t.to, locked: !!own?.locked, patched: JSON.stringify(eff) !== JSON.stringify(mine), ...eff };
}
try {
  plan = await planSequence(DIR);
  manifest = {
    name: plan.name, dir: DIR, fps: plan.fps, size: [OUT.w, OUT.h], frames: plan.frames, duration: plan.total,
    music: { key: plan.music?.key ?? plan.music, segments: plan.music?.segments ?? null, from: plan.music?.from ?? null, tracks: plan.music?.tracks ?? null },
    scenes: plan.scenes.map((s: any) => ({ ...s, items: plan.clips.filter((c: any) => c.scene === s.id).map((c: any) => ({
      kind: c.kind, type: c.card?.type ?? null, label: c.take ? c.take.take : c.card!.type.split("/").pop(), start: c.f0 / plan.fps, end: c.f1 / plan.fps, paintable: true,
      ...(c.take ? { take: cameraOf(c.take) } : {}) })) })),
    variants: plan.variants, markers: plan.markers, out: plan.out ?? null, takes: process.env.FLEX_TAKES, warnings: plan.warnings,
  };
  reply({ id: 0, ok: true, op: "ready", manifest });
} catch (e) {
  reply({ id: 0, ok: false, op: "ready", error: errText(e) });
  process.exit(1);
}

const stamp = new Map<string, string>();
function fileStamp(f: string) {
  let s = stamp.get(f);
  if (!s) { try { const st = statSync(f); s = `${st.size}:${st.mtimeMs}`; } catch { s = "missing"; } stamp.set(f, s); }
  return s;
}
/** scenes whose frames threw, with the first error each (reset on every keys pass) */
let errors: Record<string, string> = {};
async function safeLayers(frame: number): Promise<any> {
  try { return await layersAt(plan, frame); }
  catch (e) {
    const c = plan.clips.find((x: any) => frame >= x.f0 && frame < x.f1), scene = c?.scene ?? "?";
    const error = errText(e);
    errors[scene] ??= error;
    return { scene, error };
  }
}
async function key(frame: number) {
  const l = await safeLayers(frame), h = createHash("sha1");
  h.update(JSON.stringify(l));
  if (FW !== 1920 || FH !== 1080) h.update(`|frame=${FW}x${FH}`); // the same layers in another frame paint differently
  for (const x of l.layers ?? []) { const f = x.image ?? x.video; if (f) h.update(`|${f}=${fileStamp(f)}`); }
  // "err…" keys are never painted (the engine skips them); they change when the error does
  return (l.error ? "err-" : "") + h.digest("hex").slice(0, 20);
}

// requests run one at a time, in order (replies stay in order); on stdin's close, exit once they've replied
let queue: Promise<unknown> = Promise.resolve(), closing = false, pending = 0;
const run = (id: unknown, f: () => Promise<unknown>) => {
  pending++;
  queue = queue.then(f).then((r) => reply({ id, ok: true, ...(r as object) }), (e) => reply({ id, ok: false, error: errText(e) }))
    .finally(() => { pending--; if (closing && !pending) process.exit(0); });
};
createInterface({ input: process.stdin }).on("line", (line) => {
  let q: any;
  try { q = JSON.parse(line); } catch (e) { reply({ id: null, ok: false, error: errText(e) }); return; }
  const id = q.id;
  if (q.op === "manifest") run(id, async () => ({ manifest }));
  else if (q.op === "layers") run(id, async () => ({ frame: q.frame, ...(await safeLayers(q.frame)) }));
  else if (q.op === "keys") run(id, async () => {
    const from = Math.max(0, q.from ?? 0), to = Math.min(plan.frames, q.to ?? plan.frames), keys: string[] = [];
    errors = {};
    for (let f = from; f < to; f++) keys.push(await key(f));
    return { from, keys, errors };
  });
  else if (q.op === "credits") run(id, async () => ({ credits: (await imp(join(PIPE, "lib/audio.ts"))).credits({ music: plan.music, sfx: plan.sfx }), voice: plan.voice }));
  else if (q.op === "cues") run(id, async () => ({ total: plan.total, music: plan.music, voice: plan.voice, sfx: plan.sfx, warnings: plan.warnings }));
  else if (q.op === "mix") run(id, async () => ({ ...(await mixSequence(plan, q.out, q.only)), voice: plan.voice, sfx: plan.sfx, warnings: plan.warnings }));
  else if (q.op === "reference") run(id, async () => {
    // the pipeline's own paint of the same layers, for comparing with Flex's (flex diff)
    const { paint } = await imp(join(PIPE, "lib/presets/layers.ts"));
    const sharp = (await imp(join(PIPE, "node_modules/sharp/lib/index.js"))).default;
    const l = await layersAt(plan, q.frame);
    const raw: Buffer = await paint(l.layers, OUT);
    await sharp(raw, { raw: { width: OUT.w, height: OUT.h, channels: 3 } }).png().toFile(q.out);
    return { file: q.out };
  });
  else reply({ id, ok: false, error: `unknown op ${q.op}` });
}).on("close", () => { closing = true; if (!pending) process.exit(0); });
