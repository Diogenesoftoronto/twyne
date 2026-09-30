import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test.each([undefined, "", "5173", "5180"])(
  "Playwright uses one frontend host and port when TWYNE_DEV_PORT=%s",
  (configuredPort) => {
    // Load in separate processes so module caching and env changes cannot affect other tests.
    const env = { ...process.env };
    if (configuredPort === undefined) delete env.TWYNE_DEV_PORT;
    else env.TWYNE_DEV_PORT = configuredPort;
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        'import config from "./playwright.config.ts"; console.log(JSON.stringify({ use: config.use, webServer: config.webServer }));',
      ],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env,
        encoding: "utf8",
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const config = JSON.parse(result.stdout);
    const port = configuredPort || "5173";
    const url = `http://127.0.0.1:${port}`;
    expect(config.use.baseURL).toBe(url);
    expect(config.webServer.url).toBe(url);
    expect(config.webServer.env.TWYNE_DEV_PORT).toBe(port);
    expect(config.webServer.command).toBe("bun run dev.frontend");
  },
);

test("the frontend script binds the host and port used by Playwright", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const command = pkg.scripts["dev.frontend"];
  expect(command).toContain("--host 127.0.0.1");
  expect(command).toContain("--port ${TWYNE_DEV_PORT:-5173}");
  expect(command).toContain("--strictPort");
  expect(command.match(/--host\b/g)).toHaveLength(1);
});
