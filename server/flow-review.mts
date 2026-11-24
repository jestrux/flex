// flex review: an app's flow as a live screen canvas (flex screens --index-only, then flex mockup --canvas), served on
// localhost so the author can pin notes to its frames and send them, a round at a time, to the agent working on the app.
//   flow-review.mts <flow.json | folder> [--base url] [--port n] [--no-open]
//   flow-review.mts wait <flow.notes.json> [--since round] [--timeout seconds]
// A folder serves every flow in it (*.json with "screens"), switched by the picker on the flow's name (lists.json).
// A project (.flex/project.json, found walking up) gives the flows their defaults, and with no flow named, its flows
// folder is served (see findProject).
// The page's top bar shows the product's logo: the flow's "logo" (an SVG or PNG, relative to the flow), else a
// logo.svg or logo.png beside the flows.
// The notes live beside the flow: <flow>.notes.json { flow, notes: [...], rounds: [...] }, and a note's screenshots in
// <flow>.notes/<id>.png (the frame's screen, captured as the frame shows it: the device's size, safe areas and theme)
// and <id>.crop.png (around the point, marked). The agent edits the notes file too (replies, resolved), so every write
// re-reads it and applies only its own change, then writes it whole (temp file and rename), and never if the file
// changed under it meanwhile (it tries again). Fields it doesn't know are kept.
// A note keeps the frame's seed link (link) and where the author had got to in it (at: the frame's path and query, the
// frames being the app proxied on this server's origin); its screenshot is that page, reached from the seed.
// Environments (the project's "environments", or an older single "staging"): the page's Data switch shows the app as
// served by one of them (its own build, signed in to that environment's gateway) instead of the project's own base
// ("static"), through this server (see proxy and envToken). Tester tools (tester=0|1 on every frame link) hides or shows
// the app's tester aids, and the flow's "tester": true screens and states. Notes and snapshots are kept per data mode
// and tester setting and signal (offline=0|1 on every frame link; a flow's "signal": false screens and states always
// offline): a view's variant, "<mode>.t<0|1>.s<0|1>.p-<person>" (s1: signal on). Flows follow the project's "order".
// Signed in as: the project's "people"; a flow's "person" (its default, null: signed out) and "people" (who it offers),
// a screen's or state's own overriding them. Flex puts signin=<person> (or signout=1) into each frame's link; a link
// that already says signin= keeps it. The person picked in the page applies where a screen offers them; elsewhere the
// screen's default.
// The agent sets the file's top-level "build" (a timestamp) once the app is rebuilt after a round: the page reloads
// every frame when it changes. A note records the language the page showed (lang, as theme), and is captured in it.
// A note is a draft until Send: that stamps the drafts (and the author's new replies) with the next round and appends
// { round, sentAt, notes } to rounds. `wait` blocks until a round past --since (default: the latest when it starts)
// is in the file, prints it as JSON and exits 0; at --timeout it prints nothing and exits 3.
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { deviceFor, type Dev } from "./devices.mts";
import { homePage } from "./review.mts";

const PIPE = process.env.FLEX_PIPELINE!;
const HERE = dirname(fileURLToPath(import.meta.url));
const out = ((w) => (s: string) => w(s + "\n"))(process.stdout.write.bind(process.stdout));
console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");

const argv = process.argv.slice(2), flag = (f: string) => argv.includes(`--${f}`);
const VALUED = ["--base", "--port", "--since", "--timeout", "--prefix", "--jobs", "--scale", "--quality", "--capture-set", "--screen", "--state", "--title"];
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const inputs = argv.filter((a, i) => !a.startsWith("-") && !(i > 0 && VALUED.includes(argv[i - 1])));
const fail = (m: string): never => { console.error(`!! ${m}`); process.exit(1); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── the notes file ── */
type Reply = { by: "claude" | "author"; text: string; at: string; round?: number | null };
type Note = { id: string; n: number; flow: string; screen: string; state: string | null; device: string; theme: string; lang?: string; mode?: string; tester?: number; offline?: number; person?: string | null; x: number; y: number; text: string; by: "author";
  createdAt: string; round: number | null; resolved: boolean; replies: Reply[]; link?: string; at?: string; screenshot?: string; crop?: string; captureError?: string; [k: string]: unknown };
type Doc = { flow: string; notes: Note[]; rounds: { round: number; sentAt: string; notes: string[] }[]; [k: string]: unknown };
/** e2e/web/flows/auth.json → auth.notes.json beside it (a notes file as it is) */
const notesFileOf = (flowFile: string) => (flowFile.endsWith(".notes.json") ? flowFile : flowFile.replace(/\.json$/, "") + ".notes.json");
const flowFileOf = (notesFile: string) => notesFile.replace(/\.notes\.json$/, ".json");
/** the file as it is now (null: not there yet); a half-written edit (invalid JSON) throws, and the caller tries again */
function readDoc(file: string): { text: string | null; doc: Doc } {
  const text = existsSync(file) ? readFileSync(file, "utf8") : null;
  const doc = text ? JSON.parse(text) : { flow: basename(file).replace(/\.notes\.json$/, ""), notes: [], rounds: [] };
  doc.notes ??= []; doc.rounds ??= [];
  return { text, doc };
}
/** one change to the notes file: read it fresh, apply, write a temp file and rename it over, unless the file changed
 *  meanwhile (the agent saving a reply): then again from the top */
async function update(file: string, change: (d: Doc) => void): Promise<Doc> {
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    try {
      const { text, doc } = readDoc(file);
      change(doc);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");
      const now = existsSync(file) ? readFileSync(file, "utf8") : null;
      if (now !== text) { unlinkSync(tmp); await sleep(60); continue; }
      renameSync(tmp, file);
      return doc;
    } catch (e) { last = e; await sleep(150); }
  }
  throw new Error(`couldn't write ${file}: ${(last as Error)?.message ?? "it kept changing"}`);
}
const latestRound = (d: Doc) => d.rounds.reduce((m, r) => Math.max(m, r.round), 0);

/* ── the project: .flex/project.json, found walking up from the flows (or the folder flex review runs in). It names the
   product (name; project, the review's path prefix; logo, beside it) and gives every flow its defaults (base, devices),
   where the flows are (flows, default .flex/flows) and the port. A flow's own fields win. ── */
type Env = { label?: string; base: string; api?: { path: string; target: string }; login?: { url: string; token?: string }; accounts?: Record<string, { email: string; password: string }>; env?: string };
type Project = { dir: string; flows: string; name?: string; project?: string; logo?: string; base?: string; devices?: string[]; port?: number; ready?: { selector?: string };
  environments?: Record<string, Env>; staging?: Env; env?: string; order?: string[]; people?: Record<string, { name: string; role?: string }>;
  setup?: { command: string; cwd?: string; ttl?: number; writes?: boolean }; proxies?: Record<string, string>; signinParam?: string; signoutParam?: string | null;
  system?: { appName?: string; contacts?: { name: string; phones?: string[]; photo?: string | null }[]; permissions?: Record<string, string | Record<string, string>> };
  tags?: Record<string, { label?: string; color?: string } | null> };
const HOME = process.env.FLEX_REVIEW_CWD ?? process.cwd();
/* fields Flex doesn't know are said once (a typo, or a field of a newer Flex), never an error; "_" fields are notes */
const KNOWN = {
  project: "name project logo base devices flows port ready environments staging env order people setup proxies signinParam signoutParam clock clockTicks system tags",
  flow: "title label base devices logo project screens person people publish setup storage actions numberFrom themes description clock clockTicks peek keywords tags",
  screen: "name label path url description states axes status devices defaultLabel tester signal person people setup storage actions clock clockTicks expect use as only system keywords tags",
  state: "name label path url description status devices tester signal person people setup storage actions params clock clockTicks expect system keywords tags" };
const warned = new Set<string>();
function unknownFields(file: string, kind: keyof typeof KNOWN, o: any, where = "") {
  if (!o || typeof o !== "object" || Array.isArray(o)) return;
  const known = new Set(KNOWN[kind].split(" "));
  for (const k of Object.keys(o)) if (!k.startsWith("_") && !known.has(k)) {
    const w = `${file}|${where}|${k}`;
    if (!warned.has(w)) { warned.add(w); console.error(`!! ${basename(file)}: unknown field "${k}"${where ? ` in ${where}` : ""} (ignored; a typo, or a newer Flex's?)`); }
  }
}
/* ── "use": a flow that shows another flow's screens instead of copying them ──
   A screen entry { "use": "account" } brings in every screen of account.json (beside this flow), with its states,
   tagged with that flow's title as their "group": the board shows them as ONE item of this flow, a tile like a
   screen's, that opens on those screens the way a screen opens on its states; { "use":
   "account/nida" } brings one of its screens as it is. Either may take its own "label" (a whole flow's: its group's). They come with their states, and with what their
   own flow set for all its screens (person, people, setup, storage, actions, clock) unless they set it themselves, so
   they run exactly as they do at home. Uses can nest; a loop or a name used twice is an error. */
const FROM_FLOW = ["person", "people", "setup", "storage", "actions", "clock", "clockTicks"];
/** where a flow's uses are: beside it, or for a peek (in cache/) the project's flows it names */
const usesDir = (file: string, j: any) => (typeof j?.peek?.from === "string" ? resolve(dirname(file), j.peek.from) : dirname(file));
function readFlow(file: string, seen: string[] = []): any {
  const j = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(j?.screens)) return j;
  const here = [...seen, resolve(file)], out: any[] = [];
  for (const s of j.screens) {
    if (!s || typeof s.use !== "string") { out.push(s); continue; }
    const [flow, screen] = s.use.split("/"), src = join(usesDir(file, j), flow + ".json");
    if (!existsSync(src)) throw new Error(`${basename(file)}: "use": "${s.use}": no flow ${flow}.json beside it`);
    if (here.includes(resolve(src))) throw new Error(`${basename(file)}: "use": "${s.use}" loops back to ${basename(src)}`);
    const u = readFlow(src, here);
    const inherit = (x: any) => ({ ...Object.fromEntries(FROM_FLOW.filter((k) => k in u && !(k in x)).map((k) => [k, u[k]])), ...x });
    if (screen) {
      const x = (u.screens ?? []).find((y: any) => y.name === screen);
      if (!x) throw new Error(`${basename(file)}: "use": "${s.use}": ${flow} has no screen "${screen}"`);
      // "as": another name (two flows' screens of one name, side by side); "only": just those of its states
      const only = Array.isArray(s.only) ? s.only : null;
      out.push({ ...inherit(x), ...(s.as ? { name: s.as } : {}), ...(only ? { states: (x.states ?? []).filter((st: any) => only.includes(st?.name)) } : {}), ...(s.label ? { label: s.label } : {}) });
    } else for (const x of u.screens ?? []) out.push({ ...inherit(x), group: s.label ?? u.title ?? flow });
  }
  const names = new Set<string>();
  for (const x of out) { if (names.has(x?.name)) throw new Error(`${basename(file)}: two screens named "${x.name}" (one of them from a "use")`); names.add(x?.name); }
  return { ...j, screens: out };
}
/** how many items a flow shows: its screens, a used flow's (its "group") counting once, as the board draws it */
const items = (screens: any[]) => screens.filter((s, i) => !s?.group || screens[i - 1]?.group !== s.group).length;
/** every flow file a flow reads through its uses, itself first (for "has it changed?") */
function flowFiles(file: string, seen: string[] = []): string[] {
  let j: any; try { j = JSON.parse(readFileSync(file, "utf8")); } catch { return [file]; }
  const here = [...seen, resolve(file)], files = [file];
  for (const s of j?.screens ?? []) if (s && typeof s.use === "string") {
    const src = join(usesDir(file, j), s.use.split("/")[0] + ".json");
    if (existsSync(src) && !here.includes(resolve(src))) files.push(...flowFiles(src, here));
  }
  return files;
}
const flowStamp = (file: string) => flowFiles(file).map(mtime).join(",");
function flowFields(file: string) {
  let j: any; try { j = JSON.parse(readFileSync(file, "utf8")); } catch { return; }
  unknownFields(file, "flow", j);
  for (const s of j.screens ?? []) { unknownFields(file, "screen", s, `screen "${s?.name}"`); systemField(file, s, `screen "${s?.name}"`); for (const st of s?.states ?? []) { unknownFields(file, "state", st, `state "${s?.name}@${st?.name}"`); systemField(file, st, `state "${s?.name}@${st?.name}"`); } }
  tagFields(file, j, "the flow");
  for (const s of j.screens ?? []) { tagFields(file, s, `screen "${s?.name}"`); for (const st of s?.states ?? []) tagFields(file, st, `state "${s?.name}@${st?.name}"`); }
}
/* "tags" (a flow's, screen's or state's): chips on the board and filters in ⌘K (#form). Flex's defaults are always
   there; the project's "tags" adds its own and may relabel or recolour a default ({ label, color }), or turn one off
   (null). A tag in neither shows neutral and is said once, as an unknown field is. "keywords": the words people search
   for that the label doesn't say (⌘K ranks a keyword hit above a fuzzy one) */
const DEFAULT_TAGS: Record<string, { label: string; color: string }> = {
  form: { label: "Form", color: "#2563eb" }, list: { label: "List", color: "#0891b2" }, detail: { label: "Detail", color: "#7c3aed" },
  dashboard: { label: "Dashboard", color: "#4f46e5" }, map: { label: "Map", color: "#059669" }, prompt: { label: "Prompt", color: "#d97706" },
  sheet: { label: "Sheet", color: "#0d9488" }, share: { label: "Share", color: "#db2777" }, success: { label: "Success", color: "#16a34a" },
  error: { label: "Error", color: "#dc2626" }, empty: { label: "Empty", color: "#64748b" }, offline: { label: "Offline", color: "#57534e" },
  system: { label: "System", color: "#475569" }, public: { label: "Public", color: "#0284c7" }, payment: { label: "Payment", color: "#c2410c" } };
function tagsMap(): Record<string, { label: string; color: string }> {
  const out = { ...DEFAULT_TAGS }, pt = proj()?.tags;
  if (pt && typeof pt === "object" && !Array.isArray(pt)) for (const [k, v] of Object.entries(pt)) {
    if (v === null) { delete out[k]; continue; }
    if (!v || typeof v !== "object") continue;
    out[k] = { label: typeof v.label === "string" ? v.label : out[k]?.label ?? k, color: typeof v.color === "string" ? v.color : out[k]?.color ?? "#8a8794" };
  }
  return out;
}
const tagsJson = () => JSON.stringify(tagsMap()).replace(/</g, "\\u003c");
/** a field's strings ("keywords", "tags"): a list of non-empty strings, anything else nothing */
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);
function tagFields(file: string, o: any, where: string) {
  if (!o || typeof o !== "object") return;
  const known = tagsMap();
  for (const k of ["keywords", "tags"]) if (o[k] !== undefined && !Array.isArray(o[k])) {
    const w = `${file}|${where}|${k}|list`;
    if (!warned.has(w)) { warned.add(w); console.error(`!! ${basename(file)}: "${k}" in ${where} isn't a list of words (ignored)`); }
  }
  for (const t of strList(o.tags)) if (!known[t]) {
    const w = `${file}|tag|${t}`;
    if (!warned.has(w)) { warned.add(w); console.error(`!! ${basename(file)}: unknown tag "${t}" in ${where} (shown neutral; add it to .flex/project.json "tags", or a typo?)`); }
  }
}
/* "system": the OS's own UI the board draws over a screen or state (server/system.mts): "contacts", { "show":
   "contacts" } or { "show": "permission", "for": one of SYSTEM_FOR }. One Flex doesn't draw is said once, as an unknown
   field is (the board draws nothing for it) */
const SYSTEM_SHOWS = ["contacts", "permission"], SYSTEM_FOR = ["contacts", "photos", "camera", "location", "notifications"];
function systemField(file: string, o: any, where: string) {
  if (!o || typeof o !== "object" || o.system === undefined) return;
  const v = typeof o.system === "string" ? { show: o.system } : o.system;
  const bad = !v || typeof v !== "object" || !SYSTEM_SHOWS.includes(v.show) ? `"system": ${JSON.stringify(o.system)} (Flex draws ${SYSTEM_SHOWS.join(", ")})`
    : v.show === "permission" && !SYSTEM_FOR.includes(v.for) ? `"system": a permission "for": ${JSON.stringify(v.for)} (one of ${SYSTEM_FOR.join(", ")})` : null;
  const w = `${file}|${where}|system|${JSON.stringify(o.system)}`;
  if (bad && !warned.has(w)) { warned.add(w); console.error(`!! ${basename(file)}: ${bad} in ${where} (nothing drawn; a typo, or a newer Flex's?)`); }
}
/** the page's system screens' data (FLEXSYSTEM): the project's "system" (appName, contacts, permissions), the app's
 *  name defaulting to the project's */
const systemJson = () => { const pj = proj(), s: NonNullable<Project["system"]> = pj?.system && typeof pj.system === "object" ? pj.system : {};
  return JSON.stringify({ appName: typeof s.appName === "string" ? s.appName : pj?.name ?? null, contacts: Array.isArray(s.contacts) ? s.contacts : null, permissions: s.permissions ?? {} }).replace(/</g, "\\u003c"); };
function findProject(from: string): Project | null {
  for (let d = resolve(from); ; d = dirname(d)) {
    const f = join(d, ".flex", "project.json");
    if (existsSync(f)) {
      let j: any;
      try { j = JSON.parse(readFileSync(f, "utf8")); } catch (e) { fail(`${f}: ${(e as Error).message}`); }
      const dir = join(d, ".flex");
      unknownFields(f, "project", j);
      return { ...j, dir, flows: resolve(dir, j.flows ?? "flows"), logo: j.logo ? resolve(dir, j.logo) : undefined };
    }
    if (dirname(d) === d) return null;
  }
}

