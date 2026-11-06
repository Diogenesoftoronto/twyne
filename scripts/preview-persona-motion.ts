/** Offline animation study using the resident artwork; no provider calls. */
import sharp from "sharp";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { PERSONAS } from "../src/utils/personas";
import { resolvePersonaPortrait } from "../src/utils/persona-portrait";

const out = new URL("../output/persona-motion/", import.meta.url).pathname;
const colors = ["#c1272d", "#8a9a5b", "#5c6bc0", "#d4a017", "#2c4a7c"];
const cues = [
  ["Objection.", "What supports that claim?", "A question, held."],
  [
    "Here. This sentence has a pulse.",
    "Keep this one.",
    "A small, encouraging nod.",
  ],
  [
    "One notes a distinction.",
    "What is asserted? What is shown?",
    "A measured pause.",
  ],
  ["Cut the qualifier.", "Let the verb do the work.", "A decisive stop."],
  ["I can picture the platform.", "But who is waiting?", "A curious tilt."],
];
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const fps = 16;
const frames = 96;
await mkdir(out, { recursive: true });
const manifest = [];

for (const [index, persona] of PERSONAS.entries()) {
  const identity = resolvePersonaPortrait({ personaId: persona.id });
  const f = identity.focus!;
  const png = await sharp(await readFile(`public${identity.src}`))
    .png()
    .toBuffer();
  const uri = `data:image/png;base64,${png.toString("base64")}`;
  const frameDir = `${out}frames-${persona.id}`;
  await mkdir(frameDir, { recursive: true });
  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    const active = (t > 0.2 && t < 1.7) || (t > 2.05 && t < 4.25);
    const envelope = active
      ? Math.min(
          1,
          (t < 1.7 ? 1.7 - t : 4.25 - t) * 6,
          (t < 1.7 ? t - 0.2 : t - 2.05) * 6,
        )
      : 0;
    const level = Math.max(
      0,
      envelope *
        (0.18 + 0.82 * Math.pow(Math.abs(Math.sin(t * 12.7 + index)), 1.6)),
    );
    const gesture = Math.sin(Math.PI * Math.min(t / 6, 1)) ** 2;
    const angle = [1.1, -0.8, 0.45, -0.3, 1.4][index] * gesture;
    const drop = [0.2, 1.5, 0.65, 0.3, 0.4][index] * gesture;
    const mx = f.mx * 480,
      my = f.my * 600,
      mw = f.mw * 480;
    const slope = Math.tan((f.tilt * Math.PI) / 180);
    const y0 = my - mx * slope,
      y1 = my + (480 - mx) * slope;
    const jaw = level * 6.6;
    const art = `<g transform="rotate(${angle} ${f.fx * 480} ${f.fy * 600}) translate(0 ${drop})">
      <image href="${uri}" width="480" height="600"/>
      <ellipse cx="${mx}" cy="${my + jaw * 0.45}" rx="${mw * 0.31}" ry="${jaw * 0.6}" fill="#3d1814" transform="rotate(${f.tilt} ${mx} ${my})"/>
      <g clip-path="url(#jaw)" mask="url(#feather)"><image href="${uri}" y="${jaw}" width="480" height="600"/></g>
    </g>`;
    const phase = t < 1.9 ? 0 : t < 4.45 ? 1 : 2;
    const zoom = 2.35,
      size = 148;
    const tx = 103 - size * zoom * f.fx;
    const ty = 100 - size * zoom * 1.25 * f.fy;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="320" viewBox="0 0 420 320">
      <defs>
        <clipPath id="face"><circle cx="103" cy="100" r="74"/></clipPath>
        <clipPath id="jaw"><path d="M0 ${y0}L480 ${y1}V600H0Z"/></clipPath>
        <radialGradient id="soft"><stop offset="55%" stop-color="white"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient>
        <mask id="feather" maskUnits="userSpaceOnUse" x="0" y="0" width="480" height="600"><ellipse cx="${mx}" cy="${my + 18}" rx="${mw * 1.85}" ry="54" fill="url(#soft)"/></mask>
      </defs>
      <rect width="420" height="320" fill="#faf8f2"/>
      <circle cx="103" cy="100" r="77" fill="none" stroke="${colors[index]}" stroke-width="2"/>
      <circle cx="103" cy="100" r="74" fill="${colors[index]}" fill-opacity="0.1"/>
      <g clip-path="url(#face)"><g transform="translate(${tx} ${ty}) scale(${(size * zoom) / 480})">${art}</g></g>
      <g transform="translate(207 10) scale(0.4)">${art}</g>
      <text x="103" y="199" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#59534d">Voice portrait · 148px</text>
      <text x="303" y="264" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#59534d">Full figure</text>
      <text x="18" y="294" font-family="serif" font-size="16" fill="#25211d">${escape(cues[index][phase])}</text>
      <rect x="18" y="310" width="${(384 * (i + 1)) / frames}" height="2" fill="${colors[index]}"/>
    </svg>`;
    await sharp(Buffer.from(svg))
      .png()
      .toFile(`${frameDir}/${String(i).padStart(3, "0")}.png`);
  }
  const result = spawnSync(
    "magick",
    [
      "-delay",
      "6",
      "-loop",
      "0",
      `${frameDir}/*.png`,
      "-layers",
      "Optimize",
      `${out}${persona.id}-speaking.gif`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  await sharp(`${frameDir}/000.png`)
    .png()
    .toFile(`${out}${persona.id}-still.png`);
  await rm(frameDir, { recursive: true });
  manifest.push({
    id: persona.id,
    name: persona.name,
    role: persona.role,
    gif: `${persona.id}-speaking.gif`,
    still: `${persona.id}-still.png`,
    cues: cues[index],
    color: colors[index],
    frames,
    durationMs: frames * 60,
  });
  console.log(`Rendered ${persona.name}: ${frames} frames`);
}
await Bun.write(
  `${out}manifest.json`,
  JSON.stringify(
    {
      note: "Silent motion studies with authored sample lines. Syllable rhythm and gestures are illustrative, not audio or semantic alignment. Original artwork retained. Not wired into live speech.",
      personas: manifest,
    },
    null,
    2,
  ),
);
