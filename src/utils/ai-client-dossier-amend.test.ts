import { afterEach, expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import type { AiSettings } from "../types";
// Qwik normally receives this compile-time flag from Vite.
Object.assign(globalThis, { __EXPERIMENTAL__: {} });
const realAi = await import(
  `${createRequire(import.meta.url).resolve("ai")}?dossier-amend-real`
);
let reply = "";
let fail = false;
mock.module("ai", () => ({
  ...realAi,
  generateText: async () => {
    if (fail) throw new Error("Offline");
    return {
      text: reply,
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      steps: [],
      finishReason: "stop",
    };
  },
}));
const { runClientDossierAmend, setClientUsageRecorderForTests } = await import(
  `./ai-client?dossier-amend-test=${Date.now()}`
);
const settings: AiSettings = {
  advancedMode: false,
  providers: [
    {
      id: "local",
      name: "Local",
      type: "openai-compatible",
      apiKey: "local",
      baseUrl: "http://localhost:8080/v1",
      defaultModel: "test",
      availableModels: ["test"],
    },
  ],
  defaultProviderId: "local",
  perFeature: {},
  showProviderTags: false,
};
const request = {
  field: "tone" as const,
  label: "Tone",
  current: "Formal",
  excerpt: "Here is what happened.",
  dossier: "Tone: Formal",
};
afterEach(() => {
  fail = false;
  setClientUsageRecorderForTests(undefined);
});
test("amendment strips reasoning and quotes and returns one bounded line", async () => {
  setClientUsageRecorderForTests(async () => null);
  reply = "<think>Private reasoning</think>“Direct\nand conversational”";
  expect(await runClientDossierAmend(request, settings)).toBe(
    "Direct and conversational",
  );
  reply = "x".repeat(300);
  expect((await runClientDossierAmend(request, settings))?.length).toBe(240);
});
test("amendment quietly returns null on provider failure", async () => {
  setClientUsageRecorderForTests(async () => null);
  fail = true;
  expect(await runClientDossierAmend(request, settings)).toBeNull();
});