/* ── wait: block until the author sends a round ── */
if (inputs[0] === "wait") {
  const given = resolve(notesFileOf(inputs[1] ?? fail("flex review wait <flow.notes.json | flow>")));
  // a flow's name alone, inside a project: its notes in the project's flows
  const P = existsSync(given) || existsSync(flowFileOf(given)) ? null : findProject(HOME);
  const file = P ? join(P.flows, basename(given)) : given;
  const read = () => { try { return readDoc(file).doc; } catch { return null; } };
  const since = opt("--since") !== undefined ? +opt("--since")! : latestRound(read() ?? ({ rounds: [] } as unknown as Doc));
  const until = opt("--timeout") ? Date.now() + +opt("--timeout")! * 1000 : Infinity;
  let doc: Doc | null = null, round: Doc["rounds"][number] | undefined;
  while (!round) {
    if (Date.now() > until) process.exit(3);
    doc = read();
    round = doc?.rounds.filter((r) => r.round > since).sort((a, b) => a.round - b.round)[0];
    if (!round) await sleep(1000);
  }
  // a note sent the moment it was made may still be capturing: give its screenshot a little while
  for (let i = 0; i < 30; i++) {
    const ns = doc!.notes.filter((n) => round!.notes.includes(n.id));
    if (ns.every((n) => n.screenshot || n.captureError)) break;
    await sleep(1000);
    doc = read() ?? doc;
  }
  const dir = dirname(file);
  let labels: Record<string, string> = {};
  try { labels = Object.fromEntries((readFlow(flowFileOf(file)).screens ?? []).map((s: any) => [s.name, s.label ?? s.name])); } catch { /* no flow beside it */ }
  const notes = doc!.notes.filter((n) => round!.notes.includes(n.id)).map((n) => ({
    ...n, label: labels[n.screen] ?? n.screen, screenshot: n.screenshot ? join(dir, n.screenshot) : null, crop: n.crop ? join(dir, n.crop) : null }));
  out(JSON.stringify({ flow: doc!.flow, notesFile: file, round: round.round, sentAt: round.sentAt, notes }, null, 2));
  process.exit(0);
}

/* ── peek: a temporary flow of screens from any of the project's flows, to look at a few together. It lives in
   cache/peek/_peek.json (never committed, not one of the project's flows) and shows first on the board, marked
   Temporary, until dismissed there, replaced by the next peek, or cleared. Its screens are "use"s of their flows; a
   note made on it goes to the flow the screen comes from.
     flex review peek <flow | flow/screen | flow/screen@state[,state]>… [--title t]   (a flow may be a glob: safari-*)
     flex review peek --clear ── */
const PEEK = "_peek";
const peekFileOf = (dir: string) => join(dir, "cache", "peek", PEEK + ".json");
/** a peek written: its file from refs (flow | flow/screen | flow/screen@state[,state], a flow may be a glob) and a
 *  title, over any peek there was. Shared by flex review peek and the board's ⌘K (⇧↵, POST /api/peek); a bad ref throws */
