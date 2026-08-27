import {
  addUsageEventRecordToIdb,
  deleteLocalUsageHistoryFromIdb,
  excludeUnsynchronizedUsageEventsFromIdb,
  listUsageEventRecordsFromIdb,
  listWritingActivityDetailsFromIdb,
  loadWritingActivityDetailFromIdb,
  markUsageEventsSynchronizedToIdb,
  putWritingActivityDetailToIdb,
  type StoredUsageEventRecord,
  type StoredUsagePageInput,
} from "./idb";
import {
  assertUsageEvent,
  assertWritingActivityDetail,
  createUsageEventKey,
  createWritingActivityKey,
  nextUtcDay,
  normalizeUsageAiFeature,
  utcDayFromTimestamp,
  type TokenUsage,
  type UsageEvent,
  type WritingActivityDetail,
} from "./usage-domain";
import {
  serializeUsageExportCsv,
  serializeUsageExportJson,
} from "./usage-export";
import { estimateUsageCost, resolveUsageCost } from "./usage-pricing";

export const LOCAL_USAGE_PAGE_LIMIT = 100;
export const WRITING_ACTIVITY_THROTTLE_MS = 60_000;

export interface UsageLedgerStorage {
  addUsageEvent(record: StoredUsageEventRecord): Promise<boolean>;
  listUsageEvents(
    input: StoredUsagePageInput,
  ): Promise<StoredUsageEventRecord[]>;
  markSynchronized(
    eventKeys: readonly string[],
    accountId: string,
  ): Promise<void>;
  excludeUnsynchronized(): Promise<void>;
  loadWritingActivity(
    activityKey: string,
  ): Promise<WritingActivityDetail | null>;
  putWritingActivity(detail: WritingActivityDetail): Promise<void>;
  listWritingActivity(input: {
    fromDay: string;
    toDay: string;
    limit: number;
  }): Promise<WritingActivityDetail[]>;
  deleteHistory(input: { includeWritingActivity?: boolean }): Promise<void>;
}

export const indexedDbUsageStorage: UsageLedgerStorage = {
  addUsageEvent: addUsageEventRecordToIdb,
  listUsageEvents: listUsageEventRecordsFromIdb,
  markSynchronized: markUsageEventsSynchronizedToIdb,
  excludeUnsynchronized: excludeUnsynchronizedUsageEventsFromIdb,
  loadWritingActivity: loadWritingActivityDetailFromIdb,
  putWritingActivity: putWritingActivityDetailToIdb,
  listWritingActivity: listWritingActivityDetailsFromIdb,
  deleteHistory: deleteLocalUsageHistoryFromIdb,
};

export interface UsagePageCursor {
  occurredAt: number;
  eventKey: string;
}

export interface UsageEventPage {
  events: UsageEvent[];
  cursor?: string;
}

export interface LocalUsageTotals {
  generations: number;
  completedGenerations: number;
  failedGenerations: number;
  actualCostMicrousd: number;
  estimatedCostMicrousd: number;
  localGenerations: number;
  unknownCostGenerations: number;
  tokens: Required<TokenUsage>;
}

function emptyTokenUsage(): Required<TokenUsage> {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return LOCAL_USAGE_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("limit must be a positive safe integer");
  }
  return Math.min(LOCAL_USAGE_PAGE_LIMIT, value);
}

function validRange(from: number | null, to: number): void {
  if (
    (from !== null && (!Number.isSafeInteger(from) || from < 0)) ||
    !Number.isSafeInteger(to) ||
    to < 0 ||
    (from !== null && from >= to)
  ) {
    throw new RangeError(
      "usage range must be a valid half-open millisecond range",
    );
  }
}

export function encodeUsageCursor(cursor: UsagePageCursor): string {
  return JSON.stringify([cursor.occurredAt, cursor.eventKey]);
}

export function decodeUsageCursor(
  value: string | undefined,
): UsagePageCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !Number.isSafeInteger(parsed[0]) ||
      (parsed[0] as number) < 0 ||
      typeof parsed[1] !== "string" ||
      !(parsed[1] as string).length
    ) {
      throw new Error("invalid cursor");
    }
    return { occurredAt: parsed[0] as number, eventKey: parsed[1] as string };
  } catch {
    throw new RangeError("cursor is invalid");
  }
}

