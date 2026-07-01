import { afterAll, afterEach, describe, expect, test } from "bun:test";
import {
  loadAiSettingsFromIdb,
  loadApparatusSettingsFromIdb,
  loadWriterSettingsFromIdb,
  saveAiSettingsToIdb,
  saveApparatusSettingsToIdb,
  saveWriterSettingsToIdb,
} from "./idb";
import { lockBrowserGlobalsForTestFile } from "./test-browser-globals-lock";
import type { AiSettings } from "../types";

type WindowLike = {
  localStorage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
    clear: () => void;
  };
};

const g = globalThis as unknown as {
  window?: WindowLike;
  indexedDB?: IDBFactory;
};
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const releaseBrowserGlobalsLock = await lockBrowserGlobalsForTestFile();

const originalIndexedDb = g.indexedDB;
const localStorageStore: Record<string, string> = {};
const localStorageShim = {
  getItem: (k: string) => (k in localStorageStore ? localStorageStore[k] : null),
  setItem: (k: string, v: string) => {
    localStorageStore[k] = v;
  },
  removeItem: (k: string) => {
    delete localStorageStore[k];
  },
  clear: () => {
    for (const k of Object.keys(localStorageStore)) delete localStorageStore[k];
  },
};
const windowShim = {
  localStorage: localStorageShim,
};

function installStorage(): void {
  localStorageShim.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: windowShim,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorageShim,
  });
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

function installExplodingIndexedDb(): void {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    writable: true,
    value: {
      open: () => {
        throw new Error("IndexedDB should not be read before localStorage");
      },
    } as unknown as IDBFactory,
  });
}

afterEach(() => {
  try {
    g.window?.localStorage.clear();
  } catch {
    /* ignore */
  }
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  }
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, "localStorage");
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: originalLocalStorage,
    });
  }
  if (originalIndexedDb === undefined) {
    Reflect.deleteProperty(globalThis, "indexedDB");
  } else {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
  }
});

afterAll(() => {
  releaseBrowserGlobalsLock();
});

describe.serial("idb preference localStorage fallback", () => {
  test("persists, prefers, and normalizes localStorage-backed preferences", async () => {
    installStorage();
    await saveWriterSettingsToIdb({ interviewStyle: "conversational" });
    expect(await loadWriterSettingsFromIdb()).toEqual({
      interviewStyle: "conversational",
    });

    installStorage();
    await saveApparatusSettingsToIdb({
      defaultCitationStyle: "apa",
      aiEnhanceCitations: true,
      flagMissingSources: true,
      researchProvider: "tinyfish",
      tinyFishApiKey: "tf-test",
      tinyFishMaxResults: 12,
      mcpEndpointUrl: "",
      mcpToolName: "search",
      mcpBearerToken: "",
    });
    expect(await loadApparatusSettingsFromIdb()).toEqual({
      defaultCitationStyle: "apa",
      aiEnhanceCitations: true,
      flagMissingSources: true,
      researchProvider: "tinyfish",
      tinyFishApiKey: "tf-test",
      tinyFishMaxResults: 12,
      mcpEndpointUrl: "",
      mcpToolName: "search",
      mcpBearerToken: "",
    });

    installStorage();
    const savedAiSettings: AiSettings = {
      advancedMode: true,
      providers: [
        {
          id: "p1",
          name: "OpenAI",
          type: "openai",
          apiKey: "sk-test",
          defaultModel: "gpt-5.5-mini",
          availableModels: ["gpt-5.5-mini"],
        },
      ],
      defaultProviderId: "p1",
      perFeature: {},
      showProviderTags: true,
    };
    await saveAiSettingsToIdb(savedAiSettings);
    expect(await loadAiSettingsFromIdb()).toEqual(savedAiSettings);

    installStorage();
    installExplodingIndexedDb();
    const localAiSettings: AiSettings = {
      advancedMode: true,
      providers: [
        {
          id: "p-local",
          name: "OpenRouter",
          type: "openrouter",
          apiKey: "sk-local",
          baseUrl: "https://openrouter.ai/api/v1",
          defaultModel: "discovered-model",
          availableModels: ["discovered-model"],
        },
      ],
      defaultProviderId: "p-local",
      perFeature: {},
      showProviderTags: true,
    };
    g.window!.localStorage.setItem(
      "twyne.ai-settings.current",
      JSON.stringify(localAiSettings),
    );
    expect(await loadAiSettingsFromIdb()).toEqual(localAiSettings);

    installStorage();
    installExplodingIndexedDb();
    g.window!.localStorage.setItem(
      "twyne.writer-settings.current",
      JSON.stringify({ interviewStyle: "conversational" }),
    );
    g.window!.localStorage.setItem(
      "twyne.apparatus-settings.current",
      JSON.stringify({
        defaultCitationStyle: "chicago",
        aiEnhanceCitations: true,
        flagMissingSources: true,
        researchProvider: "web-mcp",
        tinyFishApiKey: "tf-local",
        tinyFishMaxResults: 99,
        mcpEndpointUrl: "http://127.0.0.1:8787/mcp",
        mcpToolName: "web_search",
        mcpBearerToken: "mcp-local",
      }),
    );
    expect(await loadWriterSettingsFromIdb()).toEqual({
      interviewStyle: "conversational",
    });
    expect(await loadApparatusSettingsFromIdb()).toEqual({
      defaultCitationStyle: "chicago",
      aiEnhanceCitations: true,
      flagMissingSources: true,
      researchProvider: "web-mcp",
      tinyFishApiKey: "tf-local",
      tinyFishMaxResults: 20,
      mcpEndpointUrl: "http://127.0.0.1:8787/mcp",
      mcpToolName: "web_search",
      mcpBearerToken: "mcp-local",
    });

    installStorage();
    g.window!.localStorage.setItem("twyne.writer-settings.current", "{nope");
    g.window!.localStorage.setItem("twyne.apparatus-settings.current", "{nope");
    expect(await loadWriterSettingsFromIdb()).toEqual({
      interviewStyle: "form",
    });
    expect(await loadApparatusSettingsFromIdb()).toEqual({
      defaultCitationStyle: "mla",
      aiEnhanceCitations: false,
      flagMissingSources: false,
      researchProvider: "hosted",
      tinyFishApiKey: "",
      tinyFishMaxResults: 8,
      mcpEndpointUrl: "",
      mcpToolName: "search",
      mcpBearerToken: "",
    });

    installStorage();
    g.window!.localStorage.setItem(
      "twyne.apparatus-settings.current",
      JSON.stringify({
        defaultCitationStyle: "apa",
        aiEnhanceCitations: true,
        flagMissingSources: false,
      }),
    );
    expect(await loadApparatusSettingsFromIdb()).toEqual({
      defaultCitationStyle: "apa",
      aiEnhanceCitations: true,
      flagMissingSources: false,
      researchProvider: "hosted",
      tinyFishApiKey: "",
      tinyFishMaxResults: 8,
      mcpEndpointUrl: "",
      mcpToolName: "search",
      mcpBearerToken: "",
    });
  });
});