function writePeek(P: Project, refs: string[], title: string): { title: string; count: number; slug: string } {
  const file = peekFileOf(P.dir);
  const names = readdirSync(P.flows).filter((n) => n.endsWith(".json") && !n.endsWith(".notes.json")).map((n) => n.replace(/\.json$/, ""));
  const glob = (g: string) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  const no = (m: string): never => { throw new Error(m); };
  const read = (n: string) => readFlow(join(P.flows, n + ".json"));
  const screens: any[] = [], taken = new Map<string, string>();
  let first: any = null;
  const take = (name: string, by: string) => { const was = taken.get(name); taken.set(name, by); return was; };
  for (const ref of refs) {
    const [fl, rest] = ref.split("/"), [sc, sts] = (rest ?? "").split("@");
    const hits = fl.includes("*") || fl.includes("?") ? names.filter((n) => glob(fl).test(n)) : names.includes(fl) ? [fl] : [];
    if (!hits.length) no(`${ref}: no flow ${fl} in ${P.flows}${fl.includes("*") ? "" : ` (flows: ${names.join(", ")})`}`);
    if (rest && hits.length > 1) no(`${ref}: a glob names whole flows, not a screen in each`);
    for (const n of hits) {
      const j = read(n);
      first ??= j;
      if (!sc) {
        for (const x of j.screens) { const was = take(x.name, n); if (was) no(`${ref}: its screen "${x.name}" is also ${was}'s: name that one's screens one by one (flow/screen) instead`); }
        screens.push({ use: n });
        continue;
      }
      const x = j.screens.find((y: any) => y.name === sc) ?? no(`${ref}: ${n} has no screen "${sc}" (it has ${j.screens.map((y: any) => y.name).join(", ")})`);
      const only = sts ? sts.split(",").filter(Boolean) : null;
      for (const st of only ?? []) if (!(x.states ?? []).some((y: any) => y.name === st)) no(`${ref}: ${n}/${sc} has no state "${st}" (it has ${(x.states ?? []).map((y: any) => y.name).join(", ") || "none"})`);
      // two flows' screens of one name: the later one is named for its flow
      const as = taken.has(sc) ? `${n}-${sc}` : undefined;
      take(as ?? sc, n);
      screens.push({ use: `${n}/${sc}`, ...(as ? { as } : {}), ...(only ? { only } : {}) });
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  // the flows' own base and devices when the project has none (a flow's base is the app it shows)
  writeFileSync(file, JSON.stringify({ title, ...(P.base ? {} : { base: first?.base }), ...(P.devices || !first?.devices ? {} : { devices: first.devices }),
    peek: { from: relative(dirname(file), P.flows), at: new Date().toISOString(), refs }, screens }, null, 2) + "\n");
  rmSync(join(P.dir, "cache", "snapshots", PEEK), { recursive: true, force: true });
  return { title, count: screens.length, slug: P.project ?? first?.project ?? "_flex" };
}
if (inputs[0] === "peek") {
  const P = findProject(HOME) ?? fail("flex review peek works in a project (.flex/project.json)");
  const file = peekFileOf(P.dir);
  if (flag("clear")) { rmSync(dirname(file), { recursive: true, force: true }); rmSync(join(P.dir, "cache", "snapshots", PEEK), { recursive: true, force: true }); out("peek cleared"); process.exit(0); }
  const refs = inputs.slice(1);
  if (!refs.length) fail("flex review peek <flow | flow/screen | flow/screen@state>… [--title t] (or --clear)");
  let made: ReturnType<typeof writePeek>;
  try { made = writePeek(P, refs, opt("--title") ?? "Peek"); } catch (e) { fail((e as Error).message); }
  const { title, count, slug } = made!;
  out(`peek "${title}": ${count} item${count === 1 ? "" : "s"} → http://localhost:${P.port ?? 4870}/${slug}/f/${PEEK}/`);
  out("  on the board while flex review runs; dismiss it there, or flex review peek --clear");
  process.exit(0);
}

/* ── the flows ── */
type Flow = { name: string; file: string; label: string; base: string; logo: string | null; project: string | null; devices: string[] | null; own: boolean };
// no flow named: the project's flows, from the folder flex review runs in
// export <out-dir>: the project's review as a static site (see exportSite); the project is found from here
const EXPORT = inputs[0] === "export" ? (inputs.splice(0, 2)[1] ?? fail("flex review export <out-dir>")) : null;
// resnap [flow]: the project's snapshots (a flow's; --screen, --state) taken again; those of screens and states gone removed
// check [flow]: a resnap that answers yes or no: every frame of the default view (--all: every theme, language and
// signal) taken, with its setup and actions, each one that failed listed, and exit 1 if any did or a flow doesn't build
const CHECK = inputs[0] === "check", RESNAP = inputs[0] === "resnap" || CHECK, RFLOW = RESNAP ? inputs.splice(0, 2)[1] ?? null : null;
let P = inputs[0] ? findProject(existsSync(resolve(inputs[0])) && statSync(resolve(inputs[0])).isDirectory() ? resolve(inputs[0]) : dirname(resolve(inputs[0]))) : findProject(HOME);
const target = inputs[0] ? resolve(inputs[0]) : P?.flows ?? fail("name a flow (flex review <flow.json | folder>), or run it in a project with .flex/project.json (flex review --help)");
if (!existsSync(target)) fail(`no such file or folder: ${inputs[0] ?? target}`);
/** the project as it is now: read again when its project.json changes (its logo, name, defaults; the prefix and port
 *  stay as the server started) */
const mtime = (f?: string | null) => { try { return f ? statSync(f).mtimeMs : 0; } catch { return 0; } };
let Pat = mtime(P && join(P.dir, "project.json"));
// the board's own ignore rules, beside it (it travels with the folder), before anything is written to cache/: the
// snapshots run to hundreds of MB. The notes travel; their screenshots are re-taken. An existing .gitignore is left alone
if (P && !existsSync(join(P.dir, ".gitignore"))) {
  try { writeFileSync(join(P.dir, ".gitignore"), "# flex review: the snapshots and the notes' screenshots are re-taken; <flow>.notes.json is kept\ncache/\nflows/*.notes/\n"); } catch { /* read-only */ }
}
const proj = (): Project | null => {
  if (!P) return null;
  const at = mtime(join(P.dir, "project.json"));
  if (at && at !== Pat) { Pat = at; P = findProject(dirname(P.dir)) ?? P; }
  return P;
};
const asFlow = (file: string): Flow | null => {
  let j: any;
  try { j = readFlow(file); } catch (e) { console.error(`!! ${(e as Error).message}`); return null; }
  if (!Array.isArray(j?.screens)) return null;
  const P = proj(), base = (opt("--base") ?? j.base ?? P?.base)?.replace(/\/$/, "");
  // the product's logo for the page's top bar: the flow's "logo" (beside it), else a logo.svg or logo.png beside the
  // flows, else the project's
  const logo = [j.logo && resolve(dirname(file), j.logo), join(dirname(file), "logo.svg"), join(dirname(file), "logo.png"), P?.logo].find((f) => f && existsSync(f)) ?? null;
  // the product, for the review's address (/<project>/f/<flow>/): a short slug the app never uses as a route
  const slug = j.project ?? P?.project;
  const project = typeof slug === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(slug) ? slug : null;
  return { name: basename(file).replace(/\.json$/, ""), file, label: j.title ?? j.label ?? basename(file).replace(/\.json$/, ""), base, logo, project,
    devices: j.devices ?? P?.devices ?? null, own: !!j.devices };
};
/** a folder's flow files: the project's "order" first, then the rest alphabetically */
const ordered = (names: string[]) => { const o = proj()?.order ?? [], at = (n: string) => { const i = o.indexOf(n.replace(/\.json$/, "")); return i < 0 ? o.length : i; };
  return names.sort().sort((a, b) => at(a) - at(b)); };
/** the peek, while the board is served (not exported, resnapped or checked) */
const peekFlow = (): Flow | null => { const f = P && !EXPORT && !RESNAP ? peekFileOf(P.dir) : null; return f && existsSync(f) ? asFlow(f) : null; };
const isPeek = (f: Flow) => f.name === PEEK;
const flows = (): Flow[] => statSync(target).isDirectory()
  ? [peekFlow(), ...ordered(readdirSync(target).filter((n) => n.endsWith(".json") && !n.endsWith(".notes.json"))).map((n) => asFlow(join(target, n)))].filter((f): f is Flow => !!f)
  : [asFlow(target) ?? fail(`${inputs[0]}: not a flow (a json with "screens")`)];
if (!flows().length) fail(`${inputs[0]}: no flows in it (*.json with "screens")`);
for (const f of flows()) if (!f.base) fail(`${f.file}: no base (give one in the json or --base)`);

/* the canvas for a flow, built again whenever its file changes: its index (flex screens --index-only), then the page
   (flex mockup --canvas, its notes on), its frames loading the app through this server (the proxy below) */
const WORK = mkdtempSync(join(tmpdir(), "flex-review-"));
const tsx = join(PIPE, "node_modules/.bin/tsx");
const built = new Map<string, string>();
/** the index the canvas was built from: each frozen name's link (and devices), the devices and themes */
const indexes = new Map<string, { links: Record<string, { path: string; devices?: string[] }>; devices: string[]; themes?: string[]; screens?: { name: string; label?: string }[] }>();
/** each built page's version: this server's boot and the page as built, so the open page reloads itself when either
 *  changes (a new Flex, the flow, the project or its logo edited, the server restarted) */
const BOOT = `${process.pid}-${Date.now()}`;
const versions = new Map<string, string>();
function build(f: Flow): string {
  const page = join(WORK, "f", f.name, "index.html");
  const at = [flowStamp(f.file), ...[f.logo, P && join(P.dir, "project.json"), join(HERE, "review.mts"), join(HERE, "system.mts"), join(HERE, "mockup.mts")].map(mtime)].join("|");
  if (built.get(f.name) === at && existsSync(page)) return page;
  const idx = join(WORK, "index", f.name);
  flowFields(f.file);
  const run = (script: string, args: string[]) => {
    const r = spawnSync(tsx, [join(HERE, script), ...args], { cwd: PIPE, env: process.env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${script}: ${(r.stderr || r.stdout).trim()}`);
  };
  // screens.mts reads the flow with its uses expanded (a copy, named as the flow so its labels read the same)
  const expanded = join(WORK, "flows", basename(f.file));
  mkdirSync(dirname(expanded), { recursive: true });
  writeFileSync(expanded, JSON.stringify(readFlow(f.file)));
  run("screens.mts", [expanded, "-o", idx, "--index-only", "--base", f.base, ...(!f.own && f.devices ? ["--device", f.devices.join(",")] : [])]);
  const pj = proj();
  run("mockup.mts", [idx, "--canvas", "/", "-o", dirname(page), "--notes", f.name, "--title", f.label, ...(f.logo ? ["--logo", f.logo] : []), ...(pj?.name ? ["--product", pj.name] : [])]);
  indexes.set(f.name, JSON.parse(readFileSync(join(idx, "index.json"), "utf8")));
  built.set(f.name, at);
  versions.set(f.name, createHash("sha1").update(BOOT).update(readFileSync(page)).update(JSON.stringify([proj()?.ready ?? null, envList(), testerNames(f), [...signalOff(f)], proj()?.people ?? null, [...personInfo(f)], [...setupOf(f).keys()], paramsJson(), systemJson(), tagsJson()])).digest("hex").slice(0, 16));
  return page;
}
const version = (f: Flow) => { build(f); return versions.get(f.name)!; };
/** a frame's link as the canvas loads it: the flow's path for that screen or state, its theme, a handheld's safe areas,
 *  and the language the page shows (lang= set, or added) */
function linkOf(f: Flow, screen: string, state: string | null, device: string, theme: string, lang?: string, variant = "static.t0.s1"): string | undefined {
  const l = indexes.get(f.name)?.links[state ? `${screen}@${state}` : screen], d = deviceFor(device);
  if (!l || !d) return undefined;
  let url = /^https?:/.test(l.path) ? l.path : f.base + l.path;
  if (lang) url = /[?&]lang=[^&]*/.test(url) ? url.replace(/([?&])lang=[^&]*/, `$1lang=${lang}`) : url + (url.includes("?") ? "&" : "?") + `lang=${lang}`;
  const sep = url.includes("?") ? "&" : "?";
  url += `${sep}scheme=${theme}` + (d.touch ? `&insets=${d.top},${d.bottom}` : "");
  // tester tools, on or off
  const name = state ? `${screen}@${state}` : screen, [mode, t, sg, pv] = personFix(f, name, variant).split("."), set = (u: string, k: string, v: number) => (new RegExp(`[?&]${k}=[^&]*`).test(u) ? u.replace(new RegExp(`([?&])${k}=[^&]*`), `$1${k}=${v}`) : u + `&${k}=${v}`);
  url = set(url, "tester", t === "t1" ? 1 : 0);
  // signal: on (offline=0), off (offline=1); a "signal": false screen or state is always offline
  url = set(url, "offline", sg === "s0" || signalOff(f).has(name) ? 1 : 0);
  // signed in as the frame's person (before to=, which the seed follows last), or signed out; a link with signin= keeps it
  const who = pv && pv !== "p-link" ? pv.slice(2) : null;
  const so = SIGNOUT();
  if (who && !hasParam(url, SIGNIN()) && (who !== "none" || so)) {
    const add = who === "none" ? `${so}=1` : `${SIGNIN()}=${who}`;
    url = /[?&]to=/.test(url) ? url.replace(/([?&])to=/, `$1${add}&to=`) : url + `&${add}`;
  }
  // an environment: the link through this server's sign-in (stage), its app and gateway behind this server's proxy
  if (envOf(mode)) { const u = new URL(url); return `${self()}${R}/api/stage?env=${encodeURIComponent(mode)}&link=${encodeURIComponent(u.pathname + u.search)}`; }
  return url;
}
/** the link parameters the canvas signs a frame in and out with: the project's "signinParam" (default signin=<person>)
 *  and "signoutParam" (default signout=1; null: none added) */
const SIGNIN = () => { const v = proj()?.signinParam; return typeof v === "string" && /^[\w-]+$/.test(v) ? v : "signin"; };
const SIGNOUT = (): string | null => { const pj = proj(); if (pj && "signoutParam" in pj && pj.signoutParam === null) return null; const v = pj?.signoutParam; return typeof v === "string" && /^[\w-]+$/.test(v) ? v : "signout"; };
const hasParam = (u: string, k: string) => new RegExp(`[?&]${k}=`).test(u);
const paramsJson = () => JSON.stringify({ signin: SIGNIN(), signout: SIGNOUT() });
/** a view's variant from a request (mode=<environment>, tester=1, signal=0, person=<slug>): "<mode>.t<0|1>.s<0|1>.p-<who>",
 *  mode "static" unless a known one, who "default" unless a person was picked */
const variantOf = (qs: URLSearchParams) => `${envOf(qs.get("mode")) ? qs.get("mode") : "static"}.t${qs.get("tester") === "1" ? 1 : 0}.s${qs.get("signal") === "0" ? 0 : 1}.p-${/^[a-z0-9_-]+$/i.test(qs.get("person") ?? "") ? qs.get("person") : "default"}`;
/** each frozen name's person: its default (null: signed out), who it offers, and whether its link signs in itself */
type Person = { person: string | null; people: string[]; fixed: boolean };
const peopleCache = new Map<string, { at: number; map: Map<string, Person> }>();
function personInfo(f: Flow): Map<string, Person> {
  const at = flowStamp(f.file), had = peopleCache.get(f.name);
  if (had && had.at === at && indexes.has(f.name)) return had.map;
  const map = new Map<string, Person>(), links = indexes.get(f.name)?.links ?? {};
  let j: any; try { j = readFlow(f.file); } catch { return map; }
  // a screen or state signed out of its own ("person": null) offers no one unless it lists people itself
  const pick = (o: any, up: { person: string | null; people: string[] }) => ({ person: "person" in o ? o.person ?? null : up.person,
    people: Array.isArray(o.people) ? o.people : "person" in o && o.person == null ? [] : up.people });
  const top = pick(j, { person: null, people: [] });
  for (const s of j.screens ?? []) {
    const sc = pick(s, top), states = new Map((s.states ?? []).map((st: any) => [`${s.name}@${st.name}`, pick(st, sc)]));
    for (const n of Object.keys(links)) if (n === s.name || n.startsWith(s.name + "@"))
      map.set(n, { ...(states.get(n) as any ?? sc), fixed: hasParam(links[n].path, SIGNIN()) });
  }
  peopleCache.set(f.name, { at, map });
  return map;
}
/** a frame's variant as captured: its person (the one picked if the frame offers them, else its default; "link" when its
 *  link signs in itself) */
const personFix = (f: Flow, name: string, variant: string) => {
  const i = personInfo(f).get(name), m = variant.match(/\.p-([^.]+)$/), picked = m?.[1] ?? "default", base = m ? variant.slice(0, m.index) : variant;
  const who = !i ? "link" : i.fixed ? "link" : picked !== "default" && i.people.includes(picked) ? picked : i.person ?? "none";
  return `${base}.p-${who}`;
};
/** a frame's variant as captured: a "signal": false screen or state has no signal whatever the view's */
const sigFix = (f: Flow, name: string, variant: string) => personFix(f, name, signalOff(f).has(name) ? variant.replace(/\.s1(\.|$)/, ".s0$1") : variant);
/** the page's people: the project's, each frame's (default, offered, fixed) and the flow's own default and list */
function peopleJson(f: Flow): string {
  let j: any = {}; try { j = readFlow(f.file); } catch { /* broken */ }
  return JSON.stringify({ all: proj()?.people ?? {}, frames: Object.fromEntries(personInfo(f)), flow: { person: j.person ?? null, people: Array.isArray(j.people) ? j.people : [] } }).replace(/</g, "\\u003c");
}
/** this server, for the captures that go through it (environments) */
const self = () => `http://127.0.0.1:${port}`;

/* ── captures: one at a time on one shared browser, the most wanted first: a note's screenshots, then the snapshots the
   page is showing, then the rest in the background ── */
const req = createRequire(join(PIPE, "package.json"));
let browser: any = null;
type Job = { key: string; prio: number; seq: number; run: () => Promise<void> };
const jobs = new Map<string, Job>();
let seq = 0, working = 0;
/** captures at once: one for the review (the author's machine, the app's dev server); more for an export's --capture */
let WORKERS = 1;
/** a capture wanted (again: the higher of its priorities) */
function enqueue(key: string, prio: number, run: () => Promise<void>) {
  const j = jobs.get(key);
  if (j) { j.prio = Math.min(j.prio, prio); return; }
  jobs.set(key, { key, prio, seq: seq++, run });
  void work();
}
async function work() {
  if (working >= WORKERS) return;
  working++;
  while (jobs.size) {
    const j = [...jobs.values()].sort((a, b) => a.prio - b.prio || a.seq - b.seq)[0];
    jobs.delete(j.key);
    try { await j.run(); } catch (e) { console.error(`!! ${j.key}: ${String((e as Error)?.message ?? e).split("\n")[0]}`); }
  }
  working--;
}
/** a capture that is not the app: the server's error page, a blank page, an app that failed to mount */
class ErrorPage extends Error {}
/** what the page shows, judged conservatively: an app screen that says "not found" itself is kept. A page is an error
 *  page only when the app's root is missing or empty and, with that, a navigation answered >= 400, or the page threw,
 *  or the body is a short "404 / not found / bad gateway / service unavailable", or nothing at all is on it */
async function verdict(page: any, nav: { status: number; url: string }[], errors: string[]): Promise<string | null> {
  const sel = proj()?.ready?.selector ?? null;
  // (tsx names inner functions with __name, which the page lacks)
  await page.evaluate("globalThis.__name = globalThis.__name || function (f) { return f; };").catch(() => {});
  let why = "";
  const v = await page.evaluate((sel: string | null) => {
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const root = (sel && document.querySelector(sel)) || document.querySelector("#root, #app, #__next, #__nuxt, #svelte, [data-reactroot]");
    const rootShows = !!root && (sel && root.matches(sel) ? true : [...root.querySelectorAll("*")].some(shown) || !!(root as HTMLElement).innerText?.trim());
    const text = (document.body?.innerText ?? "").trim();
    const media = [...document.querySelectorAll("body img, body svg, body canvas, body video")].some(shown);
    // the body shows something of the app's own (an app with no root of the usual names renders into it)
    const rendered = [...(document.body?.querySelectorAll("*") ?? [])].some((el) => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(el.tagName) && shown(el)) && (text.length > 0 || media);
    return { root: !!root, rootShows, text: text.slice(0, 400), len: text.length, media, rendered };
  }, sel).catch((e: Error) => { why = String(e?.message ?? e).split("\n")[0]; return null; });
  if (!v) return `the page could not be read (${why})`;
  if (v.rootShows) return null;
  const bad = nav.find((r) => r.status >= 400);
  const where = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
  if (bad) return `HTTP ${bad.status} for ${where(bad.url)}`;
  if (!v.root && v.len < 300 && /\b(404|not found|502|bad gateway|503|service unavailable)\b/i.test(v.text)) return `error page: "${v.text.replace(/\s+/g, " ").slice(0, 60)}"`;
  // a page error the app recovered from (a hydration mismatch, re-rendered on the client: the page shows its content) is
  // kept, said as a warning (see shootOnce); one that left nothing, or only a short error message, is not
  if (errors.length && (!v.rendered || (v.len < 300 && /\b(application error|client-side exception|unhandled runtime error|something went wrong|internal server error)\b/i.test(v.text))))
    return `page error: ${errors[0].split("\n")[0].slice(0, 120)}`;
  if (!v.len && !v.media) return "blank page";
  return null;
}
/** a frame's screen as the frame shows it: the device's size, safe areas and theme, its link (the wait flex screens
 *  gives a seed link), and then, if given, the path the author had got to (from that seeded start, in the same page).
 *  An error page (see verdict) throws ErrorPage rather than being returned */
/** a capture: its picture; a page error the app recovered from (warn); the frame's "expect" not on the page (moved) */
type Shot = { png: Buffer; warn: string | null; moved: string | null };
async function shootOnce(d: Dev, theme: string, link: string, base?: string, at?: string, env?: string | null, setup?: { out: SetupOut; to: string } | null, expect?: string | null): Promise<Shot> {
  const { chromium } = req("playwright");
  browser ??= await chromium.launch();
  // a handheld's page fills its screen (its bars over it, as safe areas); a Mac or PC's sits between its bars
  const h = d.touch ? d.h : d.h - d.top - d.bottom;
  const ctx = await browser.newContext({ viewport: { width: d.w, height: h }, deviceScaleFactor: d.scale, colorScheme: theme, isMobile: d.touch, hasTouch: d.touch });
  // an environment: this server's proxy sends the app and its gateway calls there for this browser (its cookie)
  if (env) await ctx.addCookies([{ name: "flex_mode", value: env, url: self() }]);
  try {
    const page = await ctx.newPage(), nav: { status: number; url: string }[] = [], errors: string[] = [];
    // the main frame's documents (the seed link's, each it navigates on to) and what the page threw
    page.on("response", (r: any) => { try { if (r.request().isNavigationRequest() && r.frame() === page.mainFrame()) nav.push({ status: r.status(), url: r.url() }); } catch { /* gone */ } });
    page.on("pageerror", (e: Error) => errors.push(String(e?.message ?? e)));
    // the project's "proxies", for a capture that goes to the app's own address (not through this server): those paths
    // sent on to their origins, as the review's proxy does (a redirect to the app's or a proxied address made relative)
    const pxs = proxiesOf();
    if (pxs.length) await page.route((u: URL) => appOrigins().has(u.origin) && pxs.some(([p]) => under(u.pathname + u.search, p)), async (route: any) => {
      const u = new URL(route.request().url()), px = pxs.find(([p]) => under(u.pathname + u.search, p))!;
      try {
        const r = await route.fetch({ url: px[1].origin + px[1].pathname.replace(/\/$/, "") + u.pathname + u.search, maxRedirects: 0 });
        const h = r.headers();
        if (h.location) h.location = localLocation(h.location);
        await route.fulfill({ response: r, headers: h });
      } catch { await route.abort().catch(() => {}); }
    });
    if (d.touch) {
      try { await (await ctx.newCDPSession(page)).send("Emulation.setSafeAreaInsetsOverride", { insets: { top: d.top, bottom: d.bottom, left: 0, right: 0 } }); } catch { /* an older Chromium */ }
    }
    // a setup: its cookies in this browser, its storage written on the link's origin (a page of Flex's own there, never
    // fetched), then its target opened in place of the link
    if (setup) {
      const o = new URL(link).origin, { out } = setup;
      if (out.clock) await ctx.addInitScript({ content: `(${CLOCK_JS})(${JSON.stringify(out.clock)})` });
      if (out.cookies.length) await ctx.addCookies(out.cookies.map((c) => ({ name: c.name, value: c.value, url: o + (c.path ?? "/"), httpOnly: !!c.httpOnly, secure: !!c.secure,
        ...(c.sameSite ? { sameSite: c.sameSite } : {}), ...(typeof c.maxAge === "number" ? { expires: Math.floor(Date.now() / 1000) + c.maxAge } : {}) })));
      if (Object.keys(out.localStorage).length || Object.keys(out.sessionStorage).length) {
        const at0 = `${o}/__flex_setup__`;
        await page.route(at0, (r: any) => r.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><script>(function(){var s=${JSON.stringify({ l: out.localStorage, s: out.sessionStorage }).replace(/</g, "\\u003c")};for(var k in s.l)s.l[k]===null?localStorage.removeItem(k):localStorage.setItem(k,s.l[k]);for(var k2 in s.s)s.s[k2]===null?sessionStorage.removeItem(k2):sessionStorage.setItem(k2,s.s[k2])})()</script>` }));
        await page.goto(at0, { timeout: 30000 });
        await page.unroute(at0);
      }
      link = setup.to;
    }
    await page.goto(link, { waitUntil: "networkidle", timeout: 30000 }).catch(() => page.goto(link, { timeout: 30000 }));
    // (a seed link may navigate on meanwhile: then its next page's fonts are waited for below)
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
    // a seed link navigates on (signs in, sets the clock, then goes to the screen): the same wait flex screens gives it
    await page.waitForTimeout(2500);
    // the frame's actions, in order (each waits up to 10 s for its element); one failing: nothing is kept, and why is said
    if (setup?.out.actions.length) await runActions(page, setup.out.actions);
    if (base && at && !at.startsWith("/dev/seed") && !at.startsWith(R + "/") && new URL(page.url()).pathname + new URL(page.url()).search !== at) {
      await page.goto(base + at, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    const bad = await verdict(page, nav, errors);
    if (bad) throw new ErrorPage(bad);
    // the frame's "expect" (a selector, or text=…): missing, the app's data has likely moved on (a board on shared data
    // another run reset): the capture is kept, flagged
    let moved: string | null = null;
    if (expect && !(await page.locator(expect).first().waitFor({ timeout: 5000 }).then(() => true, () => false))) moved = `expected ${expect}: not on the page`;
    const warn = errors.length ? `page error (the page rendered): ${errors[0].split("\n")[0].slice(0, 160)}` : null;
    return { png: await page.screenshot(), warn, moved };
  } finally { await ctx.close(); }
}
/** a frame's clock, before any of its page's scripts: only no-arg new Date(), Date() and Date.now() move to the instant
 *  (new Date(x), Date.parse and Date.UTC stay real: apps parse dates); frozen there, or ticking on from it */
// (a string: tsx's names on inner functions would not exist in the page)
const CLOCK_JS = `function(c){var RD=Date,s0=RD.now(),now=function(){return c.ticks?c.at+(RD.now()-s0):c.at};
var FD=function Date(){if(!new.target)return new RD(now()).toString();return Reflect.construct(RD,arguments.length?[].slice.call(arguments):[now()],new.target)};
FD.prototype=RD.prototype;Object.setPrototypeOf(FD,RD);FD.now=now;FD.parse=RD.parse;FD.UTC=RD.UTC;window.Date=FD}`;
/** a frame's actions on a captured page (Playwright's selectors: CSS, text=…) */
async function runActions(page: any, acts: Action[]) {
  for (const [i, a] of acts.entries()) {
    try {
      // a <select> takes the option (by value or label) rather than typed text, as the live runner sets its value
      if (a.fill != null) { const el = page.locator(a.fill).first(); await el.waitFor({ timeout: 10000 });
        if (await el.evaluate((e) => e.tagName === "SELECT")) await el.selectOption(a.value ?? "", { timeout: 10000 }).catch(() => el.selectOption({ label: a.value ?? "" }, { timeout: 10000 }));
        else await el.fill(a.value ?? "", { timeout: 10000 }); }
      else if (a.click != null) await page.locator(a.click).nth(a.nth ?? 0).click({ timeout: 10000 });
      else if (a.press != null) await page.keyboard.press(a.press);
      else if (a.waitFor != null) await page.locator(a.waitFor).first().waitFor({ timeout: 10000 });
      else if (a.scroll != null) { const l = page.locator(a.scroll).first(); await l.waitFor({ timeout: 10000 }); await l.evaluate((el: Element) => el.scrollIntoView({ block: "center" })); }
      else if (a.wait != null) await page.waitForTimeout(a.wait);
    } catch (e) { throw new ActionError(`${actionLabel(a, i)} failed: ${String((e as Error)?.message ?? e).split("\n")[0]}`); }
  }
  // what the last one started (a dialog opening, a list scrolling) settles
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
}
/** shootOnce, an error page tried again a few times (the app may be mid-rebuild: 3, 6, 12 s apart); still one, it
 *  throws ErrorPage and nothing is kept */
async function shoot(d: Dev, theme: string, link: string, base?: string, at?: string, env?: string | null, setup?: { out: SetupOut; to: string } | null, expect?: string | null): Promise<Shot> {
  for (let i = 0; ; i++) {
    try { return await shootOnce(d, theme, link, base, at, env, setup, expect); }
    catch (e) { if (!(e instanceof ErrorPage) || e instanceof SetupError || i >= 3) throw e; await sleep(3000 * 2 ** i); }
  }
}
/** the snapshots not taken because their page was an error page (key: flow/name device theme ...; the reason) */
const notTaken = new Map<string, { label: string; why: string; at: number }>();

/* a note's screenshots: the frame's screen, and a crop around the point */
function capture(f: Flow, note: Note) {
  enqueue(`note:${note.id}`, 0, async () => {
    const file = notesFileOf(f.file), dir = basename(file).replace(/\.json$/, ""), d = deviceFor(note.device);
    let shot: { screenshot: string; crop: string } | null = null, error: string | null = null;
    try {
      if (!d || !note.link) throw new Error(`no link for ${note.screen}${note.state ? "@" + note.state : ""} on ${note.device}`);
      const env = envOf(note.mode) ? note.mode! : null, sharp = req("sharp"), setup = await captureSetup(f, note.state ? `${note.screen}@${note.state}` : note.screen, note.link, note.device);
      const { png } = await shoot(d, note.theme, note.link, env ? self() : f.base, note.at, env, setup);
      mkdirSync(join(dirname(file), dir), { recursive: true });
      const full = join(dir, `${note.id}.png`), crop = join(dir, `${note.id}.crop.png`);
      writeFileSync(join(dirname(file), full), png);
      // the crop: a square half the screen's narrow side, around the point (kept inside the screen), the point ringed
      const h = d.touch ? d.h : d.h - d.top - d.bottom, W = d.w * d.scale, H = h * d.scale, side = Math.round(Math.min(W, H) / 2);
      const px = note.x * W, py = note.y * H;
      const left = Math.round(Math.min(Math.max(px - side / 2, 0), W - side)), top = Math.round(Math.min(Math.max(py - side / 2, 0), H - side));
      const r = 14 * d.scale, ring = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><circle cx="${px - left}" cy="${py - top}" r="${r}" fill="none" stroke="#ff3b30" stroke-width="${2 * d.scale}"/></svg>`);
      await sharp(png).extract({ left, top, width: side, height: side }).composite([{ input: ring }]).png().toFile(join(dirname(file), crop));
      shot = { screenshot: full, crop };
    } catch (e) { error = String((e as Error)?.message ?? e).split("\n")[0]; }
    await update(notesFileOf(f.file), (doc) => {
      const n = doc.notes.find((x) => x.id === note.id);
      if (!n) return;
      if (shot) { Object.assign(n, shot); delete n.captureError; } else n.captureError = error!;
    }).catch((e) => console.error(`!! ${e.message}`));
  });
}

/* ── snapshots: the grid's pictures, each screen and state per device, theme and language, captured as a note's are and
   kept on disk (the project's .flex/cache/snapshots/<flow>/, else this server's temp folder) with a manifest of the
   link and the app's build each was taken at. One is stale when either has changed (the flow edited, the app rebuilt:
   the notes file's "build"); a stale one still shows until its new one is in ── */
/** warn: a page error the app recovered from (kept); moved: the frame's "expect" was not on the page (kept, flagged) */
type Snap = { link: string; build: string | null; at: number; setup?: string; warn?: string; moved?: string };
const snapDir = (f: Flow) => (P ? join(P.dir, "cache", "snapshots", f.name) : join(WORK, "snapshots", f.name));
const manifests = new Map<string, Record<string, Snap>>();
const manAt = new Map<string, number>();
function manifest(f: Flow): Record<string, Snap> {
  let m = manifests.get(f.name);
  // another flex review wrote it meanwhile (flex review resnap, an export's --capture): its newer entries taken in
  const mf = join(snapDir(f), "manifest.json"), mat = mtime(mf);
  if (m && mat && mat !== manAt.get(f.name)) {
    manAt.set(f.name, mat);
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(mf, "utf8")) as Record<string, Snap>)) if (!m[k] || v.at > m[k].at) m[k] = v; } catch { /* mid-write */ }
  }
  if (!m) {
    manAt.set(f.name, mat);
    try { m = JSON.parse(readFileSync(join(snapDir(f), "manifest.json"), "utf8")); } catch { m = {}; }
    // snapshots from before data modes and tester tools: static ones, tester tools off, renamed
    for (const k of Object.keys(m!)) if (!/\.t[01]\.s[01](\.p-[^.]+)?\.png$/.test(k)) {
      const to = /\.t[01]\.png$/.test(k) ? k.replace(/\.png$/, ".s1.png") : k.replace(/\.(demo|staging)\.png$/, (_, x) => `.${x === "demo" ? "static" : x}.png`).replace(/(\.[a-z]{2,3})\.png$/, "$1.static.png").replace(/\.png$/, ".t0.s1.png");
      try { renameSync(join(snapDir(f), k), join(snapDir(f), to)); } catch { /* gone */ }
      m![to] = m![k]; delete m![k];
    }
    manifests.set(f.name, m!);
  }
  return m!;
}
function saveManifest(f: Flow) {
  const file = join(snapDir(f), "manifest.json"), tmp = `${file}.${process.pid}.tmp`, m = manifest(f);
  // (a fresh cache has no folder for the flow yet)
  mkdirSync(snapDir(f), { recursive: true });
  // another flex review may share this cache (the review server and an export's --capture): what it wrote meanwhile is
  // kept, the newer of two entries winning
  try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, Snap>)) if (!m[k] || v.at > m[k].at) m[k] = v; } catch { /* none yet */ }
  // an entry whose picture is gone (removed by resnap) goes too
  for (const k of Object.keys(m)) if (!existsSync(join(snapDir(f), k))) delete m[k];
  writeFileSync(tmp, JSON.stringify(m, null, 1) + "\n");
  renameSync(tmp, file);
  manAt.set(f.name, mtime(file));
}
const buildOf = (f: Flow): string | null => { try { return ((isPeek(f) ? peekDoc(f) : readDoc(notesFileOf(f.file)).doc).build as string) ?? null; } catch { return null; } };
const snapName = (name: string, device: string, theme: string, lang: string, variant: string) => `${name}.${device}.${theme}.${lang}.${variant}.png`;
const snapLink = (f: Flow, name: string, device: string, theme: string, lang: string, variant: string) => {
  const i = name.indexOf("@");
  return linkOf(f, i < 0 ? name : name.slice(0, i), i < 0 ? null : name.slice(i + 1), device, theme, lang, variant);
};
/** a snapshot as it stands: its file's address (with its time, so a new one shows) when there is one, and whether it
 *  is up to date; a stale or missing one is wanted, at this priority */
