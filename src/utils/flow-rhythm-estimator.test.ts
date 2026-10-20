import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { emptyProfile } from "./flow-profile";
import {
  __resetExtractionBudgetForTests,
  extractionWait,
  MAX_RHYTHM_CALLS_PER_SESSION,
} from "./extraction-budget";
import {
  ESTIMATE_TIMEOUT_MS,
  FlowRhythmEstimator,
  rhythmRequest,
} from "./flow-rhythm-estimator";
import type { ExtractionRequest, ExtractionResult } from "./extraction";

let now = 100_000;
const restores: Array<() => void> = [];
const estimators: FlowRhythmEstimator[] = [];
beforeEach(() => {
  now = 100_000;
  __resetExtractionBudgetForTests();
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  restores.push(() => clock.mockRestore());
});
afterEach(() => {
  for (const estimator of estimators.splice(0)) estimator.invalidate();
  for (const restore of restores.splice(0).reverse()) restore();
});
const result: ExtractionResult = {
  ok: true,
  answers: {
    focus_remaining: {
      type: "estimate",
      value: 100,
      p10: 80,
      median: 100,
      p90: 120,
    },
    pause_length: { type: "estimate", value: 10, p10: 5, median: 10, p90: 20 },
  },
};
const input = (
  ask?: (request: ExtractionRequest) => Promise<ExtractionResult>,
) => ({
  now,
  lastKeyAt: now - 4000,
  runStartedAt: now - 94_000,
  runSeconds: 90,
  deleteRatio: 0.1,
  exitPauseMs: 25_000,
  samples: [{ at: now - 4000, inserted: 5, deleted: 0 }],
  profile: {
    ...emptyProfile(),
    runs: Array(8).fill(240_000),
    pauses: Array(8).fill(10_000),
  },
  ask,
});
const estimator = () => {
  const e = new FlowRhythmEstimator();
  estimators.push(e);
  return e;
};
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("one request has two log estimates and only compact rhythm state", () => {
  const request = rhythmRequest(input(), { focus: null, pause: null });
  expect(Object.keys(request.fields)).toEqual([
    "focus_remaining",
    "pause_length",
  ]);
  expect(request.fields.focus_remaining).toMatchObject({
    type: "estimate",
    min: 1,
    max: 3600,
    unit: "seconds",
    scale: "log",
    step: 1,
  });
  expect(request.fields.pause_length).toMatchObject({
    min: 1,
    max: 600,
    scale: "log",
  });
  expect(request.state).toContain("local_hour=");
  expect(request.state).toContain(
    "key_events_per_10_seconds_oldest_first=0,0,0,0,0,1",
  );
  expect(request.state).not.toContain("inserted");
  expect(request.state).not.toContain("word");
});
test("baseline always works; signed-out and insufficient-history inputs do not spend", async () => {
  const e = estimator();
  e.begin(input());
  expect(e.selected()?.source).toBe("baseline");
  expect(e.decision(now, 25_000)).toBe("hold");
  e.key(now - 4000, now + 1000);
  let calls = 0;
  e.begin({
    ...input(async () => {
      calls++;
      return result;
    }),
    profile: emptyProfile(),
  });
  await flush();
  expect(calls).toBe(0);
  expect(e.decision(now, 25_000)).toBe("timer");
});
test("shadow estimates are logged once per pause; resolved outcomes are paired", async () => {
  let calls = 0;
  const ask = async () => {
    calls++;
    return result;
  };
  const e = estimator();
  e.begin(input(ask));
  e.begin(input(ask));
  await flush();
  expect(calls).toBe(1);
  expect(e.log.map((p) => p.source)).toEqual(["baseline", "clairic"]);
  expect(e.selected()?.source).toBe("baseline");
  e.key(now - 4000, now + 6000);
  e.finishRun(now - 94_000, now + 50_000);
  expect(e.log.map((p) => [p.actualFocus, p.actualPause])).toEqual([
    [50, 6],
    [50, 6],
  ]);
  e.begin(input(ask)); // Even invalidating a pause cannot spend on it twice.
  await flush();
  expect(calls).toBe(1);
});
test("a key, teardown, account change, or deadline drops a late answer", async () => {
  for (const cause of ["key", "stop", "account", "deadline"] as const) {
    __resetExtractionBudgetForTests();
    const e = estimator();
    const pending = deferred<ExtractionResult>();
    let current = true;
    e.begin({ ...input(() => pending.promise), current: () => current });
    await flush();
    if (cause === "key") e.key(now - 4000, now + 1);
    if (cause === "stop") e.invalidate();
    if (cause === "account") current = false;
    if (cause === "deadline") now += ESTIMATE_TIMEOUT_MS + 1;
    pending.resolve(result);
    await flush();
    expect(e.log.filter((p) => p.source === "clairic")).toHaveLength(0);
  }
});
test("timeout backs off without awaiting the provider and errors cannot retry that pause", async () => {
  let expire: (() => void) | undefined;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(((
    fn: () => void,
  ) => {
    expire = fn;
    return 1;
  }) as typeof setTimeout);
  restores.push(() => timer.mockRestore());
  const e = estimator();
  const pending = deferred<ExtractionResult>();
  e.begin(input(() => pending.promise));
  await flush();
  expire!();
  expect(extractionWait(now)).toBe(30_000);
  pending.resolve(result);
  await flush();
  expect(e.log).toHaveLength(1);
});
test("unconfigured service disables future calls, and malformed intervals back off", async () => {
  const e = estimator();
  let calls = 0;
  const unavailable = async () => {
    calls++;
    return { ok: false, error: "unconfigured" };
  };
  e.begin(input(unavailable));
  await flush();
  now += 61_000;
  e.key(now - 65_000, now - 4000);
  e.begin(input(unavailable));
  await flush();
  expect(calls).toBe(1);
  const bad = estimator();
  bad.begin(
    input(async () => ({
      ok: true,
      answers: {
        ...result.answers,
        focus_remaining: {
          type: "estimate",
          value: 10,
          p10: NaN,
          median: 10,
          p90: 15,
        },
      },
    })),
  );
  await flush();
  expect(bad.log).toHaveLength(1);
  expect(extractionWait(now)).toBe(30_000);
});
test("twelve-call session cap holds after the rolling rate window expires", async () => {
  const e = estimator();
  let calls = 0;
  for (let i = 0; i < MAX_RHYTHM_CALLS_PER_SESSION + 3; i++) {
    now += 61_000;
    e.begin(
      input(async () => {
        calls++;
        return result;
      }),
    );
    await flush();
    e.key(now - 4000, now + 1000);
  }
  expect(calls).toBe(MAX_RHYTHM_CALLS_PER_SESSION);
});
test("a predicted break uses the selected baseline while Clairic is untrusted", async () => {
  const e = estimator();
  e.begin({
    ...input(async () => result),
    profile: { ...input().profile, pauses: Array(8).fill(80_000) },
  });
  await flush();
  expect(e.breakPrediction("folio")?.pause?.p10).toBe(76);
});

