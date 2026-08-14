import { describe, expect, test } from "bun:test";
import {
  COMPOSITOR_ICONS,
  EDITOR_TOOL_ICONS,
  renderTwyneIconSvg,
} from "./icon-system";

describe("Twyne icon system", () => {
  test("renders a Reicon SVG that inherits the control colour", () => {
    const svg = renderTwyneIconSvg("arrow-up", { size: 18 });
    expect(svg).toContain('width="18"');
    expect(svg).toContain('height="18"');
    expect(svg).toContain("color: currentColor");
  });

  test("hides decorative icons from assistive technology", () => {
    const svg = renderTwyneIconSvg("grid");
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
  });

  test("gives a standalone icon an accessible name when requested", () => {
    const svg = renderTwyneIconSvg("trash", { label: "Delete table" });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Delete table"');
    expect(svg).not.toContain('aria-hidden="true"');
  });

  test("gives list actions and section breaks distinct semantic icons", () => {
    expect(new Set(Object.values(EDITOR_TOOL_ICONS)).size).toBe(4);
    expect(EDITOR_TOOL_ICONS.bulletList).toBe("unordered-list");
    expect(EDITOR_TOOL_ICONS.sectionBreak).toBe("section-divider");

    for (const name of Object.values(EDITOR_TOOL_ICONS)) {
      expect(renderTwyneIconSvg(name)).toContain("<svg");
    }
  });

  test("gives compositor tasks recognizable, non-overloaded icons", () => {
    expect(new Set(Object.values(COMPOSITOR_ICONS)).size).toBe(
      Object.keys(COMPOSITOR_ICONS).length,
    );
    for (const name of Object.values(COMPOSITOR_ICONS)) {
      expect(renderTwyneIconSvg(name)).toContain("<svg");
    }
  });
});
