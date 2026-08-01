import { describe, expect, test } from "bun:test";

describe("persona identity wiring", () => {
  test("all user-facing persona generation paths preserve the full persona", async () => {
    for (const path of [
      "src/components/personas/personas-panel.tsx",
      "src/components/comments/comments-panel.tsx",
      "src/components/rubric/rubric-panel.tsx",
    ]) {
      const source = await Bun.file(path).text();
      expect(source, path).toContain("toAgentPersona");
      expect(source, path).not.toMatch(
        /persona:\s*\{\s*id:\s*persona\.id[\s\S]{0,300}?focus:\s*persona\.focus/,
      );
    }
  });

  test("custom editor UI exposes backstory, doctrine, voiceprint, habits, and samples", async () => {
    const source = await Bun.file("src/routes/personas/index.tsx").text();

    for (const field of [
      "draftBackstory",
      "draftCriticalMethod",
      "draftVoice",
      "draftSignatureMoves",
      "draftAvoidances",
      "draftSampleLines",
      "newBackstory",
      "newCriticalMethod",
      "newVoice",
      "newSignatureMoves",
      "newAvoidances",
      "newSampleLines",
    ]) {
      expect(source).toContain(field);
    }
  });
});
