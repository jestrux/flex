// flex mockup: screens in device frames (server/devices/*.css, CSS only, drawn at any scale), as PNGs: Apple (iPhone,
// iPad, Mac), Android (phone, tablet), Windows (laptop) and app windows (Windows, Mac, plain), from KinPay's Frame Studio.
// An input is a page (an .html file or a URL), captured at the device's own size with its safe areas, light or dark;
// or a screenshot (.png / .jpg) placed as it is; or a folder of either (its .html files, else its images).
//   mockup.mts <input>… [-o dir] [--device iphone,android,…|all] [--theme light|dark|both] [--finish f,…|all]
//              [--style frame|bare|outline|all] [--landscape] [--no-notch] [--title t] [--bar-color css|none]
//              [--status auto|light|dark|none] [--bg transparent|#hex] [--shadow] [--scale n] [--sheet] [--json]
// It measures nothing and judges nothing: it frames what it's given, and says where it put it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { reviewPage, type ReviewRow } from "./review.mts";
import { embedFiles } from "./embed.mts";
import { DEVICES, DEVICE_KEYS, FINISHES, STYLES, deviceFor, type Dev, type Family } from "./devices.mts";

const PIPE = process.env.FLEX_PIPELINE!;
const req = createRequire(join(PIPE, "package.json"));
const { chromium } = req("playwright");
const sharp = req("sharp");
const HERE = dirname(fileURLToPath(import.meta.url));
const out = ((w) => (s: string) => w(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");

const argv = process.argv.slice(2), flag = (f: string) => argv.includes(`--${f}`);
const VALUED = ["-o", "--out", "--device", "--theme", "--finish", "--style", "--title", "--bar-color", "--status", "--bg", "--scale", "--wait", "--notes", "--logo", "--product"];
const opt = (...fs: string[]) => { for (const f of fs) { const i = argv.indexOf(f); if (i >= 0) return argv[i + 1]; } return undefined; };
const inputs = argv.filter((a, i) => !a.startsWith("-") && !(i > 0 && VALUED.includes(argv[i - 1])));
const fail = (m: string): never => { if (flag("json")) out(JSON.stringify({ ok: false, error: m })); else console.error(`!! ${m}`); process.exit(1); };
// --overlays -o <dir>: a handheld's parts as transparent PNGs, for painting a phone take or a screen recording in a film
// (the pipeline's phoneLayers and recordingLayers, patches 22 and 27) in the same device `flex mockup` frames screens in:
// the device with its screen cut out (device.png; the iPhone's Dynamic Island put back), the status bar alone with white or
// black glyphs (status-light.png / status-dark.png), Android's gesture pill (nav-light.png / nav-dark.png), and frame.json
// { device, scale, pad, side, screen: { w, h, r }, bars: { top, bottom }, finishes } in points. The iPhone's parts sit in
// <dir> itself (the layout patch 22 reads); every other device's in <dir>/<device>/, a body per finish (device-<finish>.png).
// Flex builds them once into its support folder.
if (flag("overlays")) {
  const ROOT = resolve(opt("-o", "--out") ?? "."), PAD = 12;
  type Part = { key: string; file: string; fig: string; scale: number; side: number; screen: { w: number; h: number; r: number }; bars: { top: number; bottom: number };
    finishes: string[]; finishCls: (f: string) => string; status: (dark: boolean) => string; nav?: (dark: boolean) => string; island?: boolean };
  const PARTS: Part[] = [
    { key: "iphone", file: "iphone", fig: "iphone iphone--pro", scale: 3, side: 18, screen: { w: 402, h: 874, r: 60 }, bars: { top: 62, bottom: 34 }, finishes: ["black"], finishCls: () => "iphone--black",
      status: (d) => `<div class="iphone__status${d ? " iphone__status--dark" : ""}">9:41</div>`, island: true },
    { key: "android", file: "android", fig: "android", scale: 3, side: 14, screen: { w: 412, h: 915, r: 40 }, bars: { top: 28, bottom: 24 }, finishes: ["graphite", "porcelain", "sage"],
      finishCls: (f) => (f === "graphite" ? "" : `android--${f}`), status: (d) => `<div class="android__status${d ? " android__status--dark" : ""}">10:30</div>`,
      nav: (d) => `<div class="android__nav${d ? " android__nav--dark" : ""}"></div>` },
    { key: "android-tablet", file: "android", fig: "android android--tablet", scale: 2, side: 40, screen: { w: 800, h: 1280, r: 24 }, bars: { top: 28, bottom: 24 }, finishes: ["graphite", "porcelain", "sage"],
      finishCls: (f) => (f === "graphite" ? "" : `android--${f}`), status: (d) => `<div class="android__status${d ? " android__status--dark" : ""}">10:30</div>`,
      nav: (d) => `<div class="android__nav${d ? " android__nav--dark" : ""}"></div>` },
  ];
  const browser = await chromium.launch();
  for (const P of PARTS) {
    const OUT = P.key === "iphone" ? ROOT : join(ROOT, P.key), SCALE = P.scale, SIDE = P.side, SCREEN = P.screen;
    mkdirSync(OUT, { recursive: true });
    const css = readFileSync(join(HERE, "devices", `${P.file}-frame.css`), "utf8"), base = P.fig.split(" ")[0];
    const page = (fin: string, inner: string, extra = "") => `<!doctype html><meta charset="utf-8"><style>${css}
html,body{margin:0;background:transparent} .${base}__screen{background:transparent} ${extra}</style>
<div class="stage" style="display:inline-block;padding:${PAD}px"><figure class="${P.fig} ${P.finishCls(fin)}" style="margin:0">${inner}</figure></div>`;
    // just the bars: no body, no bezel, no camera
    const bare = `.${base}{background:none;box-shadow:none}.${base}::before,.${base}::after{display:none}`;
    const p = await (await browser.newContext({ viewport: { width: SCREEN.w + 200, height: SCREEN.h + 200 }, deviceScaleFactor: SCALE })).newPage();
    const shot = async (html: string, file: string) => { await p.setContent(html, { waitUntil: "load" }); await p.locator(".stage").screenshot({ path: join(OUT, file), omitBackground: true }); };
    const at = (v: number) => v * SCALE, IN = PAD + SIDE;
    // the bezel runs under the screen: cut the screen's rounded rect out of it (and put the iPhone's island back over the hole)
    const hole = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${at(SCREEN.w + 2 * IN)}" height="${at(SCREEN.h + 2 * IN)}"><rect x="${at(IN)}" y="${at(IN)}" width="${at(SCREEN.w)}" height="${at(SCREEN.h)}" rx="${at(SCREEN.r)}" fill="#000"/></svg>`);
    for (const fin of P.finishes) {
      await shot(page(fin, `<div class="${base}__screen"></div><span class="${base}__buttons" aria-hidden="true"></span>`), "frame-solid.png");
      const cut = await sharp(join(OUT, "frame-solid.png")).composite([{ input: hole, blend: "dest-out" }]).png().toBuffer();
      const name = P.key === "iphone" ? "device.png" : `device-${fin}.png`;
      if (P.island) {
        await shot(page(fin, `<div class="${base}__screen"></div>`, `.${base}{background:none;box-shadow:none}.${base}::before{display:none}`), "island.png");
        await sharp(cut).composite([{ input: join(OUT, "island.png") }]).png().toFile(join(OUT, name));
      } else {
        // Android's camera hole is the figure's ::after, drawn over the screen: it stays its own part (camera.png), so a
        // film can leave it off (recordingLayers' camera: false)
        await sharp(cut).png().toFile(join(OUT, name));
        await shot(page(fin, `<div class="${base}__screen"></div>`, `.${base}{background:none;box-shadow:none}.${base}::before{display:none}`), "camera.png");
      }
    }
    if (P.key !== "iphone") await sharp(join(OUT, `device-${P.finishes[0]}.png`)).toFile(join(OUT, "device.png")); // the default finish under the plain name
    await shot(page(P.finishes[0], `<div class="${base}__screen">${P.status(false)}</div>`, bare), "status-light.png");
    await shot(page(P.finishes[0], `<div class="${base}__screen">${P.status(true)}</div>`, bare), "status-dark.png");
    if (P.nav) {
      await shot(page(P.finishes[0], `<div class="${base}__screen">${P.nav(false)}</div>`, bare), "nav-light.png");
      await shot(page(P.finishes[0], `<div class="${base}__screen">${P.nav(true)}</div>`, bare), "nav-dark.png");
    }
    await p.context().close();
    writeFileSync(join(OUT, "frame.json"), JSON.stringify({ device: P.key, scale: SCALE, pad: PAD, side: SIDE, screen: SCREEN, bars: P.bars, finishes: P.finishes }, null, 1) + "\n");
  }
  await browser.close();
  out(flag("json") ? JSON.stringify({ ok: true, dir: ROOT, devices: PARTS.map((P) => P.key) }) : `device overlays → ${ROOT} (${PARTS.map((P) => P.key).join(", ")})`);
  process.exit(0);
}
if (!inputs.length) fail("name a page, a screenshot or a folder: flex mockup <input>… (flex mockup --help)");

/* ── the inputs ── */
/* a frozen screen (flex screens) is named <screen>.<light|dark>.html: it is framed in its own theme only, under its screen name */
type In = { kind: "page" | "image"; src: string; name: string; theme?: "light" | "dark"; device?: string };
const IMG = /\.(png|jpe?g|webp)$/i;
/** flex screens' index.json (screens in order, their labels and states, the first number), when the input is its folder */
let screensIndex: { numberFrom?: number; screens: { name: string; label?: string; defaultLabel?: string; states: { name: string; label: string }[] }[] } | null = null;
const expand = (a: string): In[] => {
  if (/^https?:\/\//.test(a)) return [{ kind: "page", src: a, name: new URL(a).pathname.split("/").filter(Boolean).pop()?.replace(/\.html?$/, "") || new URL(a).hostname }];
  const p = resolve(a);
  if (!existsSync(p)) fail(`no such file or folder: ${a}`);
  if (statSync(p).isDirectory()) {
    const names = readdirSync(p).sort();
    // flex screens' layout: <dir>/<device>/<screen>.<theme>.html
    const devDirs = names.filter((n) => deviceFor(n) && statSync(join(p, n)).isDirectory());
    if (devDirs.length) {
      // flex screens' order.json: the screens in the order they were listed (else alphabetical)
      const order: string[] = existsSync(join(p, "order.json")) ? JSON.parse(readFileSync(join(p, "order.json"), "utf8")) : [];
      if (existsSync(join(p, "index.json"))) screensIndex = JSON.parse(readFileSync(join(p, "index.json"), "utf8"));
      const at = (n: string) => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
      return devDirs.flatMap((k) => expand(join(p, k)).map((it) => ({ ...it, device: k }))).sort((a, b) => at(a.name) - at(b.name));
    }
    const pages = names.filter((n) => /\.html?$/i.test(n));
    const pick = pages.length ? pages : names.filter((n) => IMG.test(n));
    if (!pick.length) fail(`${a}: no .html pages or images in it`);
    return pick.flatMap((n) => expand(join(p, n)));
  }
  if (/\.html?$/i.test(p)) {
    const name = basename(p).replace(/\.html?$/i, ""), frozen = name.match(/^(.+)\.(light|dark)$/);
    return [frozen ? { kind: "page", src: pathToFileURL(p).href, name: frozen[1], theme: frozen[2] as "light" | "dark" } : { kind: "page", src: pathToFileURL(p).href, name }];
  }
  if (IMG.test(p)) return [{ kind: "image", src: p, name: basename(p, extname(p)) }];
  return fail(`${a}: not a page (.html, a URL) or a screenshot (.png, .jpg)`);
};
/* ── --canvas <base>: a live screen canvas, from a flex screens folder's index (screens --index-only), nothing captured.
   The review page, its device frames running the app itself at each screen's link on <base> (a path on the same site,
   or a URL), written as <out>/index.html. Each frame's link asks the app for its theme (scheme=) and, on a phone or
   tablet, its safe areas (insets=top,bottom: inside a frame the browser reports none); a Mac or PC frame places the page
   between its bars instead. --notes <flow> turns on the page's notes (pins on frames, a list, Send: flex review serves
   the page and keeps them); --logo <svg|png> and --product <name> are the product's logo and name on its top bar. ── */
const logoUri = (f?: string) => f && existsSync(f) ? `data:${/\.svg$/i.test(f) ? "image/svg+xml" : "image/png"};base64,${readFileSync(f).toString("base64")}` : null;
if (opt("--canvas") !== undefined) {
  const base = opt("--canvas")!.replace(/\/$/, "");
  const dir = resolve(inputs[0] ?? fail("--canvas reads a flex screens folder (its index.json)"));
  const idxFile = join(dir, "index.json");
  if (!existsSync(idxFile)) fail(`${dir}: no index.json (flex screens <list> -o ${dir} --index-only writes one)`);
  const idx = JSON.parse(readFileSync(idxFile, "utf8"));
  if (!idx.links) fail(`${idxFile}: no links (re-run flex screens to write them)`);
  const order: string[] = existsSync(join(dir, "order.json")) ? JSON.parse(readFileSync(join(dir, "order.json"), "utf8")) : Object.keys(idx.links);
  const devs = ((opt("--device")?.split(",") ?? idx.devices ?? ["iphone"]) as string[]).map((k) => deviceFor(k.trim()) ?? fail(`no device "${k}"`));
  const ths: string[] = opt("--theme") ? (opt("--theme") === "both" ? ["light", "dark"] : [opt("--theme")!]) : idx.themes ?? ["light", "dark"];
  const cssOf: Record<string, string> = { iphone: "iphone", ipad: "ipad", mac: "mac", android: "android", pc: "pc", win: "window", macwin: "window", plainwin: "window" };
  const frames: Record<string, string> = {};
  const rows: ReviewRow[] = [];
  const link = (p: string) => (/^https?:/.test(p) ? p : base + p);
  for (const name of order) {
    const l = idx.links[name];
    if (!l) continue;
    for (const d of devs) {
      if (l.devices && !l.devices.includes(d.key)) continue;
      for (const theme of ths) {
        // the status bar's glyphs: the list's own ask, else dark over a light screen and light over a dark one
        const asked = typeof l.status === "object" ? l.status?.[d.key] : l.status;
        const status = asked ?? (theme === "light" ? "dark" : "light");
        const key = `${d.key}|${status}`;
        const v = { finish: FINISHES[d.family][0], style: "frame" };
        if (!frames[key]) {
          const win = d.touch
            ? '<iframe src="__SRC__" title="" loading="lazy" style="display:block;width:100%;height:100%;border:0;background:#fff"></iframe>'
            : `<iframe src="__SRC__" title="" loading="lazy" style="position:absolute;left:0;right:0;top:${d.top}px;height:calc(100% - ${d.top + d.bottom}px);width:100%;border:0;background:#fff"></iframe>`;
          frames[key] = figure(d, "__SRC__", status, v, name, null, status === "dark").replace('<img src="__SRC__" alt="">', win);
          frames[key + "#bare"] = bareFrame(d, d.touch);
        }
        const sep = l.path.includes("?") ? "&" : "?";
        rows.push({ file: "", screen: name, device: d.label, key: d.key, theme, finish: v.finish, status, scale: 1, page: null, frame: key,
          href: link(l.path) + `${sep}scheme=${theme}` + (d.touch ? `&insets=${d.top},${d.bottom}` : "") });
      }
    }
  }
  const css = [...new Set(devs.map((d) => d.family))].map((f) => readFileSync(join(HERE, "devices", `${cssOf[f]}-frame.css`), "utf8")).join("\n");
  const to = resolve(opt("-o", "--out") ?? join(homedir(), "Downloads", "flex-canvas", basename(dir)));
  mkdirSync(to, { recursive: true });
  writeFileSync(join(to, "index.html"), reviewPage(rows, opt("--title") ?? basename(dir), { frames, css, index: idx, canvas: true, notes: opt("--notes") ? { flow: opt("--notes")!, logo: logoUri(opt("--logo")), name: opt("--product") } : undefined }));
  if (flag("json")) out(JSON.stringify({ ok: true, dir: to, frames: rows.length }));
  else out(`screen canvas: ${rows.length} frames (${devs.length} devices, ${ths.join(" and ")}) in ${join(to, "index.html")}`);
  process.exit(0);
}
const items = inputs.flatMap(expand);

/* ── the devices: their screen in points, safe areas (the bars over the screen), figure class ── */
const landscape = flag("landscape");
/* a flex screens folder (one subfolder per device) frames each subfolder in its own device, unless --device names some */
const ownDevices = () => [...new Set(items.map((it) => it.device).filter(Boolean))] as string[];
const keys = opt("--device") ?? (ownDevices().join(",") || "iphone");
const devices: Dev[] = (keys === "all" ? Object.keys(DEVICES) : keys.split(",").map((k) => k.trim()).filter(Boolean)).map((k) => {
  return deviceFor(k, landscape) ?? fail(`no device "${k}" (${DEVICE_KEYS.join(", ")}, or all)`);
});
const finishArg = opt("--finish"), styleArg = opt("--style");
/* the finishes and styles to render a device in: what was asked that the family has (a finish another family has is
   skipped for this one, so --device all --finish silver gives every device that comes in silver) */
const variants = (d: Dev): { finish: string; style: string }[] => {
  const fins = finishArg === "all" ? FINISHES[d.family] : finishArg ? finishArg.split(",").filter((f) => FINISHES[d.family].includes(f)) : [FINISHES[d.family][0]];
  const sts = styleArg === "all" ? STYLES[d.family] : styleArg ? styleArg.split(",").filter((t) => STYLES[d.family].includes(t)) : ["frame"];
  // a plain frame has no finish: render it once
  return sts.flatMap((style) => style === "frame" ? fins.map((finish) => ({ finish, style })) : [{ finish: FINISHES[d.family][0], style }]);
};
for (const d of devices) if (!variants(d).length) fail(`${d.label} has no ${[finishArg && `finish "${finishArg}"`, styleArg && `style "${styleArg}"`].filter(Boolean).join(" or ")} (finishes: ${FINISHES[d.family].join(", ")}; styles: ${STYLES[d.family].join(", ")})`);
const many = devices.some((d) => variants(d).length > 1);
const themeArg = opt("--theme") ?? "light";
const themes = themeArg === "both" ? ["light", "dark"] : [themeArg];
if (themes.some((t) => t !== "light" && t !== "dark")) fail(`--theme is light, dark or both`);
const statusArg = opt("--status") ?? "auto";
/* the band under a handheld's status bar: --bar-color <css> paints it, none leaves the page as it draws itself; by default a
   page's <meta name="theme-color"> (for the scheme) paints it, as a phone's browser does */
const barArg = opt("--bar-color");
/** is a CSS colour light (dark glyphs over it)? #rgb, #rrggbb, rgb()/rgba(); anything else counts as light */
const lightColour = (c: string) => {
  let rgb: number[] | null = null;
  const m = c.match(/rgba?\(([^)]+)\)/), h = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) rgb = m[1].split(/[ ,/]+/).slice(0, 3).map(Number);
  else if (h) { const x = h[1].length === 3 ? h[1].split("").map((ch) => ch + ch).join("") : h[1]; const n = parseInt(x, 16); rgb = [n >> 16, (n >> 8) & 255, n & 255]; }
  return !rgb || 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 150;
};
const bg = opt("--bg") ?? "transparent";
const scaleArg = opt("--scale");
const wait = +(opt("--wait") ?? 400);

const first = resolve(inputs[0]);
const outDir = resolve(opt("-o", "--out") ?? join(homedir(), "Downloads", "flex-mockups", /^https?:/.test(inputs[0]) ? "web" : basename(existsSync(first) && statSync(first).isDirectory() ? first : dirname(first))));
mkdirSync(outDir, { recursive: true });

const CSSFILE: Record<Family, string> = { iphone: "iphone", ipad: "ipad", mac: "mac", android: "android", pc: "pc", win: "window", macwin: "window", plainwin: "window" };
const css = Object.fromEntries(Object.entries(CSSFILE).map(([f, file]) => [f, readFileSync(join(HERE, "devices", `${file}-frame.css`), "utf8")]));
const browser = await chromium.launch();

/* a page at the device's size, with its safe areas: Chromium's own override when it has one, else the page is captured
   inside the safe area and the bars are filled with its own edge colours (what the device shows behind them) */
/* the page's own colour for the browser's bars: <meta name="theme-color"> whose media matches the scheme (as a phone's
   browser paints its status bar), else none */
async function themeColor(page: any): Promise<string | null> {
  return page.evaluate(() => {
    const ms = [...document.querySelectorAll('meta[name="theme-color"]')] as HTMLMetaElement[];
    const m = ms.find((x) => x.media && matchMedia(x.media).matches) ?? ms.find((x) => !x.media);
    return m?.content?.trim() || null;
  });
}
/* the status bar's glyphs the page asks for, apart from its theme: <meta name="flex-status" content="light|dark"> (flex
   screens writes it from screens.json) */
async function pageStatus(page: any): Promise<"light" | "dark" | null> {
  return page.evaluate(() => { const c = (document.querySelector('meta[name="flex-status"]') as HTMLMetaElement | null)?.content; return c === "light" || c === "dark" ? c : null; });
}
async function capturePage(it: In, d: Dev, theme: string, scale: number): Promise<{ png: Buffer; how: string; bar: string | null; asked: "light" | "dark" | null }> {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: scale, colorScheme: theme as "light" | "dark", isMobile: d.touch, hasTouch: d.touch });
  const page = await ctx.newPage();
  let safe = false;
  if (d.touch) {
    try {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: d.top, bottom: d.bottom, left: 0, right: 0 } });
      safe = true;
    } catch { /* an older Chromium: fall back below */ }
  }
  await page.goto(it.src, { waitUntil: "networkidle" }).catch(() => page.goto(it.src));
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(wait);
  if (safe) {
    // does the page actually see it? (env() in a probe element)
    const seen = await page.evaluate(() => { const p = document.createElement("div"); p.style.cssText = "position:fixed;padding-top:env(safe-area-inset-top)"; document.body.appendChild(p); const v = parseFloat(getComputedStyle(p).paddingTop); p.remove(); return v; });
    if (seen > 0) { const bar = await themeColor(page), asked = await pageStatus(page), png = await page.screenshot(); await ctx.close(); return { png, how: "safe areas (Chromium override)", bar, asked }; }
  }
  // fallback: capture within the safe area, then extend the page's own top and bottom edges into the bars
  const top = d.top, bottom = d.bottom, bar = await themeColor(page), asked = await pageStatus(page);
  await page.setViewportSize({ width: d.w, height: d.h - top - bottom });
  await page.waitForTimeout(150);
  const inner = await page.screenshot();
  await ctx.close();
  const meta = await sharp(inner).metadata();
  const W = meta.width!, Ht = Math.round(top * scale), Hb = Math.round(bottom * scale);
  const edge = async (y: number) => { const { data } = await sharp(inner).extract({ left: 0, top: y, width: W, height: 1 }).raw().toBuffer({ resolveWithObject: true }); return data; };
  const band = async (row: Buffer, h: number) => h <= 0 ? null : sharp(Buffer.concat(Array.from({ length: h }, () => row)), { raw: { width: W, height: h, channels: (row.length / W) | 0 } }).png().toBuffer();
  const [tb, bb] = [await band(await edge(0), Ht), await band(await edge(meta.height! - 1), Hb)];
  const parts = [tb && { input: tb, top: 0, left: 0 }, { input: inner, top: Ht, left: 0 }, bb && { input: bb, top: Ht + meta.height!, left: 0 }].filter(Boolean);
  const png = await sharp({ create: { width: W, height: Ht + meta.height! + Hb, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).composite(parts as any).png().toBuffer();
  return { png, how: "safe areas (edges extended)", bar, asked };
}

/* light or dark glyphs for the bars: from the brightness of the page under them (the status bar at the top; a Windows
   laptop's taskbar at the bottom; a window's title bar follows the theme) */
async function lightUnder(png: Buffer, d: Dev, theme: string, edge?: "bottom"): Promise<boolean> {
  if (d.family === "win" || d.family === "macwin" || d.family === "plainwin") return theme !== "dark";
  const m = await sharp(png).metadata(), atBottom = d.family === "pc" || edge === "bottom";
  const h = Math.max(1, Math.round(m.height! * (atBottom ? d.bottom : d.top) / d.h));
  const s = await sharp(png).extract({ left: 0, top: atBottom ? m.height! - h : 0, width: m.width!, height: h }).stats();
  const [r, g, b] = s.channels.map((c: any) => c.mean);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

const fill = `style="display:block;width:100%;height:100%;object-fit:cover"`;
function figure(d: Dev, img: string, status: string, v: { finish: string; style: string }, title: string, band: string | null, navDark = status === "dark"): string {
  const f = d.family, shadow = flag("shadow") ? ` ${f}--shadow` : "", dark = status === "dark";
  const finish = v.style !== "frame" ? ` ${f}--${v.style}` : (f === "android" || f === "pc") && v.finish === "graphite" ? "" : ` ${f}--${v.finish}`;
  // --no-notch: no Dynamic Island (iPhone), no camera notch (Mac), no punch-hole camera (Android)
  const notch = flag("no-notch") ? { iphone: " iphone--no-notch", mac: " mac--no-notch", android: " android--no-camera" }[f as string] ?? "" : "";
  const cls = `${f} ${d.cls} ${finish}${shadow}${notch}`.replace(/\s+/g, " ").trim();
  const shot = `<img src="${img}" alt="">`;
  if (f === "win" || f === "macwin" || f === "plainwin") {
    // the chrome follows the theme unless a finish names it; dark chrome over a dark page
    const chromeDark = v.finish === "dark" || (v.finish === "auto" && status === "light");
    const esc = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    if (f === "win") return `<figure class="win${chromeDark ? " win--dark" : ""}${shadow}" style="margin:0;width:${d.w}px;height:${d.h + 32}px"><div class="win__titlebar"><span class="win__icon"></span>${esc}</div><div class="win__content">${shot.replace("<img", `<img ${fill}`)}</div></figure>`;
    if (f === "macwin") return `<figure class="macwin${chromeDark ? "" : " macwin--light"}${shadow}" style="margin:0;width:${d.w}px;height:${d.h + 34}px"><div class="macwin__title">${esc}</div><div class="macwin__screen">${shot.replace("<img", `<img ${fill}`)}</div></figure>`;
    return `<figure class="plainwin${shadow}" style="margin:0;width:${d.w}px;height:${d.h}px"><div class="plainwin__screen">${shot.replace("<img", `<img ${fill}`)}</div></figure>`;
  }
  const none = status === "none" || v.style === "bare";
  const bar = none ? "" : f === "iphone" ? `<div class="iphone__status${dark ? " iphone__status--dark" : ""}">9:41</div>`
    : f === "ipad" ? `<div class="ipad__status${dark ? " ipad__status--dark" : ""}">9:41&nbsp;&nbsp;Mon Jun 9</div>`
    : f === "android" ? `<div class="android__status${dark ? " android__status--dark" : ""}">10:30</div><div class="android__nav${navDark ? " android__nav--dark" : ""}"></div>`
    : f === "pc" ? `<div class="pc__taskbar${dark ? " pc__taskbar--light" : ""}"></div>`
    : `<div class="mac__menubar${dark ? " mac__menubar--dark" : ""}"><strong>Safari</strong><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Bookmarks</span><span>Window</span><span>Help</span><time>Mon Jun 9&nbsp;&nbsp;9:41 AM</time></div>`;
  // the theme colour's band under the status bar (a phone or tablet's top safe area), as the device's browser paints it
  const under = band && d.touch && d.top && v.style !== "bare" ? `<div style="position:absolute;z-index:2;left:0;right:0;top:0;height:${d.top}px;background:${band}"></div>` : "";
  const extra = f === "mac" ? `<span class="mac__base" aria-hidden="true"></span>` : f === "pc" ? `<span class="pc__base" aria-hidden="true"></span>` : `<span class="${f}__buttons" aria-hidden="true"></span>`;
  return `<figure class="${cls}" style="margin:0${v.style === "outline" ? ";color:#1a1618" : ""}"><div class="${f}__screen">${shot}${under}${bar}</div>${extra}</figure>`;
}

/** the review's frame with the device turned off (the View's Frame switch): the app's window alone, no body, bars,
 *  notch or camera, at the screen's size less its status and home bars. A page laid out inside safe areas of its own
 *  (\`cropped\`: a phone or tablet given insets) is cropped to them, so its snapshot and its live frame still agree. The
 *  iframe keeps the framed one's attributes: the canvas swaps it for a snapshot by matching them. */
function bareFrame(d: Dev, cropped: boolean): string {
  const at = cropped ? `top:-${d.top}px;height:${d.h}px` : "top:0;height:100%";
  return `<figure class="flexbare" style="margin:0;position:relative;overflow:hidden;width:${d.w}px;height:${d.h - d.top - d.bottom}px;border-radius:${d.touch ? 16 : 8}px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 2px 10px rgba(0,0,0,.06)"><iframe src="__SRC__" title="" loading="lazy" style="position:absolute;left:0;right:0;${at};width:100%;border:0;background:#fff"></iframe></figure>`;
}

async function compose(d: Dev, png: Buffer, status: string, scale: number, v: { finish: string; style: string }, title: string, band: string | null, navDark?: boolean): Promise<Buffer> {
  const base = d.family === "mac" || d.family === "pc";
  const pad = flag("shadow") ? 70 : base ? 40 : 12;
  const html = `<!doctype html><meta charset="utf-8"><style>${css[d.family]}
html,body{margin:0;background:${bg === "transparent" ? "transparent" : bg}}
.stage{display:inline-block;padding:${pad}px ${pad}px ${pad + (base ? 40 : 0)}px}</style>
<div class="stage">${figure(d, "data:image/png;base64," + png.toString("base64"), status, v, title, band, navDark)}</div>`;
  const ctx = await browser.newContext({ viewport: { width: d.w + 400, height: d.h + 400 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  const shot = await page.locator(".stage").screenshot({ omitBackground: bg === "transparent" });
  await ctx.close();
  return shot;
}

const frames: Record<string, string> = {};
const made: { input: string; screen: string; device: string; deviceKey: string; family: Family; frameKey: string; page: boolean; scale: number; theme: string; file: string; how: string; status: string; finish: string; style: string }[] = [];
for (const d of devices) {
  const scale = scaleArg ? +scaleArg : d.scale;
  for (const it of items.filter((x) => !x.device || x.device === d.key || x.device === d.key.replace(/-landscape$/, ""))) for (const theme of it.kind === "page" ? (it.theme ? (themes.includes(it.theme) || themeArg === "both" || !opt("--theme") ? [it.theme] : []) : themes) : ["as-is"]) {
    let png: Buffer, how: string, page: string | null = null, asked: "light" | "dark" | null = null;
    if (it.kind === "page") ({ png, how, bar: page, asked } = await capturePage(it, d, theme, scale));
    else { png = readFileSync(it.src); how = "screenshot as given"; }
    const band = barArg === "none" ? null : barArg ?? page;
    // Android's gesture pill sits at the bottom: its colour comes from the page there, not from the status bar's band
    const nav = statusArg === "auto" ? (d.bottom ? await lightUnder(png, d, theme, "bottom") : undefined) : statusArg === "dark";
    // the page's own ask (a photograph under the bar wants white glyphs whatever the theme), else the band, else the pixels
    const status = statusArg === "auto" ? asked ?? (band ? (lightColour(band) ? "dark" : "light") : (await lightUnder(png, d, theme)) ? "dark" : "light") : statusArg;
    for (const v of variants(d)) {
      const shot = await compose(d, png, status, scale, v, opt("--title") ?? it.name, band, nav);
      // the review's live view: this device's frame around a window onto the frozen page (an <iframe> in the screen)
      // A page captured inside its safe area (edges extended: no inset of its own, a Mac under its menu bar) sits between
      // the bars in its window too, over the band's colour, as the render extends its edges into them.
      const inset = how === "safe areas (edges extended)";
      const frameKey = [d.key, status, band ?? "", nav ? 1 : 0, v.finish, v.style, inset ? 1 : 0].join("|");
      const win = inset
        ? `<div style="position:absolute;inset:0;background:${band ?? (status === "light" ? "#111" : "#fff")}"></div><iframe src="__SRC__" title="" loading="lazy" style="position:absolute;left:0;right:0;top:${d.top}px;height:calc(100% - ${d.top + d.bottom}px);width:100%;border:0;background:#fff"></iframe>`
        : '<iframe src="__SRC__" title="" loading="lazy" style="display:block;width:100%;height:100%;border:0;background:#fff"></iframe>';
      if (flag("review") && !frames[frameKey]) {
        frames[frameKey] = figure(d, "__SRC__", status, v, opt("--title") ?? it.name, band, nav).replace('<img src="__SRC__" alt="">', win);
        frames[frameKey + "#bare"] = bareFrame(d, d.touch && !inset);
      }
      // the finish and style join the name only when this run renders more than one of them
      const tag = many ? `-${v.style === "frame" ? v.finish : v.style}` : "";
      const file = join(outDir, `${it.name}-${d.key}${tag}${it.kind === "page" ? "-" + theme : ""}.png`);
      writeFileSync(file, shot);
      made.push({ input: it.src.startsWith("file:") ? fileURLToPath(it.src) : it.src, screen: it.name, device: d.label, deviceKey: d.key, family: d.family, scale, theme, file, how, status, finish: v.finish, style: v.style, frameKey, page: it.kind === "page" && it.src.startsWith("file:") });
      if (!flag("json")) out(`  ${basename(file)}  (${d.label}${many ? `, ${v.style === "frame" ? v.finish : v.style}` : ""}, ${theme}, status ${status}, ${how})`);
    }
  }
}

/* a contact sheet of everything made, for looking at them together */
let sheet: string | undefined;
if (flag("sheet") && made.length) {
  const cells = made.map((m) => `<figure><img src="data:image/png;base64,${readFileSync(m.file).toString("base64")}"><figcaption>${basename(m.file)}</figcaption></figure>`).join("");
  const ctx = await browser.newContext({ viewport: { width: 2400, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><style>body{margin:0;padding:40px;background:#e9e8e4;font:600 15px -apple-system,system-ui,sans-serif;color:#333}
  .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(${devices.some((d) => d.family !== "iphone" && d.family !== "android") ? 560 : 300}px,1fr));gap:36px 28px;align-items:end}
  figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}img{width:100%;height:auto}</style><div class="g">${cells}</div>`, { waitUntil: "load" });
  sheet = join(outDir, "sheet.png");
  await page.locator(".g").screenshot({ path: sheet });
  await ctx.close();
  if (!flag("json")) out(`  ${basename(sheet)}  (all of them together)`);
}
/* --review: a page over this run's PNGs, to check them before they go anywhere (a film, a deck): filter by screen,
   device, finish, style and theme; open one at full size; pin two to four side by side. Every image on it is the file
   this run wrote (by relative path, beside the page), never a re-render */
let review: string | undefined;
if (flag("review") && made.length) {
  // the frozen pages travel with the review (pages/<device>/<file>), so the folder opens anywhere with a double-click
  const rows = made.map((m) => {
    let page: string | null = null;
    if (m.page) {
      page = join("pages", m.deviceKey, basename(m.input));
      mkdirSync(join(outDir, "pages", m.deviceKey), { recursive: true });
      copyFileSync(m.input, join(outDir, page));
    }
    return { file: basename(m.file), screen: m.screen, device: m.device, key: m.deviceKey, theme: m.theme, finish: m.style === "frame" ? m.finish : m.style, status: m.status, scale: m.scale, page, frame: m.frameKey };
  });
  const usedCss = [...new Set(made.map((m) => m.family))].map((f) => css[f]).join("\n");
  review = join(outDir, "review.html");
  writeFileSync(review, reviewPage(rows, basename(outDir), { frames, css: usedCss, index: screensIndex }));
  // embed.html and canvas.html: Flex's devices for other pages to place by reference (server/embed.mts); each padded
  // as compose() pads its PNG, so an iframe at the PNG's ratio lines up with it
  const padOf = (f: Family): [number, number, number, number] => { const base = f === "mac" || f === "pc", p = flag("shadow") ? 70 : base ? 40 : 12; return [p, p, p + (base ? 40 : 0), p]; };
  const firstStyle = new Map<string, string>();
  for (const m of made) if (!firstStyle.has(m.deviceKey)) firstStyle.set(m.deviceKey, m.finish + "|" + m.style);
  const embedRows = made.filter((m) => firstStyle.get(m.deviceKey) === m.finish + "|" + m.style).map((m, i) => ({ screen: m.screen, key: m.deviceKey, theme: m.theme, family: m.family, page: rows[made.indexOf(m)].page, frame: m.frameKey, file: basename(m.file), pad: padOf(m.family) }));
  for (const [name, text] of Object.entries(embedFiles(embedRows, frames, usedCss, FINISHES, screensIndex))) writeFileSync(join(outDir, name), text);
  if (!flag("json")) out(`  embed.html, canvas.html  (Flex's devices for other pages: an <iframe> by screen, device and theme)`);
  if (!flag("json")) out(`  ${basename(review)}  (filter, open and compare them: open it in a browser)`);
}
await browser.close();
if (flag("json")) out(JSON.stringify({ ok: true, dir: outDir, mockups: made, sheet, review }));
else out(`${made.length} mockup${made.length === 1 ? "" : "s"} in ${outDir}`);

