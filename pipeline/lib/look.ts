// Looks: a video's own design — tokens taken from the product being filmed, plus the title
// cards, lower thirds and captions drawn in them. A look lives in looks/<name>.ts and is
// loaded by every command (lib/looks.ts), so takes, sequences and previews all see it.
// The pipeline (timing, bars, audio, camera, canvas, checks) stays ours; the design is yours.
// Guide: DESIGN.md.
//
//   export default defineLook({ name: "acme", source: "…", tokens: {…}, cards: { opening: defineCard({…}) }, effects: { lowerThird: defineEffect({…}) } })
//   sequence:  card(look.cards.opening, { title: "…" }, { bars: 2 })
//   journey:   await c.use(look.effects.lowerThird, null, { title: "…" }, { hold: 3000 })
import type { Feel, FeelBase } from "./feels.ts";
import type { Background } from "./canvas.ts";
import type { CardModule, Layer, SceneCtx } from "./presets/types.ts";
import type { Ctx, EffectItem, PreOp } from "./effects/types.ts";
import type { LookCardItem } from "./sequence.ts";

/** the look's tokens: everything a Feel has, with the canvas as a background */
export type LookTokens = Omit<Feel, "name" | "label" | "canvas" | "base"> & {
  /** the stage behind the recording (and behind your cards, via bgLayer): a gradient/solid, or a built-in BACKGROUNDS key */
  canvas: Background | string;
  /** which built-in design the stock presets (B-roll, any built-in card you still use) fall back to */
  base?: FeelBase;
};

export type CardDef<P> = {
  kind: "title" | "broll"; label: string; type?: string;
  defaults: P; dur: number;
  /** realistic params for `npm run look:preview` (real titles, not "Title") */
  sample?: Partial<P>;
  render(p: P, ctx: SceneCtx): Layer[];
};
export type EffectDef<P> = {
  label: string; type?: string; use?: string;
  defaults: P; hold: number; exit: number;
  /** realistic params + a target for `npm run look:preview` */
  sample?: Partial<P>; sampleTarget?: { rect?: { x: number; y: number; w: number; h: number } };
  space?: "page" | "screen" | "auto";
  render(item: EffectItem & { params: P }, ctx: Ctx): string;
  pre?(item: EffectItem & { params: P }, ctx: Ctx): PreOp | null;
  sounds?(item: EffectItem & { params: P }): { at: number; sound: string; db?: number; dur?: number; fade?: number }[];
};

export const defineCard = <P extends Record<string, unknown>>(d: CardDef<P>) => d;
export const defineEffect = <P extends Record<string, unknown>>(d: EffectDef<P>) => d;

export type Look<C extends Record<string, CardDef<any>> = Record<string, CardDef<any>>, E extends Record<string, EffectDef<any>> = Record<string, EffectDef<any>>> = {
  name: string;
  label?: string;
  /** where the tokens came from: the product URL / CSS file you sampled (npm run look:tokens) */
  source: string;
  tokens: LookTokens;
  cards: C;
  effects: E;
};

/** name every card/effect "<look>/<key>" so looks never collide with each other or built-ins */
export function defineLook<C extends Record<string, CardDef<any>>, E extends Record<string, EffectDef<any>>>(
  l: { name: string; label?: string; source: string; tokens: LookTokens; cards?: C; effects?: E }): Look<C, E> {
  if (!/^[a-z0-9-]+$/.test(l.name)) throw new Error(`look name "${l.name}": use lowercase letters, digits and dashes`);
  const cards = Object.fromEntries(Object.entries(l.cards ?? {}).map(([k, d]) => [k, { ...d, type: `${l.name}/${k}` }])) as C;
  const effects = Object.fromEntries(Object.entries(l.effects ?? {}).map(([k, d]) => [k, { ...d, type: `${l.name}/${k}` }])) as E;
  return { ...l, cards, effects };
}

/** the Feel a look becomes (what presets, effects and the canvas read as ctx.feel) */
export function feelOfLook(l: Look): Feel {
  const { canvas, base, ...t } = l.tokens;
  return { ...t, name: l.name, label: l.label ?? l.name, base: base ?? "clean", canvas: typeof canvas === "string" ? canvas : l.name };
}

/** a sequence item for one of your cards: card(look.cards.opening, { title }, { bars: 2, say: "…" }) */
export function card<P>(d: CardDef<P>, params: Partial<P> = {}, o: { dur?: number; bars?: number; say?: string; sayAt?: number; sayOver?: boolean; sfx?: { at: number; sound: string; db?: number }[] } = {}): LookCardItem {
  if (!d.type) throw new Error(`card "${d.label}" is not part of a look (export it through defineLook)`);
  return { kind: d.kind, type: d.type as `${string}/${string}`, params: params as Record<string, unknown>, ...o };
}

/** the CardModule the sequence renders (params arrive merged with defaults) */
export const cardModule = (d: CardDef<any>): CardModule => ({ kind: d.kind, type: d.type!, label: d.label, defaults: d.defaults, dur: d.dur, render: (p, ctx) => d.render({ ...d.defaults, ...p }, ctx) });
