/**
 * What the writer decided about an editor's note.
 *
 * A note is an editorial reading, and the writer may have meant the thing it
 * points at ("intentional") or may want to deal with it after the draft is
 * done ("later"). Either way the same editor should not raise the same
 * passage again while it reads as it did when the writer decided. Once the
 * passage is rewritten the decision lapses, because the editor would be
 * reading different words.
 */
import { loadMetaFromIdb, saveMetaToIdb } from "./idb";
import { resolveQuotation } from "./quote-grounding";

export type NoteDecisionKind = "intentional" | "later";

export interface NoteDecision {
  noteId: string;
  personaId: string;
  /** The passage the note was anchored on, as it read when decided. */
  anchor: string;
  kind: NoteDecisionKind;
  /** The note's first words, so the editors know what was settled. */
  summary: string;
  at: number;
}

const key = (folioId: string) => `note-decisions:${folioId}`;

export async function loadNoteDecisions(
  folioId: string | null | undefined,
): Promise<NoteDecision[]> {
  if (!folioId) return [];
  return (await loadMetaFromIdb<NoteDecision[]>(key(folioId))) ?? [];
}

export async function saveNoteDecision(
  folioId: string,
  decision: NoteDecision,
): Promise<NoteDecision[]> {
  const all = (await loadNoteDecisions(folioId)).filter(
    (d) => d.noteId !== decision.noteId,
  );
  const next = [...all, decision];
  await saveMetaToIdb(key(folioId), next);
  return next;
}

export async function clearNoteDecision(
  folioId: string,
  noteId: string,
): Promise<NoteDecision[]> {
  const next = (await loadNoteDecisions(folioId)).filter(
    (d) => d.noteId !== noteId,
  );
  await saveMetaToIdb(key(folioId), next);
  return next;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Decisions whose passage still reads as it did when the writer decided. */
export function standingDecisions(
  decisions: readonly NoteDecision[],
  draft: string,
): NoteDecision[] {
  return decisions.filter(
    (d) =>
      d.anchor.trim() &&
      resolveQuotation(d.anchor, draft).status !== "unmatched",
  );
}

/** The standing decision that covers a new note, if any. */
export function settledBy(
  note: { personaId: string; anchor?: string },
  decisions: readonly NoteDecision[],
  draft: string,
): NoteDecision | null {
  if (!note.anchor?.trim()) return null;
  const anchor = squash(note.anchor);
  return (
    standingDecisions(decisions, draft).find((d) => {
      if (d.personaId !== note.personaId) return false;
      const decided = squash(d.anchor);
      return decided.includes(anchor) || anchor.includes(decided);
    }) ?? null
  );
}

/** Drop notes the writer has already settled on unchanged passages. */
export function withoutSettled<
  T extends { personaId: string; anchor?: string },
>(notes: readonly T[], decisions: readonly NoteDecision[], draft: string): T[] {
  return notes.filter((n) => !settledBy(n, decisions, draft));
}

/** A line for the editors' context, so they do not raise these again. */
export function decisionsDigest(
  decisions: readonly NoteDecision[],
  draft: string,
): string {
  const standing = standingDecisions(decisions, draft).slice(-12);
  if (!standing.length) return "";
  const lines = standing.map(
    (d) =>
      `- "${d.anchor.slice(0, 160)}" — ${
        d.kind === "intentional"
          ? "the writer means this as written"
          : "the writer will return to this later"
      } (note: ${d.summary.slice(0, 100)})`,
  );
  return `The writer has already decided about these passages. Do not raise the same point about them again unless their text changes:\n${lines.join("\n")}`;
}
