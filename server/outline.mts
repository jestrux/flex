// Prints a project's outline as JSON: the film's name, music and scenes, read from its project.ts.
// Run with fancy-e2e-videos' tsx (the project imports the pipeline by relative path):
//   <fancy-e2e-videos>/node_modules/.bin/tsx server/outline.mts <project-dir>
// A stand-in for the preview server's manifest until that exists (docs/preview-server.md).
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2] ?? ".");
const log = console.log; console.log = console.warn = () => {}; // keep stdout for the JSON
try {
  const p = (await import(pathToFileURL(join(dir, "project.ts")).href)).default;
  const music = typeof p.music === "string" ? { key: p.music } : { key: p.music.key, segments: p.music.segments ?? null, from: p.music.from ?? null, tracks: p.music.tracks ?? null };
  const scenes = p.scenes.map((s: any) => ({
    id: s.id, start: s.start, end: s.end, note: s.note ?? null,
    items: s.items.map((it: any) => ({ kind: it.kind, type: it.type ?? null, take: it.take ?? null, dur: typeof it.dur === "number" ? it.dur : null })),
  }));
  log(JSON.stringify({ ok: true, name: p.name, feel: p.feel, music, duration: scenes.length ? scenes[scenes.length - 1].end - scenes[0].start : 0, scenes }));
} catch (e) {
  log(JSON.stringify({ ok: false, error: String((e as Error).stack ?? e).split("\n").slice(0, 4).join("\n") }));
}
process.exit(0);
