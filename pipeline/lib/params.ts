// Typed parameters for every effect and preset — the DSL's contract. Journeys and sequences get
// compile-time errors for typos and wrong values (`npx tsc --noEmit -p .`), and `validate()`
// rejects unknown keys at plan/render time (catches hand edits to edl.json and JSON params).
import { EFFECTS } from "./effects/index.ts";
import { CARDS, TRANSITIONS } from "./presets/index.ts";

type Color = string;            // any CSS colour
type Pt = { x: number; y: number };

export type EffectParams = {
  arrow: { style: "curved" | "straight" | "wavy"; drawOn: boolean; color: Color; tip: "edge" | "center"; gap: number; from: { dx: number; dy: number }; fromPoint: Pt };
  annotate: { shape: "rect" | "ellipse" | "line" | "arrow" | "pen"; color: Color; thickness: number; style: "straight" | "curved" | "wavy"; drawOn: boolean; pad: number };
  spotlight: { style: "dim" | "outline" | "blur"; pad: number; radius: number; pull: number; blur: number; color: Color; width: number };
  underline: { overhang: number; gap: number; color: Color; width: number };
  link: { labels: [string, string] | string[]; bend: number; color: Color; labelPill: boolean };
  highlighter: { width: number; opacity: number; draw: number };
  halo: { size: number; intensity: number; color: string /* "r,g,b" */ };
  "lower-third": { variant: "name" | "topic" | "step"; style: "feel" | "fuchi"; title: string; subtitle: string; kicker: string };
  slate: { title: string; act: string };
  caption: { text: string; size: number; backing: boolean };
  step: { n: number | string; color: Color; size: number; anchor: "center" | "tl" | "tr" | "right" | "left" | "above"; offset: { dx: number; dy: number } };
  confetti: { scale: number; cheer: boolean; sound: boolean };
  "coin-rain": { scale: number };
  odometer: { label: string; prefix: string; from: number; to: number; ticks: { amount: number; date?: string }[]; locale: string };
};
export type EffectType = keyof EffectParams;

export type CardParams = {
  "title-opening": { title: string; kicker: string; subtitle: string };
  "title-chapter": { title: string; act: string };
  "title-closing": { title: string; subtitle: string; cta: string; arrow: boolean };
  "broll-still": { src: string; caption: string; move: "in" | "out" | "pan-left" | "pan-right"; amount: number; fit: "auto" | "cover" | "contain"; focusY: number };
  "broll-device": { src: string; caption: string; device: "auto" | "phone" | "laptop"; focusY: number; start: number };
  "broll-clip": { src: string; caption: string; start: number; push: number; fit: "auto" | "cover" | "contain"; focusY: number };
  "broll-pip": { src: string; pip: string; caption: string; corner: "br" | "bl" | "tr" | "tl"; delay: number; start: number; pipStart: number; pipFocusY: number; fit: "auto" | "cover" | "contain"; focusY: number };
};
export type CardType = keyof CardParams;
export type TransitionParams = {
  cut: {}; crossfade: {}; "blur-dissolve": { blur: number };
  push: { dir: "left" | "right" | "up" | "down"; dim: number; shadow: boolean };
  "zoom-through": { scale: number; from: number; blur: number; cx: number; cy: number };
  "canvas-swap": { dir: "left" | "right"; scale: number };
};
export type TransitionType = keyof TransitionParams;

// ── runtime: unknown keys are errors (with the valid keys listed) ───────────────────────
const KEYS: Record<string, string[]> = {
  arrow: ["style", "drawOn", "color", "tip", "gap", "from", "fromPoint"], annotate: ["shape", "color", "thickness", "style", "drawOn", "pad"],
  spotlight: ["style", "pad", "radius", "pull", "blur", "color", "width"], underline: ["overhang", "gap", "color", "width"], link: ["labels", "bend", "color", "labelPill"],
  highlighter: ["width", "opacity", "draw"], halo: ["size", "intensity", "color"],
  "lower-third": ["variant", "style", "title", "subtitle", "kicker"], slate: ["title", "act"], caption: ["text", "size", "backing"],
  step: ["n", "color", "size", "anchor", "offset"], confetti: ["scale", "cheer", "sound"], "coin-rain": ["scale"], odometer: ["label", "prefix", "from", "to", "ticks", "locale"],
  "title-opening": ["title", "kicker", "subtitle"], "title-chapter": ["title", "act"], "title-closing": ["title", "subtitle", "cta", "arrow"],
  "broll-still": ["src", "caption", "move", "amount", "fit", "focusY"], "broll-device": ["src", "caption", "device", "focusY", "start"],
  "broll-clip": ["src", "caption", "start", "push", "fit", "focusY"], "broll-pip": ["src", "pip", "caption", "corner", "delay", "start", "pipStart", "pipFocusY", "fit", "focusY"],
  cut: [], crossfade: [], "blur-dissolve": ["blur"], push: ["dir", "dim", "shadow"], "zoom-through": ["scale", "from", "blur", "cx", "cy"], "canvas-swap": ["dir", "scale"],
};
/** throw on an unknown type or param key; `where` names the source for the message */
export function validate(type: string, params: Record<string, unknown> | undefined, where: string) {
  const mod = type.includes("/") ? (EFFECTS[type] ?? CARDS[type]) : undefined; // a look's card/effect
  const keys = KEYS[type] ?? (mod ? Object.keys(mod.defaults) : undefined);
  if (!keys) {
    const all = [...Object.keys(EFFECTS), ...Object.keys(CARDS), ...Object.keys(TRANSITIONS)];
    throw new Error(`${where}: unknown type "${type}". Known: ${all.join(", ")} (npm run fx:list)`);
  }
  for (const k of Object.keys(params ?? {}))
    if (!keys.includes(k)) throw new Error(`${where}: "${type}" has no param "${k}". Valid: ${keys.join(", ") || "(none)"}`);
}
