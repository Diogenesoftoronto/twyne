import { defineConfig } from "@playwright/test";
const output =
  process.env.TWYNE_MODEL_OUTPUT ??
  `artifacts/instrument-evals/models-${new Date().toISOString().replace(/[:.]/g, "-")}`;
export default defineConfig({
  testDir: "./e2e",
  testMatch: "instruments-models.e2e.ts",
  timeout: 300_000,
  workers: 1,
  retries: 0,
  outputDir: `${output}/results`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${output}/report`, open: "never" }],
  ],
  use: { baseURL: "http://127.0.0.1:5198", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "bunx vite --config evals/instruments/vite.config.ts",
    url: "http://127.0.0.1:5198/evals/instruments/browser/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
