import { expect, test } from "bun:test";
import { creditPurchaseAction } from "./purchase-waitlist";

test("a signed-in buyer is never sent to the waitlist during a wallet load or refresh", () => {
  expect(creditPurchaseAction(true, false, "idle", false)).toBe("loading");
  expect(creditPurchaseAction(false, true, "idle", false)).toBe("loading");
  expect(creditPurchaseAction(false, true, "loading", false)).toBe("loading");
  expect(creditPurchaseAction(false, true, "ready", true)).toBe("checkout");
  expect(creditPurchaseAction(false, true, "loading", true)).toBe("loading");
  expect(creditPurchaseAction(false, true, "ready", false)).toBe("waitlist");
  expect(creditPurchaseAction(false, true, "error", false)).toBe("unavailable");
  expect(creditPurchaseAction(false, false, "idle", false)).toBe("waitlist");
});
