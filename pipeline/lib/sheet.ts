// npm run sheet <video> [--every 2]   — a contact sheet of a finished film, one tile per N seconds,
// each stamped with its time → build/sheets/<video>.png (its own file per video: safe in parallel)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { finalPath } from "./build.ts";
import { flags } from "./args.ts";
const F = flags("sheet", ["every"]), name = F.positional[0], every = Number(F.get("every") ?? 2);
if (!name) { console.error("usage: npm run sheet <video> [-- --every 2]"); process.exit(1); }
const src = finalPath(name);
if (!existsSync(src)) { console.error(`no film at ${src} — render it first (npm run video ${name})`); process.exit(1); }
const out = join(process.env.FLEX_WORK ?? join(import.meta.dirname, ".."), "build", "sheets"); mkdirSync(out, { recursive: true });
const file = join(out, `${name}.png`);
const dur = parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString());
const n = Math.floor((dur - 0.05) / every) + 1, cols = 6, rows = Math.ceil(n / cols); // tiles at exactly 0, every, 2·every … (never past the end)
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `select='not(mod(n\,${Math.round(every * 30)}))',scale=384:216,tile=${cols}x${rows}`, "-fps_mode", "vfr", "-frames:v", "1", file]);
// stamp each tile with its time (this ffmpeg has no drawtext)
const sharp = (await import("sharp")).default;
const stamps = Array.from({ length: n }, (_, i) => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="74" height="22"><rect width="74" height="22" fill="rgba(0,0,0,.6)"/><text x="6" y="16" font-family="Menlo" font-size="13" fill="#fff">${Math.floor((i * every) / 60)}:${String(Math.round((i * every) % 60)).padStart(2, "0")}</text></svg>`), left: (i % cols) * 384, top: Math.floor(i / cols) * 216 }));
const buf = await sharp(file).composite(stamps).png().toBuffer();
await sharp(buf).toFile(file);
console.log(`✓ ${n} tiles (1 per ${every}s) → ${file}`);
