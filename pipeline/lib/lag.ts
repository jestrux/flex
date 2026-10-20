// npm run lag <take> [mark]   — how long the app takes to show a change after a click: for each
// click (or the clicks right before each mark matching [mark]) it finds the first captured frame that
// differs from the frame at the click, and when the change settles. Pass the "shows" time to
// b.click(n, target, label, { lag }).
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [take, filter] = process.argv.slice(2);
if (!take) { console.error("usage: npm run lag <take> [mark-or-click-label]"); process.exit(1); }
const dir = join(process.env.FLEX_TAKES ?? join(import.meta.dirname, "..", "takes"), take), p = join(dir, "events.json");
if (!existsSync(p)) { console.error(`no capture for "${take}"`); process.exit(1); }
const ev = JSON.parse(readFileSync(p, "utf8")) as { frames: { t: number; file: string }[]; clicks: { t: number; label?: string; rect?: { x: number; y: number; w: number; h: number } }[] };
let crop: { left: number; top: number; width: number; height: number } | undefined;
const small = async (f: string) => { const img = sharp(join(dir, "frames", f)); return (await (crop ? img.extract(crop) : img).resize(240, 135, { fit: "fill" }).greyscale().raw().toBuffer()); };
const diff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const clicks = ev.clicks.filter((c) => !filter || (c.label ?? "").includes(filter));
if (!clicks.length) { console.error(`no clicks${filter ? ` labelled *${filter}*` : ""} in ${take}`); process.exit(1); }
for (const c of clicks) {
  const at = [...ev.frames].reverse().find((f) => f.t <= c.t); if (!at) continue;
  // compare the whole frame AND the clicked control's neighbourhood (a finish swatch changes a thin bezel)
  crop = undefined;
  const baseW = await small(at.file), after = ev.frames.filter((f) => f.t > c.t && f.t < c.t + 1500);
  let base = baseW;
  const wDiffs = await Promise.all(after.slice(0, 6).map(async (f) => diff(baseW, await small(f.file))));
  if (Math.max(0, ...wDiffs) < 0.6) { // nothing big changed: look at the stage instead (the subject, not the control)
    const m = await sharp(join(dir, "frames", at.file)).metadata(), k = m.width! / 1440;
    crop = { left: Math.round(330 * k), top: 0, width: Math.round(1110 * k), height: m.height! };
    base = await small(at.file);
  }
  let shows: number | null = null, settles: number | null = null, prev = base;
  for (const f of after) {
    const b = await small(f.file), d = diff(base, b), step = diff(prev, b);
    if (shows === null && d > (crop ? 0.25 : 0.6)) shows = f.t - c.t;
    if (shows !== null && step < 0.15) { settles = f.t - c.t; break; }
    prev = b;
  }
  console.log(`  ${(c.t / 1000).toFixed(2)}s  ${(c.label ?? "click").padEnd(18)} shows +${shows ?? "?"} ms · settles +${settles ?? "?"} ms`);
}
console.log("  (frames arrive only when the page paints, so these are ±1 frame. lag to pass = shows + (settles − shows) / 2, i.e. the middle of the change)");
