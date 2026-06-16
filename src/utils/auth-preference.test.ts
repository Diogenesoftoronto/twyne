import { afterEach, describe, expect, test } from "bun:test";
import {
  clearPreferredMethod,
  getPreferredMethod,
  setPreferredMethod,
} from "./auth-preference";

// Bun's test runner runs outside the browser, so install an in-memory
// `window.localStorage` shim that matches the surface the helper uses.
type WindowLike = {
  localStorage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
    clear: () => void;
  };
};

const g = globalThis as unknown as { window?: WindowLike };

function installStorage(): void {
  const store: Record<string, string> = {};
  g.window = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v;
      },
      removeItem: (k) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  };
}

function uninstallStorage(): void {
  g.window = undefined;
}

afterEach(() => {
  try {
    g.window?.localStorage.clear();
  } catch {
    /* ignore */
  }
  uninstallStorage();
});

describe("auth-preference", () => {
  test("returns null for an unknown email", () => {
    installStorage();
    expect(getPreferredMethod("nobody@example.com")).toBeNull();
  });

  test("stores the method the user last used", () => {
    installStorage();
    setPreferredMethod("writer@example.com", "passkey");
    expect(getPreferredMethod("writer@example.com")).toBe("passkey");
  });

  test("normalizes the email key (case + whitespace)", () => {
    installStorage();
    setPreferredMethod("  Writer@Example.COM ", "otp");
    expect(getPreferredMethod("writer@example.com")).toBe("otp");
    expect(getPreferredMethod("WRITER@example.com")).toBe("otp");
  });

  test("keeps separate records for separate emails", () => {
    installStorage();
    setPreferredMethod("a@example.com", "passkey");
    setPreferredMethod("b@example.com", "otp");
    expect(getPreferredMethod("a@example.com")).toBe("passkey");
    expect(getPreferredMethod("b@example.com")).toBe("otp");
  });

  test("clearPreferredMethod removes a single record", () => {
    installStorage();
    setPreferredMethod("writer@example.com", "passkey");
    setPreferredMethod("other@example.com", "otp");
    clearPreferredMethod("writer@example.com");
    expect(getPreferredMethod("writer@example.com")).toBeNull();
    expect(getPreferredMethod("other@example.com")).toBe("otp");
  });

  test("survives a corrupted localStorage blob", () => {
    installStorage();
    g.window!.localStorage.setItem("twyne.auth.preferredMethod", "{not json");
    expect(getPreferredMethod("writer@example.com")).toBeNull();
    // Subsequent writes should still succeed.
    setPreferredMethod("writer@example.com", "passkey");
    expect(getPreferredMethod("writer@example.com")).toBe("passkey");
  });

  test("is a no-op when window is unavailable (SSR)", () => {
    uninstallStorage();
    // Neither call should throw; both return null since there's no store.
    expect(getPreferredMethod("writer@example.com")).toBeNull();
    setPreferredMethod("writer@example.com", "passkey");
    expect(getPreferredMethod("writer@example.com")).toBeNull();
  });
});
