import { describe, expect, test } from "bun:test";
import {
  analyticsIdFromConvexJwt,
  authIdentityTransition,
  clearAuthAttempt,
  consumeAuthAttempt,
  rememberAuthAttempt,
} from "./auth-analytics";

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("auth analytics identity", () => {
  test("derives the same issuer-subject identifier Convex uses", () => {
    expect(
      analyticsIdFromConvexJwt(
        jwt({ iss: "https://auth.example.test", sub: "user_123" }),
      ),
    ).toBe("https://auth.example.test|user_123");
  });

  test("rejects malformed tokens and incomplete identity claims", () => {
    expect(analyticsIdFromConvexJwt(undefined)).toBeUndefined();
    expect(analyticsIdFromConvexJwt("not-a-jwt")).toBeUndefined();
    expect(analyticsIdFromConvexJwt(jwt({ sub: "user_123" }))).toBeUndefined();
    expect(analyticsIdFromConvexJwt(jwt({ iss: "issuer" }))).toBeUndefined();
  });

  test("only aliases the legacy ID belonging to the same account", () => {
    expect(authIdentityTransition(undefined, "raw-a", "canonical-a")).toBe(
      "identify_anonymous",
    );
    expect(authIdentityTransition("canonical-a", "raw-a", "canonical-a")).toBe(
      "already_identified",
    );
    expect(authIdentityTransition("raw-a", "raw-a", "canonical-a")).toBe(
      "alias_legacy_id",
    );
    expect(authIdentityTransition("canonical-b", "raw-a", "canonical-a")).toBe(
      "reset_other_account",
    );
  });
});

describe("pending auth attempt", () => {
  test("survives a redirect and is consumed exactly once", () => {
    const storage = memoryStorage();
    rememberAuthAttempt({ method: "bluesky", flow: "signup" }, storage, 1_000);

    expect(consumeAuthAttempt(storage, 2_000)).toEqual({
      method: "bluesky",
      flow: "signup",
      startedAt: 1_000,
    });
    expect(consumeAuthAttempt(storage, 2_000)).toBeUndefined();
  });

  test("drops expired, future, invalid, and explicitly cleared attempts", () => {
    const storage = memoryStorage();
    rememberAuthAttempt(
      { method: "email_otp", flow: "signin" },
      storage,
      1_000,
    );
    expect(
      consumeAuthAttempt(storage, 1_000 + 15 * 60 * 1000 + 1),
    ).toBeUndefined();

    rememberAuthAttempt({ method: "passkey", flow: "signin" }, storage, 2_000);
    expect(consumeAuthAttempt(storage, 1_999)).toBeUndefined();

    storage.setItem(
      "twyne:analytics:pending-auth-attempt",
      JSON.stringify({ method: "password", flow: "signin", startedAt: 1 }),
    );
    expect(consumeAuthAttempt(storage, 2)).toBeUndefined();

    rememberAuthAttempt({ method: "passkey", flow: "signin" }, storage, 3_000);
    clearAuthAttempt(storage);
    expect(consumeAuthAttempt(storage, 3_001)).toBeUndefined();
  });
});
