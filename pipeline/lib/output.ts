// The output size. 1080p by default; OUT_SIZE=4k (or 1440p, or WxH) renders bigger. Layout stays 1920 wide everywhere
// (cards, effects and grids scale by out.w / 1920), so only the pixels change. A non-default size gets its own build
// folder and a suffix on the film's files ("<name>@4k.mp4"), so 1080p and 4K renders never mix.
//   OUT_SIZE=4k npm run video <project>
// Flex (patch 08): FLEX_FRAME=WxH is the film's own frame (frame.json; 1080x1920 for a vertical film). It is the
// default size, and 1440p / 4k scale it (its short side to 1440 / 2160).
const frame = /^\d+x\d+$/.test(process.env.FLEX_FRAME ?? "") ? process.env.FLEX_FRAME!.split("x").map(Number) : [1920, 1080];
const raw = (process.env.OUT_SIZE ?? "").toLowerCase();
const k = raw === "4k" || raw === "2160p" ? 2 : raw === "1440p" ? 4 / 3 : 1;
const [w, h] = /^\d+x\d+$/.test(raw) ? raw.split("x").map(Number) : frame.map((v) => Math.round((v * k) / 2) * 2);
export const OUT = { w, h };
/** output px per layout px (1 at 1080p, 2 at 4K) */
export const OUT_K = w / 1920;
/** the suffix for a non-default size's build folder and files ("" at the film's own frame) */
export const SIZE_TAG = w === frame[0] && h === frame[1] ? "" : k === 2 ? "@4k" : k > 1 ? "@1440p" : `@${h}p`;
