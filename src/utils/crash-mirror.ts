/** A synchronous, folio-scoped fallback used only when the page is leaving. */
const CRASH_MIRROR_KEY = "twyne:draft-crash-mirror";

interface CrashMirror {
  folioId: string;
  html: string;
  savedAt: number;
}

function readEntry(): CrashMirror | null {
  if (typeof window === "undefined") return null;
  try {
    const entry = JSON.parse(localStorage.getItem(CRASH_MIRROR_KEY) || "null");
    return entry &&
      typeof entry.folioId === "string" &&
      typeof entry.html === "string" &&
      Number.isFinite(entry.savedAt)
      ? entry
      : null;
  } catch {
    return null;
  }
}

export function writeCrashMirror(folioId: string, html: string): void {
  if (typeof window === "undefined" || !folioId) return;
  try {
    const entry: CrashMirror = { folioId, html, savedAt: Date.now() };
    localStorage.setItem(CRASH_MIRROR_KEY, JSON.stringify(entry));
  } catch {
    // Quota/private mode: the normal IndexedDB path remains available.
  }
}

/** Never replace a revision saved after this emergency copy was taken. */
export function readCrashMirror(
  folioId: string,
  stored?: { updatedAt: number } | null,
): string | null {
  const entry = readEntry();
  return folioId &&
    entry?.folioId === folioId &&
    (!stored || entry.savedAt >= stored.updatedAt)
    ? entry.html
    : null;
}

/** A delayed acknowledgement may clear only the draft it actually saved. */
export function clearCrashMirror(folioId?: string, html?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (folioId !== undefined) {
      const entry = readEntry();
      if (
        entry?.folioId !== folioId ||
        (html !== undefined && entry.html !== html)
      )
        return;
    }
    localStorage.removeItem(CRASH_MIRROR_KEY);
  } catch {
    // Storage may be denied.
  }
}
