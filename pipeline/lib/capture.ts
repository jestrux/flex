// Capture: drive the app with Playwright and record it as raw material for the edit.
//   - frames: Chrome's own screencast over CDP at 2× (crisp source for zooms done in post),
//     each JPEG stamped with its arrival time (frames change only when the page does)
//   - events: the cursor path we drove, clicks, the rects of things we pointed at, explicit
//     zoom requests ("focus"), and narration lines with their real voice durations
// No cursor is drawn in the page; the renderer draws it, so it stays sharp at any zoom.
import { needDisk } from "./disk.ts";
import { chromium, type Locator, type Page } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { voiceFor, stopVoice, ENGINE } from "./voice.ts";
import type { EffectTarget, Pt } from "./effects/types.ts";
import { validate, type EffectParams, type EffectType } from "./params.ts";
import type { EffectDef } from "./look.ts";

export type Rect = { x: number; y: number; w: number; h: number };
export type CursorKind = "arrow" | "hand" | "text";

// What the real cursor would be at a viewport point: the computed CSS cursor of the element
// under it, descending into same-origin iframes (social screens, frozen app screens) with
// their scale. Passed as a string (tsx's __name helper doesn't exist in the page).
const CURSOR_AT = `(([x, y]) => {
  let d = document, el = d.elementFromPoint(x, y);
  while (el && el.tagName === "IFRAME") {
    let cd = null; try { cd = el.contentDocument; } catch (e) {}
    if (!cd) break;
    const r = el.getBoundingClientRect(), sx = el.clientWidth / (r.width || 1), sy = el.clientHeight / (r.height || 1);
    x = (x - r.left) * sx; y = (y - r.top) * sy; d = cd;
    const inner = cd.elementFromPoint(x, y); if (!inner) break; el = inner;
  }
  if (!el) return "arrow";
  const c = d.defaultView.getComputedStyle(el).cursor;
  if (c === "pointer") return "hand";
  if (c === "text" || c === "vertical-text") return "text";
  if (el.closest && el.closest("input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=true]")) return "text";
  if ((c === "auto" || c === "default") && el.closest && el.closest("button, a[href], [role=button], [role=radio], [role=tab], [role=menuitem], select, summary, label")) return "hand";
  return "arrow";
})`;
export type FocusKind = "control" | "section" | "stage" | "wide";
export type Events = {
  viewport: { w: number; h: number }; dpr: number; duration: number;
  frames: { t: number; file: string }[];
  /** k = cursor kind under the pointer: arrow | hand | text (drawn by the renderer) */
  cursor: { t: number; x: number; y: number; k?: CursorKind }[];
  clicks: { t: number; x: number; y: number; rect: Rect; label?: string }[];
  focus: { t: number; rect: Rect; scale?: number; hold?: number; kind: FocusKind; label?: string; ms?: number; align?: "center" | "top" | "bottom"; lead?: number; view?: boolean }[];
  narration: { t: number; text: string; file: string; dur: number }[];
  effects: { t: number; type: string; target: EffectTarget; params: Record<string, any>; hold?: number; label?: string }[];
  marks: { t: number; label: string }[];
  /** regions zooms must never show a sliver of (c.keepClear): from t on */
  avoid?: { t: number; rect: Rect; until?: number }[];
  /** picture holds on the last frame before `from` until `to` (hides a one-frame paint flash) */
  freeze?: { from: number; to: number }[];
  /** stretches of typing (c.type / replace / b.type): motion the still-picture check can't see in pixels */
  typing?: { from: number; to: number; keys?: number[] }[];
  /** the take's metronome (c.beat) and every beat-timed step on it: due = when beat n fell, t = when it happened (a click's
   *  mark: when the change shows); t − due is how late the step was (Flex's timing report) */
  beat?: { bpm: number; mark: string; t0: number };
  beats?: { n: number; label: string; t: number; due: number }[];
};
type Target = string | Locator;

// scroll(): glide `el`'s nearest scrollable box (else the page) by dy px over ms, one position per painted frame. Each
// position is set instantly (CSS smooth scrolling would chase it) and snapping is off for the glide. A string, as above.
const GLIDE = `((el, [dy, ms]) => new Promise((done) => {
  const scrolls = (e) => { const o = getComputedStyle(e).overflowY; return (o === "auto" || o === "scroll" || o === "overlay") && e.scrollHeight > e.clientHeight; };
  const d = document; let box = el;
  while (box && box !== d.body && box !== d.documentElement && !scrolls(box)) box = box.parentElement;
  if (!box || box === d.body || box === d.documentElement) box = d.scrollingElement || d.documentElement;
  const keep = box.style.scrollSnapType;
  box.style.scrollSnapType = "none";
  const from = box.scrollTop, to = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, from + dy)), t0 = performance.now();
  const step = (now) => {
    const u = Math.min(1, (now - t0) / ms), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    box.scrollTo({ top: from + (to - from) * e, behavior: "instant" });
    if (u < 1) requestAnimationFrame(step);
    else { box.style.scrollSnapType = keep; done(); }
  };
  requestAnimationFrame(step);
}))`;
export const VIEWPORT = { w: 1440, h: 810 };
/** capture pixel density: 2 by default; CAPTURE_DPR=3 for takes that will be rendered at 4K (1440 css × 3 = 4320 px) */
export const DPR = Number(process.env.CAPTURE_DPR ?? 2);

/** dry: a rehearsal in its own fresh browser — no frames; real voice timing (lines are cached);
 *  a missing target stops the run; a screenshot at every c.mark() (and every click with shots)
 *  and at the end in build/dry/<take>/; takes/<take> is untouched */
