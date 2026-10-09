import { describe, expect, test } from "bun:test";
import {
  LOCAL_WRITING_PACKS,
  cosineSimilarity,
  localWordInput,
  pinnedLocalWritingUrl,
} from "./local-writing-manifest";
describe("local writing pack boundaries", () => {
  test("every downloaded file has one exact pinned revision; only known main probes alias", () => {
    for (const pack of Object.values(LOCAL_WRITING_PACKS))
      for (const file of pack.files) {
        expect(pack.revision).toMatch(/^[a-f0-9]{40}$/);
        expect(file.size).toBeGreaterThan(0);
        expect(pinnedLocalWritingUrl(file.url)).toBe(file.url);
        expect(
          pinnedLocalWritingUrl(file.url.replace(pack.revision, "main")),
        ).toBe(file.url);
        expect(pinnedLocalWritingUrl(`${file.url}?text=private`)).toBeNull();
        expect(
          pinnedLocalWritingUrl(
            file.url.replace("huggingface.co", "example.com"),
          ),
        ).toBeNull();
      }
    expect(
      pinnedLocalWritingUrl(
        "https://huggingface.co/unknown/model/resolve/main/config.json",
      ),
    ).toBeNull();
  });
  test("one exact word is masked and vector failures are explicit", () => {
    expect(localWordInput("Mara waited.", 5, 11)).toBe("Mara [MASK].");
    expect(() => localWordInput("Mara waited.", 6, 11)).toThrow();
    expect(() => localWordInput("Mara [MASK] waited.", 0, 4)).toThrow();
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [2, 2])).toBeCloseTo(1);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow();
    expect(() => cosineSimilarity([NaN], [1])).toThrow();
  });
});
