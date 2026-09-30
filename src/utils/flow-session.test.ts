import { afterAll, expect, mock, test } from "bun:test";
import type { FlowSession, SessionSummaryInput } from "./flow-session";

// The IDB dependency includes Qwik code normally given this flag by Vite.
const experimental = Object.getOwnPropertyDescriptor(
  globalThis,
  "__EXPERIMENTAL__",
);
Object.defineProperty(globalThis, "__EXPERIMENTAL__", {
  configurable: true,
  writable: true,
  value: {},
});
const storage = { ...(await import("./idb")) };
let stored: unknown;
mock.module("./idb", () => ({
  ...storage,
  loadMetaFromIdb: async (key: string) =>
    key === "flow-sessions" ? stored : undefined,
}));
const { appendSession, loadFlowSessions, summarizeSession } = await import(
  "./flow-session"
);
afterAll(() => {
  mock.module("./idb", () => storage);
  if (experimental)
    Object.defineProperty(globalThis, "__EXPERIMENTAL__", experimental);
  else Reflect.deleteProperty(globalThis, "__EXPERIMENTAL__");
});

function input(
  overrides: Partial<SessionSummaryInput> = {},
): SessionSummaryInput {
  return {
    folioId: "folio",
    startedAt: 100_000,
    endedAt: 220_000,
    startWords: 200,
    endWords: 260,
    waited: new Set(["comment:a", "comment:a", "amend:goal"]),
    amendments: new Set(["amend:goal"]),
    ended: "pause",
    ...overrides,
  };
}

test("a slip measures net document growth, rounded wpm and distinct waiting items", () => {
  const session = summarizeSession(input());
  expect(session).toEqual({
    id: "folio:100000",
    folioId: "folio",
    startedAt: 100_000,
    endedAt: 220_000,
    flowMs: 120_000,
    words: 60,
    wpm: 30,
    waited: 2,
    amendments: 1,
    ended: "pause",
  });
  expect(structuredClone(session)).toEqual(session);
  expect(
    summarizeSession(input({ endedAt: 170_000, endWords: 241 }))?.wpm,
  ).toBe(35);
});

test("one minute or forty words qualifies, including exact boundaries", () => {
  expect(
    summarizeSession(input({ endedAt: 159_999, endWords: 239 })),
  ).toBeNull();
  expect(
    summarizeSession(input({ endedAt: 160_000, endWords: 200 }))?.words,
  ).toBe(0);
  expect(
    summarizeSession(input({ endedAt: 130_000, endWords: 240 }))?.wpm,
  ).toBe(80);
});

test("cuts never produce negative words or wpm; zero time cannot divide by zero", () => {
  expect(summarizeSession(input({ endWords: 150 }))?.words).toBe(0);
  expect(summarizeSession(input({ endWords: 150 }))?.wpm).toBe(0);
  const session = summarizeSession(input({ endedAt: 99_000, endWords: 240 }));
  expect(session?.flowMs).toBe(0);
  expect(session?.wpm).toBe(0);
});

test("history keeps the most recent thirty and replaces duplicates without mutating inputs", () => {
  const list = Array.from(
    { length: 35 },
    (_, i) =>
      summarizeSession(
        input({ startedAt: i * 60_000, endedAt: (i + 1) * 60_000 }),
      )!,
  );
  const previous = structuredClone(list);
  const updated: FlowSession = { ...list[34], words: 99 };
  const result = appendSession(list, updated);
  expect(result).toHaveLength(30);
  expect(result[0].id).toBe(list[5].id);
  expect(result[29].words).toBe(99);
  expect(list).toEqual(previous);
  result[29].words = 1;
  expect(updated.words).toBe(99);
  expect(appendSession(list, updated, 0)).toEqual([]);
  expect(appendSession(list, updated, -1)).toEqual([]);
});

test("a late closing folio cannot displace newer slips in bounded history", () => {
  const newer = summarizeSession(
    input({ startedAt: 200_000, endedAt: 300_000 }),
  )!;
  const older = summarizeSession(input())!;
  expect(appendSession([newer], older, 1)).toEqual([newer]);
});

test("loadFlowSessions reads the metadata key, bounds history and returns plain copies", async () => {
  stored = undefined;
  expect(await loadFlowSessions()).toEqual([]);
  stored = {};
  expect(await loadFlowSessions()).toEqual([]);
  const session = summarizeSession(input())!;
  stored = Array.from({ length: 35 }, () => session);
  const result = await loadFlowSessions();
  expect(result).toHaveLength(30);
  expect(result[0]).toEqual(session);
  result[0].words = 123;
  expect(session.words).toBe(60);
});
