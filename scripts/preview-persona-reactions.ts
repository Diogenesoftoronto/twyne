/** Second motion collection: original engravings staged with code-native motion. */
import sharp from "sharp";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { PERSONAS } from "../src/utils/personas";
import { resolvePersonaPortrait } from "../src/utils/persona-portrait";

const out = new URL("../output/persona-motion/volume-two/", import.meta.url)
  .pathname;
const directions: Record<
  string,
  { color: string; action: string; label: string; cue: string; angle: number }
> = {
  devil: {
    color: "#c1272d",
    action: "questioning",
    label: "Questioning",
    cue: "What would change your mind?",
    angle: -1,
  },
  angel: {
    color: "#8a9a5b",
    action: "agreement",
    label: "Encouraging",
    cue: "Keep this sentence.",
    angle: 1,
  },
  scholar: {
    color: "#5c6bc0",
    action: "checking",
    label: "Checking a source",
    cue: "The date needs a source.",
    angle: 0.7,
  },
  editor: {
    color: "#d4a017",
    action: "revising",
    label: "Marking a revision",
    cue: "Let the verb carry this.",
    angle: -0.6,
  },
  reader: {
    color: "#2c4a7c",
    action: "discovery",
    label: "Following the story",
    cue: "Now I can see the scene.",
    angle: 1.2,
  },
};
const frames = 60,
  durationMs = 4800;
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
await mkdir(out, { recursive: true });
await mkdir(`${out}previews`, { recursive: true });
const assets = [];
for (const persona of PERSONAS) {
  const identity = resolvePersonaPortrait({ personaId: persona.id });
  const f = identity.focus,
    d = directions[persona.id];
  if (!f || !d) continue;
  const uri = `data:image/png;base64,${(
    await sharp(await readFile(`public${identity.src}`))
      .png()
      .toBuffer()
  ).toString("base64")}`;
  for (const state of ["listening", "thinking", d.action]) {
    const key = `${persona.id}-${state}`;
    const folder = `${out}frames-${key}`;
    await mkdir(folder, { recursive: true });
    const label =
      state === "listening"
        ? "Listening"
        : state === "thinking"
          ? "Considering the passage"
          : d.label;
    const cue =
      state === "listening"
        ? "Go on. I’m listening."
        : state === "thinking"
          ? "A moment with the manuscript."
          : d.cue;
    for (let i = 0; i < frames; i++) {
      const p = i / (frames - 1),
        envelope = Math.sin(Math.PI * p) ** 2;
      const nod =
        Math.sin(Math.PI * Math.max(0, Math.min(1, (p - 0.2) / 0.48)) * 2) **
          2 *
        envelope;
      let angle = 0,
        drop = 0,
        scale = 1;
      if (state === "listening") {
        angle = d.angle * 1.4 * envelope;
        scale = 1 + 0.012 * envelope;
        drop = -1.2 * envelope;
      } else if (state === "thinking") {
        angle = -d.angle * 0.65 * envelope;
        drop = 2.4 * envelope;
      } else if (state === "questioning") {
        angle = -2.5 * envelope;
        drop = -1 * envelope;
      } else if (state === "agreement") {
        angle = -0.8 * envelope;
        drop = 4.5 * nod;
      } else if (state === "checking") {
        angle = 1.5 * envelope;
        drop = 3.2 * envelope;
      } else if (state === "revising") {
        angle = 0.8 * envelope;
        drop = 2.2 * nod;
      } else {
        angle = 2.2 * envelope;
        scale = 1 + 0.015 * envelope;
      }
      const art = `<g transform="translate(${f.fx * 480} ${f.fy * 600}) rotate(${angle}) scale(${scale}) translate(${-f.fx * 480} ${-f.fy * 600 + drop})"><image href="${uri}" width="480" height="600"/></g>`;
      const zoom = 2.35,
        size = 148,
        tx = 103 - size * zoom * f.fx,
        ty = 100 - size * zoom * 1.25 * f.fy;
      const page =
        state === "checking" || state === "revising"
          ? `<g transform="translate(131 206)"><rect width="42" height="48" rx="2" fill="#faf8f2" stroke="#8f897f"/><path d="M8 12h26M8 20h26M8 28h20" stroke="#8f897f" stroke-width="1.3"/>${state === "checking" ? `<g transform="translate(${5 + envelope * 9} ${8 + envelope * 7})"><circle cx="12" cy="12" r="8" fill="#faf8f2" fill-opacity=".75" stroke="${d.color}" stroke-width="2"/><path d="m18 18 7 7" stroke="${d.color}" stroke-width="2.5"/></g>` : `<path d="M8 34h${26 * envelope}" stroke="${d.color}" stroke-width="2.2"/>`}</g>`
          : "";
      const rings =
        state === "listening"
          ? `<circle cx="103" cy="100" r="${79 + envelope * 3}" fill="none" stroke="${d.color}" stroke-width="1" opacity="${0.3 + envelope * 0.4}"/>`
          : "";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="320" viewBox="0 0 420 320"><defs><clipPath id="face"><circle cx="103" cy="100" r="74"/></clipPath></defs><rect width="420" height="320" fill="#faf8f2"/>${rings}<circle cx="103" cy="100" r="77" fill="none" stroke="${d.color}" stroke-width="2"/><circle cx="103" cy="100" r="74" fill="${d.color}" fill-opacity=".1"/><g clip-path="url(#face)"><g transform="translate(${tx} ${ty}) scale(${(size * zoom) / 480})">${art}</g></g><g transform="translate(207 10) scale(.4)">${art}</g>${page}<text x="103" y="199" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#59534d">${escape(label)}</text><text x="303" y="264" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#59534d">Full figure</text><text x="18" y="294" font-family="serif" font-size="16" fill="#25211d">${escape(cue)}</text></svg>`;
      await sharp(Buffer.from(svg))
        .png()
        .toFile(`${folder}/${String(i).padStart(3, "0")}.png`);
    }
    const result = spawnSync(
      "magick",
      [
        "-delay",
        "8",
        "-loop",
        "0",
        `${folder}/*.png`,
        "-layers",
        "Optimize",
        `${out}${key}.gif`,
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    const preview = spawnSync(
      "magick",
      [
        `${out}${key}.gif`,
        "-coalesce",
        "-resize",
        "294x224",
        "+dither",
        "-colors",
        "80",
        "-layers",
        "Optimize",
        `${out}previews/${key}.gif`,
      ],
      { encoding: "utf8" },
    );
    if (preview.status !== 0) throw new Error(preview.stderr);
    const metadata = await sharp(`${out}${key}.gif`, {
      animated: true,
    }).metadata();
    if (
      metadata.pages !== frames ||
      metadata.delay?.reduce((a, b) => a + b, 0) !== durationMs
    )
      throw new Error(`Invalid animation ${key}`);
    await sharp(`${folder}/000.png`).png().toFile(`${out}${key}-still.png`);
    await sharp(`${folder}/000.png`)
      .resize(294, 224)
      .png({ palette: true, colours: 80 })
      .toFile(`${out}previews/${key}-still.png`);
    await rm(folder, { recursive: true });
    assets.push({
      key,
      personaId: persona.id,
      name: persona.name,
      state,
      label,
      cue,
      color: d.color,
      gif: `${key}.gif`,
      still: `${key}-still.png`,
      frames,
      durationMs,
    });
    console.log(`Rendered ${key}: ${frames} frames, ${durationMs}ms`);
  }
}
await Bun.write(
  `${out}manifest.json`,
  JSON.stringify(
    {
      note: "Fifteen silent motion studies. Original artwork, illustrative gestures and authored sample cues. Emotion is not inferred or connected to generated replies.",
      assets,
    },
    null,
    2,
  ),
);