function snapshot(f: Flow, name: string, device: string, theme: string, lang: string, prio: number, variant = "static.t0.s1"): { url: string | null; fresh: boolean; moved?: string } {
  variant = sigFix(f, name, variant);
  const file = snapName(name, device, theme, lang, variant), m = manifest(f)[file], link = snapLink(f, name, device, theme, lang, variant), env = variant.split(".")[0];
  // offline=0 is the app's default: a snapshot taken before the signal setting still counts
  const same = (a?: string, b?: string) => a?.replace(/&offline=0$/, "") === b?.replace(/&offline=0$/, "");
  const sig = setupSig(f, name), have = !!m && existsSync(join(snapDir(f), file)), fresh = have && same(m.link, link) && m.build === buildOf(f) && (m.setup ?? "") === sig;
  const no = notTaken.get(`${f.name}:${file}`), cooling = !!no && prio >= 2 && Date.now() - no.at < 60000;
  if (!fresh && link && !cooling) enqueue(`snap:${f.name}:${file}`, prio, async () => {
    const d = deviceFor(device), now = snapLink(f, name, device, theme, lang, variant), b = buildOf(f), had = manifest(f)[file];
    if (!d || !now || (had && same(had.link, now) && had.build === b && (had.setup ?? "") === setupSig(f, name) && existsSync(join(snapDir(f), file)))) return;
    const key = `${f.name}:${file}`, label = `${f.name}/${name} ${device}${theme === "light" ? "" : " " + theme}${lang === "en" ? "" : " " + lang}`;
    let shot: Shot;
    try { shot = await shoot(d, theme, now, undefined, undefined, envOf(env) ? env : null, await captureSetup(f, name, now, device, prio >= 2), expectOf(f, name)); }
    catch (e) {
      if (!(e instanceof ErrorPage)) throw e;
      // an error page is not kept (an older snapshot still shows): said, and tried again later
      notTaken.set(key, { label, why: e.message, at: Date.now() });
      console.error(`${EXPORT ? "\r\x1b[K" : ""}!! not taken (error page): ${label}: ${e.message}`);
      return;
    }
    notTaken.delete(key);
    mkdirSync(snapDir(f), { recursive: true });
    writeFileSync(join(snapDir(f), file), shot.png);
    const sg = setupSig(f, name), cr = EXPORT || RESNAP ? "\r\x1b[K" : "";
    if (shot.warn) console.error(`${cr}!! taken, with a warning: ${label}: ${shot.warn}`);
    if (shot.moved) console.error(`${cr}!! taken, data moved? ${label}: ${shot.moved}`);
    manifest(f)[file] = { link: now, build: b, at: Date.now(), ...(sg ? { setup: sg } : {}), ...(shot.warn ? { warn: shot.warn } : {}), ...(shot.moved ? { moved: shot.moved } : {}) };
    saveManifest(f);
  });
  return { url: have ? `${R}/snap/${encodeURIComponent(f.name)}/${encodeURIComponent(file)}?v=${m.at}` : null, fresh, ...(have && m.moved ? { moved: m.moved } : {}) };
}
/** the frozen names a device shows (with tester tools off, not the flow's tester-only screens and states) */
const namesOn = (f: Flow, device: string, variant = "static.t1.s1") => {
  const hide = /\.t0(\.|$)/.test(variant) ? new Set(testerNames(f)) : null;
  return Object.entries(indexes.get(f.name)?.links ?? {}).filter(([n, l]) => (!l.devices || l.devices.includes(device)) && !hide?.has(n)).map(([n]) => n);
};
/** a flow's frames in a set of views, tester tools off: the default view (every device, light, English, signal on),
 *  or all (every theme, language and signal, as "publish": "all" exports them) */
function viewFrames(f: Flow, all: boolean): { n: string; d: string; theme: string; lang: string; v: string }[] {
  const idx = indexes.get(f.name);
  if (!idx) return [];
  const themes = all ? idx.themes ?? ["light", "dark"] : ["light"], langs = all ? ["en", "sw"] : ["en"], signals = all ? [1, 0] : [1], r = [];
  for (const d of idx.devices) for (const theme of themes) for (const lang of langs) for (const n of namesOn(f, d, "static.t0")) for (const sg of signals) {
    // a "signal": false screen once: it has no signal either way
    if (!sg && signalOff(f).has(n)) continue;
    r.push({ n, d, theme, lang, v: sigFix(f, n, `static.t0.s${sg}.p-default`) });
  }
  return r;
}
/** the flow's screens and states marked with a field (a screen's states with it): "tester": true, "signal": false */
function marked(f: Flow, on: (x: any) => boolean): string[] {
  let j: any;
  try { j = readFlow(f.file); } catch { return []; }
  const links = Object.keys(indexes.get(f.name)?.links ?? {});
  return (j.screens ?? []).flatMap((s: any) => on(s) ? links.filter((n) => n === s.name || n.startsWith(s.name + "@"))
    : (s.states ?? []).filter(on).map((st: any) => `${s.name}@${st.name}`));
}
const testerNames = (f: Flow) => marked(f, (x) => x.tester === true);
const sigCache = new Map<string, { at: number; set: Set<string> }>();
/** the "signal": false screens and states: always captured offline */
function signalOff(f: Flow): Set<string> {
  const at = flowStamp(f.file), had = sigCache.get(f.name);
  if (had && had.at === at && indexes.has(f.name)) return had.set;
  const set = new Set(marked(f, (x) => x.signal === false));
  sigCache.set(f.name, { at, set });
  return set;
}
const expCache = new Map<string, { at: number; map: Map<string, string> }>();
/** a frame's "expect" (a selector, or text=…; a state's over its screen's): what must be on its page once loaded and
 *  its actions done, else its capture is flagged "data moved?" */
function expectOf(f: Flow, name: string): string | null {
  const at = flowStamp(f.file), had = expCache.get(f.name);
  let map = had && had.at === at ? had.map : null;
  if (!map) {
    map = new Map();
    let j: any; try { j = readFlow(f.file); } catch { j = {}; }
    const ok = (v: unknown) => typeof v === "string" && v.trim() ? v : null;
    for (const s of j.screens ?? []) {
      if (ok(s?.expect)) map.set(s.name, s.expect);
      for (const st of s?.states ?? []) { const e = ok(st?.expect) ?? ok(s?.expect); if (e) map.set(`${s.name}@${st.name}`, e); }
    }
    expCache.set(f.name, { at, map });
  }
  return map.get(name) ?? (name.includes("@") ? map.get(name.slice(0, name.indexOf("@"))) ?? null : null);
}
/* ── setup: a frame whose state can't be put in a URL takes it from a command the project names (.flex/project.json
   "setup": { command, cwd, ttl }). A flow, screen or state's "setup": { <args> } gives it its arguments (merged: state
   over screen over flow; a composed state's axis options too; "setup": null: none from there down). Before the frame
   opens (live, or captured) the command runs in a shell in cwd (relative to .flex/) with FLEX_FLOW, FLEX_SCREEN,
   FLEX_STATE, FLEX_PERSON, FLEX_LANG, FLEX_THEME, FLEX_DEVICE, FLEX_BASE, FLEX_MODE and FLEX_SETUP (the args as JSON),
   over the project's env file's vars, and prints JSON: { url?, cookies?: [{ name, value, path?, httpOnly?, secure?,
   sameSite?, maxAge? }], localStorage?, sessionStorage? }. The result is reused for ttl seconds (default 600) per
   (command, args, person, language, data mode, the flow's build); Reset to defaults forgets them. Nothing of it is
   logged or written: only the cookies and storage it asks for reach the frame ── */
type SetupCookie = { name: string; value: string; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; maxAge?: number };
type SetupOut = { url?: string; cookies: SetupCookie[]; localStorage: Record<string, string | null>; sessionStorage: Record<string, string | null>; actions: Action[]; clock?: Clock | null };
/** a frame's clock: no-arg new Date() and Date.now() at this instant (ms), frozen unless it ticks */
type Clock = { at: number; ticks: boolean };
/** a step after the frame's page loads: fill, click (nth), press, waitFor, scroll, wait (a selector: CSS, or text=…) */
type Action = { fill?: string; value?: string; click?: string; nth?: number; press?: string; waitFor?: string; scroll?: string; wait?: number };
const VERBS = ["fill", "click", "press", "waitFor", "scroll", "wait"];
/** a list of actions as given (a flow's, or a setup's output), checked: each one verb */
function actionsOf(a: unknown, where: string): Action[] {
  if (a == null) return [];
  if (!Array.isArray(a)) throw new Error(`${where}: "actions" isn't a list`);
  return a.map((x: any, i) => {
    const vs = x && typeof x === "object" ? VERBS.filter((v) => v in x) : [];
    if (vs.length !== 1) throw new Error(`${where}: action ${i + 1} needs one of ${VERBS.join(", ")}`);
    const v = vs[0], out: Action = {};
    if (v === "wait") out.wait = Math.max(0, +x.wait || 0);
    else if (typeof x[v] !== "string" || !x[v]) throw new Error(`${where}: action ${i + 1}: "${v}" needs a ${v === "press" ? "key" : "selector"}`);
    else (out as any)[v] = x[v];
    if (v === "fill") out.value = x.value == null ? "" : String(x.value);
    if (v === "click" && x.nth != null) out.nth = Math.max(0, Math.floor(+x.nth || 0));
    return out;
  });
}
/** a step said for a person: "click text=Save" */
const actionLabel = (a: Action, i: number) => { const v = VERBS.find((k) => k in a)!; return `action ${i + 1} (${v}${v === "wait" ? ` ${a.wait} ms` : ` ${(a as any)[v]}`})`; };
/** a setup that failed: its frame shows why, its capture is not kept (an ErrorPage, not tried again: see shoot) */
class SetupError extends ErrorPage {}
/** a frame's action that failed (as a setup: not kept, not tried again) */
class ActionError extends SetupError {}
type FrameSetup = { args: Record<string, string> | null; storage: { localStorage: Record<string, string | null>; sessionStorage: Record<string, string | null> } | null; actions: Action[] | null; clock: Clock | null };
const setupMaps = new Map<string, { at: number; map: Map<string, FrameSetup> }>();
/** each frozen name's setup: its command's args and its declared storage (a name absent: the frame has neither) */
function setupOf(f: Flow): Map<string, FrameSetup> {
  const at = flowStamp(f.file), had = setupMaps.get(f.name);
  if (had && had.at === at && indexes.has(f.name)) return had.map;
  const map = new Map<string, FrameSetup>(), links = indexes.get(f.name)?.links ?? {};
  let j: any; try { j = readFlow(f.file); } catch { return map; }
  // a value: a string as it is, anything else as JSON; null: the key is the frame's own and empty (the app finds none)
  const strs = (o: any): Record<string, string | null> => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || typeof v === "string" ? v : JSON.stringify(v)])) : {});
  const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);
  // "setup" and "storage" each merge down (state over screen over flow); null: none from there down
  const pick = (o: any, up: FrameSetup): FrameSetup => {
    if (!isObj(o)) return up;
    const args = !("setup" in o) ? up.args : o.setup === null ? null : isObj(o.setup) ? { ...(up.args ?? {}), ...strs(o.setup) } : up.args;
    const storage = !("storage" in o) ? up.storage : o.storage === null ? null : isObj(o.storage)
      ? { localStorage: { ...(up.storage?.localStorage ?? {}), ...strs(o.storage.localStorage) }, sessionStorage: { ...(up.storage?.sessionStorage ?? {}), ...strs(o.storage.sessionStorage) } } : up.storage;
    // "actions": a lower level's list replaces the one above (as person does); null or []: none
    let actions = up.actions;
    if ("actions" in o) { try { actions = o.actions === null ? null : actionsOf(o.actions, basename(f.file)); } catch (e) { console.error(`!! ${(e as Error).message}`); actions = up.actions; } }
    // "clock": an instant (ISO, with its offset) or null (none); "clockTicks": true, it runs on from there
    let clock = up.clock;
    if ("clock" in o) { const t = typeof o.clock === "string" ? Date.parse(o.clock) : NaN;
      if (o.clock !== null && !Number.isFinite(t)) console.error(`!! ${basename(f.file)}: "clock": ${JSON.stringify(o.clock)} isn't an instant (ISO, e.g. 2026-11-21T09:30:00+03:00)`);
      clock = o.clock === null ? null : Number.isFinite(t) ? { at: t, ticks: up.clock?.ticks ?? false } : up.clock; }
    if (clock && "clockTicks" in o) clock = { ...clock, ticks: !!o.clockTicks };
    return { args, storage, actions: actions?.length ? actions : null, clock };
  };
  const pj0 = proj() as any, t0 = typeof pj0?.clock === "string" ? Date.parse(pj0.clock) : NaN;
  const top = pick(j, { args: null, storage: null, actions: null, clock: Number.isFinite(t0) ? { at: t0, ticks: !!pj0.clockTicks } : null });
  for (const s of j.screens ?? []) {
    const sc = pick(s, top), states = new Map<string, any>((s.states ?? []).map((st: any) => [st.name, st]));
    // a composed state (axes): its options' (or a toggle's axis') own, in the axes' order
    const parts = new Map<string, any>();
    for (const ax of s.axes ?? []) { if (ax.toggle) parts.set(ax.name, ax); for (const o of ax.options ?? []) parts.set(o.name, o); }
    for (const n of Object.keys(links)) {
      if (n !== s.name && !n.startsWith(s.name + "@")) continue;
      const st = n.slice(s.name.length + 1);
      let a = sc;
      if (st && states.has(st)) a = pick(states.get(st), sc);
      else if (st) for (const x of st.split("+")) a = pick(parts.get(x), a);
      if (a.args || a.storage || a.actions || a.clock) map.set(n, a);
    }
  }
  setupMaps.set(f.name, { at, map });
  return map;
}
/** setup commands run only when allowed: flex review --allow-setup (or export --capture --allow-setup), or the page's
 *  Setup switch (View; this server's session, off when it starts). Declared "storage" needs no command and always applies */
let allowSetup = flag("allow-setup");
const NOT_ALLOWED = "Setup not allowed: start flex review with --allow-setup (or switch Setup on in View)";
/** each run, for an audit of what setups wrote: .flex/review.log (when, the command, the frame, person, language, data
 *  mode, how it ended; never its output), under cache/ so committing .flex/ never takes it */
function logSetup(line: string) {
  const pj = proj();
  try { if (pj) mkdirSync(join(pj.dir, "cache"), { recursive: true }); if (pj) writeFileSync(join(pj.dir, "cache", "review.log"), `${new Date().toISOString()} ${line}\n`, { flag: "a" }); } catch { /* read-only */ }
}
/** a frame's setup as a snapshot sees it (its args, storage and actions; "" none): changed, its snapshots are taken again */
// (its "expect" too: changed, the snapshot is checked again)
const setupSig = (f: Flow, name: string) => { const x = setupOf(f).get(name), e = expectOf(f, name);
  return x || e ? createHash("sha1").update(JSON.stringify(e ? [x ?? null, e] : x)).digest("hex").slice(0, 12) : ""; };
const setupDone = new Map<string, { at: number; out: SetupOut }>(), setupRuns = new Map<string, Promise<SetupOut>>();
/** a setup that failed, said again for 15 s (not run again on every poll and capture meanwhile) */
const setupFailed = new Map<string, { at: number; e: Error }>();
/** a frame's setup: its command run (or reused) for its person, language, theme, device and data mode, over its declared
 *  storage (the command's keys win); null: it has neither */
