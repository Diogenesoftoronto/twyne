import { expect, test } from "bun:test";
import { createConvexTokenFetcher } from "./convex-token";

test("Convex refresh requests obtain a new token", async () => {
  let calls = 0;
  const fetchToken = createConvexTokenFetcher(
    async () => `token-${++calls}`,
    () => true,
  );
  expect(await fetchToken({ forceRefreshToken: false })).toBe("token-1");
  expect(await fetchToken({ forceRefreshToken: false })).toBe("token-1");
  expect(await fetchToken({ forceRefreshToken: true })).toBe("token-2");
});
test("overlapping refreshes are shared and a signed-out session cannot publish a token", async () => {
  let current = true;
  let finish!: (token: string) => void;
  let calls = 0;
  const fetchToken = createConvexTokenFetcher(
    () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    () => current,
  );
  const first = fetchToken({ forceRefreshToken: true });
  const second = fetchToken({ forceRefreshToken: true });
  expect(calls).toBe(1);
  current = false;
  finish("old-user-token");
  expect(await first).toBeNull();
  expect(await second).toBeNull();
  expect(await fetchToken({ forceRefreshToken: true })).toBeNull();
});
