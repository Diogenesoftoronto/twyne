import { describe, expect, test } from "bun:test";
import { hasAuthenticatedConvexIdentity, type AuthState } from "./auth-context";

const productUser = {
  id: "user-1",
  email: "writer@example.com",
};

describe("Convex authentication state", () => {
  test("requires both the product session and installed Convex token", () => {
    const cases: Array<[AuthState, boolean]> = [
      [
        {
          user: productUser,
          loading: false,
          provider: "convex",
          convexAuthenticated: true,
        },
        true,
      ],
      [
        {
          user: productUser,
          loading: false,
          provider: "convex",
          convexAuthenticated: false,
        },
        false,
      ],
      [
        {
          user: productUser,
          loading: false,
          provider: "atproto",
        },
        false,
      ],
      [{ user: null, loading: false }, false],
    ];

    for (const [state, expected] of cases) {
      expect(hasAuthenticatedConvexIdentity(state)).toBe(expected);
    }
  });
});
