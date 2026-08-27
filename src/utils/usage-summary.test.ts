import { describe, expect, test } from "bun:test";
import {
  buildUsageSummary,
  deriveWriterPatterns,
  reconcileUsageSummary,
  type LegacyWritingDay,
} from "./usage-summary";
import {
  createUsageEventKey,
  createUsageRange,
  createWritingActivityKey,
  type EditorialActionEvidence,
  type UsageEvent,
  type WritingActivityDetail,
} from "./usage-domain";

const now = Date.parse("2026-08-26T12:00:00.000Z");
const range = createUsageRange("30d", now);

function event(input: {
  id: string;
  day: string;
  feature?: UsageEvent["feature"];
  provider?: string;
  model?: string;
  folioId?: string;
  actionId?: string;
  attempt?: number;
  outcome?: "completed" | "failed";
  costKind?: UsageEvent["costKind"];
  cost?: number;
  tokens?: Partial<UsageEvent>;
}): UsageEvent {
  const occurredAt = Date.parse(`${input.day}T12:00:00.000Z`);
  const costKind = input.costKind ?? "estimated";
  return {
    eventKey: createUsageEventKey({
      providerRequestId: input.id,
      traceId: `trace-${input.id}`,
      attempt: input.attempt ?? 1,
      provider: input.provider ?? "openai",
      model: input.model ?? "gpt-5.5",
    }),
    occurredAt,
    day: input.day,
    source: costKind === "local" ? "local" : "byok",
    authority: "client_reported",
    feature: input.feature ?? "persona-feedback",
    provider: input.provider ?? "openai",
    model: input.model ?? "gpt-5.5",
    folioId: input.folioId,
    editorialActionId: input.actionId,
    traceId: `trace-${input.id}`,
    attempt: input.attempt ?? 1,
    outcome: input.outcome ?? "completed",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 2,
    totalTokens: 15,
    costKind,
    costMicrousd:
      costKind === "actual" || costKind === "estimated"
        ? (input.cost ?? 20)
        : undefined,
    pricingVersion: costKind === "estimated" ? "2026-08-26" : undefined,
    pricing:
      costKind === "estimated"
        ? {
            source: "official-provider-docs",
            version: "2026-08-26",
            currency: "USD",
            inputMicrousdPerMillion: 5_000_000,
            outputMicrousdPerMillion: 30_000_000,
          }
        : undefined,
    ...input.tokens,
  };
}

function activity(
  day: string,
  folioId: string,
  count: number,
): WritingActivityDetail {
  return {
    activityKey: createWritingActivityKey(day, folioId),
    day,
    folioId,
    count,
    firstOccurredAt: Date.parse(`${day}T01:00:00.000Z`),
    lastOccurredAt: Date.parse(`${day}T23:00:00.000Z`),
  };
}

