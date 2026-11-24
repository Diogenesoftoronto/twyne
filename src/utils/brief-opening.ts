/**
 * The landing page asks the interview's first question in place. What the
 * visitor writes there is carried into the brief through sessionStorage, so it
 * stays in this tab, survives the onboarding steps between the two pages, and
 * is gone once the interview has read it.
 */

const KEY = "twyne.brief.opening";
/** Long enough to sign up or add a key on the way; short enough to go stale. */
const MAX_AGE_MS = 60 * 60 * 1000;
/** The question asks for one sentence; leave room for a long one. */
export const OPENING_MAX_LENGTH = 600;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface StoredOpening {
  text: string;
  at: number;
}

export function saveBriefOpening(
  storage: Store,
  text: string,
  now = Date.now(),
): boolean {
  const trimmed = text.trim().slice(0, OPENING_MAX_LENGTH);
  if (!trimmed) {
    storage.removeItem(KEY);
    return false;
  }
  storage.setItem(KEY, JSON.stringify({ text: trimmed, at: now }));
  return true;
}

function read(storage: Store, now: number): string | null {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredOpening>;
    if (typeof value.text !== "string" || typeof value.at !== "number") {
      return null;
    }
    if (now - value.at > MAX_AGE_MS || value.at > now) return null;
    const text = value.text.trim().slice(0, OPENING_MAX_LENGTH);
    return text || null;
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
): string | null {
  const text = read(storage, now);
  storage.removeItem(KEY);
  return text;
}

/** sessionStorage, or nothing where the browser refuses it. */
export function sessionStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
