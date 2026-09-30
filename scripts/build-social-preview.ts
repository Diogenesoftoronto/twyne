import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

// Keep photography, the real logo, and editable typography separate. The same
// SVG overlay powers the local HTML preview and the crawler-ready JPEG export.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}public/assets/social/`;
const width = 1200;
const height = 630;
const videoName = "twyne-writers-desk-seedance-v1.mp4";
const hasVideo = existsSync(`${output}${videoName}`);
const sceneVideoName = "twyne-writers-desk-seedance-background-v1.mp4";
const hasSceneVideo = existsSync(`${output}${sceneVideoName}`);
const copy = {
  wordmark: "TWYNE",
  headline: ["Make room for", "your writing."],
  footer: "twyne.love",
};
const fonts = [
  `${root}src/assets/typst/librebaskerville-LibreBaskerville-Regular.ttf`,
  `${root}src/assets/typst/librebaskerville-LibreBaskerville-Bold.ttf`,
  `${root}src/assets/typst/dmsans-DMSans-Regular.ttf`,
];

const licenses = await Promise.all([
  readFile(`${root}src/assets/typst/librebaskerville-static-OFL.txt`),
  readFile(`${root}src/assets/typst/dmsans-static-OFL.txt`),
]);
await writeFile(
  `${output}font-licenses.txt`,
  Buffer.concat([
    Buffer.from("Libre Baskerville\n\n"),
    licenses[0],
    Buffer.from("\n\nDM Sans\n\n"),
    licenses[1],
  ]),
);

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return escaped[character];
  });
}

const [background, logo, displayRegular, displayBold, sans] = await Promise.all(
  [
    readFile(`${output}twyne-writers-desk-background-v1.jpg`),
    readFile(`${root}public/assets/griffin-mark.svg`),
    ...fonts.map((font) => readFile(font)),
  ],
);

const fontStyle = `<style>
  @font-face { font-family: 'Libre Baskerville'; font-style: normal; font-weight: 400; src: url('data:font/ttf;base64,${displayRegular.toString("base64")}') format('truetype'); }
  @font-face { font-family: 'Libre Baskerville'; font-style: normal; font-weight: 700; src: url('data:font/ttf;base64,${displayBold.toString("base64")}') format('truetype'); }
  @font-face { font-family: 'DM Sans'; font-style: normal; font-weight: 400; src: url('data:font/ttf;base64,${sans.toString("base64")}') format('truetype'); }
</style>`;

const branding = `
  <image x="64" y="162" width="82" height="82" href="data:image/svg+xml;base64,${logo.toString("base64")}"/>
  <text x="158" y="230" font-family="Libre Baskerville" font-weight="700" font-size="61" letter-spacing="0.3" fill="#9f1c1f">${escapeXml(copy.wordmark)}</text>
  <g font-family="Libre Baskerville" font-weight="400" font-size="51" letter-spacing="-1.2" fill="#1f1b16">
    ${copy.headline.map((line, index) => `<text x="68" y="${334 + index * 65}">${escapeXml(line)}</text>`).join("\n    ")}
  </g>
  <text x="68" y="553" font-family="DM Sans" font-size="24" letter-spacing="0.6" fill="#4a3f33">${escapeXml(copy.footer)}</text>`;

