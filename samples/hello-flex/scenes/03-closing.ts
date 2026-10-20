import { scene } from "../../../../fancy-e2e-videos/lib/project.ts";

export default scene({
  id: "closing",
  start: 6,
  end: 10,
  items: [{ kind: "title", type: "title-closing", params: { title: "That's the whole film", subtitle: "Change this line in scenes/03-closing.ts", cta: "Save to see it" }, dur: 4000 }],
});
