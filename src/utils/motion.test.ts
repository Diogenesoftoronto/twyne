import { afterEach, describe, expect, test } from "bun:test";
import {
  MOTION_BOOTSTRAP_SCRIPT,
  MOTION_PREFERENCES,
  MOTION_STORAGE_KEY,
  REDUCED_MOTION_QUERY,
  TYPING_IDLE_MS,
  allowsMotion,
  applyMotion,
  isTyping,
  markTyping,
  motionLevel,
  normalizeMotionPreference,
  resolveMotionLevel,
} from "./motion";

/** Stand-in for `<html>`: only the attribute calls motion.ts makes. */
function fakeRoot(seed: Record<string, string> = {}) {
  const attrs = new Map(Object.entries(seed));
  return {
    attrs,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
    removeAttribute: (k: string) => void attrs.delete(k),
  } as unknown as HTMLElement & { attrs: Map<string, string> };
}

function runBootstrap(stored: string | null, reduced: boolean) {
  const root = fakeRoot();
  new Function("document", "localStorage", "window", MOTION_BOOTSTRAP_SCRIPT)(
    { documentElement: root },
    { getItem: (key: string) => (key === MOTION_STORAGE_KEY ? stored : null) },
    {
      matchMedia: (query: string) => ({
        matches: query === REDUCED_MOTION_QUERY && reduced,
      }),
    },
  );
  return root;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe("motion preferences", () => {
  test("unknown values fall back to system", () => {
    expect(normalizeMotionPreference("calm")).toBe("calm");
    expect(normalizeMotionPreference("loud")).toBe("system");
    expect(normalizeMotionPreference(null)).toBe("system");
  });

  test("system follows the operating system's reduced-motion setting", () => {
    expect(resolveMotionLevel("system", false)).toBe("full");
    expect(resolveMotionLevel("system", true)).toBe("still");
  });

  test("an explicit level wins over the operating system", () => {
    expect(resolveMotionLevel("full", true)).toBe("full");
    expect(resolveMotionLevel("calm", true)).toBe("calm");
    expect(resolveMotionLevel("still", false)).toBe("still");
  });

  test("every preference has copy for Settings", () => {
    expect(MOTION_PREFERENCES.map((option) => option.id)).toEqual([
      "system",
      "full",
      "calm",
      "still",
    ]);
    for (const option of MOTION_PREFERENCES) {
      expect(option.description.length).toBeGreaterThan(20);
    }
  });
});

describe("applyMotion", () => {
  test("stamps the level and preference and announces a change once", () => {
    const events: string[] = [];
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: (event: CustomEvent<string>) => {
        events.push(event.detail);
        return true;
      },
    };
    const root = fakeRoot();
    expect(applyMotion("system", root, true)).toBe("still");
    expect(root.attrs.get("data-motion")).toBe("still");
    expect(root.attrs.get("data-motion-preference")).toBe("system");
    applyMotion("still", root, false);
    expect(events).toEqual(["still"]);
  });
});

describe("bootstrap script", () => {
  test("matches applyMotion for every stored preference", () => {
    for (const reduced of [false, true]) {
      for (const stored of ["system", "full", "calm", "still", null, "junk"]) {
        const root = runBootstrap(stored, reduced);
        const expected = resolveMotionLevel(
          normalizeMotionPreference(stored),
          reduced,
        );
        expect(root.attrs.get("data-motion")).toBe(expected);
      }
    }
  });
});

describe("allowsMotion", () => {
  test("ambient motion needs full and an idle writer", () => {
    expect(allowsMotion("ambient", fakeRoot({ "data-motion": "full" }))).toBe(
      true,
    );
    expect(
      allowsMotion(
        "ambient",
        fakeRoot({ "data-motion": "full", "data-typing": "" }),
      ),
    ).toBe(false);
    expect(allowsMotion("ambient", fakeRoot({ "data-motion": "calm" }))).toBe(
      false,
    );
  });

  test("feedback and ceremonies play at calm, nothing plays at still", () => {
    const calm = fakeRoot({ "data-motion": "calm" });
    expect(allowsMotion("feedback", calm)).toBe(true);
    expect(allowsMotion("ceremony", calm)).toBe(true);
    const still = fakeRoot({ "data-motion": "still" });
    expect(allowsMotion("feedback", still)).toBe(false);
    expect(allowsMotion("ceremony", still)).toBe(false);
  });

  test("reads the stamped level", () => {
    (globalThis as { document?: unknown }).document = {};
    expect(motionLevel(fakeRoot({ "data-motion": "calm" }))).toBe("calm");
  });
});

describe("markTyping", () => {
  test("sets the attribute once per burst and clears it after quiet", async () => {
    (globalThis as { document?: unknown }).document = {};
    const root = fakeRoot();
    let writes = 0;
    const set = root.setAttribute.bind(root);
    root.setAttribute = (k: string, v: string) => {
      writes += 1;
      set(k, v);
    };
    markTyping(root);
    markTyping(root);
    markTyping(root);
    expect(isTyping(root)).toBe(true);
    expect(writes).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, TYPING_IDLE_MS + 60));
    expect(isTyping(root)).toBe(false);
  });
});
