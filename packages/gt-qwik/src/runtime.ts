import { hash } from "./gt-bridge";
export { hash } from "./gt-bridge";
import { resolveDictionaryPath, resolveLocale } from "./catalog";
import { interpolate } from "./interpolate";
import type {
  GTConfig,
  GTState,
  TranslationCatalog,
  TranslationVariables,
} from "./types";

/**
 * Create a per-provider, JSON-serializable translation state. The state holds
 * its own `locale` and never mutates the source `config`. Pass
 * `initialLocale` to seed the locale; omitted defaults to the configured
 * `defaultLocale`. Regional locales fall back to the best supported match.
 */
export function createGTState(
  config: GTConfig,
  initialLocale?: string,
): GTState {
  const requested = initialLocale ?? config.defaultLocale;
  const resolved = resolveLocale(requested, config.locales);
  return {
    defaultLocale: config.defaultLocale,
    locales: config.locales,
    dictionary: config.dictionary,
    catalogs: config.catalogs ?? {},
    locale: resolved ?? config.defaultLocale,
  };
}

/**
 * Translate a dotted id against the state's current locale. Resolves a
 * canonical-hash catalog entry when the locale has a catalog and the source
 * entry is registered, otherwise falls back to the source ICU message.
 * Interpolates variables using the chosen locale's plural/format rules, or
 * the source locale's rules when falling back.
 */
export function translate(
  state: GTState,
  id: string,
  variables: TranslationVariables = {},
): string {
  const { message, metadata } = resolveDictionaryPath(state.dictionary, id);
  const sourceHash = hash(message, metadata);
  const targetCatalog: TranslationCatalog | undefined =
    state.catalogs?.[state.locale];
  const translation = targetCatalog?.[sourceHash];

  const text = translation ?? message;
  const localeForFormat = translation ? state.locale : state.defaultLocale;
  return interpolate(text, localeForFormat, variables);
}

/**
 * Change the state's locale. Resolves the requested locale against the
 * configured `locales` list (regional fallback included) or falls back to
 * `defaultLocale` when no match exists.
 */
export function setLocale(state: GTState, locale: string): void {
  const resolved = resolveLocale(locale, state.locales);
  state.locale = resolved ?? state.defaultLocale;
}
