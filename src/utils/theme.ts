/**
 * Appearance preferences — which palette the room is printed in.
 *
 * Two halves, deliberately separated:
 *
 *   1. **Presets** live in `global.css` as `[data-theme="…"]` blocks. Switching
 *      preset is a single attribute flip; no inline styles, no reflow of 1800
 *      `var(--color-*)` call sites.
 *   2. **Custom overrides** are inline custom properties on `<html>`, layered
 *      on top of whichever preset is active. Only the eight core tokens are
 *      exposed: they carry ~90% of the UI, and letting people redefine the
 *      derived ones is how a palette ends up unreadable.
 *
 * Storage is localStorage, read synchronously so `THEME_BOOTSTRAP_SCRIPT` can
 * stamp the document before first paint. `roomSettings` in Convex carries the
 * same value for cross-device sync, but it is loaded far too late to prevent
 * a flash — local is the source of truth for rendering.
 *
 * Note this themes *chrome only*. Colors the writer applied to their text are
 * literal hex baked into the document (see `palette.ts`), because they have to
 * survive export. Those must never shift with the app theme.
 */

import { contrastRatio, normalizeHex } from "./palette";

export const THEME_STORAGE_KEY = "twyne.appearance.theme";

/**
 * When this device last changed the theme. Compared against the account
 * record's `updatedAt` so signing in on a second machine does not overwrite a
 * palette you just picked here — newer wins, in either direction.
 */
export const THEME_SYNC_STAMP_KEY = "twyne.appearance.syncedAt";

export type ThemePresetId =
  | "system"
  | "editorial"
  | "foolscap"
  | "broadsheet"
  | "nightpress";

/** The subset of tokens a writer may redefine. */
export type ThemeTokenId =
  | "paper"
  | "paper-2"
  | "paper-3"
  | "paper-soft"
  | "ink"
  | "ink-light"
  | "ink-muted"
  | "vermilion";

export interface ThemeTokenDefinition {
  id: ThemeTokenId;
  /** The CSS custom property this writes to. */
  cssVar: string;
  label: string;
  description: string;
}

export const THEME_TOKENS: readonly ThemeTokenDefinition[] = [
  {
    id: "paper",
    cssVar: "--color-paper",
    label: "Paper",
    description: "The page itself — the ground everything sits on.",
  },
  {
    id: "paper-2",
    cssVar: "--color-paper-2",
    label: "Paper, deep",
    description: "Sidebars and panels, a shade below the page.",
  },
  {
    id: "paper-3",
    cssVar: "--color-paper-3",
    label: "Rule",
    description: "Borders, dividers, and hairlines.",
  },
  {
    id: "paper-soft",
    cssVar: "--color-paper-soft",
    label: "Paper, raised",
    description: "Cards, inputs, and anything lifted off the page.",
  },
  {
    id: "ink",
    cssVar: "--color-ink",
    label: "Ink",
    description: "Body text and headings.",
  },
  {
    id: "ink-light",
    cssVar: "--color-ink-light",
    label: "Ink, secondary",
    description: "Supporting text.",
  },
  {
    id: "ink-muted",
    cssVar: "--color-ink-muted",
    label: "Ink, muted",
    description: "Labels, captions, and placeholders.",
  },
  {
    id: "vermilion",
    cssVar: "--color-vermilion",
    label: "Accent",
    description: "The masthead red — buttons, marks, emphasis.",
  },
];

export type ThemeTokenValues = Partial<Record<ThemeTokenId, string>>;

export interface ThemePreset {
  id: ThemePresetId;
  label: string;
  description: string;
  /** True for presets whose ground is darker than its ink. */
  dark: boolean;
  /** Swatch values, mirroring the `[data-theme]` block in global.css. */
  tokens: Record<ThemeTokenId, string>;
}

