/**
 * The trajectory — a running record of how the draft got where it is.
 *
 * The editors read a snapshot. That is why convening feels like starting the
 * conversation over: the room has no idea whether the writer just added three
 * paragraphs of argument, cut the opening anecdote, or spent an hour moving a
 * comma. This module keeps a cheap, local, append-only log of what changed
 * between passes, and renders it into a short prose digest that goes into the
 * prompt.
 *
 * It is deliberately paragraph-level rather than character-level. Editors care
 * that a paragraph appeared, not that a word changed inside one; and paragraph
 * granularity keeps the log small enough to live in IndexedDB alongside
 * everything else without any pruning ceremony beyond a hard cap.
 */

import { loadMetaFromIdb, saveMetaToIdb } from "./idb";

/** How many entries we keep per folio before dropping the oldest. */
const MAX_ENTRIES = 60;

/** How many entries a digest may draw on. Older ones are summarised as a total. */
const DEFAULT_DIGEST_WINDOW = 12;

/** Excerpt length kept per added paragraph, so the log stays small. */
const EXCERPT_CHARS = 180;

export interface TrajectoryEntry {
  at: number;
  /** Net words added (negative when the writer cut more than they wrote). */
  netWords: number;
  addedCount: number;
  removedCount: number;
  /** Opening of each added paragraph, truncated. Empty on a pure deletion. */
  excerpts: string[];
}

export interface ParagraphDiff {
  added: string[];
  removed: string[];
  netWords: number;
}

/**
 * Flatten editor HTML into plain text with paragraph breaks preserved.
 *
 * The existing `twyne:content` consumers strip all tags to a single line,
 * which is right for a search query and useless here — the whole point of the
 * trajectory is knowing which *paragraph* appeared. So block-level closers
 * become blank lines before the tags come out.
 */
export function paragraphTextFromHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|li|h[1-6]|blockquote|pre|tr|section|article)\s*>/gi,
      "\n\n",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split prose into non-empty paragraphs. */
export function toParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Multiset difference between two paragraph lists.
 *
 * Multiset, not set: a draft can legitimately contain the same paragraph twice
 * (a repeated refrain, a duplicated stub the writer is about to fix), and a
 * set-based diff would silently swallow the second copy. Matching by count
 * also makes a pure reorder come out as no change at all, which is correct —
 * moving a paragraph is not new material for the room to read.
 */
export function diffParagraphs(prev: string, next: string): ParagraphDiff {
  const before = toParagraphs(prev);
  const after = toParagraphs(next);

  const beforeCounts = new Map<string, number>();
  for (const p of before) beforeCounts.set(p, (beforeCounts.get(p) ?? 0) + 1);

  const added: string[] = [];
  for (const p of after) {
    const remaining = beforeCounts.get(p) ?? 0;
    if (remaining > 0) beforeCounts.set(p, remaining - 1);
    else added.push(p);
  }

  const afterCounts = new Map<string, number>();
  for (const p of after) afterCounts.set(p, (afterCounts.get(p) ?? 0) + 1);

  const removed: string[] = [];
  for (const p of before) {
    const remaining = afterCounts.get(p) ?? 0;
    if (remaining > 0) afterCounts.set(p, remaining - 1);
    else removed.push(p);
  }

  return {
    added,
    removed,
    netWords: countWords(after.join(" ")) - countWords(before.join(" ")),
  };
}

function excerpt(paragraph: string): string {
  if (paragraph.length <= EXCERPT_CHARS) return paragraph;
  return `${paragraph.slice(0, EXCERPT_CHARS).trimEnd()}…`;
}

/** Build a log entry from a diff, or null when nothing meaningful changed. */
export function entryFromDiff(
  diff: ParagraphDiff,
  at: number = Date.now(),
): TrajectoryEntry | null {
  if (diff.added.length === 0 && diff.removed.length === 0) return null;
  return {
    at,
    netWords: diff.netWords,
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    excerpts: diff.added.map(excerpt),
  };
}

