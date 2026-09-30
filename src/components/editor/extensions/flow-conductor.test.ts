import {
  afterAll,
  afterEach,
  beforeAll,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { Editor } from "@tiptap/core";
import type { ConvexClient } from "convex/browser";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
// @ts-expect-error jsdom is intentionally untyped in this project's test harness.
import { JSDOM } from "jsdom";
import { emptyHouseState } from "../../../utils/house-model";
import { lockBrowserGlobalsForTestFile } from "../../../utils/test-browser-globals-lock";
import {
  FLOW_SESSION_EVENT,
  type FlowSession,
} from "../../../utils/flow-session";
import type { JudgementRequest } from "../../../utils/judgement-client";
import type { ProjectBrief } from "../../../types";

const releaseGlobals = await lockBrowserGlobalsForTestFile();
const originals = new Map(
  [
    "window",
    "document",
    "CustomEvent",
    "setInterval",
    "clearInterval",
    "__EXPERIMENTAL__",
  ].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
);
// Vite defines this Qwik flag; standalone Bun imports need the same empty flags.
Object.defineProperty(globalThis, "__EXPERIMENTAL__", {
  configurable: true,
  writable: true,
  value: {},
});
const ticks = new Map<number, () => void>();
let nextInterval = 0;
let judgementCalls = 0;
let coverCalls = 0;
let budgetWait = 0;
let storableCalls = 0;
const requests: JudgementRequest[] = [];
const metadata = new Map<string, unknown>();
let folios: Array<{ id: string; name: string }> = [];
let folioContents: Record<string, string> = {};
let restoreClock: (() => void) | null = null;
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
let answerRequest: ((request: JudgementRequest) => Promise<Judgement>) | null =
  null;
let cover: Promise<{ medium: "book"; title: string }>;
let comments: Promise<unknown[]>;

// Bun module mocks survive mock.restore(). Preserve and restore their exports
// so later editor tests use the real judgement and storage implementations.
const dependencies = [
  "../../../utils/judgement-client",
  "../../../utils/flow-media",
  "../../../utils/system-one-budget",
  "../../../utils/idb",
  "../../../utils/anti-tabula-rasa",
  "../../../utils/user-comments",
  "../../../utils/bibliography",
  "../../../utils/house-store",
  "../../../utils/flow-diagnostics",
];
const savedModules = await Promise.all(
  dependencies.map(
    async (path) => [path, { ...(await import(path)) }] as const,
  ),
);

mock.module("../../../utils/judgement-client", () => ({
  askJudgement: (_client: unknown, request: JudgementRequest) => {
    judgementCalls++;
    requests.push(request);
    return answerRequest ? answerRequest(request) : judgement;
  },
}));
mock.module("../../../utils/flow-media", () => ({
  lookupWork: () => {
    coverCalls++;
    return cover;
  },
}));
mock.module("../../../utils/system-one-budget", () => ({
  systemOneWait: () => budgetWait,
  spendSystemOne: () => {},
  backOffSystemOne: () => {},
}));
mock.module("../../../utils/idb", () => ({
  loadMetaFromIdb: async (key: string) => metadata.get(key),
  loadFoliosFromIdb: async () => folios,
  loadFolioContentFromIdb: async (id: string) => folioContents[id] ?? "",
  saveMetaToIdb: async (key: string, value: unknown) => {
    metadata.set(key, structuredClone(value));
  },
  toStorable: (value: unknown) => {
    storableCalls++;
    return structuredClone(value);
  },
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
      writable: true,
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
  restoreClock?.();
  restoreClock = null;
});
afterAll(() => {
  for (const [path, exports] of savedModules) mock.module(path, () => exports);
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
  storableCalls = budgetWait = 0;
  requests.length = 0;
  metadata.clear();
  folios = [];
  folioContents = {};
  judgement = Promise.resolve(answers);
  answerRequest = null;
  cover = Promise.resolve({ medium: "book", title: "The Odyssey" });
  comments = Promise.resolve([]);
}
function start(
  folioId: string,
  clientAvailable = true,
  brief: ProjectBrief | null = null,
) {
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
  const listeners = new Map<
    string,
    Set<(event: { transaction: Transaction }) => void>
  >();
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
  });
  let destroyed = false;
  const editor = {
    get isDestroyed() {
      return destroyed;
    },
    get state() {
      return state;
    },
    view: { hasFocus: () => true },
    on: (
      name: string,
      listener: (event: { transaction: Transaction }) => void,
    ) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    },
    off: (
      name: string,
      listener: (event: { transaction: Transaction }) => void,
    ) => {
      listeners.get(name)?.delete(listener);
    },
  } as unknown as Editor;
  const stop = startFlowConductor(editor, {
    folioId,
    brief,
    getClient: () => (clientAvailable ? ({} as ConvexClient) : null),
  });
  cleanups.push(stop);
  const tick = ticks.get(nextInterval)!;
  const edit = (text: string, deleted = 0) => {
    const transaction = state.tr;
    const end = transaction.doc.content.size - 1;
    if (deleted) transaction.delete(Math.max(1, end - deleted), end);
    if (text) transaction.insertText(text, transaction.doc.content.size - 1);
    transaction.setSelection(
      TextSelection.create(transaction.doc, transaction.doc.content.size - 1),
    );
    state = state.apply(transaction);
    for (const listener of listeners.get("transaction") ?? [])
      listener({ transaction });
  };
  const destroy = () => {
    destroyed = true;
    for (const listener of listeners.get("destroy") ?? [])
      listener({ transaction: state.tr });
  };
  return { stop, tick, editor, edit, destroy };
}

