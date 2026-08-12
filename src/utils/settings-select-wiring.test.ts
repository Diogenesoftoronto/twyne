import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const settingsSource = readFileSync(
  new URL("../routes/settings/index.tsx", import.meta.url),
  "utf8",
);

describe("settings dropdown wiring", () => {
  test("uses the site dropdown for every settings choice", () => {
    expect(settingsSource).not.toContain("<select");
    expect(settingsSource).not.toContain("<option");
    expect(settingsSource.match(/<SiteSelect/g)?.length).toBe(10);
  });

  test("keeps model-derived reasoning choices on the site dropdown", () => {
    expect(settingsSource).toContain("thinkingModels.flatMap");
    expect(settingsSource).toContain("option.values.filter");
    expect(settingsSource).toContain("ariaLabel={label}");
  });
});