async function runSetup(f: Flow, name: string, o: { person: string | null; lang: string; theme: string; device: string; mode: string; bg?: boolean }): Promise<SetupOut | null> {
  const fs = setupOf(f).get(name);
  if (!fs) return null;
  const decl: SetupOut = { cookies: [], localStorage: fs.storage?.localStorage ?? {}, sessionStorage: fs.storage?.sessionStorage ?? {}, actions: fs.actions ?? [], clock: fs.clock };
  if (!fs.args) return decl;
  const args = fs.args, pj = proj(), cfg = pj?.setup;
  if (!pj || !cfg?.command) throw new SetupError(`${name} has "setup", but .flex/project.json has no "setup": { "command" }`);
  const key = JSON.stringify([cfg.command, cfg.cwd ?? "", args, o.person ?? "", o.lang, o.mode, buildOf(f)]);
  const ttl = (typeof cfg.ttl === "number" && cfg.ttl >= 0 ? cfg.ttl : 600) * 1000, had = setupDone.get(key);
  let out: SetupOut;
  // a failure is said again (not run again) for 15 s live, for the whole ttl in the background: a background capture
  // runs a frame's setup at most once per ttl
  const bad = setupFailed.get(key);
  if (had && Date.now() - had.at < ttl) out = had.out;
  else if (bad && Date.now() - bad.at < (o.bg ? ttl : Math.min(ttl, 15000))) throw bad.e;
  else if (!allowSetup) throw new SetupError(NOT_ALLOWED);
  else {
    let run = setupRuns.get(key);
    if (!run) {
      const i = name.indexOf("@"), env = envOf(o.mode);
      const vars: Record<string, string> = { ...envVars(o.mode), ...(process.env as Record<string, string>),
        FLEX_FLOW: f.name, FLEX_SCREEN: i < 0 ? name : name.slice(0, i), FLEX_STATE: i < 0 ? "" : name.slice(i + 1), FLEX_PERSON: o.person ?? "",
        FLEX_LANG: o.lang, FLEX_THEME: o.theme, FLEX_DEVICE: o.device, FLEX_BASE: (env?.base ?? f.base).replace(/\/$/, ""), FLEX_MODE: o.mode, FLEX_SETUP: JSON.stringify(args), PATH: userPath() };
      const who = `${f.name}/${name} person=${o.person ?? "-"} lang=${o.lang} mode=${o.mode}${o.bg ? " (background)" : ""}`;
      logSetup(`setup run: ${cfg.command} for ${who}`);
      run = execSetup(cfg.command, resolve(pj.dir, cfg.cwd ?? "."), vars, name).then((r) => { logSetup(`setup ok: ${who}`); return r; }, (e) => { logSetup(`setup failed: ${who}: ${String(e.message).split("\n")[0]}`); throw e; }).then((r) => { setupDone.set(key, { at: Date.now(), out: r }); setupFailed.delete(key); return r; },
        (e) => { setupFailed.set(key, { at: Date.now(), e }); throw e; })
        .finally(() => setupRuns.delete(key));
      setupRuns.set(key, run);
    }
    out = await run;
  }
  return { ...out, localStorage: { ...decl.localStorage, ...out.localStorage }, sessionStorage: { ...decl.sessionStorage, ...out.sessionStorage }, actions: [...decl.actions, ...out.actions], clock: decl.clock };
}
/** the user's PATH for a setup command (a node child doesn't have their shell's: bun, a version manager's node): their
 *  interactive login shell's, then this process's, then the usual install folders */
let userPathV: string | null = null;
function userPath(): string {
  if (userPathV !== null) return userPathV;
  let p = "";
  try {
    const r = spawnSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "\\n__FLEXPATH__%s" "$PATH"'], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
    p = String(r.stdout ?? "").split("__FLEXPATH__").pop()!.trim();
  } catch { /* no shell */ }
  const home = process.env.HOME ?? "";
  userPathV = [...new Set([...p.split(":"), ...(process.env.PATH ?? "").split(":"), `${home}/.bun/bin`, `${home}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean))].join(":");
  return userPathV;
}
function execSetup(command: string, cwd: string, env: Record<string, string>, name: string): Promise<SetupOut> {
  return new Promise((ok, no) => {
    let stdout = "", stderr = "";
    const c = spawn(command, { shell: true, cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => { stderr += "\n(timed out after 180 s)"; c.kill("SIGKILL"); }, 180000);
    c.stdout.on("data", (b) => (stdout += b));
    c.stderr.on("data", (b) => (stderr = (stderr + b).slice(-20000)));
    const tail = () => stderr.trim().split("\n").slice(-8).join("\n").slice(-800);
    c.on("error", (e) => { clearTimeout(timer); no(new SetupError(`setup for ${name} didn't start: ${e.message}`)); });
    c.on("close", (code) => {
      clearTimeout(timer);
      // (never the command's output in a message or the log: it may hold a session)
      if (code !== 0) { console.error(`!! setup for ${name} exited ${code}`); return no(new SetupError(`setup for ${name} exited ${code}${tail() ? `: ${tail()}` : ""}`)); }
      try { ok(setupOutput(stdout)); }
      catch (e) { console.error(`!! setup for ${name}: ${(e as Error).message}`); no(new SetupError(`setup for ${name}: ${(e as Error).message}${tail() ? `\n${tail()}` : ""}`)); }
    });
  });
}
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, COOKIE_VALUE = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
/** the command's stdout as a setup: all of it JSON, else its last line (a script that logs first) */
function setupOutput(stdout: string): SetupOut {
  let j: any;
  try { j = JSON.parse(stdout); } catch {
    const last = stdout.trim().split("\n").pop() ?? "";
    try { j = JSON.parse(last); } catch { throw new Error(stdout.trim() ? "its output isn't JSON" : "it printed nothing (it should print JSON)"); }
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("its output isn't a JSON object");
  if (j.url != null && typeof j.url !== "string") throw new Error(`"url" isn't a string`);
  const strs = (k: string): Record<string, string | null> => {
    const o = j[k] ?? {};
    if (typeof o !== "object" || Array.isArray(o)) throw new Error(`"${k}" isn't an object`);
    return Object.fromEntries(Object.entries(o).map(([a, v]) => [a, v === null || typeof v === "string" ? v : JSON.stringify(v)]));
  };
  if (j.cookies != null && !Array.isArray(j.cookies)) throw new Error(`"cookies" isn't a list`);
  const cookies: SetupCookie[] = (j.cookies ?? []).map((c: any, i: number) => {
    if (!c || typeof c.name !== "string" || !COOKIE_NAME.test(c.name)) throw new Error(`cookie ${i + 1} has no valid name`);
    if (/^flex_/.test(c.name)) throw new Error(`cookie ${c.name}: flex_ names are Flex's own`);
    const value = c.value == null ? "" : String(c.value);
    if (!COOKIE_VALUE.test(value)) throw new Error(`cookie ${c.name}: its value has characters a cookie can't hold (encode it)`);
    const ss = typeof c.sameSite === "string" ? c.sameSite[0].toUpperCase() + c.sameSite.slice(1).toLowerCase() : undefined;
    return { name: c.name, value, path: typeof c.path === "string" && c.path.startsWith("/") ? c.path : "/", httpOnly: !!c.httpOnly, secure: !!c.secure,
      sameSite: ss && ["Strict", "Lax", "None"].includes(ss) ? ss : undefined, maxAge: typeof c.maxAge === "number" ? c.maxAge : undefined };
  });
  return { url: j.url || undefined, cookies, localStorage: strs("localStorage"), sessionStorage: strs("sessionStorage"), actions: actionsOf(j.actions, "its output") };
}
/** the app's own addresses (its base, each flow's, each environment's): a setup's absolute url on one of them opens on
 *  the frame's origin instead */
const appOrigins = () => new Set([appBase.origin, ...flows().map((f) => new URL(f.base).origin), ...Object.values(envs()).map((e) => { try { return new URL(e.base).origin; } catch { return ""; } })]);
/** where the setup sends its frame: its url (a path, or the app's address mapped to the frame's origin), else the link */
function setupTarget(url: string | undefined, link: string): string {
  if (!url) return link;
  const u = new URL(url, "http://flex.invalid");
  return u.origin === "http://flex.invalid" || appOrigins().has(u.origin) ? u.pathname + u.search + u.hash : u.href;
}
/** a frame link's setup context: the seed link (inside an environment's /api/stage), its person, language and theme */
function linkParts(link: string): { origin: string; plain: string; env: string | null; person: string | null; lang: string; theme: string } {
  const u = new URL(link, "http://flex.invalid");
  let plain = u.pathname + u.search, env: string | null = null;
  if (u.pathname === `${R}/api/stage`) { plain = u.searchParams.get("link") ?? "/"; env = u.searchParams.get("env"); }
  const q = new URL(plain, "http://x").searchParams;
  return { origin: u.origin, plain, env, person: q.get(SIGNIN()), lang: q.get("lang") ?? "en", theme: q.get("scheme") === "dark" ? "dark" : "light" };
}
/** a capture's setup: run (or reused) for the frame's link; its target as an absolute address on the link's origin */
async function captureSetup(f: Flow, name: string, link: string, device: string, bg = false): Promise<{ out: SetupOut; to: string } | null> {
  const lp = linkParts(link), out = await runSetup(f, name, { person: lp.person, lang: lp.lang, theme: lp.theme, device, mode: lp.env ?? "static", bg });
  if (!out) return null;
  const t = setupTarget(out.url, lp.plain);
  const to = lp.env ? `${lp.origin}${R}/api/stage?env=${encodeURIComponent(lp.env)}&link=${encodeURIComponent(t)}` : t.startsWith("/") ? lp.origin + t : t;
  return { out, to };
}
/** a setup's page: the storage it asks for kept for this frame alone (sessionStorage "flex-setup:<id>", the id in the
 *  frame's window.name, which its next pages keep), then its target opened in place (no history entry). The frame's
 *  pages read it through FRAME_SCRIPT */
const setupPage = (out: SetupOut, to: string) => `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><script>(function(){var s=${JSON.stringify({ l: out.localStorage, s: out.sessionStorage, a: out.actions, c: out.clock ?? null, to }).replace(/</g, "\\u003c")};
try{var id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);if(Object.keys(s.l).length||Object.keys(s.s).length||s.a.length||s.c){sessionStorage.setItem("flex-setup:"+id,JSON.stringify({l:s.l,s:s.s,a:s.a,c:s.c}));window.name="flexsetup:"+id}else if(/^flexsetup:/.test(window.name))window.name=""}catch(e){}
location.replace(s.to)})()</script>`;
/** the frame script, given by the proxy to app pages once a setup has run in this browser (cookie flex_frames), first
 *  in their <head>; a no-op on other pages. (1) The frame storage: on an app page in a frame a setup opened (window.name "flexsetup:<id>"), localStorage and
 *  sessionStorage show the setup's keys over the browser's own, for that frame alone: what the app writes to those keys
 *  stays in the frame (kept across its reloads), every other key is the browser's as ever. Frames for different
 *  people on one origin share its storage, so this keeps their seeded storage apart. (2) The frame bridge: a frame on its
 *  own host (see api/setup-frame) is cross-origin to the review page, so it tells the page where it is, that it
 *  changes, and Shift and Shift+Click (a note), by postMessage */
const FRAME_SCRIPT = `<script>(function(){
var X=false;if(window.parent!==window){try{void window.parent.document}catch(e){X=true}}
function post(m){if(X)try{window.parent.postMessage({flexFrame:m},"*")}catch(e){}}
var rec=null,K=null,RS=null;
try{RS=window.sessionStorage;var mm=/^flexsetup:([\\w-]+)$/.exec(window.name||"");if(mm){K="flex-setup:"+mm[1];var raw=RS.getItem(K);if(raw)rec=JSON.parse(raw)}}catch(e){}
function save(){try{RS.setItem(K,JSON.stringify(rec))}catch(e){}}
/* (0) the frame's clock, before any app script */
if(rec&&rec.c)try{(${CLOCK_JS})(rec.c)}catch(e){}
/* (1) the frame's storage */
if(rec)try{var RL=window.localStorage,H=Object.prototype.hasOwnProperty;
function wrap(real,o,ses){function own(k){return ses&&/^flex-setup:/.test(k)}
 function keys(){var r=[];for(var i=0;i<real.length;i++){var k=real.key(i);if(!H.call(o,k)&&!own(k))r.push(k)}for(var k2 in o)if(o[k2]!==null)r.push(k2);return r}
 var api={getItem:function(k){k=String(k);return H.call(o,k)?o[k]:real.getItem(k)},
  setItem:function(k,v){k=String(k);if(H.call(o,k)){o[k]=String(v);save()}else real.setItem(k,v)},
  removeItem:function(k){k=String(k);if(H.call(o,k)){o[k]=null;save()}else real.removeItem(k)},
  clear:function(){for(var k in o)o[k]=null;save();keys().forEach(function(k){real.removeItem(k)})},
  key:function(i){var k=keys()[i];return k===undefined?null:k}};
 Object.defineProperty(api,"length",{get:function(){return keys().length}});
 return new Proxy(Object.create(api),{get:function(t,p){if(p in t)return t[p];if(typeof p==="symbol")return undefined;var v=api.getItem(p);return v===null?undefined:v},
  set:function(t,p,v){api.setItem(p,v);return true},deleteProperty:function(t,p){api.removeItem(p);return true},
  has:function(t,p){return p in t||api.getItem(p)!==null},ownKeys:function(){return keys()},
  getOwnPropertyDescriptor:function(t,p){var v=api.getItem(p);return v===null?undefined:{value:v,enumerable:true,configurable:true,writable:true}}})}
var L=wrap(RL,rec.l||(rec.l={}),false),S=wrap(RS,rec.s||(rec.s={}),true);
Object.defineProperty(window,"localStorage",{configurable:true,get:function(){return L}});
Object.defineProperty(window,"sessionStorage",{configurable:true,get:function(){return S}})}catch(e){}
/* (2) the frame's actions, once (a reload of the frame doesn't repeat them): after the page has loaded and gone quiet */
if(rec&&rec.a&&rec.a.length&&!rec.ran){
 window.__flexActions="pending";post({actions:"pending"});
 var A=rec.a,i=0;
 var norm=function(s){return String(s).replace(/\\s+/g," ").trim()};
 var vis=function(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=="hidden"};
 var find=function(sel){var t=/^text=([\\s\\S]*)$/.exec(sel),list;
  if(t){var q=t[1].trim(),ex=/^(["']).*\\1$/.test(q);if(ex)q=q.slice(1,-1);var ql=norm(q).toLowerCase();
   list=[].slice.call(document.querySelectorAll("body *")).filter(function(el){if(/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName))return false;var tx=norm(el.innerText||el.textContent||"");return ex?tx===norm(q):tx.toLowerCase().indexOf(ql)>=0});
   list=list.filter(function(el){return !list.some(function(o){return o!==el&&el.contains(o)})})}
  else list=[].slice.call(document.querySelectorAll(sel));
  return list.filter(vis)};
 var el=function(sel,nth,cb){var t0=Date.now();(function go(){var l;try{l=find(sel)}catch(e){return cb("bad selector "+sel)}var e=l[nth||0];if(e)return cb(null,e);if(Date.now()-t0>10000)return cb("no "+sel+(nth?" (#"+(nth+1)+")":"")+" after 10 s");setTimeout(go,100)})()};
 var setVal=function(e,v){var pr=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,d=Object.getOwnPropertyDescriptor(pr,"value");
  if(e.focus)e.focus();if(e.isContentEditable)e.textContent=v;else if(d&&d.set)d.set.call(e,v);else e.value=v;
  e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))};
 var click=function(e){e.scrollIntoView({block:"center"});var r=e.getBoundingClientRect(),o={bubbles:true,cancelable:true,composed:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0,pointerType:"mouse",isPrimary:true};
  try{e.dispatchEvent(new PointerEvent("pointerdown",o))}catch(x){}e.dispatchEvent(new MouseEvent("mousedown",o));if(e.focus)e.focus();
  try{e.dispatchEvent(new PointerEvent("pointerup",o))}catch(x){}e.dispatchEvent(new MouseEvent("mouseup",o));e.click()};
 var press=function(k){var a=document.activeElement||document.body,o={key:k,code:k.length===1?"Key"+k.toUpperCase():k,bubbles:true,cancelable:true};
  var go=a.dispatchEvent(new KeyboardEvent("keydown",o));
  if(go&&k==="Enter"&&a.tagName==="INPUT"&&a.form){if(a.form.requestSubmit)a.form.requestSubmit();else a.form.submit()}
  a.dispatchEvent(new KeyboardEvent("keyup",o))};
 var fin=function(err){window.__flexActions=err?"failed: "+err:"done";post({actions:window.__flexActions});if(!err){rec.ran=1;save()}};
 var step=function(){if(i>=A.length)return setTimeout(function(){fin(null)},500);
  var a=A[i],lab="action "+(i+1),next=function(err){if(err)return fin(lab+": "+err);i++;setTimeout(step,120)};
  try{if("wait" in a)return setTimeout(function(){next()},+a.wait||0);
   if("press" in a){press(a.press);return next()}
   el(a.fill||a.click||a.waitFor||a.scroll,"click" in a?a.nth:0,function(err,e){if(err)return next(err);
    try{if("fill" in a)setVal(e,a.value||"");else if("click" in a)click(e);else if("scroll" in a)e.scrollIntoView({block:"center"});next()}catch(x){next(String(x&&x.message||x))}})}
  catch(x){next(String(x&&x.message||x))}};
 var start=function(){var last=Date.now(),mo=new MutationObserver(function(){last=Date.now()});mo.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  (function w(){if(Date.now()-last>=500){mo.disconnect();step()}else setTimeout(w,100)})()};
 if(document.readyState==="complete")start();else addEventListener("load",start);
}
/* (3) the frame bridge, for a frame cross-origin to the review page */
if(X)try{
 var at=function(){post({at:location.pathname+location.search,state:document.readyState})};
 ["pushState","replaceState"].forEach(function(k){var o=history[k];history[k]=function(){var r=o.apply(this,arguments);at();return r}});
 addEventListener("popstate",at);addEventListener("hashchange",at);document.addEventListener("readystatechange",at);addEventListener("load",at);at();
 var t=0;new MutationObserver(function(){var n=Date.now();if(n-t>150){t=n;post({mut:1})}}).observe(document,{subtree:true,childList:true,characterData:true});
 addEventListener("keydown",function(e){if(e.key==="Shift")post({shift:true})},true);addEventListener("keyup",function(e){if(e.key==="Shift")post({shift:false})},true);
 var eat=function(e){if(e.shiftKey){e.preventDefault();e.stopImmediatePropagation()}};
 ["pointerup","mousedown","mouseup","click"].forEach(function(k){addEventListener(k,eat,true)});
 addEventListener("pointerdown",function(e){if(!e.shiftKey)return;eat(e);post({note:{x:e.clientX/innerWidth,y:e.clientY/innerHeight,at:location.pathname+location.search}})},true)}catch(e){}
})()</script>`;
/** the languages and variants (lang.mode.tN) the page has asked for: the background keeps every device and theme of
 *  each up to date */
const langs = new Set<string>();
setInterval(() => {
  for (const f of flows()) {
    try { build(f); } catch { continue; }
    const idx = indexes.get(f.name)!;
    for (const lv of langs) { const i = lv.indexOf("."), lang = lv.slice(0, i), variant = lv.slice(i + 1); for (const device of idx.devices) for (const theme of idx.themes ?? ["light", "dark"]) for (const n of namesOn(f, device, variant)) snapshot(f, n, device, theme, lang, 2, variant); }
  }
}, 15000).unref();

/* ── the home: the project's flows as cards ── */
/** a device's kind, as the page groups them */
const kindOf = (k: string) => (/landscape/.test(k) ? "land" : /ipad|tablet/.test(k) ? "tablet" : /iphone|android/.test(k) ? "phone" : /mac|display|pc/.test(k) ? "laptop" : "window");
function home(): string {
  const pj = proj(), logo = pj?.logo && existsSync(pj.logo) ? `data:${/\.svg$/i.test(pj.logo) ? "image/svg+xml" : "image/png"};base64,${readFileSync(pj.logo).toString("base64")}` : null;
  const keys = [...new Set(flows().flatMap((f) => { try { build(f); return indexes.get(f.name)!.devices; } catch { return f.devices ?? []; } }))];
  return homePage({ name: pj?.name || pj?.project || "Flows", logo, root: R, envs: envList(), devices: keys.map((k) => ({ key: k, cat: kindOf(k), label: deviceFor(k)?.label ?? k })) });
}
/** each flow for its card: title, screens, open notes (and those notes, for the home's Notes), the last round, and its
 *  cover (its first screen's snapshot for this device, theme and language: wanted first) */
function homeData(qs: URLSearchParams) {
  const theme = qs.get("theme") === "dark" ? "dark" : "light", lang = /^[a-z]{2,3}$/.test(qs.get("lang") ?? "") ? qs.get("lang")! : "en", want = qs.get("device") ?? "";
  const variant = variantOf(qs);
  langs.add(`${lang}.${variant}`);
  return { flows: flows().map((f) => {
    const base = { name: f.name, title: f.label, href: `${R}/f/${f.name}/`, ...(isPeek(f) ? { peek: true } : {}) };
    try { build(f); } catch (e) { return { ...base, error: (e as Error).message.split("\n").slice(0, 4).join("\n"), screens: null, open: 0, notes: [], lastRound: null, cover: null, unsent: false }; }
    // with tester tools off, the flow's tester-only screens neither count nor make the cover
    const idx = indexes.get(f.name)!, hide = /\.t0\./.test(variant) ? new Set(testerNames(f)) : new Set<string>();
    const shown = (idx.screens ?? []).filter((s) => !hide.has(s.name)), first = shown[0]?.name ?? Object.keys(idx.links).find((n) => !hide.has(n));
    const device = idx.devices.includes(want) ? want : idx.devices.find((d) => kindOf(d) === kindOf(want)) ?? idx.devices[0];
    let doc: Doc | null = null;
    try { doc = isPeek(f) ? { ...peekDoc(f), notes: [] } : readDoc(notesFileOf(f.file)).doc; } catch { /* mid-write */ }
    const labels = Object.fromEntries((idx.screens ?? []).map((s) => [s.name, s.label ?? s.name]));
    const open = (doc?.notes ?? []).filter((n) => !n.resolved);
    const last = doc?.rounds.length ? doc.rounds[doc.rounds.length - 1] : null;
    return { ...base, screens: idx.screens ? items(shown) : null, open: open.length, lastRound: last ? { round: last.round, sentAt: last.sentAt } : null,
      unsent: (doc?.notes ?? []).some((n) => n.round == null || n.replies.some((r) => r.by === "author" && r.round === null)),
      notes: open.map((n) => ({ id: n.id, n: n.n, text: n.text, label: labels[n.screen] ?? n.screen })),
      cover: first && device ? snapshot(f, first, device, theme, lang, 1, variant).url : null };
  }).concat(broken()) };
}
/* ── ⌘K's index: every flow, screen and state of the project, for the board's command bar (it matches and ranks them
   itself, offline). A screen another flow brings in with "use" is listed under its own flow, and once more under each
   host (via: its flow; src: what a peek of it names) ── */
type SearchItem = { kind: "flow" | "screen" | "state"; flow: string; flowTitle: string; screen?: string; state?: string; label: string; crumbs: string[];
  description: string; keywords: string[]; tags: string[]; people: string[]; href: string; src?: string; via?: string; group?: string; temp?: boolean; tester?: boolean };
function searchData() {
  const items: SearchItem[] = [];
  const doc = (j: any) => { const d = j?._doc ?? j?.description; return Array.isArray(d) ? d.join(" ") : typeof d === "string" ? d : ""; };
  const uniq = (a: string[]) => [...new Set(a)];
  for (const f of flows()) {
    let raw: any, exp: any;
    try { raw = JSON.parse(readFileSync(f.file, "utf8")); exp = readFlow(f.file); build(f); } catch { continue; }
    const temp = isPeek(f), base = `${R}/f/${encodeURIComponent(f.name)}/`, who = personInfo(f), tester = new Set(testerNames(f));
    const ppl = (n: string) => { const i = who.get(n); return i ? uniq([...(i.person ? [i.person] : []), ...i.people]) : []; };
    items.push({ kind: "flow", flow: f.name, flowTitle: f.label, label: f.label, crumbs: [], description: doc(raw), keywords: strList(raw.keywords), tags: strList(raw.tags),
      people: uniq([...(typeof raw.person === "string" ? [raw.person] : []), ...strList(raw.people)]), href: base, ...(temp ? { temp } : {}) });
    // each expanded screen: its own (src: here) or a use's (src: its flow and its name there)
    const from = new Map<string, { via: string; src: string }>();
    for (const s of raw.screens ?? []) if (s && typeof s.use === "string") {
      const [fl, sc] = s.use.split("/");
      if (sc) { from.set(s.as ?? sc, { via: fl, src: `${fl}/${sc}` }); continue; }
      try { for (const x of readFlow(join(usesDir(f.file, raw), fl + ".json")).screens ?? []) from.set(x.name, { via: fl, src: `${fl}/${x.name}` }); } catch { /* said by build */ }
    }
    for (const x of exp.screens ?? []) {
      if (!x?.name) continue;
      const u = from.get(x.name), slabel = x.label ?? x.name, g = typeof x.group === "string" ? x.group : undefined;
      const q = `screens=one&screen=${encodeURIComponent(x.name)}${g ? `&sub=${encodeURIComponent(g)}` : ""}`;
      const kw = strList(x.keywords), tg = strList(x.tags), common = { flow: f.name, flowTitle: f.label, src: u?.src ?? `${f.name}/${x.name}`, ...(u ? { via: u.via } : {}), ...(g ? { group: g } : {}), ...(temp ? { temp } : {}) };
      items.push({ kind: "screen", ...common, screen: x.name, label: slabel, crumbs: [f.label, ...(g ? [g] : [])], description: typeof x.description === "string" ? x.description : "",
        keywords: kw, tags: tg, people: ppl(x.name), href: `${base}?${q}&stmode=all`, ...(tester.has(x.name) ? { tester: true } : {}) });
      // a state is found by its screen's tags and keywords too (shown: its own tags, then its screen's)
      for (const st of x.states ?? []) if (st?.name) items.push({ kind: "state", ...common, screen: x.name, state: st.name, label: st.label ?? st.name, crumbs: [f.label, ...(g ? [g] : []), slabel],
        description: typeof st.description === "string" ? st.description : "", keywords: uniq([...strList(st.keywords), ...kw]), tags: uniq([...strList(st.tags), ...tg]),
        people: ppl(`${x.name}@${st.name}`), href: `${base}?${q}&stmode=one&state=${encodeURIComponent(st.name)}`, ...(tester.has(`${x.name}@${st.name}`) ? { tester: true } : {}) });
    }
  }
  return { tags: tagsMap(), people: proj()?.people ?? {}, items };
}
/** a folder's flow files that don't parse (being edited, or wrong): a card with the error */
function broken() {
  if (!statSync(target).isDirectory()) return [];
  return readdirSync(target).filter((n) => n.endsWith(".json") && !n.endsWith(".notes.json")).sort().flatMap((n) => {
    try { JSON.parse(readFileSync(join(target, n), "utf8")); return []; } catch (e) {
      const name = n.replace(/\.json$/, "");
      return [{ name, title: name, href: `${R}/f/${name}/`, error: `${n}: ${(e as Error).message}`, screens: null, open: 0, notes: [], lastRound: null, cover: null, unsent: false }];
    }
  });
}

/* ── the server ── */
const body = (rq: IncomingMessage) => new Promise<any>((ok, no) => { let s = ""; rq.on("data", (c) => (s += c)); rq.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } }); });
const send = (rs: ServerResponse, code: number, type: string, data: string | Buffer) => { rs.writeHead(code, { "content-type": type, "cache-control": "no-store" }); rs.end(data); };
const json = (rs: ServerResponse, code: number, x: unknown) => send(rs, code, "application/json", JSON.stringify(x));
const flowNamed = (name: string | null) => flows().find((f) => f.name === name);
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** the page's changes, each applied to the file as it is now */
async function apply(f: Flow, a: any): Promise<Doc> {
  const file = notesFileOf(f.file), now = new Date().toISOString();
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (a.op === "add") {
    const text = str(a.text), x = +a.x, y = +a.y;
    if (!text || !(x >= 0 && x <= 1 && y >= 0 && y <= 1) || !a.screen || !a.device) throw new Error("a note needs text, a screen, a device and a point");
    const state = a.state || null, lang = /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(a.lang ?? "") ? a.lang : undefined, mode = envOf(a.mode) ? a.mode as string : "static", tester = a.tester ? 1 : 0, offline = a.offline ? 1 : 0;
    if (!indexes.has(f.name)) build(f);
    const person = typeof a.person === "string" && /^[a-z0-9_-]+$/i.test(a.person) ? a.person : null;
    const note: Note = { id: id(), n: 0, flow: f.name, screen: a.screen, state, device: a.device, theme: a.theme === "dark" ? "dark" : "light", lang, mode, tester, offline, person, x, y, text, by: "author",
      createdAt: now, round: null, resolved: false, replies: [], link: linkOf(f, a.screen, state, a.device, a.theme, lang, `${mode}.t${tester}.s${offline ? 0 : 1}.p-${person ?? "default"}`),
      // never a staging token in the file
      at: typeof a.at === "string" && a.at.startsWith("/") ? a.at.replace(/([?&])token=[^&]*&?/, "$1").replace(/[?&]$/, "") : undefined };
    const doc = await update(file, (d) => { note.n = d.notes.reduce((m, x) => Math.max(m, x.n ?? 0), 0) + 1; d.flow ??= f.name; d.notes.push(note); });
    capture(f, note);
    return doc;
  }
  const one = (d: Doc) => d.notes.find((n) => n.id === a.id) ?? (() => { throw new Error(`no note ${a.id}`); })();
  // the author answering a reply reopens the note: it goes out with the next Send
  if (a.op === "reply") { const text = str(a.text); if (!text) throw new Error("an empty reply"); return update(file, (d) => { const n = one(d); n.replies.push({ by: "author", text, at: now, round: null }); n.resolved = false; }); }
  if (a.op === "resolve") return update(file, (d) => { one(d).resolved = !!a.resolved; });
  if (a.op === "edit") { const text = str(a.text); if (!text) throw new Error("an empty note"); return update(file, (d) => { const n = one(d); if (n.round != null) throw new Error("a sent note can't change: reply to it"); n.text = text; }); }
  if (a.op === "delete") return update(file, (d) => { if (one(d).round != null) throw new Error("a sent note can't be deleted: resolve it"); d.notes = d.notes.filter((n) => n.id !== a.id); });
  if (a.op === "send") return update(file, (d) => {
    // the drafts, and the notes the author has replied to since they were sent
    const round = latestRound(d) + 1, ids: string[] = [];
    for (const n of d.notes) {
      const fresh = n.replies.filter((r) => r.by === "author" && r.round === null);
      if (n.round == null) n.round = round;
      else if (!fresh.length) continue;
      fresh.forEach((r) => (r.round = round));
      ids.push(n.id);
    }
    if (!ids.length) throw new Error("nothing to send");
    d.rounds.push({ round, sentAt: now, notes: ids });
  });
  throw new Error(`unknown op ${a.op}`);
}

