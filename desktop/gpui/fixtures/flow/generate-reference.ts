// Executes the current original pure functions; never duplicates the detector.
import {
  DEFAULT_THRESHOLDS,
  readFlow,
  trimSamples,
  isQuiet,
  type FlowMode,
  type KeySample,
} from "../../../../src/utils/flow-state";
import {
  emptyProfile,
  normalizeProfile,
  recordPause,
  recordRun,
  recordFlowEntry,
  recordOverride,
  recordItem,
  thresholdsFor,
  kindWeight,
  quantile,
  writingHours,
} from "../../../../src/utils/flow-profile";
import {
  summarizeSession,
  appendSession,
  type FlowSession,
  type FlowSessionEnd,
} from "../../../../src/utils/flow-session";

const modes: FlowMode[] = ["away", "working", "settling", "flow", "stuck"];
const readings: unknown[] = [];
function readingCase(
  name: string,
  samples: KeySample[],
  now: number,
  previous: FlowMode = "working",
  context: { struggle?: number; reaching?: boolean } = {},
  thresholds = DEFAULT_THRESHOLDS,
) {
  readings.push({
    name,
    input: { samples, now, previous, context, thresholds },
    expected: readFlow(samples, now, previous, thresholds, context),
  });
}
const run = (end: number, inserted = 4, deleted = 0, step = 1_000) =>
  Array.from({ length: Math.floor(end / step) + 1 }, (_, index) => ({
    at: index * step,
    inserted,
    deleted,
  }));
for (const previous of modes) readingCase(`empty-${previous}`, [], 0, previous);
for (const end of [0, 999, 1_000, 29_000, 30_000, 89_000, 90_000, 180_000]) {
  readingCase(`steady-${end}`, run(end), end);
}
for (const pause of [
  3_999, 4_000, 4_001, 17_999, 18_000, 24_999, 25_000, 179_999, 180_000,
]) {
  for (const previous of modes) {
    readingCase(
      `pause-${pause}-${previous}`,
      run(90_000, 3, 2),
      90_000 + pause,
      previous,
    );
  }
}
readingCase("reaching-beats-flow", run(90_000), 90_001, "flow", {
  reaching: true,
});
readingCase("away-beats-reaching", run(90_000), 270_000, "flow", {
  reaching: true,
});
readingCase("struggle-boundary", run(30_000), 48_000, "working", {
  struggle: 0.5,
});
readingCase("struggle-below-boundary", run(30_000), 48_000, "working", {
  struggle: 0.4999,
});
readingCase("rewrite-in-flow", run(90_000, 1, 9), 90_010, "flow");
readingCase("settling-rewrite-stays", run(30_000, 1, 9), 30_010, "settling");
readingCase("future-key", [{ at: 2_000, inserted: 1, deleted: 0 }], 1_000);
for (const gap of [3_999, 4_000, 4_001]) {
  readingCase(
    `run-gap-${gap}`,
    [...run(30_000), { at: 30_000 + gap, inserted: 4, deleted: 0 }],
    30_000 + gap,
  );
}
for (const step of [1_000, 2_000, 3_000, 4_000]) {
  readingCase(`active-${step}`, run(120_000, 5, 0, step), 120_000);
}
readingCase(
  "recent-includes-sixty-seconds",
  [
    { at: 0, inserted: 0, deleted: 40 },
    { at: 60_000, inserted: 60, deleted: 0 },
  ],
  78_000,
);
readingCase(
  "recent-excludes-older",
  [
    { at: 0, inserted: 0, deleted: 40 },
    { at: 60_001, inserted: 60, deleted: 0 },
  ],
  78_001,
);
// Deterministic traces exercise sticky ordering, short runs and edit ratios.
let seed = 0x7477796e;
const random = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
};
for (let trace = 0; trace < 100; trace++) {
  let at = 1_000_000;
  const samples: KeySample[] = [];
  for (let index = 0; index < 40 + (random() % 120); index++) {
    at += random() % 5_001;
    samples.push({ at, inserted: random() % 8, deleted: random() % 5 });
  }
  readingCase(
    `trace-${trace}`,
    samples,
    at + (random() % 200_001),
    modes[trace % modes.length],
    { struggle: (random() % 101) / 100, reaching: trace % 13 === 0 },
  );
}

