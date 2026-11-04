import { expect, test } from "bun:test";
import {
  benchmarkLocalLive,
  localLiveRoute,
  readLocalLiveRate,
  saveLocalLiveRate,
} from "./live-voice-local-benchmark";

test("benchmark counts actual worker audio and ignores other request ids", async () => {
  const worker = new EventTarget() as Worker;
  worker.postMessage = (message) => {
    queueMicrotask(() => {
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: {
            id: message.id + 1,
            type: "audio",
            samples: new Float32Array(24000),
          },
        }),
      );
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: {
            id: message.id,
            type: "audio",
            samples: new Float32Array(24000),
          },
        }),
      );
      worker.dispatchEvent(
        new MessageEvent("message", { data: { id: message.id, type: "done" } }),
      );
    });
  };
  expect(
    await benchmarkLocalLive(worker, new Float32Array(16000), 7),
  ).toBeGreaterThan(0);
});

test("slow local prefers available hosted and otherwise remains local with a lag state", () => {
  expect(localLiveRoute(1, true)).toBe("local");
  expect(localLiveRoute(0.3, true)).toBe("hosted");
  expect(localLiveRoute(0.3, false)).toBe("local-slow");
  expect(localLiveRoute(NaN, false)).toBe("unknown");
});

test("stored rates require the same adapter", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let value = "";
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => value || null,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    },
  });
  try {
    saveLocalLiveRate("intel", 0.4);
    expect(readLocalLiveRate("intel")?.rate).toBe(0.4);
    expect(readLocalLiveRate("different")).toBeNull();
    expect(readLocalLiveRate("")).toBeNull();
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
