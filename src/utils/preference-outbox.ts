import {
  portablePreference,
  type PreferenceKind,
  type PreferenceValue,
} from "./account-preferences-contract";
export const PREFERENCES_CHANGED = "twyne:preferences-changed";
export const PREFERENCES_APPLIED = "twyne:preferences-applied";
export const PREFERENCES_STORAGE_FAILED = "twyne:preferences-storage-failed";
const OWNER = "twyne:preferences-owner";
const KEY = "twyne:preferences-outbox:";
const fallback = new Map<string, string>();
const failedKeys = new Set<string>();
export interface PreferenceJournal {
  base: Partial<Record<PreferenceKind, PreferenceValue>>;
  pending: Partial<Record<PreferenceKind, PreferenceValue>>;
}
function announce(name: string) {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  )
    window.dispatchEvent(new CustomEvent(name));
}
function get(key: string) {
  if (failedKeys.has(key)) return fallback.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return fallback.get(key) ?? null;
  }
}
function set(key: string, value: string) {
  fallback.set(key, value);
  try {
    localStorage.setItem(key, value);
    failedKeys.delete(key);
  } catch {
    failedKeys.add(key);
    announce(PREFERENCES_STORAGE_FAILED);
  }
}
export function readJournal(account: string): PreferenceJournal {
  try {
    const raw = get(KEY + account);
    return raw ? JSON.parse(raw) : { base: {}, pending: {} };
  } catch {
    announce(PREFERENCES_STORAGE_FAILED);
    return { base: {}, pending: {} };
  }
}
export function writeJournal(account: string, journal: PreferenceJournal) {
  set(KEY + account, JSON.stringify(journal));
}
export function preferenceOwner() {
  return get(OWNER);
}
export function setPreferenceOwner(account: string) {
  set(OWNER, account);
}
export function recordPreferenceChange(kind: PreferenceKind, value: unknown) {
  if (typeof window === "undefined") return;
  const owner = preferenceOwner() ?? "anonymous";
  const journal = readJournal(owner);
  journal.pending[kind] = portablePreference(kind, value);
  writeJournal(owner, journal);
  announce(PREFERENCES_CHANGED);
}
