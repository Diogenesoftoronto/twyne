import { describe, expect, test } from "bun:test";
import type { ExtractionRequest, ExtractionResult } from "./extraction";
import {
  daysToReach,
  paceBaseline,
  periodTotalBaseline,
  preferForecast,
  quantile,
  stepsToReach,
} from "./forecast-baselines";
import {
  dailyForecast,
  forecastCacheKey,
  FORECAST_MAX_ATTEMPTS,
  FORECAST_RETRY_DELAYS_MS,
  type CachedForecast,
  type ForecastCacheStore,
} from "./forecast-cache";
import {
  briefWordTarget,
  clientAsk,
  creditForecast,
  creditNeedsNotice,
  dailyHostedSpend,
  finishForecast,
  formatDayRange,
  formatWordRange,
  monthEndDay,
  paceForecast,
} from "./writing-forecasts";
import {
  addDays,
  dayToTime,
  emptyLedger,
  folioDailyGains,
  localDay,
  observeWordCount,
  type PaceLedger,
} from "./writing-pace-ledger";
import type { ProjectBrief } from "../types";

const at = (day: string, hour: number, minute = 0) => {
  const d = new Date(dayToTime(day));
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

function memoryStore(): ForecastCacheStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    load: async (key) => data.get(key),
    save: async (key, value) => void data.set(key, structuredClone(value)),
  };
}

/** A ledger where one draft grows by `perDay` words at 9am and 2pm each day. */
function steadyLedger(today: string, days: number, perDay: number): PaceLedger {
  let ledger = emptyLedger();
  let words = 1_000;
  for (let i = days; i >= 1; i--) {
    const day = addDays(today, -i);
    ledger = observeWordCount(ledger, "f", words, at(day, 8));
    words += perDay / 2;
    ledger = observeWordCount(ledger, "f", words, at(day, 9));
    words += perDay / 2;
    ledger = observeWordCount(ledger, "f", words, at(day, 14));
  }
  return ledger;
}

describe("pace ledger", () => {
  test("counts net words into the local hour and re-baselines on big jumps", () => {
    const day = "2026-10-20";
    let l = observeWordCount(emptyLedger(), "f", 500, at(day, 9));
    l = observeWordCount(l, "f", 650, at(day, 9, 30));
    l = observeWordCount(l, "f", 600, at(day, 10));
    // A paste of 5,000 words is not writing.
    l = observeWordCount(l, "f", 5_600, at(day, 11));
    expect(l.days[day].hours[9]).toBe(150);
    expect(l.days[day].hours[10]).toBe(-50);
    expect(l.days[day].hours[11]).toBe(0);
    expect(l.days[day].folios.f).toEqual({ start: 5_500, end: 5_600 });
  });

  test("a draft's first observation of the day starts from yesterday's count", () => {
    let l = observeWordCount(emptyLedger(), "f", 800, at("2026-10-19", 20));
    l = observeWordCount(l, "f", 900, at("2026-10-20", 8));
    expect(l.days["2026-10-20"].folios.f).toEqual({ start: 800, end: 900 });
    expect(l.days["2026-10-20"].hours[8]).toBe(100);
  });

  test("daily gains fill rest days with zero from the first sighting", () => {
    let l = observeWordCount(emptyLedger(), "f", 100, at("2026-10-15", 9));
    l = observeWordCount(l, "f", 300, at("2026-10-15", 10));
    l = observeWordCount(l, "f", 350, at("2026-10-18", 10));
    const { gains, observedDays } = folioDailyGains(l, "f", "2026-10-20", 28);
    expect(gains).toEqual([200, 0, 0, 50, 0, 0]);
    expect(observedDays).toBe(6);
  });
});

