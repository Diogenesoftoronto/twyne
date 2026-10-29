/**
 * Ground the quotations inside an editor's note in the manuscript.
 *
 * A cast reply often quotes several passages. Each quotation should lead to
 * the passage it came from, not to whichever sentence the note happened to be
 * anchored on. Literal quotations already exist in the draft, so matching is
 * deterministic: normalise typography and whitespace, look for the text, and
 * use the words around the quotation to choose between repeated phrases. When
 * that still leaves a tie, or the words are not in the draft as written, the
 * quotation stays unresolved rather than being pinned to a guess.
 */
import { renderMarkdown } from "./markdown";

export interface Quotation {
  /** The quoted words, without their quotation marks. */
  quote: string;
  /** Where the quotation starts in the note. */
  index: number;
  /** Note text around the quotation, used to tell repeated phrases apart. */
  context: string;
}

export type QuoteResolution =
  | { status: "resolved"; from: number; to: number }
  | { status: "ambiguous"; count: number }
  | { status: "unmatched" };

const PAIRS: Array<[string, string]> = [
  ["“", "”"],
  ["«", "»"],
  ['"', '"'],
  ["‘", "’"],
];
const MIN_WORDS = 2;
const MIN_CHARS = 8;
const CONTEXT_CHARS = 90;
const MANUSCRIPT_WINDOW = 260;
const ELISION_SPAN = 600;

/** Text with typography folded away, and where each character came from. */
interface Normalised {
  text: string;
  map: number[];
}

function fold(ch: string): string {
  switch (ch) {
    case "“":
    case "”":
    case "„":
    case "«":
    case "»":
      return '"';
    case "‘":
    case "’":
    case "‚":
      return "'";
    case "–":
    case "—":
    case "−":
      return "-";
    case " ":
    case " ":
    case " ":
      return " ";
    default: {
      const lower = ch.toLowerCase();
      return lower.length === 1 ? lower : ch;
    }
  }
}

/**
 * Fold case, quote marks, dashes and ellipses, and collapse whitespace. A
 * blank line (a block boundary) survives as "\n" so a quotation never matches
 * across paragraphs.
 */
function normalise(source: string): Normalised {
  let text = "";
  const map: number[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      const start = i;
      let breaks = 0;
      while (i < source.length && /\s/.test(source[i])) {
        if (source[i] === "\n") breaks++;
        i++;
      }
      if (text.length === 0) continue;
      text += breaks >= 2 ? "\n" : " ";
      map.push(start);
      continue;
    }
    if (ch === "." && source.startsWith("...", i)) {
      text += "…";
      map.push(i);
      i += 3;
      continue;
    }
    text += fold(ch);
    map.push(i);
    i++;
  }
  return { text: text.replace(/[ \n]$/, ""), map };
}

const STOPWORDS = new Set(
  "the and but for not you your with this that then than when what which who was were are has have had its it's she her his him they them their there here from into onto over just more most very also only some such like about would could should will can does did out".split(
    " ",
  ),
);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w),
  );
}

/** Strip punctuation a writer adds or drops when quoting a fragment. */
function trimQuote(quote: string): string {
  return quote
    .trim()
    .replace(/^[\s.,;:!?…-]+/, "")
    .replace(/[\s.,;:!?-]+$/, "")
    .trim();
}

/** Quoted runs in a note: paired quotation marks and Markdown block quotes. */
export function extractQuotations(note: string): Quotation[] {
  const found: Quotation[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) =>
    taken.some(([s, e]) => a < e && b > s);
  const push = (raw: string, index: number) => {
    const quote = trimQuote(raw);
    if (quote.length < MIN_CHARS) return;
    if (quote.split(/\s+/).length < MIN_WORDS) return;
    if (found.some((q) => q.quote === quote)) return;
    const end = index + raw.length;
    const context =
      note.slice(Math.max(0, index - CONTEXT_CHARS), index) +
      " " +
      note.slice(end, end + CONTEXT_CHARS);
    found.push({ quote, index, context });
    taken.push([index, end]);
  };

  for (const line of note.matchAll(/^[ \t]*>[ \t]?(.+)$/gm)) {
    const body = line[1];
    push(body, (line.index ?? 0) + line[0].indexOf(body));
  }

  for (const [open, close] of PAIRS) {
    let at = 0;
    while (at < note.length) {
      const start = note.indexOf(open, at);
      if (start < 0) break;
      // A straight or curly apostrophe inside a word is not an opening mark.
      if (open === "‘" && /\p{L}/u.test(note[start - 1] ?? "")) {
        at = start + 1;
        continue;
      }
      let end = note.indexOf(close, start + 1);
      // Skip apostrophes ("don’t") when looking for the closing single mark.
      while (open === "‘" && end > 0 && /\p{L}/u.test(note[end + 1] ?? "")) {
        end = note.indexOf(close, end + 1);
      }
      if (end < 0) break;
      const raw = note.slice(start + 1, end);
      if (!raw.includes("\n\n") && !overlaps(start, end + 1)) {
        push(raw, start + 1);
      }
      at = end + 1;
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    out.push(at);
    at = haystack.indexOf(needle, at + 1);
  }
  return out;
}

/** Normalised spans where every elided segment appears, in order, in one block. */
function elidedSpans(doc: string, segments: string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const start of occurrences(doc, segments[0])) {
    let cursor = start + segments[0].length;
    let ok = true;
    for (const segment of segments.slice(1)) {
      const next = doc.indexOf(segment, cursor);
      if (
        next < 0 ||
        next - start > ELISION_SPAN ||
        doc.slice(cursor, next).includes("\n")
      ) {
        ok = false;
        break;
      }
      cursor = next + segment.length;
    }
    if (ok) spans.push([start, cursor]);
  }
  return spans;
}

