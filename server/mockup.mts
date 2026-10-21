// flex mockup: screens in Apple device frames (server/devices/*.css, CSS only, drawn at any scale), as PNGs.
// An input is a page (an .html file or a URL), captured at the device's own size with its safe areas, light or dark;
// or a screenshot (.png / .jpg) placed as it is; or a folder of either (its .html files, else its images).
//   mockup.mts <input>… [-o dir] [--device iphone,ipad,mac] [--theme light|dark|both] [--finish f] [--landscape]
//              [--status auto|light|dark|none] [--bg transparent|#hex] [--shadow] [--scale n] [--sheet] [--json]
// It measures nothing and judges nothing: it frames what it's given, and says where it put it.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const PIPE = process.env.FLEX_PIPELINE!;
const req = createRequire(join(PIPE, "package.json"));
const { chromium } = req("playwright");
const sharp = req("sharp");
const HERE = dirname(fileURLToPath(import.meta.url));
const out = ((w) => (s: string) => w(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");

const argv = process.argv.slice(2), flag = (f: string) => argv.includes(`--${f}`);
const VALUED = ["-o", "--out", "--device", "--theme", "--finish", "--status", "--bg", "--scale", "--wait"];
const opt = (...fs: string[]) => { for (const f of fs) { const i = argv.indexOf(f); if (i >= 0) return argv[i + 1]; } return undefined; };
const inputs = argv.filter((a, i) => !a.startsWith("-") && !(i > 0 && VALUED.includes(argv[i - 1])));
const fail = (m: string): never => { if (flag("json")) out(JSON.stringify({ ok: false, error: m })); else console.error(`!! ${m}`); process.exit(1); };
if (!inputs.length) fail("name a page, a screenshot or a folder: flex mockup <input>… (flex mockup --help)");

/* ── the devices: their screen in points, safe areas, status bar, figure class ── */
type Dev = { key: string; family: "iphone" | "ipad" | "mac"; cls: string; w: number; h: number; top: number; bottom: number; scale: number; label: string };
const DEVICES: Record<string, Omit<Dev, "key">> = {
  "iphone":     { family: "iphone", cls: "iphone--pro",     w: 402,  h: 874,  top: 62, bottom: 34, scale: 3, label: "iPhone 17 Pro" },
  "iphone-max": { family: "iphone", cls: "iphone--pro-max", w: 440,  h: 956,  top: 62, bottom: 34, scale: 3, label: "iPhone 17 Pro Max" },
  "ipad":       { family: "ipad",   cls: "ipad--13",        w: 1032, h: 1376, top: 24, bottom: 20, scale: 2, label: "iPad Pro 13″" },
  "ipad-11":    { family: "ipad",   cls: "ipad--11",        w: 834,  h: 1210, top: 24, bottom: 20, scale: 2, label: "iPad Pro 11″" },
  "ipad-mini":  { family: "ipad",   cls: "ipad--mini",      w: 744,  h: 1133, top: 24, bottom: 20, scale: 2, label: "iPad mini" },
  "mac":        { family: "mac",    cls: "mac--14",         w: 1512, h: 982,  top: 37, bottom: 0,  scale: 2, label: "MacBook Pro 14″" },
  "mac-16":     { family: "mac",    cls: "mac--16",         w: 1728, h: 1117, top: 37, bottom: 0,  scale: 2, label: "MacBook Pro 16″" },
  "display":    { family: "mac",    cls: "mac--display",    w: 2560, h: 1440, top: 24, bottom: 0,  scale: 2, label: "Studio Display" },
};
const FINISHES: Record<string, string[]> = { iphone: ["black", "silver", "natural", "blue", "orange"], ipad: ["gray", "silver"], mac: ["black", "silver"] };
const landscape = flag("landscape");
const devices: Dev[] = (opt("--device") ?? "iphone").split(",").map((k) => k.trim()).filter(Boolean).map((k) => {
  const d = DEVICES[k]; if (!d) fail(`no device "${k}" (${Object.keys(DEVICES).join(", ")})`);
  const turn = landscape && d.family === "ipad";
  return { key: k + (turn ? "-landscape" : ""), ...d, w: turn ? d.h : d.w, h: turn ? d.w : d.h, cls: d.cls + (turn ? " ipad--landscape" : "") };
});
const themeArg = opt("--theme") ?? "light";
const themes = themeArg === "both" ? ["light", "dark"] : [themeArg];
if (themes.some((t) => t !== "light" && t !== "dark")) fail(`--theme is light, dark or both`);
const statusArg = opt("--status") ?? "auto";
const bg = opt("--bg") ?? "transparent";
const scaleArg = opt("--scale");
const wait = +(opt("--wait") ?? 400);

/* ── the inputs ── */
type In = { kind: "page" | "image"; src: string; name: string };
const IMG = /\.(png|jpe?g|webp)$/i;
const expand = (a: string): In[] => {
  if (/^https?:\/\//.test(a)) return [{ kind: "page", src: a, name: new URL(a).pathname.split("/").filter(Boolean).pop()?.replace(/\.html?$/, "") || new URL(a).hostname }];
  const p = resolve(a);
  if (!existsSync(p)) fail(`no such file or folder: ${a}`);
  if (statSync(p).isDirectory()) {
    const names = readdirSync(p).sort();
    const pages = names.filter((n) => /\.html?$/i.test(n));
    const pick = pages.length ? pages : names.filter((n) => IMG.test(n));
    if (!pick.length) fail(`${a}: no .html pages or images in it`);
    return pick.flatMap((n) => expand(join(p, n)));
  }
  if (/\.html?$/i.test(p)) return [{ kind: "page", src: pathToFileURL(p).href, name: basename(p).replace(/\.html?$/i, "") }];
  if (IMG.test(p)) return [{ kind: "image", src: p, name: basename(p, extname(p)) }];
  return fail(`${a}: not a page (.html, a URL) or a screenshot (.png, .jpg)`);
};
const items = inputs.flatMap(expand);
const first = resolve(inputs[0]);
const outDir = resolve(opt("-o", "--out") ?? join(homedir(), "Downloads", "flex-mockups", /^https?:/.test(inputs[0]) ? "web" : basename(existsSync(first) && statSync(first).isDirectory() ? first : dirname(first))));
mkdirSync(outDir, { recursive: true });

const css = Object.fromEntries(["iphone", "ipad", "mac"].map((f) => [f, readFileSync(join(HERE, "devices", `${f}-frame.css`), "utf8")]));
const browser = await chromium.launch();

/* a page at the device's size, with its safe areas: Chromium's own override when it has one, else the page is captured
   inside the safe area and the bars are filled with its own edge colours (what the device shows behind them) */
async function capturePage(it: In, d: Dev, theme: string, scale: number): Promise<{ png: Buffer; how: string }> {
  const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: scale, colorScheme: theme as "light" | "dark", isMobile: d.family !== "mac", hasTouch: d.family !== "mac" });
  const page = await ctx.newPage();
  let safe = false;
  if (d.family !== "mac") {
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
    if (seen > 0) { const png = await page.screenshot(); await ctx.close(); return { png, how: "safe areas (Chromium override)" }; }
  }
  // fallback: capture within the safe area, then extend the page's own top and bottom edges into the bars
  const top = d.top, bottom = d.bottom;
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
  return { png, how: "safe areas (edges extended)" };
}

/* light or dark glyphs for the status bar: from the brightness under it */
async function lightUnder(png: Buffer, d: Dev): Promise<boolean> {
  const m = await sharp(png).metadata(); const h = Math.max(1, Math.round(m.height! * d.top / d.h));
  const s = await sharp(png).extract({ left: 0, top: 0, width: m.width!, height: h }).stats();
  const [r, g, b] = s.channels.map((c: any) => c.mean);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

function figure(d: Dev, img: string, status: string): string {
  const finish = opt("--finish") ?? FINISHES[d.family][0];
  if (!FINISHES[d.family].includes(finish)) fail(`no ${d.family} finish "${finish}" (${FINISHES[d.family].join(", ")})`);
  const shadow = flag("shadow") ? ` ${d.family}--shadow` : "";
  const cls = `${d.family} ${d.cls} ${d.family}--${finish}${shadow}`;
  const dark = status === "dark" ? ` ${d.family === "mac" ? "mac__menubar" : d.family + "__status"}--dark` : "";
  const bar = status === "none" ? "" : d.family === "iphone" ? `<div class="iphone__status${dark}">9:41</div>`
    : d.family === "ipad" ? `<div class="ipad__status${dark}">9:41&nbsp;&nbsp;Mon Jun 9</div>`
    : `<div class="mac__menubar${dark}"><strong>Safari</strong><span>File</span><span>Edit</span><span>View</span><span>History</span><span>Bookmarks</span><span>Window</span><span>Help</span><time>Mon Jun 9&nbsp;&nbsp;9:41 AM</time></div>`;
  const extra = d.family === "mac" ? `<span class="mac__base" aria-hidden="true"></span>` : `<span class="${d.family}__buttons" aria-hidden="true"></span>`;
  return `<figure class="${cls}" style="margin:0"><div class="${d.family}__screen"><img src="${img}" alt="">${bar}</div>${extra}</figure>`;
}

async function compose(d: Dev, png: Buffer, status: string, scale: number): Promise<Buffer> {
  const pad = flag("shadow") ? 70 : d.family === "mac" ? 40 : 12;
  const html = `<!doctype html><meta charset="utf-8"><style>${css[d.family]}
html,body{margin:0;background:${bg === "transparent" ? "transparent" : bg}}
.stage{display:inline-block;padding:${pad}px ${pad}px ${pad + (d.family === "mac" ? 40 : 0)}px}</style>
<div class="stage">${figure(d, "data:image/png;base64," + png.toString("base64"), status)}</div>`;
  const ctx = await browser.newContext({ viewport: { width: d.w + 400, height: d.h + 400 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  const shot = await page.locator(".stage").screenshot({ omitBackground: bg === "transparent" });
  await ctx.close();
  return shot;
}

const made: { input: string; device: string; theme: string; file: string; how: string; status: string }[] = [];
for (const d of devices) {
  const scale = scaleArg ? +scaleArg : d.scale;
  for (const it of items) for (const theme of it.kind === "page" ? themes : ["as-is"]) {
    let png: Buffer, how: string;
    if (it.kind === "page") ({ png, how } = await capturePage(it, d, theme, scale));
    else { png = readFileSync(it.src); how = "screenshot as given"; }
    const status = statusArg === "auto" ? ((await lightUnder(png, d)) ? "dark" : "light") : statusArg;
    const shot = await compose(d, png, status, scale);
    const file = join(outDir, `${it.name}-${d.key}${it.kind === "page" ? "-" + theme : ""}.png`);
    writeFileSync(file, shot);
    made.push({ input: it.src.startsWith("file:") ? fileURLToPath(it.src) : it.src, device: d.label, theme, file, how, status });
    if (!flag("json")) out(`  ${basename(file)}  (${d.label}, ${theme}, status ${status}, ${how})`);
  }
}

/* a contact sheet of everything made, for looking at them together */
let sheet: string | undefined;
if (flag("sheet") && made.length) {
  const cells = made.map((m) => `<figure><img src="data:image/png;base64,${readFileSync(m.file).toString("base64")}"><figcaption>${basename(m.file)}</figcaption></figure>`).join("");
  const ctx = await browser.newContext({ viewport: { width: 2400, height: 1200 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><style>body{margin:0;padding:40px;background:#e9e8e4;font:600 15px -apple-system,system-ui,sans-serif;color:#333}
  .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(${devices.some((d) => d.family !== "iphone") ? 560 : 300}px,1fr));gap:36px 28px;align-items:end}
  figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}img{width:100%;height:auto}</style><div class="g">${cells}</div>`, { waitUntil: "load" });
  sheet = join(outDir, "sheet.png");
  await page.locator(".g").screenshot({ path: sheet });
  await ctx.close();
  if (!flag("json")) out(`  ${basename(sheet)}  (all of them together)`);
}
await browser.close();
if (flag("json")) out(JSON.stringify({ ok: true, dir: outDir, mockups: made, sheet }));
else out(`${made.length} mockup${made.length === 1 ? "" : "s"} in ${outDir}`);
