// Build one take: video.mp4 + narration + effect sounds + music bed → ~/Downloads/fancy-e2e-videos/<take>.mp4
// (+ .srt, + .credits.txt when a licensed asset is used). Audio is mixed to measured targets by
// lib/audio.ts; the timeline is written to takes/<take>/timeline.json for `npm run check`.
//
//   npx tsx lib/build.ts <take> [--track carefree] [--no-music]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Events } from "./capture.ts";
import type { Edl } from "./plan.ts";
import { effectSounds } from "./effects/sounds.ts";
import { credits, mixAudio, type MusicRef, type SfxLine, type VoiceLine } from "./audio.ts";

/** finished videos land here (override with OUT_DIR) */
import { SIZE_TAG } from "./output.ts";
export const OUT_DIR = process.env.OUT_DIR ?? join(homedir(), "Downloads", "fancy-e2e-videos");
/** a project's films go in its own subfolder when its project.ts sets `out: "<folder>"` (projects/<name>/project.ts;
 *  read from the source so every command — video, check, stills, sheet — agrees without importing the project).
 *  Names are "<project>" or "<project>--<scene>". */
export function outDirFor(name: string) {
  if (process.env.FLEX_OUT) return process.env.FLEX_OUT; // Flex: ~/Downloads/flex-videos/<project>/
  const f = join(process.env.FLEX_PROJECTS ?? join(import.meta.dirname, "..", "projects"), name.split("--")[0], "project.ts");
  const m = existsSync(f) ? readFileSync(f, "utf8").match(/^\s*out:\s*["']([^"']+)["']/m) : null;
  return m ? join(OUT_DIR, m[1]) : OUT_DIR;
}
export const finalPath = (name: string) => join(outDirFor(name), `${name}${SIZE_TAG}.mp4`);

const srtTime = (ms: number) => new Date(Math.max(0, ms)).toISOString().slice(11, 23).replace(".", ",");

/** shared output step: subtitles, credits, mux video + mixed audio, timeline for `check` */
export function finish(o: { name: string; dir: string; video: string; total: number; voice: VoiceLine[]; sfx: SfxLine[]; music?: MusicRef; extra?: object }) {
  const out = finalPath(o.name), tmp = out.replace(/\.mp4$/, ".rendering.mp4"); // Flex (patch 10): swapped in when complete
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out.replace(/\.mp4$/, ".credits.txt"), { force: true });
  writeFileSync(out.replace(/\.mp4$/, ".srt"), o.voice.map((l, i) => `${i + 1}\n${srtTime(l.t)} --> ${srtTime(l.t + l.dur * 1000)}\n${l.text}\n`).join("\n"));
  const cr = credits({ music: o.music, sfx: o.sfx });
  if (cr.length) writeFileSync(out.replace(/\.mp4$/, ".credits.txt"), cr.join("\n") + "\n");
  const audio = mixAudio(o.dir, { total: o.total, voice: o.voice, sfx: o.sfx, music: o.music });
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", o.video, "-i", audio.mix, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(o.total), tmp]);
  renameSync(tmp, out);
  writeFileSync(join(o.dir, "timeline.json"), JSON.stringify({ name: o.name, out, video: o.video, total: o.total, voice: o.voice, sfx: o.sfx, music: o.music ? (typeof o.music === "string" ? o.music : o.music.key) : null, musicFrom: typeof o.music === "object" && o.music ? o.music.from ?? 0 : 0, audio, credits: cr, ...(o.extra ?? {}) }, null, 1));
  console.log(`✓ ${out}  (${o.voice.length} lines, ${o.sfx.length} sounds${o.music ? `, music ${typeof o.music === "string" ? o.music : `${o.music.key}@${o.music.from ?? 0}s`}` : ""}${cr.length ? ", credits" : ""})`);
  return out;
}

export function build(take: string, o: { track?: string; music?: boolean } = {}) {
  const dir = join(process.env.FLEX_TAKES ?? join(import.meta.dirname, "..", "takes"), take);
  const ev: Events = JSON.parse(readFileSync(join(dir, "events.json"), "utf8"));
  const edl: Edl | null = existsSync(join(dir, "edl.json")) ? JSON.parse(readFileSync(join(dir, "edl.json"), "utf8")) : null;
  return finish({ name: take, dir, video: join(dir, "video.mp4"), total: ev.duration / 1000, voice: ev.narration, sfx: effectSounds(edl?.effects),
    music: o.music === false ? false : o.track ?? "carefree", extra: { kind: "take", clips: [{ label: `take ${take}`, start: 0, dur: ev.duration / 1000, take, from: 0, to: ev.duration / 1000 }] } });
}

if (process.argv[1]?.endsWith("build.ts")) {
  const take = process.argv[2]; if (!take) throw new Error("usage: build.ts <take>");
  const i = process.argv.indexOf("--track");
  build(take, { track: i > 0 ? process.argv[i + 1] : undefined, music: !process.argv.includes("--no-music") });
}