function matchingSpans(
  needle: string,
  doc: Normalised,
): Array<[number, number]> {
  let spans: Array<[number, number]> = occurrences(doc.text, needle)
    .map((at): [number, number] => [at, at + needle.length])
    .filter(([s, e]) => !doc.text.slice(s, e).includes("\n"));
  if (spans.length === 0) {
    const segments = needle
      .split(/\s*(?:…|\[…\]|\[\.\.\.\])\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3);
    if (segments.length > 1) spans = elidedSpans(doc.text, segments);
  }
  return spans;
}

/** Enumerate all occurrences with exactly the same normalisation as the resolver. */
export function quotationCandidates(
  quote: string,
  manuscript: string,
): Array<{ from: number; to: number }> {
  const needle = normalise(trimQuote(quote)).text;
  if (!needle || !manuscript) return [];
  const doc = normalise(manuscript);
  return matchingSpans(needle, doc).map(([s, e]) => {
    const last = doc.map[e - 1];
    const width = doc.text[e - 1] === "…" && manuscript[last] === "." ? 3 : 1;
    return { from: doc.map[s], to: last + width };
  });
}

/**
 * Find a quotation in the manuscript. Offsets are into `manuscript` as given.
 * `context` is the note text around the quotation; it only ever breaks ties.
 */
export function resolveQuotation(
  quote: string,
  manuscript: string,
  context = "",
): QuoteResolution {
  const needle = normalise(trimQuote(quote)).text;
  if (!needle || !manuscript) return { status: "unmatched" };
  const doc = normalise(manuscript);

  const spans = matchingSpans(needle, doc);
  if (spans.length === 0) return { status: "unmatched" };

  const toOriginal = ([s, e]: [number, number]) => {
    const last = doc.map[e - 1];
    // An ellipsis folded from "..." spans three source characters.
    const width = doc.text[e - 1] === "…" && manuscript[last] === "." ? 3 : 1;
    return { from: doc.map[s], to: last + width };
  };
  if (spans.length === 1)
    return { status: "resolved", ...toOriginal(spans[0]) };

  const cues = new Set(words(context));
  const quoted = new Set(words(needle));
  for (const w of quoted) cues.delete(w);
  if (cues.size === 0) return { status: "ambiguous", count: spans.length };
  const scored = spans
    .map((span) => {
      // Only the occurrence's own paragraph counts as its surroundings.
      const before = doc.text.slice(
        Math.max(0, span[0] - MANUSCRIPT_WINDOW),
        span[0],
      );
      const after = doc.text.slice(span[1], span[1] + MANUSCRIPT_WINDOW);
      const window =
        before.slice(before.lastIndexOf("\n") + 1) + " " + after.split("\n")[0];
      const near = new Set(words(window));
      let score = 0;
      for (const w of cues) if (near.has(w)) score++;
      return { span, score };
    })
    .sort((a, b) => b.score - a.score);
  const [best, runnerUp] = scored;
  if (best.score > runnerUp.score) {
    return { status: "resolved", ...toOriginal(best.span) };
  }
  return { status: "ambiguous", count: spans.length };
}

export interface GroundedQuotation extends Quotation {
  resolution: QuoteResolution;
}

export function groundQuotations(
  note: string,
  manuscript: string,
): GroundedQuotation[] {
  return extractQuotations(note).map((q) => ({
    ...q,
    resolution: resolveQuotation(q.quote, manuscript, q.context),
  }));
}

/** A note rendered as Markdown, each quotation linked to its own passage. */
export function renderGroundedMarkdown(
  text: string,
  manuscript: string,
): string {
  const html = renderMarkdown(text);
  if (!manuscript) return html;
  return linkQuotations(html, groundQuotations(text, manuscript), manuscript);
}

