// tour: the member's home, into Settings, a name typed, back home. One take; the film cuts it from "beat-start" (scenes/02-tour.ts),
// so beat n of the metronome is the scene's start + n × 0.625 s (carefree: 96 BPM). Plan each step on a beat of the script.
// Not a test: no assertions. Selectors, seating and data come from the e2e suite; timing comes from the music.
import type { Cam } from "../../../../fancy-e2e-videos/lib/capture.ts";
import { seat } from "flex/personas";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const BPM = 96; // the song's tempo (flex music <dir>)

export const take = "tour"; // the take, the journey (journeys/tour.ts) and its scene share one name

export async function run(c: Cam) {
  const page = c.page;
  // off camera: seat the persona, load the first page and let it settle (warm images, close banners)
  await c.start(`${APP}/`, "body", async (p) => {
    await seat(p, "member");
    await p.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await p.getByRole("heading", { name: /home/i }).first().waitFor({ state: "visible", timeout: 30_000 });
  });
  const settings = page.getByRole("link", { name: "Settings" });
  const name = page.getByLabel("Display name");
  const save = page.getByRole("button", { name: "Save" });
  const home = page.getByRole("link", { name: "Home" });

  await c.view(720, 405, 1);          // the window, edge to edge
  await c.moveTo(settings);           // park on the first click target before the metronome (the first glide eats a beat)
  await c.pause(1200);                // a quiet lead-in

  const b = await c.beat(BPM, "beat-start");   // = the scene's start; every step below lands on a beat
  await b.at(4, "beat-home");                   // a bar on Home
  await b.click(8, settings, "beat-settings");  // the page changes ON beat 8
  await c.focus(name, { kind: "control" });     // the camera moves in on the field
  await b.type(b.next(400, "Ada Lovelace"), "Ada Lovelace", 95, "beat-typed");
  await b.click(b.next(500), save, "beat-saved");
  c.unfocus();
  await b.click(24, home, "beat-back");
  await b.at(32, "beat-end");                   // eight bars from beat-start: the scene's length
}
