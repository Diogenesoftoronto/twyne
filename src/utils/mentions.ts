/**
 * Generic @-mention support for marginalia comments. Personas are the only
 * mentionable kind today; human collaborators are a planned addition — they
 * slot in by appending another `Mentionable[]` to the candidate list (see
 * `CommentsPanel`'s `collaborators` prop), no changes needed here.
 */

export type MentionKind = "persona" | "collaborator";

export interface Mentionable {
  id: string;
  name: string;
  kind: MentionKind;
  icon?: string;
  color?: string;
}

/**
 * The `@partial` immediately before the caret.
 *
 * Group 1 is the boundary before the `@` — start-of-text or a character that
 * can't be part of a word — so `foo@example.com` never opens the picker.
 * Group 2 is the partial name itself. Spaces deliberately terminate the
 * query: collaborator names like "Ally Reyes" are still reachable by typing
 * `@Ally`, and letting a space continue the query would mean the dropdown
 * never closes once you move on to the rest of the sentence.
 */
const MENTION_PATTERN = /(^|[^\w@])@([A-Za-z0-9_'-]*)$/;

function clampCaret(value: string, caret: number): number {
  if (!Number.isFinite(caret)) return value.length;
  return Math.max(0, Math.min(value.length, Math.trunc(caret)));
}

/**
 * The partial name being typed after an `@`, if the caret sits inside one.
 *
 * `caret` defaults to end-of-text so existing end-anchored callers behave as
 * before, but passing the textarea's `selectionStart` is what makes mentions
 * work mid-sentence instead of only at the very end of the note.
 */
export function activeMentionQuery(
  value: string,
  caret: number = value.length,
): string | null {
  const match = value.slice(0, clampCaret(value, caret)).match(MENTION_PATTERN);
  return match ? match[2] : null;
}

export interface AppliedMention {
  text: string;
  /** Where the caret belongs afterwards — just past the inserted name. */
  caret: number;
}

/**
 * Replace the `@partial` at the caret with the full `@Name `, leaving whatever
 * follows the caret untouched. Returns the new caret so the caller can restore
 * it; a textarea would otherwise jump to the end of the note.
 */
export function applyMention(
  value: string,
  name: string,
  caret: number = value.length,
): AppliedMention {
  const at = clampCaret(value, caret);
  const match = value.slice(0, at).match(MENTION_PATTERN);
  if (!match) return { text: value, caret: at };

  // The match is `boundary? + "@" + partial`, so the `@` sits exactly one
  // character before the partial — the boundary itself must survive.
  const start = at - match[2].length - 1;
  const inserted = `@${name} `;
  return {
    text: value.slice(0, start) + inserted + value.slice(at),
    caret: start + inserted.length,
  };
}

export function filterMentionables(
  items: Mentionable[],
  query: string,
): Mentionable[] {
  const q = query.toLowerCase();
  return items.filter((item) => item.name.toLowerCase().startsWith(q));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mentionables @-named (whole word) anywhere in the text. */
export function mentionedIn(
  text: string,
  items: Mentionable[],
): Mentionable[] {
  return items.filter((item) =>
    new RegExp(`@${escapeRegExp(item.name)}\\b`, "i").test(text),
  );
}
