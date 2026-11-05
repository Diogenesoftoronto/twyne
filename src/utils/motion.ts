/**
 * Motion levels for the living press.
 *
 * Every animated surface reads one of three levels from `<html data-motion>`:
 *
 *   full   feedback, arrivals, ceremonies and ambient life (the desk lamp)
 *   calm   feedback and arrivals only; ceremonies are shortened, nothing ambient
 *   still  no movement at all; state is carried by colour and copy alone
 *
 * The writer chooses a preference (`system` follows the operating system's
 * reduced-motion setting). The bootstrap script below stamps the resolved level
 * before first paint, the same way `THEME_BOOTSTRAP_SCRIPT` stamps the palette,
 * so CSS never animates a frame the writer asked not to see.
 *
 * The typing signal lives here too. `markTyping()` sets `<html data-typing>` for
 * the length of a burst, touching the DOM once at the start and once at the
 * end, never per keystroke. Ambient surfaces step back while it is present.
 *
 * See docs/design/living-press.md for the budget each level allows.
 */

export type MotionPreference = "system" | "full" | "calm" | "still";
export type MotionLevel = "full" | "calm" | "still";
/** What a piece of motion is for, which decides the levels it may play at. */
export type MotionKind = "feedback" | "ceremony" | "ambient";

export const MOTION_STORAGE_KEY = "twyne.appearance.motion";
/** Dispatched on `window` with `detail: MotionLevel` when the level changes. */
export const MOTION_CHANGE_EVENT = "twyne:motion";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** A burst of typing ends after this much quiet. */
export const TYPING_IDLE_MS = 1200;

const PREFERENCES = ["system", "full", "calm", "still"] as const;

export const MOTION_PREFERENCES: readonly {
  id: MotionPreference;
  label: string;
  description: string;
}[] = [
  {
    id: "system",
    label: "System",
    description:
      "Full motion, or Still when your operating system asks for reduced motion.",
  },
  {
    id: "full",
    label: "Full",
    description:
      "Every response, plus the desk lamp and the stamps' ink. Ambient life rests while you type.",
  },
  {
    id: "calm",
    label: "Calm",
    description:
      "Presses, arrivals and saves still answer. No ambient light, and ceremonies are brief.",
  },
  {
    id: "still",
    label: "Still",
    description:
      "Nothing moves. State changes are shown by colour and wording alone.",
  },
];

export function normalizeMotionPreference(value: unknown): MotionPreference {
  return typeof value === "string" &&
    (PREFERENCES as readonly string[]).includes(value)
    ? (value as MotionPreference)
    : "system";
}

export function readMotionPreference(): MotionPreference {
  try {
    return normalizeMotionPreference(localStorage.getItem(MOTION_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function writeMotionPreference(preference: MotionPreference): void {
  try {
    localStorage.setItem(MOTION_STORAGE_KEY, preference);
  } catch {
    // Private windows can refuse storage; the level still applies this visit.
  }
}

export function resolveMotionLevel(
  preference: MotionPreference,
  prefersReducedMotion: boolean,
): MotionLevel {
  if (preference !== "system") return preference;
  return prefersReducedMotion ? "still" : "full";
}

function systemPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/** Stamp a preference onto `<html>` and announce the resolved level. */
export function applyMotion(
  preference: MotionPreference,
  root: HTMLElement = document.documentElement,
  prefersReducedMotion = systemPrefersReducedMotion(),
): MotionLevel {
  const level = resolveMotionLevel(preference, prefersReducedMotion);
  const changed = root.getAttribute("data-motion") !== level;
  root.setAttribute("data-motion", level);
  root.setAttribute("data-motion-preference", preference);
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<MotionLevel>(MOTION_CHANGE_EVENT, { detail: level }),
    );
  }
  return level;
}

/**
 * The level in force. Off the client, or before the bootstrap has run, the
 * answer is the operating system's (or `full` on the server, where nothing
 * animates anyway).
 */
export function motionLevel(root?: HTMLElement): MotionLevel {
  const element =
    root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!element) return "full";
  const value = element.getAttribute("data-motion");
  if (value === "full" || value === "calm" || value === "still") return value;
  return resolveMotionLevel(readMotionPreference(), systemPrefersReducedMotion());
}

/**
 * Whether a kind of motion may play now.
 *
 *   feedback  answers an action the writer just took: full and calm
 *   ceremony  marks a rare moment (a verdict, a publish): full and calm,
 *             where calm keeps it brief through the duration tokens
 *   ambient   life that nobody asked for: full only, and never mid-burst
 */
export function allowsMotion(kind: MotionKind, root?: HTMLElement): boolean {
  const level = motionLevel(root);
  if (level === "still") return false;
  if (kind === "ambient") return level === "full" && !isTyping(root);
  return true;
}

/** Subscribe to level changes. Returns the unsubscribe function. */
export function onMotionLevelChange(
  listener: (level: MotionLevel) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handle = (event: Event) =>
    listener((event as CustomEvent<MotionLevel>).detail);
  window.addEventListener(MOTION_CHANGE_EVENT, handle);
  return () => window.removeEventListener(MOTION_CHANGE_EVENT, handle);
}

let typingTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Note a keystroke. Sets `<html data-typing>` at the start of a burst and
 * clears it after `TYPING_IDLE_MS` of quiet. Cheap enough to call on every
 * key: between the edges it only resets a timer.
 */
export function markTyping(root?: HTMLElement): void {
  const element =
    root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!element) return;
  if (!element.hasAttribute("data-typing")) {
    element.setAttribute("data-typing", "");
  }
  if (typingTimer !== undefined) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingTimer = undefined;
    element.removeAttribute("data-typing");
  }, TYPING_IDLE_MS);
}

export function isTyping(root?: HTMLElement): boolean {
  const element =
    root ?? (typeof document === "undefined" ? null : document.documentElement);
  return element?.hasAttribute("data-typing") ?? false;
}

/**
 * Inline `<head>` script: resolves the stored preference against the
 * operating system and stamps `data-motion` before first paint. Kept beside
 * `applyMotion` so the two cannot drift.
 */
export const MOTION_BOOTSTRAP_SCRIPT = `(function(){try{
var KEY=${JSON.stringify(MOTION_STORAGE_KEY)};
var PREFS=${JSON.stringify(PREFERENCES)};
var pref='system';
try{var raw=localStorage.getItem(KEY);if(PREFS.indexOf(raw)>-1)pref=raw;}catch(e){}
var reduce=window.matchMedia&&window.matchMedia(${JSON.stringify(REDUCED_MOTION_QUERY)}).matches;
var level=pref==='system'?(reduce?'still':'full'):pref;
var root=document.documentElement;
root.setAttribute('data-motion',level);
root.setAttribute('data-motion-preference',pref);
}catch(e){}})();`;
