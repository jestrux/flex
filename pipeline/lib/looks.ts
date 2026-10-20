// Loads every look in looks/*.ts (files starting with "_" are helpers, skipped) and registers
// its feel, canvas background, cards and effects, so any command can render it. Node only:
// imported for its side effect by capture, plan, render, sequence, check and the previews.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FEELS } from "./feels.ts";
import { BACKGROUNDS } from "./canvas.ts";
import { CARDS } from "./presets/index.ts";
import { EFFECTS } from "./effects/index.ts";
import { cardModule, feelOfLook, type Look } from "./look.ts";
import { FONT_SCALE, textWidth } from "./effects/kit.ts";

export const LOOKS: Record<string, Look> = {};
const DIR = join(import.meta.dirname, "..", "looks");

export function registerLook(l: Look) {
  if (FEELS[l.name] && !LOOKS[l.name]) throw new Error(`look "${l.name}" clashes with a built-in feel`);
  // a card and an effect can't share a name: their params are validated by name (params.ts), so one silently takes
  // the other's (Flex: patch 07)
  const effectTypes = new Set(Object.values(l.effects).map((d) => d.type));
  for (const d of Object.values(l.cards)) if (effectTypes.has(d.type)) throw new Error(`look "${l.name}": a card and an effect are both named "${d.type}"; rename one`);
  LOOKS[l.name] = l;
  FEELS[l.name] = feelOfLook(l);
  if (typeof l.tokens.canvas !== "string") BACKGROUNDS[l.name] = { label: l.label ?? l.name, bg: l.tokens.canvas };
  for (const d of Object.values(l.cards)) CARDS[d.type!] = cardModule(d);
  for (const d of Object.values(l.effects)) EFFECTS[d.type!] = { ...d, type: d.type!, defaults: d.defaults as Record<string, any> } as (typeof EFFECTS)[string];
}

/** looks that failed to load, with why — a broken look only breaks videos that use it */
export const BROKEN: Record<string, string> = {};
/** measure how a font stack really renders (sharp/librsvg) vs kit's estimate, so textWidth /
 *  widthOf / fitLines are accurate for the look's own fonts (pass the family to them) */
export async function calibrateFont(family: string) {
  if (FONT_SCALE[family]) return;
  const sharp = (await import("sharp")).default, sample = "Frame screens ready to ship, Hero 2× 6400";
  const esc = family.replace(/"/g, "'");
  const real = async (wt: number) => (await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4200" height="200"><rect width="4200" height="200" fill="#fff"/><text x="10" y="140" font-family="${esc}" font-weight="${wt}" font-size="100">${sample}</text></svg>`)).trim().toBuffer({ resolveWithObject: true })).info.width;
  const est = (w: "regular" | "bold") => { const prev = FONT_SCALE[family]; delete FONT_SCALE[family]; const v = textWidth(sample, 100, w, family); if (prev) FONT_SCALE[family] = prev; return v; };
  try { FONT_SCALE[family] = { regular: (await real(400)) / est("regular"), bold: (await real(700)) / est("bold") }; } catch { /* leave the estimate */ }
}

// looks/<name>.ts, and each project's own look: projects/<project>/look.ts (named after the project)
const PROJECTS = process.env.FLEX_PROJECTS ?? join(import.meta.dirname, "..", "projects"); // Flex: its session folder of project links
const lookFiles: { name: string; file: string; rel: string }[] = [
  ...(existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.startsWith("_")).sort().map((f) => ({ name: f.replace(/\.ts$/, ""), file: join(DIR, f), rel: `looks/${f}` })) : []),
  ...(existsSync(PROJECTS) ? readdirSync(PROJECTS).filter((d) => !d.startsWith("_") && existsSync(join(PROJECTS, d, "look.ts"))).sort().map((d) => ({ name: d, file: join(PROJECTS, d, "look.ts"), rel: `projects/${d}/look.ts` })) : []),
];
for (const { name, file, rel } of lookFiles) {
  try {
    const m = await import(pathToFileURL(file).href);
    if (!m.default?.tokens) throw new Error("default-export defineLook({...})");
    if (m.default.name !== name) throw new Error(`the look's name must be "${name}" (its file name, or its project's folder name)`);
    // Flex (patch 12): a composite film's look names the looks it borrows cards from (`export const uses = [filmB, …]`),
    // so another project's scenes render here under their own card names
    const used: Look[] = Array.isArray(m.uses) ? m.uses : [];
    for (const u of [m.default as Look, ...used.filter((u) => u?.tokens && u.name !== name && !LOOKS[u.name])]) {
      registerLook(u);
      const fnt = u.tokens.font;
      for (const fam of [fnt.sans, fnt.display, fnt.mono].filter((x): x is string => !!x)) await calibrateFont(fam);
    }
  } catch (e) {
    BROKEN[name] = (e as Error).message.split("\n")[0];
    console.warn(`  ! ${rel} failed to load (skipped): ${BROKEN[name]}`);
  }
}
