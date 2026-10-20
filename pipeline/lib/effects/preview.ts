// Preview one effect without capturing or rendering a take: draws it over a still frame of
// an existing take at several moments, both at full frame and under a zoom, and writes PNGs.
// Safe to run in parallel (reads the take, writes only to its own out dir).
//
//   npx tsx lib/effects/preview.ts <type> [--params '{"style":"curved"}'] [--rect x,y,w,h] [--untargeted] [--feel clean] [--tag run1]
//        [--points x1,y1;x2,y2] [--hold 3000] [--take studio-social] [--frame 20000]
//        [--zoom 1.8] [--at 0,200,600,1500,…]  → /tmp/fx-preview/<type>/
import "../looks.ts"; // register looks/*.ts
import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EFFECTS } from "./index.ts";
import { composeEffects } from "./compose.ts";
import { FEELS, type FeelName } from "../feels.ts";
import type { EffectItem, Rect } from "./types.ts";

const a = process.argv.slice(2);
const type = a[0]; const m = EFFECTS[type];
if (!m) { console.error(`unknown effect "${type}". Known: ${Object.keys(EFFECTS).join(", ")}`); process.exit(1); }
const opt = (k: string, d?: string) => { const i = a.indexOf(`--${k}`); return i > 0 ? a[i + 1] : d; };
const take = opt("take", "showcase-c")!;
const dir = join(import.meta.dirname, "..", "..", "takes", take);
const ev = JSON.parse(readFileSync(join(dir, "events.json"), "utf8"));
const W = ev.viewport.w, H = ev.viewport.h, OUT = { w: 1920, h: 1080 };
const frameT = Number(opt("frame", "20000"));
const frame = [...ev.frames].reverse().find((f: any) => f.t <= frameT) ?? ev.frames[0];
const hold = Number(opt("hold", String(m.hold)));
const rect = opt("rect")?.split(",").map(Number);
const points = opt("points")?.split(";").map((p) => { const [x, y] = p.split(",").map(Number); return { x, y }; });
// --untargeted renders with no target (screen-centred effects like an untargeted check)
const target = a.includes("--untargeted") ? {} : rect ? { rect: { x: rect[0], y: rect[1], w: rect[2], h: rect[3] } } : points ? { points } : { rect: { x: W / 2 - 120, y: H / 2 - 40, w: 240, h: 80 } };
const item: EffectItem = { id: "preview", type, start: 0, end: hold, enabled: true, target, params: { ...m.defaults, ...JSON.parse(opt("params", "{}")!) } };
const times = (opt("at") ?? [0, 100, 250, 500, 900, Math.round(hold / 2), hold - 1, hold + m.exit * 0.5, hold + m.exit + 1].join(",")).split(",").map(Number);
const zoom = Number(opt("zoom", "1.8"));
// --tag name keeps runs apart: /tmp/fx-preview/<type>-<tag>/
const out = join("/tmp/fx-preview", opt("tag") ? `${type}-${opt("tag")}` : type); mkdirSync(out, { recursive: true });

// cursor: a synthetic sweep across the target for pointer effects
const r0 = item.target.rect ?? { x: W / 2, y: H / 2, w: 1, h: 1 };
const cursor = Array.from({ length: 120 }, (_, i) => ({ t: i * 25, x: r0.x + (r0.w * (i % 60)) / 60, y: r0.y + r0.h / 2 + Math.sin(i / 6) * 20 }));
const src = sharp(join(dir, "frames", frame.file)); const meta = await src.metadata(); const k = meta.width! / W;
const raw = await src.removeAlpha().raw().toBuffer();
const c = { x: r0.x + r0.w / 2, y: r0.y + r0.h / 2 };
for (const [name, crop] of [["wide", { x: 0, y: 0, w: W, h: H }], ["zoom", ((): Rect => { const w = W / zoom, h = H / zoom; return { x: Math.min(W - w, Math.max(0, c.x - w / 2)), y: Math.min(H - h, Math.max(0, c.y - h / 2)), w, h }; })()]] as const) {
  for (const t of times) {
    const svg = composeEffects([item], t, { crop, view: { w: W, h: H }, out: OUT, cursor: cursor.map((p) => ({ ...p })), feel: FEELS[(opt("feel", "modern") as FeelName)] ?? FEELS.modern }); // --feel for feel-aware effects (lower thirds)
    const base = sharp(raw, { raw: { width: meta.width!, height: meta.height!, channels: 3 } })
      .extract({ left: Math.round(crop.x * k), top: Math.round(crop.y * k), width: Math.round(crop.w * k), height: Math.round(crop.h * k) }).resize(OUT.w, OUT.h);
    await (svg ? base.composite([{ input: Buffer.from(svg) }]) : base).png().toFile(join(out, `${name}-${String(t).padStart(5, "0")}.png`));
  }
}
console.log(`✓ ${times.length * 2} stills → ${out}  (frame ${frame.file} @${frameT}ms, target ${JSON.stringify(item.target)})`);