describe("baselines", () => {
  test("quantile interpolates", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.1)).toBeCloseTo(1);
  });

  test("pace adds what usually comes after this hour, by weekday when it can", () => {
    const hours = (morning: number, evening: number) =>
      Array.from({ length: 24 }, (_, h) => (h === 9 ? morning : h === 20 ? evening : 0));
    const history = [
      { weekday: 2, hours: hours(300, 400) },
      { weekday: 2, hours: hours(300, 600) },
      { weekday: 2, hours: hours(300, 500) },
      { weekday: 3, hours: hours(900, 0) },
    ];
    const p = paceBaseline({ history, weekday: 2, hourNow: 12, wordsSoFar: 300 })!;
    expect(p.days).toBe(3);
    expect(p.median).toBe(800);
    expect(p.p10).toBeCloseTo(720);
    expect(p.p90).toBeCloseTo(880);
  });

  test("pace needs three writing days", () => {
    const history = [{ weekday: 1, hours: Array(24).fill(10) }];
    expect(paceBaseline({ history, weekday: 1, hourNow: 9, wordsSoFar: 90 })).toBeNull();
  });

  test("days to reach a total: median is remaining / mean, interval brackets it", () => {
    const r = daysToReach([400, 600, 500, 300, 700], 5_000)!;
    expect(r.median).toBe(10);
    expect(r.p10).toBeLessThan(10);
    expect(r.p90).toBeGreaterThan(10);
    // Perfectly steady pace collapses the interval.
    const flat = daysToReach([500, 500, 500], 2_000)!;
    expect(flat).toEqual({ median: 4, p10: 4, p90: 4 });
    expect(daysToReach([0, -20, 10], 1_000)).toBeNull();
    expect(daysToReach([500, 500], 1_000)).toBeNull();
  });

  test("period total uses weekday means once every weekday has three samples", () => {
    const history = Array.from({ length: 21 }, (_, i) => ({
      weekday: i % 7,
      amount: i % 7 === 6 ? 700 : 100,
    }));
    const r = periodTotalBaseline({ history, spentSoFar: 1_000, upcoming: [5, 6] })!;
    expect(r.median).toBeCloseTo(1_800);
    expect(r.p10).toBeCloseTo(1_800);
    const flat = periodTotalBaseline({
      history: history.slice(0, 7),
      spentSoFar: 0,
      upcoming: [5, 6],
    })!;
    expect(flat.median).toBeCloseTo(2 * (1_300 / 7));
    expect(flat.p90).toBeGreaterThan(flat.median);
  });

  test("the model only wins near the baseline and with enough history", () => {
    const base = { median: 100, p10: 80, p90: 120 };
    const near = { median: 125, p10: 100, p90: 150 };
    const far = { median: 300, p10: 250, p90: 350 };
    expect(preferForecast(base, near, true)?.source).toBe("clairic");
    expect(preferForecast(base, near, false)?.source).toBe("baseline");
    expect(preferForecast(base, far, true)?.source).toBe("baseline");
    expect(preferForecast(base, null, true)?.value).toEqual(base);
    expect(preferForecast(null, near, true)).toBeNull();
  });

  test("steps to reach reads the fast edge from p90 and slow edge from p10", () => {
    const steps = Array.from({ length: 5 }, () => ({ median: 100, p10: 50, p90: 200 }));
    expect(stepsToReach(steps, 300)).toEqual({ median: 3, p10: 2, p90: null });
    expect(stepsToReach(steps, 200)).toEqual({ median: 2, p10: 1, p90: 4 });
    expect(stepsToReach(steps, 1_000)).toBeNull();
  });
});

