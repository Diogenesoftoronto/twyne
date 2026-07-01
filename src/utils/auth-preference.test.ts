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

function installStorage(): void {
  const store: Record<string, string> = {};
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
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
});
