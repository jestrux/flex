// npx tsx lib/capture-run.ts <journey> [--dry [--shots]]   (journeys/<journey>.ts exports { take, run })
//   …or <project>/<journey> for a project's own journeys: projects/<project>/journeys/<journey>.ts
// A real capture re-plans the zooms afterwards (edl.json), unless the edl is locked.
// --dry: rehearse in a fresh browser, no recording; real voice timing; a missing element stops the
//        run; screenshots per mark (and after every click with --shots) → build/dry/<take>/
import { recap } from "./warn-recap.ts";
import { capture } from "./capture.ts";
import { planTake } from "./plan.ts";
import { flags } from "./args.ts";
const name = process.argv[2] ?? "studio-social";
const [proj, pj] = name.includes("/") ? name.split("/") : [null, null];
const j = await import(proj ? `../projects/${proj}/journeys/${pj}.ts` : `../journeys/${name}.ts`);
const F = flags("capture", [], ["dry", "shots"]), dry = F.has("dry");
// Flex (patch 22): a journey may record in a device (`export const device = "iphone"`) on a fixed day (`export const clock`)
await capture(j.take, j.run, { dry, shots: F.has("shots"), device: j.device, clock: j.clock });
if (!dry && !j.device) planTake(j.take); // a phone take has no zoom plan: the phone layer frames it whole
recap(dry ? "dry run" : "capture");
process.exit(0);
