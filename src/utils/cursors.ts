/**
 * House cursors, or the operating system's own.
 *
 * Twyne draws three cursors of its own (`src/styles/cursors.css`): a hand
 * over things the writer can pick up, a closed hand while one is carried,
 * and a pen-stroke caret where they write. A drawn cursor cannot follow the
 * pointer size or colour someone has set in their operating system, so the
 * choice is theirs: `house` is the default, `system` switches every cursor
 * back. Kept on the device, and stamped on `<html data-cursors>` before first
 * paint the same way the motion level is.
 */

export type CursorPreference = "house" | "system";

export const CURSOR_STORAGE_KEY = "twyne.appearance.cursors";

const PREFERENCES = ["house", "system"] as const;

export const CURSOR_PREFERENCES: readonly {
  id: CursorPreference;
  label: string;
  description: string;
}[] = [
  {
    id: "house",
    label: "Twyne",
    description:
      "A hand over what you can pick up, and a pen-stroke caret where you write.",
  },
  {
    id: "system",
    label: "System",
    description:
      "Your own pointer everywhere, at the size and colour you set for it.",
  },
];

export function normalizeCursorPreference(value: unknown): CursorPreference {
  return typeof value === "string" &&
    (PREFERENCES as readonly string[]).includes(value)
    ? (value as CursorPreference)
    : "house";
}

export function readCursorPreference(): CursorPreference {
  try {
    return normalizeCursorPreference(localStorage.getItem(CURSOR_STORAGE_KEY));
  } catch {
    return "house";
  }
}

export function writeCursorPreference(preference: CursorPreference): void {
  try {
    localStorage.setItem(CURSOR_STORAGE_KEY, preference);
  } catch {
    // Private windows can refuse storage; the choice still applies this visit.
  }
}

/** Stamp the preference onto `<html>`; the stylesheet does the rest. */
export function applyCursors(
  preference: CursorPreference,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute("data-cursors", preference);
}

/**
 * Inline `<head>` script: stamps `data-cursors` before first paint, so the
 * pointer never changes shape under someone who asked for their own.
 */
export const CURSOR_BOOTSTRAP_SCRIPT = `(function(){try{
var pref='house';
try{var raw=localStorage.getItem(${JSON.stringify(CURSOR_STORAGE_KEY)});if(${JSON.stringify(PREFERENCES)}.indexOf(raw)>-1)pref=raw;}catch(e){}
document.documentElement.setAttribute('data-cursors',pref);
}catch(e){}})();`;