export interface UsageLedger {
  putUsageEvent(event: UsageEvent): Promise<boolean>;
  listUsageEvents(input: {
    from: number | null;
    to: number;
    cursor?: string;
    limit?: number;
  }): Promise<UsageEventPage>;
  listPendingUsageEvents(input: {
    accountId: string;
    cursor?: string;
    limit?: number;
  }): Promise<UsageEventPage>;
  markSynchronized(
    eventKeys: readonly string[],
    accountId: string,
  ): Promise<void>;
  excludeUnsynchronized(): Promise<void>;
  recordWritingActivity(input: {
    folioId: string;
    occurredAt?: number;
    throttleMs?: number;
  }): Promise<boolean>;
  listWritingActivity(input: {
    from: number;
    to: number;
    limit?: number;
  }): Promise<WritingActivityDetail[]>;
  summarizeLocalUsage(input: {
    from: number | null;
    to: number;
  }): Promise<LocalUsageTotals>;
  exportUsageHistory(input: {
    from: number | null;
    to: number;
    format: "json" | "csv";
    generatedAt?: number;
  }): Promise<string>;
  deleteUsageHistory(input?: {
    includeWritingActivity?: boolean;
  }): Promise<void>;
}

export function createUsageLedger(
  storage: UsageLedgerStorage = indexedDbUsageStorage,
): UsageLedger {
  const listRecords = async (input: {
    from: number | null;
    to: number;
    cursor?: string;
    limit?: number;
  }): Promise<{ rows: StoredUsageEventRecord[]; cursor?: string }> => {
    validRange(input.from, input.to);
    const rows = await storage.listUsageEvents({
      from: input.from,
      to: input.to,
      after: decodeUsageCursor(input.cursor),
      limit: boundedLimit(input.limit),
    });
    const valid = rows.filter((row) => {
      try {
        assertUsageEvent(row.event);
        return (
          row.eventKey === row.event.eventKey &&
          row.occurredAt === row.event.occurredAt
        );
      } catch {
        return false;
      }
    });
    const last = rows.at(-1);
    return {
      rows: valid,
      cursor:
        rows.length === boundedLimit(input.limit) && last
          ? encodeUsageCursor({
              occurredAt: last.occurredAt,
              eventKey: last.eventKey,
            })
          : undefined,
    };
  };

  return {
    async putUsageEvent(event) {
      assertUsageEvent(event);
      return storage.addUsageEvent({
        eventKey: event.eventKey,
        occurredAt: event.occurredAt,
        event: structuredClone(event),
      });
    },

    async listUsageEvents(input) {
      const page = await listRecords(input);
      return {
        events: page.rows.map((row) => structuredClone(row.event)),
        cursor: page.cursor,
      };
    },

    async listPendingUsageEvents(input) {
      if (!input.accountId.trim()) throw new TypeError("accountId is required");
      let cursor = input.cursor;
      const events: UsageEvent[] = [];
      const wanted = boundedLimit(input.limit);
      while (events.length < wanted) {
        const page = await listRecords({
          from: null,
          to: Number.MAX_SAFE_INTEGER,
          cursor,
          limit: wanted,
        });
        for (const row of page.rows) {
          if (!row.synchronizedAccountId && !row.excludedFromSync) {
            events.push(structuredClone(row.event));
            if (events.length === wanted) break;
          }
        }
        cursor = page.cursor;
        if (!cursor || events.length === wanted) break;
      }
      const last = events.at(-1);
      return {
        events,
        cursor:
          cursor && last
            ? encodeUsageCursor({
                occurredAt: last.occurredAt,
                eventKey: last.eventKey,
              })
            : undefined,
      };
    },

    markSynchronized(eventKeys, accountId) {
      if (!accountId.trim()) throw new TypeError("accountId is required");
      return storage.markSynchronized(eventKeys, accountId);
    },

    excludeUnsynchronized() {
      return storage.excludeUnsynchronized();
    },

    async recordWritingActivity(input) {
      const occurredAt = input.occurredAt ?? Date.now();
      const throttleMs = input.throttleMs ?? WRITING_ACTIVITY_THROTTLE_MS;
      if (!Number.isSafeInteger(throttleMs) || throttleMs < 0) {
        throw new RangeError("throttleMs must be a non-negative safe integer");
      }
      const day = utcDayFromTimestamp(occurredAt);
      const activityKey = createWritingActivityKey(day, input.folioId);
      const prior = await storage.loadWritingActivity(activityKey);
      if (prior && occurredAt - prior.lastOccurredAt < throttleMs) return false;
      const detail: WritingActivityDetail = prior
        ? { ...prior, count: prior.count + 1, lastOccurredAt: occurredAt }
        : {
            activityKey,
            day,
            folioId: input.folioId,
            count: 1,
            firstOccurredAt: occurredAt,
            lastOccurredAt: occurredAt,
          };
      assertWritingActivityDetail(detail);
      await storage.putWritingActivity(detail);
      return true;
    },

    async listWritingActivity(input) {
      validRange(input.from, input.to);
      const fromDay = utcDayFromTimestamp(input.from);
      const toDay = nextUtcDay(utcDayFromTimestamp(input.to - 1));
      const rows = await storage.listWritingActivity({
        fromDay,
        toDay,
        limit: Math.max(1, Math.min(2_000, input.limit ?? 2_000)),
      });
      return rows.filter((row) => {
        try {
          assertWritingActivityDetail(row);
          return true;
        } catch {
          return false;
        }
      });
    },

    async summarizeLocalUsage(input) {
      validRange(input.from, input.to);
      const totals: LocalUsageTotals = {
        generations: 0,
        completedGenerations: 0,
        failedGenerations: 0,
        actualCostMicrousd: 0,
        estimatedCostMicrousd: 0,
        localGenerations: 0,
        unknownCostGenerations: 0,
        tokens: emptyTokenUsage(),
      };
      let cursor: string | undefined;
      do {
        const page = await this.listUsageEvents({ ...input, cursor });
        for (const event of page.events) {
          totals.generations += 1;
          totals.completedGenerations += event.outcome === "completed" ? 1 : 0;
          totals.failedGenerations += event.outcome === "failed" ? 1 : 0;
          totals.actualCostMicrousd +=
            event.costKind === "actual" ? (event.costMicrousd ?? 0) : 0;
          totals.estimatedCostMicrousd +=
            event.costKind === "estimated" ? (event.costMicrousd ?? 0) : 0;
          totals.localGenerations += event.costKind === "local" ? 1 : 0;
          totals.unknownCostGenerations += event.costKind === "unknown" ? 1 : 0;
          for (const key of Object.keys(totals.tokens) as Array<
            keyof TokenUsage
          >) {
            totals.tokens[key] += event[key] ?? 0;
          }
        }
        cursor = page.cursor;
      } while (cursor);
      return totals;
    },

    async exportUsageHistory(input) {
      const events: UsageEvent[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.listUsageEvents({
          from: input.from,
          to: input.to,
          cursor,
        });
        events.push(...page.events);
        cursor = page.cursor;
      } while (cursor);
      return input.format === "json"
        ? serializeUsageExportJson(events, input.generatedAt ?? Date.now())
        : serializeUsageExportCsv(events);
    },

    deleteUsageHistory(input = {}) {
      return storage.deleteHistory(input);
    },
  };
}