const trims = [
  { samples: run(10_000), now: 610_000, keepMs: 600_000 },
  { samples: run(10_000), now: 610_001, keepMs: 600_000 },
  { samples: run(10_000), now: 10_000, keepMs: 4_000 },
  { samples: [], now: 0, keepMs: 0 },
].map((input) => ({
  input,
  expected: trimSamples(input.samples, input.now, input.keepMs),
}));
const normalized = [
  null,
  false,
  [],
  {},
  {
    pauses: [1, "2", null, 3],
    runs: [4, 5],
    flowEntries: [NaN, Infinity, 6],
    hours: Array(23).fill(1),
    kinds: { unknown: { shown: 7, engaged: 2, dismissed: 1, future: "kept" } },
    overrides: 2,
    updatedAt: 9,
  },
  {
    version: 99,
    pauses: Array.from({ length: 250 }, (_, index) => index),
    runs: Array.from({ length: 250 }, (_, index) => index / 3),
    flowEntries: [1, 2],
    hours: Array.from({ length: 24 }, (_, hour) => hour),
    kinds: [],
    overrides: "2",
    updatedAt: "9",
  },
].map((input) => ({ input, expected: normalizeProfile(input) }));
const actions = [
  { kind: "pause", ms: 1_499, now: 1 },
  { kind: "pause", ms: 1_500, now: 2 },
  { kind: "pause", ms: 2_500.5, now: 3 },
  { kind: "pause", ms: 600_000, now: 4 },
  { kind: "pause", ms: 600_001, now: 5 },
  { kind: "run", ms: 4_999, now: 6, hour: 7 },
  { kind: "run", ms: 5_000, now: 7, hour: 23 },
  { kind: "run", ms: 120_000.5, now: 8, hour: 7 },
  { kind: "entry", ms: 90_000.5, now: 9 },
  { kind: "override", now: 10 },
  { kind: "item", itemKind: "note", outcome: "shown", now: 11 },
  { kind: "item", itemKind: "note", outcome: "engaged", now: 12 },
  { kind: "item", itemKind: "note", outcome: "dismissed", now: 13 },
  { kind: "item", itemKind: "unknown", outcome: "engaged", now: 14 },
] as const;
let profile = normalizeProfile({
  kinds: { unknown: { shown: 7, engaged: 2, dismissed: 1, future: "kept" } },
});
const recorded = [];
for (const action of actions) {
  const before = profile;
  switch (action.kind) {
    case "pause":
      profile = recordPause(profile, action.ms, action.now);
      break;
    case "run":
      profile = recordRun(profile, action.ms, action.now, action.hour);
      break;
    case "entry":
      profile = recordFlowEntry(profile, action.ms, action.now);
      break;
    case "override":
      profile = recordOverride(profile, action.now);
      break;
    case "item":
      profile = recordItem(
        profile,
        action.itemKind,
        action.outcome,
        action.now,
      );
      break;
  }
  recorded.push({ action, before, expected: profile });
}
const learned = [
  {},
  { pauses: Array(11).fill(20_000), flowEntries: Array(4).fill(180_000) },
  { pauses: Array(12).fill(20_000), flowEntries: Array(5).fill(180_000) },
  {
    pauses: Array.from({ length: 24 }, (_, index) => 1_500 + index * 250),
    flowEntries: [40_000, 70_000, 100_000, 200_000, 400_000],
  },
  { pauses: Array(12).fill(600_000), flowEntries: Array(5).fill(500_000) },
  { pauses: Array(12).fill(1_500), flowEntries: Array(5).fill(20_000) },
].map((raw) => {
  const input = normalizeProfile(raw);
  return { input, expected: thresholdsFor(input) };
});
const weights = [
  { kinds: {} },
  { kinds: { note: { shown: 0, engaged: 0, dismissed: 0 } } },
  { kinds: { note: { shown: 100, engaged: 100, dismissed: 0 } } },
  { kinds: { note: { shown: 100, engaged: 0, dismissed: 100 } } },
].map((raw) => {
  const input = normalizeProfile(raw);
  return { input, kind: "note", expected: kindWeight(input, "note") };
});
const hourProfile = {
  ...emptyProfile(),
  hours: Array.from({ length: 24 }, (_, hour) =>
    [7, 9, 11, 22].includes(hour) ? 30 : 0,
  ),
};
const hours = [0, 1, 3, 30].map((top) => ({
  input: hourProfile,
  top,
  expected: writingHours(hourProfile, top),
}));
const quantiles = [[], [1], [1, 9], [9, 1, 5, 3]].flatMap((values) =>
  [-1, 0, 0.1, 0.5, 0.75, 0.9, 1, 2].map((q) => ({
    values,
    q,
    expected: quantile(values, q),
  })),
);

const sessionInputs = [
  { endedAt: 59_999, endWords: 39.49, ended: "pause" },
  { endedAt: 59_999, endWords: 39.5, ended: "reached" },
  { endedAt: 60_000, endWords: -3, ended: "manual" },
  { endedAt: 120_000, endWords: 81.5, ended: "away" },
  { endedAt: -10, endWords: 40, ended: "closed" },
].map((values) => ({
  folioId: "folio:one",
  startedAt: 0,
  startWords: 0,
  waited: ["a", "a", "b"],
  amendments: ["one", "one"],
  ...values,
}));
const summaries = sessionInputs.map((input) => ({
  input,
  expected: summarizeSession({
    ...input,
    ended: input.ended as FlowSessionEnd,
    waited: new Set(input.waited),
    amendments: new Set(input.amendments),
  }),
}));
const session = (
  id: string,
  startedAt: number,
  endedAt: number,
): FlowSession => ({
  id,
  folioId: "f",
  startedAt,
  endedAt,
  flowMs: endedAt - startedAt,
  words: 1,
  wpm: 1,
  waited: 0,
  amendments: 0,
  ended: "pause",
});
const sessionList = [
  session("b", 1, 10),
  session("a", 1, 10),
  session("c", 2, 20),
  session("b", 2, 10),
];
const appended = [0, 1, 2, 30].map((max) => ({
  list: sessionList,
  session: session("a", 1, 10),
  max,
  expected: appendSession(sessionList, session("a", 1, 10), max),
}));

await Bun.write(
  new URL("web-reference.json", import.meta.url),
  JSON.stringify(
    {
      provenance:
        "Executed current src/utils/flow-state.ts, flow-profile.ts and flow-session.ts with Bun. Empty pause Infinity is JSON null; no words, providers or network are read.",
      readings,
      trims,
      normalized,
      recorded,
      learned,
      weights,
      hours,
      quantiles,
      summaries,
      appended,
      quiet: modes.map((mode) => ({ mode, expected: isQuiet(mode) })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    readings: readings.length,
    profileActions: recorded.length,
    sessions: summaries.length + appended.length,
  }),
);
