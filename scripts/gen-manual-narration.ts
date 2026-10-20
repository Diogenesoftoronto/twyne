/**
 * Render the manual's chapter narrations (Morgan's story) to audio.
 *
 *   bun scripts/gen-manual-narration.ts            # changed chapters only
 *   bun scripts/gen-manual-narration.ts room house # just these
 *   bun scripts/gen-manual-narration.ts --force    # everything
 *
 * Each paragraph is one Gemini TTS request through fal, in the launch films'
 * narrator voice. Segments are joined with a short pause, loudness-normalised
 * and encoded as mono AAC. The manifest records each chapter's script hash,
 * duration and where each paragraph starts, so the page can follow along and
 * a test can tell when the wording has moved past the audio.
 *
 * The fal key is read from skate by the launch-video helpers; it is never
 * written to disk. Requires ffmpeg and ffprobe.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { download, falRun, pool } from "../launch-videos/_gen/scripts/lib.mjs";
import {
  MANUAL_NARRATION,
  NARRATOR,
  narrationHash,
} from "../src/routes/docs/manual-narration-script";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "public/assets/manual/narration");
const MANIFEST = join(ROOT, "src/routes/docs/manual-narration.generated.json");
const WORK = join(ROOT, "tmp/manual-narration");
const PAUSE_S = 0.8;

export interface NarrationManifestEntry {
  hash: string;
  duration: number;
  /** Start time of each paragraph, in seconds. */
  segments: number[];
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));

const manifest: Record<string, NarrationManifestEntry> = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : {};

const probe = (file: string) =>
  Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8" },
    ).trim(),
  );

const ffmpeg = (...argv: string[]) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...argv]);

const due = Object.entries(MANUAL_NARRATION).filter(([id, chapter]) => {
  if (only.length && !only.includes(id)) return false;
  if (force) return true;
  return (
    manifest[id]?.hash !== narrationHash(chapter) ||
    !existsSync(join(OUT, `${id}.m4a`))
  );
});

if (!due.length) {
  console.log("Every narration matches its script.");
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });

for (const [id, chapter] of due) {
  const dir = join(WORK, id);
  mkdirSync(dir, { recursive: true });
  const parts = chapter.script.map((text, i) => ({
    id: `${id}-${i}`,
    text,
    file: join(dir, `${i}.wav`),
  }));

  const results = await pool(parts, 4, async (part) => {
    const r = await falRun(
      "google/gemini-3.8-flash-tts",
      {
        prompt: part.text,
        voice: NARRATOR.voice,
        style_instructions: NARRATOR.style,
        speakers: null,
        turns: null,
      },
      { label: part.id, pollMs: 2000 },
    );
    return download(r.audio.url, part.file);
  });
  if (results.some((r: { ok: boolean }) => !r.ok)) {
    console.error(`${id}: a segment failed; keeping the previous audio.`);
    continue;
  }

  // Every segment resampled to one format, with a pause after all but the last.
  const normalised = parts.map((part, i) => {
    const file = join(dir, `${i}.norm.wav`);
    const pad = i < parts.length - 1 ? `,apad=pad_dur=${PAUSE_S}` : "";
    ffmpeg(
      "-i",
      part.file,
      "-af",
      `aformat=sample_rates=24000:channel_layouts=mono${pad}`,
      file,
    );
    return file;
  });
  const segments: number[] = [];
  let at = 0;
  for (const file of normalised) {
    segments.push(Math.round(at * 100) / 100);
    at += probe(file);
  }

  const list = join(dir, "list.txt");
  writeFileSync(list, normalised.map((f) => `file '${f}'`).join("\n"));
  const out = join(OUT, `${id}.m4a`);
  ffmpeg(
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-af",
    "loudnorm=I=-18:TP=-1.5:LRA=11",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-c:a",
    "aac",
    "-b:a",
    "48k",
    "-movflags",
    "+faststart",
    out,
  );

  manifest[id] = {
    hash: narrationHash(chapter),
    duration: Math.round(probe(out) * 10) / 10,
    segments,
  };
  // Written after each chapter, so an interrupted run keeps what it finished.
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${id}: ${manifest[id].duration}s`);
}

// The repository checks formatting; keep the manifest in Prettier's shape.
execFileSync("bunx", ["prettier", "--write", MANIFEST], { stdio: "ignore" });
