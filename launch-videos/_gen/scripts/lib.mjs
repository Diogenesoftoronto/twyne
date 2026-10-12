// Shared helpers for the launch-video asset pipeline.
// Keys come from skate at runtime and are never written to disk.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, basename, extname } from "node:path";

const secret = (name) =>
  execSync(`skate get ${name}@secrets`, { encoding: "utf8" }).trim();

let falKey;
const fal = () => (falKey ??= secret("fal_api_key"));
let openaiKey;
const openai = () => (openaiKey ??= secret("openai-api"));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}

export async function download(url, dest) {
  ensureDir(dest);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

/** Upload a local file to fal's CDN and return its public URL. */
export async function falUpload(file) {
  const content_type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const init = await fetch(
    "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: { Authorization: `Key ${fal()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content_type, file_name: basename(file) }),
    },
  );
  if (!init.ok) throw new Error(`fal upload initiate ${init.status}: ${await init.text()}`);
  const { upload_url, file_url } = await init.json();
  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": content_type },
    body: readFileSync(file),
  });
  if (!put.ok) throw new Error(`fal upload PUT ${put.status}: ${await put.text()}`);
  return file_url;
}

/** Submit to the fal queue, poll until done, return the result JSON. */
export async function falRun(endpoint, input, { label = endpoint, pollMs = 5000 } = {}) {
  const headers = { Authorization: `Key ${fal()}`, "Content-Type": "application/json" };
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!submit.ok) throw new Error(`${label}: submit ${submit.status} ${await submit.text()}`);
  const { status_url, response_url, request_id } = await submit.json();
  console.log(`[${label}] queued ${request_id}`);
  const started = Date.now();
  for (;;) {
    await sleep(pollMs);
    const s = await fetch(status_url, { headers });
    const body = await s.json();
    if (body.status === "COMPLETED") break;
    if (body.status === "FAILED" || body.error) {
      throw new Error(`${label}: ${JSON.stringify(body).slice(0, 500)}`);
    }
    if ((Date.now() - started) % 60000 < pollMs) {
      console.log(`[${label}] ${body.status} ${Math.round((Date.now() - started) / 1000)}s`);
    }
  }
  const r = await fetch(response_url, { headers });
  const json = await r.json();
  if (!r.ok || json.detail) throw new Error(`${label}: ${JSON.stringify(json).slice(0, 800)}`);
  console.log(`[${label}] done in ${Math.round((Date.now() - started) / 1000)}s`);
  return json;
}

/** GPT Image 2.5 straight from the OpenAI API. Writes a PNG. */
export async function openaiImage({ prompt, size, out, model = "gpt-image-2.5-sunburst", quality = "high" }) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${openai()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, size, quality, n: 1, output_format: "png" }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`openai image ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 600)}`);
  ensureDir(out);
  writeFileSync(out, Buffer.from(json.data[0].b64_json, "base64"));
  return out;
}

/** Run jobs with bounded concurrency; failures are reported, not fatal. */
export async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        results.push({ item, ok: true, value: await fn(item) });
      } catch (err) {
        console.error(`FAILED ${item.id}: ${err.message}`);
        results.push({ item, ok: false, error: err.message });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export const skip = (file) => {
  if (existsSync(file)) {
    console.log(`skip (exists) ${file}`);
    return true;
  }
  return false;
};
