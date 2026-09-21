/**
 * Public package entry. Re-exports the Qwik provider/hooks plus the
 * framework-free runtime helpers so consumers that need only dictionary
 * translation (server-side rendering helpers, tests, CLIs) can import
 * without pulling in Qwik.
 */
export type {
  GTConfig,
  GTState,
  MessageEntry,
  MessageMetadata,
  SourceDictionary,
  TranslationCatalog,
  TranslationVariables,
} from "./types";
export { createGTState, setLocale, translate } from "./runtime";
export { hash, parseAcceptLanguage } from "./gt-bridge";
export { direction, readEntry, resolveLocale } from "./catalog";
export {
  GTContext,
  GTProvider,
  setLocaleQrl,
  useGT,
  useTranslate,
} from "./qwik";
export type { GTProviderProps, GTProviderState } from "./qwik";
