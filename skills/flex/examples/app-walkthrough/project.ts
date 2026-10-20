// app-walkthrough: a title card, one take of the app on the beat, a closing card. The music is Flex's own "carefree"
// (96 BPM: a beat 0.625 s, a bar 2.5 s, the first beat at 0.597 s), so scenes start on bar lines: bar n = 0.597 + (n − 1) × 2.5.
// A real film reads its own song with `flex music <dir>` and converts with `flex grid <dir> --at 3`.
import { defineProject } from "../../../fancy-e2e-videos/lib/project.ts";
import intro from "./scenes/01-intro.ts";
// import tour from "./scenes/02-tour.ts";   ← add it (and to `scenes`) once `flex capture . tour` has recorded the take:
//                                             a scene can only play a take that exists. Until then the script plans it.
import outro from "./scenes/03-outro.ts";

export default defineProject({
  name: "app-walkthrough",
  feel: "modern",
  music: { key: "carefree" },
  scenes: [intro, outro], // [intro, tour, outro] once the take is captured
});

/** How the takes are recorded (Flex's capture: reference/capture.md). */
export const capture = {
  dpr: 2,
  retime: "clicks" as const, // a click that navigates shows the new page on the next frame (no loading states on film)
  // who the app is seen as: a command printing that user's cookies (scripts/cookies.mjs ports the e2e suite's login)
  personas: {
    member: { cookies: "node scripts/cookies.mjs member", about: "a signed-in member, as the e2e suite's member fixture" },
  },
  // flex walk: every page as each persona, to plan the takes from what is really on screen
  walk: { base: "http://localhost:3000/", seats: { member: ["", "settings"] } },
  journeys: { tour: {} },
  // a journey that changes data declares the state it needs and the scripts that stage it (reference/capture.md)
};
