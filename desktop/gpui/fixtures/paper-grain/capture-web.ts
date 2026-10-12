// Execute the original theme helpers and CSS. Verification only; no runtime browser.
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeThemePreference,
  resolvedThemeTokens,
} from "../../../../src/utils/theme";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const css = await Bun.file(`${root}/src/global.css`).text();
const stylesheet = css
  .replace('@import "tailwindcss";', "")
  .replace(/^@source[^;]+;/m, "")
  .replace("@theme {", ":root {");
const build = await Bun.build({
  entrypoints: [`${root}/src/utils/theme.ts`],
  target: "browser",
  format: "esm",
});
if (!build.success) throw new Error(String(build.logs));
const bundle = Buffer.from(await build.outputs[0].text()).toString("base64");
const cases = [
  { id: "editorial", preference: { preset: "editorial" } },
  { id: "foolscap", preference: { preset: "foolscap" } },
  { id: "broadsheet", preference: { preset: "broadsheet" } },
  { id: "nightpress", preference: { preset: "nightpress" } },
  { id: "system-light", preference: { preset: "system" }, prefersDark: false },
  { id: "system-dark", preference: { preset: "system" }, prefersDark: true },
  {
    id: "editorial-custom",
    preference: {
      preset: "editorial",
      custom: { ink: "#592c7d", paper: "#ede2f0" },
    },
  },
  {
    id: "nightpress-custom",
    preference: {
      preset: "nightpress",
      custom: { ink: "#04ba8f", paper: "#48434c" },
    },
  },
  {
    id: "broadsheet-custom",
    preference: {
      preset: "broadsheet",
      custom: { ink: "#04ba8f", paper: "#aab3cc" },
    },
  },
  {
    id: "foolscap-custom",
    preference: {
      preset: "foolscap",
      custom: { ink: "#ffffff", paper: "#020304" },
    },
  },
  {
    id: "normalized",
    preference: {
      preset: "missing",
      custom: {
        ink: "#abc",
        paper: "invalid",
        vermilion: "#15c",
        "not-a-token": "#123456",
      },
    },
  },
  {
    id: "editorial-clipped",
    preference: { preset: "editorial" },
    clip: { x: 20, y: 30, width: 370, height: 330 },
  },
  { id: "editorial-scrolled", preference: { preset: "editorial" }, scroll: 27 },
] as const;

const browser = await chromium.launch({
  executablePath: process.env.TWYNE_FIXTURE_CHROME ?? "/usr/bin/google-chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 440, height: 390 },
    deviceScaleFactor: 2,
  });
  let blockedNetworkRequests = 0;
  await page.route("**/*", async (route) => {
    blockedNetworkRequests++;
    await route.abort();
  });
  const reference = [];
  for (const entry of cases) {
    const preference = normalizeThemePreference(entry.preference);
    const prefersDark = "prefersDark" in entry ? entry.prefersDark : false;
    const scroll = "scroll" in entry ? entry.scroll : 0;
    const clip = "clip" in entry ? entry.clip : null;
    await page.setContent(
      `<style>${stylesheet}\nhtml{line-height:1.5}body{margin:0;min-height:${scroll ? 900 : 390}px}</style>`,
    );
    const result = await page.evaluate(
      async ({ preference, prefersDark, bundle, scroll, clip }) => {
        const original = await import(`data:text/javascript;base64,${bundle}`);
        original.applyTheme(preference, document.documentElement, prefersDark);
        if (clip) {
          // Cover only the outside of the clip. Body phase/radial artwork stays original.
          const cover = document.createElement("div");
          cover.style.cssText = "position:fixed;inset:0;pointer-events:none";
          cover.style.backgroundColor = "var(--color-paper)";
          cover.style.clipPath = `polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${clip.x}px ${clip.y}px,${clip.x}px ${clip.y + clip.height}px,${clip.x + clip.width}px ${clip.y + clip.height}px,${clip.x + clip.width}px ${clip.y}px,${clip.x}px ${clip.y}px)`;
          document.body.append(cover);
        }
        window.scrollTo(0, scroll);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const style = getComputedStyle(document.body);
        const grain = [1, 2, 3].map((id) => {
          const probe = document.createElement("div");
          probe.style.backgroundColor = `var(--grain-${id})`;
          probe.style.display = "none";
          document.body.append(probe);
          const color = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const match = color.match(
            /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/,
          );
          const rgba = color.match(
            /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/,
          );
          if (!match && !rgba)
            throw new Error(`Unexpected original grain color ${color}`);
          const rgb = match
            ? match.slice(1, 4).map((value) => Math.round(Number(value) * 255))
            : rgba!.slice(1, 4).map(Number);
          return {
            color,
            rgb: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2],
            alpha: Number((match ?? rgba)![4] ?? 1),
          };
        });
        return {
          resolved: document.documentElement.getAttribute("data-theme"),
          chosen: document.documentElement.getAttribute(
            "data-theme-preference",
          ),
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize,
          backgroundPosition: style.backgroundPosition,
          backgroundRepeat: style.backgroundRepeat,
          opacity: style.opacity,
          bodyOrigin: {
            x: document.body.getBoundingClientRect().x,
            y: document.body.getBoundingClientRect().y,
          },
          grain,
        };
      },
      { preference, prefersDark, bundle, scroll, clip },
    );
    await page.screenshot({ path: `${directory}/web-${entry.id}.png` });
    reference.push({
      id: entry.id,
      preference,
      prefersDark,
      tokens: resolvedThemeTokens(preference, prefersDark),
      clip,
      anchor: { x: 0, y: -scroll },
      result,
    });
  }
  await Bun.write(
    `${directory}/web-reference.json`,
    JSON.stringify(
      {
        source: "src/global.css and src/utils/theme.ts applyTheme",
        cssSha256: createHash("sha256").update(css).digest("hex"),
        viewport: { width: 440, height: 390 },
        deviceScaleFactor: 2,
        blockedNetworkRequests,
        cases: reference,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Captured ${reference.length} original paper/theme cases; ${blockedNetworkRequests} network requests.`,
  );
} finally {
  await browser.close();
}
