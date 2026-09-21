import { expect, test } from "bun:test";
import { passkeyOriginOptions } from "./passkey-origin";

test.each(["https://twyne.love", "https://www.twyne.love"])(
  "passkeys share the frontend RP on %s",
  (origin) => {
    expect(passkeyOriginOptions(origin)).toEqual({
      rpID: "twyne.love",
      rpName: "Twyne",
      origin: ["https://twyne.love", "https://www.twyne.love"],
    });
  },
);

test("development keeps its own RP and exact origin", () => {
  expect(passkeyOriginOptions("http://localhost:5173/settings/")).toEqual({
    rpID: "localhost",
    rpName: "Twyne",
    origin: "http://localhost:5173",
  });
  expect(passkeyOriginOptions("https://preview.example.com").rpID).toBe(
    "preview.example.com",
  );
  expect(passkeyOriginOptions("https://twyne.love.evil.example").origin).toBe(
    "https://twyne.love.evil.example",
  );
});
