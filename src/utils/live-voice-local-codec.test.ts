import { expect, test } from "bun:test";
import { LocalLiveInverseStft } from "./live-voice-local-codec";

test("incremental output equals one-batch output and contains the full trimmed duration", () => {
  const features = new Float32Array(1282 * 3);
  for (let i = 0; i < features.length; i++)
    features[i] = Math.sin(i / 137) * 0.1;
  const whole = new LocalLiveInverseStft();
  const expected = [...whole.append(features), ...whole.finish()];
  const stream = new LocalLiveInverseStft();
  const actual = [
    ...stream.append(features.subarray(0, 1282)),
    ...stream.append(features.subarray(1282)),
    ...stream.finish(),
  ];
  expect(actual).toHaveLength(960);
  expect(actual).toEqual(expected);
  expect(stream.finish()).toHaveLength(0);
  expect(() => stream.append(features)).toThrow();
});
