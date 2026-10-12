// Music (Lyria 3.5) and voice (Gemini 3.8 Flash TTS) via fal.
// Usage: node gen-audio.mjs [music|voices] [id ...]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { download, falRun, pool, skip } from "./lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { music, voices } = JSON.parse(readFileSync(`${root}prompts/audio.json`, "utf8"));
const [kind, ...only] = process.argv.slice(2);
const pick = (list) => list.filter((x) => only.length === 0 || only.includes(x.id));

if (!kind || kind === "music") {
  await pool(pick(music), 3, async (m) => {
    const out = `${root}audio/music/${m.id}.mp3`;
    if (skip(out)) return out;
    const r = await falRun("google/lyria-3.5", { prompt: m.prompt }, { label: m.id, pollMs: 4000 });
    return download(r.audio.url, out);
  });
}

if (!kind || kind === "voices") {
  await pool(pick(voices), 6, async (v) => {
    const out = `${root}audio/vo/${v.id}.wav`;
    if (skip(out)) return out;
    const r = await falRun(
      "google/gemini-3.8-flash-tts",
      { prompt: v.text, voice: v.voice, style_instructions: v.style, speakers: null, turns: null },
      { label: v.id, pollMs: 2000 },
    );
    return download(r.audio.url, out);
  });
}
