/**
 * Options shared by the pure matcher, ProseMirror extension, and UI.
 */
export interface FindReplaceOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
}

export interface FindReplaceMatch {
  /** Zero-based UTF-16 offset in the searched string. */
  from: number;
  /** Exclusive zero-based UTF-16 offset in the searched string. */
  to: number;
  text: string;
}

export interface FindReplaceResult {
  matches: FindReplaceMatch[];
  /** A recoverable message suitable for display beside the search field. */
  error: string | null;
}

export interface FindReplaceQuery extends Required<FindReplaceOptions> {
  search: string;
}

export const DEFAULT_FIND_REPLACE_QUERY: FindReplaceQuery = {
  search: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/** Escape literal text before embedding it in a regular expression. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word characters intentionally follow JavaScript's portable `\w` contract.
 * The lookaround form avoids consuming punctuation, which keeps reported
 * offsets exact and allows matches immediately beside punctuation.
 */
function withWholeWordBoundary(source: string): string {
  return `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
}

export function compileFindPattern(
  search: string,
  options: FindReplaceOptions = {},
): { pattern: RegExp | null; error: string | null } {
  if (search.length === 0) return { pattern: null, error: null };

  const source = options.regex ? search : escapeRegExp(search);
  const bounded = options.wholeWord ? withWholeWordBoundary(source) : source;
  const flags = options.caseSensitive ? "gu" : "giu";

  try {
    return { pattern: new RegExp(bounded, flags), error: null };
  } catch (error) {
    return {
      pattern: null,
      error:
        error instanceof Error ? error.message : "Invalid regular expression",
    };
  }
}

/**
 * Find every non-overlapping match in reading order.
 *
 * Zero-width regular expressions are supported without hanging: each empty
 * match is reported once, then `lastIndex` advances by one Unicode code point.
 * Literal mode can never produce an empty match because an empty query is an
 * explicit no-op.
 */
export function findTextMatches(
  text: string,
  search: string,
  options: FindReplaceOptions = {},
): FindReplaceResult {
  const { pattern, error } = compileFindPattern(search, options);
  if (!pattern || error) return { matches: [], error };

  const matches: FindReplaceMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const from = match.index;
    const value = match[0];
    matches.push({ from, to: from + value.length, text: value });

    if (value.length === 0) {
      const nextCodePoint = text.codePointAt(pattern.lastIndex);
      pattern.lastIndex +=
        nextCodePoint != null && nextCodePoint > 0xffff ? 2 : 1;
    }
  }

  return { matches, error: null };
}

/** Concise alias for consumers that do not need to distinguish text/document matches. */
export const findMatches = findTextMatches;

/** Positive modulo used by next/previous navigation and deletion recovery. */
export function wrapMatchIndex(index: number, count: number): number {
  if (count <= 0) return -1;
  return ((index % count) + count) % count;
}

/**
 * Pick the next match at or after a document position. When none remains,
 * navigation wraps to the first match.
 */
export function nextMatchIndex<T extends { from: number }>(
  matches: readonly T[],
  position: number,
): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.from >= position);
  return index === -1 ? 0 : index;
}

/**
 * Pick the previous match ending before a document position. When none exists,
 * navigation wraps to the last match.
 */
export function previousMatchIndex<T extends { to: number }>(
  matches: readonly T[],
  position: number,
): number {
  if (matches.length === 0) return -1;
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index].to <= position) return index;
  }
  return matches.length - 1;
}

/**
 * JavaScript replacement semantics for one already-matched range. Supports
 * `$&`, capture references, named captures, and replacement callbacks without
 * scanning or replacing any other occurrence in the source string.
 */
export function replacementForMatch(
  matchedText: string,
  search: string,
  replacement: string,
  options: FindReplaceOptions = {},
): { replacement: string; error: string | null } {
  if (!options.regex) return { replacement, error: null };

  const { pattern, error } = compileFindPattern(search, {
    ...options,
    wholeWord: false,
  });
  if (!pattern || error) return { replacement: matchedText, error };

  const anchoredFlags = options.caseSensitive ? "u" : "iu";
  try {
    const anchored = new RegExp(`^(?:${pattern.source})$`, anchoredFlags);
    return {
      replacement: matchedText.replace(anchored, replacement),
      error: null,
    };
  } catch (caught) {
    return {
      replacement: matchedText,
      error:
        caught instanceof Error ? caught.message : "Invalid regular expression",
    };
  }
}
