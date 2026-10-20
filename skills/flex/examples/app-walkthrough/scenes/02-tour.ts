import { scene } from "../../../../fancy-e2e-videos/lib/project.ts";

// bars 3–10: the take from its metronome mark, so the journey's beat n lands on the film's beat (32 beats = 20 s)
export default scene({
  id: "tour",
  start: 5.597,
  end: 25.597,
  items: [{ kind: "take", take: "tour", from: "beat-start", to: "beat-start+20s" }],
});
