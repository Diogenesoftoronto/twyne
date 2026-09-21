/**
 * Extractor-compatibility tests for the dictionary format. The official
 * GT CLI exposes `createDictionaryUpdates` from its `gt-react` parser.
 * It operates on a JSON file on disk and returns one entry per message:
 *
 *   { dataFormat, source, metadata: { id, hash } }
 *
 * The `hash` is the same canonical content hash `gt-i18n/internal`
 * `hashMessage()` produces. This test writes a source dictionary fixture
 * to a temp file, runs the real CLI module against it, then asserts that:
 *
 *   - our dictionary shape is recognized (id = dotted path)
 *   - the `hash` agrees with what our runtime `hash()` produces
 *   - a catalog keyed by those hashes resolves through `translate()`
 *
 * Driving the real installed CLI module means a future GT regression
 * shows up here instead of slipping past a stub.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashMessage } from "gt-i18n/internal";
import { hash } from "../src/gt-bridge";
import { createGTState, translate } from "../src/runtime";
import type { GTConfig, SourceDictionary } from "../src/types";

/** Per-entry shape returned by GT's `createDictionaryUpdates`. */
interface CLIUpdate {
  dataFormat: string;
  source: string;
  metadata: { id: string; hash: string };
}

let workDir: string;
let fixturePath: string;
let fixtureData: SourceDictionary;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "gt-qwik-extractor-"));
  fixturePath = join(workDir, "messages.json");
  fixtureData = {
    settings: {
      title: "Settings",
      welcome: "Hello, {name}!",
      count: "{count, plural, one {# draft} other {# drafts}}",
      save: ["Save", { $context: "Save action", $maxChars: 20 }],
    },
    missing: "Not translated yet",
  };
  writeFileSync(fixturePath, JSON.stringify(fixtureData));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** Resolve the installed GT CLI's extractor module at runtime. */
async function loadCLI(): Promise<{
  createDictionaryUpdates: (
    filepath: string,
    errors: unknown[],
    warnings: unknown[],
  ) => Promise<CLIUpdate[]>;
}> {
  // import.meta.resolve("gt") -> the package entry, then walk to the
  // React parser. Bun's static analyzer cannot follow this construct
  // because the URL is built from a runtime-resolved specifier.
  const url = new URL(
    "./react/parse/createDictionaryUpdates.js",
    import.meta.resolve("gt"),
  ).href;
  const mod = await import(url);
  return { createDictionaryUpdates: mod.createDictionaryUpdates };
}

describe("extractor compatibility", () => {
  test("CLI emits one update per message with the dotted-path id", async () => {
    const { createDictionaryUpdates } = await loadCLI();
    const errors: unknown[] = [];
    const warnings: unknown[] = [];
    const updates = await createDictionaryUpdates(
      fixturePath,
      errors,
      warnings,
    );
    const ids = updates.map((u) => u.metadata.id).sort();
    expect(ids).toEqual(
      [
        "missing",
        "settings.count",
        "settings.save",
        "settings.title",
        "settings.welcome",
      ].sort(),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("CLI hashes agree with hashMessage from gt-i18n/internal", async () => {
    const { createDictionaryUpdates } = await loadCLI();
    const updates = await createDictionaryUpdates(fixturePath, [], []);
    const byId = new Map(updates.map((u) => [u.metadata.id, u]));
    expect(byId.get("settings.title")?.metadata.hash).toBe(
      hashMessage("Settings", { $format: "ICU" }),
    );
    expect(byId.get("settings.welcome")?.metadata.hash).toBe(
      hashMessage("Hello, {name}!", { $format: "ICU" }),
    );
    expect(byId.get("settings.save")?.metadata.hash).toBe(
      hashMessage("Save", {
        $format: "ICU",
        $context: "Save action",
        $maxChars: 20,
      }),
    );
  });

  test("catalogs built from CLI hashes resolve via translate()", async () => {
    const { createDictionaryUpdates } = await loadCLI();
    const updates = await createDictionaryUpdates(fixturePath, [], []);
    const catalogs = {
      fr: Object.fromEntries(
        updates.map((u) => [
          u.metadata.hash,
          u.metadata.id === "settings.title"
            ? "Paramètres"
            : u.metadata.id === "settings.welcome"
              ? "Bonjour, {name} !"
              : u.metadata.id,
        ]),
      ),
    };
    const config: GTConfig = {
      defaultLocale: "en",
      locales: ["en", "fr"],
      dictionary: fixtureData,
      catalogs,
    };
    const state = createGTState(config, "fr");
    expect(translate(state, "settings.title")).toBe("Paramètres");
    expect(translate(state, "settings.welcome", { name: "Ada" })).toBe(
      "Bonjour, Ada !",
    );
  });

  test("bundled hash() is a faithful bridge to hashMessage", () => {
    expect(hash("Settings")).toBe(hashMessage("Settings", { $format: "ICU" }));
    expect(hash("Save", { $context: "Save action", $maxChars: 20 })).toBe(
      hashMessage("Save", {
        $format: "ICU",
        $context: "Save action",
        $maxChars: 20,
      }),
    );
    expect(hash("Hello, {name}!")).toBe(
      hashMessage("Hello, {name}!", { $format: "ICU" }),
    );
  });
});
