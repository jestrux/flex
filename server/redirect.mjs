// Registers the import redirect (redirect-hooks.mjs) before anything else loads:
//   tsx --import <support>/server/redirect.mjs serve.mts <project-dir>
// Projects import the pipeline by relative path (../../../../fancy-e2e-videos/lib/look.ts); Flex runs them against its own
// copy (FLEX_PIPELINE), always, even when a fancy-e2e-videos checkout sits where the path points.
import { register } from "node:module";
register("./redirect-hooks.mjs", import.meta.url, { data: { pipeline: process.env.FLEX_PIPELINE } });
