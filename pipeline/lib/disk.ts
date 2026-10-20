// Free disk space before a capture or a render: a full disk otherwise fails mid-way with errors that
// don't say why (a "canceled" download, a bare exit 1, an ffmpeg write error) — and leaves partial files.
import { statfsSync } from "node:fs";

/** stop with a clear message when the volume holding `path` has less than `needGb` free */
//   FANCY_MIN_DISK_GB=<gb> overrides every threshold (e.g. 0.3 for a tiny re-render on a tight disk)
export function needDisk(path: string, needGb: number, what: string) {
  const env = Number(process.env.FANCY_MIN_DISK_GB); if (env > 0) needGb = env;
  let free = Infinity;
  try { const s = statfsSync(path); free = (s.bavail * s.bsize) / 1e9; } catch { return; }
  if (free < needGb) throw new Error(`${what}: only ${free.toFixed(1)} GB free on this disk (needs ≈ ${needGb} GB; your previous film is untouched). Free space first — old takes/ and build/ folders (yours) are the usual culprits; don't delete other people's files.`);
  if (free < needGb * 2) console.warn(`  ! disk: ${free.toFixed(1)} GB free — enough for this ${what}, but tight`);
}