const svg = (
  content: string,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="desk-title">
  <title id="desk-title">Twyne — Make room for your writing.</title>
  ${fontStyle}
  ${content}
  ${branding}
</svg>`;

const overlay = svg("");
const composite = svg(
  `<image width="${width}" height="${height}" href="data:image/jpeg;base64,${background.toString("base64")}"/>`,
);
const cardPath = `${output}twyne-writers-desk-v2`;

await writeFile(`${output}twyne-writers-desk-overlay.svg`, overlay);
await writeFile(`${cardPath}.svg`, composite);
await writeFile(
  `${cardPath}.png`,
  new Resvg(composite, {
    font: { fontFiles: fonts, loadSystemFonts: false },
  })
    .render()
    .asPng(),
);
execFileSync("rtk", [
  "proxy",
  "magick",
  `${cardPath}.png`,
  "-strip",
  "-quality",
  "92",
  `${cardPath}.jpg`,
]);

await writeFile(
  `${output}desk-preview.html`,
  `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Twyne · Writer’s desk preview</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: clamp(20px, 4vw, 56px); background: #f4ecd8; color: #1f1b16; font-family: system-ui, sans-serif; }
    main { max-width: 1200px; margin: auto; }
    header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    h1 { margin: 0; font-family: Georgia, serif; font-size: 24px; font-weight: 400; }
    .intro { margin: 8px 0 0; font-size: 14px; color: #4a3f33; line-height: 1.6; }
    button { min-height: 44px; border: 1px solid #9f1c1f; border-radius: 3px; padding: 10px 16px; background: transparent; color: #9f1c1f; font: inherit; cursor: pointer; }
    button[aria-pressed="true"] { background: #9f1c1f; color: #faf3df; }
    a:focus-visible, button:focus-visible { outline: 2px solid #9f1c1f; outline-offset: 4px; }
    .desk { position: relative; aspect-ratio: 1200 / 630; overflow: hidden; background: #faf3df; box-shadow: 0 12px 40px #1f1b1620; }
    .desk > img, .desk > svg, .desk > video { position: absolute; inset: 0; width: 100%; height: 100%; }
    .desk > img, .desk > video { object-fit: cover; }
    nav { display: flex; flex-wrap: wrap; gap: 12px 24px; margin-top: 24px; font-size: 14px; }
    nav a { color: #9f1c1f; text-underline-offset: 4px; padding: 8px 0; }
    .note { margin-top: 20px; max-width: 72ch; font-size: 13px; line-height: 1.6; color: #4a3f33; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>The writer’s desk</h1>
        <p class="intro">The clean desk photograph, Twyne’s griffin, and editable text.</p>
      </div>
      ${hasVideo ? '<button type="button" aria-pressed="false" aria-controls="desk-video">Play desk video</button>' : ""}
    </header>
    <div class="desk" id="desk">
      ${hasVideo ? `<video id="desk-video" src="${videoName}" poster="twyne-writers-desk-v2.jpg" controls loop muted playsinline preload="metadata" aria-label="Twyne writer’s desk, six-second video loop"></video>` : `<img src="twyne-writers-desk-background-v1.jpg" alt="A sunlit writer’s desk with marked-up manuscripts, pens, books, and coffee.">\n      ${overlay}`}
    </div>
    <nav aria-label="Preview assets">
      ${hasVideo ? `<a href="${videoName}">Desk video (MP4)</a>` : ""}
      ${hasSceneVideo ? `<a href="${sceneVideoName}">Scene without logo or text (MP4)</a>` : ""}
      <a href="twyne-writers-desk-v2.jpg">Open Graph image</a>
      <a href="twyne-writers-desk-background-v1.jpg">Clean background</a>
      <a href="twyne-writers-desk-overlay.svg">Logo and text layer</a>
    </nav>
    <p class="note">${hasVideo ? "A six-second scene with natural desk movement and fixed typography. The image and video are served locally." : "The scene video is pending. This is the still artwork, with the logo and text composed separately."}</p>
  </main>
  <script>
    const button = document.querySelector('button');
    const video = document.querySelector('#desk-video');
    if (video && button) {
      const syncButton = () => {
        button.setAttribute('aria-pressed', String(!video.paused));
        button.textContent = video.paused ? 'Play desk video' : 'Pause desk video';
      };
      video.addEventListener('play', syncButton);
      video.addEventListener('pause', syncButton);
      button.addEventListener('click', async () => {
        if (video.paused) {
          try { await video.play(); }
          catch { button.textContent = 'Use the video controls to play'; }
        } else { video.pause(); }
      });
    }
  </script>
</body>
</html>`,
);

console.log(
  "Wrote desk-preview.html, the separate SVG overlay, and v2 JPEG/PNG/SVG exports.",
);