const EDITORIAL_TOKENS: Record<ThemeTokenId, string> = {
  paper: "#f4ecd8",
  "paper-2": "#ebe1c9",
  "paper-3": "#ddd0b1",
  "paper-soft": "#faf3df",
  ink: "#1f1b16",
  "ink-light": "#4a3f33",
  // Matches global.css exactly. It is a low-contrast tertiary by design, so
  // Editorial reads as it always has; the settings panel reports the ratio
  // rather than this quietly restyling several hundred call sites.
  "ink-muted": "#8a7e6c",
  vermilion: "#c1272d",
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "editorial",
    label: "Editorial",
    description: "Aged newsprint and vermilion. The room as first printed.",
    dark: false,
    tokens: EDITORIAL_TOKENS,
  },
  {
    id: "foolscap",
    label: "Foolscap",
    description: "Cool grey-white with the yellow taken out. Easiest on tired eyes.",
    dark: false,
    tokens: {
      paper: "#eef0f1",
      "paper-2": "#e3e6e8",
      "paper-3": "#c9ced2",
      "paper-soft": "#f7f8f9",
      ink: "#1c2024",
      "ink-light": "#3f464d",
      "ink-muted": "#69727a",
      vermilion: "#9b4a52",
    },
  },
  {
    id: "broadsheet",
    label: "Broadsheet",
    description: "Near-white and high contrast. Maximum legibility, minimum tint.",
    dark: false,
    tokens: {
      paper: "#ffffff",
      "paper-2": "#f4f4f4",
      "paper-3": "#c4c4c4",
      "paper-soft": "#fafafa",
      ink: "#111111",
      "ink-light": "#333333",
      "ink-muted": "#5c5c5c",
      vermilion: "#b3121a",
    },
  },
  {
    id: "nightpress",
    label: "Nightpress",
    description: "The composing room after hours. Warm dark, ink reversed out.",
    dark: true,
    tokens: {
      paper: "#191714",
      "paper-2": "#211e1a",
      "paper-3": "#3b3630",
      "paper-soft": "#252119",
      ink: "#ece4d4",
      "ink-light": "#c4bbab",
      "ink-muted": "#8e8577",
      vermilion: "#e2686c",
    },
  },
];

export const DEFAULT_THEME_PRESET: ThemePresetId = "editorial";

export interface ThemePreference {
  preset: ThemePresetId;
  custom?: ThemeTokenValues;
}

export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  preset: DEFAULT_THEME_PRESET,
};

export function getThemePreset(id: ThemePresetId): ThemePreset {
  return (
    THEME_PRESETS.find((preset) => preset.id === id) ??
    THEME_PRESETS.find((preset) => preset.id === DEFAULT_THEME_PRESET)!
  );
}

/** `system` resolves against the OS setting; everything else is itself. */
export function resolveThemePreset(
  preset: ThemePresetId,
  prefersDark: boolean,
): Exclude<ThemePresetId, "system"> {
  if (preset !== "system") return preset;
  return prefersDark ? "nightpress" : "editorial";
}

const TOKEN_IDS = new Set<string>(THEME_TOKENS.map((token) => token.id));
const PRESET_IDS = new Set<string>([
  "system",
  ...THEME_PRESETS.map((preset) => preset.id),
]);

/**
 * Accepts `#rgb` and `#rrggbb`. The same shape the bootstrap script tests for,
 * because a custom value is written straight into a CSS custom property and an
 * unvalidated one would let stored JSON inject arbitrary CSS.
 */
export function isValidHexColor(value: unknown): value is string {
  return (
    typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
  );
}

/**
 * Coerce arbitrary stored/synced JSON into a usable preference. Unknown preset
 * ids and non-hex token values are dropped rather than thrown on — a corrupt
 * blob should cost you your theme, not the app.
 */
