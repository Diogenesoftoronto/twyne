import { defineConfig } from "@playwright/test";

const remote = process.env.TWYNE_VISUAL_BASE_URL;
const port = process.env.TWYNE_DEV_PORT || "5187";
const run = new Date().toISOString().replace(/[:.]/g, "-");
const output =
  (process.env.TWYNE_VISUAL_OUTPUT ||= `artifacts/qa-recordings/living-desk/${run}`);

/** Successful runs retain their footage, stills and trace for review and reuse. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: remote
    ? ["manual-living-desk.e2e.ts", "manual-instruments.e2e.ts"]
    : [
        "living-desk.e2e.ts",
        "instruments.e2e.ts",
        "instrument-dock.e2e.ts",
      ],
  timeout: 90_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  workers: 1,
  retries: 0,
  outputDir: `${output}/results`,
  snapshotPathTemplate: "{testDir}/visual-baselines/{testFilePath}/{arg}{ext}",
  reporter: [
    ["list"],
    ["html", { outputFolder: `${output}/report`, open: "never" }],
  ],
  use: {
    baseURL: remote || `http://127.0.0.1:${port}`,
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    contextOptions: { reducedMotion: "reduce" },
    locale: "en-CA",
    colorScheme: "light",
    trace: "on",
    screenshot: "on",
    video: { mode: "on", size: { width: 1440, height: 900 } },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  ...(remote
    ? {}
    : {
        webServer: {
          command: "bun run dev.frontend",
          env: { TWYNE_DEV_PORT: port, TWYNE_VISUAL_RUN: "1" },
          url: `http://127.0.0.1:${port}`,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
});
