// npm run look:preview <look> [--take <take>] [--frame 20000]   (default take: your most recent capture)
// Stills of everything a look draws — each card entering / settled / leaving, each effect over a
// real frame of a take, and the canvas with the recording on it — plus one contact sheet, so you
// can judge the look as a set (consistency) before rendering a video.
// → build/looks/<look>/*.png and build/looks/<look>/sheet.png
import "./looks.ts";
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOOKS } from "./looks.ts";
import { FEELS } from "./feels.ts";
import { CARDS } from "./presets/index.ts";
import { EFFECTS } from "./effects/index.ts";
import { paint } from "./presets/layers.ts";
import { composeEffects } from "./effects/compose.ts";
import { backgroundSvg, BACKGROUNDS, worldOf } from "./canvas.ts";
import { esc } from "./effects/kit.ts";
import type { EffectItem } from "./effects/types.ts";

import { flags } from "./args.ts";
const F = flags("look:preview", ["take", "frame"]), name = F.positional[0];
const opt = (k: string, d: string) => F.get(k) ?? d;
const look = LOOKS[name];
if (!look) { console.error(`unknown look "${name}". Looks: ${Object.keys(LOOKS).join(", ") || "(none in looks/)"}`); process.exit(1); }
const ROOT = join(import.meta.dirname, ".."), OUT = { w: 1920, h: 1080 }, feel = FEELS[name];
const dir = join(process.env.FLEX_WORK ?? ROOT, "build", "looks", name); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const shots: { file: string; label: string }[] = [];
const save = async (buf: Buffer, file: string, label: string) => {
  await sharp(buf, { raw: { width: OUT.w, height: OUT.h, channels: 3 } }).png().toFile(join(dir, file)); shots.push({ file, label });
};

// a real frame of a take, for effects and the canvas
// your own take if you have one (named after the look), else a neutral app still — never another video's footage
const own = readdirSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"))).filter((d) => d.startsWith(name) && existsSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), d, "events.json")))
  .sort((x, y) => statSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), y, "events.json")).mtimeMs - statSync(join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), x, "events.json")).mtimeMs)[0];
const take = F.get("take") ?? own, W = 1440, H = 810;
let app: Buffer;
if (take) {
  const tdir = join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), take);
  if (!existsSync(join(tdir, "events.json"))) { console.error(`take "${take}" not captured; pass --take <one in takes/>`); process.exit(1); }
  const ev = JSON.parse(readFileSync(join(tdir, "events.json"), "utf8"));
  const frame = [...ev.frames].reverse().find((f: { t: number }) => f.t <= Number(opt("frame", "20000"))) ?? ev.frames[0];
  app = await sharp(join(tdir, "frames", frame.file)).resize(OUT.w, OUT.h).removeAlpha().raw().toBuffer();
  console.log(`  frame from take "${take}" at ${(frame.t / 1000).toFixed(1)}s (--take / --frame <ms> to change)`);
} else {
  app = await sharp(join(ROOT, "assets/broll/app-still.jpg")).resize(OUT.w, OUT.h).removeAlpha().raw().toBuffer();
  console.log(`  no take named ${name}-* yet: effects drawn over a neutral app still (re-run after your first capture)`);
}

// 1 · the canvas: the look's stage with the recording inset (as the film's rest view: 6% padding)
let stageBuf: Buffer = app;
{
  const pad = 0.06, r = { x: OUT.w * pad, y: OUT.h * pad, w: OUT.w * (1 - 2 * pad), h: OUT.h * (1 - 2 * pad) };
  const inset = await sharp(app, { raw: { width: OUT.w, height: OUT.h, channels: 3 } }).resize(Math.round(r.w), Math.round(r.h)).png().toBuffer();
  const bg = await paint([{ svg: backgroundSvg((BACKGROUNDS[feel.canvas] ?? BACKGROUNDS.modern).bg, OUT.w, OUT.h) }], OUT);
  const buf = await sharp(bg, { raw: { width: OUT.w, height: OUT.h, channels: 3 } }).composite([{ input: inset, left: Math.round(r.x), top: Math.round(r.y) }]).removeAlpha().raw().toBuffer();
  stageBuf = buf;
  await save(buf, "00-canvas.png", "canvas");
}

