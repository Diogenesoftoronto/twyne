import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/profiles.test.ts", "convex/account.test.ts"],
    pool: "forks",
    maxWorkers: 1,
  },
});
