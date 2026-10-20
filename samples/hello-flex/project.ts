// hello-flex: a ten-second film made only of fancy-e2e-videos' built-in cards, so it can live in
// this repo (the real sample, circles-overview, is product content and stays out of git). Open
// it in Flex to try the app, and the tests use it.
import { defineProject } from "../../../fancy-e2e-videos/lib/project.ts";
import opening from "./scenes/01-opening.ts";
import chapter from "./scenes/02-chapter.ts";
import closing from "./scenes/03-closing.ts";

export default defineProject({
  name: "hello-flex",
  feel: "modern",
  music: { key: "carefree" },
  snap: "off",
  scenes: [opening, chapter, closing],
});