/* a peek's notes are its screens' flows': each of its screens comes from a flow (and a screen there); the page reads
   their notes as the peek's, and what it does goes to the flow the note is on */
function peekSources(f: Flow): Map<string, { flow: Flow; screen: string }> {
  const m = new Map<string, { flow: Flow; screen: string }>();
  let j: any; try { j = JSON.parse(readFileSync(f.file, "utf8")); } catch { return m; }
  for (const s of j.screens ?? []) {
    const [fl, sc] = String(s?.use ?? "").split("/"), src = flowNamed(fl);
    if (!src) continue;
    if (sc) m.set(s.as ?? sc, { flow: src, screen: sc });
    else try { for (const x of readFlow(src.file).screens ?? []) m.set(x.name, { flow: src, screen: x.name }); } catch { /* being edited */ }
  }
  return m;
}
const peekFlows = (m: Map<string, { flow: Flow; screen: string }>) => [...new Map([...m.values()].map((v) => [v.flow.name, v.flow])).values()];
function peekDoc(f: Flow): Doc {
  const m = peekSources(f), back = new Map([...m].map(([name, v]) => [v.flow.name + "|" + v.screen, name]));
  const notes: Note[] = [];
  let build: string | null = null;
  for (const src of peekFlows(m)) {
    const d = readDoc(notesFileOf(src.file)).doc;
    if (typeof d.build === "string" && (!build || d.build > build)) build = d.build;
    for (const n of d.notes) { const name = back.get(src.name + "|" + n.screen); if (name) notes.push({ ...n, flow: src.name, screen: name }); }
  }
  return { flow: f.name, notes, rounds: [], ...(build ? { build } : {}) };
}
async function applyPeek(f: Flow, a: any): Promise<Doc> {
  const m = peekSources(f), srcs = peekFlows(m);
  if (a.op === "add") { const s = m.get(a.screen) ?? (() => { throw new Error(`no screen ${a.screen} in the peek`); })(); await apply(s.flow, { ...a, screen: s.screen }); }
  else if (a.op === "send") {
    // each flow's round: its drafts and the replies to it
    let sent = 0;
    for (const src of srcs) try { await apply(src, a); sent++; } catch (e) { if (!/nothing to send/.test((e as Error).message)) throw e; }
    if (!sent) throw new Error("nothing to send");
  } else {
    const src = srcs.find((x) => readDoc(notesFileOf(x.file)).doc.notes.some((n) => n.id === a.id)) ?? (() => { throw new Error(`no note ${a.id}`); })();
    await apply(src, a);
  }
  return peekDoc(f);
}

/* the app under review, proxied: every path outside the review's own (R, below) goes to its base, so the canvas's frames are on the page's
   own origin (the page sees Shift+Click inside them, and where each has got to). An app exported as an SPA at its root
   (its /_expo/… assets, its routes) works as it is. */
const appBase = new URL(opt("--base") ?? flows()[0].base);
// In an environment (the page's cookie flex_mode=<key>, one of the project's environments), the app is that
// environment's build, and its gateway calls (api.path/…) go to api.target with the rest of the path, method, body and
// headers (Authorization too) as they came.
/** the project's environments in order ("environments", or an older single "staging") */
const envs = (): Record<string, Env> => { const pj = proj(); return pj?.environments ?? (pj?.staging ? { staging: { label: "Staging", ...pj.staging } } : {}); };
const envOf = (k?: string | null): Env | null => (k && k !== "static" ? envs()[k] ?? null : null);
const envList = () => Object.entries(envs()).map(([key, e]) => ({ key, label: e.label ?? key[0].toUpperCase() + key.slice(1), accounts: Object.keys(e.accounts ?? {}) }));
const cookieEnv = (rq: IncomingMessage) => (rq.headers.cookie ?? "").match(/(?:^|;\s*)flex_mode=([^;]+)/)?.[1] ?? null;
/** the project's "proxies" ({ "/prefix": "http://another:port" }): a path under a prefix goes to that origin, the path
 *  as it is, method, headers and body too; longest prefix first */
const proxiesOf = (): [string, URL][] => Object.entries(proj()?.proxies ?? {}).flatMap(([p, t]): [string, URL][] => {
  try { return p.startsWith("/") && p.length > 1 ? [[p.replace(/\/$/, ""), new URL(t)]] : []; } catch { return []; } }).sort((a, b) => b[0].length - a[0].length);
const under = (url: string, p: string) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?");
/** a redirect to the app's address (its base, a flow's, an environment's) or a proxied origin's: made relative, so a
 *  frame stays on this origin */
function localLocation(loc: string, also: string[] = []): string {
  const origins = new Set([...appOrigins(), ...proxiesOf().map(([, t]) => t.origin), ...also]);
  try { const u = new URL(loc); if (origins.has(u.origin)) return u.pathname + u.search + u.hash || "/"; } catch { /* relative already */ }
  return loc;
}
/** where a request goes (an environment's gateway, a proxied origin, else the app or the environment's build), and the
 *  path there */
