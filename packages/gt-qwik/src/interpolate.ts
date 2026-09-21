import { formatMessage } from "@generaltranslation/format";
import type { FormatVariables } from "@generaltranslation/format";
import type { TranslationVariables } from "./types";

/**
 * Interpolate an ICU message with the given variables using the locale-aware
 * `formatMessage` from `@generaltranslation/format`. Invalid ICU (for example
 * a string with a stray `{script}` placeholder) returns the message
 * unchanged rather than throwing — the upstream `gt-i18n` `gtFallback` follows
 * the same convention so that translated-but-uninterpolatable strings still
 * render.
 */
export function interpolate(
  message: string,
  locale: string,
  variables: TranslationVariables = {},
): string {
  if (!message) return message;
  if (!message.includes("{")) return message;
  const variablesForFormat: FormatVariables = { ...variables };
  for (const [key, value] of Object.entries(variablesForFormat)) {
    if (value instanceof Date) {
      variablesForFormat[key] = value.toISOString();
    } else if (typeof value === "boolean") {
      variablesForFormat[key] = value ? "true" : "false";
    }
  }
  try {
    return formatMessage(message, {
      locales: locale,
      variables: variablesForFormat,
      dataFormat: "ICU",
    });
  } catch {
    return message;
  }
}
