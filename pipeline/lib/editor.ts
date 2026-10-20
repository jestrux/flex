// Zoom editor: a local page to scrub a take, see each zoom as a block on the timeline, and
// drag / retime / rescale / toggle / delete / add zooms. The preview runs the same camera
// function the renderer uses on the raw frames, so what you see is what renders.
// Save writes edl.json (locked, so `plan` won't overwrite it); Render re-renders + rebuilds.
//
//   npx tsx lib/editor.ts <take>   → http://localhost:5299
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
import { buildSync } from "esbuild";
import { finalPath } from "./build.ts";

const take = process.argv[2] ?? "studio-social";
const ROOT = join(import.meta.dirname, "..");
const DIR = join(process.env.FLEX_TAKES ?? join(ROOT, "takes"), take);
const PORT = Number(process.env.PORT ?? 5299);
// camera + canvas helpers, bundled for the browser (camera imports canvas)
const cameraJs = () => buildSync({ stdin: { contents: `export { makeCamera } from "./camera.ts"; export { BACKGROUNDS, DEFAULT_CANVAS, backgroundOf, backgroundSvg, worldOf } from "./canvas.ts";`, resolveDir: join(ROOT, "lib"), loader: "ts" }, bundle: true, format: "esm", write: false }).outputFiles[0].text;
// the effect modules + composer, bundled for the browser (rebuilt per request so edits show up)
const effectsJs = () => buildSync({ entryPoints: [join(ROOT, "lib", "effects", "compose.ts")], bundle: true, format: "esm", write: false, platform: "browser" }).outputFiles[0].text;
const registryJs = () => buildSync({ stdin: { contents: `import { EFFECTS } from "./index.ts"; export const TYPES = Object.values(EFFECTS).map(m => ({ type: m.type, label: m.label, defaults: m.defaults, hold: m.hold, exit: m.exit }));`, resolveDir: join(ROOT, "lib", "effects"), loader: "ts" }, bundle: true, format: "esm", write: false }).outputFiles[0].text;
let job: { log: string; done: boolean } = { log: "", done: true };

createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  const send = (body: string | Buffer, type = "text/plain") => { res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
  if (url.pathname === "/") return send(readFileSync(join(ROOT, "lib", "editor.html")), "text/html");
  if (url.pathname === "/camera.js") return send(cameraJs(), "text/javascript");
  if (url.pathname === "/effects.js") return send(effectsJs(), "text/javascript");
  if (url.pathname === "/registry.js") return send(registryJs(), "text/javascript");
  if (url.pathname === "/events.json") return send(readFileSync(join(DIR, "events.json")), "application/json");
  if (url.pathname === "/edl.json" && req.method === "GET") return send(readFileSync(join(DIR, "edl.json")), "application/json");
  if (url.pathname === "/edl.json" && req.method === "POST") {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { const e = JSON.parse(b); e.locked = true; writeFileSync(join(DIR, "edl.json"), JSON.stringify(e, null, 1)); send("saved"); });
    return;
  }
  if (url.pathname === "/render" && req.method === "POST") {
    if (!job.done) return send("busy");
    job = { log: "", done: false };
    const p = spawn("sh", ["-c", `npx tsx lib/render.ts ${take} && npx tsx lib/build.ts ${take}`], { cwd: ROOT });
    p.stdout.on("data", (d) => (job.log += d)); p.stderr.on("data", (d) => (job.log += d));
    p.on("close", (code) => { job.done = true; job.log += `\n[exit ${code}]`; });
    return send("started");
  }
  if (url.pathname === "/job") return send(JSON.stringify(job), "application/json");
  const file = url.pathname.startsWith("/frames/") ? join(DIR, url.pathname) : url.pathname === "/final.mp4" ? finalPath(take) : null;
  if (file && existsSync(file)) {
    const type = extname(file) === ".mp4" ? "video/mp4" : "image/jpeg";
    const size = statSync(file).size, range = req.headers.range;
    if (range && type === "video/mp4") {
      const [a, b] = range.replace("bytes=", "").split("-"); const s = Number(a), e = b ? Number(b) : size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${s}-${e}/${size}`, "Accept-Ranges": "bytes", "Content-Length": e - s + 1 });
      return createReadStream(file, { start: s, end: e }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Cache-Control": "max-age=3600" });
    return createReadStream(file).pipe(res);
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`zoom editor for "${take}" → http://localhost:${PORT}`));
