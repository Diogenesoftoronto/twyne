// Word-level timings for every VO line via forced alignment against the known script.
// Writes audio/words/<id>.json as [{ text, start, end }].
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { falRun, falUpload, pool, skip } from "./lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { voices } = JSON.parse(readFileSync(`${root}prompts/audio.json`, "utf8"));
mkdirSync(`${root}audio/words`, { recursive: true });

await pool(voices, 6, async (v) => {
  const out = `${root}audio/words/${v.id}.json`;
  if (skip(out)) return out;
  const audio_url = await falUpload(`${root}audio/vo/${v.id}.wav`);
  const r = await falRun("fal-ai/elevenlabs/forced-alignment", { audio_url, text: v.text }, { label: v.id, pollMs: 1500 });
  const words = (r.words ?? []).map((w) => ({
    text: w.text,
    start: +w.start.toFixed(3),
    end: +w.end.toFixed(3),
  })).filter((w) => w.text.trim());
  writeFileSync(out, JSON.stringify(words, null, 1));
  return out;
});
