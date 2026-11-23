// flex screens: a web app's screens frozen to self-contained HTML, at each device's size and safe areas, light and dark,
// for flex mockup to frame (and a film to show). Any web app: give it the screens as URLs, or a screens.json.
//   screens.mts <screens.json | url…> [-o dir] [--device android,iphone,ipad-11,mac|all] [--theme light|dark|both]
//              [--base url] [--only name,…] [--wait ms] [--json]
// screens.json: { "base": "http://localhost:8099", "devices": ["android", "ipad-11", "mac"],
//                 "screens": [{ "name": "home", "path": "/dev/seed?signin=juma&to=/home" }, …] }
// A screen may set its status bar's glyphs, apart from its theme: "status": "light" (white glyphs: a photograph under
// the bar) or "dark", or per device ({ "android": "light", "iphone": "light" }). It goes into the frozen file as
// <meta name="flex-status">, which flex mockup honours unless --status names one for the whole run.
// A screen may list "states" ([{ "name", "label", "path", "status"?, "devices"? }]): each is frozen like a screen, as
// (its own default state named by "defaultLabel", else "Default")
// <screen>@<state>, the screen's own path being its default state. "devices" on a screen or a state limits where it is
// frozen. "numberFrom" (top level, default 1) is the review's first screen number (0: a screen 00, the app shell).
// Or "axes", states that compose: [{ "name", "label", "options": [{ "name", "label", "params" }] }] (a select, its first
// option the default) or [{ "name", "label", "toggle": true, "params" }] (off by default). Each option or toggle sets its
// "params" on the screen's path; every combination is frozen, the default one as the screen itself, the rest as
// screen@<the non-default option names and the toggles that are on, joined by +> (home@paul+offline).
// Beside the device folders: order.json (every frozen name in order) and index.json (screens, labels, states).
// Output: <dir>/<device>/<name>.<theme>.html (default dir: ~/Downloads/flex-screens/<name of the json or host>/).
//
// From KinPay's Frame Studio capture (kinpay e2e/flows/studio-freeze.ts): every stylesheet into one <style> with its
// url()s (fonts, backgrounds) inlined as data URIs, images inlined, scripts removed, the live themed DOM cloned. Added
// for apps like the NCAA mobile app's web build:
// - the page loads at the device's own size with its safe areas (Chromium's override), as flex mockup captures, so an
//   app that sizes its bars in JS (React Native web, safe-area-context) bakes the right insets in;
// - each freeze pins its colour scheme in the CSS (prefers-color-scheme blocks made unconditional or dropped), so a light
//   freeze stays light whatever the viewer's system is set to;
// - <canvas> (a WebGL map, a chart) reads back blank: each is screenshotted once its pixels stop changing, and inlined.
// It judges nothing: it freezes what it's given and says where it put each file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { DEVICES, DEVICE_KEYS, deviceFor, type Dev } from "./devices.mts";

