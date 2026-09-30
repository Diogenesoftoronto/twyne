import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = `${root}social-preview-video/`;
const source = "public/assets/social/twyne-writers-desk-background-v1.jpg";
const output =
  "public/assets/social/twyne-writers-desk-seedance-background-v1.mp4";
const jobPath = `${project}seedance-job-v1.json`;
const model = "bytedance/seedance-2.5/image-to-video";
const prompt = `One continuous six-second photorealistic shot of this exact warm, sunlit writer's desk. The overhead camera is completely locked in place throughout: identical framing, perspective and scale, no pan, zoom, dolly, rotation or camera shake. Animate the physical scene with delicate, clearly visible wisps of steam curling upward from the coffee on the right; the white flower sprigs gently sway a few millimetres in a light breeze; soft leaf shadows on the ivory paper slowly flutter and return to their opening position. Preserve the desk, manuscript stacks, books, fountain pen, red pencil, cup and all other objects exactly in place with stable shapes and textures. The broad ivory paper area on the left stays empty, calm and unobstructed for typography to be added separately. Keep the existing warm afternoon light and editorial photographic realism. No hands or people, no new objects, no logos, captions or added lettering, no cuts or transitions. Natural quiet ambient movement in the objects and shadows, not movement of a still photograph. Return smoothly to the supplied ending frame for a gentle repeating scene.`;
const settings = {
  prompt,
  resolution: "720p",
  duration: "6",
  aspect_ratio: "auto",
  generate_audio: false,
  bitrate_mode: "high",
  codec: "H264",
};

interface Job {
  provider: "fal";
  model: string;
  source: string;
  source_sha256: string;
  output: string;
  input: typeof settings & { end_frame: "same-as-start" };
  created_at: string;
  status: string;
  request_id?: string;
  status_url?: string;
  response_url?: string;
  completed_at?: string;
  seed?: number;
  video?: { url: string; content_type?: string; file_size?: number };
  downloaded_bytes?: number;
  submission_http_status?: number;
  submission_error?: string;
}

await mkdir(project, { recursive: true });
const image = await readFile(`${root}${source}`);
const imageHash = createHash("sha256").update(image).digest("hex");
let job: Job;
let loadedCredential: string | undefined;

async function saveJob() {
  await writeFile(`${jobPath}.partial`, JSON.stringify(job, null, 2) + "\n");
  await rename(`${jobPath}.partial`, jobPath);
}

function credential(): string {
  if (process.env.FAL_KEY?.trim()) return process.env.FAL_KEY.trim();
  try {
    const value = execFileSync(
      "rtk",
      ["proxy", "skate", "get", "fal_api_key@secrets"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (value) return value;
  } catch {
    // Never include captured credential output in an exception or log.
  }
  throw new Error("The existing fal credential could not be read.");
}

if (existsSync(jobPath)) {
  job = JSON.parse(await readFile(jobPath, "utf8")) as Job;
  if (job.model !== model || job.source_sha256 !== imageHash) {
    throw new Error(
      "The saved job belongs to a different model or source image.",
    );
  }
  if (job.status === "DOWNLOADED" && existsSync(`${root}${output}`)) {
    console.log(`Existing Seedance 2.5 scene: ${output}`);
    process.exit(0);
  }
  if (!job.request_id && job.status !== "SUBMISSION_REJECTED") {
    throw new Error(
      "A submission is already recorded without a confirmed request ID. Inspect it before submitting again.",
    );
  }
} else {
  loadedCredential = credential();
  job = {
    provider: "fal",
    model,
    source,
    source_sha256: imageHash,
    output,
    input: { ...settings, end_frame: "same-as-start" },
    created_at: new Date().toISOString(),
    status: "SUBMITTING",
  };
  // Persist before submitting so an interrupted run cannot silently charge twice.
  await saveJob();
}

const key = loadedCredential ?? credential();
async function queueRequest(url: string, body?: unknown) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== "queue.fal.run") {
    throw new Error("Unexpected fal queue URL.");
  }
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const detail = (await response.text())
      .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[image omitted]")
      .slice(0, 1000);
    if (body && [400, 401, 403, 404, 422].includes(response.status)) {
      job.status = "SUBMISSION_REJECTED";
      job.submission_http_status = response.status;
      job.submission_error = detail;
      await saveJob();
    }
    throw new Error(`fal returned HTTP ${response.status}: ${detail}`);
  }
  return response.json();
}

if (!job.request_id) {
  job.status = "SUBMITTING";
  delete job.submission_http_status;
  delete job.submission_error;
  await saveJob();
  const imageUrl = `data:image/jpeg;base64,${image.toString("base64")}`;
  const submitted = await queueRequest(`https://queue.fal.run/${model}`, {
    ...settings,
    image_url: imageUrl,
    end_image_url: imageUrl,
  });
  job.request_id = submitted.request_id;
  job.status_url = submitted.status_url;
  job.response_url = submitted.response_url;
  job.status = submitted.status ?? "IN_QUEUE";
  await saveJob();
  console.log(`Submitted Seedance 2.5 desk scene: ${job.request_id}`);
} else {
  console.log(`Resuming Seedance 2.5 desk scene: ${job.request_id}`);
}

if (!job.status_url || !job.response_url) {
  throw new Error("The saved fal request is missing its polling URLs.");
}
const deadline = Date.now() + 15 * 60_000;
let lastPrinted = "";
while (!job.video) {
  const update = await queueRequest(job.status_url);
  job.status = update.status;
  await saveJob();
  if (job.status !== lastPrinted) {
    console.log(`Seedance 2.5: ${job.status}`);
    lastPrinted = job.status;
  }
  if (job.status === "FAILED" || update.error) {
    throw new Error(
      "fal reported a failed generation; the saved request was retained.",
    );
  }
  if (job.status === "COMPLETED") {
    const result = await queueRequest(job.response_url);
    if (!result.video?.url) throw new Error("fal returned no video URL.");
    job.video = result.video;
    job.seed = result.seed;
    job.completed_at = new Date().toISOString();
    await saveJob();
    break;
  }
  if (Date.now() >= deadline) {
    throw new Error(
      "Generation is still pending. Run this script again to resume the saved request.",
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

const videoUrl = new URL(job.video!.url);
if (videoUrl.protocol !== "https:")
  throw new Error("Unexpected video download URL.");
const response = await fetch(videoUrl, {
  signal: AbortSignal.timeout(120_000),
});
if (!response.ok)
  throw new Error(`Video download returned HTTP ${response.status}.`);
const video = Buffer.from(await response.arrayBuffer());
await writeFile(`${root}${output}.partial`, video);
await rename(`${root}${output}.partial`, `${root}${output}`);
job.downloaded_bytes = video.byteLength;
job.status = "DOWNLOADED";
await saveJob();
console.log(`Saved ${video.byteLength} bytes to ${output}`);
