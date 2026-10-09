import { defineConfig } from "@playwright/test";
import visual from "./playwright.visual.config";

const remote = process.env.TWYNE_VISUAL_BASE_URL;
const port = process.env.TWYNE_MANUAL_PORT || "3139";

/** Exercise Qwik's built resumable page and the actual media range handler. */
export default defineConfig({
  ...visual,
  testMatch: ["manual-living-desk.e2e.ts", "manual-instruments.e2e.ts"],
  use: { ...visual.use, baseURL: remote || `http://127.0.0.1:${port}` },
  webServer: remote
    ? undefined
    : {
        command:
          process.env.TWYNE_MANUAL_PREBUILT === "1"
            ? "bun server.js"
            : "bun run build && bun server.js",
        env: { PORT: port },
        url: `http://127.0.0.1:${port}/docs/`,
        reuseExistingServer: false,
        timeout: 240_000,
      },
});
