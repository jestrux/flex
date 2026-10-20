// flex card: one card on its own, outside any scene, with the project's look. Lists the cards the project can use (the
// pipeline's own and its look's) with their default params and length, or renders one with the params given: a still at
// a moment, or the whole card as a clip. Renders what it's asked for; it doesn't choose params.
//   card.mts <project> [--json]                                   the cards
// A card's own sample values (what it shows when previewed alone, e.g. in the assets panel) are the project's, beside its
// cards: `export const previews = { <card type>: { params: {…}, dur: ms } }` in look.ts or any cards/*.ts.
//   card.mts <project> <type> [--params '{…}'] [--dur ms] [--at ms] [-o x.png|x.mp4] [--width 1920] [--json]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PIPE = process.env.FLEX_PIPELINE!;
const imp = (p: string) => import(pathToFileURL(p).href);
const out = ((w) => (s: string) => w(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
const argv = process.argv.slice(2), flag = (f: string) => argv.includes(`--${f}`);
const opt = (f: string) => { const i = argv.indexOf(f.startsWith("-") ? f : `--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
const pos = argv.filter((a, i) => !a.startsWith("-") && !(i > 0 && ["--params", "--dur", "--at", "-o", "--width"].includes(argv[i - 1])));
const DIR = resolve(pos[0] ?? "."), type = pos[1];
const fail = (m: string): never => { if (flag("json")) out(JSON.stringify({ ok: false, error: m })); else console.error(`!! ${m}`); process.exit(1); };

// the project first (its look registers its cards), then the registry
await imp(join(PIPE, "lib/looks.ts")); // registers looks/*.ts and the project's look.ts (and its cards)
const project = (await imp(join(DIR, "project.ts"))).default;
const { CARDS } = await imp(join(PIPE, "lib/presets/index.ts"));
const { feelNamed } = await imp(join(PIPE, "lib/feels.ts"));
const feel = feelNamed(project.feel);

// the project's own sample values, by card type
const previews: Record<string, { params?: Record<string, unknown>; dur?: number }> = {};
for (const f of [join(DIR, "look.ts"), ...(existsSync(join(DIR, "cards")) ? readdirSync(join(DIR, "cards")).filter((n) => n.endsWith(".ts")).map((n) => join(DIR, "cards", n)) : [])]) {
  if (!existsSync(f)) continue;
  try { Object.assign(previews, (await imp(f)).previews ?? {}); } catch (e) { console.warn(`  ! ${basename(f)}: ${(e as Error).message.split("\n")[0]} (its previews skipped)`); }
}

if (!type) {
  const list = Object.values(CARDS).map((m: any) => ({ type: m.type, kind: m.kind, label: m.label, dur: m.dur, defaults: m.defaults, ...(previews[m.type] ? { preview: previews[m.type] } : {}) }));
  if (flag("json")) out(JSON.stringify({ ok: true, feel: project.feel, cards: list }));
  else { out(`${list.length} cards (feel ${project.feel}):`); for (const c of list) out(`  ${c.type.padEnd(34)} ${String(c.dur).padStart(5)} ms  ${Object.keys(c.defaults ?? {}).join(", ")}`); }
  process.exit(0);
}
const m = CARDS[type] ?? fail(`no card "${type}" (flex card ${pos[0] ?? "."} lists them)`);
let params: Record<string, unknown> = {};
try { params = { ...(m.defaults ?? {}), ...JSON.parse(opt("params") ?? "{}") }; } catch (e) { fail(`--params isn't JSON: ${e}`); }
const dur = Number(opt("dur") ?? m.dur), W = Number(opt("width") ?? 1920), OUT = { w: W, h: Math.round((W * 9) / 16) };
const file = resolve(opt("-o") ?? join(DIR, "build", "cards", `${basename(type)}${opt("at") ? `@${opt("at")}` : ""}.${opt("at") ? "png" : "mp4"}`));
mkdirSync(dirname(file), { recursive: true });
const { paint } = await imp(join(PIPE, "lib/presets/layers.ts"));
const sharp = (await imp(join(PIPE, "node_modules/sharp/lib/index.js"))).default;
const ctx = (t: number) => ({ t, dur, out: OUT, feel, uid: "card", last: false, cutNext: false, asset: (a: string) => (a.startsWith("/") ? a : existsSync(join(DIR, a)) ? join(DIR, a) : join(PIPE, a)) });
const fix = (ls: any[]) => { for (const l of ls) { for (const k of ["image", "video"]) if (l[k] && !l[k].startsWith("/")) l[k] = existsSync(join(DIR, l[k])) ? join(DIR, l[k]) : join(PIPE, l[k]); } return ls; };

if (file.endsWith(".png") || file.endsWith(".jpg")) {
  const t = Number(opt("at") ?? Math.round(dur / 2));
  const raw: Buffer = await paint(fix(m.render(params, ctx(t))), OUT);
  await sharp(raw, { raw: { width: OUT.w, height: OUT.h, channels: 3 } }).toFile(file);
  out(flag("json") ? JSON.stringify({ ok: true, file, type, t, params }) : `${file}  (${type} at ${t} ms of ${dur})`);
} else {
  const FPS = 30, n = Math.max(1, Math.round((dur / 1000) * FPS));
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${OUT.w}x${OUT.h}`, "-r", String(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", file], { stdio: ["pipe", "ignore", "inherit"] });
  for (let f = 0; f < n; f++) {
    const raw: Buffer = await paint(fix(m.render(params, ctx((f * 1000) / FPS))), OUT);
    if (!ff.stdin.write(raw)) await new Promise((r) => ff.stdin.once("drain", r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  out(flag("json") ? JSON.stringify({ ok: true, file, type, dur, frames: n, params }) : `${file}  (${type}, ${dur} ms, ${n} frames)`);
}
process.exit(0);
