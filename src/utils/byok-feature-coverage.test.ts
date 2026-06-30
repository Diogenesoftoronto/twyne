import { describe, expect, test } from "bun:test";

const CASES = [
  {
    path: "src/components/onboarding/conversational-interview.tsx",
    mustInclude: ["hasConfiguredAiProvider", "runClientInterviewTurn"],
  },
  {
    path: "src/components/personas/personas-panel.tsx",
    mustInclude: [
      "hasConfiguredAiProvider",
      "runClientAgent",
      "runClientRewrite",
      "runClientRoomSynthesis",
    ],
  },
  {
    path: "src/components/comments/comments-panel.tsx",
    mustInclude: ["hasConfiguredAiProvider", "runClientAgent"],
  },
  {
    path: "src/components/rubric/rubric-panel.tsx",
    mustInclude: [
      "hasConfiguredAiProvider",
      "runClientJudge",
      "runClientRubricReview",
    ],
  },
  {
    path: "src/routes/dossier/refine/index.tsx",
    mustInclude: ["hasConfiguredAiProvider", "runClientDossierCheck"],
  },
  {
    path: "src/routes/apparatus/index.tsx",
    mustInclude: [
      "hasConfiguredAiProvider",
      "runClientCitationFormat",
      "runClientMissingSourceDetect",
    ],
  },
  {
    path: "src/utils/ai-orchestrator.ts",
    mustInclude: ["hasConfiguredAiProvider", "runClientAgent"],
  },
];

describe("BYOK feature coverage", () => {
  test("keeps provider-aware client paths wired across the feature surfaces", async () => {
    for (const entry of CASES) {
      const source = await Bun.file(entry.path).text();
      for (const needle of entry.mustInclude) {
        expect(source).toContain(needle);
      }
    }
  });

  test("does not reintroduce legacy advancedMode gating in the feature callers", async () => {
    for (const entry of CASES) {
      const source = await Bun.file(entry.path).text();
      expect(source).not.toContain("settings?.advancedMode && settings.providers.length > 0");
      expect(source).not.toContain("settings2?.advancedMode && settings2.providers.length > 0");
      expect(source).not.toContain("if (!settings.advancedMode || settings.providers.length === 0)");
      expect(source).not.toContain("if (settings.advancedMode && settings.providers.length > 0)");
    }
  });
});
