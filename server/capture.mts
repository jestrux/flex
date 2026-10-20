// Capture: record a project's journeys (screen recordings of the real app) into take versions, report their timing, pick
// one. Runs the pipeline's own capture (pipeline/lib/capture.ts, patch 05 logs every beat) on Flex's terms:
//   - a take is captured into a new version, takes/.versions/<take>/v<n>/, never over the take the film uses
//     (takes/<take>/, the pick); `pick` swaps one in
//   - a real capture is warmed up by a dry run first (cold dev servers made beats late), unless --no-warm
//   - after it: the zoom plan, the retime (project.capture.retime: "clicks", a navigation click shows the new page on the
//     next frame), and the timing report (each beat's lateness; each mark's offset against the pick)
//   - picking a version keeps the pick's locked camera plan, shifted piecewise by each mark's offset
//   - data states: the project's staging scripts and the state each leaves the app's data in (project.capture)
//
//   capture.mts journeys <project> [--json]
//   capture.mts run <project> <journey> [--dry] [--dpr N] [--no-warm] [--yes] [--force] [--json]
//   capture.mts report <project> <take> [v<n>] [--json]
//   capture.mts pick <project> <take> v<n> [--json]
//   capture.mts stage <project> [<script>] [--yes] [--json]
//   capture.mts prune <project> [<take>] [--keep N] [--yes] [--json]
//   capture.mts walk <project> [--json]
//   capture.mts freeze <project> <persona> <url|path> [--name n] [--view v] [--full] [--element css] [--wait css] [--dpr n]
// The engine sets FLEX_PIPELINE and FLEX_VOICE_CACHE, and starts this with the import redirect (server/redirect.mjs).
// Logs go to stderr; the result goes to stdout (text, or one JSON object with --json). See docs/capture.md.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PIPE = process.env.FLEX_PIPELINE!;
const imp = (p: string) => import(pathToFileURL(p).href);
const out = ((write) => (s: string) => write(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(`--${f}`);
const opt = (f: string) => { const i = argv.indexOf(`--${f}`); return i >= 0 ? argv[i + 1] : undefined; };
const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--dpr", "--keep", "--view", "--name", "--element", "--wait"].includes(argv[i - 1])));
const [cmd, projArg] = pos;
const JSON_OUT = flag("json");
const fail = (msg: string, extra: object = {}): never => {
  if (JSON_OUT) out(JSON.stringify({ ok: false, error: msg, ...extra })); else console.error(`!! ${msg}`);
  process.exit(1);
};
if (!cmd || !projArg) fail("usage: capture.mts journeys|run|report|pick|stage <project> …");
const DIR = resolve(projArg);
if (!existsSync(join(DIR, "project.ts"))) fail(`no project.ts in ${DIR}`);

// ── the project's declarations ────────────────────────────────────────────────────────────────────────────────────────
type Script = { run: string; gives?: string; writes?: boolean; confirm?: string; about?: string };
type JourneyDecl = { needs?: string; gives?: string; writes?: { env: Record<string, string>; confirm: string }; about?: string };
type CaptureDecl = {
  dpr?: number; retime?: "clicks" | false;
  states?: Record<string, string>; scripts?: Record<string, Script>; journeys?: Record<string, JourneyDecl>;
  /** a command that prints the current state's name (optional; else the last script Flex ran says it) */
  check?: string;
  /** who the app is seen as: a command printing that seat's browser cookies as JSON ([{ name, value, domain, path }]) */
  personas?: Record<string, { cookies: string; storage?: Record<string, string>; about?: string }>;
  /** flex walk: every page as each seat, for planning beats. base + each path; storage: localStorage set before load */
  walk?: { base: string; storage?: Record<string, string>; viewport?: { w: number; h: number }; seats: Record<string, string[]>;
    /** named elements whose boxes are recorded beside each still (name → CSS selector), for cutting card regions */
    elements?: Record<string, string>;
    /** other ways to see the same pages (--view <name>): a theme's storage, a phone's viewport */
    views?: Record<string, { storage?: Record<string, string>; viewport?: { w: number; h: number } }>;
    /** the old name for views */
    variants?: Record<string, { storage?: Record<string, string>; viewport?: { w: number; h: number } }> };
};
/** project.capture, read without importing the pipeline (project.ts imports it): project.ts exports `capture` as a plain
 *  literal, or the project has capture.json */
async function decl(): Promise<CaptureDecl> {
  if (existsSync(join(DIR, "capture.json"))) return JSON.parse(readFileSync(join(DIR, "capture.json"), "utf8"));
  const mod = await imp(join(DIR, "project.ts"));
  return mod.capture ?? {};
}

// before the pipeline loads (project.ts imports it): its look registry scans FLEX_PROJECTS once
process.env.FLEX_PROJECT = DIR; // flex/personas reads the project's personas
if (!process.env.FLEX_PROJECTS) { const p = mkdtempSync(join(tmpdir(), "flex-projects-")); symlinkSync(DIR, join(p, basename(DIR))); process.env.FLEX_PROJECTS = p; }

const TAKES = join(DIR, "takes"), VERS = join(TAKES, ".versions"), STATE = join(DIR, ".flex", "state.json");

type Mark = { t: number; label: string };
type Ev = { dpr: number; duration: number; frames: { t: number; file: string }[]; clicks: { t: number; label?: string }[];
  marks: Mark[]; freeze?: { from: number; to: number }[]; beat?: { bpm: number; mark: string; t0: number };
  beats?: { n: number; label: string; t: number; due: number }[] };
const readEv = (dir: string): Ev | null => existsSync(join(dir, "events.json")) ? JSON.parse(readFileSync(join(dir, "events.json"), "utf8")) : null;

/** the project's journeys: journeys/<name>.ts that export a take ("_" files are helpers) */
function journeys() {
  const jd = join(DIR, "journeys");
  if (!existsSync(jd)) return [];
  return readdirSync(jd).filter((f) => f.endsWith(".ts") && !f.startsWith("_")).flatMap((f) => {
    const src = readFileSync(join(jd, f), "utf8"), m = src.match(/export const take\s*=\s*["'`]([^"'`]+)["'`]/);
    return m ? [{ name: f.replace(/\.ts$/, ""), file: join(jd, f), take: m[1] }] : [];
  });
}
/** a take's versions, oldest first */
function versions(take: string) {
  const d = join(VERS, take);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((v) => /^v\d+$/.test(v)).map((v) => ({ v, n: +v.slice(1), dir: join(d, v) }))
    .filter((x) => existsSync(join(x.dir, "events.json"))).sort((a, b) => a.n - b.n);
}
const picked = (take: string): number | null => { const f = join(TAKES, take, ".flex-version"); return existsSync(f) ? +readFileSync(f, "utf8").trim() : null; };
const nextN = (take: string) => Math.max(0, ...versions(take).map((x) => x.n)) + 1;
/** the take the film used before Flex versioned it becomes v0 (an APFS clone: no extra disk), so every take is a version */
function adopt(take: string) {
  const cur = join(TAKES, take), ev = readEv(cur);
  if (!ev || picked(take) !== null) return;
  const v0 = join(VERS, take, "v0");
  mkdirSync(join(VERS, take), { recursive: true });
  execFileSync("cp", ["-cR", cur, v0]);
  writeFileSync(join(v0, "version.json"), JSON.stringify({ n: 0, at: new Date(statSync(join(cur, "events.json")).mtimeMs).toISOString(), dpr: ev.dpr, duration: ev.duration, frames: ev.frames.length, note: "the take before Flex versioned it" }, null, 1));
  writeFileSync(join(cur, ".flex-version"), "0");
  console.error(`  kept the current take as v0`);
}

// ── timing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** marks matched by label and occurrence (a label can repeat) */
function matchMarks(a: Mark[], b: Mark[]) {
  const seen = new Map<string, number>(), res: { label: string; a: number; b: number }[] = [];
  for (const m of a) {
    const k = seen.get(m.label) ?? 0; seen.set(m.label, k + 1);
    const o = b.filter((x) => x.label === m.label)[k];
    if (o) res.push({ label: m.label, a: m.t, b: o.t });
  }
  return res;
}
const LATE = 40; // ms: a step later than this missed its beat (capture.ts warns at the same threshold)
function report(dir: string, against: string | null, againstName = "pick") {
  const ev = readEv(dir)!;
  const beats = (ev.beats ?? []).map((b) => ({ n: b.n, label: b.label, late: Math.round(b.t - b.due) }));
  const ref = against ? readEv(against) : null;
  const marks = ref ? matchMarks(ref.marks, ev.marks).map((m) => ({ label: m.label, offset: Math.round(m.b - m.a) })) : [];
  const base = marks[0]?.offset ?? 0;
  return {
    duration: ev.duration, frames: ev.frames.length, dpr: ev.dpr, bpm: ev.beat?.bpm ?? null,
    beats, late: beats.filter((b) => b.late > LATE).length, worst: Math.max(0, ...beats.map((b) => b.late)),
    against: against ? againstName : null,
    /** offset: this mark's time minus the pick's; drift: the same, relative to the first mark (what the film sees, since
     *  scenes cut takes from a mark) */
    marks: marks.map((m) => ({ ...m, drift: m.offset - base })),
    unmatched: ref ? ref.marks.length - marks.length : 0,
  };
}
function printReport(name: string, r: ReturnType<typeof report>) {
  console.error(`\n  ${name}: ${(r.duration / 1000).toFixed(1)} s · ${r.frames} frames · ${r.dpr}×${r.bpm ? ` · ${r.bpm} bpm` : ""}`);
  if (r.beats.length) {
    console.error(`  beats (late > ${LATE} ms marked !):`);
    for (const b of r.beats) console.error(`    ${b.late > LATE ? "!" : " "} beat ${String(b.n).padStart(5)}  ${b.label.padEnd(22)} ${b.late >= 0 ? "+" : ""}${b.late} ms`);
  } else console.error("  (no beat log: captured before Flex logged beats)");
  if (r.marks.length) {
    console.error(`  marks against the ${r.against} (drift: relative to the first mark, what the film sees):`);
    for (const m of r.marks) console.error(`    ${Math.abs(m.drift) > LATE ? "!" : " "} ${m.label.padEnd(24)} ${m.offset >= 0 ? "+" : ""}${m.offset} ms · drift ${m.drift >= 0 ? "+" : ""}${m.drift} ms`);
    if (r.unmatched) console.error(`    ${r.unmatched} mark(s) of the pick have no match in this version`);
  }
}

// ── the camera plan, carried over ──────────────────────────────────────────────────────────────────────────────────────
/** a time in the old take → the same moment in the new one: shifted by the offset of the last mark at or before it */
function shifter(oldEv: Ev, newEv: Ev) {
  const anchors = matchMarks(oldEv.marks, newEv.marks).sort((x, y) => x.a - y.a);
  return (t: number) => {
    if (!anchors.length) return t;
    let k = anchors[0];
    for (const a of anchors) if (a.a <= t) k = a; else break;
    return Math.round(t + (k.b - k.a));
  };
}
function shiftEdl(edl: any, sh: (t: number) => number) {
  const e = structuredClone(edl);
  for (const s of e.segments ?? []) { s.start = sh(s.start); s.end = sh(s.end); }
  for (const f of e.effects ?? []) { f.start = sh(f.start); f.end = sh(f.end); }
  return e;
}

// ── retime: a navigation click shows the new page on the next frame (was journeys/_retime.ts in circles-overview) ───────
const FRAME = 34; // ms: one output frame at 30 fps
function retime(dir: string) {
  const cur = join(dir, "events.json"), orig = join(dir, "events.orig.json");
  const fresh = (e: Ev) => (e.freeze ?? []).some((z) => e.clicks.some((c) => c.t >= z.from && c.t <= z.to));
  if (!existsSync(orig) || fresh(JSON.parse(readFileSync(cur, "utf8")))) cpSync(cur, orig);
  const ev: Ev = JSON.parse(readFileSync(orig, "utf8"));
  const keep: { from: number; to: number }[] = [], notes: string[] = [];
  let frames = ev.frames.slice();
  for (const z of ev.freeze ?? []) {
    const click = ev.clicks.find((c) => c.t >= z.from && c.t <= z.to);
    if (!click) { keep.push(z); continue; }
    const inside = frames.filter((f) => f.t > click.t && f.t < z.to);
    if (!inside.length) { notes.push(`${click.label ?? "click"}: no frames during the load (kept the freeze)`); keep.push(z); continue; }
    const painted = inside[inside.length - 1];
    frames = frames.filter((f) => !(f.t > click.t && f.t < z.to)).concat({ t: click.t + FRAME, file: painted.file }).sort((a, b) => a.t - b.t);
    notes.push(`${click.label ?? "click"} @${(click.t / 1000).toFixed(2)} s: the new page (painted ${((painted.t - click.t) / 1000).toFixed(2)} s later) shows on the next frame`);
  }
  writeFileSync(cur, JSON.stringify({ ...ev, frames, freeze: keep }));
  return notes;
}

// ── data states ────────────────────────────────────────────────────────────────────────────────────────────────────────
type State = { state: string | null; script?: string; at?: string; checked?: boolean };
function readState(d: CaptureDecl): State {
  if (d.check) {
    const r = spawnSync("sh", ["-c", d.check], { cwd: DIR, encoding: "utf8" });
    if (r.status === 0) return { state: r.stdout.trim().split("\n").pop() || null, checked: true };
    console.error(`  ! the state check failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  }
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { state: null };
}
function writeState(s: State) { mkdirSync(join(DIR, ".flex"), { recursive: true }); writeFileSync(STATE, JSON.stringify(s, null, 1)); }

// ── the pipeline, with the project's takes and look discovery (the same env serve.mts sets) ────────────────────────────
function pipelineEnv(takesLinks: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "flex-takes-"));
  for (const [take, dir] of Object.entries(takesLinks)) symlinkSync(dir, join(d, take));
  process.env.FLEX_TAKES = d;
}

// ── the commands ───────────────────────────────────────────────────────────────────────────────────────────────────────
const d = await decl();

if (cmd === "journeys") {
  const st = readState(d);
  const list = journeys().map((j) => {
    const jd = d.journeys?.[j.name] ?? {}, pick = picked(j.take), cur = readEv(join(TAKES, j.take));
    return { ...j, ...jd, picked: pick, current: cur ? { duration: cur.duration, frames: cur.frames.length, dpr: cur.dpr } : null,
      ready: !jd.needs || jd.needs === st.state,
      versions: versions(j.take).map((x) => { const meta = JSON.parse(readFileSync(join(x.dir, "version.json"), "utf8")); return { ...meta, dir: x.dir, picked: x.n === pick }; }) };
  });
  const res = { ok: true, dpr: d.dpr ?? 2, retime: d.retime ?? false, state: st, states: d.states ?? {}, scripts: d.scripts ?? {}, journeys: list };
  if (JSON_OUT) out(JSON.stringify(res));
  else {
    if (Object.keys(d.states ?? {}).length) out(`data state: ${st.state ?? "unknown"}${st.script ? ` (after ${st.script}, ${st.at})` : ""}`);
    for (const j of list) {
      out(`${j.name.padEnd(18)} → takes/${j.take}${j.needs ? `  needs: ${j.needs}${j.ready ? "" : " (not the current state)"}` : ""}${j.writes ? "  WRITES" : ""}`);
      for (const v of j.versions) out(`   v${v.n}${v.picked ? " *" : "  "} ${v.at}  ${v.dpr}×  ${(v.duration / 1000).toFixed(1)} s  ${v.late ?? "?"} late beat(s)${v.note ? `  ${v.note}` : ""}`);
    }
  }
  process.exit(0);
}

if (cmd === "stage") {
  const name = pos[2], st = readState(d);
  if (!name) {
    const res = { ok: true, state: st, states: d.states ?? {}, scripts: d.scripts ?? {} };
    if (JSON_OUT) out(JSON.stringify(res));
    else { out(`data state: ${st.state ?? "unknown"}`); for (const [k, s] of Object.entries(d.scripts ?? {})) out(`  ${k.padEnd(18)} ${s.run}${s.gives ? ` → ${s.gives}` : ""}${s.writes ? "  WRITES" : ""}${s.about ? `  ${s.about}` : ""}`); }
    process.exit(0);
  }
  const s = d.scripts?.[name] ?? fail(`no script "${name}" in project.capture.scripts`);
  if (s.writes && !flag("yes")) fail(`"${name}" writes to the app's data: ${s.confirm ?? s.run}. Run again with --yes to go ahead.`, { needsConfirm: s.confirm ?? s.run });
  console.error(`==> ${s.run}`);
  const r = spawnSync("sh", ["-c", s.run], { cwd: DIR, stdio: ["ignore", process.stderr, process.stderr] });
  if (r.status !== 0) fail(`${name} failed (exit ${r.status})`);
  const ns: State = { state: s.gives ?? st.state, script: name, at: new Date().toISOString() };
  writeState(ns);
  if (JSON_OUT) out(JSON.stringify({ ok: true, state: ns })); else out(`data state: ${ns.state ?? "unknown"}`);
  process.exit(0);
}

if (cmd === "report") {
  const take = pos[2] ?? fail("which take?"), v = pos[3];
  const dir = v ? join(VERS, take, v) : join(TAKES, take);
  if (!readEv(dir)) fail(`no capture at ${dir}`);
  const r = report(dir, v && readEv(join(TAKES, take)) ? join(TAKES, take) : null);
  if (JSON_OUT) out(JSON.stringify({ ok: true, take, version: v ?? "pick", ...r })); else printReport(`${take} ${v ?? "(the pick)"}`, r);
  process.exit(0);
}

if (cmd === "walk") {
  // every page as each seat: a screenshot each and a contact sheet (storyboard/walk/), to plan beats from what is on screen
  const w = d.walk ?? fail("no walk in the project's capture declaration (capture.walk: { base, seats: { <persona>: [paths] } })");
  // --view <name> (a theme or a size the project declares), --full (whole pages), --dpr N (pixel density)
  const views = { ...(w.variants ?? {}), ...(w.views ?? {}) };
  const vname = opt("view"), v = vname ? (views[vname] ?? fail(`no walk view "${vname}" (capture.walk.views: ${Object.keys(views).join(", ") || "none"})`)) : {};
  const full = flag("full"), dpr = Number(opt("dpr") ?? 1);
  const tag = vname ? `-${vname}` : "";
  const outDir = join(DIR, "storyboard", `walk${tag}`);
  mkdirSync(outDir, { recursive: true });
  const { chromium } = await imp(join(PIPE, "node_modules/playwright/index.mjs"));
  const vp = v.viewport ?? w.viewport ?? { w: 1440, h: 810 };
  const browser = await chromium.launch();
  const shots: { seat: string; path: string; file: string; landed: string }[] = [];
  try {
    for (const [seat, paths] of Object.entries(w.seats)) {
      const p = d.personas?.[seat] ?? fail(`walk seat "${seat}" has no persona (capture.personas.${seat}.cookies)`);
      const r = spawnSync("sh", ["-c", p.cookies], { cwd: DIR, encoding: "utf8" });
      if (r.status !== 0) fail(`${seat}'s login failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: dpr });
      await ctx.addCookies(JSON.parse(r.stdout.trim().split("\n").pop()!));
      const storage = { ...(w.storage ?? {}), ...(p.storage ?? {}), ...(v.storage ?? {}) };
      if (Object.keys(storage).length) await ctx.addInitScript((kv: Record<string, string>) => { for (const [k, x] of Object.entries(kv)) localStorage.setItem(k, x); }, storage);
      const page = await ctx.newPage();
      for (const path of paths) {
        await page.goto(w.base + path, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(800);
        const file = join(outDir, `${seat}-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}.png`);
        await page.screenshot({ path: file, fullPage: full });
        // the named elements' boxes (CSS px, page coordinates; × dpr for the still's pixels), beside the still
        if (w.elements) {
          const boxes: Record<string, unknown> = {};
          const sy = full ? await page.evaluate(() => window.scrollY) : 0;
          for (const [name, css] of Object.entries(w.elements)) {
            const el = page.locator(css).first();
            const b = (await el.isVisible().catch(() => false)) ? await el.boundingBox() : null;
            boxes[name] = b ? { x: Math.round(b.x), y: Math.round(b.y + sy), w: Math.round(b.width), h: Math.round(b.height) } : null;
          }
          writeFileSync(file.replace(/\.png$/, ".boxes.json"), JSON.stringify({ dpr, viewport: vp, full, boxes }, null, 1));
        }
        const landed = new URL(page.url()).pathname;
        shots.push({ seat, path, file, landed });
        console.error(`  ${seat} ${path} → ${landed}`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  // the sheet: one row per seat
  const sharp = (await imp(join(PIPE, "node_modules/sharp/lib/index.js"))).default;
  const TW = vp.w < 800 ? 360 : 760, TH = Math.round(TW * vp.h / vp.w), LBL = 32, seats = Object.keys(w.seats), cols = Math.max(...seats.map((x) => w.seats[x].length));
  const comps: any[] = [];
  for (const [r, seat] of seats.entries()) for (const [c, sh] of shots.filter((x) => x.seat === seat).entries()) {
    comps.push({ input: await sharp(sh.file).resize(TW, TH, { fit: "cover", position: "top" }).toBuffer(), left: c * TW, top: r * (TH + LBL) + LBL });
    const moved = !sh.landed.endsWith(sh.path.replace(/^\//, "")) ? ` → ${sh.landed.split("/").pop()}` : "";
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${LBL}"><text x="10" y="23" font-family="Helvetica" font-size="19" fill="#111">${seat} · ${sh.path}${moved}</text></svg>`), left: c * TW, top: r * (TH + LBL) });
  }
  const sheet = join(DIR, "storyboard", `walk${tag}-sheet.png`);
  await sharp({ create: { width: cols * TW, height: seats.length * (TH + LBL), channels: 3, background: "#ffffff" } }).composite(comps).png().toFile(sheet);
  if (JSON_OUT) out(JSON.stringify({ ok: true, sheet, shots }));
  else out(`${shots.length} pages → ${outDir}\nsheet → ${sheet}`);
  process.exit(0);
}

if (cmd === "freeze") {
  // one page as a persona sees it, as a still for cards: assets/freezes/<name>.png. A path is taken from capture.walk.base.
  //   freeze <project> <persona> <url|path> [--name n] [--view v] [--full] [--element css] [--wait css] [--dpr n]
  const seat = pos[2] ?? fail("which persona? (capture.personas)"), target = pos[3] ?? fail("which page? (a URL, or a path under capture.walk.base)");
  const p = d.personas?.[seat] ?? fail(`no persona "${seat}" (capture.personas: ${Object.keys(d.personas ?? {}).join(", ") || "none"})`);
  const w = d.walk, views = { ...(w?.variants ?? {}), ...(w?.views ?? {}) };
  const vname = opt("view"), v = vname ? (views[vname] ?? fail(`no view "${vname}" (capture.walk.views: ${Object.keys(views).join(", ") || "none"})`)) : {};
  const url = /^https?:/.test(target) ? target : (w?.base ?? fail("a path needs capture.walk.base (or give a full URL)")) + target.replace(/^\//, "");
  const vp = v.viewport ?? w?.viewport ?? { w: 1440, h: 810 }, dpr = Number(opt("dpr") ?? 2);
  const name = (opt("name") ?? `${seat}-${target.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}${vname ? `-${vname}` : ""}`);
  const file = join(DIR, "assets", "freezes", `${name}.png`);
  mkdirSync(dirname(file), { recursive: true });
  const r = spawnSync("sh", ["-c", p.cookies], { cwd: DIR, encoding: "utf8" });
  if (r.status !== 0) fail(`${seat}'s login failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  const { chromium } = await imp(join(PIPE, "node_modules/playwright/index.mjs"));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: dpr });
    await ctx.addCookies(JSON.parse(r.stdout.trim().split("\n").pop()!));
    const storage = { ...(w?.storage ?? {}), ...(p.storage ?? {}), ...(v.storage ?? {}) };
    if (Object.keys(storage).length) await ctx.addInitScript((kv: Record<string, string>) => { for (const [k, x] of Object.entries(kv)) localStorage.setItem(k, x); }, storage);
    // no animations or carets in a still
    await ctx.addInitScript(() => { const s = document.createElement("style"); s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scrollbar-width:none}::-webkit-scrollbar{display:none}"; document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s)); });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
    if (opt("wait")) await page.locator(opt("wait")!).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(600);
    let box = null;
    if (opt("element")) { const el = page.locator(opt("element")!).first(); await el.waitFor({ state: "visible", timeout: 30_000 }); await el.screenshot({ path: file }); box = await el.boundingBox(); }
    else await page.screenshot({ path: file, fullPage: flag("full") });
    const landed = new URL(page.url()).pathname;
    if (JSON_OUT) out(JSON.stringify({ ok: true, file, url, landed, dpr, viewport: vp, element: opt("element") ?? null, box }));
    else out(`${file}${landed !== new URL(url).pathname ? `  (redirected to ${landed})` : ""}`);
  } finally { await browser.close(); }
  process.exit(0);
}

if (cmd === "prune") {
  // delete old versions: keeps the pick, v0 (the take before Flex), and the newest --keep (default 2)
  const keepN = Number(opt("keep") ?? 2), takes = pos[2] ? [pos[2]] : journeys().map((j) => j.take);
  const removed: string[] = [];
  for (const take of takes) {
    const vs = versions(take), pick = picked(take), newest = keepN > 0 ? vs.slice(-keepN).map((x) => x.n) : [];
    for (const x of vs) if (x.n !== 0 && x.n !== pick && !newest.includes(x.n)) {
      if (flag("yes")) rmSync(x.dir, { recursive: true, force: true });
      removed.push(`${take}/v${x.n}`);
    }
  }
  if (JSON_OUT) out(JSON.stringify({ ok: true, removed, done: flag("yes") }));
  else out(removed.length ? `${flag("yes") ? "removed" : "would remove (again with --yes)"}: ${removed.join(", ")}` : "nothing to prune");
  process.exit(0);
}

if (cmd === "pick") {
  const take = pos[2] ?? fail("which take?"), v = pos[3] ?? fail("which version? (v<n>)");
  const src = join(VERS, take, v), cur = join(TAKES, take);
  if (!readEv(src)) fail(`no version ${v} of ${take}`);
  adopt(take);
  const was = picked(take), newEv = readEv(src)!;
  let edlNote = "the version's own zoom plan";
  if (was !== null) {
    // the pick's camera plan, with any edits made since it was picked, goes back to its version; the take is replaced
    const oldDir = join(VERS, take, `v${was}`);
    if (existsSync(join(cur, "edl.json"))) cpSync(join(cur, "edl.json"), join(oldDir, "edl.json"));
    rmSync(cur, { recursive: true, force: true });
    execFileSync("cp", ["-cR", src, cur]); // APFS clone: no extra disk
    const oldEdl = existsSync(join(oldDir, "edl.json")) ? JSON.parse(readFileSync(join(oldDir, "edl.json"), "utf8")) : null;
    if (oldEdl?.locked && `v${was}` !== v) {
      const e = shiftEdl(oldEdl, shifter(readEv(oldDir)!, newEv));
      e.note_flex = `camera plan carried over from v${was}, shifted by each mark's offset (${new Date().toISOString().slice(0, 10)})`;
      writeFileSync(join(cur, "edl.json"), JSON.stringify(e, null, 1));
      edlNote = `v${was}'s locked camera plan, shifted by each mark's offset`;
    }
  } else execFileSync("cp", ["-cR", src, cur]);
  writeFileSync(join(cur, ".flex-version"), v.slice(1));
  rmSync(join(cur, "version.json"), { force: true });
  if (JSON_OUT) out(JSON.stringify({ ok: true, take, picked: v, edl: edlNote })); else out(`takes/${take} is now ${v} (${edlNote})`);
  process.exit(0);
}

if (cmd === "run") {
  const name = pos[2] ?? fail("which journey?");
  const j = journeys().find((x) => x.name === name || x.take === name) ?? fail(`no journey "${name}" (journeys/<name>.ts exporting take)`);
  const jd = d.journeys?.[j.name] ?? {}, dry = flag("dry"), st = readState(d);
  if (!dry && jd.needs && jd.needs !== st.state && !flag("force"))
    fail(`${j.name} needs the data state "${jd.needs}" (${d.states?.[jd.needs] ?? ""}); it is ${st.state ?? "unknown"}. Stage it (flex stage), or --force.`, { needsState: jd.needs, state: st.state });
  if (!dry && jd.writes && !flag("yes")) fail(`${j.name} writes to the app's data: ${jd.writes.confirm}. Run again with --yes to go ahead.`, { needsConfirm: jd.writes.confirm });

  const dpr = Number(opt("dpr") ?? d.dpr ?? 2);
  process.env.CAPTURE_DPR = String(dpr);
  process.env.FLEX_DRY = join(process.env.FLEX_SUPPORT ?? tmpdir(), "dry", basename(DIR));
  if (!dry) adopt(j.take);
  const n = nextN(j.take), vdir = join(VERS, j.take, `v${n}`);
  if (!dry) mkdirSync(vdir, { recursive: true });
  pipelineEnv({ [j.take]: vdir });
  const { capture } = await imp(join(PIPE, "lib/capture.ts"));
  const { planTake } = await imp(join(PIPE, "lib/plan.ts"));
  const mod = await imp(j.file);

  const t0 = Date.now();
  try {
    if (dry || !flag("no-warm")) {
      console.error(dry ? `==> dry run: ${j.name}` : `==> warm-up (a dry run, so the app's pages and servers are warm): ${j.name}`);
      await capture(mod.take, mod.run, { dry: true });
    }
    if (dry) {
      const dd = join(process.env.FLEX_DRY, j.take), r = report(dd, null);
      if (JSON_OUT) out(JSON.stringify({ ok: true, dry: true, dir: dd, ...r })); else { printReport(`${j.name} (dry)`, r); out(`dry run ok · screenshots → ${dd}`); }
      process.exit(0);
    }
    if (jd.writes) Object.assign(process.env, jd.writes.env);
    console.error(`==> capture: ${j.name} → takes/.versions/${j.take}/v${n} at ${dpr}×`);
    process.stderr.write(`@flex ${JSON.stringify({ recording: vdir })}\n`); // the app's live view watches its frames
    await capture(mod.take, mod.run, {});
  } catch (e) {
    if (!dry) rmSync(vdir, { recursive: true, force: true });
    fail(`${j.name}: ${String((e as Error)?.message ?? e).split("\n")[0]}`);
  }

  // the zoom plan for this capture (kept as edl.auto.json); the film keeps its own locked plan, carried over at pick
  planTake(j.take);
  const cur = join(TAKES, j.take);
  if (existsSync(join(vdir, "edl.json"))) cpSync(join(vdir, "edl.json"), join(vdir, "edl.auto.json"));
  const curEdl = existsSync(join(cur, "edl.json")) ? JSON.parse(readFileSync(join(cur, "edl.json"), "utf8")) : null;
  const notes = d.retime === "clicks" ? retime(vdir) : [];
  if (curEdl?.locked && readEv(cur)) writeFileSync(join(vdir, "edl.json"), JSON.stringify(shiftEdl(curEdl, shifter(readEv(cur)!, readEv(vdir)!)), null, 1));
  if (jd.gives) writeState({ state: jd.gives, script: `journey ${j.name}`, at: new Date().toISOString() });

  const r = report(vdir, readEv(cur) ? cur : null);
  const meta = { n, at: new Date().toISOString(), journey: j.name, dpr, duration: r.duration, frames: r.frames, late: r.late, worst: r.worst, state: st.state, seconds: Math.round((Date.now() - t0) / 1000) };
  writeFileSync(join(vdir, "version.json"), JSON.stringify(meta, null, 1));
  writeFileSync(join(vdir, "report.json"), JSON.stringify(r, null, 1));
  if (JSON_OUT) out(JSON.stringify({ ok: true, take: j.take, version: `v${n}`, dir: vdir, retime: notes, ...meta, report: r }));
  else {
    for (const x of notes) console.error(`  retime: ${x}`);
    printReport(`${j.take} v${n}`, r);
    out(`captured ${j.take} v${n} (${r.late} late beat(s)) → ${vdir}\n  pick it: flex pick ${projArg} ${j.take} v${n}`);
  }
  process.exit(0);
}

fail(`unknown command ${cmd}`);
