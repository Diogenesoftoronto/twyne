import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  MANUAL_NARRATION,
  NARRATION_ORDER,
  narrationHash,
  narrationSrc,
} from "./manual-narration-script";
import GENERATED from "./manual-narration.generated.json";

const generated = GENERATED as Record<
  string,
  { hash: string; duration: number; segments: number[] }
>;

describe("manual narration", () => {
  test("every chapter's audio was rendered from its current script", () => {
    for (const [id, chapter] of Object.entries(MANUAL_NARRATION)) {
      // Changed the wording? Run: bun scripts/gen-manual-narration.ts
      expect({ id, hash: generated[id]?.hash }).toEqual({
        id,
        hash: narrationHash(chapter),
      });
      expect(generated[id].segments).toHaveLength(chapter.script.length);
      expect(existsSync(`public${narrationSrc(id)}`)).toBe(true);
    }
  });

  test("plays in the manual's chapter order, each chapter once", async () => {
    const page = await Bun.file("src/routes/docs/index.tsx").text();
    const sections = [...page.matchAll(/<section id="([a-z-]+)"/g)].map(
      (m) => m[1],
    );
    expect(sections.filter((id) => id in MANUAL_NARRATION)).toEqual([
      ...NARRATION_ORDER,
    ]);
    expect(Object.keys(MANUAL_NARRATION).sort()).toEqual(
      [...NARRATION_ORDER].sort(),
    );
    const placed = [
      ...page.matchAll(/<ManualNarration\s+chapter="([a-z-]+)"/g),
    ].map((m) => m[1]);
    expect(placed).toEqual([...NARRATION_ORDER]);
  });

  test("tells Morgan's story without gendering Morgan", () => {
    const gendered = Object.values(MANUAL_NARRATION)
      .flatMap((c) => c.script)
      .flatMap((line) => line.match(/\b(?:he|she|him|her|his|hers)\b/gi) ?? []);
    expect(gendered).toEqual([]);
  });
});
