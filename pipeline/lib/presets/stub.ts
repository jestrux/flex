// Placeholders until a Phase 5 lane implements a preset.
import type { CardModule, TransitionModule } from "./types.ts";
import sharp from "sharp";
import { backgroundSvg, BACKGROUNDS } from "../canvas.ts";
import { esc } from "../effects/kit.ts";

export function cardStub(kind: "title" | "broll", type: string, label: string, dur = 3000): CardModule {
  return {
    kind, type, label, defaults: { title: label }, dur,
    render(params, ctx) {
      const bg = BACKGROUNDS[ctx.feel.canvas]?.bg ?? BACKGROUNDS.modern.bg;
      return [
        { svg: backgroundSvg(bg, ctx.out.w, ctx.out.h) },
        { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${ctx.out.w}" height="${ctx.out.h}"><text x="50%" y="50%" text-anchor="middle" font-family="${ctx.feel.font.display}" font-size="64" font-weight="700" fill="${ctx.feel.color.ink}">${esc(params.title ?? label)}</text>`
          + `<text x="50%" y="58%" text-anchor="middle" font-family="Helvetica" font-size="24" fill="#ff00aa">${esc(`${kind}:${type} (stub · ${ctx.feel.label})`)}</text></svg>` },
      ];
    },
  };
}

export function transitionStub(type: string, label: string, ms = 500): TransitionModule {
  return {
    kind: "transition", type, label, defaults: {}, ms,
    // stub = hard cut at the midpoint
    async mix(a, b, u) { return u < 0.5 ? a : b; },
  };
}
export const _sharp = sharp; // keep the import (used by real transitions)
