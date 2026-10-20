// Plan: turn a take's focus requests into an editable list of zoom segments (edl.json).
// Each segment is a camera target held from `start` to `end`; the renderer eases between
// them. Re-running plan overwrites edl.json, so hand edits go in edl.json AFTER planning
// (or set "locked": true in it, and plan leaves it alone).
//
//   npx tsx lib/plan.ts <take>
import "./looks.ts"; // register looks/*.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Events, FocusKind } from "./capture.ts";
import type { EffectItem, Rect } from "./effects/types.ts";
import { EFFECTS } from "./effects/index.ts";
import { validate } from "./params.ts";
import { DEFAULT_CANVAS, type Canvas } from "./canvas.ts";

export type Segment = { id: string; start: number; end: number; cx: number; cy: number; scale: number; kind: FocusKind; label?: string; enabled: boolean; inMs?: number; outMs?: number }; // inMs/outMs override edl.transition for this segment (a slow push)
export type Edl = { take: string; locked?: boolean; cursor?: boolean /* false = no cursor drawn */; transition: { in: number; out: number; pan: number }; segments: Segment[]; effects?: EffectItem[]; canvas?: Canvas; feel?: string };

// how tight each kind of focus goes, and how long it holds when nothing follows
const KIND: Record<FocusKind, { min: number; max: number; fill: number; hold: number }> = {
  control: { min: 1.7, max: 2.0, fill: 0.5, hold: 1600 }, // a button / toggle — tight, brief
  section: { min: 1.3, max: 1.9, fill: 0.82, hold: 2600 }, // a panel group, a sheet, a list
  stage: { min: 1.3, max: 1.7, fill: 0.86, hold: 3200 }, // the device / board on the canvas
  wide: { min: 1, max: 1, fill: 1, hold: 0 },
};
const LEAD = 650;     // start moving this long before the request, so the camera arrives on cue
const CHAIN_GAP = 1400; // a next focus within this gap pans across instead of pulling back out

// planning runs repeatedly in a dry run (per mark): say each note once per process
const said = new Set<string>();
const note = (msg: string, warn = true) => { if (said.has(msg)) return; said.add(msg); (warn ? console.warn : console.log)(msg); };