// rule 11 (cards own the frame): how wide is the card's composition — everything that differs from the stage
const stageOnly = await paint([{ svg: backgroundSvg((BACKGROUNDS[feel.canvas] ?? BACKGROUNDS.modern).bg, OUT.w, OUT.h) }], OUT);
const widthNotes: string[] = [];
function widthCheck(key: string, f: Buffer) {
  let lo = OUT.w, hi = 0;
  for (let y = 0; y < OUT.h; y += 4) for (let x = 0; x < OUT.w; x += 2) {
    const i = (y * OUT.w + x) * 3;
    if (Math.abs(f[i] - stageOnly[i]) + Math.abs(f[i + 1] - stageOnly[i + 1]) + Math.abs(f[i + 2] - stageOnly[i + 2]) > 36) { if (x < lo) lo = x; if (x > hi) hi = x; }
  }
  const frac = hi > lo ? (hi - lo) / OUT.w : 0;
  widthNotes.push(`    ${frac >= 0.5 ? "✓" : "✗"} card ${key}: spans ${(frac * 100).toFixed(0)}% of the frame width${frac < 0.5 ? " — DESIGN rule 11 wants ≥ 50%: bigger title/sheet, the card owns the frame" : ""}`);
}
const lastCard = Object.keys(look.cards).find((k) => /clos|end|outro|last/i.test(k));

// 2 · cards: entering, settled, leaving
for (const [key, d] of Object.entries(look.cards)) {
  const m = CARDS[d.type!], dur = d.dur, params = { ...d.defaults, ...(d as { sample?: object }).sample };
  // in/out at a third of the way through the entrance/exit, so the motion actually shows
  const missing = Object.entries(params as Record<string, unknown>).filter(([k]) => /^(src|image|file|path|png|still|video)$/i.test(k)).map(([, v]) => v)
    .find((v) => typeof v === "string" && /\.(png|jpe?g|webp|mp4)$/i.test(v) && !existsSync(v.startsWith("/") ? v : join(ROOT, v)));
  const hasFileParam = Object.keys(params as Record<string, unknown>).some((k) => /^(src|image|file|path|png|still|video)$/i.test(k));
  if (d.kind === "broll" && !hasFileParam && !missing) { console.warn(`  ! card ${key}: a broll card with no src/image in its sample — skipped (give it a sample image)`); continue; }
  if (missing) { console.warn(`  ! card ${key}: sample file "${missing}" doesn't exist yet (capture first, or point the sample at an existing image) — skipped`); continue; }
  for (const [tag, t] of [["in", Math.round(feel.motion.in * 0.33)], ["hold", Math.round(dur * 0.5)], ["out", dur - Math.round(feel.motion.out * 0.33)]] as const)
  {
    const frame = await paint(m.render(params, { t, dur, out: OUT, feel, uid: `lp-${key}`, last: key === lastCard, asset: (p) => (p.startsWith("/") ? p : join(ROOT, p)) }), OUT);
    await save(frame, `card-${key}-${tag}.png`, `card ${key} · ${tag}`);
    if (tag === "hold" && d.kind !== "broll") widthCheck(key, frame); // rule 11 is for title cards, not an image payoff
  }
}

// 3 · effects over the frame: entering, settled
// effects are drawn as in the film's rest view: the camera crop is the whole canvas world, so
// screen overlays see ctx.window = the inset recording, and page effects land on the inset app
const world = worldOf({ on: true, preset: feel.canvas, padding: 0.06, radius: 14, shadow: true }, W, H);
const full = { x: world.x, y: world.y, w: world.w, h: world.h }, cursor = Array.from({ length: 80 }, (_, i) => ({ t: i * 25, x: W / 2 + i * 2, y: H / 2 }));
for (const [key, d] of Object.entries(look.effects)) {
  const m = EFFECTS[d.type!], s = (d as { sample?: object; sampleTarget?: EffectItem["target"] });
  const target = s.sampleTarget ?? (m.space === "screen" ? {} : { rect: { x: W / 2 - 160, y: H / 2 - 40, w: 320, h: 80 } });
  const item: EffectItem = { id: `lp-${key}`, type: d.type!, start: 0, end: m.hold, enabled: true, target, params: { ...m.defaults, ...s.sample } };
  for (const [tag, t] of [["in", 160], ["hold", Math.min(1400, Math.round(m.hold / 2))]] as const) {
    const svg = composeEffects([item], t, { crop: full, view: { w: W, h: H }, out: OUT, cursor, feel });
    const buf = await sharp(stageBuf, { raw: { width: OUT.w, height: OUT.h, channels: 3 } }).composite(svg ? [{ input: Buffer.from(svg) }] : []).removeAlpha().raw().toBuffer();
    await save(buf, `fx-${key}-${tag}.png`, `effect ${key} · ${tag}`);
  }
}

