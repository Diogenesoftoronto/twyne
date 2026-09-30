import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = `${root}social-preview-video/`;
const socialAssets = `${root}public/assets/social/`;
const scene = `${socialAssets}twyne-writers-desk-seedance-background-v1.mp4`;
if (!existsSync(scene)) {
  throw new Error(
    "Generate the Seedance 2.5 scene first: rtk proxy bun scripts/generate-social-desk-video.ts",
  );
}
const overlay = await readFile(
  `${socialAssets}twyne-writers-desk-overlay.svg`,
  "utf8",
);

await mkdir(`${project}assets`, { recursive: true });
await copyFile(scene, `${project}assets/desk-seedance.mp4`);
await copyFile(
  `${socialAssets}font-licenses.txt`,
  `${project}assets/font-licenses.txt`,
);

// Scene motion comes from fal Seedance 2.5. HyperFrames owns video playback;
// the still card's actual SVG logo and text stay fixed over the footage.
await writeFile(
  `${project}index.html`,
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1200, height=630">
  <title>Twyne · Seedance writer’s desk</title>
  <script src="assets/gsap.min.js"></script>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; background: #faf3df; }
    * { box-sizing: border-box; }
    #root { position: relative; width: 100%; height: 100%; overflow: hidden; }
    .clip { position: absolute; inset: 0; width: 100%; height: 100%; }
    #desk-scene { display: block; object-fit: cover; }
    #branding { z-index: 1; }
    #branding > svg { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="twyne-writers-desk" data-width="1200" data-height="630" data-start="0" data-duration="6">
    <video id="desk-scene" class="clip" src="assets/desk-seedance.mp4" data-start="0" data-duration="6" data-track-index="0" data-track-name="Seedance 2.5 desk scene" muted playsinline preload="auto" aria-label="A sunlit writer’s desk with gently moving coffee steam, flowers and leaf shadows."></video>
    <div id="branding" class="clip" data-start="0" data-duration="6" data-track-index="1" data-track-name="Twyne logo and typography">
      ${overlay}
    </div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines['twyne-writers-desk'] = gsap.timeline({ paused: true });
  </script>
</body>
</html>`,
);

await writeFile(
  `${project}index.motion.json`,
  JSON.stringify(
    {
      duration: 6,
      assertions: [
        { kind: "appearsBy", selector: "#branding", bySec: 0.1 },
        { kind: "staysInFrame", selector: "#branding" },
      ],
    },
    null,
    2,
  ) + "\n",
);

console.log(
  "Built the six-second Seedance scene with the shared logo and text layers.",
);
