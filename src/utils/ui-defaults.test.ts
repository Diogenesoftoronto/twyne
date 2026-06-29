import { describe, expect, test } from "bun:test";
import { DEFAULT_LAYOUT } from "../types";

describe("UI defaults", () => {
  test("uses the griffin mark as the SVG favicon", async () => {
    const head = await Bun.file(
      "src/components/router-head/router-head.tsx",
    ).text();
    const manifest = await Bun.file("public/manifest.json").json();

    expect(head).toContain('href="/assets/griffin-mark.svg"');
    expect(manifest.icons[0].src).toBe("/assets/griffin-mark.svg");
  });

  test("keeps margin guide rules hidden by default", () => {
    expect(DEFAULT_LAYOUT.showMarginGuides).toBe(false);
  });
});
