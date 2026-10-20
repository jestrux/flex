// npm run events <take> — a take's timeline in one readable list: narration lines, clicks,
// focus requests, effects, marks and freezes, each with its time (s). For planning cuts and
// checking what a recapture moved, instead of reading events.json by hand.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const take = process.argv[2]; if (!take) { console.error("usage: npm run events <take> [-- --dry]"); process.exit(1); }
const dry = process.argv.includes("--dry") || process.env.npm_config_dry === "true";
const p = dry ? join(process.env.FLEX_WORK ?? join(import.meta.dirname, ".."), "build", "dry", take, "events.json") : join(process.env.FLEX_TAKES ?? join(import.meta.dirname, "..", "takes"), take, "events.json");
if (!existsSync(p)) { console.error(`no capture for "${take}" (takes/${take}/events.json)`); process.exit(1); }
const ev = JSON.parse(readFileSync(p, "utf8"));
const rows: [number, string][] = [];
const s = (ms: number) => (ms / 1000).toFixed(2).padStart(6);
for (const l of ev.narration ?? []) rows.push([l.t, `voice   ${s(l.t)}–${(l.t / 1000 + l.dur).toFixed(2)}s  "${l.text}"`]);
for (const c of ev.clicks ?? []) rows.push([c.t, `click   ${c.label ?? ""} at (${Math.round(c.x)}, ${Math.round(c.y)})`]);
for (const f of ev.focus ?? []) rows.push([f.t, f.kind === "wide" ? "unfocus" : `focus   ${f.kind}${f.label ? ` "${f.label}"` : ""}${f.scale ? ` ×${f.scale}` : ""}${f.ms ? ` push ${f.ms}ms` : ""}${f.hold ? ` hold ${f.hold}ms` : ""}`]);
for (const e of ev.effects ?? []) rows.push([e.t, `effect  ${e.type}${e.label ? ` "${e.label}"` : ""}${e.hold ? ` hold ${e.hold}ms` : ""}`]);
for (const m of ev.marks ?? []) rows.push([m.t, `MARK    "${m.label}"`]);
for (const z of ev.freeze ?? []) rows.push([z.from, `freeze  until ${s(z.to)}s`]);
rows.sort((a, b) => a[0] - b[0]);
console.log(`${take} · ${(ev.duration / 1000).toFixed(1)}s · ${ev.frames?.length ?? 0} frames (the screencast only sends frames when the page changes — gaps are normal)`);
for (const [t, r] of rows) console.log(`  ${s(t)}s  ${r}`);
