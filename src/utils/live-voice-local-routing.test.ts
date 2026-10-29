import { describe, expect, test } from "bun:test";
import {
  reusableLocalLiveBenchmark,
  selectLocalLiveSpeechPath,
} from "./live-voice-local-routing";

describe("local Live device routing", () => {
  test("uses LFM speech when it keeps up and otherwise tries Supertonic", () => {
    expect(
      selectLocalLiveSpeechPath({
        adapter: "a",
        lfmSpeechRate: 1,
        supertonicRate: 2,
      }),
    ).toBe("lfm");
    expect(
      selectLocalLiveSpeechPath({
        adapter: "a",
        lfmSpeechRate: 0.4,
        supertonicRate: 1,
      }),
    ).toBe("supertonic");
    expect(
      selectLocalLiveSpeechPath({
        adapter: "a",
        lfmSpeechRate: 0.4,
        supertonicRate: null,
      }),
    ).toBe("lagging");
  });

  test("does not reuse measurements after an adapter change or invalid data", () => {
    const result = { adapter: "a", lfmSpeechRate: 0.4, supertonicRate: null };
    expect(reusableLocalLiveBenchmark(result, "a")).toEqual(result);
    expect(reusableLocalLiveBenchmark(result, "b")).toBeNull();
    expect(
      reusableLocalLiveBenchmark({ ...result, lfmSpeechRate: NaN }, "a"),
    ).toBeNull();
    expect(
      reusableLocalLiveBenchmark({ ...result, supertonicRate: 0 }, "a"),
    ).toBeNull();
  });
});
