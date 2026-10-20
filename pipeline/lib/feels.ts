// Feels: one small token set per look. A video picks one feel; title cards, lower thirds,
// B-roll framing, transitions and the canvas background all read from it, so a video is
// consistent by default. Presets vary their design per feel rather than exposing knobs.
// Browser-safe.

export type FeelName = "clean" | "modern" | "professional";
/** the built-in design a feel uses for the stock cards/B-roll/lower thirds (a look picks one) */
export type FeelBase = FeelName;

export type Feel = {
  name: string;               // a built-in FeelName, or a look's name (looks/<name>.ts)
  label: string;
  base: FeelBase;             // which built-in design the stock presets use for this feel
  canvas: string;             // canvas background preset (lib/canvas.ts BACKGROUNDS)
  font: { sans: string; display: string; displayWeight: number; bodyWeight: number; tracking: number; mono?: string }; // tracking: em; mono = the product's meta/label face
  color: {
    ink: string;              // text on the feel's background
    sub: string;              // secondary text
    accent: string;           // highlights, bars, kickers
    card: string;             // lower-third / label card fill
    cardInk: string;          // text on cards
    cardBorder?: string;
    callout?: string;         // arrows, underlines, step dots, link wires (a look: defaults to accent)
    line?: string;            // hairlines / borders (a look's one stroke colour)
    soft?: string;            // a tint of the accent for selected / highlighted fills
  };
  shadow?: { color: string; blur: number; dy: number }; // the look's one shadow (output px at 1080p)
  motion: { in: number; out: number; ease: "standard" | "outCubic" | "outBack" | "power3Out"; stagger: number; spring?: { stiffness: number; damping: number } };
  transition: { type: string; ms: number }; // default transition at each join
  radius: number;             // card corner radius (CSS px)
  /** clicks in takes (optional; unset = the default purple ripple and a plain 0.86 press, no sound):
   *  ripple = its colour (#rrggbb); press = "snap" (today's) | "spring" (dips to 0.8 in 70 ms, springs back with a
   *  touch of overshoot, settled by ≈ 350 ms); sound = a library sfx key played on every click (db: its level, default −6) */
  click?: { ripple?: string; press?: "snap" | "spring"; sound?: string; db?: number };
  /** typing in takes (optional; unset = silent): sounds = library sfx keys played one per keystroke, cycled (two or three
   *  variants keep a word from sounding mechanical); db: their level (default −6) */
  typing?: { sounds: string[]; db?: number };
  /** the stage around takes (optional): padding (fraction of the stage width, default the take's 0.06) and a panel the
   *  window sits on, inset so the background (e.g. a hatch) shows around it — see Canvas.panel */
  stage?: { padding?: number; panel?: { color: string; inset: number; radius: number }; border?: { color: string; width: number; opacity?: number } };
};

const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const SERIF = "New York, Georgia, Times New Roman, serif";

export const FEELS: Record<string, Feel> = {
  clean: {
    name: "clean", base: "clean", label: "Clean", canvas: "clean",
    font: { sans: SANS, display: SANS, displayWeight: 600, bodyWeight: 400, tracking: -0.01 },
    color: { ink: "#111827", sub: "#4B5563", accent: "#2563EB", card: "#FFFFFF", cardInk: "#111827", cardBorder: "rgba(17,24,39,0.10)" },
    motion: { in: 500, out: 400, ease: "standard", stagger: 0 },
    transition: { type: "crossfade", ms: 500 },
    radius: 12,
  },
  modern: {
    name: "modern", base: "modern", label: "Modern", canvas: "modern",
    font: { sans: SANS, display: SANS, displayWeight: 800, bodyWeight: 500, tracking: -0.025 },
    color: { ink: "#FFFFFF", sub: "rgba(255,255,255,0.74)", accent: "#C4F042", card: "rgba(20,12,44,0.78)", cardInk: "#FFFFFF", cardBorder: "rgba(255,255,255,0.14)" },
    motion: { in: 650, out: 450, ease: "outBack", stagger: 28, spring: { stiffness: 220, damping: 18 } },
    transition: { type: "zoom-through", ms: 700 },
    radius: 16,
  },
  professional: {
    name: "professional", base: "professional", label: "Professional", canvas: "professional",
    font: { sans: SANS, display: SERIF, displayWeight: 600, bodyWeight: 400, tracking: 0 },
    color: { ink: "#F8FAFC", sub: "#94A3B8", accent: "#38BDF8", card: "rgba(15,23,42,0.90)", cardInk: "#F8FAFC", cardBorder: "rgba(148,163,184,0.25)" },
    motion: { in: 800, out: 600, ease: "power3Out", stagger: 0 },
    transition: { type: "crossfade", ms: 700 },
    radius: 6,
  },
};

export const feelOf = (name?: string): Feel => FEELS[name ?? "modern"] ?? FEELS.modern;
/** strict: unknown names are an error (a sequence naming a look that didn't load) */
export function feelNamed(name: string): Feel {
  const f = FEELS[name]; if (!f) throw new Error(`unknown feel/look "${name}". Known: ${Object.keys(FEELS).join(", ")} (looks load from looks/*.ts; a look that fails to load is skipped with a warning above)`);
  return f;
}