export function normalizeThemePreference(value: unknown): ThemePreference {
  if (!value || typeof value !== "object") return { ...DEFAULT_THEME_PREFERENCE };
  const raw = value as Record<string, unknown>;
  const preset = PRESET_IDS.has(raw.preset as string)
    ? (raw.preset as ThemePresetId)
    : DEFAULT_THEME_PRESET;

  const custom: ThemeTokenValues = {};
  const rawCustom = raw.custom;
  if (rawCustom && typeof rawCustom === "object") {
    for (const [key, tokenValue] of Object.entries(
      rawCustom as Record<string, unknown>,
    )) {
      if (!TOKEN_IDS.has(key) || !isValidHexColor(tokenValue)) continue;
      // Expand `#abc` to `#aabbcc` so stored values compare cleanly against
      // the preset swatches and against what an <input type="color"> returns.
      const hex = normalizeHex(tokenValue);
      if (hex) custom[key as ThemeTokenId] = hex;
    }
  }

  return Object.keys(custom).length > 0 ? { preset, custom } : { preset };
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readThemePreference(): ThemePreference {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_THEME_PREFERENCE };
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME_PREFERENCE };
    return normalizeThemePreference(JSON.parse(raw));
  } catch {
    // Corrupted blob — wipe and fall back rather than leaving the writer
    // stuck with a theme they cannot change.
    try {
      storage.removeItem(THEME_STORAGE_KEY);
    } catch {
      /* storage may be locked down (private mode) — ignore. */
    }
    return { ...DEFAULT_THEME_PREFERENCE };
  }
}

export function writeThemePreference(preference: ThemePreference): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify(normalizeThemePreference(preference)),
    );
  } catch {
    /* storage full or disabled — the preference is a hint, not a requirement. */
  }
}

/**
 * Stamp a preference onto an element (in practice `<html>`).
 *
 * `data-theme` selects the preset block; `data-theme-preference` records what
 * the writer actually chose, so "System" survives a round trip. Custom tokens
 * are set inline and cleared when dropped, so switching preset never leaves a
 * stale override behind.
 */
export function applyTheme(
  preference: ThemePreference,
  root: HTMLElement,
  prefersDark = false,
): void {
  const resolved = resolveThemePreset(preference.preset, prefersDark);
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-preference", preference.preset);
  for (const token of THEME_TOKENS) {
    const value = preference.custom?.[token.id];
    if (value) root.style.setProperty(token.cssVar, value);
    else root.style.removeProperty(token.cssVar);
  }
}

/** The colors a preset actually renders with, custom overrides folded in. */
export function resolvedThemeTokens(
  preference: ThemePreference,
  prefersDark = false,
): Record<ThemeTokenId, string> {
  const preset = getThemePreset(
    resolveThemePreset(preference.preset, prefersDark),
  );
  return { ...preset.tokens, ...preference.custom };
}

/**
 * A custom palette is the one place a writer can make the app unreadable, so
 * the settings panel reports the ink-on-paper ratio. The contrast maths lives
 * in `palette.ts`, which already checks document colors the same way — one
 * definition of "readable", not two that can drift.
 */
export const WCAG_AA_CONTRAST = 4.5;

export function themeContrast(
  preference: ThemePreference,
  prefersDark = false,
): number {
  const tokens = resolvedThemeTokens(preference, prefersDark);
  return contrastRatio(tokens.ink, tokens.paper);
}

/**
 * Inlined verbatim into `<head>` so the document is stamped before the first
 * paint. It cannot be a component: Qwik server-renders `<html>`, and any QRL
 * resumes long after the browser has already painted the default palette —
 * which is exactly the flash this avoids. Kept in this module so it can't
 * drift from `applyTheme`.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{
var KEY=${JSON.stringify(THEME_STORAGE_KEY)};
var VARS=${JSON.stringify(
  Object.fromEntries(THEME_TOKENS.map((token) => [token.id, token.cssVar])),
)};
var PRESETS=${JSON.stringify([
  "system",
  ...THEME_PRESETS.map((preset) => preset.id),
])};
var root=document.documentElement;
var pref={preset:${JSON.stringify(DEFAULT_THEME_PRESET)}};
try{var raw=localStorage.getItem(KEY);if(raw){var p=JSON.parse(raw);if(p&&PRESETS.indexOf(p.preset)>-1)pref=p;}}catch(e){}
var dark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
var resolved=pref.preset==='system'?(dark?'nightpress':'editorial'):pref.preset;
root.setAttribute('data-theme',resolved);
root.setAttribute('data-theme-preference',pref.preset);
if(pref.custom){for(var k in VARS){var v=pref.custom[k];if(typeof v==='string'&&/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v))root.style.setProperty(VARS[k],v);}}
}catch(e){}})();`;