const PIPE = process.env.FLEX_PIPELINE!;
const req = createRequire(join(PIPE, "package.json"));
const { chromium } = req("playwright");
const out = ((w) => (s: string) => w(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");

const argv = process.argv.slice(2), flag = (f: string) => argv.includes(`--${f}`);
const VALUED = ["-o", "--out", "--device", "--theme", "--base", "--only", "--wait"];
const opt = (...fs: string[]) => { for (const f of fs) { const i = argv.indexOf(f); if (i >= 0) return argv[i + 1]; } return undefined; };
const inputs = argv.filter((a, i) => !a.startsWith("-") && !(i > 0 && VALUED.includes(argv[i - 1])));
const fail = (m: string): never => { if (flag("json")) out(JSON.stringify({ ok: false, error: m })); else console.error(`!! ${m}`); process.exit(1); };
if (!inputs.length) fail("name a screens.json or URLs: flex screens <screens.json | url…> (flex screens --help)");

/* ── the screens ── */
type Status = "light" | "dark";
type Screen = { name: string; url: string; path?: string; status?: Status | Record<string, Status>; devices?: string[] };
type Axis = { name: string; label: string; toggle?: boolean; params?: Record<string, string>; options?: { name: string; label: string; params?: Record<string, string> }[] };
type Entry = { name: string; label?: string; defaultLabel?: string; axes?: { name: string; label: string; toggle: boolean; options: { name: string; label: string }[] }[]; states: { name: string; label: string }[] };
const index: Entry[] = [];
let numberFrom = 1;
let base = opt("--base"), devKeys: string[] | undefined, label = "web";
const screens: Screen[] = [];
for (const a of inputs) {
  if (/^https?:\/\//.test(a)) {
    const u = new URL(a);
    screens.push({ name: u.pathname.split("/").filter(Boolean).pop()?.replace(/\.html?$/, "") || u.hostname, url: a });
    label = u.hostname;
    continue;
  }
  const p = resolve(a);
  if (!existsSync(p)) fail(`no such file: ${a}`);
  const j = JSON.parse(readFileSync(p, "utf8"));
  base ??= j.base;
  devKeys ??= j.devices;
  label = basename(p).replace(/\.json$/, "");
  if (typeof j.numberFrom === "number") numberFrom = j.numberFrom;
  const url = (path: string) => (/^https?:/.test(path) ? path : (base ?? fail(`${a}: "${path}" is a path: give a base (in the json or --base)`)).replace(/\/$/, "") + path);
  const okStatus = (st: unknown) => st === undefined || st === "light" || st === "dark" || (typeof st === "object" && st !== null && Object.values(st).every((v) => v === "light" || v === "dark"));
  for (const s of j.screens ?? []) {
    if (!s.name || !s.path) fail(`${a}: every screen needs a name and a path`);
    if (s.name.includes("@")) fail(`${a}: "${s.name}": a screen's name can't contain @ (it separates a screen from its states)`);
    if (!okStatus(s.status)) fail(`${a}: "${s.name}" status is light, dark, or { device: light|dark }`);
    screens.push({ name: s.name, status: s.status, devices: s.devices, url: url(s.path), path: s.path });
    const entry: Entry = { name: s.name, label: s.label, defaultLabel: s.defaultLabel, states: [] };
    for (const st of s.states ?? []) {
      // a state without a path of its own opens at its screen's (its setup, storage or actions make it the state)
      if (!st.name) fail(`${a}: every state of "${s.name}" needs a name`);
      const sp: string = st.path ?? s.path;
      if (!okStatus(st.status)) fail(`${a}: "${s.name}@${st.name}" status is light, dark, or { device: light|dark }`);
      screens.push({ name: `${s.name}@${st.name}`, status: st.status ?? s.status, devices: st.devices ?? s.devices, url: url(sp), path: sp });
      entry.states.push({ name: st.name, label: st.label ?? st.name });
    }
    const axes: Axis[] = s.axes ?? [];
    if (axes.length) {
      const seen = new Set<string>();
      for (const ax of axes) {
        if (!ax.name || !ax.label) fail(`${a}: every axis of "${s.name}" needs a name and a label`);
        if (!ax.toggle && !ax.options?.length) fail(`${a}: axis "${ax.name}" of "${s.name}" is a toggle ("toggle": true) or has options`);
        for (const n of ax.toggle ? [ax.name] : ax.options!.map((o) => o.name)) {
          if (seen.has(n) || n.includes("+") || n.includes("@")) fail(`${a}: "${s.name}": "${n}" must be unique across its axes, without + or @`);
          seen.add(n);
        }
      }
      // a param set on the path, replaced where it is already there
      const withParams = (path: string, ps: Record<string, string>) => Object.entries(ps).reduce((u, [k, v]) => {
        const re = new RegExp(`([?&])${k}=[^&]*`);
        return re.test(u) ? u.replace(re, `$1${k}=${v}`) : u.replace("?", `?${k}=${v}&`);
      }, path);
      const combos = axes.reduce<number[][]>((acc, ax) => acc.flatMap((c) => (ax.toggle ? [0, 1] : ax.options!.map((_, i) => i)).map((v) => [...c, v])), [[]]);
      const labelOf = (c: number[]) => axes.flatMap((ax, i) => (ax.toggle ? (c[i] ? [ax.label] : []) : [ax.options![c[i]].label])).join(" · ");
      entry.defaultLabel = labelOf(combos[0]);
      entry.axes = axes.map((ax) => ({ name: ax.name, label: ax.label, toggle: !!ax.toggle, options: ax.toggle ? [] : ax.options!.map((o) => ({ name: o.name, label: o.label })) }));
      for (const c of combos.slice(1)) {
        const name = axes.flatMap((ax, i) => (ax.toggle ? (c[i] ? [ax.name] : []) : c[i] ? [ax.options![c[i]].name] : [])).join("+");
        const params = Object.assign({}, ...axes.map((ax, i) => (ax.toggle ? (c[i] ? ax.params ?? {} : {}) : ax.options![c[i]].params ?? {})));
        screens.push({ name: `${s.name}@${name}`, status: s.status, devices: s.devices, url: url(withParams(s.path, params)), path: withParams(s.path, params) });
        entry.states.push({ name, label: labelOf(c) });
      }
    }
    index.push(entry);
  }
}
const only = opt("--only")?.split(",").filter(Boolean);
// --only names a screen (its states come with it) or one state (screen@state)
const picked = only ? screens.filter((s) => only.includes(s.name) || only.includes(s.name.split("@")[0])) : screens;
if (!picked.length) fail(only ? `no screen named ${only.join(", ")}` : "no screens");
const keys = opt("--device") ?? (devKeys?.join(",") || "iphone");
const devices: Dev[] = (keys === "all" ? Object.keys(DEVICES) : keys.split(",").map((k) => k.trim()).filter(Boolean)).map((k) => {
  return deviceFor(k) ?? fail(`no device "${k}" (${DEVICE_KEYS.join(", ")}, or all)`);
});
const themeArg = opt("--theme") ?? "both";
const themes = themeArg === "both" ? ["light", "dark"] : [themeArg];
if (themes.some((t) => t !== "light" && t !== "dark")) fail(`--theme is light, dark or both`);
const wait = +(opt("--wait") ?? 2500);
const outDir = resolve(opt("-o", "--out") ?? join(homedir(), "Downloads", "flex-screens", label));

/* ── freezing one page ── */
async function freeze(page: any, theme: string, shots: Record<string, string>): Promise<string> {
  // tsx/esbuild's keepNames wraps named functions in __name, which the page world lacks
  await page.evaluate("globalThis.__name = globalThis.__name || function (f) { return f; };");
  return page.evaluate(async ({ theme, shots }: { theme: string; shots: Record<string, string> }) => {
    const toAbs = (u: string) => { try { return new URL(u, location.href).href; } catch { return u; } };
    const dataUri = async (u: string): Promise<string | null> => {
      try {
        const res = await fetch(toAbs(u));
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
      } catch { return null; }
    };
    const chunks: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try { chunks.push(Array.from(sheet.cssRules).map((r) => r.cssText).join("\n")); }
      catch { if (sheet.href) { try { chunks.push(await (await fetch(sheet.href)).text()); } catch { /* skip */ } } }
    }
    let css = chunks.join("\n");
    // this freeze's scheme, unconditionally
    css = css.replace(/@media\s*\(prefers-color-scheme:\s*dark\)/g, theme === "dark" ? "@media all" : "@media not all")
      .replace(/@media\s*\(prefers-color-scheme:\s*light\)/g, theme === "light" ? "@media all" : "@media not all");
    const urlRe = /url\((['"]?)([^'")]+)\1\)/g, urls = new Set<string>();
    for (const m of css.matchAll(urlRe)) if (!m[2].startsWith("data:")) urls.add(m[2]);
    const map = new Map<string, string>();
    await Promise.all([...urls].map(async (u) => { const d = await dataUri(u); if (d) map.set(u, d); }));
    css = css.replace(urlRe, (full, _q, u) => (map.has(u) ? `url("${map.get(u)}")` : full));
    const doc = document.cloneNode(true) as Document;
    doc.querySelectorAll("script").forEach((s) => s.remove());
    // the styles are inlined below; preloads (Expo's export preloads its CSS) would only miss once the page is a file
    doc.querySelectorAll('link[rel="stylesheet"], link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"], style').forEach((s) => s.remove());
    const style = doc.createElement("style");
    style.textContent = `:root{color-scheme:${theme}}\n` + css;
    doc.head.appendChild(style);
    const live = Array.from(document.images), clones = Array.from(doc.images);
    await Promise.all(live.map(async (img, i) => {
      const ci = clones[i], src = img.currentSrc || img.src;
      if (!ci || !src || src.startsWith("data:")) return;
      const d = await dataUri(src);
      if (d) { ci.setAttribute("src", d); ci.removeAttribute("srcset"); }
    }));
    const lc = Array.from(document.querySelectorAll("canvas")), cc = Array.from(doc.querySelectorAll("canvas"));
    lc.forEach((cv, i) => {
      const c = cc[i], shot = shots[cv.getAttribute("data-flex-freeze") ?? ""];
      if (!c || !shot) return;
      const img = doc.createElement("img");
      img.setAttribute("src", shot);
      img.setAttribute("style", (c.getAttribute("style") ?? "") + `;width:${cv.clientWidth}px;height:${cv.clientHeight}px`);
      const cl = c.getAttribute("class"); if (cl) img.setAttribute("class", cl);
      c.replaceWith(img);
    });
    return "<!doctype html>\n" + doc.documentElement.outerHTML;
  }, { theme, shots });
}

/* a flat canvas (one colour: a map whose style or tiles haven't arrived yet) isn't settled, however long it holds */
const sharp = req("sharp");
async function flat(png: Buffer): Promise<boolean> {
  const st = await sharp(png).stats();
  return st.channels.slice(0, 3).every((ch: { stdev: number }) => ch.stdev < 3);
}
/* a canvas once its pixels stop changing and show something (a map's tiles arriving), at most 12 s */
async function settledShot(c: any): Promise<string | null> {
  // tiles arrive in bursts: the network quiet first, then the same picture three times running
  await c.page().waitForLoadState("networkidle").catch(() => {});
  let last: Buffer | null = null, same = 0;
  for (let i = 0; i < 24; i++) {
    const shot: Buffer = await c.screenshot().catch(() => null);
    if (!shot) return null;
    same = last && shot.equals(last) ? same + 1 : 0;
    if (same >= 2 && !(await flat(shot))) return "data:image/png;base64," + shot.toString("base64");
    last = shot;
    await c.page().waitForTimeout(500);
  }
  return last ? "data:image/png;base64," + last.toString("base64") : null;
}

// the screens' order as listed (all of them, whatever --only picks), for flex mockup and its review page
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "order.json"), JSON.stringify(screens.map((s) => s.name), null, 1) + "\n");
// links: each frozen name's path as listed (a live canvas loads it on the app's own site), its status-bar ask and devices
const links = Object.fromEntries(screens.map((s) => [s.name, { path: s.path ?? s.url, status: s.status, devices: s.devices }]));
writeFileSync(join(outDir, "index.json"), JSON.stringify({ numberFrom, devices: devices.map((d) => d.key), themes, links, screens: index.length ? index : screens.map((s) => ({ name: s.name, states: [] })) }, null, 1) + "\n");
// --index-only: the index and order alone (flex mockup --canvas builds a live canvas from them), nothing frozen
if (flag("index-only")) { if (!flag("json")) out(`index of ${screens.length} screens in ${outDir}`); else out(JSON.stringify({ ok: true, dir: outDir, screens: screens.length })); process.exit(0); }

const browser = await chromium.launch();
const made: { screen: string; device: string; theme: string; file: string; url: string; canvases: number; errors: string[] }[] = [];
for (const d of devices) {
  mkdirSync(join(outDir, d.key), { recursive: true });
  for (const theme of themes) for (const s of picked.filter((x) => !x.devices || x.devices.includes(d.key))) {
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.scale, colorScheme: theme as "light" | "dark", isMobile: d.touch, hasTouch: d.touch });
    const page = await ctx.newPage();
    if (d.touch) {
      try { await (await ctx.newCDPSession(page)).send("Emulation.setSafeAreaInsetsOverride", { insets: { top: d.top, bottom: d.bottom, left: 0, right: 0 } }); }
      catch { /* an older Chromium: the page lays out without insets */ }
    }
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e.message).slice(0, 160)));
    await page.goto(s.url, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(wait); // a seed link's own navigation, then the screen's first fetches
    await page.evaluate(() => (document as any).fonts?.ready);
    await page.waitForLoadState("networkidle").catch(() => {});
    const n = await page.locator("canvas").count(), shots: Record<string, string> = {};
    for (let i = 0; i < n; i++) {
      const c = page.locator("canvas").nth(i);
      await c.evaluate((el: Element, k: number) => el.setAttribute("data-flex-freeze", String(k)), i);
      if (!(await c.isVisible())) continue;
      const shot = await settledShot(c);
      if (shot) shots[i] = shot;
    }
    let html = await freeze(page, theme, shots);
    const status = typeof s.status === "object" ? s.status[d.key] : s.status;
    if (status) html = html.replace(/<head([^>]*)>/i, `<head$1><meta name="flex-status" content="${status}">`);
    const file = join(outDir, d.key, `${s.name}.${theme}.html`);
    writeFileSync(file, html);
    made.push({ screen: s.name, device: d.key, theme, file, url: page.url(), canvases: n, errors });
    if (!flag("json")) out(`  ${d.key}/${s.name}.${theme}.html  (${d.label}, ${theme}, ${(html.length / 1e6).toFixed(1)} MB${n ? `, ${n} canvas` : ""}${errors.length ? `, page errors: ${[...new Set(errors)].join(" | ")}` : ""})`);
    await ctx.close();
  }
}
await browser.close();
if (flag("json")) out(JSON.stringify({ ok: true, dir: outDir, freezes: made }));
else out(`${made.length} screen${made.length === 1 ? "" : "s"} frozen into ${outDir}  ·  next: flex mockup ${outDir}/<device> --device <device>  (each file is framed in its own theme)`);