describe("My Desk graph series", () => {
  const events = [
    event({
      id: "one-failed",
      day: "2026-08-24",
      feature: "persona-rewrite",
      provider: "openai",
      model: "gpt-5.5",
      folioId: "folio-a",
      actionId: "action-one",
      outcome: "failed",
      costKind: "unknown",
    }),
    event({
      id: "one-retry",
      day: "2026-08-24",
      feature: "persona-rewrite",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      folioId: "folio-a",
      actionId: "action-one",
      attempt: 2,
      costKind: "estimated",
      cost: 30,
    }),
    event({
      id: "two",
      day: "2026-08-25",
      feature: "rubric-review",
      provider: "openai",
      model: "gpt-5.5",
      folioId: "folio-b",
      actionId: "action-two",
      costKind: "estimated",
      cost: 40,
      tokens: { reasoningTokens: 3 },
    }),
    {
      ...event({
        id: "hosted",
        day: "2026-08-26",
        feature: "persona-feedback",
        provider: "openai",
        model: "gpt-5.5",
        actionId: "action-three",
        costKind: "estimated",
      }),
      source: "hosted" as const,
      authority: "server" as const,
      costKind: "actual" as const,
      costMicrousd: 50,
      pricingVersion: undefined,
      creditMicrounits: 7,
    },
    event({
      id: "local",
      day: "2026-08-26",
      feature: "persona-feedback",
      folioId: "folio-b",
      actionId: "action-four",
      costKind: "local",
    }),
  ];
  const activities = [
    activity("2026-08-24", "folio-a", 2),
    activity("2026-08-25", "folio-b", 3),
    activity("2026-08-26", "folio-a", 1),
    activity("2026-08-26", "folio-b", 4),
  ];
  const legacy: LegacyWritingDay[] = [
    { day: "2026-08-23", count: 6 },
    { day: "2026-08-24", count: 4 },
  ];

  test("builds daily actual/estimated, action, writing, and token series", () => {
    const summary = buildUsageSummary({
      events,
      activities,
      legacyWritingDays: legacy,
      range,
      now,
    });
    expect(summary.overall).toMatchObject({
      generations: 5,
      completedGenerations: 4,
      failedGenerations: 1,
      logicalActions: 4,
      completedActions: 4,
      actualCostMicrousd: 50,
      estimatedCostMicrousd: 70,
      localGenerations: 1,
      unknownCostGenerations: 1,
      creditMicrounits: 7,
    });
    expect(summary.overall.tokens).toMatchObject({
      inputTokens: 50,
      outputTokens: 25,
      cacheReadTokens: 10,
      reasoningTokens: 3,
      totalTokens: 75,
    });
    expect(summary.daily.find((day) => day.day === "2026-08-24")).toMatchObject(
      {
        writingCount: 4,
        generations: 2,
        logicalActions: 1,
        completedActions: 1,
        estimatedCostMicrousd: 30,
        unknownCostGenerations: 1,
      },
    );
    expect(summary.daily.find((day) => day.day === "2026-08-26")).toMatchObject(
      {
        actualCostMicrousd: 50,
        localGenerations: 1,
      },
    );
  });

  test("marks legacy-only and partially detailed heatmap days", () => {
    const summary = buildUsageSummary({
      events,
      activities,
      legacyWritingDays: legacy,
      range,
      now,
    });
    expect(
      summary.writingHeatmap.find((day) => day.day === "2026-08-23"),
    ).toMatchObject({
      count: 6,
      detailedCount: 0,
      legacyCount: 6,
      detailComplete: false,
      folios: [],
    });
    expect(
      summary.writingHeatmap.find((day) => day.day === "2026-08-24"),
    ).toMatchObject({
      count: 4,
      detailedCount: 2,
      detailComplete: false,
    });
    expect(
      summary.writingHeatmap.find((day) => day.day === "2026-08-26")?.folios,
    ).toEqual([
      expect.objectContaining({ folioId: "folio-b", count: 4 }),
      expect.objectContaining({ folioId: "folio-a", count: 1 }),
    ]);
  });

  test("builds feature, provider/model, folio, and token breakdowns", () => {
    const summary = buildUsageSummary({ events, activities, range, now });
    expect(summary.features.map((entry) => entry.feature)).toEqual([
      "persona-feedback",
      "persona-rewrite",
      "rubric-review",
    ]);
    const openai = summary.providers.find(
      (entry) => entry.provider === "openai",
    );
    expect(openai).toMatchObject({ generations: 4 });
    expect(openai?.models).toEqual([
      expect.objectContaining({ model: "gpt-5.5", generations: 4 }),
    ]);
    expect(
      summary.folios.find((entry) => entry.folioId === null),
    ).toMatchObject({
      generations: 1,
      actualCostMicrousd: 50,
    });
    expect(summary.overall.tokens.coverage.reasoningTokens).toEqual({
      reportedEvents: 1,
      missingEvents: 4,
    });
  });

  test("deduplicates event keys and reconciles every additive graph", () => {
    const summary = buildUsageSummary({
      events: [...events, events[0]],
      activities,
      range,
      now,
    });
    expect(summary.overall.generations).toBe(5);
    expect(reconcileUsageSummary(summary)).toEqual({ ok: true, issues: [] });
  });

  test("keeps private titles out of recent-work derivation", () => {
    const summary = buildUsageSummary({
      events,
      activities,
      range,
      now,
      folios: [
        { folioId: "folio-a", currentWords: 800, updatedAt: now - 100 },
        { folioId: "folio-b", currentWords: 300, updatedAt: now },
      ],
    });
    expect(summary.recentWork).toEqual([
      expect.objectContaining({
        folioId: "folio-a",
        currentWords: 800,
        activeDays: 2,
        editorialActions: 1,
        estimatedCostMicrousd: 30,
      }),
      expect.objectContaining({
        folioId: "folio-b",
        currentWords: 300,
        activeDays: 2,
        editorialActions: 2,
        estimatedCostMicrousd: 40,
      }),
    ]);
    expect(JSON.stringify(summary.recentWork)).not.toContain("title");
  });

  test("keeps action-only evidence additive across day, feature, and folio views", () => {
    const action: EditorialActionEvidence = {
      actionId: "action-only",
      occurredAt: now,
      feature: "research-web-search",
      outcome: "failed",
      folioId: "folio-z",
    };
    const summary = buildUsageSummary({
      events: [],
      activities: [],
      actions: [action],
      folios: [{ folioId: "folio-z", currentWords: 10, updatedAt: now - 1 }],
      range,
      now,
    });
    expect(summary.overall).toMatchObject({
      generations: 0,
      logicalActions: 1,
      failedActions: 1,
    });
    expect(summary.daily[0]).toMatchObject({
      logicalActions: 1,
      failedActions: 1,
    });
    expect(summary.features[0]).toMatchObject({
      feature: "research-web-search",
      logicalActions: 1,
    });
    expect(summary.folios[0]).toMatchObject({
      folioId: "folio-z",
      logicalActions: 1,
    });
    expect(summary.recentWork[0].lastActiveAt).toBe(now);
    expect(reconcileUsageSummary(summary)).toEqual({ ok: true, issues: [] });
  });
});

