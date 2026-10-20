// Preview a production preset without building a video. Safe to run in parallel.
//   cards (title-*/broll-*):  npx tsx lib/presets/preview.ts <type> [--feel modern|all] [--params '{…}'] [--dur ms] [--at 0,300,…]
//   transitions:              npx tsx lib/presets/preview.ts <type> [--feel …] [--at 0,0.25,0.5,0.75,1]   (progress u)
// → /tmp/preset-preview/<type>/<feel>-<t>.png   (add --tag x to write /tmp/preset-preview/<type>-x/)
import "../looks.ts"; // register looks/*.ts
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CARDS, TRANSITIONS } from "./index.ts";
import { paint } from "./layers.ts";
import { FEELS, type FeelName } from "../feels.ts";
import { backgroundSvg, BACKGROUNDS } from "../canvas.ts";

const a = process.argv.slice(2), type = a[0];
const opt = (k: string, d?: string) => { const i = a.indexOf(`--${k}`); return i > 0 ? a[i + 1] : d; };
const ROOT = join(import.meta.dirname, "..", "..");
const OUT = { w: 1920, h: 1080 };
const feels = (opt("feel", "all") === "all" ? Object.keys(FEELS) : [opt("feel")!]) as FeelName[];
const card = CARDS[type], tx = TRANSITIONS[type];
if (!card && !tx) { console.error(`unknown preset "${type}". Cards: ${Object.keys(CARDS).join(", ")} · transitions: ${Object.keys(TRANSITIONS).join(", ")}`); process.exit(1); }
const dir = join("/tmp/preset-preview", opt("tag") ? `${type}-${opt("tag")}` : type); mkdirSync(dir, { recursive: true });
const save = (buf: Buffer, name: string) => sharp(buf, { raw: { width: OUT.w, height: OUT.h, channels: 3 } }).png().toFile(join(dir, name));

for (const fn of feels) {
  const feel = FEELS[fn];
  if (card) {
    const params = { ...card.defaults, ...JSON.parse(opt("params", "{}")!) };
    const dur = Number(opt("dur", String(card.dur)));
    const times = (opt("at") ?? [0, 150, 350, 600, 1000, Math.round(dur / 2), dur - 400, dur - 1].join(",")).split(",").map(Number);
    for (const t of times) await save(await paint(card.render(params, { t, dur, out: OUT, feel, uid: "p", asset: (p) => (p.startsWith("/") ? p : join(ROOT, p)) }), OUT), `${fn}-${String(t).padStart(5, "0")}.png`);
  } else {
    // A = an app frame, B = the feel's background with a title, so the motion reads clearly
    const A = await sharp(join(ROOT, "assets/broll/app-still.jpg")).resize(OUT.w, OUT.h).removeAlpha().raw().toBuffer();
    const B = await paint([{ svg: backgroundSvg((BACKGROUNDS[feel.canvas] ?? BACKGROUNDS.modern).bg, OUT.w, OUT.h) },
      { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT.w}" height="${OUT.h}"><text x="50%" y="52%" text-anchor="middle" font-family="${feel.font.display}" font-weight="${feel.font.displayWeight}" font-size="96" fill="${feel.color.ink}">Scene B</text></svg>` }], OUT);
    const us = (opt("at") ?? "0,0.15,0.3,0.45,0.6,0.75,0.9,1").split(",").map(Number);
    for (const u of us) await save(await tx.mix(A, B, u, { out: OUT, feel, params: { ...tx.defaults, ...JSON.parse(opt("params", "{}")!) } }), `${fn}-${u.toFixed(2)}.png`);
  }
}
console.log(`✓ ${type} → ${dir}`);