/** The live draft text, asked of the editor synchronously ("" on the server). */
export function currentManuscript(): string {
  if (typeof window === "undefined") return "";
  let text = "";
  const receive = (e: Event) => {
    text = ((e as CustomEvent).detail as string) ?? "";
  };
  window.addEventListener("twyne:draft-text", receive);
  window.dispatchEvent(new CustomEvent("twyne:request-draft"));
  window.removeEventListener("twyne:draft-text", receive);
  return text;
}

/** Window event a quote link sends; the editor resolves it again live. */
export const REVEAL_QUOTE_EVENT = "twyne:reveal-quote";

export interface RevealQuoteDetail {
  quote: string;
  context: string;
  from?: number;
  to?: number;
  draftFingerprint?: string;
}

/** A choice can select one repeat only while its manuscript snapshot is current. */
export function resolveQuotationForReveal(
  quote: string,
  manuscript: string,
  context: string,
  hint?: RevealQuoteDetail,
): QuoteResolution {
  if (
    hint?.draftFingerprint === quotationDraftFingerprint(manuscript) &&
    Number.isSafeInteger(hint.from) &&
    Number.isSafeInteger(hint.to) &&
    hint.from! >= 0 &&
    hint.to! > hint.from! &&
    hint.to! <= manuscript.length &&
    manuscript.slice(hint.from, hint.to) === quote
  )
    return { status: "resolved", from: hint.from!, to: hint.to! };
  return resolveQuotation(quote, manuscript, context);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replace the first occurrence of `needle` that sits in text, not in a tag. */
function wrapInText(
  html: string,
  needle: string,
  wrap: (inner: string) => string,
): string {
  let at = html.indexOf(needle);
  while (at >= 0) {
    const lastOpen = html.lastIndexOf("<", at);
    const lastClose = html.lastIndexOf(">", at);
    if (lastOpen <= lastClose) {
      return html.slice(0, at) + wrap(needle) + html.slice(at + needle.length);
    }
    at = html.indexOf(needle, at + 1);
  }
  return html;
}

/**
 * Mark each quotation in rendered note HTML: resolved ones become links to
 * their passage, the rest say why they are not.
 */
export function linkQuotations(
  html: string,
  grounded: Array<
    Omit<GroundedQuotation, "resolution"> & {
      resolution:
        | QuoteResolution
        | {
            status: "near";
            passage: string;
            from: number;
            to: number;
            pNull: number;
          };
    }
  >,
  manuscript = "",
): string {
  let out = html;
  const fingerprint = quotationDraftFingerprint(manuscript);
  for (const q of grounded) {
    const needle = escapeHtml(q.quote);
    const r = q.resolution;
    if (r.status === "resolved") {
      out = wrapInText(
        out,
        needle,
        (inner) =>
          `<span class="quote-link" role="link" tabindex="0" data-quote="${escapeHtml(manuscript ? manuscript.slice(r.from, r.to) : q.quote)}" data-draft-fingerprint="${fingerprint}" data-quote-from="${r.from}" data-quote-to="${r.to}" data-quote-context="${escapeHtml(q.context)}" title="Show this passage in the manuscript">${inner}</span>`,
      );
    } else {
      const why =
        r.status === "near"
          ? `Possible related passage, not an exact quotation: ${r.passage}`
          : r.status === "ambiguous"
            ? `These words appear ${r.count} times in the draft, and the note does not say which.`
            : "Not in the draft as written. The passage may have changed since this note.";
      out = wrapInText(
        out,
        needle,
        (inner) =>
          `<span class="quote-unresolved" title="${escapeHtml(why)}">${inner}</span>`,
      );
    }
  }
  return out;
}

/** Click (or Enter) on a quote link inside `event.target`'s note. */
export function revealQuoteFromEvent(event: Event): boolean {
  if (event instanceof KeyboardEvent && event.key !== "Enter") return false;
  const el = (event.target as Element | null)?.closest?.<HTMLElement>(
    ".quote-link[data-quote]",
  );
  if (!el) return false;
  event.preventDefault();
  event.stopPropagation();
  window.dispatchEvent(
    new CustomEvent<RevealQuoteDetail>(REVEAL_QUOTE_EVENT, {
      detail: {
        quote: el.dataset.quote ?? "",
        context: el.dataset.quoteContext ?? "",
        from: Number(el.dataset.quoteFrom),
        to: Number(el.dataset.quoteTo),
        draftFingerprint: el.dataset.draftFingerprint,
      },
    }),
  );
  return true;
}

/** A synchronous freshness guard for reveal events; inference caching uses SHA-256. */
export function quotationDraftFingerprint(text: string): string {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