function upstream(rq: IncomingMessage): { t: URL; path: string } {
  const st = envOf(cookieEnv(rq)), url = rq.url ?? "/", api = st?.api?.path?.replace(/\/$/, "");
  if (st && api && st.api && under(url, api)) { const t = new URL(st.api.target); return { t, path: t.pathname.replace(/\/$/, "") + (url.slice(api.length) || "/") }; }
  const px = proxiesOf().find(([p]) => under(url, p));
  if (px) return { t: px[1], path: px[1].pathname.replace(/\/$/, "") + url };
  return { t: st ? new URL(st.base) : appBase, path: url };
}
/** a WebSocket (the app's dev server's HMR, say): passed through to where its path goes, as it is */
function upgrade(rq: IncomingMessage, sock: import("node:stream").Duplex, head: Buffer) {
  let to: ReturnType<typeof upstream>;
  try { to = upstream(rq); } catch { return void sock.destroy(); }
  const { t, path } = to, secure = t.protocol === "https:" || t.protocol === "wss:", port = +(t.port || (secure ? 443 : 80));
  const up = secure ? tlsConnect({ host: t.hostname, port, servername: t.hostname }) : netConnect({ host: t.hostname, port });
  const end = () => { sock.destroy(); up.destroy(); };
  up.on("error", end); sock.on("error", end); up.on("close", end); sock.on("close", end);
  up.on(secure ? "secureConnect" : "connect", () => {
    const lines = [`${rq.method} ${path} HTTP/${rq.httpVersion}`];
    for (let i = 0; i < rq.rawHeaders.length; i += 2) { const k = rq.rawHeaders[i], lk = k.toLowerCase(); lines.push(`${k}: ${lk === "host" ? t.host : lk === "origin" ? t.origin : rq.rawHeaders[i + 1]}`); }
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
}
function proxy(rq: IncomingMessage, rs: ServerResponse) {
  const st = envOf(cookieEnv(rq));
  const url = rq.url ?? "/", api = st?.api?.path?.replace(/\/$/, "");
  if (st && api && st.api && (url === api || url.startsWith(api + "/") || url.startsWith(api + "?"))) {
    const t = new URL(st.api.target), rest = url.slice(api.length) || "/";
    const headers = { ...rq.headers, host: t.host };
    for (const k of ["cookie", "origin", "referer"]) delete headers[k];
    const up = (t.protocol === "https:" ? httpsRequest : httpRequest)({ protocol: t.protocol, hostname: t.hostname, port: t.port || undefined, method: rq.method,
      path: t.pathname.replace(/\/$/, "") + rest, headers }, (ar) => { rs.writeHead(ar.statusCode ?? 502, ar.headers); ar.pipe(rs); });
    up.on("error", (e) => { if (!rs.headersSent) send(rs, 502, "text/plain", `the gateway at ${t.origin} isn't answering: ${e.message}`); else rs.end(); });
    return void rq.pipe(up);
  }
  // a proxied origin ("proxies"): as it is, but a redirect to the app's or a proxied address stays on this origin
  const px = proxiesOf().find(([p]) => under(url, p));
  if (px) {
    const t = px[1];
    const up = (t.protocol === "https:" ? httpsRequest : httpRequest)({ protocol: t.protocol, hostname: t.hostname, port: t.port || undefined, method: rq.method,
      path: t.pathname.replace(/\/$/, "") + url, headers: { ...rq.headers, host: t.host } }, (ar) => {
      const h = { ...ar.headers };
      if (typeof h.location === "string") h.location = localLocation(h.location);
      rs.writeHead(ar.statusCode ?? 502, h); ar.pipe(rs);
    });
    up.on("error", (e) => { if (!rs.headersSent) send(rs, 502, "text/plain", `${t.origin} (proxies ${px[0]}) isn't answering: ${e.message}`); else rs.end(); });
    return void rq.pipe(up);
  }
  const app = st ? new URL(st.base) : appBase;
  // a browser a setup has run in (cookie flex_frames): its app pages get the frame storage script (FRAME_SCRIPT), so
  // they come unencoded; every other request goes through untouched
  const inject = rq.method === "GET" && /(?:^|;\s*)flex_frames=1/.test(rq.headers.cookie ?? "") && ["iframe", "document", "frame"].includes(String(rq.headers["sec-fetch-dest"] ?? ""));
  const headers = { ...rq.headers, host: app.host };
  if (inject) delete headers["accept-encoding"];
  const up = httpRequest({ protocol: app.protocol, hostname: app.hostname, port: app.port, method: rq.method, path: url, headers }, (ar) => {
    const h = { ...ar.headers };
    // a redirect to the app's own address (or a proxied one) stays on this one
    if (typeof h.location === "string") h.location = localLocation(h.location, [app.origin]);
    if (inject && /^text\/html/i.test(String(h["content-type"] ?? "")) && !h["content-encoding"]) {
      const parts: Buffer[] = [];
      ar.on("data", (c) => parts.push(c));
      ar.on("end", () => {
        const html = Buffer.concat(parts).toString("utf8"), m = html.match(/<head[^>]*>/i) ?? html.match(/<html[^>]*>/i) ?? html.match(/<!doctype[^>]*>/i);
        const body = m ? html.slice(0, m.index! + m[0].length) + FRAME_SCRIPT + html.slice(m.index! + m[0].length) : FRAME_SCRIPT + html;
        delete h["content-length"]; delete h["transfer-encoding"];
        rs.writeHead(ar.statusCode ?? 502, { ...h, "content-length": Buffer.byteLength(body) });
        rs.end(body);
      });
      return;
    }
    rs.writeHead(ar.statusCode ?? 502, h);
    ar.pipe(rs);
  });
  up.on("error", (e) => { if (!rs.headersSent) send(rs, 502, "text/plain", `the app at ${app.origin} isn't answering: ${e.message}`); else rs.end(); });
  rq.pipe(up);
}

/* ── an environment's sign-in: a seed link's signin=<persona> becomes token=<its gateway's token for that persona's
   account>. The accounts' $VARS come from the process's environment, else the env file (the environment's "env", else
   the project's: KEY=VALUE, relative to the folder holding .flex/); nothing of them, nor the token, is written anywhere
   or shown in the page (the frame is redirected to its link) ── */
const envCache = new Map<string, { at: number; vars: Record<string, string> }>();
function envVars(key: string): Record<string, string> {
  const e = envOf(key), name = e?.env ?? proj()?.env, file = name && P ? resolve(dirname(P.dir), name) : null, at = mtime(file);
  const had = envCache.get(file ?? "");
  if (had && had.at === at) return had.vars;
  const vars: Record<string, string> = {};
  if (file && existsSync(file)) for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  envCache.set(file ?? "", { at, vars });
  return vars;
}
const expand = (key: string, v: string) => v.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => process.env[k] ?? envVars(key)[k] ?? "");
const tokens = new Map<string, { token: string; until: number }>();
async function envToken(key: string, persona: string): Promise<string> {
  const had = tokens.get(`${key}:${persona}`);
  if (had && had.until > Date.now()) return had.token;
  const st = envOf(key), acct = st?.accounts?.[persona];
  if (!st?.login?.url || !acct) throw new Error(`no ${key} account for ${persona}`);
  const res = await fetch(st.login.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email: expand(key, acct.email), password: expand(key, acct.password) }) });
  const j: any = await res.json().catch(() => null);
  const token = (st.login.token ?? "data.token").split(".").reduce((o: any, k) => o?.[k], j);
  if (!res.ok || typeof token !== "string") throw new Error(`the gateway's sign-in answered ${res.status}${j?.message ? `: ${String(j.message).slice(0, 120)}` : ""}`);
  // until shortly before it expires (expiry_at, or expiry_at_minutes), else 50 minutes
  const d = j?.data ?? j, ex = d?.expiry_at ? Date.parse(d.expiry_at) : d?.expiry_at_minutes ? Date.now() + +d.expiry_at_minutes * 60000 : NaN;
  tokens.set(`${key}:${persona}`, { token, until: (Number.isFinite(ex) ? ex : Date.now() + 50 * 60000) - 2 * 60000 });
  return token;
}
/** a frame's placeholder in an environment (no account for its persona, a failed sign-in) */
const stagePage = (label: string, text: string, dark: boolean) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html,body{height:100%;margin:0}
body{display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;font:600 16px/1.4 -apple-system,system-ui,sans-serif;background:${dark ? "#121115" : "#f4f4f6"};color:${dark ? "#a19faa" : "#6b6873"}}
b{display:block;margin-bottom:6px;color:${dark ? "#f2f1f5" : "#16151a"}}</style><div><b>${label.replace(/</g, "&lt;")}</b>${text.replace(/</g, "&lt;")}</div>`;
// the review's own paths (its page, notes API, screenshots) sit under the product's name when the flow gives one
// ("project": "ncaa" → /ncaa/f/auth/), else under /_flex/; every other path is the app's
const R = "/" + (flows()[0].project ?? "_flex");
const server = createServer(async (rq, rs) => {
  const u = new URL(rq.url ?? "/", "http://x"), p = decodeURIComponent(u.pathname);
  if (p === R) { rs.writeHead(302, { location: R + "/" }); return rs.end(); }
  if (!p.startsWith(R + "/")) return proxy(rq, rs);
  const q = p.slice(R.length);
  try {
    // the home: a card per flow
    if (q === "/") return send(rs, 200, "text/html; charset=utf-8", home());
    if (q === "/api/home") return json(rs, 200, homeData(u.searchParams));
    // the canvas's list picker: every flow (it shows only for more than one)
    if (q.endsWith("/lists.json")) return json(rs, 200, flows().map((f) => {
      let screens: number | null = null, open = 0;
      try { screens = items(readFlow(f.file).screens); } catch { /* mid-edit */ }
      try { open = readDoc(notesFileOf(f.file)).doc.notes.filter((n) => !n.resolved).length; } catch { /* mid-write */ }
      return { href: `${R}/f/${f.name}/`, title: f.label, screens, open };
    }));
    const page = q.match(/^\/f\/([^/]+)\/(index\.html)?$/);
    // the page, with its version, which it polls to reload itself when that changes
    if (page) { const f = flowNamed(page[1]); return f ? send(rs, 200, "text/html; charset=utf-8", readFileSync(build(f), "utf8").replace("<head>", `<head><script>var FLEXV=${JSON.stringify(version(f))},FLEXREADY=${JSON.stringify(proj()?.ready ?? null).replace(/</g, "\\u003c")},FLEXENVS=${JSON.stringify(envList()).replace(/</g, "\\u003c")},FLEXTESTER=${JSON.stringify(testerNames(f)).replace(/</g, "\\u003c")},FLEXSIGOFF=${JSON.stringify([...signalOff(f)]).replace(/</g, "\\u003c")},FLEXPEOPLE=${peopleJson(f)},FLEXSETUP=${JSON.stringify([...setupOf(f).keys()]).replace(/</g, "\\u003c")},FLEXPARAMS=${paramsJson()},FLEXSYSTEM=${systemJson()},FLEXTAGS=${tagsJson()}</script>`)) : send(rs, 404, "text/plain", "no such flow"); }
    if (q === "/api/version") {
      const f = flowNamed(u.searchParams.get("flow"));
      if (!f) return json(rs, 404, { error: "no such flow" });
      try { return json(rs, 200, { v: version(f) }); } catch (e) { return json(rs, 503, { error: (e as Error).message.split("\n")[0] }); }
    }
    // the grid's snapshots for the devices, theme and language it shows: their addresses (null: not taken yet); those
    // missing or stale go to the front of the captures, the ones wanted before them back to the background
    if (q === "/api/snaps") {
      const f = flowNamed(u.searchParams.get("flow"));
      if (!f) return json(rs, 404, { error: "no such flow" });
      build(f);
      const devices = (u.searchParams.get("devices") ?? "").split(",").filter(Boolean), theme = u.searchParams.get("theme") === "dark" ? "dark" : "light";
      const lang = /^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(u.searchParams.get("lang") ?? "") ? u.searchParams.get("lang")! : "en", variant = variantOf(u.searchParams);
      langs.add(`${lang}.${variant}`);
      // those on the page first (show: the names it is drawing), then the rest of this view
      const show = new Set((u.searchParams.get("show") ?? "").split(",").filter(Boolean));
      const keys = new Set<string>(), out: Record<string, { url: string | null; fresh: boolean }> = {};
      for (const d of devices) for (const n of namesOn(f, d, variant)) {
        const v = sigFix(f, n, variant);
        out[`${n}.${d}.${theme}.${lang}.${v}`] = snapshot(f, n, d, theme, lang, show.has(n) ? 1 : 2, v);
        if (show.has(n)) keys.add(`snap:${f.name}:${snapName(n, d, theme, lang, v)}`);
      }
      for (const j of jobs.values()) if (j.prio === 1 && !keys.has(j.key)) j.prio = 2;
      return json(rs, 200, out);
    }
    // a frame in an environment: its seed link signed in as its persona's account there (token=), by a redirect
    if (q === "/api/stage") {
      const link = u.searchParams.get("link") ?? "/", key = u.searchParams.get("env") ?? cookieEnv(rq) ?? "", env = envOf(key);
      if (!env) return send(rs, 400, "text/plain", "no such environment");
      const label = env.label ?? key;
      if (!link.startsWith("/") || link.startsWith("//")) return send(rs, 400, "text/plain", "a link on the app");
      const lu = new URL(link, "http://x"), persona = lu.searchParams.get(SIGNIN()), dark = lu.searchParams.get("scheme") === "dark";
      if (persona) {
        if (!env.accounts?.[persona]) return send(rs, 200, "text/html; charset=utf-8", stagePage(label, `No ${label} account for ${persona}`, dark));
        try { lu.searchParams.set("token", await envToken(key, persona)); lu.searchParams.delete(SIGNIN()); }
        catch (e) { return send(rs, 200, "text/html; charset=utf-8", stagePage(label, `${label} sign-in failed for ${persona}: ${(e as Error).message}`, dark)); }
      }
      rs.writeHead(302, { location: lu.pathname + lu.search, "cache-control": "no-store" });
      return rs.end();
    }
    // a frame with a setup (flex's "setup" command, or declared "storage"): the setup run (or reused), its cookies set on
    // this origin (those of an earlier setup it doesn't set again expired), its storage handed to the frame alone (see
    // FRAME_SCRIPT), then its target opened in place; a failed setup is the frame's placeholder, with the command's stderr
    if (q === "/api/setup-frame") {
      const f = flowNamed(u.searchParams.get("flow")), name = u.searchParams.get("name") ?? "", link = u.searchParams.get("link") ?? "/";
      const key = u.searchParams.get("env") || "static", env = envOf(key) ? key : null, device = u.searchParams.get("device") ?? "";
      if (!f) return send(rs, 404, "text/plain", "no such flow");
      if (!link.startsWith("/") || link.startsWith("//")) return send(rs, 400, "text/plain", "a link on the app");
      const lq = new URL(link, "http://x").searchParams, dark = lq.get("scheme") === "dark";
      let out: SetupOut | null;
      try { build(f); out = await runSetup(f, name, { person: lq.get(SIGNIN()), lang: lq.get("lang") ?? "en", theme: dark ? "dark" : "light", device, mode: env ?? "static" }); }
      catch (e) { return send(rs, 200, "text/html; charset=utf-8", stagePage("Setup failed", (e as Error).message.replace(/^setup for \S+:? ?/, ""), dark) + `<i data-flex-setup-error hidden></i><script>try{parent.postMessage({flexFrame:{failed:1}},"*")}catch(e){}</script>`); }
      out ??= { cookies: [], localStorage: {}, sessionStorage: {}, actions: [] };
      const t = setupTarget(out.url, link), to = env && t.startsWith("/") ? `${R}/api/stage?env=${encodeURIComponent(env)}&link=${encodeURIComponent(t)}` : t;
      const had = (rq.headers.cookie ?? "").match(/(?:^|;\s*)flex_setup_cookies=([^;]*)/)?.[1] ?? "", now = out.cookies.map((c) => `${c.name}|${c.path ?? "/"}`);
      const cookies = [
        ...decodeURIComponent(had).split(",").filter((x) => x && !now.includes(x)).map((x) => { const [n, pth] = x.split("|"); return `${n}=; Path=${pth || "/"}; Max-Age=0`; }),
        ...out.cookies.map((c) => [`${c.name}=${c.value}`, `Path=${c.path ?? "/"}`, c.httpOnly && "HttpOnly", c.secure && "Secure", c.sameSite && `SameSite=${c.sameSite}`, typeof c.maxAge === "number" && `Max-Age=${c.maxAge}`].filter(Boolean).join("; ")),
        `flex_setup_cookies=${encodeURIComponent(now.join(","))}; Path=/; SameSite=Lax`,
        // the proxy gives this browser's app pages the frame storage script (FRAME_SCRIPT) from now on
        "flex_frames=1; Path=/; SameSite=Lax",
        // the frame's data mode, for the proxy (a frame on its own host has no cookie of the page's)
        `flex_mode=${env ?? "static"}; Path=/; SameSite=Lax`];
      rs.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "set-cookie": cookies });
      return rs.end(setupPage(out, to));
    }
    // Reset to defaults: every setup is run again when next wanted
    // the page's Setup switch (View): setup commands allowed for this server's session
    if (q === "/api/setup-allow") {
      if (rq.method === "POST") { const b = await body(rq); allowSetup = !!b.on; console.error(`setup commands ${allowSetup ? "allowed" : "not allowed"} (the page's Setup switch)`); }
      return json(rs, 200, { on: allowSetup });
    }
    // ⌘K's index (the page fetches it each time it opens: it's small)
    if (q === "/api/search") return json(rs, 200, searchData());
    // ⌘K's ⇧↵: a peek of what it found ({ refs, title }, as flex review peek takes them), opened by the page
    if (q === "/api/peek" && rq.method === "POST") {
      const pj = proj();
      if (!pj) return json(rs, 400, { error: "a peek needs a project (.flex/project.json)" });
      const b = await body(rq), refs = strList(b.refs);
      if (!refs.length) return json(rs, 400, { error: "nothing to peek at" });
      const made = writePeek(pj, refs, typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : "Peek");
      return json(rs, 200, { href: `${R}/f/${PEEK}/`, count: made.count });
    }
    // the board's × on the peek: gone, with its snapshots
    if (q === "/api/peek" && rq.method === "DELETE") { if (P) { rmSync(dirname(peekFileOf(P.dir)), { recursive: true, force: true }); rmSync(join(P.dir, "cache", "snapshots", PEEK), { recursive: true, force: true }); } return json(rs, 200, { ok: true }); }
    if (q === "/api/setup-reset") { setupDone.clear(); setupFailed.clear(); return json(rs, 200, { ok: true }); }
    // a live frame is ready: its snapshot is taken again (it may be older than the app), after the ones on the page
    if (q === "/api/resnap") {
      const f = flowNamed(u.searchParams.get("flow")), name = u.searchParams.get("name") ?? "", device = u.searchParams.get("device") ?? "";
      const theme = u.searchParams.get("theme") === "dark" ? "dark" : "light", lang = /^[a-z]{2,3}$/.test(u.searchParams.get("lang") ?? "") ? u.searchParams.get("lang")! : "en";
      const variant = variantOf(u.searchParams);
      if (!f || !snapLink(f, name, device, theme, lang, variant)) return json(rs, 404, { error: "no such frame" });
      const m = manifest(f)[snapName(name, device, theme, lang, sigFix(f, name, variant))];
      if (m) m.build = `stale:${Date.now()}`;
      snapshot(f, name, device, theme, lang, 1, variant);
      return json(rs, 200, { ok: true });
    }
    const snap = q.match(/^\/snap\/([^/]+)\/([^/]+\.png)$/);
    if (snap) { const f = flowNamed(snap[1]), file = f && join(snapDir(f), basename(snap[2])); return file && existsSync(file) ? send(rs, 200, "image/png", readFileSync(file)) : send(rs, 404, "text/plain", "no such snapshot"); }
    if (q.match(/^\/f\/[^/]+$/)) { rs.writeHead(302, { location: p + "/" }); return rs.end(); }
    // a note's screenshots, from <flow>.notes/
    const shot = q.match(/^\/shots\/([^/]+)\/([\w.-]+\.png)$/);
    if (shot) { const f = flowNamed(shot[1]), file = f && join(dirname(f.file), basename(notesFileOf(f.file)).replace(/\.json$/, ""), shot[2]); return file && existsSync(file) ? send(rs, 200, "image/png", readFileSync(file)) : send(rs, 404, "text/plain", "no such screenshot"); }
    if (q === "/api/notes") {
      const f = flowNamed(u.searchParams.get("flow"));
      if (!f) return json(rs, 404, { error: "no such flow" });
      if (rq.method === "POST") return json(rs, 200, isPeek(f) ? await applyPeek(f, await body(rq)) : await apply(f, await body(rq)));
      try { return json(rs, 200, isPeek(f) ? peekDoc(f) : readDoc(notesFileOf(f.file)).doc); } catch (e) { return json(rs, 503, { error: `the notes file is being written: ${(e as Error).message}` }); }
    }
    send(rs, 404, "text/plain", "not found");
  } catch (e) { json(rs, 400, { error: (e as Error).message }); }
});

