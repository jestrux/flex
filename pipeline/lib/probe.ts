// npm run probe -- <url> [--name <your-video>] [--click <sel>]… [--fill <sel>=<text>]… [--scroll <sel>=<dy>]… [--key <Key>]… [--shot <name>]… [--rect <sel>]… [--text <substring>]… [--wait <sel>] [--all]
// Explore an app in your own fresh browser at the capture viewport (1440×810, 2×), without the
// shared /browse session: run a few steps, then list the visible interactive elements with
// selector hints, print element rects (what c.focus / c.keepClear would get), and save a
// screenshot to build/probe/. Steps run in order; a missing selector is an error. In --fill/--scroll
// the value follows the first "=" after the selector's last "]" (so attribute selectors are fine).
// --shot <name> saves a screenshot at that point (several states in one run; with any --shot there's no
// extra final screenshot — add a last --shot for the end state). --fill on a <select>
// picks the option with that label (or value).
//   npm run probe -- http://localhost:5191 --click '[data-mode-btn="Grid"]' --rect aside --rect '.stage .bsheet'
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { VIEWPORT } from "./capture.ts";

const a = process.argv.slice(2), url = a[0];
if (!url || url.startsWith("--")) { console.error("usage: npm run probe -- <url> [--click sel]… [--fill sel=text]… [--rect sel]… [--wait sel] [--all]"); process.exit(1); }
const steps: [string, string][] = [];
let tag = "probe";
for (let i = 1; i < a.length; i++) if (a[i] === "--name") tag = a[++i]; else if (a[i].startsWith("--") && a[i] !== "--all") steps.push([a[i].slice(2), a[++i]]);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h }, deviceScaleFactor: 2 });
const out = join(process.env.FLEX_WORK ?? join(import.meta.dirname, ".."), "build", "probe"); mkdirSync(out, { recursive: true });
try {
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(500);
  for (const [k, v] of steps) {
    if (k === "wait") await page.locator(v).first().waitFor({ timeout: 15_000 });
    else if (k === "click") { await page.locator(v).first().click({ timeout: 8_000 }); await page.waitForTimeout(500); console.log(`· clicked ${v}`); }
    else if (k === "fill" || k === "scroll") {
      const eq = v.indexOf("=", v.lastIndexOf("]") + 1), sel = v.slice(0, eq), val = v.slice(eq + 1);
      if (eq < 0) throw new Error(`--${k} needs <selector>=<value>`);
      if (k === "fill") { const l = page.locator(sel).first();
        if ((await l.evaluate((el) => el.tagName).catch(() => "")) === "SELECT") await l.selectOption({ label: val }).catch(() => l.selectOption(val)); else await l.fill(val, { timeout: 8_000 }); console.log(`· filled ${sel}`); }
      else { await page.locator(sel).first().evaluate((el, dy) => el.scrollBy(0, Number(dy)), val); console.log(`· scrolled ${sel} by ${val}`); }
      await page.waitForTimeout(350);
    }
    else if (k === "text") { // where is some visible text (not just controls)? prints the element, its selector hints and rect
      const hits = await page.evaluate(`(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) if (n.textContent.includes(${JSON.stringify(v)})) { const el = n.parentElement, r = el.getBoundingClientRect(); if (r.width > 1)
          out.push(el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(/\\s+/).slice(0, 3).join(".") : "") + "  " + [...el.attributes].filter((a) => /^(data-|aria-|title|id)/.test(a.name)).map((a) => a.name + '="' + a.value + '"').join(" ") + "  [" + [r.x, r.y, r.width, r.height].map(Math.round).join(" ") + "]"); }
        return out.slice(0, 12); })()`) as string[];
      console.log(`· text "${v}": ${hits.length ? "\n    " + hits.join("\n    ") : "not found"}`);
    }
    else if (k === "key") { await page.keyboard.press(v); await page.waitForTimeout(300); console.log(`· pressed ${v}`); }
    else if (k === "shot") { const f = join(out, `${tag === "probe" ? "" : tag + "-"}${v.replace(/[^\w-]+/g, "_")}.png`); await page.screenshot({ path: f }); console.log(`· shot → ${f}`); }
    else if (k === "rect") {
      const r = await page.locator(v).first().boundingBox({ timeout: 2000 }).catch(() => null);
      console.log(`▭ ${v}: ${r ? `{ x: ${Math.round(r.x)}, y: ${Math.round(r.y)}, w: ${Math.round(r.width)}, h: ${Math.round(r.height)} }` : "not found / not visible"}`);
    } else throw new Error(`unknown step --${k}`);
  }
  // visible interactive elements with the attributes you can select on (a string: no tsx __name in the page)
  const all = a.includes("--all");
  const rows = await page.evaluate(`(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    const sel = "button, a[href], input, textarea, select, [role=button], [role=tab], [role=radio], [role=switch], [data-mode-btn], [contenteditable=true]" + (${all} ? ", [data-row], [data-cell], [data-screen]" : "");
    return [...document.querySelectorAll(sel)].filter(vis).slice(0, 160).map((el) => {
      const r = el.getBoundingClientRect(), at = {};
      for (const n of el.getAttributeNames()) if (/^(id|name|title|aria-label|role|type|placeholder)$/.test(n) || n.startsWith("data-")) at[n] = el.getAttribute(n);
      const text = (el.innerText || el.value || "").trim().replace(/\\s+/g, " ").slice(0, 40);
      return { tag: el.tagName.toLowerCase(), text, at, cls: (el.className && el.className.baseVal === undefined ? String(el.className) : "").split(/\\s+/).filter((c) => !/[:\\[]/.test(c)).slice(0, 3).join("."), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    });
  })()`) as { tag: string; text: string; at: Record<string, string>; cls: string; rect: number[] }[];
  console.log(`\n${rows.length} visible interactive elements (tag · text · attributes · [x y w h]):`);
  for (const r of rows) console.log(`  ${r.tag}${r.cls ? "." + r.cls : ""}  "${r.text}"  ${Object.entries(r.at).map(([k, v]) => `${k}="${v}"`).join(" ")}  [${r.rect.join(" ")}]`);
  if (!steps.some(([k]) => k === "shot")) { // a final screenshot only when you didn't name any
    const shot = join(out, `${tag}-final.png`); // --name <your-video> keeps your files apart
    await page.screenshot({ path: shot });
    console.log(`\nscreenshot → ${shot}`);
  }
} finally { await browser.close(); }
