/**
 * The landing page starts the brief in place: it asks what the piece is
 * called, then the interview's first question. What the visitor writes there
 * is carried into the brief through sessionStorage, so it stays in this tab,
 * survives the onboarding steps between the two pages, and is gone once the
 * interview has read it.
 */

const KEY = "twyne.brief.opening";
/** Long enough to sign up or add a key on the way; short enough to go stale. */
const MAX_AGE_MS = 60 * 60 * 1000;
/** The question asks for one sentence; leave room for a long one. */
export const OPENING_MAX_LENGTH = 600;
/** A working title, not a subtitle and a tagline as well. */
export const TITLE_MAX_LENGTH = 120;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What the visitor gave before the interview opened. Either may be absent. */
export interface BriefOpening {
  /** Their answer to the interview's first question. */
  text: string | null;
  /** What the piece is called. */
  title: string | null;
}

interface StoredOpening {
  text: string;
  title?: string;
  at: number;
}

const tidyText = (text: unknown) =>
  typeof text === "string" ? text.trim().slice(0, OPENING_MAX_LENGTH) : "";

/** One line: a title pasted with line breaks is still one title. */
export const tidyTitle = (title: unknown) =>
  typeof title === "string"
    ? title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_LENGTH).trim()
    : "";

export function saveBriefOpening(
  storage: Store,
  opening: { text?: string; title?: string },
  now = Date.now(),
): boolean {
  const text = tidyText(opening.text);
  const title = tidyTitle(opening.title);
  if (!text && !title) {
    storage.removeItem(KEY);
    return false;
  }
  const stored: StoredOpening = { text, ...(title ? { title } : {}), at: now };
  storage.setItem(KEY, JSON.stringify(stored));
  return true;
}

function read(storage: Store, now: number): BriefOpening | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredOpening>;
    if (typeof value.text !== "string" || typeof value.at !== "number") {
      return null;
    }
    if (now - value.at > MAX_AGE_MS || value.at > now) return null;
    const text = tidyText(value.text);
    const title = tidyTitle(value.title);
    return text || title ? { text: text || null, title: title || null } : null;
  } catch {
    return null;
  }
}

/** Whether an opening is waiting, without using it up. */
export function hasBriefOpening(storage: Store, now = Date.now()): boolean {
  return read(storage, now) !== null;
}

/** Returns the waiting opening once, and clears it either way. */
export function takeBriefOpening(
  storage: Store,
  now = Date.now(),
): BriefOpening | null {
  const opening = read(storage, now);
  storage.removeItem(KEY);
  return opening;
}

/** sessionStorage, or nothing where the browser refuses it. */
export function sessionStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
