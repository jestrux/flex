// npm run video <video> [-- --plan]   (videos/<video>.ts default-exports a Sequence)
// npm run video <project> [-- --scene <id>] [--plan]   (projects/<project>/project.ts — see lib/project.ts)
import type { Sequence } from "./sequence.ts";
const name = process.argv[2]; if (!name) throw new Error("usage: npm run video <video> [-- --plan]");
// a top-level-await deadlock (an import cycle) makes node exit 13 silently — say so
process.on("exit", (code) => { if (code === 13) console.error(`✗ the render stopped before finishing (exit 13: an unsettled top-level await — usually an import cycle between videos/${name}.ts and lib/). Nothing was written.`); });
// remove the old film BEFORE loading the sequence: if videos/<name>.ts doesn't even compile, no
// stale mp4 is left behind for `check` to pass against (renderSequence removes it again too)
// the disk check runs BEFORE the old film is removed: a render refused for space must not destroy a good film
if (!process.argv.includes("--plan")) (await import("./disk.ts")).needDisk(`${import.meta.dirname}/..`, 0.8, "video render");
if (!process.argv.includes("--plan") && (await import("node:fs")).existsSync(`${import.meta.dirname}/../videos/${name}.ts`)) { const { rmSync } = await import("node:fs"); const { finalPath } = await import("./build.ts"); for (const ext of [".mp4", ".srt", ".credits.txt"]) rmSync(finalPath(name).replace(/\.mp4$/, ext), { force: true }); }
const { recap } = await import("./warn-recap.ts");
const { renderSequence } = await import("./sequence.ts");
const { existsSync } = await import("node:fs");
const { join } = await import("node:path");
const projectFile = join(process.env.FLEX_PROJECTS ?? join(import.meta.dirname, "..", "projects"), name, "project.ts");
let seq: Sequence;
if (existsSync(projectFile)) {
  const { toSequence } = await import("./project.ts");
  const si = process.argv.indexOf("--scene");
  const sceneId = si > 0 ? process.argv[si + 1] : process.env.npm_config_scene; // (without the "--", npm keeps --scene for itself)
  seq = toSequence((await import(projectFile)).default, sceneId);
} else seq = (await import(`../videos/${name}.ts`)).default;
await renderSequence(seq);
recap(process.argv.includes("--plan") ? "plan" : "render");
process.exit(0);
