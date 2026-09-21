/**
 * Thin wrapper around `gt-i18n/internal` so the rest of the package depends on
 * a single bridge. Pin the upstream version (`gt-i18n` 1.0.28) in
 * `package.json` because we import from its internal entry point.
 */
import {
  hashMessage as gtHashMessage,
  parseAcceptLanguage as gtParseAcceptLanguage,
} from "gt-i18n/internal";
import type { MessageMetadata } from "./types";

/**
 * Canonical content hash used by the GT CLI extractor and runtime.
 * Wrapping `hashMessage` from `gt-i18n/internal` so that the rest of the
 * package never imports `gt-i18n/internal` directly. Keeping the call site
 * narrow makes it trivial to pin or replace.
 */
export function hash(message: string, metadata: MessageMetadata = {}): string {
  return gtHashMessage(message, { $format: "ICU", ...metadata });
}

/**
 * Parse an Accept-Language header into a list of preferred locales
 * (quality-sorted, duplicates removed).
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
): string[] {
  return gtParseAcceptLanguage(header ?? undefined);
}