export async function capture(take: string, journey: (c: Cam) => Promise<void>, o: { dry?: boolean; shots?: boolean } = {}) {
  const dir = o.dry ? join(process.env.FLEX_DRY ?? join(process.env.FLEX_WORK ?? join(import.meta.dirname, ".."), "build", "dry"), take) : join(process.env.FLEX_TAKES ?? join(import.meta.dirname, "..", "takes"), take);
  needDisk(join(import.meta.dirname, ".."), o.dry ? 0.3 : 0.8, o.dry ? "dry run" : "capture");
  // fresh frames + events; keep edl.json (hand edits survive a re-capture; plan respects "locked")
  rmSync(join(dir, o.dry ? "." : "frames"), { recursive: true, force: true });
  mkdirSync(join(dir, o.dry ? "." : "frames"), { recursive: true });

  // the flag is what makes the screencast deliver device pixels (the context DPR alone gives 1× frames)
  const browser = await chromium.launch({ headless: true, args: [`--force-device-scale-factor=${DPR}`] });
  const ctx = await browser.newContext({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  // hide scrollbars for the whole take
  await page.addInitScript(() => {
    const css = "html{scrollbar-width:none}::-webkit-scrollbar{display:none}";
    const add = () => { if (!document.head) return void requestAnimationFrame(add); const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
    add();
  });

  const ev: Events = { viewport: VIEWPORT, dpr: DPR, duration: 0, frames: [], cursor: [], clicks: [], focus: [], narration: [], marks: [], effects: [], freeze: [] };
  // the take clock pauses while a new voice line is generated (TTS can take seconds; that wait
  // must not be filmed as dead air); frames that arrive during a pause are dropped
  let t0 = 0, pausedMs = 0, pauseStart = 0;
  const now = () => (t0 ? Date.now() - t0 - pausedMs - (pauseStart ? Date.now() - pauseStart : 0) : 0);
  const clock = { pause: () => { if (!pauseStart) pauseStart = Date.now(); }, resume: () => { if (pauseStart) { pausedMs += Date.now() - pauseStart; pauseStart = 0; } } };
  const cam = new Cam(page, ev, now, clock);
  cam.take = take;
  if (o.dry) { cam.dry = dir; cam.shots = !!o.shots; }

  const cdp = await ctx.newCDPSession(page);
  let n = 0;
  cdp.on("Page.screencastFrame", (f) => {
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); // no ack → Chrome stops sending
    if (!t0 || pauseStart) return;
    const file = `f${String(++n).padStart(6, "0")}.jpg`;
    ev.frames.push({ t: now(), file });
    writeFileSync(join(dir, "frames", file), Buffer.from(f.data, "base64"));
  });

  try {
    cam.onReady = async () => {
      t0 = Date.now();
      if (o.dry) return;
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEWPORT.w * DPR, maxHeight: VIEWPORT.h * DPR, everyNthFrame: 1 });
      await page.evaluate(() => document.body.animate([{ opacity: 0.999 }, { opacity: 1 }], { duration: 60 })); // force a first frame
    };
    console.log(o.dry ? `● dry run "${take}" (no recording)` : `● capturing "${take}"`);
    // dry run: a screenshot every second, cropped afterwards to the planned camera → camera sheet
    const shots: { t: number; buf: Buffer }[] = [];
    let busy = false;
    const timer = o.dry ? setInterval(async () => {
      if (busy || !t0 || pauseStart || shots.length >= 150) return; busy = true; // skip while the take clock is paused (voice generating)
      try { const t = now(); shots.push({ t, buf: await page.screenshot({ type: "jpeg", quality: 70 }) }); } catch { /* page navigating */ } finally { busy = false; }
    }, 1000) : null;
    await journey(cam);
    if (timer) clearInterval(timer);
    if (o.dry && shots.length) await cameraSheet(dir, shots, { ...ev, duration: now() + 1 });
    await cam.settle();
    await page.waitForTimeout(600);
    ev.duration = now();
    if (o.dry) await page.screenshot({ path: join(dir, "end.png") });
    await cdp.send("Page.stopScreencast").catch(() => {});
  } finally {
    await browser.close();
    stopVoice();
  }
  writeFileSync(join(dir, "events.json"), JSON.stringify(ev, null, 1));
  if (o.dry) { console.log(`✓ dry run ok · ~${(ev.duration / 1000).toFixed(1)}s · ${ev.marks.length} marks · screenshots → ${dir}`); return dir; }
  console.log(`✓ ${ev.frames.length} frames · ${(ev.duration / 1000).toFixed(1)}s · ${ev.clicks.length} clicks · ${ev.focus.length} focus · ${ev.narration.length} lines → takes/${take}`);
  return dir;
}

export class Cam {
  pos = { x: VIEWPORT.w / 2, y: VIEWPORT.h * 0.62 };
  onReady: () => Promise<void> = async () => {};
  /** the take being captured (files that belong to it go in takes/<take>/) */
  take = "";
  /** set in a dry run: the folder for mark screenshots */
  /** a dry run's output dir; undefined in a real capture (so `c.dry ?? …` works) */
  dry: string | undefined = undefined;
  shots = false;
  /** a target that isn't on the page: a warning on camera, a hard stop in a dry run */
  private missing(what: string, t: unknown) {
    const msg = `${what} not found: ${typeof t === "string" ? t : String(t)}`;
    if (this.dry) throw new Error(msg + " (dry run stops here)");
    console.warn("  ! " + msg);
  }
  private speechEnd = 0;
  private speech: Promise<void> = Promise.resolve();
  /** now(): the take clock in ms (what marks and events use) */
  constructor(public page: Page, private ev: Events, public now: () => number, private clock: { pause(): void; resume(): void } = { pause() {}, resume() {} }) {}

  loc(t: Target) { return typeof t === "string" ? this.page.locator(t).first() : t.first(); }
  pause(ms: number) { return this.page.waitForTimeout(ms); }
  kind: CursorKind = "arrow";
  async kindAt(x: number, y: number): Promise<CursorKind> {
    this.kind = await this.page.evaluate(`${CURSOR_AT}([${x}, ${y}])`).catch(() => this.kind) as CursorKind;
    return this.kind;
  }
  /** re-read the cursor kind where the pointer rests (after a click the UI under it may change) */
  async recheck() { const k = await this.kindAt(this.pos.x, this.pos.y); this.ev.cursor.push({ t: this.now(), ...this.pos, k }); }
  /** a visible, sized element's box (CSS px), else null — hidden, closing or zero-size targets
   *  count as missing (a warning on camera, a hard stop in a dry run) instead of aiming at nothing */
  async rectOf(t: Target): Promise<Rect | null> {
    const l = this.loc(t);
    if (!(await l.isVisible().catch(() => false))) return null;
    const b = await l.boundingBox({ timeout: 3000 }).catch(() => null);
    return b && b.width >= 2 && b.height >= 2 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
  }

