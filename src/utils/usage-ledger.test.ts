import { describe, expect, test } from "bun:test";
import type { WritingActivityDetail } from "./usage-domain";
import type { StoredUsageEventRecord, StoredUsagePageInput } from "./idb";
import {
  createClientUsageEvent,
  createUsageLedger,
  recordClientUsageAttempt,
  type UsageLedgerStorage,
} from "./usage-ledger";

class MemoryUsageStorage implements UsageLedgerStorage {
  events = new Map<string, StoredUsageEventRecord>();
  writing = new Map<string, WritingActivityDetail>();

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
          (input.from === null || row.occurredAt >= input.from) &&
          row.occurredAt < input.to &&
          (!input.after ||
            row.occurredAt > input.after.occurredAt ||
            (row.occurredAt === input.after.occurredAt &&
              row.eventKey.localeCompare(input.after.eventKey) > 0)),
      )
      .sort(
        (left, right) =>
          left.occurredAt - right.occurredAt ||
          left.eventKey.localeCompare(right.eventKey),
      )
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
  }

  async markSynchronized(
    eventKeys: readonly string[],
    accountId: string,
  ): Promise<void> {
    for (const eventKey of eventKeys) {
      const row = this.events.get(eventKey);
      if (row && !row.synchronizedAccountId) {
        row.synchronizedAccountId = accountId;
        delete row.excludedFromSync;
      }
    }
  }

  async excludeUnsynchronized(): Promise<void> {
    for (const row of this.events.values()) {
      if (!row.synchronizedAccountId) row.excludedFromSync = true;
    }
  }

  async loadWritingActivity(
    activityKey: string,
  ): Promise<WritingActivityDetail | null> {
    return structuredClone(this.writing.get(activityKey) ?? null);
  }

  async putWritingActivity(detail: WritingActivityDetail): Promise<void> {
    this.writing.set(detail.activityKey, structuredClone(detail));
  }

  async listWritingActivity(input: {
    fromDay: string;
    toDay: string;
    limit: number;
  }): Promise<WritingActivityDetail[]> {
    return [...this.writing.values()]
      .filter((row) => row.day >= input.fromDay && row.day < input.toDay)
      .sort((left, right) => left.day.localeCompare(right.day))
      .slice(0, input.limit)
      .map((row) => structuredClone(row));
  }

  async deleteHistory(input: {
    includeWritingActivity?: boolean;
  }): Promise<void> {
    this.events.clear();
    if (input.includeWritingActivity) this.writing.clear();
  }
}

const occurredAt = Date.parse("2026-08-26T12:00:00.000Z");

function attempt(
  overrides: Partial<Parameters<typeof createClientUsageEvent>[0]> = {},
) {
  return {
    requestSent: true,
    traceId: "trace-1",
    attempt: 1,
    occurredAt,
    source: "byok" as const,
    feature: "persona-feedback",
    provider: "openai",
    model: "gpt-5.5",
    outcome: "completed" as const,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ...overrides,
  };
}

describe("local usage ledger", () => {
  test("is idempotent across repository reloads and pages equal timestamps", async () => {
    const storage = new MemoryUsageStorage();
    const first = createUsageLedger(storage);
    const eventA = createClientUsageEvent(
      attempt({ providerRequestId: "request-a" }),
    )!;
    const eventB = createClientUsageEvent(
      attempt({ providerRequestId: "request-b" }),
    )!;
    expect(await first.putUsageEvent(eventA)).toBe(true);
    expect(await first.putUsageEvent(eventA)).toBe(false);
    expect(await first.putUsageEvent(eventB)).toBe(true);

    const reloaded = createUsageLedger(storage);
    const page1 = await reloaded.listUsageEvents({
      from: occurredAt,
      to: occurredAt + 1,
      limit: 1,
    });
    const page2 = await reloaded.listUsageEvents({
      from: occurredAt,
      to: occurredAt + 1,
      cursor: page1.cursor,
      limit: 1,
    });
    expect(page1.events).toHaveLength(1);
    expect(page2.events).toHaveLength(1);
    expect(page1.events[0].eventKey).not.toBe(page2.events[0].eventKey);
  });

  test("records genuine retries separately and ignores pre-send failures", async () => {
    const storage = new MemoryUsageStorage();
    const ledger = createUsageLedger(storage);
    expect(
      await recordClientUsageAttempt(
        attempt({ requestSent: false, outcome: "failed" }),
        ledger,
      ),
    ).toBeNull();
    await recordClientUsageAttempt(
      attempt({ attempt: 1, outcome: "failed", usage: undefined }),
      ledger,
    );
    await recordClientUsageAttempt(attempt({ attempt: 2 }), ledger);
    expect(storage.events.size).toBe(2);
    expect(
      new Set([...storage.events.values()].map((row) => row.event.eventKey))
        .size,
    ).toBe(2);
  });

  test("keeps unknown and local costs semantically distinct from zero", () => {
    const unknown = createClientUsageEvent(
      attempt({ provider: "custom", model: "unpriced" }),
    )!;
    expect(unknown).toMatchObject({ costKind: "unknown" });
    expect(unknown.costMicrousd).toBeUndefined();

    const local = createClientUsageEvent(
      attempt({ source: "local", provider: "litert", usage: undefined }),
    )!;
    expect(local).toMatchObject({ costKind: "local" });
    expect(local.costMicrousd).toBeUndefined();
    expect(local.totalTokens).toBeUndefined();
  });

  test("streams totals through bounded pages", async () => {
    const storage = new MemoryUsageStorage();
    const ledger = createUsageLedger(storage);
    for (let index = 0; index < 205; index += 1) {
      await recordClientUsageAttempt(
        attempt({
          providerRequestId: `request-${index}`,
          occurredAt: occurredAt + index,
        }),
        ledger,
      );
    }
    const totals = await ledger.summarizeLocalUsage({
      from: occurredAt,
      to: occurredAt + 1_000,
    });
    expect(totals.generations).toBe(205);
    expect(totals.tokens.totalTokens).toBe(3_075);
  });

  test("throttles signed-out writing activity without manuscript content", async () => {
    const storage = new MemoryUsageStorage();
    const ledger = createUsageLedger(storage);
    expect(
      await ledger.recordWritingActivity({ folioId: "folio-1", occurredAt }),
    ).toBe(true);
    expect(
      await ledger.recordWritingActivity({
        folioId: "folio-1",
        occurredAt: occurredAt + 1_000,
      }),
    ).toBe(false);
    expect(
      await ledger.recordWritingActivity({
        folioId: "folio-1",
        occurredAt: occurredAt + 60_000,
      }),
    ).toBe(true);
    expect([...storage.writing.values()][0]).toEqual({
      activityKey: expect.any(String),
      day: "2026-08-26",
      folioId: "folio-1",
      count: 2,
      firstOccurredAt: occurredAt,
      lastOccurredAt: occurredAt + 60_000,
    });
  });

  test("exports only canonical rows and explicitly deletes local history", async () => {
    const storage = new MemoryUsageStorage();
    const ledger = createUsageLedger(storage);
    await recordClientUsageAttempt(
      attempt({ providerRequestId: "safe" }),
      ledger,
    );
    const json = await ledger.exportUsageHistory({
      from: occurredAt,
      to: occurredAt + 1,
      format: "json",
      generatedAt: occurredAt,
    });
    expect(json).not.toContain("prompt");
    expect(json).not.toContain("response");
    expect(JSON.parse(json).contentIncluded).toBe(false);
    await ledger.deleteUsageHistory();
    expect(storage.events.size).toBe(0);
  });
});
