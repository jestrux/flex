// npm run look:tokens <url> [--wait selector]
// Samples the product's real design from its rendered pages: font families and weights, the
// colours actually painted (backgrounds, text, the primary button), corner radii, and any CSS
// colour variables on :root — then prints a draft `tokens` block for looks/<name>.ts.
// It's a starting point: read it, look at the screenshot, decide. Runs in its own fresh browser.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const a = process.argv.slice(2), url = a[0];
if (!url) { console.error("usage: look:tokens <url> [--name <your-look>] [--wait selector] [--click selector]…"); process.exit(1); }
const wi = a.indexOf("--wait"), wait = wi > 0 ? a[wi + 1] : null;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
if (wait) await page.locator(wait).first().waitFor({ timeout: 15_000 });
// --click <sel> (repeatable): reach another state first (e.g. a mode whose surfaces you'll use — a hero
// background exists only in Hero mode); "surfaces" below lists what's on the page as sampled
for (let i = 0; i < a.length; i++) if (a[i] === "--click") { await page.locator(a[i + 1]).first().click({ timeout: 8_000 }); await page.waitForTimeout(700); console.log(`· clicked ${a[i + 1]}`); }
await page.waitForTimeout(600);
const dir = join(process.env.FLEX_WORK ?? join(import.meta.dirname, ".."), "build", "looks"); mkdirSync(dir, { recursive: true });
const ni = a.indexOf("--name"), tag = ni > 0 ? a[ni + 1] : new URL(url).hostname.replace(/\W+/g, "-");
if (ni < 0) console.warn(`  ! no --name: the screenshot is build/looks/tokens-${tag}.png, shared with anyone sampling this URL — pass --name <your-look>`);
const shot = join(dir, `tokens-${tag}.png`); // --name <your-look> keeps parallel runs apart
await page.screenshot({ path: shot });

// a string, so tsx's __name helper never reaches the page
const data = await page.evaluate(`(() => {
  const count = (m, k, w = 1) => { if (k) m[k] = (m[k] || 0) + w; };
  const top = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ value: k, weight: Math.round(v) }));
  const fonts = {}, weights = {}, bgs = {}, inks = {}, radii = {};
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight; };
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el), r = el.getBoundingClientRect(), area = Math.min(r.width * r.height, 200000) / 1000;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasText) { count(fonts, s.fontFamily.split(",")[0].replace(/["']/g, "").trim(), +s.fontSize.replace("px", "")); count(weights, s.fontWeight); count(inks, s.color, +s.fontSize.replace("px", "")); }
    if (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent") count(bgs, s.backgroundColor, area);
    if (parseFloat(s.borderTopLeftRadius) > 0 && r.width > 24) count(radii, s.borderTopLeftRadius, 1);
  }
  const heading = document.querySelector("h1, h2, [class*=title]");
  const hs = heading ? getComputedStyle(heading) : null;
  const btn = [...document.querySelectorAll("button, a[class*=btn], a[class*=button], [role=button]")].filter(visible)
    .map((b) => getComputedStyle(b)).find((s) => s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "rgb(255, 255, 255)");
  const root = getComputedStyle(document.documentElement), vars = {};
  for (const sheet of document.styleSheets) { try { for (const rule of sheet.cssRules) { const sel = rule.selectorText; if (!sel || !(sel === ":root" || /^\\.[\\w-]+$/.test(sel))) continue; const el = sel === ":root" ? document.documentElement : document.querySelector(sel); if (!el) continue; const cs = getComputedStyle(el); for (const p of rule.style) if (p.startsWith("--") && !(p in vars)) { const v = cs.getPropertyValue(p).trim(); if (/^(#|rgb|hsl|oklch)/.test(v) || /shadow|elev|^--e\\d/.test(p)) vars[p] = v; } } } catch {} }
  return {
    body: { font: getComputedStyle(document.body).fontFamily, bg: getComputedStyle(document.body).backgroundColor, ink: getComputedStyle(document.body).color },
    heading: hs ? { font: hs.fontFamily, weight: hs.fontWeight, tracking: hs.letterSpacing, size: hs.fontSize } : null,
    button: btn ? { bg: btn.backgroundColor, ink: btn.color, radius: btn.borderTopLeftRadius, weight: btn.fontWeight } : null,
    fonts: top(fonts, 3), weights: top(weights, 4), backgrounds: top(bgs, 6), text: top(inks, 4), radii: top(radii, 4),
    cssColorVars: Object.fromEntries(Object.entries(vars).filter(([k]) => !/shadow|elev|^--e\\d/.test(k)).slice(0, 24)),
    surfaces: (() => { const out = {}; for (const sel of ['.heroSheet', '.bsheet', '.stage', 'body']) { const el = document.querySelector(sel); if (!el) continue; const st = getComputedStyle(el); if (st.backgroundImage && st.backgroundImage !== 'none') out[sel] = st.backgroundImage.slice(0, 160); else if (st.backgroundColor && st.backgroundColor !== 'rgba(0, 0, 0, 0)') out[sel] = st.backgroundColor; } return out; })(),
    dots: (() => { for (const el of document.querySelectorAll('body *')) { const st = getComputedStyle(el); if (/radial-gradient/.test(st.backgroundImage) && /px/.test(st.backgroundSize)) { const col = (/rgba?\\([^)]+\\)/.exec(st.backgroundImage) || [])[0]; return { color: col, gap: parseFloat(st.backgroundSize), selector: el.className && String(el.className).split(' ')[0] }; } } return null; })(),
    cssShadowVars: Object.fromEntries(Object.entries(vars).filter(([k]) => /shadow|elev|^--e\\d/.test(k)).slice(0, 8)),
  };
})()`) as Record<string, any>;
await browser.close();

