import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  isDesktopLocalAiAvailable,
  localAiBaseUrl,
  resetDesktopContextForTests,
} from "./desktop-bridge";
import { FALLBACK_FEATURES, setRuntimeFeatures } from "./feature-flags";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";

const originalWindow = globalThis.window;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();

function setWindowSearch(search: string): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        search,
      },
    },
  });
  resetDesktopContextForTests();
}

afterEach(() => {
  resetDesktopContextForTests();
  setRuntimeFeatures(FALLBACK_FEATURES);
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  }
});

afterAll(() => {
  releaseBrowserGlobalsLock();
});

describe("desktop bridge", () => {
  test("uses the desktop shell params even before runtime flags load", () => {
    setRuntimeFeatures({ pricing: false, localAi: false });
    setWindowSearch("?platform=desktop&localAi=1&localPort=4317");

    expect(isDesktopLocalAiAvailable()).toBe(true);
    expect(localAiBaseUrl()).toBe("http://127.0.0.1:4317/v1");
  });

  test("stays inert when the desktop shell did not advertise a local port", () => {
    setWindowSearch("?platform=desktop&localAi=1");

    expect(isDesktopLocalAiAvailable()).toBe(false);
    expect(localAiBaseUrl()).toBeNull();
  });
});
