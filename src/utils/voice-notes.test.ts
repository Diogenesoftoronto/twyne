import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const originalWindow = globalThis.window;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();

let voiceNotes: typeof import("./voice-notes");

/**
 * The recorder is mostly browser plumbing, so what's worth pinning here is the
 * capability detection and the guards: a browser that can't record must be
 * detected rather than throwing mid-flow, and transcription with nothing
 * configured must produce a recoverable error rather than a silent failure.
 */

class FakeMediaRecorder {
  static supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type);
  }
  state = "inactive";
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
}

function installBrowserGlobals(overrides: Record<string, unknown> = {}) {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  };
  (globalThis as Record<string, unknown>).localStorage = storage;
  (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;
  (globalThis as Record<string, unknown>).navigator = {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
  };
  Object.assign(globalThis as Record<string, unknown>, overrides);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      localStorage: storage,
    },
  });
}

beforeEach(async () => {
  installBrowserGlobals();
  voiceNotes = await import(`./voice-notes?t=${Date.now()}${Math.random()}`);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).MediaRecorder;
  delete (globalThis as Record<string, unknown>).navigator;
});

afterAll(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
  releaseBrowserGlobalsLock();
});

describe("canRecord", () => {
  test("is true when the browser has both pieces", () => {
    expect(voiceNotes.canRecord()).toBe(true);
  });

  test("is false without MediaRecorder", () => {
    delete (globalThis as Record<string, unknown>).MediaRecorder;
    expect(voiceNotes.canRecord()).toBe(false);
  });

  test("is false without microphone access", () => {
    (globalThis as Record<string, unknown>).navigator = {};
    expect(voiceNotes.canRecord()).toBe(false);
  });
});

describe("pickRecordingMimeType", () => {
  test("prefers Opus in WebM", () => {
    expect(voiceNotes.pickRecordingMimeType()).toBe("audio/webm;codecs=opus");
  });

  test("falls through to whatever the browser does support", () => {
    FakeMediaRecorder.supported = new Set(["audio/mp4"]);
    expect(voiceNotes.pickRecordingMimeType()).toBe("audio/mp4");
    FakeMediaRecorder.supported = new Set([
      "audio/webm;codecs=opus",
      "audio/webm",
    ]);
  });

  test("returns empty when nothing is supported, letting the recorder choose", () => {
    FakeMediaRecorder.supported = new Set();
    expect(voiceNotes.pickRecordingMimeType()).toBe("");
    FakeMediaRecorder.supported = new Set([
      "audio/webm;codecs=opus",
      "audio/webm",
    ]);
  });
});

describe("startRecording", () => {
  test("raises a structured error rather than throwing raw when unsupported", async () => {
    delete (globalThis as Record<string, unknown>).MediaRecorder;
    const err = await voiceNotes.startRecording().catch((e) => e);
    expect(err.code).toBe("CONFIGURATION_ERROR");
    // Metadata values are redacted on the way out, so the code is the
    // contract the UI can rely on.
    expect(err.recovery.canRetry).toBe(false);
  });

  /**
   * A refused microphone permission is a decision, not a defect. It has to
   * arrive as a normalised AppError the UI can explain.
   */
  test("normalises a refused microphone permission", async () => {
    (globalThis as Record<string, unknown>).navigator = {
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    };
    const err = await voiceNotes.startRecording().catch((e) => e);
    expect(err).toBeTruthy();
    expect(typeof err.code).toBe("string");
  });
});

describe("transcribeRecording", () => {
  test("reports a recoverable configuration error when nothing is set up", async () => {
    const err = await voiceNotes
      .transcribeRecording({
        blob: new Blob(["x"], { type: "audio/webm" }),
        mimeType: "audio/webm",
        client: null,
      })
      .catch((e) => e);
    expect(err.code).toBe("CONFIGURATION_ERROR");
    expect(err.recovery.action).toBe("choose-provider");
  });
});

describe("formatDuration", () => {
  test("renders as minutes and zero-padded seconds", () => {
    expect(voiceNotes.formatDuration(0)).toBe("0:00");
    expect(voiceNotes.formatDuration(9_000)).toBe("0:09");
    expect(voiceNotes.formatDuration(65_000)).toBe("1:05");
    expect(voiceNotes.formatDuration(600_000)).toBe("10:00");
  });
});

describe("the recording cap", () => {
  test("is long enough for a real thought and short enough to bound cost", () => {
    expect(voiceNotes.MAX_RECORDING_MS).toBeGreaterThanOrEqual(60_000);
    expect(voiceNotes.MAX_RECORDING_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});