/* ── export: the review as a static site, to publish beside the app's static build (the site's root serves the app, so
   a single screen's live frame loads it from there, on the same origin). Home and flow pages as the server makes them,
   their data embedded (FLEXSTATIC: each frame's snapshot, the flows), the snapshots copied in as WebP. No notes, no
   Shift+Click, no Data switch, no polling. Each flow publishes its set of views: the default (every device, light,
   English, tester tools off, signal on), or with "publish": "all" every theme, language and signal (tester tools off);
   --capture-set overrides that for every flow. --capture first takes the snapshots of those sets not taken yet (an
   older one is published as it is). On the site a view without snapshots shows a placeholder until the live app is
   ready, and the grid's controls offer only the views the flow has ── */
async function exportSite(outArg: string) {
  if (!P) fail("flex review export works in a project (.flex/project.json)");
  const out = resolve(outArg), prefix = (opt("--prefix") ?? "/screen-canvas").replace(/\/$/, ""), sharp = req("sharp"), t0 = Date.now();
  type Combo = { f: Flow; n: string; d: string; theme: string; lang: string; t: number; s: number };
  type Set_ = { themes: string[]; langs: string[]; signals: number[] };
  const vOf = (c: Combo) => sigFix(c.f, c.n, `static.t${c.t}.s${c.s}.p-default`);
  /** a flow's publish set: --capture-set, else its "publish" ("all"), else the default */
  const setOf = (f: Flow, idx: { themes?: string[] }): Set_ => {
    let pub: unknown; try { pub = readFlow(f.file).publish; } catch { /* broken */ }
    const all = (opt("--capture-set") ?? (pub === "all" ? "all" : "default")) === "all";
    return all ? { themes: idx.themes ?? ["light", "dark"], langs: ["en", "sw"], signals: [1, 0] } : { themes: ["light"], langs: ["en"], signals: [1] };
  };
  const sets = new Map<string, Set_>(), combos: Combo[] = [];
  for (const f of flows()) {
    try { build(f); } catch (e) { console.error(`!! ${f.name}: ${(e as Error).message.split("\n")[0]}`); broken++; continue; }
    const idx = indexes.get(f.name)!, set = setOf(f, idx), SIGNALS = set.signals;
    sets.set(f.name, set);
    for (const t of [0]) for (const d of idx.devices) for (const theme of set.themes) for (const lang of set.langs)
      for (const n of namesOn(f, d, `static.t${t}`)) for (const sg of SIGNALS) {
        // a "signal": false screen once: it has no signal either way
        if (!sg && signalOff(f).has(n)) continue;
        combos.push({ f, n, d, theme, lang, t, s: sg });
      }
  }
  const file = (c: Combo) => snapName(c.n, c.d, c.theme, c.lang, vOf(c));
  if (flag("capture")) {
    WORKERS = Math.max(1, +(opt("--jobs") ?? 6));
    // only those not taken yet: an older one is published as it is (counted as asked for: the workers start at once)
    const asked = new Set<string>();
    for (const c of combos) if (!existsSync(join(snapDir(c.f), file(c)))) { asked.add(`${c.f.name}:${file(c)}`); snapshot(c.f, c.n, c.d, c.theme, c.lang, 2, vOf(c)); }
    for (let i = 1; i < WORKERS; i++) void work();
    const wanted = asked.size, c0 = Date.now();
    const su = proj()?.setup;
    if (su?.command) out_(`setup: ${su.command}${su.writes ? " — it WRITES data" : ""}: ${allowSetup ? "allowed (--allow-setup); each run logged in .flex/cache/review.log" : "not run (--allow-setup runs it): frames with a setup command are skipped"}`);
    out_(`capturing ${wanted} snapshots not taken yet (of ${combos.length} published) from ${flows()[0].base}…`);
    while (jobs.size || working) { await sleep(2000); process.stderr.write(`\r  ${wanted - jobs.size} of ${wanted}`); }
    process.stderr.write("\n");
    const no = [...notTaken.values()];
    out_(`captured ${wanted - no.length} in ${Math.round((Date.now() - c0) / 1000)} s`);
    if (no.length) out_(`${no.length} not taken (error pages): ${no.slice(0, 5).map((x) => x.label).join(", ")}${no.length > 5 ? ", …" : ""} (first: ${no[0].why})`);
    await browser?.close().catch(() => {});
  }
  rmSync(out, { recursive: true, force: true });
  // the snapshots, as WebP; each page refers to them relative to itself
  const urls = new Map<string, string>(); let copied = 0, missing = 0;
  for (const c of combos) {
    const src = join(snapDir(c.f), file(c)), rel = `snap/${c.f.name}/${file(c).replace(/\.png$/, ".webp")}`;
    if (!existsSync(src)) { missing++; continue; }
    mkdirSync(dirname(join(out, rel)), { recursive: true });
    // 1.25 × the device's points (--scale) (sharp in a grid tile and a frame on a 2x screen), WebP at 60 (--quality): about 32 KB each
    const dv = deviceFor(c.d), m = await sharp(src).metadata(), k = +(opt("--scale") ?? 1.25), qy = +(opt("--quality") ?? 60);
    await sharp(src).resize(dv ? Math.round((m.width! / dv.scale) * k) : undefined).webp({ quality: qy }).toFile(join(out, rel));
    urls.set(`${c.f.name}|${c.n}.${c.d}.${c.theme}.${c.lang}.${vOf(c)}`, rel); copied++;
  }
  /** the views a flow's snapshots cover (its page's grid offers only those), the default first */
  const viewsOf = (snaps: Record<string, string>) => {
    const ks = Object.keys(snaps).map((k) => k.split(".").slice(-5)), has = (i: number, v: string) => ks.some((k) => k[i] === v);
    const pick = <T,>(all: T[], i: number, as: (v: T) => string) => { const got = all.filter((v) => has(i, as(v))); return got.length ? got : [all[0]]; };
    return { themes: pick(["light", "dark"], 0, (v) => v), langs: pick(["en", "sw"], 1, (v) => v), signals: pick([1, 0], 4, (v) => `s${v}`) };
  };
  // the flows: their pages (with the views each has), the picker's list, the home's cards (covers: each flow's first
  // screen in the default view, per device)
  const list = flows().filter((f) => indexes.has(f.name)), cards: any[] = [];
  for (const f of list) {
    const idx = indexes.get(f.name)!, tn = new Set(testerNames(f)), snaps: Record<string, string> = {}, covers: Record<string, string> = {}, screens: Record<string, number> = {};
    for (const [k, rel] of urls) if (k.startsWith(f.name + "|")) snaps[k.slice(f.name.length + 1)] = "../../" + rel;
    for (const t of [0, 1]) screens[`t${t}`] = (idx.screens ?? []).filter((s) => t || !tn.has(s.name)).length;
    const first = (idx.screens ?? []).find((s) => !tn.has(s.name))?.name;
    for (const d of idx.devices) { const rel = first && urls.get(`${f.name}|${first}.${d}.light.en.${sigFix(f, first, "static.t0.s1.p-default")}`); if (rel) covers[d] = rel; }
    cards.push({ name: f.name, title: f.label, href: `${prefix}/f/${f.name}/`, screens, covers });
    const html = readFileSync(build(f), "utf8").replace("<head>", `<head><script>var FLEXSTATIC=${JSON.stringify({ snaps, views: viewsOf(snaps) }).replace(/</g, "\\u003c")},FLEXENVS=[],FLEXTESTER=${JSON.stringify([...tn])},FLEXSIGOFF=${JSON.stringify([...signalOff(f)])},FLEXPEOPLE=${peopleJson(f)},FLEXREADY=${JSON.stringify(proj()?.ready ?? null)},FLEXSETUP=${JSON.stringify([...setupOf(f).keys()]).replace(/</g, "\\u003c")},FLEXPARAMS=${paramsJson()},FLEXSYSTEM=${systemJson()},FLEXTAGS=${tagsJson()}</script>`);
    mkdirSync(join(out, "f", f.name), { recursive: true });
    writeFileSync(join(out, "f", f.name, "index.html"), html);
  }
  // the flows' list, where the pages look for it (beside each page, then one folder up)
  // with each flow's covers (per device, relative to a flow's page), for the picker's grid: a published page has no
  // server to ask for them
  const lists = JSON.stringify(cards.map((c) => ({ href: c.href, title: c.title, screens: c.screens.t1, open: 0,
    covers: Object.fromEntries(Object.entries(c.covers as Record<string, string>).map(([d, rel]) => [d, "../../" + rel])) })));
  writeFileSync(join(out, "f", "lists.json"), lists);
  for (const c of cards) writeFileSync(join(out, "f", c.name, "lists.json"), lists);
  const pj = proj(), logo = pj?.logo && existsSync(pj.logo) ? `data:${/\.svg$/i.test(pj.logo) ? "image/svg+xml" : "image/png"};base64,${readFileSync(pj.logo).toString("base64")}` : null;
  const keys = [...new Set(list.flatMap((f) => indexes.get(f.name)!.devices))];
  writeFileSync(join(out, "index.html"), homePage({ name: pj?.name || pj?.project || "Flows", logo, root: prefix, envs: [], devices: keys.map((k) => ({ key: k, cat: kindOf(k), label: deviceFor(k)?.label ?? k })), flows: cards }));
  const size = (dir: string): number => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
  out_(`review site → ${out} (served at ${prefix}/): ${list.length} flow${list.length === 1 ? "" : "s"}, ${copied} snapshots${missing ? `, ${missing} not taken yet (--capture takes them)` : ""}, ${(size(out) / 1048576).toFixed(1)} MB, ${Math.round((Date.now() - t0) / 1000)} s`);
}
/* ── resnap: after the app's data was seeded again or reset (which changes nothing Flex can see), the snapshots taken
   again: the project's, a flow's, a screen's (--screen) or a state's (--state; "" the screen's default). Static ones now
   (--jobs at once); an environment's are marked stale, taken again when the review next shows them. Snapshots of
   screens and states no longer in their flow are removed ── */
async function resnapRun() {
  if (!P) fail("flex review resnap works in a project (.flex/project.json)");
  const screen = opt("--screen"), state = opt("--state"), RE = /^(.+?)\.([^.]+)\.(light|dark)\.([a-z]{2,3}(?:-[A-Za-z0-9]+)?)\.(.+)\.png$/;
  const fs = flows().filter((f) => !RFLOW || f.name === basename(RFLOW).replace(/\.json$/, ""));
  if (RFLOW && !fs.length) fail(`no flow ${RFLOW} in ${target}`);
  WORKERS = Math.max(1, +(opt("--jobs") ?? 4));
  let marked = 0, removed = 0, later = 0, missing = 0, broken = 0;
  for (const f of fs) {
    try { build(f); } catch (e) { console.error(`!! ${f.name}: ${(e as Error).message.split("\n")[0]}`); broken++; continue; }
    const names = new Set(Object.keys(indexes.get(f.name)!.links)), m = manifest(f);
    for (const k of Object.keys(m)) {
      const x = k.match(RE);
      if (!x) continue;
      const [, n, d, theme, lang, variant] = x, i = n.indexOf("@");
      if (!names.has(n)) { rmSync(join(snapDir(f), k), { force: true }); delete m[k]; removed++; continue; }
      if (screen && (i < 0 ? n : n.slice(0, i)) !== screen) continue;
      if (state !== undefined && (i < 0 ? "" : n.slice(i + 1)) !== state) continue;
      m[k].build = `stale:${Date.now()}`; marked++;
      if (envOf(variant.split(".")[0])) { later++; continue; }
      snapshot(f, n, d, theme, lang, 2, variant);
    }
    // and those never taken: every frame of the default view (--all: every theme, language and signal)
    for (const c of viewFrames(f, flag("all"))) {
      const i = c.n.indexOf("@"), file = snapName(c.n, c.d, c.theme, c.lang, c.v);
      if (screen && (i < 0 ? c.n : c.n.slice(0, i)) !== screen) continue;
      if (state !== undefined && (i < 0 ? "" : c.n.slice(i + 1)) !== state) continue;
      if (m[file] && existsSync(join(snapDir(f), file))) continue;
      if (jobs.has(`snap:${f.name}:${file}`)) continue;
      snapshot(f, c.n, c.d, c.theme, c.lang, 2, c.v); missing++;
    }
    saveManifest(f);
  }
  const su = proj()?.setup;
  if (su?.command) out(`setup: ${su.command}${su.writes ? " — it WRITES data" : ""}: ${allowSetup ? "allowed (--allow-setup); each run logged in .flex/cache/review.log" : "not run (--allow-setup runs it): frames with a setup command are left stale"}`);
  const wanted = marked - later + missing, t0 = Date.now();
  out(`${marked} snapshot${marked === 1 ? "" : "s"} marked stale${removed ? `, ${removed} of screens or states gone removed` : ""}, ${missing} missing${flag("all") ? "" : " in the default view"}; taking ${wanted}${later ? ` (${later} of environments: when the review next shows them)` : ""}…`);
  for (let i = 1; i < WORKERS; i++) void work();
  while (jobs.size || working) { await sleep(1000); process.stderr.write(`\r  ${Math.max(0, wanted - jobs.size - working)} of ${wanted}`); }
  if (wanted) process.stderr.write(`\r  ${wanted} of ${wanted}\n`);
  const no = [...notTaken.values()];
  out(`took ${wanted - no.length} in ${Math.round((Date.now() - t0) / 1000)} s${no.length ? `; ${no.length} not taken: ${no.slice(0, 5).map((x) => `${x.label} (${x.why.split("\n")[0]})`).join(", ")}${no.length > 5 ? ", …" : ""}` : ""}`);
  await browser?.close().catch(() => {});
  if (CHECK) {
    for (const x of no.slice(5)) out(`  not taken: ${x.label} (${x.why.split("\n")[0]})`);
    out(no.length || broken ? `check failed: ${no.length} frame${no.length === 1 ? "" : "s"} not taken${broken ? `, ${broken} flow${broken === 1 ? "" : "s"} not built` : ""}` : `check ok: ${wanted} frame${wanted === 1 ? "" : "s"}`);
    process.exit(no.length || broken ? 1 : 0);
  }
}
const out_ = out;
if (EXPORT) { await exportSite(EXPORT); process.exit(0); }
if (RESNAP) { await resnapRun(); process.exit(0); }

const asked = opt("--port") ?? (P?.port ? String(P.port) : undefined);
let port = asked ? +asked : 4870;
server.on("error", (e: any) => {
  if (e.code === "EADDRINUSE" && !asked && port < 4890) { port++; server.listen(port, "127.0.0.1"); return; }
  fail(e.code === "EADDRINUSE" ? `port ${port} is in use (another flex review?): --port picks another` : e.message);
});
server.on("listening", () => {
  // the first flow's canvas now, so a broken flow says so here rather than in the browser
  try { build(flows()[0]); } catch (e) { fail((e as Error).message); }
  // the project's home when flex review was given no flow (its flows folder), else the flow (the first of a folder)
  // a flow with a setup: the review on <project>.localhost, so each setup frame can have a host (cookies, storage) of
  // its own under it (f<key>.<project>.localhost); plain localhost works too, its setup frames sharing one origin
  const fs = flows(), iso = fs.some((f) => { try { build(f); return setupOf(f).size > 0; } catch { return false; } });
  const host = iso ? `${R === "/_flex" ? "flex" : R.slice(1).toLowerCase()}.localhost` : "localhost";
  const url = `http://${host}:${port}${R}/` + (!inputs[0] && P ? "" : `f/${flows()[0].name}/`);
  out(`review: ${url}`);
  const su = proj()?.setup;
  if (su?.command) out(`  setup: ${su.command} (in ${resolve(proj()!.dir, su.cwd ?? ".")})${su.writes ? " — it WRITES data" : ""}: ${allowSetup ? "allowed (--allow-setup); each run logged in .flex/cache/review.log" : "not run (start with --allow-setup, or switch Setup on in View)"}`);
  if (iso) out(`  frames with a setup each on a host of their own under it (http://localhost:${port}${R}/ works too, those frames then sharing one cookie jar)`);
  out(fs.length > 1 ? `  ${fs.length} flows in ${target} (picked at the top of the page); notes beside each, <flow>.notes.json` : `  notes in ${notesFileOf(fs[0].file)}`);
  out(`  wait for a round: flex review wait ${notesFileOf(fs[0].file)}`);
  // the default view's snapshots not taken yet (or stale), every flow's, in the background (behind what a page asks
  // for; one at a time, the review's one worker), so there are pictures when someone first looks. Frames whose setup
  // command isn't allowed are left out
  let warm = 0;
  for (const f of fs) {
    try { build(f); } catch { continue; }
    const su = setupOf(f);
    for (const c of viewFrames(f, false)) {
      if (!allowSetup && su.get(c.n)?.args) continue;
      if (!snapshot(f, c.n, c.d, c.theme, c.lang, 3, c.v).fresh) warm++;
    }
  }
  if (warm) out(`  ${warm} snapshot${warm === 1 ? "" : "s"} of the default view${fs.length > 1 ? "s" : ""} not taken yet or stale: taking them in the background`);
  out("  Ctrl-C stops");
  if (!flag("no-open")) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
});
server.on("upgrade", upgrade);
server.listen(port, "127.0.0.1");
const stop = async () => { await browser?.close().catch(() => {}); rmSync(WORK, { recursive: true, force: true }); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);
