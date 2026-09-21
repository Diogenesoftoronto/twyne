import {
  type AppLocale,
  type LanguagePreference,
  normalizeLanguagePreference,
  resolveAppLocale,
  preferenceFromCookie,
  LANGUAGE_PREFERENCE_KEY,
} from "./locale";

const LANGUAGE_NAMES: Record<AppLocale, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  zh: "Simplified Chinese",
  hi: "Hindi",
  ja: "Japanese",
};

/** Resolve at request time, so Settings changes affect the very next reply. */
export function currentModelLocale(): AppLocale {
  // The provider writes the current in-memory choice even when persistence is
  // blocked. Keep it on this document, never in server/module-global state.
  const current =
    typeof document === "undefined"
      ? undefined
      : document.documentElement.dataset.twyneLanguagePreference;
  if (current !== undefined) {
    return resolveAppLocale(
      normalizeLanguagePreference(current),
      typeof navigator === "undefined" ? [] : navigator.languages,
    );
  }
  let preference: LanguagePreference = "auto";
  try {
    if (typeof document !== "undefined")
      preference = preferenceFromCookie(document.cookie);
  } catch {
    /* Sandboxed documents can deny cookie reads too. */
  }
  try {
    const stored = localStorage.getItem(LANGUAGE_PREFERENCE_KEY);
    if (stored !== null) preference = normalizeLanguagePreference(stored);
  } catch {
    /* Cookies/browser detection still work when storage is disabled. */
  }
  return resolveAppLocale(
    preference,
    typeof navigator === "undefined" ? [] : navigator.languages,
  );
}

/** Pure, request-scoped policy shared by hosted and browser model calls. */
export function withResponseLanguage(
  system: string | undefined,
  locale: AppLocale = "en",
): string {
  return [
    system,
    `Response language: ${LANGUAGE_NAMES[locale]}. Write user-facing replies, questions, feedback, summaries, and explanations in this language unless the user explicitly requests another language. Preserve verbatim quotations, source titles, citations, code, URLs, and transcription in their original language. Keep manuscript replacement text in the manuscript's language unless translation is requested. Never translate JSON keys, enum values, tool names, or protocol markers; translate only human-readable prose values. Follow the required output schema.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
