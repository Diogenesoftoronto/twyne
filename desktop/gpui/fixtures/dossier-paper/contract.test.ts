import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { radialGeometry, referenceSvg, sourceContract } from "./reference";

describe("original Dossier paper contract", () => {
  test("retains exact original rule bytes and front-to-back layers", async () => {
    const actual = await sourceContract();
    const saved = await Bun.file(
      resolve(import.meta.dir, "source.json"),
    ).json();
    expect(actual).toEqual(saved);
    expect(actual.backgrounds).toHaveLength(7);
    expect(actual.backgrounds.map((layer) => layer.size)).toEqual([
      "auto",
      "auto",
      "auto",
      "auto",
      "5px 5px",
      "7px 7px",
      "9px 9px",
    ]);
    expect(actual.backgrounds.map((layer) => layer.colored.alpha)).toEqual([
      0.06, 0.05, 0.6, 0.018000000000000002, 0.04, 0.035, 0.03,
    ]);
    expect(actual.backgrounds[3]!.angle).toBe(135);
  });

  test("percent-circle stop uses farthest corner, tile dots retain own local phase", async () => {
    const source = await sourceContract();
    const circle = radialGeometry(source.backgrounds[0]!, 1280, 860);
    expect(circle.x).toBe(230.39999999999998);
    expect(circle.y).toBe(189.2);
    expect(circle.radius).toBeCloseTo(Math.hypot(1049.6, 670.8) * 0.38, 10);
    expect(circle.solidFraction).toBe(0);
    for (const [index, period] of [
      [4, 5],
      [5, 7],
      [6, 9],
    ]) {
      const dot = radialGeometry(source.backgrounds[index!]!, period!, period!);
      expect(dot.radius).toBe(1.4);
      expect(dot.solidFraction).toBe(1 / 1.4);
    }
  });

  test("foxing is a5-spot global multiply group over descendants, not a normal-alpha tile", async () => {
    const source = await sourceContract();
    expect(source.foxing).toHaveLength(5);
    expect(
      source.foxing.every((layer) => layer.size === "auto" && !layer.tile),
    ).toBe(true);
    expect(source.foxing.map((layer) => layer.center)).toEqual([
      [0.12, 0.18],
      [0.88, 0.32],
      [0.24, 0.78],
      [0.76, 0.88],
      [0.5, 0.5],
    ]);
    expect(source.blend).toBe("multiply");
    expect(source.groupOpacity).toBe(0.7);
    expect(source.rules[1]!.declarations["pointer-events"]).toBe("none");
    // At least2 backdrop colors require different normal-alpha replacement
    // RGBs. A single prepared Source-over image cannot multiply arbitrary text.
    const fox = [0x7a / 255, 0x54 / 255, 0x26 / 255];
    const multiply = (backdrop: number[]) =>
      backdrop.map((c, i) => c * (1 - 0.18 * 0.7 + fox[i]! * 0.18 * 0.7));
    expect(multiply([1, 1, 1])).not.toEqual(multiply([0.1, 0.1, 0.1]));
    expect(multiply([0, 0, 0])).toEqual([0, 0, 0]);
    expect(new Set(multiply([1, 1, 1])).size).toBe(3);
    // Zero backdrop forces an ordinary-alpha replacement to black. Black's
    // one alpha then scales every channel equally, unlike these three factors.
  });

  test("Broadsheet disables foxing but leaves explicitly mixed sheet ink and soft wash", async () => {
    const source = await sourceContract();
    expect(source.presets.broadsheet["--foxing-base"]).toBe("transparent");
    const svg = referenceSvg(source, 620, 860, "broadsheet");
    expect(svg).toContain('fill="#111111" fill-opacity="0.018000000000000002"');
    expect(svg).toContain('stop-color="#fafafa" stop-opacity="0.6"');
    expect(svg).not.toContain("mix-blend-mode");
  });

  test("standalone SVG geometry stays immutable for1280/620 and all4 Source palettes", async () => {
    const source = await sourceContract();
    for (const width of [1280, 620]) {
      for (const preset of Object.keys(source.presets)) {
        const svg = referenceSvg(source, width, 860, preset);
        expect(svg).toBe(
          await Bun.file(
            resolve(import.meta.dir, `${preset}-${width}.svg`),
          ).text(),
        );
        expect(svg).not.toContain("href="); // no remote/resource references
      }
    }
  });
});
