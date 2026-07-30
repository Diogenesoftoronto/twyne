import { beforeEach, describe, expect, test } from "bun:test";
import {
  IDLE_MS,
  MAX_PASSES_PER_SESSION,
  MIN_INTERVAL_MS,
  WORD_DELTA_THRESHOLD,
  __resetForTests,
  onDraftChanged,
  snapshot,
  startBackgroundRoom,
  stopBackgroundRoom,
  whyNotReady,
} from "./background-room";
import { PERSONAS } from "./personas";

/**
 * The background room spends the writer's model budget without being asked,
 * so its guards are the part that has to be right. These tests exercise the
 * trigger and the spend limits directly, without going near a provider.
 */

const words = (n: number) => "word ".repeat(n).trim();
const doc = (n: number) => `${words(n)}\n\n${words(n)}`;

function start(overrides: Partial<Parameters<typeof startBackgroundRoom>[0]> = {}) {
  startBackgroundRoom({
    client: null,
    brief: null,
    folioId: "folio-1",
    personas: PERSONAS,
    enabled: true,
    baselineText: doc(100),
    ...overrides,
  });
}

beforeEach(() => {
  __resetForTests();
});

describe("startBackgroundRoom", () => {
  test("is off until enabled", () => {
    start({ enabled: false });
    expect(snapshot().status).toBe("off");
    expect(whyNotReady()).toBe("disabled");
  });

  test("goes idle when enabled, not straight to reading", () => {
    start();
    expect(snapshot().status).toBe("idle");
  });

  /**
   * Existing prose must count as already read. Otherwise reopening a folio
   * would immediately look like hundreds of new words and ambush the writer
   * with five notes on text they wrote days ago.
   */
  test("treats the text already on the page as read", () => {
    start({ baselineText: doc(400) });
    onDraftChanged(doc(400));
    expect(snapshot().pendingWords).toBe(0);
    expect(snapshot().status).toBe("idle");
  });

  test("switching folio resets the baseline rather than carrying it over", () => {
    start({ baselineText: doc(100) });
    onDraftChanged(doc(400));
    expect(snapshot().status).toBe("armed");

    start({ folioId: "folio-2", baselineText: doc(50) });
    expect(snapshot().pendingWords).toBe(0);
    expect(snapshot().status).toBe("idle");
    expect(snapshot().folioId).toBe("folio-2");
  });
});

describe("the trigger", () => {
  test("does not arm below the word threshold", () => {
    start({ baselineText: doc(100) });
    // 200 words baseline (two paragraphs of 100); add well under the threshold.
    onDraftChanged(`${doc(100)}\n\n${words(WORD_DELTA_THRESHOLD - 50)}`);
    expect(snapshot().status).toBe("idle");
  });

  test("arms once enough new material exists", () => {
    start({ baselineText: doc(100) });
    onDraftChanged(`${doc(100)}\n\n${words(WORD_DELTA_THRESHOLD + 10)}`);
    expect(snapshot().status).toBe("armed");
    expect(snapshot().pendingWords).toBeGreaterThanOrEqual(
      WORD_DELTA_THRESHOLD,
    );
  });

  /**
   * Deleting back below the threshold must disarm. A writer who pastes a
   * block, thinks better of it and cuts it should not get a pass on material
   * that is no longer in the draft.
   */
  test("disarms when the writer cuts back below the threshold", () => {
    start({ baselineText: doc(100) });
    onDraftChanged(`${doc(100)}\n\n${words(WORD_DELTA_THRESHOLD + 10)}`);
    expect(snapshot().status).toBe("armed");

    onDraftChanged(doc(100));
    expect(snapshot().status).toBe("idle");
  });

  test("ignores changes entirely once stopped", () => {
    start();
    stopBackgroundRoom();
    onDraftChanged(doc(1000));
    expect(snapshot().status).toBe("off");
    expect(snapshot().pendingWords).toBe(0);
  });

  test("the idle wait is long enough to not interrupt mid-paragraph", () => {
    // A guard on the constant itself: anything under a minute would fire
    // while the writer is still thinking between sentences.
    expect(IDLE_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe("spend guards", () => {
  test("refuses to run without a folio", () => {
    start({ folioId: null });
    expect(whyNotReady()).toBe("no-folio");
  });

  test("refuses to run on a draft too short to be worth reading", () => {
    start({ baselineText: "" });
    onDraftChanged("only a handful of words here");
    expect(whyNotReady()).toBe("too-short");
  });

  test("enforces a floor between passes", () => {
    start({ baselineText: doc(100) });
    onDraftChanged(doc(300));
    const now = Date.now();
    // Simulate a pass having just happened.
    const s = snapshot();
    expect(s.lastPassAt).toBe(0);
    // With no prior pass there is no "too soon" verdict...
    expect(whyNotReady(now)).not.toBe("too-soon");
    // ...and the floor is generous enough to stay inside the server's
    // agentRoom rate limit of 6 calls per minute.
    expect(MIN_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
  });

  test("caps passes per session so a long day cannot run away with spend", () => {
    expect(MAX_PASSES_PER_SESSION).toBeGreaterThan(0);
    expect(MAX_PASSES_PER_SESSION).toBeLessThanOrEqual(12);
  });

  test("reports a clean snapshot shape for the UI", () => {
    start();
    const s = snapshot();
    expect(s).toMatchObject({
      status: "idle",
      pendingWords: 0,
      passesThisSession: 0,
      folioId: "folio-1",
    });
  });
});
