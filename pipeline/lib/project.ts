// A project: one film made of scenes, in its own folder (projects/<name>/):
//   project.ts      default-exports defineProject({ … }) — the music, the look, the scenes in order
//   look.ts         the project's look (defineLook, named after the folder)
//   scenes/*.ts     each default-exports scene({ id, start, end, items }) — a slice of the SONG:
//                   start/end are seconds in the track, so scenes are authored against the music's
//                   hit map (NOTES.md) and line up end to end
//   journeys/*.ts   the project's takes (optional; capture them as projects/<name>/journeys/<take>)
//
//   npm run video <project>                     the whole film
//   npm run video <project> -- --scene <id>     one scene alone, its music starting at scene.start
//                                               (→ <project>--<id>.mp4, checked as <project>--<id>)
import type { Sequence, SeqItem } from "./sequence.ts";
import type { MusicRef } from "./audio.ts";

export type Scene = { id: string; start: number; end: number; items: SeqItem[]; note?: string };
/** out: a subfolder of the output folder for this project's films (e.g. "kinpay-circles"); see build.ts outDirFor */
export type Project = { name: string; out?: string; feel: string; music: Exclude<MusicRef, false | undefined>; snap?: Sequence["snap"]; canvas?: Sequence["canvas"]; scenes: Scene[] };

export const scene = (s: Scene) => s;
export const defineProject = (p: Project) => p;

/** a scene's own length from its items (ms durations; bars/voice-led items can't be summed here) */
const itemsMs = (s: Scene) => s.items.reduce((a, it) => a + ("dur" in it && typeof it.dur === "number" ? it.dur : NaN), 0);

/** the project as a Sequence: every scene end to end, or just one (`--scene <id>`) */
export function toSequence(p: Project, sceneId?: string): Sequence {
  // scene ids name scenes everywhere (--scene, Flex's outline, renders): two alike would answer for each other (Flex, patch 14)
  const seen = new Set<string>();
  for (const s of p.scenes) { if (seen.has(s.id)) throw new Error(`project ${p.name}: two scenes are called "${s.id}" (scene ids must be unique)`); seen.add(s.id); }
  // scenes tile the song: each starts where the last ended
  p.scenes.forEach((s, i) => {
    const prev = p.scenes[i - 1];
    if (prev && Math.abs(prev.end - s.start) > 0.001) console.warn(`  ! scene "${s.id}" starts at ${s.start}s but "${prev.id}" ends at ${prev.end}s — scenes should tile the song`);
    const ms = itemsMs(s);
    if (!Number.isNaN(ms) && Math.abs(ms / 1000 - (s.end - s.start)) > 0.04) console.warn(`  ! scene "${s.id}": its items last ${(ms / 1000).toFixed(2)}s but it spans ${s.start}–${s.end}s (${(s.end - s.start).toFixed(2)}s)`);
  });
  const key = typeof p.music === "string" ? p.music : p.music.key, from0 = typeof p.music === "string" ? 0 : p.music.from ?? 0;
  const base = { feel: p.feel, canvas: p.canvas ?? "feel", snap: p.snap ?? "off" } as const;
  if (sceneId) {
    const s = p.scenes.find((x) => x.id === sceneId);
    if (!s) throw new Error(`project ${p.name}: no scene "${sceneId}" (scenes: ${p.scenes.map((x) => x.id).join(", ")})`);
    // what follows the scene in the film (Flex, patch 16): its last card holds or cuts as it does there
    const after = p.scenes[p.scenes.indexOf(s) + 1]?.items[0] ?? null;
    const segs = typeof p.music === "object" ? p.music.segments : undefined;
    if (segs?.length) { // an edited track: start the edit at the scene's film time (drop/trim the stretches before it)
      let F = 0; const out: [number, number][] = [], trk: string[] = [], tracks = (p.music as { tracks?: string[] }).tracks;
      segs.forEach(([a, b], i) => { const len = b - a; if (F + len > s.start) { out.push([out.length ? a : a + Math.max(0, s.start - F), b]); trk.push(tracks?.[i] ?? key); } F += len; });
      // Flex (patch 09): a scene's edit keeps each kept segment's track; its first track is the scene's music key
      return { ...base, name: `${p.name}--${s.id}`, music: { ...(p.music as object), key: tracks ? trk[0] : key, segments: out, ...(tracks ? { tracks: trk } : {}) }, items: s.items, after };
    }
    return { ...base, name: `${p.name}--${s.id}`, music: { ...(typeof p.music === "string" ? {} : p.music), key, from: from0 + s.start }, items: s.items, after };
  }
  return { ...base, name: p.name, music: p.music, items: p.scenes.flatMap((s) => s.items) };
}
