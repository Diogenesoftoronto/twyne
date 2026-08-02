import { beforeEach, describe, expect, test } from "bun:test";
import { contrastRatio } from "./palette";
import {
  DEFAULT_THEME_PRESET,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_PRESETS,
  THEME_STORAGE_KEY,
  THEME_TOKENS,
  WCAG_AA_CONTRAST,
  applyTheme,
  getThemePreset,
  isValidHexColor,
  normalizeThemePreference,
  readThemePreference,
  resolveThemePreset,
  resolvedThemeTokens,
  themeContrast,
  writeThemePreference,
} from "./theme";

/** Minimal localStorage stand-in; bun's test env has no DOM storage. */
function installStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as unknown as Storage;
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return store;
}

/** Stand-in for `<html>` — only the bits `applyTheme` touches. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    attrs,
    props,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    style: {
      setProperty: (k: string, v: string) => void props.set(k, v),
      removeProperty: (k: string) => void props.delete(k),
    },
  } as unknown as HTMLElement & {
    attrs: Map<string, string>;
    props: Map<string, string>;
  };
}

beforeEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("theme presets", () => {
  test("every preset defines every customisable token", () => {
    for (const preset of THEME_PRESETS) {
      for (const token of THEME_TOKENS) {
        expect(isValidHexColor(preset.tokens[token.id])).toBe(true);
      }
    }
  });

  test("editorial is the default and matches the shipped palette", () => {
    const editorial = getThemePreset(DEFAULT_THEME_PRESET);
    expect(editorial.id).toBe("editorial");
    // These are the values in global.css's @theme block. If someone changes
    // the palette there without updating the swatches, the settings preview
    // would quietly lie about what "reset" restores.
    expect(editorial.tokens.paper).toBe("#f4ecd8");
    expect(editorial.tokens.ink).toBe("#1f1b16");
    expect(editorial.tokens.vermilion).toBe("#c1272d");
  });

  test("body ink clears WCAG AA on every preset", () => {
    for (const preset of THEME_PRESETS) {
      const ratio = contrastRatio(preset.tokens.ink, preset.tokens.paper);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_CONTRAST);
    }
  });

  test("the dark preset really is dark", () => {
    const night = getThemePreset("nightpress");
    expect(night.dark).toBe(true);
    // Ink lighter than paper is what "reversed out" means.
    const inkOnWhite = contrastRatio(night.tokens.ink, "#ffffff");
    const paperOnWhite = contrastRatio(night.tokens.paper, "#ffffff");
    expect(inkOnWhite).toBeLessThan(paperOnWhite);
  });

  test("system resolves against the OS setting, others are themselves", () => {
    expect(resolveThemePreset("system", true)).toBe("nightpress");
    expect(resolveThemePreset("system", false)).toBe("editorial");
    expect(resolveThemePreset("foolscap", true)).toBe("foolscap");
  });
});

describe("preference normalisation", () => {
  test("falls back to the default for junk", () => {
    expect(normalizeThemePreference(null).preset).toBe(DEFAULT_THEME_PRESET);
    expect(normalizeThemePreference("nightpress").preset).toBe(
      DEFAULT_THEME_PRESET,
    );
    expect(normalizeThemePreference({ preset: "chartreuse" }).preset).toBe(
      DEFAULT_THEME_PRESET,
    );
  });

  test("drops unknown tokens and non-hex values", () => {
    const result = normalizeThemePreference({
      preset: "foolscap",
      custom: {
        paper: "#ffeecc",
        ink: "javascript:alert(1)",
        "not-a-token": "#000000",
        vermilion: "red",
      },
    });
    expect(result.preset).toBe("foolscap");
    expect(result.custom).toEqual({ paper: "#ffeecc" });
  });

  test("expands shorthand hex so values compare cleanly", () => {
    const result = normalizeThemePreference({
      preset: "editorial",
      custom: { paper: "#ABC" },
    });
    expect(result.custom?.paper).toBe("#aabbcc");
  });

  test("omits the custom key entirely when nothing survives", () => {
    const result = normalizeThemePreference({
      preset: "editorial",
      custom: { bogus: "#fff" },
    });
    expect(result.custom).toBeUndefined();
  });
});

describe("storage", () => {
  test("round-trips a preference", () => {
    installStorage();
    writeThemePreference({ preset: "nightpress", custom: { ink: "#ffffff" } });
    expect(readThemePreference()).toEqual({
      preset: "nightpress",
      custom: { ink: "#ffffff" },
    });
  });

  test("recovers from a corrupt blob instead of throwing", () => {
    const store = installStorage({ [THEME_STORAGE_KEY]: "{not json" });
    expect(readThemePreference().preset).toBe(DEFAULT_THEME_PRESET);
    // The bad value is cleared so it cannot keep failing on every load.
    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
  });

  test("is a no-op outside the browser", () => {
    expect(readThemePreference().preset).toBe(DEFAULT_THEME_PRESET);
    expect(() => writeThemePreference({ preset: "foolscap" })).not.toThrow();
  });
});

describe("applyTheme", () => {
  test("stamps the resolved preset and remembers the choice", () => {
    const root = fakeRoot();
    applyTheme({ preset: "system" }, root, true);
    expect(root.attrs.get("data-theme")).toBe("nightpress");
    expect(root.attrs.get("data-theme-preference")).toBe("system");
  });

  test("writes custom tokens as CSS custom properties", () => {
    const root = fakeRoot();
    applyTheme({ preset: "editorial", custom: { paper: "#ffeecc" } }, root);
    expect(root.props.get("--color-paper")).toBe("#ffeecc");
  });

  test("clears overrides that are no longer set", () => {
    const root = fakeRoot();
    applyTheme({ preset: "editorial", custom: { paper: "#ffeecc" } }, root);
    applyTheme({ preset: "editorial" }, root);
    expect(root.props.has("--color-paper")).toBe(false);
  });
});

describe("resolved tokens and contrast", () => {
  test("custom values win over the preset", () => {
    const tokens = resolvedThemeTokens({
      preset: "nightpress",
      custom: { ink: "#ffffff" },
    });
    expect(tokens.ink).toBe("#ffffff");
    expect(tokens.paper).toBe(getThemePreset("nightpress").tokens.paper);
  });

  test("reports the ink-on-paper ratio a writer just broke", () => {
    // Grey ink on cream: legible-looking in a swatch, unreadable as body text.
    const ratio = themeContrast({
      preset: "editorial",
      custom: { ink: "#a09888" },
    });
    expect(ratio).toBeLessThan(WCAG_AA_CONTRAST);
  });
});

describe("bootstrap script", () => {
  test("carries the same key, presets, and tokens as the module", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
    for (const preset of THEME_PRESETS) {
      expect(THEME_BOOTSTRAP_SCRIPT).toContain(preset.id);
    }
    for (const token of THEME_TOKENS) {
      expect(THEME_BOOTSTRAP_SCRIPT).toContain(token.cssVar);
    }
  });

  test("stamps the document the same way applyTheme does", () => {
    const root = fakeRoot();
    const seen: Record<string, unknown> = {};
    // Run the script body against stand-ins for the globals it touches.
    new Function(
      "document",
      "localStorage",
      "window",
      THEME_BOOTSTRAP_SCRIPT,
    )(
      { documentElement: root },
      {
        getItem: () =>
          JSON.stringify({ preset: "foolscap", custom: { ink: "#123456" } }),
      },
      { matchMedia: () => ({ matches: false }) },
    );
    seen.theme = root.attrs.get("data-theme");
    expect(seen.theme).toBe("foolscap");
    expect(root.attrs.get("data-theme-preference")).toBe("foolscap");
    expect(root.props.get("--color-ink")).toBe("#123456");
  });

  test("resolves system to the dark preset when the OS asks for it", () => {
    const root = fakeRoot();
    new Function("document", "localStorage", "window", THEME_BOOTSTRAP_SCRIPT)(
      { documentElement: root },
      { getItem: () => JSON.stringify({ preset: "system" }) },
      { matchMedia: () => ({ matches: true }) },
    );
    expect(root.attrs.get("data-theme")).toBe("nightpress");
    expect(root.attrs.get("data-theme-preference")).toBe("system");
  });

  test("survives storage that throws", () => {
    const root = fakeRoot();
    new Function("document", "localStorage", "window", THEME_BOOTSTRAP_SCRIPT)(
      { documentElement: root },
      {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      { matchMedia: () => ({ matches: false }) },
    );
    expect(root.attrs.get("data-theme")).toBe(DEFAULT_THEME_PRESET);
  });

  test("refuses a custom value that is not a plain hex color", () => {
    const root = fakeRoot();
    new Function("document", "localStorage", "window", THEME_BOOTSTRAP_SCRIPT)(
      { documentElement: root },
      {
        getItem: () =>
          JSON.stringify({
            preset: "editorial",
            custom: { paper: "red; background: url(evil)" },
          }),
      },
      { matchMedia: () => ({ matches: false }) },
    );
    expect(root.props.has("--color-paper")).toBe(false);
  });
});
