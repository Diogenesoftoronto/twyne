import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
// @ts-expect-error jsdom has no installed declaration package in this workspace.
import { JSDOM } from "jsdom";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";
import {
  __setWritingToolsStorageForTests,
  emptyWritingToolsNotebook,
  loadWritingToolsNotebook,
  saveWritingToolsNotebook,
} from "./writing-tools-storage";

const releaseGlobals = await lockBrowserGlobalsForTestFile();
const names = ["window", "CustomEvent"] as const;
const previous = new Map(
  names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);
let dom: InstanceType<typeof JSDOM>;
beforeEach(() => {
  dom = new JSDOM("", { url: "https://twyne.test/" });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, "CustomEvent", {
    configurable: true,
    value: dom.window.CustomEvent,
  });
});
afterEach(() => {
  __setWritingToolsStorageForTests(null);
  dom.window.close();
});
afterAll(() => {
  for (const name of names) {
    const descriptor = previous.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  releaseGlobals();
});

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

  test("serializes rapid autosaves so the newest edits win", async () => {
    const values = new Map<string, unknown>();
    let release!: () => void;
    let started!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const holdFirst = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    __setWritingToolsStorageForTests({
      load: async <T>(key: string) => (values.get(key) as T) ?? null,
      save: async (key, value) => {
        calls++;
        if (calls === 1) {
          started();
          await holdFirst;
        }
        values.set(key, value);
      },
    });
    const notebook = emptyWritingToolsNotebook();
    notebook.audience = "First edit";
    const first = saveWritingToolsNotebook("rapid", notebook);
    await firstStarted;
    notebook.audience = "Latest edit";
    const latest = saveWritingToolsNotebook("rapid", notebook);
    await Promise.resolve();
    expect(calls).toBe(1);
    release();
    await Promise.all([first, latest]);
    expect((await loadWritingToolsNotebook("rapid")).audience).toBe(
      "Latest edit",
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
