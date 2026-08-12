import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("runtime scaling and narration composition wiring", () => {
  test("keeps local narration UI trigger-only", () => {
    const transport = source("../components/ui/speech-transport.tsx");

    expect(transport).toContain("onClick$={props.onPlay$}");
    expect(transport).not.toMatch(
      /\b(?:nextSpeech|previousSpeech|seekSpeech|stopSpeech|togglePauseSpeech)\b/u,
    );
  });

  test("cancels a stale grammar pass on both sides of each worker request", () => {
    const grammar = source("../components/editor/grammar-panel.tsx");
    const request = grammar.indexOf(
      "const issues = await checkGrammar(block.text, language);",
    );
    const before = grammar.lastIndexOf(
      "if (mine !== store.scan) return;",
      request,
    );
    const after = grammar.indexOf("if (mine !== store.scan) return;", request);

    expect(request).toBeGreaterThan(-1);
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(request);
    expect(after).toBeGreaterThan(request);
  });

  test("invalidates the speech text map without reading the whole DOM per tick", () => {
    const player = source("../components/ui/global-speech-player.tsx");

    expect(player).toContain("new MutationObserver");
    expect(player).toContain("activeMapDirty");
    expect(player).not.toContain("activeMap.root.textContent");
  });

  test("builds reasoning controls only for the provider default model", () => {
    const settings = source("../routes/settings/index.tsx");

    expect(settings).toContain(
      "(candidate) => candidate.id === provider.defaultModel",
    );
    expect(settings).toContain(
      "return reasoningOptions?.length ? [{ ...model, reasoningOptions }] : [];",
    );
  });
});