describe("daily forecast cache", () => {
  test("asks once per surface per day and replays the answer", async () => {
    const store = memoryStore();
    let calls = 0;
    const ask = async () => {
      calls += 1;
      return [{ median: 1, p10: 0, p90: 2 }];
    };
    const a = await dailyForecast({ surface: "pace", accountId: "acct", scope: "all", day: "2026-10-20", ask, store });
    const b = await dailyForecast({ surface: "pace", accountId: "acct", scope: "all", day: "2026-10-20", ask, store });
    expect(calls).toBe(1);
    expect(b?.steps).toEqual(a!.steps);
    await dailyForecast({ surface: "pace", accountId: "acct", scope: "all", day: "2026-10-21", ask, store });
    expect(calls).toBe(2);
  });

  test("a failed call backs off, recovers, and keeps the successful result for the day", async () => {
    const store = memoryStore();
    let calls = 0;
    const ask = async () => {
      calls += 1;
      if (calls === 1) throw new Error("gateway down");
      return [{ median: 2, p10: 1, p90: 3 }];
    };
    const input = { surface: "finish" as const, accountId: "acct", scope: "a", day: "2026-10-20", ask, store };
    const now = at(input.day, 12);
    const first = await dailyForecast({ ...input, now });
    expect(first?.steps).toEqual([]);
    await dailyForecast({ ...input, now: now + FORECAST_RETRY_DELAYS_MS[0] - 1 });
    expect(calls).toBe(1);
    const recovered = await dailyForecast({ ...input, now: now + FORECAST_RETRY_DELAYS_MS[0] });
    expect(recovered?.steps).toEqual([{ median: 2, p10: 1, p90: 3 }]);
    expect(calls).toBe(2);
    const replay = await dailyForecast({ ...input, now: now + 3_600_000 });
    expect(replay).toEqual(recovered);
    const other = await dailyForecast({ ...input, scope: "b", now: now + 3_600_000 });
    expect(other).toBeNull();
    expect(calls).toBe(2);
    expect((store.data.get(forecastCacheKey("finish", "acct")) as CachedForecast).scope).toBe("a");
  });

  test("repeated empty or failed answers have a bounded daily retry budget", async () => {
    const store = memoryStore();
    let calls = 0;
    const ask = async () => { calls += 1; return []; };
    const input = { surface: "pace" as const, accountId: "acct", scope: "all", day: "2026-10-20", ask, store };
    const now = at(input.day, 12);
    for (let i = 0; i < 10; i++) await dailyForecast({ ...input, now: now + i * 3_600_000 });
    expect(calls).toBe(FORECAST_MAX_ATTEMPTS);
    await dailyForecast({ ...input, day: "2026-10-21", now: now + 24 * 3_600_000 });
    expect(calls).toBe(FORECAST_MAX_ATTEMPTS + 1);
  });

  test("concurrent callers share one call", async () => {
    const store = memoryStore();
    let calls = 0;
    const ask = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return [];
    };
    await Promise.all([
      dailyForecast({ surface: "credit", accountId: "acct", scope: "x", day: "2026-10-20", ask, store }),
      dailyForecast({ surface: "credit", accountId: "acct", scope: "x", day: "2026-10-20", ask, store }),
    ]);
    expect(calls).toBe(1);
  });

  test("accounts never share persisted or in-flight forecast responses", async () => {
    const store = memoryStore();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const input = { surface: "pace" as const, scope: "all", day: "2026-10-20", store };
    const a = dailyForecast({ ...input, accountId: "a", ask: async () => {
      await pending;
      return [{ median: 100, p10: 90, p90: 110 }];
    } });
    const b = await dailyForecast({ ...input, accountId: "b", ask: async () =>
      [{ median: 200, p10: 190, p90: 210 }],
    });
    expect(b?.steps[0].median).toBe(200);
    release();
    expect((await a)?.steps[0].median).toBe(100);
    const replay = await dailyForecast({ ...input, accountId: "b", ask: async () => {
      throw new Error("already cached");
    } });
    expect(replay?.steps[0].median).toBe(200);
  });
});

