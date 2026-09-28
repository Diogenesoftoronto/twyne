import { expect, test } from "bun:test";
import { liveHandshake } from "../scripts/live-voice-relay.mjs";
const issuer = "https://api.notorganic.info";
const proof = (htu = `${issuer}/v1/live/sessions`) =>
  `header.${Buffer.from(JSON.stringify({ htu, htm: "GET" })).toString("base64url")}.signature`;
const handshake = () => ({
  type: "twyne.live.connect",
  authorization: "DPoP token",
  dpop: proof(),
  idempotencyKey: "session-123",
  maxCostMicrousd: 500_000,
});
test("Live relay pins destination and the approved session spending ceiling", () => {
  const result = liveHandshake(handshake(), issuer);
  expect(result.url).toBe("wss://api.notorganic.info/v1/live/sessions");
  expect(result.headers["x-notorganic-max-cost-microusd"]).toBe("500000");
  expect(() =>
    liveHandshake({ ...handshake(), maxCostMicrousd: 5_000_000 }, issuer),
  ).toThrow();
  expect(() =>
    liveHandshake(
      { ...handshake(), dpop: proof("https://other.example/") },
      issuer,
    ),
  ).toThrow();
  expect(() =>
    liveHandshake(handshake(), "http://api.notorganic.info"),
  ).toThrow();
  expect(() =>
    liveHandshake(
      { ...handshake(), authorization: "Bearer provider-key" },
      issuer,
    ),
  ).toThrow();
});
