import { describe, expect, test } from "bun:test";
import {
  isCheckoutReturn,
  refreshCheckoutReturnWallet,
  type CheckoutReturnStatus,
} from "./checkout-return";
import { TWYNE_PRO_PLAN } from "./subscription-plan";

const activeWallet = () => ({
  subscriptions: [
    {
      product: "twyne",
      plan: TWYNE_PRO_PLAN.id,
      status: "active",
      currentPeriodEnd: Date.now() + 60_000,
    },
  ],
});

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

function clock() {
  let now = 0;
  let sequence = 0;
  const tasks = new Map<number, { at: number; callback: () => void }>();
  return {
    schedule(callback: () => void, delayMs: number) {
      const id = ++sequence;
      tasks.set(id, { at: now + delayMs, callback });
      return () => {
        tasks.delete(id);
      };
    },
    async advance(ms: number) {
      const end = now + ms;
      while (true) {
        const next = [...tasks.entries()]
          .filter(([, task]) => task.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        tasks.delete(next[0]);
        next[1].callback();
        await settle();
      }
      now = end;
      await settle();
    },
    get pending() {
      return tasks.size;
    },
  };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("Not Organic checkout return", () => {
  test("accepts one exact refresh hint, without legacy payment status", () => {
    expect(isCheckoutReturn("?checkout=success")).toBe(true);
    expect(isCheckoutReturn("?checkout=success&pack=twyne_credit_10")).toBe(
      true,
    );
    for (const search of [
      "",
      "?status=success",
      "?checkout=cancelled",
      "?checkout=SUCCESS",
      "?checkout=success&checkout=success",
      "?checkout=success&checkout=cancelled",
    ]) {
      expect(isCheckoutReturn(search)).toBe(false);
    }
  });

  test("waits for authenticated wallet entitlement instead of trusting checkout metadata", async () => {
    const timer = clock();
    const statuses: CheckoutReturnStatus[] = [];
    const wallets: unknown[] = [];
    let reads = 0;
    const confirmed = activeWallet();
    refreshCheckoutReturnWallet({
      readWallet: async () =>
        ++reads === 1 ? { checkout: "success" } : confirmed,
      isCurrent: () => true,
      onWallet: (wallet) => wallets.push(wallet),
      onStatus: (status) => statuses.push(status),
      schedule: timer.schedule,
    });
    await settle();
    expect(statuses).toEqual(["checking"]);
    await timer.advance(3_000);
    expect(statuses).toEqual(["checking", "pro-active"]);
    expect(wallets).toEqual([{ checkout: "success" }, confirmed]);
    await timer.advance(60_000);
    expect(reads).toBe(2);
    expect(timer.pending).toBe(0);
  });

  test("stops after bounded reads when the wallet never confirms Pro", async () => {
    const timer = clock();
    const statuses: CheckoutReturnStatus[] = [];
    let reads = 0;
    refreshCheckoutReturnWallet({
      readWallet: async () => {
        reads++;
        return { subscriptions: [] };
      },
      isCurrent: () => true,
      onWallet: () => {},
      onStatus: (status) => statuses.push(status),
      schedule: timer.schedule,
    });
    await settle();
    await timer.advance(60_000);
    expect(reads).toBe(5);
    expect(statuses).toEqual(["checking", "pending"]);
    expect(timer.pending).toBe(0);
  });

  test("an expired or different product subscription cannot confirm a return", async () => {
    for (const patch of [
      { currentPeriodEnd: Date.now() - 1 },
      { product: "keating" },
      { plan: "twyne_pro" },
      { status: "cancelled" },
    ]) {
      const timer = clock();
      const statuses: CheckoutReturnStatus[] = [];
      const wallet = activeWallet();
      Object.assign(wallet.subscriptions[0], patch);
      refreshCheckoutReturnWallet({
        readWallet: async () => wallet,
        isCurrent: () => true,
        onWallet: () => {},
        onStatus: (status) => statuses.push(status),
        schedule: timer.schedule,
      });
      await settle();
      await timer.advance(60_000);
      expect(statuses).toEqual(["checking", "pending"]);
    }
  });

  test("bounds a hanging request and ignores a late active-plan response", async () => {
    const timer = clock();
    const request = deferred();
    const statuses: CheckoutReturnStatus[] = [];
    const wallets: unknown[] = [];
    let reads = 0;
    refreshCheckoutReturnWallet({
      readWallet: () => {
        reads++;
        return request.promise;
      },
      isCurrent: () => true,
      onWallet: (wallet) => wallets.push(wallet),
      onStatus: (status) => statuses.push(status),
      schedule: timer.schedule,
    });
    await timer.advance(14_999);
    expect(reads).toBe(1);
    expect(statuses).toEqual(["checking"]);
    await timer.advance(1);
    expect(statuses).toEqual(["checking", "pending"]);
    request.resolve(activeWallet());
    await settle();
    expect(wallets).toEqual([]);
    expect(statuses).toEqual(["checking", "pending"]);
    expect(timer.pending).toBe(0);
  });

  test("cannot publish or continue an old account request after sign-out", async () => {
    const timer = clock();
    const request = deferred();
    const statuses: CheckoutReturnStatus[] = [];
    const wallets: unknown[] = [];
    let current = true;
    let reads = 0;
    refreshCheckoutReturnWallet({
      readWallet: () => {
        reads++;
        return request.promise;
      },
      isCurrent: () => current,
      onWallet: (wallet) => wallets.push(wallet),
      onStatus: (status) => statuses.push(status),
      schedule: timer.schedule,
    });
    current = false;
    request.resolve(activeWallet());
    await settle();
    await timer.advance(60_000);
    expect(reads).toBe(1);
    expect(wallets).toEqual([]);
    expect(statuses).toEqual(["checking"]);
    expect(timer.pending).toBe(0);
  });

  test("does not start a read without a current authenticated account", async () => {
    const timer = clock();
    const statuses: CheckoutReturnStatus[] = [];
    let reads = 0;
    refreshCheckoutReturnWallet({
      readWallet: async () => {
        reads++;
        return activeWallet();
      },
      isCurrent: () => false,
      onWallet: () => {},
      onStatus: (status) => statuses.push(status),
      schedule: timer.schedule,
    });
    await timer.advance(60_000);
    expect(reads).toBe(0);
    expect(statuses).toEqual([]);
    expect(timer.pending).toBe(0);
  });

  test("route cleanup cancels retries and ignores the in-flight response", async () => {
    const timer = clock();
    const request = deferred();
    const statuses: CheckoutReturnStatus[] = [];
    const wallets: unknown[] = [];
    const stop = refreshCheckoutReturnWallet({
      readWallet: () => request.promise,
      isCurrent: () => true,
      onWallet: (wallet) => wallets.push(wallet),
      onStatus: (status) => statuses.push(status),
      schedule: timer.schedule,
    });
    stop();
    request.resolve(activeWallet());
    await settle();
    await timer.advance(60_000);
    expect(wallets).toEqual([]);
    expect(statuses).toEqual(["checking"]);
    expect(timer.pending).toBe(0);
  });

  test("a failed wallet request cannot imply payment or entitlement confirmation", async () => {
    const timer = clock();
    const statuses: CheckoutReturnStatus[] = [];
    const wallets: unknown[] = [];
    refreshCheckoutReturnWallet({
      readWallet: async () => {
        throw new Error("provider unavailable");
      },
      isCurrent: () => true,
      onWallet: (wallet) => wallets.push(wallet),
      onStatus: (status) => statuses.push(status),
      schedule: timer.schedule,
    });
    await settle();
    await timer.advance(60_000);
    expect(wallets).toEqual([]);
    expect(statuses).toEqual(["checking", "unavailable"]);
    expect(timer.pending).toBe(0);
  });
});