describe("evidence-threshold writer patterns", () => {
  const active = [
    "2026-08-20",
    "2026-08-21",
    "2026-08-23",
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
  ];
  const heatmap = active.map((day) => ({
    day,
    count: 1,
    detailedCount: 1,
    legacyCount: 0,
    detailComplete: true,
    folios: [],
  }));
  const actions: EditorialActionEvidence[] = [
    {
      actionId: "a1",
      occurredAt: now,
      feature: "persona-rewrite",
      outcome: "completed",
      editorId: "editor-a",
      folioId: "folio-a",
      sessionId: "session-a",
      turnCount: 3,
      revision: true,
    },
    {
      actionId: "a2",
      occurredAt: now,
      feature: "persona-rewrite",
      outcome: "completed",
      editorId: "editor-a",
      folioId: "folio-a",
      sessionId: "session-a",
      turnCount: 2,
      revision: true,
    },
    {
      actionId: "a3",
      occurredAt: now,
      feature: "rubric-review",
      outcome: "completed",
      editorId: "editor-b",
      folioId: "folio-b",
      sessionId: "session-b",
      turnCount: 5,
      revision: true,
    },
    {
      actionId: "a4",
      occurredAt: now,
      feature: "rubric-review",
      outcome: "completed",
      editorId: "editor-b",
      folioId: "folio-b",
      sessionId: "session-b",
      turnCount: 1,
      revision: true,
    },
    {
      actionId: "a5",
      occurredAt: now,
      feature: "research-web-search",
      outcome: "completed",
      editorId: "editor-c",
      folioId: "folio-b",
      sessionId: "session-b",
      turnCount: 1,
    },
  ];
  const costs = [
    event({ id: "cost-a", day: "2026-08-26", folioId: "folio-a", cost: 40 }),
    event({ id: "cost-b", day: "2026-08-26", folioId: "folio-b", cost: 60 }),
  ];

  test("shows patterns at thresholds with stable shared ties", () => {
    const patterns = deriveWriterPatterns({
      events: costs,
      activities: heatmap,
      actions,
      range,
      now,
    });
    expect(patterns.currentStreak).toMatchObject({
      status: "available",
      value: 4,
    });
    expect(patterns.longestStreak).toMatchObject({
      status: "available",
      value: 4,
    });
    expect(patterns.mostConsultedEditor).toMatchObject({
      status: "available",
      value: ["editor-a", "editor-b"],
      evidenceCount: 5,
    });
    expect(patterns.mostUsedTool).toMatchObject({
      value: ["persona-rewrite", "rubric-review"],
    });
    expect(patterns.mostRevisedFolio).toMatchObject({
      status: "available",
      evidenceCount: 2,
      value: ["folio-a", "folio-b"],
    });
    expect(patterns.deepestRoomSession).toMatchObject({
      status: "available",
      value: ["session-b"],
    });
    expect(patterns.averageKnownCostPerActiveFolio).toMatchObject({
      status: "available",
      value: { averageMicrousd: 50, knownCostMicrousd: 100, folioCount: 2 },
    });
  });

  test("does not make claims below minimum evidence", () => {
    const patterns = deriveWriterPatterns({
      events: costs.slice(0, 1),
      activities: heatmap.slice(0, 1),
      actions: actions.slice(0, 4),
      range,
      now,
    });
    expect(patterns.longestStreak).toEqual({
      status: "insufficient",
      evidenceCount: 1,
      minimum: 2,
      range,
    });
    expect(patterns.mostConsultedEditor.status).toBe("insufficient");
    expect(patterns.mostUsedTool.status).toBe("insufficient");
    expect(patterns.averageKnownCostPerActiveFolio.status).toBe("insufficient");
  });
});
