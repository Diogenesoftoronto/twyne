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
      "runClientTargetFitJudge",
      "runClientCustomCriterionJudge",
    ],
  },
  {
    // Voice must not become a hosted-only feature: both reading aloud and
    // transcribing have to try the writer's own key first.
    path: "src/utils/speech.ts",
    // Voice gates on a voice-capable provider, not a language one — a writer
    // may have only Fish Audio configured, or only an LLM that cannot speak.
    mustInclude: ["hasConfiguredVoiceProvider", "runClientVoiceSpeech"],
  },
  {
    path: "src/utils/voice-notes.ts",
    mustInclude: ["hasConfiguredVoiceProvider", "runClientVoiceTranscribe"],
  },
  {
    path: "src/utils/background-room.ts",
    mustInclude: ["hasConfiguredAiProvider", "runClientAgent"],
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
