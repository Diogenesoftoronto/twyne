import type { DetectedCitation } from "../types";

const DOI_REGEX = /\b10\.\d{4,9}\/[^\s,;]+\b/g;
const URL_REGEX = /https?:\/\/[^\s<>"]+/g;
const ISBN_REGEX = /\b(?:ISBN[- ]?)?(?:\d[- ]?){9}[\dX]\b/gi;
const AUTHOR_YEAR_REGEX = /\([A-Z][a-z]+(?:\s(?:et\s+al\.|&\s+[A-Z][a-z]+))?,\s*\d{4}[a-z]?\)/g;
const FOOTNOTE_REGEX = /\[\d+\]/g;

export function detectCitations(text: string, baseOffset = 0): DetectedCitation[] {
  const citations: DetectedCitation[] = [];
  const seen = new Set<string>();

  const addIfNew = (c: DetectedCitation) => {
    const key = `${c.from}-${c.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push(c);
    }
  };

  let match: RegExpExecArray | null;

  DOI_REGEX.lastIndex = 0;
  while ((match = DOI_REGEX.exec(text)) !== null) {
    addIfNew({
      id: `doi-${match.index}`,
      text: match[0],
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      type: "doi",
      lookupUrl: `https://doi.org/${match[0]}`,
    });
  }

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    addIfNew({
      id: `url-${match.index}`,
      text: match[0],
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      type: "url",
      lookupUrl: match[0],
    });
  }

  ISBN_REGEX.lastIndex = 0;
  while ((match = ISBN_REGEX.exec(text)) !== null) {
    addIfNew({
      id: `isbn-${match.index}`,
      text: match[0],
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      type: "isbn",
      lookupUrl: `https://www.worldcat.org/search?q=isbn:${match[0].replace(/[- ]/g, "")}`,
    });
  }

  AUTHOR_YEAR_REGEX.lastIndex = 0;
  while ((match = AUTHOR_YEAR_REGEX.exec(text)) !== null) {
    const authorPart = match[0].replace(/[(),\d]/g, "").trim();
    const yearPart = match[0].match(/\d{4}/)?.[0] || "";
    addIfNew({
      id: `ay-${match.index}`,
      text: match[0],
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      type: "author-year",
      lookupUrl: `https://scholar.google.com/scholar?q=${encodeURIComponent(`${authorPart} ${yearPart}`)}`,
      metadata: { author: authorPart, year: yearPart },
    });
  }

  FOOTNOTE_REGEX.lastIndex = 0;
  while ((match = FOOTNOTE_REGEX.exec(text)) !== null) {
    addIfNew({
      id: `fn-${match.index}`,
      text: match[0],
      from: baseOffset + match.index,
      to: baseOffset + match.index + match[0].length,
      type: "footnote",
    });
  }

  return citations;
}
