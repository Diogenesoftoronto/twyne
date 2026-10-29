import { describe, expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { dailyCreditRunway } from "./credit-runway";
import { FORECAST_MAX_ATTEMPTS, FORECAST_RETRY_DELAYS_MS } from "./forecast-cache";
import type { CreditForecast } from "./writing-forecasts";

type Options = NonNullable<Parameters<typeof dailyCreditRunway>[3]>;

function memoryStore(): NonNullable<Options["store"]> {
  const data = new Map();
  return {
    load: async (key) => data.get(key),
    save: async (key, value) => void data.set(key, structuredClone(value)),
  };
}

const client = {} as ConvexClient;
const now = new Date(2026, 9, 20, 12).getTime();
const runway = (source: CreditForecast["source"]): CreditForecast => ({
  month: { median: 100, p10: 80, p90: 120 },
  spentMicros: 0,
  availableMicros: 1_000,
  runsOut: null,
  outlastsMonth: true,
  monthEnd: "2026-10-31",
  source,
});

describe("credit runway cache recovery", () => {
  test("a temporary account-service error recovers after backoff", async () => {
    const store = memoryStore();
    let calls = 0;
    const calculate = async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary gateway failure");
      return runway("clairic");
    };
    const options = { store, calculate };
    expect(await dailyCreditRunway(client, "a", now, options)).toBeNull();
    expect(await dailyCreditRunway(client, "a", now + 1, options)).toBeNull();
    expect(calls).toBe(1);
    const recovered = await dailyCreditRunway(client, "a", now + FORECAST_RETRY_DELAYS_MS[0], options);
    expect(recovered?.source).toBe("clairic");
    expect(calls).toBe(2);
    expect(await dailyCreditRunway(client, "a", now + 3_600_000, options)).toEqual(recovered);
    expect(calls).toBe(2);
  });

  test("a baseline can recover without unbounded retries or duplicate concurrent calls", async () => {
    const store = memoryStore();
    let calls = 0;
    const calculate = async () => { calls += 1; return runway("baseline"); };
    const options = { store, calculate };
    await Promise.all([
      dailyCreditRunway(client, "a", now, options),
      dailyCreditRunway(client, "a", now, options),
    ]);
    expect(calls).toBe(1);
    for (let i = 1; i <= 8; i++)
      await dailyCreditRunway(client, "a", now + i * 3_600_000, options);
    expect(calls).toBe(FORECAST_MAX_ATTEMPTS);
  });

  test("accounts do not reuse each other's wallet forecasts", async () => {
    const store = memoryStore();
    const calculate: NonNullable<Options["calculate"]> = async (_client, accountId) => ({
      ...runway("clairic"), availableMicros: accountId === "a" ? 100 : 900,
    });
    const options = { store, calculate };
    const [a, b] = await Promise.all([
      dailyCreditRunway(client, "a", now, options),
      dailyCreditRunway(client, "b", now, options),
    ]);
    expect(a?.availableMicros).toBe(100);
    expect(b?.availableMicros).toBe(900);
    expect((await dailyCreditRunway(client, "a", now, options))?.availableMicros).toBe(100);
    expect((await dailyCreditRunway(client, "b", now, options))?.availableMicros).toBe(900);
  });

  test("an account change discards a pending result before it can enter the cache", async () => {
    const store = memoryStore();
    let current = true;
    const calculate = async () => {
      current = false;
      return runway("clairic");
    };
    expect(await dailyCreditRunway(client, "a", now, {
      store, calculate, isCurrent: () => current,
    })).toBeNull();
    // The claim contains no account-service result from the invalidated request.
    expect(await dailyCreditRunway(client, "a", now + 1, {
      store, calculate: async () => runway("clairic"),
    })).toBeNull();
  });
});
