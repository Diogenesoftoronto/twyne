import { describe, expect, test } from "bun:test";
import {
  normalizeLanguagePreference,
  resolveAppLocale,
  browserLanguagesFromHeader,
  preferenceFromCookie,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "./locale";

describe("Twyne language preference", () => {
  test.each([...SUPPORTED_LOCALES])(
    "persists and explicitly selects %s",
    (locale) => {
      expect(normalizeLanguagePreference(locale)).toBe(locale);
      expect(preferenceFromCookie(`twyne.language=${locale}`)).toBe(locale);
      expect(resolveAppLocale(locale, ["fr-CA", "en-US"])).toBe(locale);
    },
  );
  test.each<[string, AppLocale]>([
    ["es-MX", "es"],
    ["zh-CN", "zh"],
    ["zh-Hans-SG", "zh"],
    ["hi-IN", "hi"],
    ["ja-JP", "ja"],
  ])("detects regional preference %s", (regional, locale) => {
    expect(resolveAppLocale("auto", ["de", regional, "en"])).toBe(locale);
    expect(resolveAppLocale("auto", ["en", regional])).toBe("en");
  });
  test("server preferences respect quality and refusal weights", () => {
    expect(
      resolveAppLocale(
        "auto",
        browserLanguagesFromHeader("en;q=0.2,fr-CA;q=0.9"),
      ),
    ).toBe("fr");
    expect(
      resolveAppLocale("auto", browserLanguagesFromHeader("fr;q=0,en;q=1")),
    ).toBe("en");
    expect(browserLanguagesFromHeader("fr;q=nope,en;q=2,de;q=-1")).toEqual([]);
  });

  test("only the exact language preference cookie controls SSR", () => {
    expect(preferenceFromCookie("other=fr; twyne.language=en")).toBe("en");
    expect(preferenceFromCookie("fake.twyne.language=fr")).toBe("auto");
    expect(preferenceFromCookie("twyne.language=invalid")).toBe("auto");
  });
  test("matches French regional preferences while respecting browser order", () => {
    expect(resolveAppLocale("auto", ["fr-CA", "en-US"])).toBe("fr");
    expect(resolveAppLocale("auto", ["en-GB", "fr"])).toBe("en");
    expect(resolveAppLocale("auto", ["de", "fr-FR"])).toBe("fr");
  });

  test("uses English when browser preferences are absent or unsupported", () => {
    expect(resolveAppLocale("auto")).toBe("en");
    expect(resolveAppLocale("auto", ["de", "ko"])).toBe("en");
  });

  test("explicit settings override browser preferences", () => {
    expect(resolveAppLocale("en", ["fr"])).toBe("en");
    expect(resolveAppLocale("fr", ["en"])).toBe("fr");
  });

  test("missing and stale stored choices restore automatic detection", () => {
    expect(normalizeLanguagePreference(null)).toBe("auto");
    expect(normalizeLanguagePreference("de")).toBe("auto");
    expect(normalizeLanguagePreference("fr")).toBe("fr");
  });
});
