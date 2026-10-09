import type { AiProviderConfig } from "../types";
import { afterAll, afterEach, expect, test } from "bun:test";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";
import {
  resetDesktopContextForTests,
  LOCAL_PROVIDER_ID,
} from "./desktop-bridge";
import { setBrowserTtsCapabilityOverride } from "./browser-inference";

const {
  normalizeAiSettings,
  hasConfiguredAiProvider,
  resolveFeatureConfigForPersona,
} = await import(`./ai-client?byok-mode-test=${Date.now()}`);
const originalWindow = globalThis.window;
const releaseLock = await lockBrowserGlobalsForTestFile();
afterEach(() => {
  resetDesktopContextForTests();
  setBrowserTtsCapabilityOverride(undefined);
  if (originalWindow === undefined)
    Reflect.deleteProperty(globalThis, "window");
  else
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
});
afterAll(releaseLock);

test("desktop capability never silently re-enables a persisted OFF choice", () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search: "?platform=desktop&localAi=1&localPort=4317" },
    },
  });
  resetDesktopContextForTests();
  setBrowserTtsCapabilityOverride(null);
  const settings = normalizeAiSettings({ advancedMode: false });
  expect(
    settings.providers.some(
      (p: AiProviderConfig) => p.id === LOCAL_PROVIDER_ID,
    ),
  ).toBe(true);
  expect(settings.advancedMode).toBe(false);
  expect(hasConfiguredAiProvider(settings)).toBe(false);
  expect(
    resolveFeatureConfigForPersona(settings, "persona-feedback", {
      providerId: LOCAL_PROVIDER_ID,
      model: "local-model",
    }),
  ).toBeNull();
  const reloaded = normalizeAiSettings(JSON.parse(JSON.stringify(settings)));
  expect(reloaded.advancedMode).toBe(false);
  expect(hasConfiguredAiProvider(reloaded)).toBe(false);
  expect(hasConfiguredAiProvider({ ...reloaded, advancedMode: true })).toBe(
    true,
  );
});
