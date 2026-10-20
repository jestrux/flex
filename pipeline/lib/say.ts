// npm run say "A line." ["Another line." …] [--bars <track>]
// The real voice length of each line (generated once, then cached — the same file capture and
// cards use), so you can fit a card's `say` into its bars before rendering.
import { voiceFor, stopVoice } from "./voice.ts";
import { grid } from "./music.ts";
import { flags } from "./args.ts";
const F = flags("say", ["bars"]), track = F.get("bars") ?? null, lines = F.positional;
if (!lines.length) { console.error('usage: npm run say "A line." [more lines] [--bars <track>]'); process.exit(1); }
const bar = track ? grid(track).bar : 0;
try {
  for (const l of lines) {
    const v = await voiceFor(l);
    // a card needs 0.3 s lead-in + the line + 0.5 s after (+ any transition out) — the sequence's own rule
    const need = 0.3 + v.dur + 0.5;
    console.log(`${v.dur.toFixed(2)}s${bar ? `  · a card needs ${need.toFixed(2)}s = ${Math.ceil(need / bar - 0.02)} bar(s) (+ its transition out); ${(bar / (v.dur / l.split(/\s+/).length)).toFixed(1)} words fit a bar` : ""}  ${l}`);
  }
} finally { stopVoice(); }
process.exit(0);
