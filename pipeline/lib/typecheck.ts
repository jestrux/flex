// npm run typecheck <video>   — type-check the project, but report only errors in YOUR files
// (anything whose path contains <video>) and in the shared lib/ and journeys/_studio.ts. Other agents'
// half-written files would otherwise fail everyone's check.
import { spawnSync } from "node:child_process";
const name = process.argv[2];
if (!name) { console.error("usage: npm run typecheck <video>"); process.exit(1); }
import { readdirSync } from "node:fs";
const root = `${import.meta.dirname}/..`;
const yours = ["journeys", "videos", "looks"].flatMap((d) => readdirSync(`${root}/${d}`).filter((f) => f.includes(name)).map((f) => `${d}/${f}`));
console.log(yours.length ? `checking ${yours.join(", ")} (+ lib/, journeys/_studio.ts)` : `! no files named *${name}* yet in journeys/, videos/ or looks/ — nothing of yours to check`);
const r = spawnSync("npx", ["tsc", "--noEmit", "-p", "."], { cwd: root, encoding: "utf8" });
const lines = (r.stdout + r.stderr).split("\n").filter((l) => /\.tsx?\(\d+,\d+\)/.test(l));
const mine = lines.filter((l) => l.includes(name) || l.startsWith("lib/") || l.startsWith("journeys/_studio"));
const others = new Set(lines.filter((l) => !mine.includes(l)).map((l) => l.split("(")[0]));
for (const l of mine) console.log(l);
if (others.size) console.log(`  (ignored ${lines.length - mine.length} error(s) in other files: ${[...others].join(", ")})`);
console.log(mine.length ? `✗ ${mine.length} type error(s) in your files` : `✓ ${name}: no type errors in your files`);
process.exit(mine.length ? 1 : 0);