  /** open the page, run `prep` off camera (set the scene), then start recording */
  async start(url: string, readySel: string, prep?: (page: Page) => Promise<void>) {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.loc(readySel).waitFor({ state: "visible", timeout: 30_000 });
    if (prep) await prep(this.page);
    await this.pause(400);
    await this.page.mouse.move(this.pos.x, this.pos.y);
    await this.onReady();
    this.ev.cursor.push({ t: this.now(), ...this.pos });
  }

  /** glide the real mouse to a target (hover states fire) and log the path */
  /*  t may also be a point {x, y} or a rect {x, y, w, h} in page px (glide to an empty spot) */
  async moveTo(t: Target | Pt | Rect, clip?: Target) {
    let r: Rect | null;
    if (typeof t === "object" && t !== null && "x" in t && "y" in t && !("first" in t)) { const q = t as Rect; r = { x: q.x, y: q.y, w: q.w ?? 0, h: q.h ?? 0 }; }
    else {
      const l = this.loc(t as Target);
      if (!clip) await l.scrollIntoViewIfNeeded().catch(() => {});
      r = await this.rectOf(l); if (!r) { this.missing("target", t as Target); return null; }
    }
    // clip: aim at the part of the element visible inside `clip` (no scrolling)
    if (clip) { const c = await this.rectOf(clip); if (c) { const x = Math.max(r.x, c.x), y = Math.max(r.y, c.y); r = { x, y, w: Math.min(r.x + r.w, c.x + c.w) - x, h: Math.min(r.y + r.h, c.y + c.h) - y }; } }
    const to = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const from = { ...this.pos };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    // the cursor goes straight there, briskly, and then waits (never drifts slowly to fill time)
    const ms = Math.min(620, Math.max(240, 200 + dist * 0.35));
    const steps = Math.max(8, Math.round(ms / 16));
    // slight arc, eased in-out
    const bend = { x: (from.x + to.x) / 2 + (to.y - from.y) * 0.08, y: (from.y + to.y) / 2 - (to.x - from.x) * 0.08 };
    for (let i = 1; i <= steps; i++) {
      const u = i / steps, e = u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2;
      const x = (1 - e) ** 2 * from.x + 2 * (1 - e) * e * bend.x + e ** 2 * to.x;
      const y = (1 - e) ** 2 * from.y + 2 * (1 - e) * e * bend.y + e ** 2 * to.y;
      await this.page.mouse.move(x, y);
      const k = i % 4 === 0 || i === steps ? await this.kindAt(x, y) : this.kind;
      this.ev.cursor.push({ t: this.now(), x, y, k });
      await this.page.waitForTimeout(ms / steps);
    }
    this.pos = to;
    return r;
  }

  /** move + click. `zoom` asks the edit for a zoom on this target (or a wider one) */
  async click(t: Target, o: { settle?: number; zoom?: FocusKind | false; on?: Target | Rect; scale?: number; label?: string; clip?: Target } = {}) {
    const r = await this.moveTo(t, o.clip); if (!r) return;
    await this.pause(140);
    if (o.zoom) await this.focus(o.on ?? t, { kind: o.zoom, scale: o.scale, label: o.label, hold: 0 });
    this.ev.clicks.push({ t: this.now(), x: this.pos.x, y: this.pos.y, rect: r, label: o.label });
    if (o.clip) await this.page.mouse.click(this.pos.x, this.pos.y); else await this.loc(t).click();
    await this.pause(o.settle ?? 700);
    if (this.dry && this.shots) await this.page.screenshot({ path: join(this.dry, `click-${String(this.ev.clicks.length).padStart(3, "0")}.png`) });
    await this.recheck();
  }

  /** type into the focused field like a person (paced keystrokes) */
  /** paced keystrokes. exact: no jitter and no trailing pause, so the last key's time is predictable
   *  (finish a word on a beat: b.at(n - (text.length - 1) * perKey / b.beatMs) then type exact) */
  async type(text: string, perKey = 75, o: { exact?: boolean } = {}) {
    const chars = [...text], t0 = this.now(), keys: number[] = [];
    for (const [i, ch] of chars.entries()) { keys.push(this.now()); await this.page.keyboard.type(ch); if (i < chars.length - 1 || !o.exact) await this.pause(perKey + (o.exact ? 0 : Math.round(Math.random() * 30))); }
    (this.ev.typing ??= []).push({ from: t0, to: this.now(), keys });
    if (!o.exact) await this.pause(250);
  }
  /** the beat-typed last key (b.type): add its time to the typing stretch it finishes, so its keystroke sound plays */
  private lastKey() {
    const ty = this.ev.typing?.[this.ev.typing.length - 1], t = this.now();
    if (ty && t - ty.to < 2000) { (ty.keys ??= []).push(t); ty.to = t; } else (this.ev.typing ??= []).push({ from: t, to: t, keys: [t] });
  }
  /** wait until the take clock reaches ms (pin a beat to a fixed take time) */
  async until(ms: number) { const w = ms - this.now(); if (w > 0) await this.pause(w); }
  /** replace the focused field's text: select all, then type (click the field first) */
  async replace(text: string, perKey = 75) {
    await this.page.keyboard.press("ControlOrMeta+A"); await this.pause(160);
    await this.type(text, perKey);
  }
  /** scroll a list/panel (or the whole page: "body") like a person: move over it, then glide `dy` px, eased.
   *  The glide moves on every frame the browser paints (not in wheel steps, which read as stairs over a long page);
   *  it scrolls `within` or the nearest scrollable box around it, else the page. ms: default ~1 s per screen of travel, at least 900.
   *  Place effects on things inside it AFTER this (targets are captured when you call them). */
  async scroll(within: Target, dy: number, ms?: number) {
    const r = await this.moveTo(within); if (!r) return;
    ms ??= Math.max(900, Math.round((Math.abs(dy) / VIEWPORT.h) * 1000));
    // a bare wrapper (no named functions inside for tsx to tag) that evaluates GLIDE in the page and hands it the element
    await this.loc(within).evaluate((el, a) => (0, eval)(a.glide)(el, a.args), { glide: GLIDE, args: [dy, ms] });
    await this.pause(300);
    await this.recheck();
  }

