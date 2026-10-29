import {
  normalizeLanguagePreference,
  LANGUAGE_PREFERENCE_KEY,
} from "../i18n/locale";
import { setBackgroundRoomEnabled } from "./background-room";
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_WRITER_SETTINGS,
  DEFAULT_APPARATUS_SETTINGS,
  DEFAULT_ROOM_SETTINGS,
  type AiSettings,
  type AiProviderConfig,
  type WriterSettings,
  type ApparatusSettings,
  type RoomSettings,
} from "../types";
import {
  loadAiSettingsFromIdb,
  saveAiSettingsToIdb,
  loadWriterSettingsFromIdb,
  saveWriterSettingsToIdb,
  loadApparatusSettingsFromIdb,
  saveApparatusSettingsToIdb,
} from "./idb";
import {
  loadRoomSettingsLocally,
  saveRoomSettingsLocally,
} from "./convex-sync";
import {
  DEFAULT_THEME_PREFERENCE,
  readThemePreference,
  writeThemePreference,
  applyTheme,
  normalizeThemePreference,
} from "./theme";
import {
  portablePreference,
  type PreferenceKind,
  type PreferenceValue,
} from "./account-preferences-contract";
import { createPreferenceSync } from "./preference-sync-engine";
import {
  readJournal,
  writeJournal,
  preferenceOwner,
  setPreferenceOwner,
  PREFERENCES_CHANGED,
  PREFERENCES_APPLIED,
  PREFERENCES_STORAGE_FAILED,
} from "./preference-outbox";
import { reportApplicationError } from "./application-diagnostics";

/** This device's preferences in their synced form: API keys are stripped. */
export async function readPortablePreferences(): Promise<
  Partial<Record<PreferenceKind, PreferenceValue>>
> {
  const result: Partial<Record<PreferenceKind, PreferenceValue>> = {};
  for (const kind of [
    "language",
    "writer",
    "ai",
    "apparatus",
    "room",
    "appearance",
  ] as const) {
    try {
      result[kind] = await readLocal(kind);
    } catch {
      // A preference that fails its schema is left out rather than raw.
    }
  }
  return result;
}

async function readLocal(kind: PreferenceKind): Promise<PreferenceValue> {
  if (kind === "language")
    return {
      preference: normalizeLanguagePreference(
        document.documentElement.dataset.twyneLanguagePreference,
      ),
    };
  const value =
    kind === "writer"
      ? await loadWriterSettingsFromIdb()
      : kind === "ai"
        ? ((await loadAiSettingsFromIdb()) ?? DEFAULT_AI_SETTINGS)
        : kind === "apparatus"
          ? await loadApparatusSettingsFromIdb()
          : kind === "room"
            ? await loadRoomSettingsLocally()
            : readThemePreference();
  return portablePreference(kind, value);
}
async function applyLocal(kind: PreferenceKind, value: PreferenceValue) {
  if (kind === "language") {
    const preference = normalizeLanguagePreference(value.preference);
    document.documentElement.dataset.twyneLanguagePreference = preference;
    try {
      localStorage.setItem(LANGUAGE_PREFERENCE_KEY, preference);
    } catch {
      /* cookie remains */
    }
    document.cookie = `${LANGUAGE_PREFERENCE_KEY}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }
  if (kind === "writer")
    await saveWriterSettingsToIdb(value as unknown as WriterSettings, false);
  if (kind === "apparatus") {
    const local = await loadApparatusSettingsFromIdb();
    await saveApparatusSettingsToIdb(
      { ...local, ...value } as ApparatusSettings,
      false,
    );
  }
  if (kind === "ai") {
    const local = (await loadAiSettingsFromIdb()) ?? DEFAULT_AI_SETTINGS;
    const remote = value as unknown as AiSettings;
    const providers = remote.providers.map((provider) => {
      const device = local.providers.find(
        (p) => p.id === provider.id && p.type === provider.type,
      );
      return {
        ...device,
        ...provider,
        apiKey: device?.apiKey ?? "",
        baseUrl: device?.baseUrl,
      } as AiProviderConfig;
    });
    await saveAiSettingsToIdb(
      {
        ...local,
        ...remote,
        providers,
        judgement: remote.judgement
          ? { ...local.judgement, ...remote.judgement }
          : undefined,
      },
      false,
    );
  }
  if (kind === "room") {
    await saveRoomSettingsLocally(value as unknown as RoomSettings, false);
    setBackgroundRoomEnabled(value.backgroundRoom !== false);
  }
  if (kind === "appearance") {
    const preference = normalizeThemePreference(value);
    writeThemePreference(preference, false);
    applyTheme(
      preference,
      document.documentElement,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }
  window.dispatchEvent(
    new CustomEvent(PREFERENCES_APPLIED, { detail: { kind } }),
  );
}

export function startAccountPreferences(client: ConvexClient, account: string) {
  const previousOwner = preferenceOwner();
  const seed = !previousOwner || previousOwner === account;
  setPreferenceOwner(account);
  // Anonymous changes seed an empty account, but never replace an existing
  // account's preferences simply because this is a new device.
  let failed = false;
  const engine = createPreferenceSync({
    emptyValue: (kind) =>
      portablePreference(
        kind,
        {
          language: { preference: "auto" },
          writer: DEFAULT_WRITER_SETTINGS,
          ai: DEFAULT_AI_SETTINGS,
          apparatus: DEFAULT_APPARATUS_SETTINGS,
          room: DEFAULT_ROOM_SETTINGS,
          appearance: DEFAULT_THEME_PREFERENCE,
        }[kind],
      ),
    seed,
    readLocal,
    applyLocal,
    readJournal: () => readJournal(account),
    writeJournal: (journal) => writeJournal(account, journal),
    pull: () => client.query(api.preferences.list, {}),
    put: (row) =>
      client.mutation(api.preferences.put, {
        kind: row.kind,
        json: row.json,
        expectedRevision: row.revision,
      }),
    onError: (error) => {
      failed = true;
      reportApplicationError("twyne:preferences-sync", error, {
        source: "convex",
        title: "Settings sync is paused",
        dedupeKey: "preferences-sync",
      });
    },
  });
  const refresh = () => {
    failed = false;
    void engine.refresh();
  };
  const retry = setInterval(() => {
    if (failed || Object.keys(readJournal(account).pending).length) refresh();
  }, 15000);
  const stop = client.onUpdate(api.preferences.list, {}, refresh, (error) =>
    reportApplicationError("twyne:preferences-subscription", error, {
      source: "convex",
      title: "Settings sync is paused",
      dedupeKey: "preferences-sync",
    }),
  );
  const storageFailed = () =>
    reportApplicationError(
      "twyne:preferences-storage",
      new Error(
        "Settings are saved locally, but the sync queue cannot be saved. Keep this tab open until settings sync completes.",
      ),
      {
        source: "convex",
        title: "Settings sync needs storage",
        dedupeKey: "preferences-storage",
      },
    );
  window.addEventListener(PREFERENCES_STORAGE_FAILED, storageFailed);
  window.addEventListener(PREFERENCES_CHANGED, refresh);
  window.addEventListener("online", refresh);
  const onVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", onVisible);
  refresh();
  return () => {
    engine.dispose();
    clearInterval(retry);
    stop();
    window.removeEventListener(PREFERENCES_CHANGED, refresh);
    window.removeEventListener(PREFERENCES_STORAGE_FAILED, storageFailed);
    window.removeEventListener("online", refresh);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