export const usageLedger = createUsageLedger();

export interface ClientUsageAttemptInput {
  requestSent: boolean;
  providerRequestId?: string;
  traceId: string;
  attempt: number;
  occurredAt?: number;
  source: "byok" | "local";
  feature: unknown;
  provider: string;
  model: string;
  outcome: "completed" | "failed";
  usage?: TokenUsage;
  folioId?: string;
  editorialActionId?: string;
}

export function createClientUsageEvent(
  input: ClientUsageAttemptInput,
): UsageEvent | null {
  if (!input.requestSent) return null;
  const occurredAt = input.occurredAt ?? Date.now();
  const estimate = estimateUsageCost({
    source: input.source,
    provider: input.provider,
    model: input.model,
    usage: input.usage ?? {},
  });
  const cost = resolveUsageCost({ source: input.source, estimate });
  const event: UsageEvent = {
    eventKey: createUsageEventKey(input),
    occurredAt,
    day: utcDayFromTimestamp(occurredAt),
    source: input.source,
    authority: "client_reported",
    feature: normalizeUsageAiFeature(input.feature),
    provider: input.provider,
    model: input.model,
    folioId: input.folioId,
    editorialActionId: input.editorialActionId,
    traceId: input.traceId,
    attempt: input.attempt,
    outcome: input.outcome,
    ...input.usage,
    costKind: cost.kind,
    costMicrousd: cost.costMicrousd,
    pricingVersion: cost.pricingVersion,
    pricing: cost.pricing,
  };
  assertUsageEvent(event);
  return event;
}

export async function recordClientUsageAttempt(
  input: ClientUsageAttemptInput,
  ledger: UsageLedger = usageLedger,
): Promise<{ event: UsageEvent; inserted: boolean } | null> {
  const event = createClientUsageEvent(input);
  if (!event) return null;
  return { event, inserted: await ledger.putUsageEvent(event) };
}
