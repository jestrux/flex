// npm run fx:list — every effect, preset and sound an agent can use, with when to use it.
import "./looks.ts"; // register looks/*.ts
import { EFFECTS } from "./effects/index.ts";
import { CARDS, TRANSITIONS } from "./presets/index.ts";
import { FEELS } from "./feels.ts";
import { library } from "./assets.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { grid, gridPath } from "./music.ts";

const wrap = (s = "", w = 96, pad = "      ") => s.replace(new RegExp(`(.{1,${w}})(\\s|$)`, "g"), `${pad}$1\n`).trimEnd();
console.log("EFFECTS  (journey: cam.effect(type, target, params, { hold }) — or the cam.* shortcuts)\n");
for (const m of Object.values(EFFECTS)) {
  console.log(`  ${m.type.padEnd(12)} ${m.label}  · ${m.space ?? "page"} · hold ${m.hold}ms`);
  if (m.use) console.log(wrap(m.use));
  console.log(`      params ${JSON.stringify(m.defaults)}\n`);
}
console.log("TITLE CARDS + B-ROLL  (sequence: { kind: \"title\" | \"broll\", type, params, dur?, say? })\n");
for (const m of Object.values(CARDS)) console.log(`  ${m.type.padEnd(16)} ${m.label.padEnd(22)} ${m.dur}ms  params ${JSON.stringify(m.defaults)}`);
console.log("\nTRANSITIONS  (sequence: { kind: \"transition\", type?, ms?, params? } — omit type for the feel's default)\n");
for (const m of Object.values(TRANSITIONS)) console.log(`  ${m.type.padEnd(16)} ${m.label.padEnd(22)} ${m.ms}ms`);
console.log("\nFEELS  (sequence: feel)\n");
for (const f of Object.values(FEELS)) console.log(`  ${f.name.padEnd(14)} canvas ${f.canvas.padEnd(13)} default transition ${f.transition.type}`);
const lib = library();
console.log("\nSOUNDS  (effects declare them; assets/library.json)\n");
for (const [k, a] of Object.entries(lib.sfx)) console.log(`  ${k.padEnd(10)} ${String(a.lufs ?? "?").padStart(6)} LUFS  ${a.licence.padEnd(10)} ${a.purpose}`);
console.log("\nMUSIC  (sequence: music: key | false)\n");
for (const [k, a] of Object.entries(lib.music)) {
  const g = existsSync(gridPath(k)) ? grid(k) : null; // the grid the cuts snap to
  console.log(`  ${k.padEnd(18)} ${String(g ? Math.round(g.bpm) : a.bpm ?? "?").padStart(3)} BPM  bar ${g ? g.bar.toFixed(2) : "?"}s  ${a.licence.padEnd(10)} ${a.mood}`);
}
console.log("\n  → npm run music:show <key> <seconds> for sections + start points (ART_DIRECTION §8b)");