test("qualified model evidence can control the gate; a new estimate remains paired", async () => {
  const e = estimator();
  e.log = Array.from({ length: 20 }, (_, i) => {
    const actual = i % 5 === 0 ? 31 : 20;
    return (["baseline", "clairic"] as const).map((source) => ({
      id: `old:${i}`,
      source,
      at: 1,
      runStartedAt: 0,
      lastKeyAt: 0,
      runSeconds: 0,
      pauseSeconds: 0,
      estimate:
        source === "baseline"
          ? {
              focus: { p10: 1, median: 50, p90: 100 },
              pause: { p10: 1, median: 50, p90: 100 },
            }
          : {
              focus: { p10: 10, median: 20, p90: 30 },
              pause: { p10: 10, median: 20, p90: 30 },
            },
      actualFocus: actual,
      actualPause: actual,
    }));
  }).flat();
  let current = true;
  e.begin({
    ...input(async () => ({
      ...result,
      answers: {
        ...result.answers,
        focus_remaining: {
          type: "estimate",
          value: 5,
          p10: 1,
          median: 5,
          p90: 9,
        },
      },
    })),
    current: () => current,
  });
  await flush();
  expect(e.selected()?.source).toBe("clairic");
  expect(e.decision(now, 25_000)).toBe("release");
  current = false;
  expect(e.selected()?.source).toBe("baseline");
});
