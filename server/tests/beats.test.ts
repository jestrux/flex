import { beats, projectBeats } from "../../pipeline/lib/beats.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// run: cd pipeline && npx tsx ../server/tests/beats.test.ts
const B = beats({ bpm: 100, downbeat: 2.31 });
assert.equal(B.bar(6), 14.31); assert.equal(B.beat(25), 17.31); assert.equal(B.at("6.3"), 15.51); assert.equal(B.at("6.3.5"), 15.81);
assert.equal(B.of(15.81).label, "6.3.5"); assert.equal(B.of(14.31).label, "6.1"); assert.equal(B.snap(15.58), 15.51); assert.equal(B.snap(15.4, "bar"), 14.31); assert.equal(B.snap(15.58, "bar"), 16.71);
// every circles cut.ts fbeat(k) = 14.31 + 0.6k is beat(k + 20)
for (const k of [5, 25, 33, 76, 129, 157]) assert.equal(B.beat(k + 20), Math.round((14.31 + 0.6 * k) * 100) / 100);
const dir = mkdtempSync(join(tmpdir(), "beats-"));
writeFileSync(join(dir, "audio.json"), JSON.stringify({ music: { song: { file: "song.mp3", bpm: 100, downbeat: 14.31 } } }));
const P = projectBeats(dir); // any bar's "1" → bar 1 is the first from the start
assert.equal(P.bar(6), 14.31);
console.log("beats ok");
