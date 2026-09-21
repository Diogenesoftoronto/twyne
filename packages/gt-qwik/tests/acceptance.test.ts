/** Coordinator-owned acceptance contract. Do not weaken to fit implementation. */
import { describe, expect, test } from "bun:test";
import { hashMessage } from "gt-i18n/internal";
import { createGTState, translate, setLocale } from "../src/runtime";
import type { GTConfig } from "../src/types";

const count = "{count, plural, one {# draft} other {# drafts}}";
const countFr = "{count, plural, one {# brouillon} other {# brouillons}}";
const welcome = "Hello, {name}!";
const metadata = { $context: "A button to save a manuscript", $maxChars: 20 };
const config: GTConfig = {
  defaultLocale: "en",
  locales: ["en", "fr"],
  dictionary: {
    settings: { title: "Settings", welcome, count, save: ["Save", metadata] },
    missing: "Not translated yet",
    literal: "<script>alert(1)</script>",
  },
  catalogs: {
    fr: {
      [hashMessage("Settings", { $format: "ICU" })]: "Paramètres",
      [hashMessage(welcome, { $format: "ICU" })]: "Bonjour, {name} !",
      [hashMessage(count, { $format: "ICU" })]: countFr,
      [hashMessage("Save", { $format: "ICU", ...metadata })]: "Enregistrer",
    },
  },
};

describe("gt-qwik acceptance", () => {
  test("English is the default even when a French catalog exists", () => {
    expect(translate(createGTState(config), "settings.title")).toBe("Settings");
  });
  test("reads nested dictionary IDs using canonical GT catalog hashes", () => {
    expect(translate(createGTState(config, "fr"), "settings.title")).toBe(
      "Paramètres",
    );
  });
  test("matches regional locales and rejects unsupported locales by falling back", () => {
    expect(createGTState(config, "fr-CA").locale).toBe("fr");
    expect(createGTState(config, "ja").locale).toBe("en");
  });
  test("metadata participates in translation lookup", () => {
    expect(translate(createGTState(config, "fr"), "settings.save")).toBe(
      "Enregistrer",
    );
  });
  test("interpolates variables after choosing the translated message", () => {
    expect(
      translate(createGTState(config, "fr"), "settings.welcome", {
        name: "Camille",
      }),
    ).toBe("Bonjour, Camille !");
  });
  test("uses French plural rules, including zero", () => {
    const state = createGTState(config, "fr");
    expect(translate(state, "settings.count", { count: 0 })).toBe(
      "0 brouillon",
    );
    expect(translate(state, "settings.count", { count: 2 })).toBe(
      "2 brouillons",
    );
  });
  test("missing translations and absent catalogs retain source text", () => {
    expect(translate(createGTState(config, "fr"), "missing")).toBe(
      "Not translated yet",
    );
    expect(
      translate(
        createGTState({ ...config, catalogs: {} }, "fr"),
        "settings.title",
      ),
    ).toBe("Settings");
  });
  test("fallback ICU messages use source-language plural rules", () => {
    const state = createGTState({ ...config, catalogs: {} }, "fr");
    expect(translate(state, "settings.count", { count: 0 })).toBe("0 drafts");
  });
  test("separate providers never share mutable locale state", () => {
    const english = createGTState(config, "en");
    const french = createGTState(config, "fr");
    setLocale(english, "fr");
    setLocale(french, "en");
    expect(translate(english, "settings.title")).toBe("Paramètres");
    expect(translate(french, "settings.title")).toBe("Settings");
    expect(config.locales).toEqual(["en", "fr"]);
  });
  test("state round-trips through JSON without losing translation behavior", () => {
    const state = JSON.parse(JSON.stringify(createGTState(config, "fr")));
    expect(translate(state, "settings.title")).toBe("Paramètres");
  });
  test("unknown IDs fail explicitly, including prototype property names", () => {
    const state = createGTState(config);
    expect(() => translate(state, "does.not.exist")).toThrow();
    expect(() => translate(state, "toString")).toThrow();
    expect(() => translate(state, "__proto__.constructor")).toThrow();
  });
  test("text output does not reinterpret markup", () => {
    expect(translate(createGTState(config), "literal")).toBe(
      "<script>alert(1)</script>",
    );
  });
  test("inherited dictionary values are not translatable IDs", () => {
    const dictionary = Object.assign(
      Object.create({ inherited: "Unexpected" }),
      { own: "Expected" },
    );
    const state = createGTState({ ...config, dictionary });
    expect(translate(state, "own")).toBe("Expected");
    expect(() => translate(state, "inherited")).toThrow();
  });
});
