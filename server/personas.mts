// flex/personas: who a journey sees the app as. The project declares its personas (capture.personas in capture.json or
// project.ts: a command printing that seat's browser cookies as JSON, and optional localStorage), and a journey seats one:
//   import { seat } from "flex/personas";
//   await c.start(url, "body", async (page) => { await seat(page, "manager"); });
// The same personas drive `flex walk`. FLEX_PROJECT (set by Flex's capture) says which project.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Persona = { cookies: string; storage?: Record<string, string>; about?: string };

async function personas(): Promise<Record<string, Persona>> {
  const dir = process.env.FLEX_PROJECT;
  if (!dir) throw new Error("flex/personas: FLEX_PROJECT is not set (run the journey with flex capture)");
  if (existsSync(join(dir, "capture.json"))) return JSON.parse(readFileSync(join(dir, "capture.json"), "utf8")).personas ?? {};
  return (await import(pathToFileURL(join(dir, "project.ts")).href)).capture?.personas ?? {};
}

/** the persona's cookies and storage, in the page's browser context (call it before the first navigation) */
// (any: Playwright's Page, whose addInitScript takes a function, a string or a file; a narrower type rejects it)
export async function seat(page: { context(): { addCookies(c: any[]): Promise<void>; addInitScript(f: any, a?: any): Promise<unknown> } }, name: string) {
  const all = await personas(), p = all[name];
  if (!p) throw new Error(`flex/personas: no persona "${name}" (declared: ${Object.keys(all).join(", ") || "none"})`);
  const r = spawnSync("sh", ["-c", p.cookies], { cwd: process.env.FLEX_PROJECT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`flex/personas: ${name}'s login failed: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  await page.context().addCookies(JSON.parse(r.stdout.trim().split("\n").pop()!));
  if (p.storage) await page.context().addInitScript((kv: Record<string, string>) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, p.storage);
}
