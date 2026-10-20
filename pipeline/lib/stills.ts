// npm run stills -- <video> <t1> <t2> …   (seconds; or --every 2.5) [--montage]  (--montage: also one grid image of them, labelled)
// Full-size frames of a rendered film at the times you name → build/stills/<video>/<t>.png. The contact
// sheet's tiles are too small to see a panel sliver, a clipped word or a soft crop: look at these.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { finalPath } from "./build.ts";

const [name, ...rest] = process.argv.slice(2);
if (!name || !rest.length) { console.error("usage: npm run stills -- <video> <t1> <t2> …  |  <video> --every <s>"); process.exit(1); }
const film = existsSync(name) ? name : finalPath(name);
if (!existsSync(film)) { console.error(`no film at ${film} — render it first`); process.exit(1); }
const dur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", film], { encoding: "utf8" }).trim();
const ei = rest.indexOf("--every");
const montage = rest.includes("--montage");
const times = ei >= 0 ? Array.from({ length: Math.floor(dur / +rest[ei + 1]) + 1 }, (_, i) => +(i * +rest[ei + 1]).toFixed(2)) : rest.filter((x) => x !== "--montage").map(Number).filter((t) => !Number.isNaN(t));
const shots: [number, string][] = [];
const out = join(process.env.FLEX_WORK ?? join(import.meta.dirname, ".."), "build", "stills", name.replace(/^.*\//, "").replace(/\.mp4$/, "")); mkdirSync(out, { recursive: true });
for (const t of times) {
  if (t > dur) { console.warn(`  ! ${t}s is past the end (${dur.toFixed(2)}s)`); continue; }
  const f = join(out, `${t.toFixed(2).padStart(6, "0")}.png`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", film, "-frames:v", "1", f]);
  console.log(`  ${t.toFixed(2)}s → ${f}`); shots.push([t, f]);
}
if (montage && shots.length === 1) { execFileSync("cp", [shots[0][1], join(out, "montage.png")]); console.log(`  montage (one still) → ${join(out, "montage.png")}`); }
else if (montage && shots.length) { // 3 across, half size, each labelled with its time
  const cols = Math.min(3, shots.length), rows = Math.ceil(shots.length / cols), m = join(out, "montage.png");
  const inputs = shots.flatMap(([, f]) => ["-i", f]);
  const lab = shots.map(([t], i) => `[${i}:v]scale=960:-1,drawbox=x=0:y=0:w=120:h=40:color=black@0.7:t=fill,drawtext=text='${t.toFixed(2)}s':x=10:y=8:fontsize=24:fontcolor=white[s${i}]`).join(";");
  const pad = Array.from({ length: cols * rows - shots.length }, (_, i) => `color=c=black:s=960x540[p${i}]`).join(";");
  const all = [...shots.map((_, i) => `[s${i}]`), ...Array.from({ length: cols * rows - shots.length }, (_, i) => `[p${i}]`)];
  const layout = all.map((_, i) => `${(i % cols) * 960}_${Math.floor(i / cols) * 540}`).join("|");
  const filt = `${lab}${pad ? ";" + pad : ""};${all.join("")}xstack=inputs=${all.length}:layout=${layout}`;
  try { execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", filt, "-frames:v", "1", m], { stdio: "pipe" }); console.log(`  montage → ${m}`); }
  catch { // no drawtext (ffmpeg built without freetype): unlabelled grid
    const f2 = `${shots.map((_, i) => `[${i}:v]scale=960:-1[s${i}]`).join(";")}${pad ? ";" + pad : ""};${all.join("")}xstack=inputs=${all.length}:layout=${layout}`;
    execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", f2, "-frames:v", "1", m]); console.log(`  montage (unlabelled — ffmpeg has no drawtext; order = the times given) → ${m}`);
  }
}
