// The sound + music library (assets/library.json): lookup by key, and loudness measurement.
//   npm run assets:measure   → fills lufs (integrated loudness) + peak (true peak, dBTP) for every asset
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ASSETS = join(import.meta.dirname, "..", "assets");
const LIB = join(ASSETS, "library.json");

export type Asset = { file: string; purpose?: string; mood?: string; feel?: string; bpm?: number /* declared by the source; anchors beat analysis */; source: string; licence: string; attribution?: string; lufs?: number; peak?: number };
export type Library = { sfx: Record<string, Asset>; music: Record<string, Asset> };

// a project (projects/<name>, usually a symlink to a folder next to its product) can bring its own audio:
// projects/<name>/audio.json { music: { key: { file: "audio/x.mp3", … } }, sfx: { … } } — paths relative to
// the project. Those entries join the library with absolute paths; a track's beat grid sits next to it.
const PROJECTS = process.env.FLEX_PROJECTS ?? join(import.meta.dirname, "..", "projects"); // Flex: its session folder of project links
export type ProjectAudio = { manifest: string; lib: Partial<Library> };
export function projectAudio(): ProjectAudio[] {
  if (!existsSync(PROJECTS)) return [];
  return readdirSync(PROJECTS).filter((d) => !d.startsWith("_") && existsSync(join(PROJECTS, d, "audio.json"))).map((d) => {
    const manifest = realpathSync(join(PROJECTS, d, "audio.json")), raw = JSON.parse(readFileSync(manifest, "utf8")) as Partial<Library>;
    const lib: Partial<Library> = {};
    for (const kind of ["sfx", "music"] as const) if (raw[kind]) lib[kind] = Object.fromEntries(Object.entries(raw[kind]!).map(([k, a]) => [k, { ...a, file: resolve(dirname(manifest), a.file) }]));
    return { manifest, lib };
  });
}
export const library = (): Library => {
  const base = JSON.parse(readFileSync(LIB, "utf8")) as Library;
  for (const p of projectAudio()) for (const kind of ["sfx", "music"] as const)
    for (const [k, a] of Object.entries(p.lib[kind] ?? {})) {
      if (base[kind][k]) throw new Error(`audio key "${k}" in ${p.manifest} is already in the library — keys must be unique`);
      base[kind][k] = a;
    }
  return base;
};
const get = (kind: "sfx" | "music", key: string) => {
  const a = library()[kind][key];
  if (!a) throw new Error(`unknown ${kind} "${key}". Known: ${Object.keys(library()[kind]).join(", ")} (assets/library.json, projects/*/audio.json)`);
  return { ...a, key, path: resolve(ASSETS, a.file) }; // a project's entries are already absolute
};
export const sfx = (key: string) => get("sfx", key);
export const music = (key: string) => get("music", key);

/** integrated loudness (LUFS) and true peak (dBTP) of a file, or of a time range of it (seconds) */
export function loudness(file: string, o: { from?: number; dur?: number } = {}): { lufs: number; peak: number } {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...(o.from ? ["-ss", String(o.from)] : []), ...(o.dur ? ["-t", String(o.dur)] : []),
    "-i", file, "-vn", "-af", "apad=whole_dur=1,ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8" }); // apad: clips under 400 ms still get a gated reading
  const t = r.stderr ?? "";
  // the summary is last in the log; take the last match of each
  const i = [...t.matchAll(/I:\s+(-?[\d.]+|-inf) LUFS/g)].at(-1), p = [...t.matchAll(/Peak:\s+(-?[\d.]+|-inf) dBFS/g)].at(-1);
  return { lufs: i && i[1] !== "-inf" ? +i[1] : -70, peak: p && p[1] !== "-inf" ? +p[1] : -70 };
}

if (process.argv[1]?.endsWith("assets.ts") && process.argv[2] === "measure") {
  const measure = (lib: Partial<Library>, base: string) => {
    for (const kind of ["sfx", "music"] as const)
      for (const [k, a] of Object.entries(lib[kind] ?? {})) {
        const p = resolve(base, a.file);
        if (!existsSync(p)) { console.warn(`! missing ${kind}/${k}: ${a.file}`); continue; }
        const m = loudness(p);
        a.lufs = Math.round(m.lufs * 10) / 10; a.peak = Math.round(m.peak * 10) / 10;
        console.log(`${kind}/${k.padEnd(14)} ${String(a.lufs).padStart(6)} LUFS  peak ${String(a.peak).padStart(5)} dBTP  ${a.licence}`);
      }
  };
  const lib = JSON.parse(readFileSync(LIB, "utf8")) as Library;
  measure(lib, ASSETS);
  writeFileSync(LIB, JSON.stringify(lib, null, 2) + "\n");
  for (const { manifest } of projectAudio()) { // each project's own manifest, written back in place
    const raw = JSON.parse(readFileSync(manifest, "utf8")) as Partial<Library>;
    measure(raw, dirname(manifest));
    writeFileSync(manifest, JSON.stringify(raw, null, 2) + "\n");
  }
}