// 4 · contact sheet: everything side by side, labelled
const TW = 640, TH = 360, COLS = 3, GAP = 24, LH = 40, rows = Math.ceil(shots.length / COLS);
const SW = COLS * TW + (COLS + 1) * GAP, SH = rows * (TH + LH) + (rows + 1) * GAP;
const tiles = await Promise.all(shots.map(async (s, i) => {
  const x = GAP + (i % COLS) * (TW + GAP), y = GAP + Math.floor(i / COLS) * (TH + LH + GAP);
  return [{ input: await sharp(join(dir, s.file)).resize(TW, TH).png().toBuffer(), left: x, top: y },
    { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${LH}"><text x="0" y="28" font-family="Helvetica" font-size="22" fill="#D4D4D8">${esc(s.label)}</text></svg>`), left: x, top: y + TH }];
}));
await sharp({ create: { width: SW, height: SH, channels: 3, background: "#18181B" } }).composite(tiles.flat()).png().toFile(join(dir, "sheet.png"));
console.log(`✓ ${shots.length} stills + sheet → ${join(dir, "sheet.png")}`);

if (widthNotes.length) console.log("\n  card width (DESIGN rule 11):\n" + widthNotes.join("\n"));

// 5 · contrast of the look's text/background pairs (DESIGN rule 9: text ≥ 4.5:1, accents/callouts ≥ 3:1)
const rgb = (c: string): [number, number, number] | null => {
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (h) { const x = h[1].length === 3 ? h[1].split("").map((d) => d + d).join("") : h[1]; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number]; }
  const m = /rgba?\(([^)]+)\)/.exec(c); if (m) { const v = m[1].split(/[\s,/]+/).map(Number); return [v[0], v[1], v[2]]; }
  return null;
};
const lum = ([r, g, b]: number[]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
// a translucent colour (rgba(…, .82) or #rrggbbaa) is measured as it actually paints: blended over the background
const alpha = (c: string) => { const h = /^#[0-9a-f]{6}([0-9a-f]{2})$/i.exec(c.trim()); if (h) return parseInt(h[1], 16) / 255; const m = /rgba\(([^)]+)\)/.exec(c); if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean); if (v.length > 3) return v[3].endsWith("%") ? parseFloat(v[3]) / 100 : +v[3]; } return 1; };
const ratio = (a: string, b: string) => { let x = rgb(a.replace(/^(#[0-9a-f]{6})[0-9a-f]{2}$/i, "$1")); const y = rgb(b); if (!x || !y) return null; const al = alpha(a); if (al < 1) x = x.map((v, i) => v * al + y[i] * (1 - al)) as [number, number, number]; const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return (p + 0.05) / (q + 0.05); };
const bg = BACKGROUNDS[feel.canvas]?.bg as { type: string; color?: string; stops?: [string, number][] } | undefined;
const stage = bg?.type === "solid" && bg.color ? [bg.color] : bg?.stops?.map((s) => s[0]) ?? [];
const C = feel.color, pairs: [string, string, string, number][] = [];
for (const [fg, fgName, min] of [[C.ink, "ink", 4.5], [C.sub, "sub", 4.5], [C.accent, "accent", 3], [C.callout ?? C.accent, "callout", 3]] as const) {
  for (const s of stage) pairs.push([fgName, `stage ${s}`, fg, min]);
  pairs.push([fgName, "card", fg, min]);
}
pairs.push(["cardInk", "card", C.cardInk, 4.5]);
let bad = 0;
console.log("\n  contrast (DESIGN rule 9) — every token pair; a ✗ only matters if your look draws that pair:");
for (const [fgName, bgName, fg, min] of pairs) {
  const r = ratio(fg, bgName === "card" ? C.card : bgName.slice(6)); if (r === null) continue;
  const ok = r >= min; if (!ok) bad++;
  // suggest the nearest darker (or lighter, on dark stages) value that passes
  let fix = "";
  if (!ok) { const base = rgb(fg)!, bgc = bgName === "card" ? C.card : bgName.slice(6), dark = lum(rgb(bgc)!) > 0.4;
    for (let k = 1; k <= 40; k++) { const v = base.map((x) => Math.round(dark ? x * (1 - k * 0.02) : x + (255 - x) * k * 0.02)); if ((ratio("#" + v.map((x) => x.toString(16).padStart(2, "0")).join(""), bgc) ?? 0) >= min) { fix = "#" + v.map((x) => x.toString(16).padStart(2, "0")).join(""); break; } } }
  console.log(`    ${ok ? "✓" : "✗"} ${fgName.padEnd(8)} on ${bgName.padEnd(16)} ${r.toFixed(2)}:1  [${min === 3 ? "accent/callout, ≥ 3:1" : "text, ≥ 4.5:1"}]${ok ? "" : ` — never draw ${fgName} on it${fix ? `, or use ${fix} (the nearest value that passes)` : ""}`}`);
}
if (bad) console.log(`  ${bad} pair(s) under target: if your look draws one, darken the token (and say so); otherwise ignore.`);
