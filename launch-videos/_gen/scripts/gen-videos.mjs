// Animate stills with Seedance 2.5 image-to-video via fal. Usage: node gen-videos.mjs [id ...]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "/home/diogenes/Projects/twyne/node_modules/sharp/lib/index.js";
import { download, falRun, falUpload, pool, skip } from "./lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const { suffix, videos } = JSON.parse(readFileSync(`${root}prompts/videos.json`, "utf8"));
const only = process.argv.slice(2);
const jobs = videos.filter((v) => only.length === 0 || only.includes(v.id));

async function imageUrl(id) {
  // A high-quality JPEG keeps uploads small without visible loss at 1080p.
  const jpg = `${root}images/.${id}.jpg`;
  await sharp(`${root}images/${id}.png`).jpeg({ quality: 92 }).toFile(jpg);
  try {
    return await falUpload(jpg);
  } catch (err) {
    console.log(`[${id}] CDN upload failed (${err.message.slice(0, 120)}); using data URI`);
    return `data:image/jpeg;base64,${readFileSync(jpg).toString("base64")}`;
  }
}

const results = await pool(jobs, 5, async (v) => {
  const out = `${root}video/${v.id}.mp4`;
  if (skip(out)) return out;
  const r = await falRun(
    "bytedance/seedance-2.5/image-to-video",
    {
      prompt: `${v.prompt} ${suffix}`,
      image_url: await imageUrl(v.image),
      resolution: v.resolution,
      duration: v.duration,
      generate_audio: true,
      bitrate_mode: "high",
      codec: "H264",
    },
    { label: v.id, pollMs: 10000 },
  );
  await download(r.video.url, out);
  console.log(`wrote ${out}`);
  return out;
});
console.log(`${results.filter((r) => r.ok).length}/${jobs.length} videos ok`);
