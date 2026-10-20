// Cut — a hard cut to b. ms 0, so the sequence skips the mix; implemented for completeness
// (any progress past 0 shows b).
import type { TransitionModule } from "./types.ts";

const cut: TransitionModule = {
  kind: "transition", type: "cut", label: "Cut", defaults: {}, ms: 0,
  async mix(a, b, u) { return u <= 0 ? a : b; },
};
export default cut;