function clock() {
  let now = 10_000_000;
  const spy = spyOn(Date, "now").mockImplementation(() => now);
  restoreClock = () => spy.mockRestore();
  return {
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function enterFlow(
  current: ReturnType<typeof start>,
  time: ReturnType<typeof clock>,
) {
  await flush();
  for (let i = 0; i <= 90; i++) {
    current.edit(" word");
    if (i < 90) time.advance(1_000);
  }
  current.tick();
  await flush();
  expect(flowSnapshot().mode).toBe("flow");
}

function collectSessions() {
  const sessions: FlowSession[] = [];
  const onSession = (event: Event) =>
    sessions.push((event as CustomEvent<FlowSession>).detail);
  window.addEventListener(FLOW_SESSION_EVENT, onSession);
  cleanups.push(() =>
    window.removeEventListener(FLOW_SESSION_EVENT, onSession),
  );
  return sessions;
}

function circle(
  current: ReturnType<typeof start>,
  time: ReturnType<typeof clock>,
  strong = true,
) {
  current.edit(strong ? "" : " word".repeat(7), strong ? 40 : 25);
  time.advance(18_000);
  current.tick();
  expect(flowSnapshot().mode).toBe("stuck");
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

test("sessions start at flow entry, count net words and distinct held/upserted items, and survive remount", async () => {
  resetRequests();
  const time = clock();
  const comment = {
    id: "waiting",
    folioId: "folio",
    author: "Editor",
    text: "A thought",
    anchor: "The Odyssey",
    resolved: false,
    replies: [],
    createdAt: Date.now(),
  };
  comments = Promise.resolve([comment]);
  const current = start("folio");
  const sessions = collectSessions();
  await enterFlow(current, time);
  expect(flowSnapshot().heldKinds).toEqual({ comment: 1 });
  current.edit(" word".repeat(50));
  current.edit("", " word".repeat(5).length);
  comments = Promise.resolve([comment, { ...comment, id: "new-item" }]);
  window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
  await flush();
  window.dispatchEvent(new CustomEvent("twyne:user-comments-changed"));
  await flush();
  expect(flowSnapshot().heldKinds).toEqual({ comment: 2 });
  time.advance(60_000);
  current.tick();
  await flush();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    flowMs: 60_000,
    words: 45,
    wpm: 45,
    waited: 2,
    amendments: 0,
    ended: "pause",
  });
  expect(flowController()?.lastSession()).toEqual(sessions[0]);
  expect(metadata.get("flow-sessions")).toEqual(sessions);
  expect(storableCalls).toBeGreaterThan(0);
  current.stop();
  expect(sessions).toHaveLength(1);
  start("folio");
  await flush();
  expect(flowController()?.lastSession()).toEqual(sessions[0]);
});

for (const cause of ["reached", "manual", "away", "closed"] as const) {
  test(`a qualifying session closes once with cause ${cause}`, async () => {
    resetRequests();
    const time = clock();
    const current = start("folio");
    const sessions = collectSessions();
    await enterFlow(current, time);
    time.advance(cause === "away" ? 180_000 : 60_000);
    if (cause === "reached")
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape" }),
      );
    else if (cause === "manual")
      window.dispatchEvent(
        new CustomEvent("twyne:zen-mode", { detail: { on: false } }),
      );
    else if (cause === "away") current.tick();
    else current.destroy();
    current.stop();
    await flush();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].ended).toBe(cause);
    expect(sessions[0].words).toBe(0);
    expect(metadata.get("flow-sessions")).toEqual(sessions);
  });
}

