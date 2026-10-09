import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

// Select a reviewed passing run explicitly; never silently publish the latest run.
const [stillsArgument, demoArgument] = process.argv.slice(2);
if (!stillsArgument || !demoArgument) {
  throw new Error(
    "Usage: bun scripts/prepare-instrument-media.ts <passing-walkthrough-directory> <passing-demo-directory>",
  );
}
const stills = resolve(stillsArgument);
const demo = resolve(demoArgument);
for (const directory of [stills, demo]) {
  const run = JSON.parse(
    await readFile(join(dirname(directory), ".last-run.json"), "utf8"),
  );
  if (run.status !== "passed")
    throw new Error(`Choose a passing run: ${directory}`);
}
const names = ["01-complete-wording-preview", "02-wording-used"];
const output = "public/assets/manual";
await mkdir(`${output}/writing-instruments`, { recursive: true });
const ffmpeg = (args: string[]) =>
  execFileSync(
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" },
  );
const sha = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const relativePath = (file: string) => relative(process.cwd(), file);
const images = [];
for (const name of names) {
  const source = join(stills, `${name}.png`);
  const target = `${output}/writing-instruments/${name}.webp`;
  ffmpeg(["-i", source, "-c:v", "libwebp", "-lossless", "1", target]);
  images.push({
    file: relativePath(resolve(target)),
    source: relativePath(source),
    sourceSha256: await sha(source),
    sha256: await sha(target),
    width: 1440,
    height: 900,
  });
}
const source = join(demo, "instruments-master.webm");
const timing = JSON.parse(
  await readFile(join(demo, "instruments-cues.json"), "utf8"),
) as { cues: { at: number; description: string }[] };
const probe = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=width,height",
      "-of",
      "json",
      source,
    ],
    { encoding: "utf8" },
  ),
);
if (probe.streams[0]?.width !== 1440 || probe.streams[0]?.height !== 900)
  throw new Error("Expected a 1440 × 900 source recording.");
// Omit only setup/loading. Keep one continuous range at the original speed.
const start = timing.cues[0].at;
const end = Number(probe.format.duration);
const duration = end - start;
if (!(duration > 5)) throw new Error("Recording or cue times are incomplete.");
const movie = `${output}/writing-instruments.mp4`;
const encode = [
  "-ss",
  String(start),
  "-i",
  source,
  "-t",
  String(duration),
  "-an",
  "-r",
  "25",
  "-c:v",
  "libx264",
  "-threads",
  "4",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-map_metadata",
  "-1",
  "-movflags",
  "+faststart",
  movie,
];
ffmpeg(encode);
ffmpeg([
  "-i",
  join(stills, "01-complete-wording-preview.png"),
  "-frames:v",
  "1",
  "-q:v",
  "2",
  `${output}/writing-instruments.jpg`,
]);
ffmpeg(["-i", movie, "-f", "null", "-"]);
const stamp = (seconds: number) =>
  new Date(Math.round(Math.max(0, seconds) * 1000)).toISOString().slice(11, 23);
const cues = timing.cues.map((cue, index) => ({
  start: Math.max(0, cue.at - start),
  end: Math.min(duration, (timing.cues[index + 1]?.at ?? end) - start),
  description: cue.description,
}));
await writeFile(
  `${output}/writing-instruments.vtt`,
  "WEBVTT\n\n" +
    cues
      .map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.description}\n`)
      .join("\n"),
);
await writeFile(
  `${output}/writing-instruments.txt`,
  "Silent local walkthrough with a fictional manuscript. Descriptive captions, no spoken dialogue.\n\n" +
    cues.map((c) => `${stamp(c.start)} ${c.description}`).join("\n") +
    "\n",
);
const manifest = {
  capturedAt: new Date().toISOString(),
  sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  sourceHadLocalChanges:
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
      .length > 0,
  sample: "Fictional manuscript from e2e/fixtures/instruments.ts",
  models: "None. Actual local rules, editor transactions and undo.",
  verification:
    "Source tests passed; inspect these selected images and the encoded clip before deploying.",
  images,
  video: {
    file: movie,
    source: relativePath(source),
    sourceSha256: await sha(source),
    sha256: await sha(movie),
    width: 1440,
    height: 900,
    sourceRange: { start, end },
    duration,
    speed: 1,
    audio: "none",
    captions: "Descriptive actions",
    cues,
    encodingArguments: encode.map((a) =>
      a === source ? relativePath(source) : a,
    ),
  },
};
await writeFile(
  `${output}/writing-instruments/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Prepared two stills and a ${duration.toFixed(2)} second clip. Originals remain in their test runs.`,
);
