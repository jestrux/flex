// Narration TTS, cached by text hash. OpenAI (gpt-4o-mini-tts, PCM → WAV) when
// OPENAI_API_KEY is set, else local Kokoro (am_michael). Each line becomes
// .cache/voice/<hash>.wav; `voiceFor(text)` resolves to { file, dur } (seconds).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import "dotenv/config";

const ROOT = join(import.meta.dirname, "..");
const CACHE = process.env.FLEX_VOICE_CACHE ?? join(ROOT, ".cache", "voice"); // Flex: its own voice cache
mkdirSync(CACHE, { recursive: true });

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const VOICE = process.env.VOICE ?? "ash";
const STYLE = process.env.VOICE_STYLE ??
  "Warm, confident product-film narrator. Clear and unhurried, friendly, a light smile in the voice. Natural pauses at commas.";
export const ENGINE = OPENAI_KEY ? `OpenAI gpt-4o-mini-tts (${VOICE})` : "Kokoro (am_michael)";

const key = (text: string) => createHash("sha1").update(`${ENGINE}|${STYLE}|${text}`).digest("hex").slice(0, 16);

// WAV header for 16-bit mono PCM
function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
const wavDur = (file: string) => { const b = readFileSync(file); return b.readUInt32LE(40) / b.readUInt32LE(28); };

// network blips (fetch failed / 5xx) are retried with backoff — falling back to Kokoro would give one
// line a different voice mid-film, which is worse than waiting
async function openai(text: string, out: string) {
  const waits = [2000, 5000, 12000, 25000];
  for (let i = 0; ; i++) {
    try { return await openaiOnce(text, out); }
    catch (e) {
      const msg = String((e as Error).message ?? e), transient = /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket| 5\d\d:| 429:/.test(msg);
      if (!transient || i >= waits.length) throw new Error(`${msg}${transient ? ` — gave up after ${i + 1} tries (network). Re-run when it's back; finished lines are cached.` : ""}`);
      console.warn(`  ! voice: ${msg.slice(0, 80)} — retrying in ${waits[i] / 1000}s`);
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}
async function openaiOnce(text: string, out: string) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: VOICE, input: text, instructions: STYLE, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
  writeFileSync(out, wav(Buffer.from(await res.arrayBuffer()), 24000));
}

// one long-lived Kokoro process (model load is the slow part)
let kokoro: ChildProcessWithoutNullStreams | null = null;
const waiting = new Map<string, () => void>();
function kokoroSay(text: string, out: string): Promise<void> {
  if (!kokoro) {
    const dir = join(homedir(), ".kokoro");
    kokoro = spawn("python3", ["-u", "-c", `
import sys, json, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("${dir}/kokoro-v1.0.onnx", "${dir}/voices-v1.0.bin")
for line in sys.stdin:
    j = json.loads(line); s, sr = k.create(j["text"], voice="am_michael", speed=1.0, lang="en-us")
    sf.write(j["out"], s, sr, subtype="PCM_16"); print(j["out"], flush=True)
`]);
    let buf = "";
    kokoro.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const p = buf.slice(0, i); buf = buf.slice(i + 1); waiting.get(p)?.(); waiting.delete(p); } });
    kokoro.stderr.on("data", () => {});
  }
  return new Promise((r) => { waiting.set(out, r); kokoro!.stdin.write(JSON.stringify({ text, out }) + "\n"); });
}

export async function voiceFor(text: string): Promise<{ file: string; dur: number }> {
  const file = join(CACHE, `${key(text)}.wav`);
  if (!existsSync(file) || statSync(file).size < 100) await (OPENAI_KEY ? openai(text, file) : kokoroSay(text, file));
  return { file, dur: wavDur(file) };
}
export function stopVoice() { kokoro?.kill(); kokoro = null; }
