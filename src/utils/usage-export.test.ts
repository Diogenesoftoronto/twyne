import { describe, expect, test } from "bun:test";
import {
  USAGE_CSV_COLUMNS,
  buildUsageExport,
  projectUsageEvent,
  serializeUsageExportCsv,
  serializeUsageExportJson,
} from "./usage-export";
import type { UsageEvent } from "./usage-domain";

const exportedAt = Date.parse("2026-08-26T18:00:00.000Z");

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    eventKey: "usage:v1:event-1",
    occurredAt: Date.parse("2026-08-26T12:00:00.000Z"),
    day: "2026-08-26",
    source: "hosted",
    authority: "server",
    feature: "persona-feedback",
    provider: "openai",
    model: "gpt-5.5",
    folioId: "folio-opaque-1",
    editorialActionId: "action-1",
    traceId: "trace-1",
    attempt: 1,
    outcome: "completed",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 2,
    totalTokens: 15,
    costMicrousd: 200,
    costKind: "estimated",
    pricingVersion: "2026-08-26",
    pricing: {
      source: "official provider docs",
      version: "2026-08-26",
      currency: "USD",
      inputMicrousdPerMillion: 5_000_000,
      outputMicrousdPerMillion: 30_000_000,
      cacheReadMicrousdPerMillion: 500_000,
    },
    ...overrides,
  };
}

const prohibited = [
  "prompt",
  "response",
  "manuscript",
  "title",
  "handle",
  "email",
  "apiKey",
  "errorMessage",
];

describe("usage JSON export", () => {
  test("exports the canonical content-free shape in stable order", () => {
    const later = event({
      eventKey: "usage:v1:event-2",
      occurredAt: Date.parse("2026-08-26T13:00:00.000Z"),
    });
    const envelope = buildUsageExport([later, event()], exportedAt);
    expect(envelope).toMatchObject({
      exportVersion: 1,
      usageEventVersion: 1,
      exportedAt,
      contentIncluded: false,
    });
    expect(envelope.events.map((row) => row.eventKey)).toEqual([
      "usage:v1:event-1",
      "usage:v1:event-2",
    ]);
    expect(envelope.events[0].pricing).toMatchObject({
      currency: "USD",
      cacheReadMicrousdPerMillion: 500_000,
    });
  });

  test("structurally excludes every prohibited field", () => {
    const json = serializeUsageExportJson([event()], exportedAt);
    for (const field of prohibited) expect(json).not.toContain(`"${field}"`);
    expect(json).toContain('"contentIncluded": false');
  });

  test("rejects widened poisoned records instead of exporting private content", () => {
    const poisoned = {
      ...event(),
      prompt: "private draft",
      title: "private title",
    } as UsageEvent;
    expect(() => projectUsageEvent(poisoned)).toThrow("field is not allowed");
  });
});

describe("usage CSV export", () => {
  test("uses an explicit safe column allowlist", () => {
    for (const field of prohibited)
      expect(USAGE_CSV_COLUMNS).not.toContain(field);
    const csv = serializeUsageExportCsv([event()]);
    expect(csv.split("\r\n")[0]).toContain('"inputTokens"');
    expect(csv.split("\r\n")[0]).toContain('"pricingSource"');
    expect(csv).not.toContain("private draft");
  });

  test("escapes quotes and neutralizes spreadsheet formulas", () => {
    const csv = serializeUsageExportCsv([
      event({
        eventKey: "usage:v1:event-formula",
        provider: '=HYPERLINK("https://example.invalid")',
      }),
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
  });

  test("keeps unknown cost blank instead of exporting a zero", () => {
    const csv = serializeUsageExportCsv([
      event({
        costKind: "unknown",
        costMicrousd: undefined,
        pricingVersion: undefined,
        pricing: undefined,
      }),
    ]);
    const header = csv.split("\r\n")[0].split(",");
    const row = csv.split("\r\n")[1].split(",");
    const costIndex = header.indexOf('"costMicrousd"');
    expect(row[costIndex]).toBe("");
  });
});
