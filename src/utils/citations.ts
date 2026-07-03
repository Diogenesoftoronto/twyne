import type { DetectedCitation } from "../types";

const NAME_PART =
  "(?:(?:de|del|van|von|der|da|dos)\\s+)*[A-Z][A-Za-z'’.-]+(?:\\s+(?:[A-Z][A-Za-z'’.-]+|de|del|van|von|der|da|dos))*";
const DOI_REGEX = /\b(?:doi:\s*)?(10\.\d{4,9}\/[^\s,;<>"]+)/gi;
const URL_REGEX = /https?:\/\/[^\s<>"]+/g;
const ISBN_REGEX = /\b(?:ISBN[- ]?)?(?:\d[- ]?){9}[\dX]\b/gi;
const PARENTHETICAL_AUTHOR_YEAR_REGEX = new RegExp(
  `\\((?:${NAME_PART})(?:\\s+et\\s+al\\.|(?:\\s*(?:,|&|and)\\s*${NAME_PART}))*\\s*,?\\s*\\d{4}[a-z]?(?::\\s*\\d+(?:[-–]\\d+)?)?\\)`,
  "g",
);
const NARRATIVE_AUTHOR_YEAR_REGEX = new RegExp(
  `\\b(?:${NAME_PART})(?:\\s+et\\s+al\\.)?\\s*\\(\\d{4}[a-z]?\\)`,
  "g",
);
const FOOTNOTE_REGEX = /\[\d+\]/g;
const MONTH_NAMES = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

export function detectCitations(text: string, baseOffset = 0): DetectedCitation[] {
  const citations: DetectedCitation[] = [];
  const seen = new Set<string>();

  const addIfNew = (c: DetectedCitation) => {
    const key = `${c.from}-${c.to}`;
    const overlaps = citations.some((existing) => {
      return c.from < existing.to && c.to > existing.from;
    });
    if (!seen.has(key) && !overlaps) {
      seen.add(key);
      citations.push(c);
    }
  };

  const bounds = (raw: string, index: number) => {
    let trimmed = raw.trim();
    const start = index + raw.indexOf(trimmed);
    while (/[.,;:]$/.test(trimmed)) trimmed = trimmed.slice(0, -1);
    while (/[)\]}]$/.test(trimmed)) {
      const open = trimmed.endsWith(")") ? "(" : trimmed.endsWith("]") ? "[" : "{";
      const close = trimmed.at(-1);
      const opens = (trimmed.match(new RegExp(`\\${open}`, "g")) ?? []).length;
      const closes = (trimmed.match(new RegExp(`\\${close}`, "g")) ?? []).length;
      if (closes <= opens) break;
      trimmed = trimmed.slice(0, -1);
    }
    return {
      text: trimmed,
      from: baseOffset + start,
      to: baseOffset + start + trimmed.length,
    };
  };

  const authorMetadata = (citationText: string) => {
    const year = citationText.match(/\b\d{4}[a-z]?\b/)?.[0] ?? "";
    const author = citationText
      .replace(/^\(|\)$/g, "")
      .replace(/\(\d{4}[a-z]?\)/g, "")
      .replace(/\b\d{4}[a-z]?\b.*$/, "")
      .replace(/\s+/g, " ")
      .replace(/[\s,(]+$/, "")
      .trim();
    return { author, year };
  };

  let match: RegExpExecArray | null;

  DOI_REGEX.lastIndex = 0;
  while ((match = DOI_REGEX.exec(text)) !== null) {
    const raw = match[1] ?? match[0];
    const index = match.index + match[0].indexOf(raw);
    const hit = bounds(raw, index);
    addIfNew({
      id: `doi-${hit.from}`,
      text: hit.text,
      from: hit.from,
      to: hit.to,
      type: "doi",
      lookupUrl: `https://doi.org/${hit.text}`,
    });
  }

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    const hit = bounds(match[0], match.index);
    addIfNew({
      id: `url-${hit.from}`,
      text: hit.text,
      from: hit.from,
      to: hit.to,
      type: "url",
      lookupUrl: hit.text,
    });
  }

  ISBN_REGEX.lastIndex = 0;
  while ((match = ISBN_REGEX.exec(text)) !== null) {
    const hit = bounds(match[0], match.index);
    addIfNew({
      id: `isbn-${hit.from}`,
      text: hit.text,
      from: hit.from,
      to: hit.to,
      type: "isbn",
      lookupUrl: `https://www.worldcat.org/search?q=isbn:${hit.text.replace(/[- ]/g, "")}`,
    });
  }

  PARENTHETICAL_AUTHOR_YEAR_REGEX.lastIndex = 0;
  while ((match = PARENTHETICAL_AUTHOR_YEAR_REGEX.exec(text)) !== null) {
    const hit = bounds(match[0], match.index);
    const { author, year } = authorMetadata(hit.text);
    if (isMonthName(author)) continue;
    addIfNew({
      id: `ay-${hit.from}`,
      text: hit.text,
      from: hit.from,
      to: hit.to,
      type: "author-year",
      lookupUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(`${author} ${year}`)}`,
      metadata: { author, year },
    });
  }

  NARRATIVE_AUTHOR_YEAR_REGEX.lastIndex = 0;
  while ((match = NARRATIVE_AUTHOR_YEAR_REGEX.exec(text)) !== null) {
    const hit = bounds(match[0], match.index);
    const { author, year } = authorMetadata(hit.text);
    if (isMonthName(author)) continue;
    addIfNew({
      id: `ay-${hit.from}`,
      text: hit.text,
      from: hit.from,
      to: hit.to,
      type: "author-year",
      lookupUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(`${author} ${year}`)}`,
      metadata: { author, year },
    });
  }

  FOOTNOTE_REGEX.lastIndex = 0;
  while ((match = FOOTNOTE_REGEX.exec(text)) !== null) {
    const previous = text[match.index - 1] ?? "";
    if (/[A-Za-z0-9_]/.test(previous)) continue;
    const hit = bounds(match[0], match.index);
    addIfNew({
      id: `fn-${hit.from}`,
      text: hit.text,
      from: hit.from,
      to: hit.to,
      type: "footnote",
    });
  }

  return citations.sort((a, b) => a.from - b.from);
}

function isMonthName(author: string): boolean {
  return MONTH_NAMES.has(author.trim().toLowerCase());
}
