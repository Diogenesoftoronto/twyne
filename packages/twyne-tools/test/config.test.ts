import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCredentials, readConfig, writeConfig } from "../src/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function configPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "twyne-tools-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "nested", "config.json");
}

describe("credential config", () => {
  test("writes and reads a chmod-0600 config", async () => {
    const path = await configPath();
    await writeConfig(
      { apiUrl: "https://twyne.example/", accessToken: "twyne_pat_secret" },
      path,
    );
    expect(await readConfig(path)).toEqual({
      version: 1,
      apiUrl: "https://twyne.example",
      accessToken: "twyne_pat_secret",
    });
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("environment credentials take precedence as a complete pair", async () => {
    const credentials = await loadCredentials({
      TWYNE_API_URL: "https://env.example",
      TWYNE_ACCESS_TOKEN: "twyne_pat_environment",
    });
    expect(credentials).toMatchObject({ source: "environment", apiUrl: "https://env.example" });
    await expect(
      loadCredentials({ TWYNE_ACCESS_TOKEN: "twyne_pat_environment" }),
    ).rejects.toThrow("Set both");
  });

  test("refuses a config readable by other users", async () => {
    if (process.platform === "win32") return;
    const path = await configPath();
    await writeConfig(
      { apiUrl: "https://twyne.example", accessToken: "twyne_pat_secret" },
      path,
    );
    await chmod(path, 0o644);
    await expect(readConfig(path)).rejects.toThrow("permissions are too open");
  });
});