test("controller release and interacting with the room close the active run as reached", async () => {
  resetRequests();
  const time = clock();
  const current = start("folio");
  const sessions = collectSessions();
  await enterFlow(current, time);
  current.edit(" word".repeat(40));
  flowController()?.release();
  expect(sessions[0]?.ended).toBe("reached");
  await enterFlow(current, time);
  current.edit(" word".repeat(40));
  const button = document.createElement("button");
  button.className = "flow-surface";
  document.body.append(button);
  try {
    button.focus();
    current.tick();
    expect(sessions[1]?.ended).toBe("reached");
  } finally {
    button.remove();
  }
  await flush();
});

test("brief sessions do not announce or persist a slip; forty words can qualify before a minute", async () => {
  resetRequests();
  const time = clock();
  const current = start("folio");
  const sessions = collectSessions();
  await enterFlow(current, time);
  current.edit(" word".repeat(39));
  time.advance(59_999);
  flowController()?.release();
  await flush();
  expect(sessions).toEqual([]);
  expect(metadata.has("flow-sessions")).toBe(false);
  await enterFlow(current, time);
  current.edit(" word".repeat(40));
  time.advance(30_000);
  flowController()?.release();
  await flush();
  expect(sessions[0]).toMatchObject({ flowMs: 30_000, words: 40, wpm: 80 });
});

test("turning automatic focus off closes a session and prevents another while disabled", async () => {
  resetRequests();
  const time = clock();
  const current = start("folio");
  const sessions = collectSessions();
  await enterFlow(current, time);
  time.advance(60_000);
  const { FLOW_SETTING_EVENT, FLOW_SETTING_KEY } = await import(
    "./flow-conductor"
  );
  metadata.set(FLOW_SETTING_KEY, false);
  window.dispatchEvent(new CustomEvent(FLOW_SETTING_EVENT));
  await flush();
  expect(sessions[0]?.ended).toBe("manual");
  current.tick();
  expect(flowSnapshot().enabled).toBe(false);
  expect(flowSnapshot().mode).toBe("working");
});

test("a folio replacement preserves the old slip without overwriting the new controller", async () => {
  resetRequests();
  const time = clock();
  const old = start("old-folio");
  const sessions = collectSessions();
  await enterFlow(old, time);
  time.advance(60_000);
  start("new-folio");
  const current = flowController();
  old.stop();
  await flush();
  expect(sessions[0]).toMatchObject({ folioId: "old-folio", ended: "closed" });
  expect(flowController()).toBe(current);
  expect(current?.lastSession()).toBeNull();
});

for (const noul of [0.59, 0.6]) {
  test(`a way in requires Jev stuck noul >= 0.6 (${noul})`, async () => {
    resetRequests();
    const time = clock();
    judgement = Promise.resolve({
      ok: true,
      answers: {
        stuck: { type: "noul", noul },
        wayIn: { type: "choice", choice: "Leave a mark and move on" },
      },
    });
    const current = start("folio");
    await flush();
    circle(current, time);
    await flush();
    const ways = flowController()!
      .items()
      .filter((item) => item.kind === "way-in");
    expect(ways).toHaveLength(noul >= 0.6 ? 1 : 0);
    if (ways.length) {
      expect(ways[0].title).toBe("Leave a mark and move on");
      expect(ways[0].body).toContain("TK");
    }
    expect(requests[0].questions.wayIn.criteria).not.toContain(
      "Pick up an earlier thread",
    );
  });
}

test("local fallback requires strong churn and no client; a budget-skipped client is insufficient", async () => {
  resetRequests();
  const time = clock();
  const weak = start("weak", false);
  await flush();
  circle(weak, time, false);
  await flush();
  expect(
    flowController()!
      .items()
      .some((item) => item.kind === "way-in"),
  ).toBe(false);
  weak.stop();
  const strong = start("strong", false);
  await flush();
  circle(strong, time);
  await flush();
  expect(flowSnapshot().visible[0]?.kind).toBe("way-in");
  strong.stop();
  budgetWait = 5_000;
  const budgeted = start("budgeted");
  await flush();
  circle(budgeted, time);
  await flush();
  expect(
    flowController()!
      .items()
      .some((item) => item.kind === "way-in"),
  ).toBe(false);
});

