import {
  getLocaleDirection,
  isSupersetLocale,
} from "@generaltranslation/format";
import type { MessageEntry, MessageMetadata, SourceDictionary } from "./types";

function languageSubtag(locale: string): string {
  const dash = locale.indexOf("-");
  return dash === -1 ? locale : locale.slice(0, dash).toLowerCase();
}

function normalize(locale: string): string {
  if (!locale) return locale;
  const parts = locale
    .split("-")
    .map((p, i) =>
      i === 0
        ? p.toLowerCase()
        : p.length === 4
          ? p[0].toUpperCase() + p.slice(1).toLowerCase()
          : p.toUpperCase(),
    );
  return parts.join("-");
}

/**
 * Resolve a requested locale against supported locales:
 *  1. exact (case-normalized) match,
 *  2. same language subtag (e.g. `fr-CA` -> `fr`),
 *  3. superset match (e.g. `fr` -> `fr-CA` when only `fr-CA` exists).
 * Returns the supported locale or `undefined` when nothing matches.
 */
export function resolveLocale(
  requested: string,
  supported: string[],
): string | undefined {
  const normalizedRequested = normalize(requested);
  if (!normalizedRequested) return undefined;
  const normalizedSupported = supported.map(normalize);

  const exact = normalizedSupported.indexOf(normalizedRequested);
  if (exact !== -1) return normalizedSupported[exact];

  const requestedLang = languageSubtag(normalizedRequested);
  const sameLang = normalizedSupported.find(
    (loc) => languageSubtag(loc) === requestedLang,
  );
  if (sameLang) return sameLang;

  for (const candidate of normalizedSupported) {
    if (isSupersetLocale(candidate, normalizedRequested)) return candidate;
  }
  for (const candidate of normalizedSupported) {
    if (
      isSupersetLocale(candidate, requestedLang) &&
      languageSubtag(candidate) === requestedLang
    ) {
      return candidate;
    }
  }
  return undefined;
}

export function readEntry(entry: MessageEntry): {
  message: string;
  metadata: MessageMetadata;
} {
  if (typeof entry === "string") return { message: entry, metadata: {} };
  const [message, metadata] = entry;
  return { message, metadata: metadata ?? {} };
}

/**
 * Look up a dotted id (e.g. `settings.title`) in a nested dictionary.
 * Throws when any segment is missing or when the leaf is itself a nested
 * dictionary. Throws for prototype-property lookups by treating unknown
 * segments as missing paths.
 */
export function resolveDictionaryPath(
  dictionary: SourceDictionary,
  id: string,
): { message: string; metadata: MessageMetadata } {
  const segments = id.split(".");
  if (segments.length === 0 || segments.some((s) => s.length === 0)) {
    throw new Error(`[gt-qwik] invalid id: ${JSON.stringify(id)}`);
  }
  // Only own dictionary properties can be translated.
  let cursor: MessageEntry | SourceDictionary | undefined = dictionary;
  for (const segment of segments) {
    if (cursor == null || typeof cursor !== "object" || Array.isArray(cursor)) {
      throw new Error(`[gt-qwik] unknown id: ${id}`);
    }
    if (!Object.hasOwn(cursor, segment)) {
      throw new Error(`[gt-qwik] unknown id: ${id}`);
    }
    const next = (cursor as SourceDictionary)[segment];
    if (next === undefined) {
      throw new Error(`[gt-qwik] unknown id: ${id}`);
    }
    cursor = next as MessageEntry | SourceDictionary;
  }
  if (typeof cursor === "object" && !Array.isArray(cursor)) {
    throw new Error(`[gt-qwik] unknown id: ${id}`);
  }
  return readEntry(cursor as MessageEntry);
}

export function direction(locale: string): "ltr" | "rtl" {
  return getLocaleDirection(locale);
}
