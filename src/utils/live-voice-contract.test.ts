import { describe, expect, test } from "bun:test";
import { liveVoiceAccess, parseLiveAction } from "./live-voice-contract";

describe("Live credit access", () => {
  test("welcome credit unlocks premium voice until spent", () => {
    expect(
      liveVoiceAccess({
        availableMicros: 2_500_000,
        welcomeCredit: { granted: true, remainingMicros: 2_500_000 },
      }),
    ).toMatchObject({ eligible: true, welcome: true });
    expect(
      liveVoiceAccess({
        availableMicros: 100_000,
        welcomeCredit: { granted: true, remainingMicros: 0 },
      }).eligible,
    ).toBe(false);
  });
  test("purchased credit alone does not confer Pro and debt blocks spending", () => {
    expect(liveVoiceAccess({ availableMicros: 10_000_000 }).eligible).toBe(
      false,
    );
    expect(
      liveVoiceAccess({
        availableMicros: 10_000_000,
        hostedInferenceBlocked: true,
      }).availableMicros,
    ).toBe(0);
  });
  test("expired or other-product subscriptions do not grant premium voice", () => {
    const plan = {
      product: "twyne",
      plan: "twyne_pro_v2",
      status: "active",
      currentPeriodEnd: Date.now() + 60_000,
    };
    expect(liveVoiceAccess({ subscriptions: [plan] }).eligible).toBe(true);
    expect(
      liveVoiceAccess({ subscriptions: [{ ...plan, currentPeriodEnd: 1 }] })
        .eligible,
    ).toBe(false);
    expect(
      liveVoiceAccess({ subscriptions: [{ ...plan, product: "keating" }] })
        .eligible,
    ).toBe(false);
  });
});
test("voice action parsing rejects unsupported and malformed operations", () => {
  expect(() =>
    parseLiveAction('{"kind":"publish","text":"x","original":"","target":""}'),
  ).toThrow();
  expect(() =>
    parseLiveAction(
      '{"kind":"replace","text":null,"original":"x","target":""}',
    ),
  ).toThrow();
  expect(
    parseLiveAction(
      '{"kind":"replace","text":"new","original":"old","target":""}',
    ).kind,
  ).toBe("replace");
});
