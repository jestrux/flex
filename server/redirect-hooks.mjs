// The redirect itself (see redirect.mjs): any import whose path runs through a "fancy-e2e-videos" folder resolves into
// Flex's copy of the pipeline instead (same path below that folder). And "flex/personas" resolves to Flex's module.
import { pathToFileURL, fileURLToPath } from "node:url";
import { join } from "node:path";

let PIPE = null;
export function initialize(data) { PIPE = data?.pipeline ?? null; }

const MARK = "/fancy-e2e-videos/";
// Flex's own modules for projects, by a name that doesn't depend on where the project sits: "flex/personas"
const FLEX = { "flex/personas": new URL("./personas.mts", import.meta.url).href };
export async function resolve(specifier, context, next) {
  if (FLEX[specifier]) return next(FLEX[specifier], context);
  if (PIPE && (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:")) && context.parentURL?.startsWith("file:")) {
    let path;
    try { path = specifier.startsWith("file:") ? fileURLToPath(specifier) : specifier.startsWith("/") ? specifier : fileURLToPath(new URL(specifier, context.parentURL)); } catch { path = null; }
    const i = path ? path.lastIndexOf(MARK) : -1;
    if (i >= 0 && !path.startsWith(PIPE)) return next(pathToFileURL(join(PIPE, path.slice(i + MARK.length))).href, context);
  }
  return next(specifier, context);
}
