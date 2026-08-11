import { describe, expect, test } from "bun:test";
import { tokenIdentifierFromIssuerAndSubject } from "./authIdentity";

describe("tokenIdentifierFromIssuerAndSubject", () => {
  test("matches Convex's issuer-pipe-subject identity key", () => {
    expect(
      tokenIdentifierFromIssuerAndSubject(
        "https://example.convex.site",
        "better-auth-user-id",
      ),
    ).toBe("https://example.convex.site|better-auth-user-id");
  });

  test("preserves the configured issuer exactly", () => {
    expect(
      tokenIdentifierFromIssuerAndSubject(
        "https://example.convex.site/",
        "user",
      ),
    ).toBe("https://example.convex.site/|user");
  });

  test("rejects an incomplete identity", () => {
    expect(tokenIdentifierFromIssuerAndSubject(undefined, "user")).toBeNull();
    expect(
      tokenIdentifierFromIssuerAndSubject("https://example.convex.site", undefined),
    ).toBeNull();
  });
});
