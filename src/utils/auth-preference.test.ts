import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  clearPreferredMethod,
  getPreferredMethod,
  setPreferredMethod,
} from "./auth-preference";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

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
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();

type StorageShim = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};

function installStorage(): void {
  const store: Record<string, string> = {};
  installStorageShim({
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = v;
    },
    removeItem: (k) => {
      delete store[k];
    },
  });
}

function installStorageShim(localStorage: StorageShim): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { localStorage },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorage,
  });
}

function uninstallStorage(): void {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  }
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, "localStorage");
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: originalLocalStorage,
    });
  }
}

afterEach(() => {
  try {
    g.window?.localStorage.clear();
  } catch {
    /* ignore */
  }
  uninstallStorage();
});

afterAll(() => {
  releaseBrowserGlobalsLock();
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

  // The sign-in panel uses this preference as the *only* safe pre-session
  // signal for whether to offer passkey sign-in (you can't list a stranger's
  // passkeys before a session exists). These cases lock in the gating rule
  // `offerPasskey === (getPreferredMethod(email) === "passkey")`.
  test("passkey is only offered for accounts that registered one", () => {
    installStorage();
    // New / OTP-only accounts must not be offered passkey sign-in.
    expect(getPreferredMethod("newbie@example.com") === "passkey").toBe(false);
    setPreferredMethod("otpuser@example.com", "otp");
    expect(getPreferredMethod("otpuser@example.com") === "passkey").toBe(false);
    // Only once a passkey is registered does the offer turn on.
    setPreferredMethod("haskey@example.com", "passkey");
    expect(getPreferredMethod("haskey@example.com") === "passkey").toBe(true);
  });

  test("clearing a stale passkey hint disables the passkey offer", () => {
    installStorage();
    setPreferredMethod("writer@example.com", "passkey");
    expect(getPreferredMethod("writer@example.com") === "passkey").toBe(true);
    // A failed passkey sign-in (e.g. PASSKEY_NOT_FOUND) clears the hint so we
    // fall back to OTP and stop offering passkey on this device.
    clearPreferredMethod("writer@example.com");
    expect(getPreferredMethod("writer@example.com") === "passkey").toBe(false);
  });

  test("persists under the namespaced storage key", () => {
    installStorage();
    setPreferredMethod("writer@example.com", "passkey");
    expect(
      g.window!.localStorage.getItem("twyne.auth.preferredMethod"),
    ).not.toBeNull();
    expect(g.window!.localStorage.getItem("")).toBeNull();
  });

  test("is a no-op when accessing localStorage throws", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {},
    });
    Object.defineProperty(globalThis.window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(getPreferredMethod("writer@example.com")).toBeNull();
  });

  test("keeps an empty stored blob untouched", () => {
    installStorage();
    g.window!.localStorage.setItem("twyne.auth.preferredMethod", "");
    expect(getPreferredMethod("writer@example.com")).toBeNull();
    expect(g.window!.localStorage.getItem("twyne.auth.preferredMethod")).toBe(
      "",
    );
  });

  test("ignores a non-object stored blob when writing", () => {
    installStorage();
    g.window!.localStorage.setItem("twyne.auth.preferredMethod", "[]");
    setPreferredMethod("writer@example.com", "passkey");
    expect(getPreferredMethod("writer@example.com")).toBe("passkey");
  });

  test("ignores a primitive stored blob when writing", () => {
    installStorage();
    g.window!.localStorage.setItem("twyne.auth.preferredMethod", '"hello"');
    expect(() =>
      setPreferredMethod("writer@example.com", "passkey"),
    ).not.toThrow();
    expect(getPreferredMethod("writer@example.com")).toBe("passkey");
  });

  test("wipes a corrupted blob even when writes fail", () => {
    const store: Record<string, string> = {
      "twyne.auth.preferredMethod": "{not json",
    };
    installStorageShim({
      getItem: (k) => (k in store ? store[k] : null),
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: (k) => {
        delete store[k];
      },
    });
    setPreferredMethod("writer@example.com", "passkey");
    expect(
      g.window!.localStorage.getItem("twyne.auth.preferredMethod"),
    ).toBeNull();
  });

  test("attempts to wipe corrupted data even when removal fails", () => {
    let removeAttempted = false;
    installStorageShim({
      getItem: (k) =>
        k === "twyne.auth.preferredMethod" ? "{not json" : null,
      setItem: () => {},
      removeItem: () => {
        removeAttempted = true;
        throw new Error("locked");
      },
    });
    expect(getPreferredMethod("writer@example.com")).toBeNull();
    expect(removeAttempted).toBe(true);
  });

  test("lowercases keys via the same mapping for read and write", () => {
    installStorage();
    setPreferredMethod("a\u00df@example.com", "otp");
    // "ß".toUpperCase() is "SS", so an uppercasing normalization would
    // collide "aß@…" with "ass@…"; lowercasing keeps them apart.
    expect(getPreferredMethod("ass@example.com")).toBeNull();
  });

  test("returns null for a blank email even if a stored key matches", () => {
    installStorage();
    g.window!.localStorage.setItem(
      "twyne.auth.preferredMethod",
      '{"":"passkey"}',
    );
    expect(getPreferredMethod("   ")).toBeNull();
  });

  test("never writes for a blank email", () => {
    installStorage();
    setPreferredMethod("   ", "passkey");
    expect(
      g.window!.localStorage.getItem("twyne.auth.preferredMethod"),
    ).toBeNull();
  });

  test("never writes when clearing a blank email", () => {
    installStorage();
    clearPreferredMethod("   ");
    expect(
      g.window!.localStorage.getItem("twyne.auth.preferredMethod"),
    ).toBeNull();
  });
});
