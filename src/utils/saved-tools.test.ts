import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
// @ts-expect-error jsdom is a test-only dependency without declarations.
import { JSDOM } from "jsdom";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";
import {
  __setSavedToolsStorageForTests,
  loadSavedTools,
  normalizeSavedTool,
  removeSavedTool,
  saveTool,
} from "./saved-tools";

const release = await lockBrowserGlobalsForTestFile();
const names = ["window", "CustomEvent"] as const;
const previous = new Map(
  names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);
let dom: InstanceType<typeof JSDOM>;
let values: Map<string, unknown>;
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
  values = new Map();
  __setSavedToolsStorageForTests({
    load: async <T>(key: string) => (values.get(key) as T) ?? null,
    save: async (key, value) => {
      values.set(key, value);
    },
  });
});
afterEach(() => {
  __setSavedToolsStorageForTests(null);
  dom.window.close();
});
afterAll(() => {
  for (const name of names) {
    const descriptor = previous.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  release();
});

describe("saved tools", () => {
  test("round-trips a template and newest comes first", async () => {
    await saveTool({
      kind: "rhythm-strip",
      name: "Tight",
      config: { targetMin: 6, targetMax: 18 },
    });
    await saveTool({
      kind: "reader-questions",
      name: "Sceptic",
      config: { angle: "a sceptical economist" },
    });
    const tools = await loadSavedTools();
    expect(tools.map((t) => t.name)).toEqual(["Sceptic", "Tight"]);
    expect(tools[1].config).toEqual({ targetMin: 6, targetMax: 18 });
  });

  test("stores plain data, never a live object", async () => {
    const config = { slots: ["A source"] };
    await saveTool({ kind: "claim-check", name: "Cite", config });
    config.slots.push("mutated later");
    const [tool] = await loadSavedTools();
    expect(tool.config.slots).toEqual(["A source"]);
  });

  test("drops unknown kinds and clamps what it keeps", () => {
    expect(normalizeSavedTool({ id: "x", kind: "iframe" })).toBeNull();
    expect(
      normalizeSavedTool({
        id: "x",
        kind: "rhythm-strip",
        config: { targetMin: -4, targetMax: 900, passage: "leaked words" },
      })?.config,
    ).toEqual({ targetMin: 1, targetMax: 120 });
  });

  test("removes by id", async () => {
    const kept = await saveTool({
      kind: "sentence-lab",
      name: "Lab",
      config: {},
    });
    await saveTool({ kind: "claim-check", name: "Cite", config: {} });
    await removeSavedTool(kept.id);
    expect((await loadSavedTools()).map((t) => t.name)).toEqual(["Cite"]);
  });

  test("a write that does not land is an error", async () => {
    __setSavedToolsStorageForTests({
      load: async () => null,
      save: async () => {},
    });
    await expect(
      saveTool({ kind: "sentence-lab", name: "Lab", config: {} }),
    ).rejects.toThrow("did not persist");
  });
});
