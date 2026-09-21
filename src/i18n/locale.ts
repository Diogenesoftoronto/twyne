/** App policy; the reusable GT adapter must not own Twyne preferences. */
export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "fr", "es", "zh", "hi", "ja"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type LanguagePreference = "auto" | AppLocale;
export const LANGUAGE_PREFERENCE_KEY = "twyne.language";

/** Ignore refused or invalid language ranges, preserving order for equal weights. */
export function browserLanguagesFromHeader(header = ""): string[] {
  return header
    .split(",")
    .map((part) => {
      const [language, ...parameters] = part.trim().split(";");
      const weight = parameters.find((p) => p.trim().startsWith("q="));
      const quality = weight ? Number(weight.trim().slice(2)) : 1;
      return { language, quality };
    })
    .filter(({ language, quality }) => language && quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality)
    .map(({ language }) => language);
}

export function preferenceFromCookie(cookie = ""): LanguagePreference {
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANGUAGE_PREFERENCE_KEY}=`));
  return normalizeLanguagePreference(
    entry?.slice(LANGUAGE_PREFERENCE_KEY.length + 1),
  );
}

export function normalizeLanguagePreference(
  value: unknown,
): LanguagePreference {
  return SUPPORTED_LOCALES.includes(value as AppLocale)
    ? (value as AppLocale)
    : "auto";
}

/** Ordered browser preferences; an explicit Twyne choice always wins. */
export function resolveAppLocale(
  preference: LanguagePreference,
  languages: readonly string[] = [],
): AppLocale {
  if (preference !== "auto") return preference;
  for (const language of languages) {
    const base = language.trim().toLowerCase().split("-")[0];
    if (SUPPORTED_LOCALES.includes(base as AppLocale)) return base as AppLocale;
  }
  return DEFAULT_LOCALE;
}