  /** ask the edit to zoom on a region now (kind sets how tight; scale overrides, and may go below the kind's minimum, e.g. 1.1 for a full-height phone).
   *  ms: this push/release takes ms (e.g. 2500 for a slow push-in) — it starts 650 ms before the call like any focus and arrives ms later; default = the take's transition
   *  lead: how long before the call the camera starts moving (default 650). lead: 0 right after a cut or a
   *  take's range start, so the move doesn't begin inside the previous shot (check: camera-at-cut).
   *  overFreeze: true = you mean to push over a held picture (a beat-timed swap) — no frozen-frame warning */
  async focus(t: Target | Rect | (Target | Rect)[], o: { kind?: FocusKind; scale?: number; hold?: number; label?: string; ms?: number; align?: "center" | "top" | "bottom"; lead?: number; overFreeze?: boolean } = {}) {
    // several targets → frame them together (a control and what it changes)
    if (Array.isArray(t)) {
      const rs = (await Promise.all(t.map((x) => (typeof x === "object" && x !== null && "w" in x && "h" in x ? (x as Rect) : this.rectOf(x as Target))))).filter((x): x is Rect => !!x);
      if (rs.length < t.length) { this.missing("focus target (one of several)", t); if (!rs.length) return; }
      const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
      t = { x: x0, y: y0, w: Math.max(...rs.map((r) => r.x + r.w)) - x0, h: Math.max(...rs.map((r) => r.y + r.h)) - y0 };
      // hold all of them: size the zoom to the union (a kind's minimum would crop it); if they already
      // fill the frame, there's nothing to zoom to
      if (o.scale === undefined) {
        const fit = Math.min(1.9, (0.94 * VIEWPORT.w) / t.w, (0.94 * VIEWPORT.h) / t.h);
        if (fit < 1.05) { console.log(`  · focus "${o.label ?? "several"}": the targets already fill the frame — staying wide`); return; }
        if (fit < 1.25) console.warn(`  ! focus "${o.label ?? "several"}": the targets span almost the whole frame (×${fit.toFixed(2)}) — this is nearly a wide shot. Far-apart targets (a panel field and the stage) can't share a close-up: click the control wide, then focus on what it changes.`);
        o = { ...o, scale: +fit.toFixed(3) };
      }
    }
    const isRect = typeof t === "object" && t !== null && "w" in t && "h" in t;
    const r = isRect ? (t as Rect) : await this.rectOf(t as Target);
    if (!r) { this.missing("focus target", t); return; }
    const lastFreeze = this.ev.freeze?.at(-1);
    const lead = o.lead ?? 650;
    if (!o.overFreeze && lead > 0 && lastFreeze && lastFreeze.to > this.now() - lead) console.warn(`  ! focus "${o.label ?? o.kind ?? "section"}": its camera lead (${lead} ms) starts inside the freeze that just ended — the push begins on the frozen frame. Pause ~${Math.round(lastFreeze.to - this.now() + lead + 50)} ms first, pass lead: 0, or overFreeze: true if pushing over the held picture is the point.`);
    this.ev.focus.push({ t: this.now(), rect: r, scale: o.scale, hold: o.hold, kind: o.kind ?? "section", label: o.label, ms: o.ms, align: o.align, ...(o.lead !== undefined ? { lead: o.lead } : {}), ...((o as { view?: boolean }).view ? { view: true } : {}) });
  }
  /** hold the picture from now until the returned function is called (e.g. while a sheet paints) */
  /*  a hold that starts within 150 ms of the last one's end joins it: two back-to-back held steps otherwise show the
   *  frame between them (r35: a 0.5 s flash of the in-between state) */
  freezeFrom() {
    const last = this.ev.freeze?.at(-1), now = this.now();
    const join = !!last && now - last.to < 150; if (join) this.ev.freeze!.pop();
    const from = join ? last!.from : now;
    return (to?: number) => { this.ev.freeze!.push({ from, to: to ?? this.now() }); };
  }
  /** ask the edit to pull back to the full frame now */
  /*  ms: how long the pull-back to wide takes (e.g. 2000 for a slow reveal of the whole app) */
  /*  lead: 0 (with ms: 1) = a cut to wide right after a held moment, like a focus's lead */
  unfocus(o: { ms?: number; lead?: number } = {}) { this.ev.focus.push({ t: this.now(), rect: { x: 0, y: 0, w: VIEWPORT.w, h: VIEWPORT.h }, kind: "wide", scale: 1, ...(o.ms ? { ms: o.ms } : {}), ...(o.lead !== undefined ? { lead: o.lead } : {}) }); }
  /** zooms from now on never show a sliver of this region (e.g. a side panel): the planner shifts
   *  the view clear of it, widens to fit, or stays wide. Zooms ON the region itself are left alone. */
  async keepClear(t: Target | Rect) {
    const isRect = typeof t === "object" && t !== null && "w" in t && "h" in t;
    const r = isRect ? (t as Rect) : await this.rectOf(t as Target);
    if (!r) { this.missing("keepClear region", t); return () => {}; }
    const a: { t: number; rect: Rect; until?: number } = { t: this.now(), rect: r };
    (this.ev.avoid ??= []).push(a);
    /** call when the region goes away (e.g. a sheet closes); regions add up until released */
    return () => { a.until = this.now(); };
  }
  /** wait until the current narration line has finished (+ a breath) — c.narrate returns at once */
  async afterLine(breath = 250) { await this.settle(); if (breath) await this.pause(breath); }
  /** start one of your look's effects now and end it when the returned function is called */
  async useStart<P>(fx: EffectDef<P>, target: Target | Rect | Pt | Pt[] | null, params: Partial<P> = {}, label?: string) {
    if (!fx.type) throw new Error(`effect "${fx.label}" is not part of a look (export it through defineLook)`);
    const e = { t: this.now(), type: fx.type, target: await this.targetOf(target), params: params as Record<string, unknown>, hold: undefined as number | undefined, label };
    this.ev.effects.push(e);
    return () => { e.hold = this.now() - e.t; };
  }
  /** wait until every screen overlay (lower third, chip, caption) has fully left, so a zoom that
   *  follows won't push in under it (check warns on overlays during zooms) */
  async afterOverlays() {
    const { EFFECTS } = await import("./effects/index.ts");
    const now = this.now();
    let until = 0;
    for (const e of this.ev.effects) {
      const m = EFFECTS[e.type]; if (!m) continue;
      const tg = !!(e.target?.rect || e.target?.points?.length);
      if (m.space === "screen" || (m.space === "auto" && !tg)) until = Math.max(until, e.t + (e.hold ?? m.hold) + m.exit);
    }
    const wait = until + 650 - now; // + the planner's lead: the push starts 650 ms before the focus call
    if (wait > 0) await this.pause(wait);
  }
  /** a metronome for changes inside a shot: const b = await c.beat(155, "flips"); await b.at(2); click…
   *  b.at(n) waits until n beats after the mark (whole or half beats: 0.5). lag = ms the app takes to
   *  repaint after the click (e.g. 160 for a theme switch): the click comes that much earlier, so the
   *  CHANGE lands on the beat. In the sequence, align the mark to a bar (take item `align`) — then
   *  every b.at(n) lands on a beat of the film. Use labels starting "beat" for marks check measures. */
  private beats = 0;
  async beat(bpm: number, mark: string, o: { lag?: number } = {}) {
    if (++this.beats > 1) console.warn(`  ! a second c.beat() in this take ("${mark}") — only the grid the sequence aligns lands on the music; reuse the first one (b.next(), b.at())`);
    await this.mark(mark);
    const t0 = this.now(), beatMs = 60_000 / bpm, lag = o.lag ?? 0;
    this.ev.beat = { bpm, mark, t0 }; this.ev.beats ??= [];
    const log = (n: number, label: string, t: number) => this.ev.beats!.push({ n, label, t, due: Math.round(t0 + n * beatMs) });
    const until = async (n: number) => { const wait = t0 + n * beatMs - lag - this.now(); if (wait > 0) await this.pause(wait); };
    return {
      beatMs,
      /** wait for beat n (use for things that aren't clicks) */
      at: async (n: number, label?: string) => {
        const late = this.now() - (t0 + n * beatMs);
        if (late > 40 && (!label || label.startsWith("beat"))) console.warn(`  ! beat ${n}${label ? ` "${label}"` : ""}: reached ${Math.round(late)} ms late (the step before took longer than the time left) — start it earlier`);
        const w0 = this.now(); await until(n);
        // inside a held picture this beat IS the release: ask for a fresh frame now, so the freeze can end on the
        // beat rather than after the cut's rect lookups (~120 ms later, example-guide)
        if (this.paintDepth > 0) { this.beatAt = this.now(); this.beatWaited = this.beatAt - w0; void this.page.evaluate(() => { document.body.animate([{ opacity: 0.999 }, { opacity: 1 }], { duration: 120 }); }).catch(() => {}); }
        if (label) { await this.mark(label); log(n, label, this.now()); }
      },
      /** the first whole beat at least minAheadMs from now (room for a glide or a paint). Pass the text
       *  you'll b.type() on it and the typing time is added for you: b.type(b.next(400, text), text) */
      next: (minAheadMs = 800, typing?: string, perKey = 95) => Math.ceil((this.now() + minAheadMs + (typing ? [...typing].length * perKey * 1.15 : 0) - t0) / beatMs),
      /** type `text` so its LAST key lands on beat n: the rest is typed ahead, then the last key alone
       *  exactly on the beat (per-key timing drifts with machine load; this doesn't) */
      /*  co.lag: the app's repaint delay (ms) — the last key goes in that much early so the CHANGE lands on the beat (as b.click) */
      type: async (n: number, text: string, perKey = 95, label = `beat-typed-${n}`, co: { lag?: number } = {}) => {
        const chars = [...text], head = chars.slice(0, -1).join(""), last = chars[chars.length - 1] ?? "";
        const startAt = t0 + n * beatMs - chars.length * perKey * 1.15; // a little early: the head may run slow
        const w = startAt - this.now(); if (w > 0) await this.pause(w);
        else if (-w > perKey * 2) console.warn(`  ! b.type beat ${n}: started ${Math.round(-w)} ms into its typing window (the steps before ran long) — it will type faster or land late; pick a later beat (b.next(ms, text))`);
        if (head) await this.type(head, perKey, { exact: true });
        const lateBy = this.now() - (t0 + n * beatMs);
        if (lateBy > 40) console.warn(`  ! b.type beat ${n}: the last key lands ${Math.round(lateBy)} ms late — start earlier or use a later beat`);
        const lg = co.lag ?? 0;
        if (lg > 0) { // key first, then mark the beat when the change shows
          const w2 = t0 + n * beatMs - lg - this.now(); if (w2 > 0) await this.pause(w2);
          if (last) { this.lastKey(); await this.page.keyboard.type(last); }
          await until(n);
          await this.mark(label.startsWith("beat") ? label : `beat-${label}`); log(n, label, this.now());
        } else {
          await until(n);
          await this.mark(label.startsWith("beat") ? label : `beat-${label}`); log(n, label, this.now());
          if (last) { this.lastKey(); await this.page.keyboard.type(last); }
        }
      },
      /** the cursor travels to the target FIRST, then the click fires exactly on beat n (minus lag)
       *  and a "beat-…" mark records that moment for check */
      click: async (n: number, target: Target, label = `beat-${n}`, co: { lag?: number } = {}) => {
        // already there? don't glide again (a busy page makes the glide slow)
        const r0 = await this.rectOf(target), here = r0 && Math.hypot(this.pos.x - (r0.x + r0.w / 2), this.pos.y - (r0.y + r0.h / 2)) < Math.min(r0.w, r0.h) / 2;
        const r = here ? r0 : await this.moveTo(target); if (!r) { if (!r0) this.missing("beat-click target", target); return; }
        const lg = co.lag ?? lag; // per-click repaint lag (measure it: npm run lag <take> <mark>)
        const wait = t0 + n * beatMs - lg - this.now(); if (wait > 0) await this.pause(wait);
        // the glide (up to ~0.7 s) can overrun a near beat: then the change lands late — say so
        else if (wait < -40) console.warn(`  ! beat ${n} "${label}": the cursor arrived ${Math.round(-wait)} ms late — the change misses the beat. Pre-position with c.moveTo(target) a beat earlier, or click on a later beat.`);
        this.ev.clicks.push({ t: this.now(), x: this.pos.x, y: this.pos.y, rect: r, label });
        // the mark records when the CHANGE shows (click + lag) — that's what should sit on the beat
        this.ev.marks.push({ t: this.now() + lg, label: label.startsWith("beat") ? label : `beat-${label}` }); log(n, label, this.now() + lg);
        await this.page.mouse.click(this.pos.x, this.pos.y);
        await this.pause(120);
      },
    };
  }
  /** aim the camera at an exact centre (CSS px) and scale */
  /** holds until the next focus/unfocus() (like frameComp) unless you pass hold */
  /*  below: keep the view's top edge just under this element (a header, the app's label above a
   *  composition) — cy moves down as needed, so you don't have to guess fractions from screenshots */
  /*  within: keep the view inside this target (the composition: s.hero(), s.board()) — cx/cy are
   *  clamped so no stage shows around it; if the view is bigger than the target it centres on it.
   *  With both, `below` applies first and `within` wins (so no stage sliver between label and sheet) */
  async view(cx: number, cy: number, scale: number, o: { hold?: number; ms?: number; label?: string; lead?: number; overFreeze?: boolean; below?: Target | Rect; within?: Target | Rect } = {}) {
    let w = VIEWPORT.w / scale, h = VIEWPORT.h / scale;
    const { below, within, ...fo } = o;
    let floor: number | undefined; // the top edge `below` asks for
    if (below) {
      const r = typeof below === "object" && below !== null && "w" in below && "h" in below ? (below as Rect) : await this.rectOf(below as Target);
      if (!r) this.missing("view below", below as Target);
      else { floor = r.y + r.h + 6; const minCy = floor + h / 2; if (cy < minCy) cy = minCy; }
    }
    if (within) {
      const r = typeof within === "object" && within !== null && "w" in within && "h" in within ? (within as Rect) : await this.rectOf(within as Target);
      if (!r) this.missing("view within", within as Target);
      else {
        // below AND within, and the view is too tall for the room between the label and the target's bottom: within
        // would push it up over the label — tighten until it fits between them instead (r42: a helper line sliced)
        if (floor !== undefined && h <= r.h && floor + h > r.y + r.h + 0.5 && r.y + r.h - floor > 40) {
          const s2 = +(VIEWPORT.h / (r.y + r.h - floor)).toFixed(3);
          console.log(`  · view "${o.label ?? "view"}": below + within leave ${Math.round(r.y + r.h - floor)} px — tightened ×${scale} → ×${s2} so the label stays whole`);
          scale = s2; w = VIEWPORT.w / scale; h = VIEWPORT.h / scale; cy = floor + h / 2;
        }
        const cy0 = cy;
        cx = w <= r.w ? Math.min(Math.max(cx, r.x + w / 2), r.x + r.w - w / 2) : r.x + r.w / 2;
        cy = h <= r.h ? Math.min(Math.max(cy, r.y + h / 2), r.y + r.h - h / 2) : r.y + r.h / 2;
        // taller than the target: it can't stay inside, so don't centre it back over the label `below` keeps clear
        if (h > r.h && below) cy = Math.max(cy, cy0);
        if (w > r.w + 2 || h > r.h + 2) console.warn(`  ! view "${o.label ?? "view"}": ×${scale} is ${w > r.w + 2 ? "wider" : "taller"} than its "within" target (view ${Math.round(w)}×${Math.round(h)}, target ${Math.round(r.w)}×${Math.round(r.h)}) — it shows what's around it${below ? " (kept under the `below` label)" : ""}; ×${(Math.max(VIEWPORT.w / r.w, VIEWPORT.h / r.h) * 1.01).toFixed(2)}+ stays inside`);
      }
    }
    return this.focus({ x: cx - w / 2, y: cy - h / 2, w, h }, { kind: "stage", scale, ...fo, hold: fo.hold ?? 600_000, view: true } as Parameters<Cam["focus"]>[1]);
  }
  async mark(label: string) {
    this.ev.marks.push({ t: this.now(), label });
    if (this.dry) {
      this.clock.pause(); // screenshots take ~0.8 s: keep them off the take clock so dry timing matches a capture
      try { await this.dryShots(label); } finally { this.clock.resume(); }
    }
  }
  private async dryShots(label: string) {
    {
      const base = join(this.dry!, `${String(this.ev.marks.length).padStart(2, "0")}-${label.replace(/[^\w-]+/g, "_")}`);
      await this.page.screenshot({ path: `${base}.png` });
      // what the camera will show here (zooms planned from the requests so far, keepClear applied;
      // a slow push is shown where it lands)
      const { plan } = await import("./plan.ts");
      const now = this.now(), segs = plan({ ...this.ev, duration: now + 1 }, "dry").segments;
      const g = [...segs].reverse().find((x) => x.start <= now && x.end >= now - 50);
      if (g) {
        const w = VIEWPORT.w / g.scale, h = VIEWPORT.h / g.scale;
        const clip = { x: Math.min(Math.max(0, g.cx - w / 2), VIEWPORT.w - w), y: Math.min(Math.max(0, g.cy - h / 2), VIEWPORT.h - h), width: w, height: h };
        const sharp = (await import("sharp")).default; // every camera still at one size (1440×810) so they compare
        await sharp(await this.page.screenshot({ clip })).resize(VIEWPORT.w, VIEWPORT.h).toFile(`${base}.camera.png`);
      } else await this.page.screenshot({ path: `${base}.camera.png` }); // wide: no zoom here (check the plan's log for dropped zooms)
    }
  }

