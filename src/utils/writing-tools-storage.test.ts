import { afterEach, describe, expect, test } from "bun:test";
import {
  __setWritingToolsStorageForTests,
  emptyWritingToolsNotebook,
  loadWritingToolsNotebook,
  saveWritingToolsNotebook,
} from "./writing-tools-storage";

afterEach(() => __setWritingToolsStorageForTests(null));

describe("writing tools notebook", () => {
  test("isolates saved passages, source pairs and promise decisions by folio", async () => {
    const values = new Map<string, unknown>();
    __setWritingToolsStorageForTests({
      load: async <T>(key: string) => (values.get(key) as T) ?? null,
      save: async (key, value) => {
        values.set(key, value);
      },
    });
    const notebook = emptyWritingToolsNotebook();
    notebook.voiceSamples.push({ id: "voice", text: "My peculiar sentence." });
    notebook.scraps.push({ id: "scrap", text: "The cut anecdote." });
    notebook.sources.push({
      id: "source",
      claim: "Most readers",
      previousClaim: "Some readers",
      source: "Two of six readers",
    });
    notebook.intentionalPromises.push("promise:abc");
    await saveWritingToolsNotebook("one", notebook);
    notebook.scraps.length = 0;
    expect((await loadWritingToolsNotebook("one")).scraps).toHaveLength(1);
    expect(
      (await loadWritingToolsNotebook("one")).sources[0].previousClaim,
    ).toBe("Some readers");
    expect(await loadWritingToolsNotebook("two")).toEqual(
      emptyWritingToolsNotebook(),
    );
  });

  test("does not confirm saves when IndexedDB absorbed a failed write", async () => {
    __setWritingToolsStorageForTests({
      load: async () => null,
      save: async () => {},
    });
    const notebook = emptyWritingToolsNotebook();
    notebook.audience = "A curious newcomer";
    await expect(saveWritingToolsNotebook("one", notebook)).rejects.toThrow(
      "Local save failed",
    );
  });

  test("ignores malformed saved fields", async () => {
    __setWritingToolsStorageForTests({
      load: async <T>() =>
        ({
          voiceSamples: [null, { id: "x", text: 9 }],
          sources: [{ id: "s", claim: "c" }],
          intentionalPromises: [null, "keep"],
        }) as T,
      save: async () => {},
    });
    expect(await loadWritingToolsNotebook("one")).toEqual({
      ...emptyWritingToolsNotebook(),
      intentionalPromises: ["keep"],
    });
  });
});
