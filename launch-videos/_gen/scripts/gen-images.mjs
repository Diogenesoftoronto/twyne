// Generate stills with GPT Image 2.5 (OpenAI API). Usage: node gen-images.mjs [id ...]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openaiImage, pool, skip } from "./lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { style, images } = JSON.parse(readFileSync(`${root}prompts/images.json`, "utf8"));
const only = process.argv.slice(2);
const jobs = images.filter((i) => only.length === 0 || only.includes(i.id));

const results = await pool(jobs, 4, async (img) => {
  const out = `${root}images/${img.id}.png`;
  if (skip(out)) return out;
  const prompt = `${img.prompt}\n\n${style}`;
  try {
    await openaiImage({ prompt, size: img.size, out });
  } catch (err) {
    // Fall back to the documented 1536 long-edge sizes if the custom size is refused.
    if (!/size/i.test(err.message)) throw err;
    const [w, h] = img.size.split("x").map(Number);
    const fallback = w > h ? "1536x1024" : w < h ? "1024x1536" : "1024x1024";
    console.log(`[${img.id}] size ${img.size} refused, retrying ${fallback}`);
    await openaiImage({ prompt, size: fallback, out });
  }
  console.log(`wrote ${out}`);
  return out;
});
console.log(`${results.filter((r) => r.ok).length}/${jobs.length} images ok`);
