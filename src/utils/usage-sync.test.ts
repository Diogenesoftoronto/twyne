import { describe, expect, test } from "bun:test";
import type { WritingActivityDetail } from "./usage-domain";
import type { StoredUsageEventRecord, StoredUsagePageInput } from "./idb";
import {
  createClientUsageEvent,
  createUsageLedger,
  type UsageLedgerStorage,
} from "./usage-ledger";
import {
  resolveUsageAccountSwitch,
  setUsageSyncEnabled,
  syncLocalUsageHistory,
  usageSyncReadiness,
  type UsageSyncState,
  type UsageSyncStateStore,
} from "./usage-sync";

class StateStore implements UsageSyncStateStore {
  state: UsageSyncState | null = null;
  async load(): Promise<UsageSyncState | null> {
    return structuredClone(this.state);
  }
  async save(state: UsageSyncState): Promise<void> {
    this.state = structuredClone(state);
  }
}

class EventStorage implements UsageLedgerStorage {
  events = new Map<string, StoredUsageEventRecord>();
  async addUsageEvent(record: StoredUsageEventRecord): Promise<boolean> {
    if (this.events.has(record.eventKey)) return false;
    this.events.set(record.eventKey, structuredClone(record));
    return true;
  }
  async listUsageEvents(
    input: StoredUsagePageInput,
  ): Promise<StoredUsageEventRecord[]> {
    return [...this.events.values()]
      .filter(
        (row) =>
          row.occurredAt < input.to &&
          (input.from === null || row.occurredAt >= input.from) &&
          (!input.after ||
            row.occurredAt > input.after.occurredAt ||
            (row.occurredAt === input.after.occurredAt &&
              row.eventKey.localeCompare(input.after.eventKey) > 0)),
      )
      .sort(
        (a, b) =>
          a.occurredAt - b.occurredAt || a.eventKey.localeCompare(b.eventKey),
      )
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
  }
  async markSynchronized(keys: readonly string[], accountId: string) {
    for (const key of keys) {
      const row = this.events.get(key);
      if (row && !row.synchronizedAccountId) {
        row.synchronizedAccountId = accountId;
        delete row.excludedFromSync;
      }
    }
  }
  async excludeUnsynchronized() {
    for (const row of this.events.values()) {
      if (!row.synchronizedAccountId) row.excludedFromSync = true;
    }
  }
  async loadWritingActivity(): Promise<WritingActivityDetail | null> {
    return null;
  }
  async putWritingActivity(): Promise<void> {}
  async listWritingActivity(): Promise<WritingActivityDetail[]> {
    return [];
  }
  async deleteHistory(): Promise<void> {
    this.events.clear();
  }
}

const baseTime = Date.parse("2026-08-26T12:00:00.000Z");

function event(id: string, occurredAt = baseTime) {
  return createClientUsageEvent({
    requestSent: true,
    providerRequestId: id,
    traceId: `trace-${id}`,
    attempt: 1,
    occurredAt,
    source: "byok",
    feature: "persona-feedback",
    provider: "openai",
    model: "gpt-5.5",
    outcome: "completed",
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  })!;
}

describe("consent-aware local usage sync", () => {
  test("does nothing until sync is explicitly enabled", async () => {
    const states = new StateStore();
    let uploadCalls = 0;
    const result = await syncLocalUsageHistory({
      accountId: "account-a",
      stateStore: states,
      ledger: createUsageLedger(new EventStorage()),
      uploader: {
        upload: async () => {
          uploadCalls += 1;
          return { acknowledgedEventKeys: [] };
        },
      },
    });
    expect(result).toEqual({ status: "disabled", uploaded: 0, batches: 0 });
    expect(uploadCalls).toBe(0);
  });

  test("uploads bounded batches and marks only after acknowledgement", async () => {
    const states = new StateStore();
    const storage = new EventStorage();
    const ledger = createUsageLedger(storage);
    await setUsageSyncEnabled({
      accountId: "account-a",
      enabled: true,
      now: baseTime,
      stateStore: states,
    });
    for (let index = 0; index < 3; index += 1) {
      await ledger.putUsageEvent(event(`event-${index}`, baseTime + index));
    }
    const batches: string[][] = [];
    const result = await syncLocalUsageHistory({
      accountId: "account-a",
      stateStore: states,
      ledger,
      batchLimit: 2,
      uploader: {
        upload: async ({ events }) => {
          expect(JSON.stringify(events)).not.toContain("prompt");
          batches.push(events.map((entry) => entry.eventKey));
          return {
            acknowledgedEventKeys: events.map((entry) => entry.eventKey),
          };
        },
      },
    });
    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
    expect(result).toEqual({ status: "complete", uploaded: 3, batches: 2 });
    expect(
      [...storage.events.values()].every(
        (row) => row.synchronizedAccountId === "account-a",
      ),
    ).toBe(true);
  });

  test("requires a destination choice before an account switch", async () => {
    const states = new StateStore();
    const storage = new EventStorage();
    const ledger = createUsageLedger(storage);
    await setUsageSyncEnabled({
      accountId: "account-a",
      enabled: true,
      now: baseTime,
      stateStore: states,
    });
    await ledger.putUsageEvent(event("old-unsynced"));
    expect(await usageSyncReadiness("account-b", states)).toEqual({
      status: "account_choice_required",
      previousAccountId: "account-a",
      requestedAccountId: "account-b",
    });
    let uploadCalls = 0;
    const blocked = await syncLocalUsageHistory({
      accountId: "account-b",
      stateStore: states,
      ledger,
      uploader: {
        upload: async () => {
          uploadCalls += 1;
          return { acknowledgedEventKeys: [] };
        },
      },
    });
    expect(blocked.status).toBe("account_choice_required");
    expect(uploadCalls).toBe(0);

    await resolveUsageAccountSwitch({
      accountId: "account-b",
      choice: "keep-device-only",
      now: baseTime + 1,
      stateStore: states,
      ledger,
    });
    await ledger.putUsageEvent(event("new-account", baseTime + 2));
    const offered: string[] = [];
    await syncLocalUsageHistory({
      accountId: "account-b",
      stateStore: states,
      ledger,
      uploader: {
        upload: async ({ events }) => {
          offered.push(...events.map((entry) => entry.eventKey));
          return { acknowledgedEventKeys: offered };
        },
      },
    });
    expect(offered).toHaveLength(1);
    expect(offered[0]).toContain("new-account");
    expect(storage.events.get(event("old-unsynced").eventKey)).toMatchObject({
      excludedFromSync: true,
    });
  });

  test("does not mark unacknowledged or invented event keys", async () => {
    const states = new StateStore();
    const storage = new EventStorage();
    const ledger = createUsageLedger(storage);
    await setUsageSyncEnabled({
      accountId: "account-a",
      enabled: true,
      stateStore: states,
    });
    const first = event("first");
    const second = event("second", baseTime + 1);
    await ledger.putUsageEvent(first);
    await ledger.putUsageEvent(second);
    const result = await syncLocalUsageHistory({
      accountId: "account-a",
      stateStore: states,
      ledger,
      uploader: {
        upload: async () => ({
          acknowledgedEventKeys: [first.eventKey, "invented"],
        }),
      },
    });
    expect(result).toMatchObject({ status: "partial", uploaded: 1 });
    expect(storage.events.get(first.eventKey)?.synchronizedAccountId).toBe(
      "account-a",
    );
    expect(
      storage.events.get(second.eventKey)?.synchronizedAccountId,
    ).toBeUndefined();
  });
});