describe("surfaces", () => {
  const today = "2026-10-20";

  test("a signed-out refresh does not consume forecast eligibility after sign-in", async () => {
    let ledger = steadyLedger(today, 20, 600);
    ledger = observeWordCount(ledger, "f", ledger.last.f + 300, at(today, 9, 30));
    const store = memoryStore();
    let calls = 0;
    const ask = async (): Promise<ExtractionResult> => {
      calls += 1;
      return { ok: true, answers: { next: {
        type: "forecast", value: null,
        median: [300], p10: [250], p90: [350],
      } } };
    };
    const signedOut = await paceForecast(ledger, at(today, 12), { ask, store });
    expect(signedOut?.source).toBe("baseline");
    expect(calls).toBe(0);
    expect(store.data.size).toBe(0);
    const signedIn = await paceForecast(ledger, at(today, 12), { ask, accountId: "acct", store });
    expect(signedIn?.source).toBe("clairic");
    expect(calls).toBe(1);
    expect(clientAsk(undefined, "acct")).toBeUndefined();
    expect(clientAsk({} as Parameters<typeof clientAsk>[0], undefined)).toBeUndefined();
  });

  test("pace stays quiet before the writer has started today", async () => {
    const ledger = steadyLedger(today, 10, 600);
    expect(await paceForecast(ledger, at(today, 12))).toBeNull();
  });

  test("pace from the baseline; Clairic not asked on thin history", async () => {
    let ledger = steadyLedger(today, 6, 600);
    ledger = observeWordCount(ledger, "f", ledger.last.f + 300, at(today, 9, 30));
    let asked = 0;
    const ask = async (): Promise<ExtractionResult> => {
      asked += 1;
      return { ok: true };
    };
    const p = (await paceForecast(ledger, at(today, 12), { ask, accountId: "acct", store: memoryStore() }))!;
    expect(asked).toBe(0);
    expect(p.source).toBe("baseline");
    expect(p.wordsSoFar).toBe(300);
    expect(p.median).toBe(600);
  });

  test("pace takes a nearby Clairic answer once there are two weeks", async () => {
    let ledger = steadyLedger(today, 20, 600);
    ledger = observeWordCount(ledger, "f", ledger.last.f + 300, at(today, 9, 30));
    let request: ExtractionRequest | undefined;
    const ask = async (r: ExtractionRequest): Promise<ExtractionResult> => {
      request = r;
      const n = r.fields.next.horizon!;
      const step = (h: number) => (h === 2 ? 320 : 0);
      return {
        ok: true,
        answers: {
          next: {
            type: "forecast",
            value: null,
            median: Array.from({ length: n }, (_, i) => step(i)),
            p10: Array.from({ length: n }, (_, i) => step(i) * 0.5),
            p90: Array.from({ length: n }, (_, i) => step(i) * 1.5),
          },
        },
      };
    };
    const p = (await paceForecast(ledger, at(today, 12), { ask, accountId: "acct", store: memoryStore() }))!;
    expect(request?.fields.next.interval).toBe("hour");
    expect(request?.fields.next.horizon).toBe(12);
    expect(p.source).toBe("clairic");
    expect(p.median).toBe(620);
  });

  test("finish needs a stated word target", async () => {
    const ledger = steadyLedger(today, 10, 500);
    const base = { ledger, folioId: "f", currentWords: ledger.last.f, now: at(today, 12) };
    expect(await finishForecast({ ...base, target: null })).toBeNull();
    const f = (await finishForecast({ ...base, target: ledger.last.f + 2_000 }))!;
    expect(f.median).toBe(addDays(today, 4));
    expect(f.source).toBe("baseline");
    expect(await finishForecast({ ...base, target: 100 })).toBeNull();
  });

  test("a slow scenario beyond the horizon remains an unknown latest target date", async () => {
    const ledger = steadyLedger(today, 20, 500);
    const ask = async (request: ExtractionRequest): Promise<ExtractionResult> => {
      const count = request.fields.next.horizon!;
      return { ok: true, answers: { next: {
        type: "forecast", value: null,
        median: Array(count).fill(400),
        p10: Array(count).fill(0),
        p90: Array(count).fill(700),
      } } };
    };
    const f = await finishForecast({
      ledger, folioId: "f", currentWords: ledger.last.f,
      target: ledger.last.f + 2_000, now: at(today, 12),
      options: { ask, accountId: "acct", store: memoryStore() },
    });
    expect(f?.source).toBe("clairic");
    expect(f?.median).toBe(addDays(today, 4));
    expect(f?.early).toBe(addDays(today, 2));
    expect(f?.late).toBeNull();
    expect(formatDayRange(f!.early, f!.late, "en-US")).toBe("Oct 22 or later");
  });

  test("a model that cannot reach the word target keeps the baseline", async () => {
    const ledger = steadyLedger(today, 20, 500);
    const f = await finishForecast({
      ledger, folioId: "f", currentWords: ledger.last.f,
      target: ledger.last.f + 2_000, now: at(today, 12),
      options: { accountId: "acct", store: memoryStore(), ask: async () => ({
        ok: true, answers: { next: {
          type: "forecast", value: null, median: [1], p10: [0], p90: [1],
        } },
      }) },
    });
    expect(f?.source).toBe("baseline");
    expect(f?.late).toBe(addDays(today, 4));
  });

  test("brief word targets come from format and constraints only", () => {
    const brief = (format: string, constraints = ""): ProjectBrief => ({
      answers: {
        workingTitle: "",
        format,
        audience: "",
        goal: "Reach 40 words of praise",
        tone: "",
        constraints,
        successSignal: "",
      },
      attachments: [],
      completedAt: 0,
      updatedAt: 0,
    });
    expect(briefWordTarget(brief("An op-ed, about 1,200 words"))).toBe(1_200);
    expect(briefWordTarget(brief("Essay", "Keep it 3–5k words"))).toBe(3_000);
    expect(briefWordTarget(brief("A 2.5k word feature"))).toBe(2_500);
    expect(briefWordTarget(brief("A chapter, twelve pages"))).toBeNull();
    expect(briefWordTarget(brief("A newsletter"))).toBeNull();
    expect(briefWordTarget(null)).toBeNull();
  });

  test("credit runway: month projection and run-out day", async () => {
    const history = Array.from({ length: 14 }, (_, i) => ({
      day: addDays(today, i - 14),
      micros: 200_000,
    }));
    const f = (await creditForecast({
      history,
      spentMicros: 3_000_000,
      availableMicros: 1_000_000,
      now: at(today, 12),
      scope: "acct",
    }))!;
    expect(f.monthEnd).toBe("2026-10-31");
    expect(f.month.median).toBeCloseTo(3_000_000 + 11 * 200_000);
    expect(f.runsOut?.median).toBe(addDays(today, 5));
    expect(f.outlastsMonth).toBe(false);
    expect(creditNeedsNotice(f, at(today, 12))).toBe(true);

    const rich = (await creditForecast({
      history,
      spentMicros: 0,
      availableMicros: 50_000_000,
      now: at(today, 12),
      scope: "acct",
    }))!;
    expect(rich.runsOut).toBeNull();
    expect(rich.outlastsMonth).toBe(true);
    expect(creditNeedsNotice(rich, at(today, 12))).toBe(false);
  });

  test("hosted spend groups by local day and skips other sources", () => {
    const days = dailyHostedSpend(
      [
        { occurredAt: at("2026-10-18", 10), source: "hosted", costMicrousd: 5 },
        { occurredAt: at("2026-10-18", 11), source: "hosted", costMicrousd: 7 },
        { occurredAt: at("2026-10-19", 11), source: "byok", costMicrousd: 99 },
      ],
      today,
    );
    expect(days).toEqual([
      { day: "2026-10-18", micros: 12 },
      { day: "2026-10-19", micros: 0 },
    ]);
  });

  test("credit does not invent a run-out upper date beyond the model horizon", async () => {
    const f = await creditForecast({
      history: Array.from({ length: 14 }, (_, i) => ({ day: addDays(today, i - 14), micros: 200_000 })),
      spentMicros: 0, availableMicros: 1_000_000, now: at(today, 12), scope: "acct",
      options: { store: memoryStore(), ask: async (request) => {
        const count = request.fields.next.horizon!;
        return { ok: true, answers: { next: {
          type: "forecast", value: null,
          median: Array(count).fill(0.2), p10: Array(count).fill(0), p90: Array(count).fill(0.3),
        } } };
      } },
    });
    expect(f?.source).toBe("clairic");
    expect(f?.runsOut?.median).toBe(addDays(today, 5));
    expect(f?.runsOut?.late).toBeNull();
  });

  test("formatting is compact", () => {
    expect(formatWordRange({ median: 900, p10: 702, p90: 1_118 }, "en-US")).toBe("700–1,100");
    expect(formatDayRange("2026-11-08", "2026-11-25", "en-US")).toBe("Nov 8 – 25");
    expect(formatDayRange("2026-10-29", "2026-11-04", "en-US")).toBe("Oct 29 – Nov 4");
    expect(formatDayRange("2026-11-08", null, "en-US")).toBe("Nov 8 or later");
    expect(monthEndDay("2026-02-10")).toBe("2026-02-28");
    expect(localDay(at("2026-10-20", 23, 59))).toBe("2026-10-20");
  });
});
