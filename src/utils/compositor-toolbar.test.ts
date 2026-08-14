import { describe, expect, test } from "bun:test";
import {
  COMPOSITOR_TABS,
  DEFAULT_COMPOSITOR_TAB,
  isCompositorTab,
  moveCompositorTab,
} from "./compositor-toolbar";

describe("compositor toolbar information architecture", () => {
  test("uses the familiar document-editor tabs in a stable order", () => {
    expect(COMPOSITOR_TABS.map((tab) => tab.id)).toEqual([
      "home",
      "insert",
      "review",
      "view",
    ]);
    expect(DEFAULT_COMPOSITOR_TAB).toBe("home");
  });

  test("assigns every command group to exactly one task", () => {
    const groups = COMPOSITOR_TABS.flatMap((tab) => tab.groups);
    expect(new Set(groups).size).toBe(groups.length);
    expect(groups).toContain("Lists");
    expect(groups).toContain("Breaks");
    expect(groups).toContain("Proofing");
    expect(groups).toContain("Page");
  });

  test("rejects unknown tab state", () => {
    expect(isCompositorTab("review")).toBe(true);
    expect(isCompositorTab("formatting")).toBe(false);
  });

  test("moves through tabs with keyboard-style wrapping", () => {
    expect(moveCompositorTab("home", -1)).toBe("view");
    expect(moveCompositorTab("view", 1)).toBe("home");
    expect(moveCompositorTab("insert", 1)).toBe("review");
  });
});