console.log(`sampled ${url}  (screenshot: ${shot})\n`);
console.log(JSON.stringify(data, null, 2));
const px = (s?: string) => (s ? Math.round(parseFloat(s)) : 12);
const em = (ls?: string, size?: string) => (ls && ls !== "normal" && size ? +(parseFloat(ls) / parseFloat(size)).toFixed(3) : 0);
const GENERIC = /^(sans-serif|serif|system-ui|-apple-system|ui-sans-serif|monospace)$/;
const fam = (f?: string) => (f ?? "Helvetica Neue").split(",").map((s) => s.trim().replace(/["']/g, "")).filter((s) => s && !GENERIC.test(s)).concat("Helvetica Neue", "Arial", "sans-serif").filter((v, i, a) => a.indexOf(v) === i).join(", ");
// the brand colour: a named CSS variable beats whatever the first button happens to paint
const vars = data.cssColorVars as Record<string, string>;
const named = (...ks: string[]) => ks.map((k) => vars[k]).find(Boolean);
const accent = named("--accent", "--primary", "--brand", "--color-primary", "--color-accent") ?? data.button?.bg ?? data.backgrounds[1]?.value;
// which of the product's fonts can the renderer actually draw?
let installed = "";
try { installed = execFileSync("fc-list", [":", "family"], { encoding: "utf8" }).toLowerCase(); } catch { /* no fontconfig */ }
const have = (f: string) => !installed || installed.includes(f.toLowerCase());
const productFonts = [...new Set([data.heading?.font, data.body.font, ...data.fonts.map((f: { value: string }) => f.value)].filter(Boolean)
  .map((f: string) => f.split(",")[0].replace(/["']/g, "").trim()).filter((f: string) => !GENERIC.test(f)))];
console.log("\n// fonts the product renders:");
for (const f of productFonts) console.log(`//   ${have(f) ? "✓ installed     " : "✗ NOT installed — substitute the closest installed face and say so:"} ${f}`);
// the product's own fallback stacks often name an installed face already: suggest the first one
const stacks = [data.heading?.font, data.body.font].filter(Boolean) as string[];
for (const st of stacks) { const sub = st.split(",").map((x) => x.trim().replace(/["']/g, "")).find((x) => x && !GENERIC.test(x) && have(x) && installed);
  if (sub && !have(st.split(",")[0].replace(/["']/g, "").trim())) console.log(`//   → the stack "${st.slice(0, 60)}…" falls back to ${sub} (installed): a faithful substitute`); }
const sysUi = /system-ui|-apple-system/.test(stacks.join(",")); if (sysUi) console.log("//   → system-ui on this Mac renders as SF Pro (installed: SF Pro Display for titles, SF Pro Text for body)");
// the draft only names faces the renderer can draw: a missing product face is replaced by the
// installed substitute (system-ui → SF Pro Display for titles / SF Pro Text for body on macOS)
const inst = (stack: string | undefined, display: boolean) => {
  const parts = (stack ?? "").split(",").map((x) => x.trim().replace(/["']/g, "")).filter(Boolean);
  const keep = parts.filter((x) => !GENERIC.test(x) && have(x) && installed);
  const sys = /system-ui|-apple-system/.test(stack ?? "") || !keep.length;
  const lead = keep.length ? keep : sys ? [display ? "SF Pro Display" : "SF Pro Text"] : [];
  return [...new Set([...lead, "Helvetica Neue", "Arial", "sans-serif"])].join(", ");
};
const monoFace = productFonts.find((f: string) => /mono/i.test(f));
const monoDraft = monoFace ? (have(monoFace) && installed ? `${monoFace}, Menlo, monospace` : ".SF NS Mono, Menlo, monospace") : "";
const hex = (c?: string) => { const m = c && /rgba?\(([^)]+)\)/.exec(c); if (!m) return c; const [r, g, b, al] = m[1].split(/[\s,/]+/).map(Number);
  return al !== undefined && al < 1 ? c : "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""); };
console.log(`
// draft — check every value against the screenshot, then edit:
tokens: {
  font: { sans: "${inst(data.body.font, false)}", display: "${inst(data.heading?.font ?? data.body.font, true)}", displayWeight: ${+(data.heading?.weight ?? 700)}, bodyWeight: 400, tracking: ${em(data.heading?.tracking, data.heading?.size)}${monoDraft ? `, mono: "${monoDraft}"` : ""} },   // installed faces only (substitutes chosen above)
  color: { ink: "${named("--ink", "--foreground") ?? data.body.ink}", sub: "${named("--muted", "--muted-foreground") ?? data.text[1]?.value ?? data.body.ink}", accent: "${accent}", card: "${hex(named("--panel", "--card") ?? data.backgrounds.find((b: { value: string }) => b.value !== data.body.bg)?.value) ?? "#ffffff"}", cardInk: "${hex(named("--ink", "--foreground") ?? data.body.ink)}" },
  radius: ${px(data.button?.radius ?? data.radii[0]?.value)},
  motion: { in: 500, out: 400, ease: "standard", stagger: 0 },        // decide: how does the product itself move?
  transition: { type: "crossfade", ms: 500 },
  canvas: { type: "solid", color: "${hex(named("--stage", "--bg", "--background") ?? data.body.bg)}"${data.dots ? `, dots: { color: "${data.dots.color}", gap: ${Math.round(data.dots.gap * 1920 / 1440)}, size: 3 }` : ""} },   // the stage behind the recording${data.dots ? " (the product's dot grid, gap scaled to 1920; raise alpha to ~.14 so it survives encoding)" : ""}
},`);

// contrast of the draft's text colours on the product's own backgrounds (DESIGN rule 9: ≥ 4.5:1)
{
  const rgb = (c?: string): number[] | null => {
    if (!c) return null; const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (h) { const x = h[1].length === 3 ? h[1].split("").map((d) => d + d).join("") : h[1]; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); }
    const m = /rgba?\(([^)]+)\)/.exec(c); return m ? m[1].split(/[\s,/]+/).map(Number).slice(0, 3) : null;
  };
  const lum = (v: number[]) => v.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a?: string, b?: string) => { const x = rgb(a), y = rgb(b); if (!x || !y) return null; const [p, q] = [lum(x), lum(y)].sort((m, n) => n - m); return (p + 0.05) / (q + 0.05); };
  const ink = named("--ink", "--foreground") ?? data.body.ink, sub = named("--muted", "--muted-foreground") ?? data.text[1]?.value;
  const bgs: [string, string | undefined][] = [["--bg", named("--bg", "--background") ?? data.body.bg], ["--stage", vars["--stage"]], ["--panel", named("--panel", "--card")]];
  console.log("\n// contrast of the product's own text colours on its own surfaces (≥ 4.5:1 for text):");
  for (const [bn, bc] of bgs) if (bc) for (const [fn, fc] of [["ink", ink], ["muted", sub]] as const) {
    const r = ratio(fc, bc); if (r !== null) console.log(`//   ${r >= 4.5 ? "✓" : "✗"} ${fn} on ${bn} ${r.toFixed(2)}:1${r < 4.5 ? "  — keep this text off it, or darken the token one step (and say so)" : ""}`);
  }
}
