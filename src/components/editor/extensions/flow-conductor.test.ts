import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import type { Editor } from "@tiptap/core";
import type { ConvexClient } from "convex/browser";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
// @ts-expect-error jsdom is intentionally untyped in this project's test harness.
import { JSDOM } from "jsdom";
import { emptyHouseState } from "../../../utils/house-model";
import { lockBrowserGlobalsForTestFile } from "../../../utils/test-browser-globals-lock";

const releaseGlobals = await lockBrowserGlobalsForTestFile();
const originals = new Map(
  ["window", "document", "CustomEvent", "setInterval", "clearInterval"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)],
  ),
);
const ticks = new Map<number, () => void>();
let nextInterval = 0;
let judgementCalls = 0;
let coverCalls = 0;
type Judgement = {
  ok: boolean;
  answers: Record<string, { type: string; choice?: string; noul?: number }>;
};
const answers: Judgement = {
  ok: true,
  answers: {
    medium0: { type: "choice", choice: "A book" },
    cover0: { type: "noul", noul: 0.9 },
  },
};
let judgement: Promise<Judgement>;
let cover: Promise<{ medium: "book"; title: string }>;
let comments: Promise<unknown[]>;

mock.module("../../../utils/judgement-client", () => ({
  askJudgement: () => {
    judgementCalls++;
    return judgement;
  },
}));
mock.module("../../../utils/flow-media", () => ({
  lookupWork: () => {
    coverCalls++;
    return cover;
  },
}));
mock.module("../../../utils/system-one-budget", () => ({
  systemOneWait: () => 0,
  spendSystemOne: () => {},
  backOffSystemOne: () => {},
}));
mock.module("../../../utils/idb", () => ({
  loadMetaFromIdb: async () => undefined,
  loadFoliosFromIdb: async () => [],
  loadFolioContentFromIdb: async () => "",
  saveMetaToIdb: async () => {},
  toStorable: (value: unknown) => value,
}));
mock.module("../../../utils/anti-tabula-rasa", () => ({
  DEFAULT_INTERVIEW_ANSWERS: {
    workingTitle: "",
    format: "",
    audience: "",
    goal: "",
    tone: "",
    constraints: "",
    successSignal: "",
  },
  htmlToPlainText: (html: string) => html,
}));
mock.module("../../../utils/user-comments", () => ({
  loadUserComments: () => comments,
}));
mock.module("../../../utils/bibliography", () => ({
  loadBibliographyForFolio: async () => [],
}));
mock.module("../../../utils/house-store", () => ({
  HOUSE_CHANGED_EVENT: "twyne:house-changed",
  loadHouseState: async () => emptyHouseState(),
}));
mock.module("../../../utils/flow-diagnostics", () => ({ logFlow: () => {} }));
const { startFlowConductor, flowSnapshot, flowController, FLOW_EVENT } =
  await import("./flow-conductor");

const cleanups: Array<() => void> = [];
beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
  });
  for (const name of ["window", "document", "CustomEvent"] as const)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === "window" ? dom.window : dom.window[name],
    });
  Object.defineProperty(globalThis, "setInterval", {
    configurable: true,
    value: (callback: () => void) => {
      const id = ++nextInterval;
      ticks.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(globalThis, "clearInterval", {
    configurable: true,
    value: (id: number) => ticks.delete(id),
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  ticks.clear();
});
afterAll(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  releaseGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function resetRequests() {
  judgementCalls = coverCalls = 0;
  judgement = Promise.resolve(answers);
  cover = Promise.resolve({ medium: "book", title: "The Odyssey" });
  comments = Promise.resolve([]);
}
function start(folioId: string) {
  const schema = new Schema({
    nodes: {
      doc: { content: "paragraph+" },
      paragraph: { content: "text*", group: "block" },
      text: { group: "inline" },
    },
    marks: { italic: {} },
  });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("Reading "),
      schema.text("The Odyssey", [schema.mark("italic")]),
      schema.text(
        " sends me back to the long salt roads where traders weighed their loads and followed the coast before dawn.",
      ),
    ]),
  ]);
  const editor = {
    isDestroyed: false,
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 1) }),
    on: () => {},
    off: () => {},
  } as unknown as Editor;
  const stop = startFlowConductor(editor, {
    folioId,
    brief: null,
    getClient: () => ({}) as ConvexClient,
  });
  cleanups.push(stop);
  const tick = ticks.get(nextInterval)!;
  return { stop, tick, editor };
}

test("a judgement finishing after teardown cannot resurrect the margin snapshot", async () => {
  resetRequests();
  const pending = deferred<Judgement>();
  judgement = pending.promise;
  const old = start("old-folio");
  await flush();
  expect(flowSnapshot().enabled).toBe(true);
  old.tick();
  await flush();
  expect(judgementCalls).toBe(1);
  old.stop();
  const closed = flowSnapshot();
  let publications = 0;
  const listener = () => {
    publications++;
  };
  window.addEventListener(FLOW_EVENT, listener);
  try {
    pending.resolve(answers);
    await flush();
    expect(flowSnapshot()).toBe(closed);
    expect(flowSnapshot().enabled).toBe(false);
    expect(flowController()).toBeNull();
    expect(coverCalls).toBe(0);
    expect(publications).toBe(0);
  } finally {
    window.removeEventListener(FLOW_EVENT, listener);
  }
});

test("the current conductor still publishes a completed cover lookup", async () => {
  resetRequests();
  const current = start("current-folio");
  await flush();
  current.tick();
  await flush();
  expect(coverCalls).toBe(1);
  expect(flowSnapshot().visible).toContainEqual(
    expect.objectContaining({
      id: "work:the odyssey",
      title: "The Odyssey",
      kind: "work",
    }),
  );
});

test("a cover lookup and old cleanup cannot overwrite the next folio", async () => {
  resetRequests();
  const pending = deferred<{ medium: "book"; title: string }>();
  cover = pending.promise;
  const old = start("old-folio");
  await flush();
  old.tick();
  await flush();
  expect(coverCalls).toBe(1);
  start("new-folio");
  await flush();
  const current = flowSnapshot();
  const currentController = flowController();
  old.stop();
  expect(flowSnapshot()).toBe(current);
  pending.resolve({ medium: "book", title: "Old folio's cover" });
  await flush();
  expect(flowSnapshot()).toBe(current);
  expect(flowController()).toBe(currentController);
  expect(currentController?.items()).toEqual([]);
  expect(current.enabled).toBe(true);
});

test("comments loaded after close cannot publish a stale conversation", async () => {
  resetRequests();
  const pending = deferred<unknown[]>();
  comments = pending.promise;
  const old = start("old-folio");
  await flush();
  old.stop();
  const closed = flowSnapshot();
  pending.resolve([
    {
      id: "late-comment",
      folioId: "old-folio",
      text: "Old feedback",
      author: "Editor",
      anchor: "The Odyssey",
      resolved: false,
      replies: [],
      createdAt: Date.now(),
    },
  ]);
  await flush();
  expect(flowSnapshot()).toBe(closed);
  expect(flowSnapshot().visible).toEqual([]);
});