  // ── stage effects (rendered in post; see lib/effects) ─────────────────────────────────
  private async targetOf(t: Target | Rect | Pt | Pt[] | null | undefined): Promise<EffectTarget> {
    if (!t) return {};
    if (Array.isArray(t)) return { points: t };
    if (typeof t === "object" && "w" in t && "h" in t) return { rect: t as Rect };
    if (typeof t === "object" && "x" in t && "y" in t && !("first" in t)) return { points: [t as Pt] };
    const r = await this.rectOf(t as Target);
    if (!r) this.missing("effect target", t);
    return r ? { rect: r } : {};
  }
  /** ask for a stage effect now; `hold` (ms) overrides the effect's default */
  async effect<K extends EffectType>(type: K, target: Target | Rect | Pt | Pt[] | null, params: Partial<EffectParams[K]> = {}, o: { hold?: number; label?: string } = {}) {
    validate(type, params, "cam.effect");
    this.ev.effects.push({ t: this.now(), type, target: await this.targetOf(target), params, hold: o.hold, label: o.label });
  }
  /** one of your look's effects (lower third, caption, callout…): c.use(look.effects.lowerThird, null, { title }, { hold }) */
  async use<P>(fx: EffectDef<P>, target: Target | Rect | Pt | Pt[] | null, params: Partial<P> = {}, o: { hold?: number; label?: string } = {}) {
    if (!fx.type) throw new Error(`effect "${fx.label}" is not part of a look (export it through defineLook)`);
    for (const k of Object.keys(params)) if (!(k in (fx.defaults as object))) throw new Error(`cam.use ${fx.type}: no param "${k}". Valid: ${Object.keys(fx.defaults as object).join(", ")}`);
    this.ev.effects.push({ t: this.now(), type: fx.type, target: await this.targetOf(target), params: params as Record<string, unknown>, hold: o.hold, label: o.label });
  }
  /** start an effect now and end it when the returned function is called (e.g. highlighter) */
  async effectStart<K extends EffectType>(type: K, target: Target | Rect | Pt | Pt[] | null, params: Partial<EffectParams[K]> = {}, label?: string) {
    validate(type, params, "cam.effectStart");
    const e = { t: this.now(), type, target: await this.targetOf(target), params, hold: undefined as number | undefined, label };
    this.ev.effects.push(e);
    return () => { e.hold = this.now() - e.t; };
  }
  arrow(t: Target | Rect | Pt, p: Partial<EffectParams["arrow"]> = {}, hold?: number) { return this.effect("arrow", t, p, { hold }); }
  spotlight(t: Target | Rect, p: Partial<EffectParams["spotlight"]> = {}, hold?: number) { return this.effect("spotlight", t, p, { hold }); }
  underline(t: Target | Rect, p: Partial<EffectParams["underline"]> = {}, hold?: number) { return this.effect("underline", t, p, { hold }); }
  async link(a: Target, b: Target, p: Partial<EffectParams["link"]> = {}, hold?: number) {
    const [ra, rb] = [await this.rectOf(a), await this.rectOf(b)];
    if (!ra || !rb) return this.missing("link target", !ra ? a : b);
    const c = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    return this.effect("link", [c(ra), c(rb)], p, { hold });
  }
  highlight(p: Partial<EffectParams["highlighter"]> = {}) { return this.effectStart("highlighter", null, p); }
  /** a highlighter mark along a path (CSS px points), drawn on and held for `hold` ms */
  drawMark(points: Pt[], p: Partial<EffectParams["highlighter"]> = {}, hold = 2400) { return this.effect("highlighter", points, p, { hold }); }
  lowerThird(title: string, subtitle?: string, hold?: number) { return this.effect("lower-third", null, { title, subtitle }, { hold }); }
  slate(title: string, act?: string, hold?: number) { return this.effect("slate", null, { title, act }, { hold }); }
  // ── beat helpers: the common moments, done the way ART_DIRECTION.md says ──────────────
  /** point an arrow at a control, give it a beat, then click it (zooming on it if asked) */
  async pointAndClick(t: Target, o: { style?: EffectParams["arrow"]["style"]; lead?: number; zoom?: FocusKind; settle?: number; clip?: Target } = {}) {
    await this.arrow(t, { style: o.style ?? "curved" }, (o.lead ?? 1100) + 500);
    await this.pause(o.lead ?? 1100);
    await this.click(t, { zoom: o.zoom, settle: o.settle ?? 900, clip: o.clip });
    if (o.zoom) this.unfocus();
  }
  /** numbered dots on each target, then click them in order; each dot leaves as its step happens */
  async steps(targets: Target[], o: { anchor?: EffectParams["step"]["anchor"]; settle?: number; clip?: Target; between?: number } = {}) {
    const done: (() => void)[] = [];
    for (const [i, t] of targets.entries()) { done.push(await this.effectStart("step", t, { n: i + 1, anchor: o.anchor ?? "tr" })); await this.pause(o.between ?? 170); }
    await this.pause(450);
    for (const [i, t] of targets.entries()) { await this.click(t, { settle: o.settle ?? 260, clip: o.clip }); done[i](); }
  }
  /** zoom on something for a while, then pull back */
  async look(t: Target | Rect, ms = 2200, kind: FocusKind = "section") { await this.focus(t, { kind }); await this.pause(ms); this.unfocus(); }
  /** hold the picture while `fn` runs (sheets, lists, iframes that paint a beat late) */
  /** time spent holding on purpose inside the current freeze (a release on a beat) — not a stall */
  heldOnPurpose = 0;
  private paintDepth = 0;
  private beatAt: number | undefined; // a b.at() inside the current freeze: its release moment
  private beatWaited = 0; // how long that b.at() waited (a page idle that long has already recorded its settled frame)
  async whilePainting<T>(fn: () => Promise<T>) {
    // nested (a helper's held step inside your own held block): the outer hold already covers it — a second freeze
    // that ends early would let the picture run in the middle of the outer one (r34: a flicker between two states)
    if (this.paintDepth > 0) { this.paintDepth++; try { return await fn(); } finally { this.paintDepth--; } }
    this.paintDepth = 1;
    const t0 = this.now(), thaw = this.freezeFrom(); this.heldOnPurpose = 0; this.beatAt = undefined;
    try { return await fn(); } finally {
      // the release is NOW (a beat mark, a cut); then a fresh screencast frame: an idle page records none, so the
      // picture after the freeze would be the last frame recorded — often mid-animation (r41: a board drifted 1.5 s
      // into place after a cut). The freeze ends at the release, not after the nudge (r42: reveals ran 140 ms late)
      const tEnd = this.now(), rel = this.beatAt !== undefined && this.beatAt >= t0 ? this.beatAt : tEnd; this.beatAt = undefined;
      await this.page.evaluate(() => { document.body.animate([{ opacity: 0.999 }, { opacity: 1 }], { duration: 120 }); }).catch(() => {});
      // …and the freeze ends on that first fresh frame, not before it: a cut placed at the release showed one film
      // frame of the stale picture in the new framing when the frame arrived ~26 ms later (example-walk). ≤ 1–2 frames late.
      let fresh: number | undefined;
      // a release on a beat (b.at inside the freeze): end on the first frame after the beat — page changes belong before b.at
      for (let i = 0; i < 12 && fresh === undefined; i++) { fresh = this.ev.frames.find((f) => f.t > rel)?.t; if (fresh === undefined) await this.page.waitForTimeout(16); }
      await this.page.waitForTimeout(Math.max(0, 40 - (this.now() - tEnd)));
      // release ON the release moment (the beat): the first frame painted after the nudge shows the page as it was then,
      // so it's shown from that moment (a copy stamped at `rel`) — no stale frame, no late reveal (example-guide: a
      // panel put back just before the beat had no fresh frame on it yet, and the reveal came 2 frames late)
      if (fresh !== undefined && fresh - rel < 150 && fresh > rel) {
        const f = this.ev.frames.find((x) => x.t === fresh)!, at = this.ev.frames.findIndex((x) => x.t > rel);
        this.ev.frames.splice(at < 0 ? this.ev.frames.length : at, 0, { t: rel, file: f.file });
      }
      this.paintDepth = 0; thaw(fresh !== undefined && fresh - rel < 150 ? rel : tEnd); const d = tEnd - t0 - this.heldOnPurpose;
      if (d > 2600) console.warn(`  ! a freeze held the picture ${(d / 1000).toFixed(1)}s at ${(t0 / 1000).toFixed(1)}s — something waited too long (the machine may be loaded); the film will sit still there. Recapture, or check the waits.`);
    }
  }

