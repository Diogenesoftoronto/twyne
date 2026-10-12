import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const source = await Bun.file(resolve(import.meta.dir, "source.json")).json();
const outlines = await Bun.file(resolve(import.meta.dir, "outlines.json")).json();
const css = await readFile(resolve(root, "src/global.css"), "utf8");
const view = await readFile(resolve(root, "src/components/brief/dossier-preview.tsx"), "utf8");

function stampDeclarations(input: string): Record<string, string> {
  const block = input.match(/(?:^|\n)\.stamp\s*\{([^}]+)\}/)?.[1];
  if (!block) throw new Error("Original .stamp block missing");
  return Object.fromEntries(
    block.split(";").filter((part) => part.trim()).map((part) => {
      const separator = part.indexOf(":");
      if (separator < 1) throw new Error("Invalid declaration");
      return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
}

function contract(input: string, markup: string) {
  const declarations = stampDeclarations(input);
  if (
    declarations["transform"] !== "rotate(-3deg)" ||
    declarations["border"] !== "2px solid var(--color-vermilion)" ||
    declarations["color"] !== "var(--color-vermilion)" ||
    declarations["font-family"] !== "var(--font-typewriter)" ||
    declarations["letter-spacing"] !== "0.22em" ||
    declarations["background"] !== "color-mix(in srgb, var(--color-vermilion) 4%, transparent)" ||
    declarations["border-radius"] !== "2px" ||
    declarations["display"] !== "inline-block" ||
    declarations["text-transform"] !== "uppercase"
  ) throw new Error("Source stamp presentation changed");
  const stamp = markup.match(/<span class="stamp[^\"]*">([\s\S]*?)<\/span>/)?.[0];
  if (!stamp || !stamp.includes('!px-2 !py-[0.15rem] !text-[0.55rem]') ||
      !stamp.includes("{completedFields} / {FIELD_ORDER.length} reviewed")) {
    throw new Error("Dossier stamp override/semantics changed");
  }
  return { fontSize: 0.55 * 16, tracking: 0.55 * 16 * 0.22, paddingX: 0.5 * 16, paddingY: 0.15 * 16 };
}

describe("Original Dossier stamp source and contour evidence", () => {
  test("current original selector/overrides and inherited line height agree with retained CSS receipt", async () => {
    const actual = contract(css, view);
    expect(actual.fontSize).toBeCloseTo(source.css.fontSizePx, 12);
    expect(actual.tracking).toBeCloseTo(source.css.trackingPx, 12);
    expect(actual.paddingX).toBe(source.css.paddingXPx);
    expect(actual.paddingY).toBe(source.css.paddingYPx);
    const preflight = await readFile(resolve(root, "node_modules/tailwindcss/preflight.css"), "utf8");
    expect(preflight).toContain("line-height: 1.5;");
    expect(actual.fontSize * 1.5).toBeCloseTo(source.css.lineHeightPx, 12);
    expect(source.retainedBrowserReceipt.row.styles["line-height"]).toBe("13.2px");
    expect(source.retainedBrowserReceipt.labelNotRecorded).toBe(true);
  });

  test("changed rotation, spacing, padding or count markup fails instead of reusing a guessed raster", () => {
    const originalBlock = css.match(/(?:^|\n)\.stamp\s*\{([^}]+)\}/)![0];
    for (const [before, after] of [
      ["transform: rotate(-3deg)", "transform: rotate(3deg)"],
      ["letter-spacing: 0.22em", "letter-spacing: 0.2em"],
      ["var(--color-vermilion) 4%, transparent", "var(--color-vermilion) 40%, transparent"],
    ]) expect(() => contract(css.replace(originalBlock, originalBlock.replace(before, after)), view)).toThrow();
    expect(() => contract(css, view.replace("!py-[0.15rem]", "!py-[0.2rem]"))).toThrow();
    expect(() => contract(css, view.replace("{completedFields} / {FIELD_ORDER.length} reviewed", "7 / 7 reviewed"))).toThrow();
  });

  test("font/license bytes and every needed original contour are present", async () => {
    for (const path of [
      "desktop/gpui/assets/fonts/specialelite-SpecialElite-Regular.ttf",
      "desktop/gpui/assets/fonts/specialelite-LICENSE.txt",
    ]) {
      expect(createHash("sha256").update(await readFile(resolve(root, path))).digest("hex"))
        .toBe(source.source.sha256[path]);
    }
    const notice = await readFile(resolve(import.meta.dir, "Special-Elite-LICENSE.txt"));
    const originalNotice = await readFile(resolve(root, "desktop/gpui/assets/fonts/specialelite-LICENSE.txt"));
    expect(notice.equals(originalNotice)).toBe(true);
    expect(outlines.fontSha256).toBe(source.source.sha256["desktop/gpui/assets/fonts/specialelite-SpecialElite-Regular.ttf"]);
    expect(outlines.version).toBe("Version 1.001");
    const alphabet = Object.values(outlines.glyphs).map((row: any) => row.character).sort();
    expect(alphabet).toEqual([...new Set("01234567 /REVIEWED")].sort());
    for (const label of source.review.labels) {
      for (const character of label) expect(alphabet).toContain(character);
      expect(label.length).toBe(14);
    }
  });

  test("retained original quad proves center -3 degree rotation and its fractional used height, preserving declared CSS dimensions", () => {
    const q = source.retainedBrowserReceipt.row.box.border as number[];
    const [dx, dy] = [q[2] - q[0], q[3] - q[1]];
    expect(Math.atan2(dy, dx) * 180 / Math.PI).toBeCloseTo(-3, 4);
    expect(Math.hypot(q[4] - q[2], q[5] - q[3])).toBeCloseTo(source.usedVerticalLayout.borderBoxHeightPx, 4);
    expect(source.css.lineHeightPx + source.css.paddingYPx * 2 + source.css.borderPx * 2).toBe(22);
    expect(source.retainedBrowserReceipt.row.box.height).toBe(22);
    expect(source.usedVerticalLayout.lineHeightPx + source.usedVerticalLayout.paddingYPx * 2 + source.css.borderPx * 2).toBe(21.96875);
    const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
    const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
    expect((q[0] + q[4]) / 2).toBeCloseTo(cx, 4);
    expect((q[1] + q[5]) / 2).toBeCloseTo(cy, 4);
    expect(q[1]).toBeGreaterThan(q[3]);
    expect(q[7] - q[3]).toBeGreaterThan(22);
  });
});