export function plan(ev: Events, take: string): Edl {
  const { w: W, h: H } = ev.viewport;
  // a cut at a reveal (ms ≤ 1, lead 0, just after a held picture ends) happens AT the release: the call
  // comes a few ms later (rect lookups), and those frames would show the new layout in the old framing
  const fs = ev.focus.map((f) => { if ((f.ms ?? 999) > 1 || (f.lead ?? LEAD) !== 0) return f;
    const fz = (ev.freeze ?? []).filter((z) => z.to <= f.t + 200 && f.t - z.to < 400).at(-1); return fz ? { ...f, t: fz.to } : f; }).sort((a, b) => a.t - b.t); // + a cut called inside the release (just before the freeze ends on its first fresh frame)
  // a cut (ms ≤ 1) followed at once by a push: the push's lead would start it BEFORE the cut and swallow it (one slow
  // glide from the old view, r34) — start the push just after the cut instead
  for (let i = 1; i < fs.length; i++) { const p = fs[i - 1], f = fs[i];
    if (p.kind !== "wide" && (p.ms ?? 999) <= 1 && f.kind !== "wide" && f.t - (f.lead ?? LEAD) < p.t + 150) fs[i] = { ...f, t: Math.max(f.t, p.t + 150), lead: Math.max(0, f.t - p.t - 150) }; } // called in the same instant as the cut: start 150 ms later, or the push replaces the cut (r38)
  const segs: Segment[] = [];
  fs.forEach((f, i) => {
    if (f.kind === "wide") { const prev = segs[segs.length - 1]; if (prev && prev.end > f.t) prev.end = f.t; if (prev && f.ms) prev.outMs = f.ms; /* unfocus({ ms }): a slow pull-back */ return; }
    const k = KIND[f.kind];
    const fit = Math.min((k.fill * W) / Math.max(f.rect.w, 1), (k.fill * H) / Math.max(f.rect.h, 1));
    let scale = +(f.scale ?? Math.min(k.max, Math.max(k.min, fit))).toFixed(3);
    let cx = f.rect.x + f.rect.w / 2, cy = f.rect.y + f.rect.h / 2;
    // frame whole things: never show a sliver of a kept-clear region (c.keepClear). The regions
    // active now bound a clear band [lo, hi] around the target; the view must fit inside it whole.
    const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    // c.view(): the rect IS the view — a kept-clear region it overlaps is to be avoided, not zoomed on;
    // a region the view holds WHOLE (its full width, e.g. s.controlView on the panel) shows no sliver: fine
    const isView = !!(f as { view?: boolean }).view;
    const regions = (ev.avoid ?? []).filter((x) => x.t <= f.t && (x.until === undefined || x.until > f.t)).map((x) => x.rect)
      .filter((a) => !(isView && f.rect.x <= a.x + 1 && f.rect.x + f.rect.w >= a.x + a.w - 1));
    const inside = isView ? undefined : regions.find((a) => hit(a, f.rect)), asked = scale, name = `focus "${f.label ?? f.kind}" @${(f.t / 1000).toFixed(1)}s`;
    const r = (a: Rect) => `{x ${Math.round(a.x)}, w ${Math.round(a.w)}}`;
    if (inside && W / scale > inside.w + 4) note(`  ! ${name}: the target overlaps kept-clear region ${r(inside)}, which is narrower than the view — the view shows a cut slice beside it (prefer an arrow/spotlight, or a wider rect that includes the stage)`);
    if (!inside && regions.length) {
      // + a 14 px pad: a view edge sitting exactly on a region's edge shows a sliver after easing/encoding
      const PAD = 14;
      const tcx = f.rect.x + f.rect.w / 2;
      const leftOf = (a: Rect) => (isView ? a.x + a.w / 2 < tcx : a.x + a.w <= f.rect.x + 1), rightOf = (a: Rect) => (isView ? a.x + a.w / 2 >= tcx : a.x >= f.rect.x + f.rect.w - 1);
      const lo0 = Math.max(0, ...regions.filter(leftOf).map((a) => a.x + a.w));
      const hi0 = Math.min(W, ...regions.filter(rightOf).map((a) => a.x));
      const lo = lo0 > 0 ? (isView ? lo0 + PAD : Math.min(lo0 + PAD, f.rect.x)) : 0, hi = hi0 < W ? (isView ? hi0 - PAD : Math.max(hi0 - PAD, f.rect.x + f.rect.w)) : W;
      const cw = W / scale, left = cx - cw / 2, right = cx + cw / 2;
      if (isView && ((left < lo - 0.5 && lo > 0) || (right > hi + 0.5 && hi < W))) {
        // a view keeps your scale and slides clear of the region; if it can't fit the band, it tightens
        const room = hi - lo, s2 = Math.max(scale, W / room), cw2 = W / s2;
        const ncx = Math.min(Math.max(cx, lo + cw2 / 2), hi - cw2 / 2);
        note(`  · ${name}: view moved clear of a kept-clear region (cx ${Math.round(cx)} → ${Math.round(ncx)}${s2 !== scale ? `, ×${scale} → ×${+s2.toFixed(3)}` : ""})`, false);
        cx = ncx; scale = +s2.toFixed(3);
      }
      // a region shows if the view crosses one of the band's edges without containing that region whole
      const bad = !isView && ((left < lo - 0.5 && lo > 0) || (right > hi + 0.5 && hi < W));
      if (bad) {
        const room = hi - lo, sNeed = W / room;
        // whole with a 6% margin if possible, else tight (1.5%) rather than dropping the zoom
        const fitAt = (m: number) => Math.min(W / (f.rect.w / m), H / (f.rect.h / m));
        const sMax = fitAt(0.94) >= sNeed ? fitAt(0.94) : fitAt(0.985);
        const s2 = Math.min(Math.max(scale, sNeed), sMax);
        if (s2 < sNeed - 1e-6 || s2 < 1.08) {
          scale = 0; // can't be whole without a region: no zoom
          note(`  ! ${name}: DROPPED (stays wide) — ${Math.round(f.rect.w)}×${Math.round(f.rect.h)} can't be whole in the ${Math.round(room)} px clear band between kept-clear regions. Use s.fitStage() to shrink the composition, a smaller target, or accept the wide shot.`);
        } else {
          // centre things: if a slightly tighter view lets the target sit centred inside the band, take
          // it — but never tighter than this kind of zoom allows (or the scale you asked for)
          const tc = f.rect.x + f.rect.w / 2, sCentre = Math.min(W / (2 * Math.min(tc - lo, hi - tc)), Math.max(k.max, f.scale ?? 0));
          scale = +(sCentre >= s2 && sCentre <= sMax ? sCentre : s2).toFixed(3);
          if (Math.abs(scale - asked) > 0.02) note(`  · ${name}: scale ${asked} → ${scale} to stay clear of kept-clear regions${f.scale !== undefined ? " (keepClear wins over an explicit scale)" : ` (${asked} was the ${f.kind} default)`}`, false);
          const cw2 = W / scale;
          cx = Math.min(Math.max(tc, lo + cw2 / 2), hi - cw2 / 2);
        }
      }
    }
    if (!scale) { const prev = segs[segs.length - 1]; if (prev && prev.end > f.t) prev.end = f.t; return; }
    if (f.align === "top") cy = f.rect.y - 0.04 * (H / scale) + H / scale / 2;      // the target's top just under the frame top
    if (f.align === "bottom") cy = f.rect.y + f.rect.h + 0.04 * (H / scale) - H / scale / 2;
    cy = Math.min(Math.max(cy, H / scale / 2), H - H / scale / 2);
    // frame whole things: say when the view is smaller than the target it frames
    const vw = W / scale, vh = H / scale;
    if (f.kind !== "control" && !isView && (f.rect.w > vw * 1.02 || f.rect.h > vh * 1.02)) note(`  ! ${name}: ×${scale} crops its own target (${Math.round(f.rect.w)}×${Math.round(f.rect.h)} in a ${Math.round(vw)}×${Math.round(vh)} view) — ×${(Math.min(W / f.rect.w, H / f.rect.h) * 0.96).toFixed(2)} holds it whole, or aim at the part you mean (align: "top" for a headline)`);
    // near the window's edge the camera can only go as far as the canvas margin (~6.8% of the
    // window with the canvas on, none with it off): say when the subject can't be centred
    const cw3 = W / scale, mx = W * 0.068, over = Math.max(0, cx + cw3 / 2 - (W + mx), -mx - (cx - cw3 / 2));
    if (over > 30) note(`  ! ${name}: the subject is near the window edge — the view can't centre it (off by ~${Math.round(over)} px; with the canvas off, more). A lower scale or a rect that includes its neighbours centres better.`);
    const lead = (g: { lead?: number }) => g.lead ?? LEAD;
    const start = Math.max(0, f.t - lead(f)); // the same lead unless the journey set one (lead: 0 after a cut); a slow push (f.ms) then takes ms to arrive
    let end = f.t + (f.hold || k.hold);
    const next = fs[i + 1];
    if (next) {
      if (next.kind === "wide") end = Math.min(end, next.t);
      else if (next.t - lead(next) - end < CHAIN_GAP) end = next.t - lead(next); // chain → pan straight to it
      else end = Math.min(end, next.t - lead(next));
    }
    // a push that keepClear cancelled: the previous framing is the same view (both raised to the clear minimum)
    const prev = segs[segs.length - 1];
    if ((f.ms ?? 999) > 1 && prev && prev.end >= Math.max(0, f.t - lead(f)) - 50 && Math.abs(prev.scale - scale) < 0.03 && Math.hypot(prev.cx - cx, prev.cy - cy) < 12)
      note(`  ! ${name}: lands on the same view as "${prev.label ?? prev.id}" (×${scale}) — nothing moves. keepClear raised both to the clear minimum, so this push is a no-op: push to a smaller target (c.view / a rect inside the composition) or drop one of them.`);
    segs.push({ id: `z${i + 1}`, start: Math.round(start), end: Math.round(Math.max(end, start + 400)), cx: Math.round(cx), cy: Math.round(cy), scale, kind: f.kind, label: f.label, enabled: true, ...(f.ms ? { inMs: f.ms, outMs: Math.min(f.ms, 900) } : {}) /* a slow push releases briskly (a slow release drifts over the panel) */ });
  });
  const effects: EffectItem[] = (ev.effects ?? []).map((e, i) => {
    validate(e.type, e.params, `events.json effect ${i + 1}`);
    const m = EFFECTS[e.type];
    if (!m) console.warn(`  ! unknown effect type "${e.type}"`);
    return { id: `e${i + 1}`, type: e.type, start: Math.round(e.t), end: Math.round(e.t + (e.hold ?? m?.hold ?? 3000)), enabled: true, target: e.target, params: { ...(m?.defaults ?? {}), ...e.params }, label: e.label };
  });
  const asked = fs.filter((f) => f.kind !== "wide").length, short = segs.filter((g) => g.end - g.start <= 450 && !((g.inMs ?? 999) <= 1)); // a cut (ms: 1) then a push is deliberate
  if (asked) note(`  · ${take}: ${asked} focus request(s) → ${segs.length} zoom segment(s)${asked > segs.length ? " (dropped ones are listed above)" : ""}${short.length ? `; ${short.map((g) => `"${g.label ?? g.id}"`).join(", ")} last${short.length > 1 ? "" : "s"} ≤ 0.45 s before the next focus (effectively replaced — leave more time between them)` : ""}`, false);
  return { take, transition: { in: 750, out: 850, pan: 800 }, segments: segs, effects, canvas: { ...DEFAULT_CANVAS } };
}

/** events.json → edl.json, unless the edl is locked (hand edits kept). Capture runs this for you. */
export function planTake(take: string) {
  const dir = join(process.env.FLEX_TAKES ?? join(import.meta.dirname, "..", "takes"), take);
  const out = join(dir, "edl.json");
  if (existsSync(out) && JSON.parse(readFileSync(out, "utf8")).locked) { console.log(`  edl.json is locked — left as is (unlock to re-plan zooms from the new capture)`); return; }
  const edl = plan(JSON.parse(readFileSync(join(dir, "events.json"), "utf8")), take);
  writeFileSync(out, JSON.stringify(edl, null, 1));
  console.log(`✓ ${edl.segments.length} zoom segments → takes/${take}/edl.json`);
}
if (process.argv[1]?.endsWith("plan.ts")) {
  const take = process.argv[2]; if (!take) throw new Error("usage: plan.ts <take>");
  planTake(take);
}
