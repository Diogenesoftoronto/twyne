import { describe, expect, test } from "bun:test";
import type { ProjectInterviewAnswers } from "../types";
import {
  dossierCheckUnavailableMessage,
  parseDossierCheckResult,
  runDossierCheckWithHostedFallback,
} from "./dossier-check";

const answers: ProjectInterviewAnswers = {
  workingTitle: "Old title",
  format: "Essay",
  audience: "Policy readers",
  goal: "Explain the tradeoff",
  tone: "Measured",
  constraints: "Cite every numerical claim",
  successSignal: "The reader can describe the tradeoff",
};

describe("parseDossierCheckResult", () => {
  test("accepts a valid empty drift report", () => {
    expect(
      parseDossierCheckResult('{"observations":[]}', "hosted", answers),
    ).toEqual({ observations: [], provider: "hosted" });
  });

  test("narrows fields, fills current values, and preserves first-seen order", () => {
    const result = parseDossierCheckResult(
      JSON.stringify({
        observations: [
          {
            field: "tone",
            suggested: "Sharper",
            reason: "The draft is more direct than the filed tone.",
          },
          {
            field: "unknown",
            current: "x",
            suggested: "y",
            reason: "invalid",
          },
          {
            field: "tone",
            current: "Measured",
            suggested: "Different duplicate",
            reason: "duplicate",
          },
          {
            field: "workingTitle",
            current: "Old title",
            suggested: "New title",
            reason: "The manuscript now names the central conflict.",
          },
        ],
      }),
      "local",
      answers,
    );

    expect(result?.observations.map((item) => item.field)).toEqual([
      "tone",
      "workingTitle",
    ]);
    expect(result?.observations[0]?.current).toBe(answers.tone);
  });

  test("accepts fenced JSON and drops unactionable observations", () => {
    const result = parseDossierCheckResult(
      `Here is the report:
      \`\`\`json
      {"observations":[
        {"field":"goal","suggested":"","reason":"No replacement"},
        {"field":"audience","suggested":"Editors","reason":"The draft assumes editorial vocabulary."}
      ]}
      \`\`\``,
      "test",
      answers,
    );

    expect(result?.observations).toHaveLength(1);
    expect(result?.observations[0]?.field).toBe("audience");
  });

  test("finds the report after non-JSON brace-shaped prose", () => {
    const result = parseDossierCheckResult(
      `Use {field, current, suggested, reason}. Actual report:
      {"observations":[{"field":"format","suggested":"Reported essay","reason":"The draft now uses a reported structure."}]}
      End.`,
      "test",
      answers,
    );

    expect(result?.observations[0]?.field).toBe("format");
  });

  test.each(["", "not json", '{"observations":{}}', '{"wrong":[]}'])(
    "returns null for malformed protocol output: %s",
    (text) => {
      expect(parseDossierCheckResult(text, "test", answers)).toBeNull();
    },
  );
});

describe("dossierCheckUnavailableMessage", () => {
  test("distinguishes configured-provider failure from missing configuration", () => {
    const failedProvider = dossierCheckUnavailableMessage(true);
    const missingProvider = dossierCheckUnavailableMessage(false);

    expect(failedProvider).toContain("configured language provider");
    expect(failedProvider).toContain("could not complete");
    expect(failedProvider).not.toContain("needs either");
    expect(missingProvider).toContain("needs either");
  });
});

describe("runDossierCheckWithHostedFallback", () => {
  const report = {
    observations: [],
    provider: "hosted",
  };

  test("uses hosted review after a configured client provider returns null", async () => {
    const calls: string[] = [];
    const result = await runDossierCheckWithHostedFallback({
      runClient: async () => {
        calls.push("client");
        return null;
      },
      runHosted: async () => {
        calls.push("hosted");
        return report;
      },
    });

    expect(calls).toEqual(["client", "hosted"]);
    expect(result).toEqual(report);
  });

  test("does not spend a hosted request after client review succeeds", async () => {
    const calls: string[] = [];
    const clientReport = { ...report, provider: "byok" };
    const result = await runDossierCheckWithHostedFallback({
      runClient: async () => {
        calls.push("client");
        return clientReport;
      },
      runHosted: async () => {
        calls.push("hosted");
        return report;
      },
    });

    expect(calls).toEqual(["client"]);
    expect(result).toEqual(clientReport);
  });
});
