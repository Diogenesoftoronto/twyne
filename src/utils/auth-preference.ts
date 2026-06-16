/**
 * Tiny per-email preference store for which sign-in method the writer
 * last used. Passkey becomes the default once the user has registered
 * one; OTP remains the default for new accounts and for accounts that
 * haven't set up a passkey yet.
 *
 * Lives in localStorage; SSR-safe (no-ops outside the browser). Keys
 * are namespaced under `twyne.auth.` so we never collide with the rest
 * of the app's persisted state.
 */

export type SignInMethod = "passkey" | "otp";

const STORAGE_KEY = "twyne.auth.preferredMethod";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll(): Record<string, SignInMethod> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, SignInMethod>;
    }
  } catch {
    // Corrupted blob — wipe and start fresh rather than blocking sign-in.
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      /* storage may be locked down (private mode, etc.) — ignore. */
    }
  }
  return {};
}

function writeAll(records: Record<string, SignInMethod>): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* storage full / disabled — preference is a hint, not a requirement. */
  }
}

/** Lowercased so `Foo@…` and `foo@…` resolve to the same entry. */
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Returns the preferred method for this email, or `null` if unknown. */
export function getPreferredMethod(email: string): SignInMethod | null {
  const key = normalize(email);
  if (!key) return null;
  return readAll()[key] ?? null;
}

/** Persist the method the user just used to sign in. */
export function setPreferredMethod(email: string, method: SignInMethod): void {
  const key = normalize(email);
  if (!key) return;
  const records = readAll();
  records[key] = method;
  writeAll(records);
}

/**
 * Forget the preference for an email. Called when a user explicitly
 * removes their passkey, or when a stored value gets out of sync.
 */
export function clearPreferredMethod(email: string): void {
  const key = normalize(email);
  if (!key) return;
  const records = readAll();
  delete records[key];
  writeAll(records);
}
