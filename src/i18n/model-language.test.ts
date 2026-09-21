import { describe, expect, test } from "bun:test";
import { currentModelLocale, withResponseLanguage } from "./model-language";
import type { AppLocale } from "./locale";

describe("model response language", () => {
  test("in-memory Settings wins with blocked storage; Automatic tracks browser changes", () => {
    const saved = ["document", "navigator", "localStorage"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
    );
    const dataset = { twyneLanguagePreference: "ja" };
    const languages = ["fr-CA", "en-US"];
    try {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
          documentElement: { dataset },
          get cookie() {
            throw new Error("blocked");
          },
        },
      });
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get() {
          throw new Error("blocked");
        },
      });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { languages },
      });
      expect(currentModelLocale()).toBe("ja");
      dataset.twyneLanguagePreference = "auto";
      expect(currentModelLocale()).toBe("fr");
      languages.splice(0, languages.length, "hi-IN");
      expect(currentModelLocale()).toBe("hi");
      dataset.twyneLanguagePreference = "en";
      expect(currentModelLocale()).toBe("en");
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
  test.each<[AppLocale, string]>([
    ["en", "English"],
    ["fr", "French"],
    ["es", "Spanish"],
    ["zh", "Simplified Chinese"],
    ["hi", "Hindi"],
    ["ja", "Japanese"],
  ])(
    "preserves the task and protects structured/source content in %s",
    (locale, name) => {
      const prompt = withResponseLanguage("Return DOSSIER: with JSON.", locale);
      expect(prompt).toStartWith("Return DOSSIER: with JSON.");
      expect(prompt).toContain(`Response language: ${name}.`);
      expect(prompt).toContain(
        "Never translate JSON keys, enum values, tool names, or protocol markers",
      );
      expect(prompt).toContain("transcription in their original language");
      expect(prompt).toContain(
        "manuscript's language unless translation is requested",
      );
    },
  );
  test("requests remain isolated and older callers default to English", () => {
    expect(withResponseLanguage(undefined, "ja")).toContain("Japanese");
    expect(withResponseLanguage(undefined, "fr")).not.toContain("Japanese");
    expect(withResponseLanguage(undefined)).toContain(
      "Response language: English.",
    );
  });
});
