/** Verification only: execute Twyne's current Appearance preference helpers. */
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PRESETS,
  THEME_TOKENS,
  WCAG_AA_CONTRAST,
  normalizeThemePreference,
  resolvedThemeTokens,
  themeContrast,
} from "../../../../src/utils/theme";

const inputs: unknown[] = [
  null,
  [],
  "nightpress",
  {},
  { preset: "unknown" },
  { preset: "system", custom: { paper: "#ABC", ink: "#123456" } },
  {
    preset: "foolscap",
    custom: {
      paper: " #abc",
      "paper-2": "#1234",
      "paper-3": "#12abEF",
      "paper-soft": "#abc ",
      ink: "url(evil)",
      "ink-light": 123,
      "ink-muted": "#fff",
      vermilion: "#888888",
      unknown: "#000000",
    },
  },
  { preset: "broadsheet", custom: [] },
  { preset: "Editorial", custom: { ink: "#0e0", paper: "#00ff00" } },
];
const all = [
  ...THEME_PRESETS.map(({ id }) => ({ preset: id })),
  { preset: "system" as const },
  normalizeThemePreference(inputs[5]),
  normalizeThemePreference(inputs[8]),
];
const reference = {
  provenance:
    "Generated from the current src/utils/theme.ts and palette.ts; UI definitions come from the current Settings Appearance section.",
  default: DEFAULT_THEME_PREFERENCE,
  tokens: THEME_TOKENS,
  presets: THEME_PRESETS,
  wcagAA: WCAG_AA_CONTRAST,
  normalization: inputs.map((input) => ({
    input,
    expected: normalizeThemePreference(input),
  })),
  resolved: all.flatMap((preference) =>
    [false, true].map((prefersDark) => ({
      preference,
      prefersDark,
      tokens: resolvedThemeTokens(preference, prefersDark),
      contrast: themeContrast(preference, prefersDark),
    })),
  ),
};
await Bun.write(
  new URL("./web-reference.json", import.meta.url),
  JSON.stringify(reference, null, 2) + "\n",
);
console.log(
  `Captured ${reference.normalization.length} normalization cases and ${reference.resolved.length} exact web palettes.`,
);
