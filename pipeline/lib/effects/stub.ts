// Placeholder used until a lane implements an effect: a dashed box + label on the target,
// so journeys, the editor and the renderer can be wired and tested end to end.
import type { EffectModule } from "./types.ts";
import { esc, fadeInOut, fmt } from "./kit.ts";

export function stub(type: string, label: string, hold = 3000, exit = 400, space: EffectModule["space"] = "page"): EffectModule {
  return {
    type, label, defaults: {}, hold, exit, space,
    render(item, ctx) {
      const a = fadeInOut(ctx.t, ctx.dur, 200, exit);
      if (a <= 0) return "";
      const r = item.target.rect ?? (item.target.points?.length ? { x: item.target.points[0].x - 40, y: item.target.points[0].y - 20, w: 80, h: 40 } : { x: ctx.view.w / 2 - 120, y: ctx.view.h - 140, w: 240, h: 60 });
      const p = ctx.toOut({ x: r.x, y: r.y });
      return `<g opacity="${fmt(a)}"><rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(ctx.px(r.w))}" height="${fmt(ctx.px(r.h))}" fill="rgba(255,0,170,.08)" stroke="#ff00aa" stroke-width="${fmt(ctx.px(2))}" stroke-dasharray="${fmt(ctx.px(6))} ${fmt(ctx.px(4))}"/>`
        + `<text x="${fmt(p.x + ctx.px(6))}" y="${fmt(p.y - ctx.px(6))}" font-family="Helvetica, Arial" font-size="${fmt(ctx.px(13))}" font-weight="700" fill="#ff00aa">${esc(type)} (stub)</text></g>`;
    },
  };
}
