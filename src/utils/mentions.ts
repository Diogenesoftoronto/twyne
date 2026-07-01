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

/** The partial name being typed after a trailing "@", if any. */
export function activeMentionQuery(value: string): string | null {
  const match = value.match(/@([A-Za-z]*)$/);
  return match ? match[1] : null;
}

/** Replace the trailing partial "@query" with the full "@Name ". */
export function applyMention(value: string, name: string): string {
  return value.replace(/@([A-Za-z]*)$/, `@${name} `);
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
