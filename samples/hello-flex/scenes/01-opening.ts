import { scene } from "../../../../fancy-e2e-videos/lib/project.ts";

export default scene({
  id: "opening",
  start: 0,
  end: 3.5,
  items: [{ kind: "title", type: "title-opening", params: { kicker: "A sample film", title: "Hello, Flex", subtitle: "Edit a scene and watch it change" }, dur: 3500 }],
});
