/** Third collection: editorial action, turn taking, and handing over a note. */
import sharp from "sharp";
import { mkdir, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { PERSONAS } from "../src/utils/personas";
import { resolvePersonaPortrait } from "../src/utils/persona-portrait";

const out = new URL("../output/persona-motion/volume-three/", import.meta.url)
  .pathname;
const frames = 75,
  delay = 8;
type Direction = {
  color: string;
  action: string;
  lines: string[];
  response: string[];
  tilt: number;
};
const directions: Record<string, Direction> = {
  devil: {
    color: "#c1272d",
    action: "Spotting a contradiction",
    lines: ["Everyone agrees.", "Three sources disagree."],
    response: ["Which claim survives", "the counterexample?"],
    tilt: -1.5,
  },
  angel: {
    color: "#8a9a5b",
    action: "Protecting a sentence",
    lines: ["the kettle ticking", "as it cooled"],
    response: ["Keep this detail.", "It carries the scene."],
    tilt: 0.7,
  },
  scholar: {
    color: "#5c6bc0",
    action: "Finding the citation",
    lines: ["A claim from 1949.", "Its source is still due."],
    response: ["Give the date a source.", "Keep the trail visible."],
    tilt: 0.9,
  },
  editor: {
    color: "#d4a017",
    action: "Tightening a passage",
    lines: ["She was very tired.", "She was exhausted."],
    response: ["Choose the precise verb.", "Then stop."],
    tilt: -0.5,
  },
  reader: {
    color: "#2c4a7c",
    action: "Following a scene",
    lines: ["At the station,", "someone was waiting."],
    response: ["Give me one gesture.", "Then I can follow."],
    tilt: 1.3,
  },
};
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => 1 - (1 - clamp(v)) ** 3;
const text = (
  x: number,
  y: number,
  value: string,
  size = 13,
  color = "#25211d",
  other = "",
) =>
  `<text x="${x}" y="${y}" font-family="${size > 12 ? "serif" : "sans-serif"}" font-size="${size}" fill="${color}" ${other}>${esc(value)}</text>`;
await mkdir(`${out}previews`, { recursive: true });
const assets = [];
for (const persona of PERSONAS) {
  const f = resolvePersonaPortrait({ personaId: persona.id }).focus,
    d = directions[persona.id];
  if (!f || !d) continue;
  const uri = `data:image/png;base64,${(
    await sharp(
      await readFile(
        `public${resolvePersonaPortrait({ personaId: persona.id }).src}`,
      ),
    )
      .png()
      .toBuffer()
  ).toString("base64")}`;
  for (const group of ["action", "turn", "handoff"]) {
    const key = `${persona.id}-${group}`;
    const label =
      group === "action"
        ? d.action
        : group === "turn"
          ? "Listening → working → listening"
          : "Passing a note";
    const folder = `${out}frames-${key}`;
    await mkdir(folder, { recursive: true });
    for (let i = 0; i < frames; i++) {
      const p = i / (frames - 1),
        t = p * 6;
      // Return to the exact same pose at the loop boundary.
      const envelope = Math.sin(Math.PI * p) ** 2;
      const working =
        group === "turn"
          ? clamp((t - 1.1) / 0.6) * clamp((4.6 - t) / 0.5)
          : envelope;
      const angle = d.tilt * envelope,
        drop = group === "handoff" ? -1.6 * envelope : 2.5 * working;
      const art = `<g transform="translate(${f.fx * 480} ${f.fy * 600}) rotate(${angle}) translate(${-f.fx * 480} ${-f.fy * 600 + drop})"><image href="${uri}" width="480" height="600"/></g>`;
      const zoom = 2.35,
        size = 132,
        tx = 93 - size * zoom * f.fx,
        ty = 91 - size * zoom * 1.25 * f.fy;
      const reveal = ease((t - (group === "turn" ? 2.2 : 0.9)) / 1.4);
      const vanish = 1 - ease((t - 5.25) / 0.65);
      const mark = reveal * vanish;
      let onPage = "";
      if (persona.id === "devil")
        onPage = `<path d="M12 30h${133 * mark}" stroke="${d.color}" stroke-width="2"/><path d="M165 17v40h-7" stroke="${d.color}" fill="none" opacity="${mark}"/>`;
      if (persona.id === "angel")
        onPage = `<rect x="8" y="14" width="${145 * mark}" height="21" fill="${d.color}" fill-opacity=".17"/><path d="M12 58h${105 * mark}" stroke="${d.color}" stroke-width="2"/>`;
      if (persona.id === "scholar")
        onPage = `<g opacity="${mark}" transform="translate(0 ${6 * (1 - mark)})"><rect x="9" y="65" width="154" height="19" rx="2" fill="${d.color}" fill-opacity=".12"/>${text(16, 78, "[1]  Source · 1949", 11, d.color)}</g>`;
      if (persona.id === "editor")
        onPage = `<path d="M12 23h${140 * mark}" stroke="#c1272d" stroke-width="1.7"/><path d="M12 58h${131 * mark}" stroke="${d.color}" stroke-width="2"/>`;
      if (persona.id === "reader")
        onPage = `<rect x="9" y="40" width="${151 * mark}" height="20" fill="${d.color}" fill-opacity=".13"/><path d="M${12 + 148 * mark} 43v14" stroke="${d.color}" stroke-width="1.6" opacity="${mark}"/>`;
      let card = "";
      if (group === "handoff") {
        const slide = ease((t - 1.1) / 1.25),
          fade = clamp(t / 0.6) * vanish;
        const x = 22 + 100 * (1 - slide),
          y = 193 - 12 * (1 - slide);
        card = `<g transform="translate(${x} ${y}) rotate(${-3 * (1 - slide)} 90 45)" opacity="${fade}"><rect width="186" height="96" rx="3" fill="#fffdf8" stroke="#b8b0a3"/>${text(12, 20, persona.name, 10, d.color)}${text(12, 45, d.response[0], 14)}${text(12, 65, d.response[1], 14)}<path d="M12 80h${145 * reveal}" stroke="${d.color}" stroke-width="1.5"/></g>`;
      } else {
        card = `<g transform="translate(22 190)"><rect width="186" height="100" rx="3" fill="#fffdf8" stroke="#b8b0a3"/>${onPage}${text(12, 28, d.lines[0], 14)}${text(12, 54, d.lines[1], 14)}</g>`;
      }
      const state =
        group === "turn"
          ? t < 1.3
            ? "Listening"
            : t < 2.3
              ? "Considering"
              : t < 4.5
                ? "Making a note"
                : "Your turn"
          : group === "handoff"
            ? t < 1.2
              ? "A note to share"
              : "For your next draft"
            : d.action;
      const hint =
        group === "turn"
          ? t < 1.3
            ? "The writer has the floor."
            : t < 4.5
              ? "A moment at the desk."
              : "Back to the conversation."
          : group === "handoff"
            ? "A note, offered for review."
            : "A mark on the sample passage.";
      const phase = Math.min(3, Math.floor(t / 1.5));
      const dots = [0, 1, 2, 3]
        .map(
          (j) =>
            `<circle cx="${244 + j * 13}" cy="279" r="2" fill="${d.color}" opacity="${phase === j ? 1 : 0.22}"/>`,
        )
        .join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="340" viewBox="0 0 420 340"><defs><clipPath id="face"><circle cx="93" cy="91" r="66"/></clipPath></defs><rect width="420" height="340" fill="#faf8f2"/><circle cx="93" cy="91" r="69" fill="none" stroke="${d.color}" stroke-width="2"/><circle cx="93" cy="91" r="66" fill="${d.color}" fill-opacity=".08"/><g clip-path="url(#face)"><g transform="translate(${tx} ${ty}) scale(${(size * zoom) / 480})">${art}</g></g><g transform="translate(219 4) scale(.375)">${art}</g>${card}${text(22, 174, group === "turn" ? "Taking a turn" : group === "handoff" ? "Offering a note" : "On the page", 11, "#59534d")}${text(231, 250, state, 11, d.color)}${dots}${text(22, 320, hint, 13, "#59534d")}</svg>`;
      await sharp(Buffer.from(svg))
        .png()
        .toFile(`${folder}/${String(i).padStart(3, "0")}.png`);
    }
    const encode = spawnSync(
      "magick",
      [
        "-delay",
        String(delay),
        "-loop",
        "0",
        `${folder}/*.png`,
        "-layers",
        "Optimize",
        `${out}${key}.gif`,
      ],
      { encoding: "utf8" },
    );
    if (encode.status !== 0) throw new Error(encode.stderr);
    const preview = spawnSync(
      "magick",
      [
        `${out}${key}.gif`,
        "-coalesce",
        "-resize",
        "252x204",
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
    // A useful, settled poster, not a blank first frame.
    await sharp(`${folder}/040.png`).png().toFile(`${out}${key}-still.png`);
    await sharp(`${folder}/040.png`)
      .resize(252, 204)
      .png({ palette: true, colours: 80 })
      .toFile(`${out}previews/${key}-still.png`);
    const meta = await sharp(`${out}${key}.gif`, { animated: true }).metadata();
    if (
      meta.pages !== frames ||
      meta.delay?.reduce((a, b) => a + b, 0) !== frames * delay * 10
    )
      throw new Error(`Invalid animation ${key}`);
    await rm(folder, { recursive: true });
    assets.push({
      key,
      personaId: persona.id,
      name: persona.name,
      group,
      label,
      gif: `${key}.gif`,
      still: `${key}-still.png`,
      frames,
      durationMs: frames * delay * 10,
    });
    console.log(`Rendered ${key}: ${frames} frames`);
  }
}
await Bun.write(
  `${out}manifest.json`,
  JSON.stringify(
    {
      note: "Original portrait artwork staged with animated sample editorial marks. Authored excerpts and directions; no model judgement or live document action. Fifteen review assets, not automatically routed in the app.",
      assets,
    },
    null,
    2,
  ),
);