test("one way in links the best echo, and its dismissal survives revisiting the passage", async () => {
  resetRequests();
  const time = clock();
  folios = [{ id: "earlier", name: "Sea notes" }];
  folioContents.earlier =
    "The Odyssey followed the salt roads where traders weighed their loads. They returned to the coast before dawn, carrying the stories of the sea.";
  judgement = Promise.resolve({
    ok: true,
    answers: {
      stuck: { type: "noul", noul: 0.9 },
      wayIn: { type: "choice", choice: "Pick up an earlier thread" },
      echo0: { type: "noul", noul: 0.9 },
    },
  });
  const current = start("folio");
  await flush();
  circle(current, time);
  await flush();
  const way = flowSnapshot().visible[0];
  expect(way.kind).toBe("way-in");
  expect(way.title).toBe("Pick up an earlier thread");
  expect(way.links).toEqual(["echo:earlier:0"]);
  expect(flowSnapshot().visible[1]?.id).toBe("echo:earlier:0");
  flowController()!.dismiss(way.id);
  current.edit(" word");
  current.tick();
  time.advance(18_000);
  current.tick();
  await flush();
  expect(
    flowController()!
      .items()
      .filter((item) => item.kind === "way-in"),
  ).toEqual([]);
});

test("a delayed way-in judgement cannot surface after the passage changes or focus is released", async () => {
  resetRequests();
  const time = clock();
  const pending = deferred<Judgement>();
  judgement = pending.promise;
  const current = start("folio");
  await flush();
  circle(current, time);
  await flush();
  current.edit(" changed passage");
  flowController()!.release();
  pending.resolve({
    ok: true,
    answers: {
      stuck: { type: "noul", noul: 1 },
      wayIn: { type: "choice", choice: "Who is this for?" },
    },
  });
  await flush();
  expect(
    flowController()!
      .items()
      .filter((item) => item.kind === "way-in"),
  ).toEqual([]);
});

test("an amendment proposed during flow counts once; an earlier proposal does not count in the next slip", async () => {
  resetRequests();
  const time = clock();
  const pending = deferred<Judgement>();
  let driftCalls = 0;
  answerRequest = (request) => {
    if (request.questions.goal) {
      driftCalls++;
      return driftCalls === 2
        ? pending.promise
        : Promise.resolve({
            ok: true,
            answers: { goal: { type: "noul", noul: 0.1 } },
          });
    }
    return Promise.resolve(answers);
  };
  const current = start("folio", true, {
    answers: {
      workingTitle: "",
      format: "",
      audience: "",
      goal: "Explain seaside trade",
      tone: "",
      constraints: "",
      successSignal: "",
    },
    attachments: [],
    completedAt: 1,
    updatedAt: 1,
  });
  const sessions = collectSessions();
  await flush();
  current.edit(" word".repeat(340));
  time.advance(2_000);
  current.tick();
  await flush();
  expect(driftCalls).toBe(1);
  time.advance(1_000);
  current.edit(" word".repeat(340));
  time.advance(2_000);
  current.tick();
  await flush();
  expect(driftCalls).toBe(2);
  await enterFlow(current, time);
  pending.resolve({ ok: true, answers: { goal: { type: "noul", noul: 0.1 } } });
  await flush();
  current.tick();
  expect(flowSnapshot().heldKinds.amendment).toBe(1);
  current.edit(" word".repeat(40));
  flowController()!.release();
  expect(sessions[0]).toMatchObject({ amendments: 1, waited: 2, words: 40 });
  await enterFlow(current, time);
  current.edit(" word".repeat(40));
  flowController()!.release();
  expect(sessions[1]).toMatchObject({ amendments: 0, waited: 2, words: 40 });
  await flush();
});

test("two folios closing in one turn append both slips to the shared history", async () => {
  resetRequests();
  const time = clock();
  const old = start("old-folio");
  const sessions = collectSessions();
  await enterFlow(old, time);
  const current = start("new-folio");
  await enterFlow(current, time);
  current.edit(" word".repeat(40));
  old.stop();
  flowController()!.release();
  await flush();
  expect(sessions).toHaveLength(2);
  expect(
    (metadata.get("flow-sessions") as FlowSession[]).map(
      (session) => session.folioId,
    ),
  ).toEqual(["old-folio", "new-folio"]);
});

test("a selected way in uses the dossier's purpose and audience", async () => {
  resetRequests();
  const time = clock();
  judgement = Promise.resolve({
    ok: true,
    answers: {
      stuck: { type: "noul", noul: 0.9 },
      wayIn: { type: "choice", choice: "Who is this for?" },
    },
  });
  const current = start("folio", true, {
    answers: {
      workingTitle: "",
      format: "",
      audience: "curious neighbours",
      goal: "Explain seaside trade",
      tone: "",
      constraints: "",
      successSignal: "",
    },
    attachments: [],
    completedAt: 1,
    updatedAt: 1,
  });
  await flush();
  circle(current, time);
  await flush();
  const way = flowSnapshot().visible[0];
  expect(way.title).toBe("Who is this for?");
  expect(way.body).toContain("curious neighbours");
  expect(way.body).toContain("Explain seaside trade");
});