/* ── Persistence (per folio, in the existing meta store) ─────────── */

function key(folioId: string): string {
  return `draft-trajectory:${folioId}`;
}

export async function loadTrajectory(
  folioId: string,
): Promise<TrajectoryEntry[]> {
  const stored = await loadMetaFromIdb<TrajectoryEntry[]>(key(folioId));
  return Array.isArray(stored) ? stored : [];
}

export async function appendTrajectory(
  folioId: string,
  entry: TrajectoryEntry,
): Promise<TrajectoryEntry[]> {
  const existing = await loadTrajectory(folioId);
  const next = [...existing, entry].slice(-MAX_ENTRIES);
  await saveMetaToIdb(key(folioId), next);
  return next;
}

export async function clearTrajectory(folioId: string): Promise<void> {
  await saveMetaToIdb(key(folioId), []);
}

/* ── Digest ─────────────────────────────────────────────────────── */

function relativeTime(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Render the log into the short prose block that goes into the prompt.
 *
 * Written for a reader, not a parser: the editors are being told what the
 * writer has been doing, in the register they think in. Returns an empty
 * string when there is nothing worth saying, so callers can concatenate it
 * unconditionally without producing a dangling header.
 */
export function trajectoryDigest(
  entries: TrajectoryEntry[],
  now: number = Date.now(),
  window: number = DEFAULT_DIGEST_WINDOW,
): string {
  if (entries.length === 0) return "";

  const recent = entries.slice(-window);
  const older = entries.slice(0, Math.max(0, entries.length - window));

  const netWords = recent.reduce((sum, e) => sum + e.netWords, 0);
  const added = recent.reduce((sum, e) => sum + e.addedCount, 0);
  const removed = recent.reduce((sum, e) => sum + e.removedCount, 0);
  const span = now - recent[0].at;

  const lines: string[] = [];

  const movement: string[] = [];
  if (netWords !== 0) {
    movement.push(
      `${netWords > 0 ? "+" : "−"}${Math.abs(netWords)} words net`,
    );
  }
  if (added > 0) {
    movement.push(`${added} paragraph${added === 1 ? "" : "s"} added`);
  }
  if (removed > 0) {
    movement.push(`${removed} cut`);
  }
  lines.push(
    `Over the last ${relativeTime(span).replace(" ago", "")}: ${
      movement.join(", ") || "revision within existing paragraphs"
    }.`,
  );

  if (older.length > 0) {
    const olderNet = older.reduce((sum, e) => sum + e.netWords, 0);
    lines.push(
      `Before that, ${older.length} earlier revision${
        older.length === 1 ? "" : "s"
      } totalling ${olderNet > 0 ? "+" : "−"}${Math.abs(olderNet)} words.`,
    );
  }

  const newest = recent
    .flatMap((e) => e.excerpts)
    .slice(-4)
    .map((e) => `  — "${e}"`);
  if (newest.length > 0) {
    lines.push("", "Most recent new material, in order:", ...newest);
  }

  return lines.join("\n");
}

/**
 * A one-line version for the UI ("the room read your last three paragraphs").
 * Returns an empty string when there is nothing to report.
 */
export function trajectorySummaryLine(entries: TrajectoryEntry[]): string {
  if (entries.length === 0) return "";
  const last = entries[entries.length - 1];
  const parts: string[] = [];
  if (last.addedCount > 0) {
    parts.push(
      `${last.addedCount} new paragraph${last.addedCount === 1 ? "" : "s"}`,
    );
  }
  if (last.removedCount > 0) {
    parts.push(`${last.removedCount} cut`);
  }
  if (parts.length === 0) return `Revised ${relativeTime(Date.now() - last.at)}`;
  return `${parts.join(", ")} · ${relativeTime(Date.now() - last.at)}`;
}
