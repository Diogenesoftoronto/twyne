/** Serializable source entries; metadata participates in GT's content hash. */
export interface MessageMetadata {
  $context?: string;
  $maxChars?: number;
}
export type MessageEntry = string | [string] | [string, MessageMetadata];

export interface SourceDictionary {
  [key: string]: MessageEntry | SourceDictionary;
}

/** GT catalog: canonical source hashes mapped to translated ICU messages. */
export type TranslationCatalog = Record<string, string>;

export interface GTConfig {
  defaultLocale: string;
  locales: string[];
  dictionary: SourceDictionary;
  catalogs?: Record<string, TranslationCatalog>;
}

/** Plain data only: this state must survive Qwik pause/resume. */
export interface GTState extends GTConfig {
  locale: string;
}

export type TranslationVariables = Record<
  string,
  string | number | boolean | Date
>;
