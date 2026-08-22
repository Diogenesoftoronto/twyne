import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { COMPOSITOR_TABS } from "./compositor-toolbar";

const compositorSource = readFileSync(
  new URL("../components/editor/compositor-panel.tsx", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(
  new URL("../global.css", import.meta.url),
  "utf8",
);

describe("compositor toolbar wiring", () => {
  test("renders every configured task group exactly once", () => {
    const renderedGroups = [
      ...compositorSource.matchAll(/data-group-label="([^"]+)"/g),
    ].map((match) => match[1]);
    const configuredGroups = COMPOSITOR_TABS.flatMap((tab) => [...tab.groups]);
    expect(renderedGroups.sort()).toEqual(configuredGroups.sort());
  });

  test("keeps font family and point size visible in the Home ribbon", () => {
    expect(compositorSource).toContain('class="compositor-font-select"');
    expect(compositorSource).toContain('class="compositor-size-select"');
    expect(compositorSource).toContain("DEFAULT_MANUSCRIPT_FONT_LABEL");
    expect(compositorSource).toContain("DEFAULT_MANUSCRIPT_FONT_SIZE_LABEL");
  });

  test("groups page setup controls and exposes their selected state", () => {
    for (const legend of ["Paper", "Flow", "Margins", "Running heads"]) {
      expect(compositorSource).toContain(`<legend>${legend}</legend>`);
    }
    expect(compositorSource.match(/class="layout-choice"/g)?.length).toBe(4);
    expect(
      compositorSource.match(/aria-pressed=/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  test("uses the shared visible checkbox treatment in type and page controls", () => {
    expect(compositorSource.match(/class="compositor-checkbox"/g)?.length).toBe(
      5,
    );
    expect(compositorSource).toContain("Include persona comments");
    expect(globalCss).toContain(".compositor-checkbox:focus-visible");
    expect(globalCss).toContain(
      'ul[data-type="taskList"]\n  li\n  > label\n  input[type="checkbox"]:focus-visible',
    );
  });

  test("keeps the layout panel inside a phone viewport", () => {
    expect(globalCss).toContain(".compositor-layout-panel");
    expect(globalCss).toContain("max-height: calc(100dvh - 6rem) !important");
  });
});
