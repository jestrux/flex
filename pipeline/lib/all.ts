// npx tsx lib/all.ts <journey>  — capture → plan → render → build
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { capture } from "./capture.ts";
import { plan } from "./plan.ts";
import { render } from "./render.ts";
import { build } from "./build.ts";
const name = process.argv[2] ?? "studio-social";
const [proj, pj] = name.includes("/") ? name.split("/") : [null, null]; // <project>/<journey> → the project's own journeys
const j = await import(proj ? `../projects/${proj}/journeys/${pj}.ts` : `../journeys/${name}.ts`);
const dir = await capture(j.take, j.run);
const edlFile = join(dir, "edl.json");
writeFileSync(edlFile, JSON.stringify(plan(JSON.parse(readFileSync(join(dir, "events.json"), "utf8")), j.take), null, 1));
await render(j.take);
build(j.take, { music: !process.argv.includes("--no-music") });
process.exit(0);