  caption(text: string, hold?: number, size?: number) { return this.effect("caption", null, size ? { text, size } : { text }, { hold }); }

  /** start a narration line; actions run under it. The next line waits for this one to end. */
  /** start a narration line; actions run under it. The next narrate/settle waits for it to finish + a breath. */
  async narrate(text: string) {
    await this.settle();
    // generate (or fetch from cache) with the take clock paused, so the first capture is right
    this.clock.pause();
    let v: { file: string; dur: number };
    try { v = await voiceFor(text); } finally { this.clock.resume(); }
    const t = this.now();
    if (!this.ev.narration.length) console.log(`  voice: ${ENGINE}`);
    console.log(`  🎙 ${text}`);
    this.ev.narration.push({ t, text, file: v.file, dur: v.dur });
    this.speechEnd = Date.now() + v.dur * 1000;
    await this.pause(300);
  }
  async settle() {
    await this.speech;
    const left = this.speechEnd - Date.now();
    if (left > -300) await this.pause(Math.max(0, left) + 300); // always a ≥ 0.3 s breath after a line
  }
}

/** dry run: the planned camera over the whole take, one tile a second (zooms after keepClear,
 *  holds, releases, slow pushes mid-move) → <dir>/camera-sheet.png */
async function cameraSheet(dir: string, shots: { t: number; buf: Buffer }[], ev: Events) {
  const sharp = (await import("sharp")).default;
  const { plan } = await import("./plan.ts");
  const { makeCamera } = await import("./camera.ts");
  const edl = plan(ev, "dry"), cam = makeCamera({ ...edl, canvas: { ...edl.canvas!, on: false } }, VIEWPORT.w, VIEWPORT.h);
  const TW = 384, TH = 216, COLS = 6, rows = Math.ceil(shots.length / COLS), k = DPR;
  const tiles = await Promise.all(shots.map(async (sh, i) => {
    const c = cam.crop(cam.at(sh.t));
    const x = Math.max(0, Math.round(c.x * k)), y = Math.max(0, Math.round(c.y * k));
    const w = Math.min(VIEWPORT.w * k - x, Math.round(c.w * k)), h = Math.min(VIEWPORT.h * k - y, Math.round(c.h * k));
    const img = await sharp(sh.buf).extract({ left: x, top: y, width: w, height: h }).resize(TW, TH).toBuffer();
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="22"><rect width="${TW}" height="22" fill="rgba(0,0,0,.55)"/><text x="6" y="16" font-family="Menlo" font-size="13" fill="#fff">${(sh.t / 1000).toFixed(1)}s</text></svg>`);
    return [{ input: img, left: (i % COLS) * TW, top: Math.floor(i / COLS) * TH }, { input: label, left: (i % COLS) * TW, top: Math.floor(i / COLS) * TH }];
  }));
  const out = join(dir, "camera-sheet.png");
  await sharp({ create: { width: COLS * TW, height: rows * TH, channels: 3, background: "#111" } }).composite(tiles.flat()).png().toFile(out);
  console.log(`  camera sheet (the planned camera, 1 tile/s) → ${out}`);
}
