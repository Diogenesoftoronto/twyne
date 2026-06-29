import { afterEach, describe, expect, test } from "bun:test";
import {
  loadAiSettingsFromIdb,
  loadApparatusSettingsFromIdb,
  loadWriterSettingsFromIdb,
  saveAiSettingsToIdb,
  saveApparatusSettingsToIdb,
  saveWriterSettingsToIdb,
} from "./idb";
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

const originalIndexedDb = g.indexedDB;

function installStorage(): void {
  const store: Record<string, string> = {};
  g.window = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = v;
      },
      removeItem: (k) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  };
  g.indexedDB = undefined;
}

function installExplodingIndexedDb(): void {
  g.indexedDB = {
    open: () => {
      throw new Error("IndexedDB should not be read before localStorage");
    },
  } as unknown as IDBFactory;
}

afterEach(() => {
  try {
    g.window?.localStorage.clear();
  } catch {
    /* ignore */
  }
  g.window = undefined;
  g.indexedDB = originalIndexedDb;
});

describe("idb preference localStorage fallback", () => {
  test("saves and loads writer settings without IndexedDB", async () => {
    installStorage();

    await saveWriterSettingsToIdb({ interviewStyle: "conversational" });

    expect(await loadWriterSettingsFromIdb()).toEqual({
      interviewStyle: "conversational",
    });
  });

  test("saves and loads apparatus settings without IndexedDB", async () => {
    installStorage();

    await saveApparatusSettingsToIdb({
      defaultCitationStyle: "apa",
      aiEnhanceCitations: true,
      flagMissingSources: true,
    });

    expect(await loadApparatusSettingsFromIdb()).toEqual({
      defaultCitationStyle: "apa",
      aiEnhanceCitations: true,
      flagMissingSources: true,
    });
  });

  test("keeps AI settings in localStorage when IndexedDB is unavailable", async () => {
    installStorage();
    const settings: AiSettings = {
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

    await saveAiSettingsToIdb(settings);

    expect(await loadAiSettingsFromIdb()).toEqual(settings);
  });

  test("prefers current localStorage AI settings over IndexedDB", async () => {
    installStorage();
    installExplodingIndexedDb();
    const settings: AiSettings = {
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
      JSON.stringify(settings),
    );

    expect(await loadAiSettingsFromIdb()).toEqual(settings);
  });

  test("prefers current localStorage writer and apparatus settings over IndexedDB", async () => {
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
      }),
    );

    expect(await loadWriterSettingsFromIdb()).toEqual({
      interviewStyle: "conversational",
    });
    expect(await loadApparatusSettingsFromIdb()).toEqual({
      defaultCitationStyle: "chicago",
      aiEnhanceCitations: true,
      flagMissingSources: true,
    });
  });

  test("falls back to defaults for corrupted preference JSON", async () => {
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
    });
  });
});
