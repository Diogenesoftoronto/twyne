import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { ApplicationNotice } from "../../components/ui/application-notice";
import { SearchableModelSelect } from "../../components/ui/searchable-model-select";
import { ThemedDialog } from "../../components/ui/themed-dialog";
import { NumericStepper } from "../../components/ui/numeric-stepper";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { signOut } from "../../utils/auth-client";
import { clearConvexSyncContext } from "../../utils/convex-sync";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
  AiSettings,
  AiProviderConfig,
  AiFeature,
  AiFeatureOverride,
  AiModelModalities,
  AiReasoningEffort,
  AiModelReasoningSetting,
  AiModelReasoningOption,
  ApparatusSettings,
  McpServerConfig,
  SearchBackendConfig,
  SearchBackendId,
  WriterSettings,
  WriterProfile,
} from "../../types";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_APPARATUS_SETTINGS,
  DEFAULT_MCP_SERVER,
  PROVIDER_METAS,
} from "../../types";
import {
  SEARCH_BACKEND_IDS,
  SEARCH_BACKENDS,
} from "../../utils/research-backends";
import type { ConvexClient } from "convex/browser";
import { connectMcpServer, type McpServerHandle } from "../../utils/mcp-client";
import { pickSearchTool } from "../../utils/mcp-research";
import {
  loadAiSettingsFromIdb,
  saveAiSettingsToIdb,
  loadWriterSettingsFromIdb,
  saveWriterSettingsToIdb,
  loadApparatusSettingsFromIdb,
  saveApparatusSettingsToIdb,
} from "../../utils/idb";
import {
  discoverProviderModels,
  providerSupportsFeature,
  testProvider,
  resolveFeatureConfig,
  normalizeAiSettings,
  stripManagedDesktopLocalProvider,
  stripManagedSupertonicProvider,
} from "../../utils/ai-client";
import { supportsReasoningEffort } from "../../utils/reasoning-effort";
import { LOCAL_PROVIDER_ID } from "../../utils/desktop-bridge";
import { SiteSelect } from "../../components/ui/site-select";
import {
  BROWSER_TTS_BUNDLE_BYTES,
  BROWSER_TTS_MANIFEST_FILES,
  BROWSER_TTS_PROVIDER_ID,
} from "../../utils/browser-inference";
import {
  modelDownloadState,
  onModelDownload,
  type ModelDownloadState,
} from "../../utils/models-cache";
import { useFeatureFlags } from "../../utils/posthog-context";
import { captureProductEvent } from "../../utils/product-analytics";
import type { AppError } from "../../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PRESETS,
  THEME_SYNC_STAMP_KEY,
  THEME_TOKENS,
  WCAG_AA_CONTRAST,
  applyTheme,
  getThemePreset,
  normalizeThemePreference,
  readThemePreference,
  resolveThemePreset,
  resolvedThemeTokens,
  themeContrast,
  writeThemePreference,
  type ThemePreference,
  type ThemePresetId,
  type ThemeTokenId,
} from "../../utils/theme";
import {
  findModelsDevProvider,
  loadModelsDevCatalog,
  modelsDevModelsForFeature,
  searchModelsDevProviders,
  type ModelsDevModel,
  type ModelsDevProvider,
} from "../../utils/models-dev";

/** A compact, human bytes label for progress reads. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/* ── Types ──────────────────────────────────────────────────────── */

interface SettingsStore {
  settings: AiSettings;
  loaded: boolean;
  saving: boolean;
  toast: string | null;
  /* provider form */
  showAddProvider: boolean;
  newProviderType: string;
  newProviderName: string;
  newProviderKey: string;
  newProviderBaseUrl: string;
  newProviderApiMode: "chat" | "responses";
  providerSearch: string;
  modelsDevProviders: ModelsDevProvider[];
  modelsDevError: AppError | null;
  modelsDevProviderId: string | null;
  testingProviderId: string | null;
  testResults: Record<
    string,
    | {
        ok: boolean;
        latencyMs: number;
        error?: AppError;
        modelCount?: number;
        models?: string[];
      }
    | undefined
  >;
  /**
   * Provider awaiting a second click before it is removed. Deleting a
   * provider throws away a stored API key, so the button asks once.
   */
  removingProviderId: string | null;
  discoveringProviderId: string | null;
  providerModelErrors: Record<string, AppError | undefined>;
  /* browser voice download */
  supertonicStatus: ModelDownloadState | null;
  supertonicDownloading: boolean;
  supertonicError: AppError | null;
  /* editing */
  editingProviderId: string | null;
  editKey: string;
  /* per-feature overrides open */
  openFeature: AiFeature | null;
  /* writer preferences */
  writerStyle: WriterSettings["interviewStyle"];
  writerProfile: WriterProfile;
  writerToast: string | null;
  /* apparatus */
  defaultCitationStyle: ApparatusSettings["defaultCitationStyle"];
  aiEnhanceCitations: boolean;
  flagMissingSources: boolean;
  autoInsertFootnotes: boolean;
  researchProvider: ApparatusSettings["researchProvider"];
  searchBackend: SearchBackendConfig;
  maxResults: number;
  mcpServers: McpServerConfig[];
  /** Per-server connection report from "Test", keyed by server id. */
  mcpProbes: Record<string, string>;
  mcpProbeBusy: string | null;
  /* account deletion (danger zone) */
  deletingAccount: boolean;
  accountToast: string | null;
  accountError: AppError | null;
  showResetDialog: boolean;
  showDeleteDialog: boolean;
  deleteConfirmText: string;
  deleteDialogError: string | null;
  /* writer handle (public identity) */
  handleLoaded: boolean;
  handle: string | null;
  handleDraft: string;
  handleBusy: boolean;
  handleError: AppError | string | null;
  handleToast: string | null;
  handleCheck: {
    available: boolean;
    handle?: string;
    error?: AppError;
  } | null;
  handleCheckBusy: boolean;
  profileDisplayName: string;
  profileBio: string;
  profileBusy: boolean;
  profileToast: string | null;
  /** Resolved URL of the saved profile picture, or null if none. */
  profileAvatarUrl: string | null;
  /** True while an avatar upload/clear round-trip is in flight. */
  profileAvatarBusy: boolean;
  /* CLI / MCP access */
  integrationTokensLoaded: boolean;
  integrationTokens: Array<{
    id: Id<"integrationTokens">;
    name: string;
    prefix: string;
    createdAt: number;
  }>;
  integrationTokenName: string;
  integrationTokenBusy: boolean;
  integrationTokenError: AppError | null;
  newIntegrationToken: string | null;
  integrationTokenCopied: boolean;
  /* appearance */
  theme: ThemePreference;
  themeCustomOpen: boolean;
  themeToast: string | null;
}

const FEATURE_LABELS: Record<AiFeature, string> = {
  "persona-feedback": "Read My Draft (room notes)",
  "persona-reply": "Reply Thread",
  "persona-rewrite": "Edit My Draft (rewrites)",
  "persona-analysis": "Full Analysis (per editor)",
  "room-synthesis": "Room Synthesis",
  "rubric-judge": "Galley Proof",
  "rubric-review": "Full Review (narrative)",
  "voice-narration": "Voice Narration",
  "voice-transcription": "Voice Transcription",
  "comment-reply": "Ask Editor (Notes)",
  "citation-format": "Citation Format",
  "source-summarize": "Source Summarize",
  "source-detect-missing": "Missing Source Detection",
  "research-web-search": "Apparatus Web Search",
  "research-extract": "Auto-Research (claim finding)",
  "interview-turn": "Conversational Interview",
  "dossier-check": "Read My Draft",
};

const FEATURE_DESCRIPTIONS: Record<AiFeature, string> = {
  "persona-feedback": "All five editors read your draft at once.",
  "persona-reply": "A single editor responds in a threaded conversation.",
  "persona-rewrite": "Editors propose specific text replacements.",
  "persona-analysis":
    "Each editor writes a full-page analysis of the whole document, in their own voice.",
  "room-synthesis":
    "The room combines the five analyses into a single editorial verdict.",
  "rubric-judge": "Five judges score the draft, then the rubric combines.",
  "rubric-review":
    "A full-page narrative review that explains the grade and a revision plan.",
  "voice-narration":
    "Turns selected prose into spoken audio. BYOK uses your speech-capable provider; Pro can use Twyne-hosted voice.",
  "voice-transcription":
    "Turns your voice notes and spoken interview answers into text. BYOK uses your speech-capable provider; Pro can use Twyne-hosted transcription.",
  "comment-reply": "Ask an editor to weigh in on a margin note.",
  "citation-format": "Auto-format detected citations in your chosen style.",
  "source-summarize": "AI summarizes saved sources for your bibliography.",
  "source-detect-missing":
    "AI detects claims in your draft that need citations.",
  "research-web-search":
    "The Apparatus asks a model endpoint with web-search support for source candidates.",
  "research-extract":
    "The Apparatus reads your draft and decides which claims, quotes, films, and figures need a source, then hunts each one down automatically.",
  "interview-turn":
    "The room interviews you, one question at a time, and synthesises a dossier from your answers.",
  "dossier-check":
    "Cross-references the dossier against the current draft and surfaces where the draft has outgrown the brief.",
};

function providerMetaFor(type: AiProviderConfig["type"]) {
  return PROVIDER_METAS.find((m) => m.type === type);
}

function providerMetaForForm(type: string) {
  return PROVIDER_METAS.find((m) => m.type === type);
}

function isTinkerProvider(provider: AiProviderConfig): boolean {
  return (
    provider.baseUrl?.toLowerCase().includes("tinker.thinkingmachines.dev") ??
    false
  );
}

/**
 * Which models expose a thinking control in the live catalog.
 *
 * The catalog is the authority, not the provider type: the same OpenAI key
 * reaches both a reasoning model and a plain one, and a thinking parameter
 * sent to the plain one is a hard API error. So the dial is offered only for
 * the model the provider actually defaults to, and only when models.dev marks
 * that model as reasoning. Returns null when there is nothing safe to offer —
 * including when the catalog has not loaded, since an unknown model is not a
 * known-reasoning one.
 */
function reasoningModelsFor(
  provider: AiProviderConfig,
  catalog: ModelsDevProvider[],
): ModelsDevModel[] {
  if (!supportsReasoningEffort(provider.type)) return [];
  const model = catalogModelsForProvider(provider, catalog).find(
    (candidate) => candidate.id === provider.defaultModel,
  );
  if (!model) return [];
  const reasoningOptions =
    model.reasoningOptions ?? provider.modelReasoningOptions?.[model.id];
  return reasoningOptions?.length ? [{ ...model, reasoningOptions }] : [];
}

function supportsOpenAiApiMode(provider: AiProviderConfig): boolean {
  return (
    provider.type === "openai" ||
    provider.type === "openai-compatible" ||
    provider.type === "deepseek" ||
    provider.type === "openrouter" ||
    provider.type === "ollama" ||
    provider.type === "zai" ||
    provider.type === "minimax" ||
    provider.type === "litert"
  );
}

function catalogModelModalities(
  provider: ModelsDevProvider | undefined,
): Record<string, AiModelModalities> {
  return Object.fromEntries(
    (provider?.models ?? [])
      .filter((model) => model.modalities)
      .map((model) => [model.id, model.modalities as AiModelModalities]),
  );
}

function catalogModelReasoningOptions(
  provider: ModelsDevProvider | undefined,
): Record<string, AiModelReasoningOption[]> {
  return Object.fromEntries(
    (provider?.models ?? [])
      .filter((model) => model.reasoningOptions?.length)
      .map((model) => [model.id, model.reasoningOptions ?? []]),
  );
}

function providerModelOptions(provider: AiProviderConfig): string[] {
  return Array.from(
    new Set(
      [
        ...(provider.availableModels ?? []),
        provider.defaultModel,
        ...(providerMetaFor(provider.type)?.defaultModels ?? []),
      ].filter(Boolean),
    ),
  );
}

function catalogModelsForProvider(
  provider: AiProviderConfig,
  catalog: ModelsDevProvider[],
  feature: AiFeature | "language" = "language",
): ModelsDevModel[] {
  const catalogProvider = provider.modelsDevId
    ? catalog.find((entry) => entry.id === provider.modelsDevId)
    : findModelsDevProvider(catalog, provider);
  const catalogModels = modelsDevModelsForFeature(
    catalogProvider?.models ?? [],
    feature === "voice-narration" || feature === "voice-transcription"
      ? feature
      : "language",
  );
  const known = new Map(catalogModels.map((model) => [model.id, model]));
  for (const id of providerModelOptions(provider)) {
    if (!known.has(id)) known.set(id, { id, name: id });
  }
  return Array.from(known.values());
}

function buildApparatusSettings(store: SettingsStore): ApparatusSettings {
  return {
    defaultCitationStyle: store.defaultCitationStyle,
    aiEnhanceCitations: store.aiEnhanceCitations,
    flagMissingSources: store.flagMissingSources,
    autoInsertFootnotes: store.autoInsertFootnotes,
    researchProvider: store.researchProvider,
    searchBackend: { ...store.searchBackend },
    maxResults: store.maxResults,
    mcpServers: store.mcpServers.map((s) => ({ ...s })),
  };
}

/**
 * Connect to one server and describe what came back.
 *
 * Discovery is the whole point of the Test button: an MCP server's tool names
 * are not guessable, and the writer needs to see them to know whether to name
 * one as the search tool. It also reports the route taken, because "this only
 * works relayed" explains why it needs a sign-in.
 */
async function probeMcpServer(
  config: McpServerConfig,
  convex: ConvexClient | null,
): Promise<string> {
  if (!config.url.trim()) return "Add a URL first.";
  let handle: McpServerHandle | null = null;
  try {
    handle = await connectMcpServer(config, convex);
    const lines: string[] = [];
    lines.push(
      `Connected${handle.serverName ? ` to ${handle.serverName}` : ""} (${
        handle.route === "relay" ? "relayed through Twyne" : "direct"
      }).`,
    );
    lines.push(
      handle.tools.length
        ? `Tools: ${handle.tools.map((t) => t.name).join(", ")}`
        : "No tools exposed.",
    );
    const chosen = pickSearchTool(handle);
    if (chosen && !config.searchToolName.trim()) {
      lines.push(`Twyne would search with "${chosen.name}".`);
    }
    lines.push(
      handle.resources.length
        ? `Documents: ${handle.resources.length}`
        : "No documents exposed.",
    );
    return lines.join("\n");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await handle?.close();
  }
}

/* ── Component ──────────────────────────────────────────────────── */

export default component$(() => {
  const featureFlags = useFeatureFlags();
  const convexClientSig = useConvexClient();
  const auth = useAuth();
  const integrationApiUrl = import.meta.env.VITE_CONVEX_SITE_URL
    ? `${String(import.meta.env.VITE_CONVEX_SITE_URL).replace(/\/$/, "")}/api/integrations/v1`
    : "";
  const store = useStore<SettingsStore>({
    settings: DEFAULT_AI_SETTINGS,
    loaded: false,
    saving: false,
    toast: null,
    showAddProvider: false,
    newProviderType: "openai",
    newProviderName: "",
    newProviderKey: "",
    newProviderBaseUrl: "",
    newProviderApiMode: "chat",
    providerSearch: "",
    modelsDevProviders: [],
    modelsDevError: null,
    modelsDevProviderId: null,
    testingProviderId: null,
    testResults: {},
    removingProviderId: null,
    discoveringProviderId: null,
    providerModelErrors: {},
    supertonicStatus: null,
    supertonicDownloading: false,
    supertonicError: null,
    editingProviderId: null,
    editKey: "",
    openFeature: null,
    defaultCitationStyle: DEFAULT_APPARATUS_SETTINGS.defaultCitationStyle,
    aiEnhanceCitations: DEFAULT_APPARATUS_SETTINGS.aiEnhanceCitations,
    flagMissingSources: DEFAULT_APPARATUS_SETTINGS.flagMissingSources,
    autoInsertFootnotes: DEFAULT_APPARATUS_SETTINGS.autoInsertFootnotes,
    researchProvider: DEFAULT_APPARATUS_SETTINGS.researchProvider,
    searchBackend: { ...DEFAULT_APPARATUS_SETTINGS.searchBackend },
    maxResults: DEFAULT_APPARATUS_SETTINGS.maxResults,
    mcpServers: [],
    mcpProbes: {},
    mcpProbeBusy: null,
    writerStyle: "form",
    writerProfile: {
      displayName: "",
      personalFacts: "",
      feedbackStyle: "balanced",
      feedbackNotes: "",
    },
    writerToast: null,
    deletingAccount: false,
    accountToast: null,
    accountError: null,
    showResetDialog: false,
    showDeleteDialog: false,
    deleteConfirmText: "",
    deleteDialogError: null,
    handleLoaded: false,
    handle: null,
    handleDraft: "",
    handleBusy: false,
    handleError: null,
    handleToast: null,
    handleCheck: null,
    handleCheckBusy: false,
    profileDisplayName: "",
    profileBio: "",
    profileBusy: false,
    profileToast: null,
    profileAvatarUrl: null,
    profileAvatarBusy: false,
    integrationTokensLoaded: false,
    integrationTokens: [],
    integrationTokenName: "",
    integrationTokenBusy: false,
    integrationTokenError: null,
    newIntegrationToken: null,
    integrationTokenCopied: false,
    theme: { ...DEFAULT_THEME_PREFERENCE },
    themeCustomOpen: false,
    themeToast: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const [raw, writer, apparatus, catalog] = await Promise.all([
      loadAiSettingsFromIdb(),
      loadWriterSettingsFromIdb(),
      loadApparatusSettingsFromIdb(),
      loadModelsDevCatalog().catch((error) => {
        store.modelsDevError = normalizeApplicationError(error, {
          source: "fetch",
          metadata: { operation: "load-models-dev-catalog" },
        });
        return [] as ModelsDevProvider[];
      }),
    ]);
    const normalized = normalizeAiSettings(raw);
    store.settings = {
      ...normalized,
      providers: normalized.providers.map((provider) => {
        const catalogProvider = findModelsDevProvider(catalog, provider);
        const catalogModels = modelsDevModelsForFeature(
          catalogProvider?.models ?? [],
          "language",
        ).map((model) => model.id);
        return {
          ...provider,
          modelsDevId: catalogProvider?.id ?? provider.modelsDevId,
          modelModalities: {
            ...provider.modelModalities,
            ...catalogModelModalities(catalogProvider),
          },
          modelReasoningOptions: {
            ...provider.modelReasoningOptions,
            ...catalogModelReasoningOptions(catalogProvider),
          },
          availableModels: Array.from(
            new Set([...catalogModels, ...providerModelOptions(provider)]),
          ),
        };
      }),
    };
    store.writerStyle = writer.interviewStyle;
    store.writerProfile = writer.profile;
    store.defaultCitationStyle = apparatus.defaultCitationStyle;
    store.aiEnhanceCitations = apparatus.aiEnhanceCitations;
    store.flagMissingSources = apparatus.flagMissingSources;
    store.autoInsertFootnotes = apparatus.autoInsertFootnotes;
    store.researchProvider = apparatus.researchProvider;
    store.searchBackend = { ...apparatus.searchBackend };
    store.maxResults = apparatus.maxResults;
    store.mcpServers = apparatus.mcpServers.map((s) => ({ ...s }));
    store.modelsDevProviders = catalog;
    store.theme = readThemePreference();
    store.themeCustomOpen = Boolean(store.theme.custom);
    store.loaded = true;

    // Reconcile with the account afterwards, never before: the bootstrap
    // script already painted from localStorage, and a signed-in device that
    // has since been re-themed locally should not be overwritten by a stale
    // remote record. Newer wins.
    const client =
      auth.value.provider === "convex" && auth.value.user
        ? convexClientSig.value
        : null;
    if (!client) return;
    try {
      const remote = await client.query(api.sync.getAppearance, {});
      if (!remote) return;
      const localStamp = Number(
        localStorage.getItem(THEME_SYNC_STAMP_KEY) ?? 0,
      );
      if (remote.updatedAt <= localStamp) return;
      const preference = normalizeThemePreference({
        preset: remote.preset,
        custom: remote.custom,
      });
      store.theme = preference;
      store.themeCustomOpen = Boolean(preference.custom);
      writeThemePreference(preference);
      localStorage.setItem(THEME_SYNC_STAMP_KEY, String(remote.updatedAt));
      applyTheme(
        preference,
        document.documentElement,
        window.matchMedia("(prefers-color-scheme: dark)").matches,
      );
    } catch {
      /* the local palette stands. */
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => featureFlags.value.loaded);
    track(() => featureFlags.value.flags.localAi);
    if (!store.loaded) return;
    store.settings = normalizeAiSettings(
      stripManagedDesktopLocalProvider(store.settings),
    );
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const unsubscribe = onModelDownload(BROWSER_TTS_PROVIDER_ID, (state) => {
      store.supertonicStatus = { ...state };
      store.supertonicDownloading = state.phase === "downloading";
      if (state.phase === "error") {
        store.supertonicError = createAppError("NETWORK_UNAVAILABLE", {
          source: "fetch",
          recovery: { action: "retry", canRetry: true },
          metadata: {
            feature: "voice-narration",
            operation: "download",
          },
        });
      } else if (store.supertonicError) {
        store.supertonicError = null;
      }
    });
    void modelDownloadState(BROWSER_TTS_PROVIDER_ID, BROWSER_TTS_MANIFEST_FILES)
      .then((state) => {
        store.supertonicStatus = { ...state };
      })
      .catch(() => {});
    cleanup(() => unsubscribe());
  });

  const downloadSupertonic = $(async () => {
    if (store.supertonicDownloading) return;
    store.supertonicDownloading = true;
    store.supertonicError = null;
    try {
      const { downloadSupertonicPack } = await import(
        "../../utils/supertonic-tts"
      );
      await downloadSupertonicPack();
      store.toast = "Voice pack downloaded";
    } catch (err) {
      store.supertonicError = normalizeApplicationError(err, {
        source: "fetch",
        metadata: {
          feature: "voice-narration",
          operation: "download",
        },
      });
    } finally {
      store.supertonicDownloading = false;
    }
  });

  const clearSupertonic = $(async () => {
    const { clearSupertonicPack } = await import("../../utils/supertonic-tts");
    await clearSupertonicPack();
    store.supertonicStatus = null;
    store.toast = "Voice pack removed";
  });

  const persist = $(async () => {
    store.saving = true;
    // Managed providers (desktop LiteRT, browser Supertonic) are re-injected
    // on load, so strip them before persisting the writer's actual choices.
    const settings = stripManagedSupertonicProvider(
      stripManagedDesktopLocalProvider(store.settings),
    );
    await saveAiSettingsToIdb(settings);
    const defaultProvider = settings.providers.find(
      (provider) => provider.id === settings.defaultProviderId,
    );
    void captureProductEvent("ai_settings_saved", {
      provider: defaultProvider?.type ?? "none",
      feature_override_count: Object.keys(settings.perFeature).length,
    });
    store.saving = false;
    store.toast = "Settings saved";
    setTimeout(() => (store.toast = null), 2000);
  });

  const setWriterStyle = $(
    async (interviewStyle: WriterSettings["interviewStyle"]) => {
      store.writerStyle = interviewStyle;
      await saveWriterSettingsToIdb({
        interviewStyle,
        profile: store.writerProfile,
      });
      store.writerToast =
        interviewStyle === "conversational"
          ? "Conversation mode set"
          : "Form mode set";
      setTimeout(() => (store.writerToast = null), 1800);
    },
  );

  const saveWriterProfile = $(async (profile: WriterProfile) => {
    store.writerProfile = profile;
    await saveWriterSettingsToIdb({
      interviewStyle: store.writerStyle,
      profile,
    });
    store.writerToast = "Writer context saved";
    setTimeout(() => (store.writerToast = null), 1800);
  });

  const persistApparatusSettings = $(async (settings: ApparatusSettings) => {
    store.defaultCitationStyle = settings.defaultCitationStyle;
    store.aiEnhanceCitations = settings.aiEnhanceCitations;
    store.flagMissingSources = settings.flagMissingSources;
    store.autoInsertFootnotes = settings.autoInsertFootnotes;
    store.researchProvider = settings.researchProvider;
    store.searchBackend = { ...settings.searchBackend };
    store.maxResults = settings.maxResults;
    store.mcpServers = settings.mcpServers.map((s) => ({ ...s }));
    await saveApparatusSettingsToIdb(settings);
    store.toast = "Preferences saved";
    setTimeout(() => (store.toast = null), 1800);
  });

  /**
   * Local first, then a best-effort push to the account.
   *
   * The order matters. The palette is applied to `<html>` immediately so the
   * page re-inks as you click rather than on the next mount, then written to
   * localStorage — which is what the bootstrap script reads before first
   * paint. The Convex write is last and its failure is swallowed: this app
   * works offline, and a theme is not worth an error.
   */
  const persistTheme = $(async (next: ThemePreference) => {
    const preference = normalizeThemePreference(next);
    store.theme = preference;

    if (typeof document !== "undefined") {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyTheme(preference, document.documentElement, prefersDark);
    }
    writeThemePreference(preference);
    try {
      localStorage.setItem(THEME_SYNC_STAMP_KEY, String(Date.now()));
    } catch {
      /* storage disabled — sync just falls back to "remote wins". */
    }

    store.themeToast = "Appearance saved";
    setTimeout(() => (store.themeToast = null), 1800);

    const client =
      auth.value.provider === "convex" && auth.value.user
        ? convexClientSig.value
        : null;
    if (!client) return;
    try {
      await client.mutation(api.sync.putAppearance, {
        preset: preference.preset,
        custom: preference.custom,
      });
    } catch {
      /* offline or signed out mid-flight — local already has the truth. */
    }
  });

  const refreshProviderModels = $(async (id: string) => {
    const provider = store.settings.providers.find((p) => p.id === id);
    if (!provider) return;
    store.discoveringProviderId = id;
    store.providerModelErrors = {
      ...store.providerModelErrors,
      [id]: undefined,
    };
    try {
      let catalog = store.modelsDevProviders;
      try {
        catalog = await loadModelsDevCatalog();
        store.modelsDevProviders = catalog;
        store.modelsDevError = null;
      } catch (error) {
        if (catalog.length === 0) throw error;
      }
      const catalogProvider = findModelsDevProvider(catalog, provider);
      const result = catalogProvider
        ? {
            models: modelsDevModelsForFeature(
              catalogProvider.models,
              "language",
            ).map((model) => model.id),
            source: "models.dev" as const,
          }
        : await discoverProviderModels(provider);
      const models = result.models;
      store.settings = {
        ...store.settings,
        providers: store.settings.providers.map((p) =>
          p.id === id
            ? {
                ...p,
                modelsDevId: catalogProvider?.id ?? p.modelsDevId,
                modelModalities: {
                  ...p.modelModalities,
                  ...catalogModelModalities(catalogProvider),
                },
                modelReasoningOptions: {
                  ...p.modelReasoningOptions,
                  ...catalogModelReasoningOptions(catalogProvider),
                },
                availableModels: models,
                defaultModel:
                  models.includes(p.defaultModel) && p.defaultModel
                    ? p.defaultModel
                    : (models[0] ?? p.defaultModel),
              }
            : p,
        ),
      };
      await persist();
    } catch (err) {
      reportApplicationDiagnostic(
        "twyne:settings:discover-provider-models",
        err,
        {
          operation: "discover-provider-models",
          providerId: id,
        },
      );
      store.providerModelErrors = {
        ...store.providerModelErrors,
        [id]: normalizeApplicationError(err, {
          source: "provider",
          metadata: {
            operation: "discover-provider-models",
            providerId: id,
          },
        }),
      };
    } finally {
      store.discoveringProviderId = null;
    }
  });

  const addProvider = $(async () => {
    const catalogProvider = store.modelsDevProviderId
      ? store.modelsDevProviders.find(
          (provider) => provider.id === store.modelsDevProviderId,
        )
      : undefined;
    const meta = PROVIDER_METAS.find((m) => m.type === store.newProviderType);
    if (!meta) return;
    const name = store.newProviderName.trim();
    const apiKey =
      store.newProviderKey.trim() ||
      (meta.apiKeyOptional ? meta.defaultApiKey : "");
    const baseUrl =
      store.newProviderBaseUrl.trim() || meta.defaultBaseUrl?.trim() || "";
    if (!name || !apiKey || (meta.needsBaseUrl && !baseUrl)) return;

    const config: AiProviderConfig = {
      id: `pv-${Date.now()}`,
      name,
      type: store.newProviderType as AiProviderConfig["type"],
      modelsDevId: catalogProvider?.id,
      apiKey,
      baseUrl: baseUrl || undefined,
      defaultModel:
        modelsDevModelsForFeature(catalogProvider?.models ?? [], "language")[0]
          ?.id ?? "",
      availableModels: modelsDevModelsForFeature(
        catalogProvider?.models ?? [],
        "language",
      ).map((model) => model.id),
      modelModalities: catalogModelModalities(catalogProvider),
      modelReasoningOptions: catalogModelReasoningOptions(catalogProvider),
      apiMode: store.newProviderApiMode,
    };

    store.settings = {
      ...store.settings,
      advancedMode: true,
      providers: [...store.settings.providers, config],
      defaultProviderId: store.settings.defaultProviderId ?? config.id,
    };
    store.showAddProvider = false;
    store.newProviderName = "";
    store.newProviderKey = "";
    store.newProviderBaseUrl = "";
    store.newProviderApiMode = "chat";
    store.providerSearch = "";
    store.modelsDevProviderId = null;
    await persist();
    if (!catalogProvider) await refreshProviderModels(config.id);
  });

  const removeProvider = $((id: string) => {
    store.removingProviderId = null;
    const next = store.settings.providers.filter((p) => p.id !== id);
    const isDefault = store.settings.defaultProviderId === id;
    store.settings = {
      ...store.settings,
      providers: next,
      defaultProviderId: isDefault
        ? (next[0]?.id ?? null)
        : store.settings.defaultProviderId,
      perFeature: Object.fromEntries(
        Object.entries(store.settings.perFeature).filter(
          ([, v]) => v?.providerId !== id,
        ),
      ) as SettingsStore["settings"]["perFeature"],
    };
    void persist();
  });

  const setDefaultProvider = $((id: string) => {
    store.settings = { ...store.settings, defaultProviderId: id };
    void persist();
  });

  const updateProviderKey = $((id: string) => {
    if (!store.editKey.trim()) {
      store.editingProviderId = null;
      return;
    }
    store.settings = {
      ...store.settings,
      providers: store.settings.providers.map((p) =>
        p.id === id ? { ...p, apiKey: store.editKey.trim() } : p,
      ),
    };
    store.editingProviderId = null;
    store.editKey = "";
    void persist();
  });

  const updateProviderDefaultModel = $((id: string, model: string) => {
    const nextModel = model.trim();
    if (!nextModel) return;
    store.settings = {
      ...store.settings,
      providers: store.settings.providers.map((p) =>
        p.id === id ? { ...p, defaultModel: nextModel } : p,
      ),
    };
    void persist();
  });

  const updateProviderApiMode = $(
    (id: string, apiMode: "chat" | "responses") => {
      store.settings = {
        ...store.settings,
        providers: store.settings.providers.map((provider) =>
          provider.id === id ? { ...provider, apiMode } : provider,
        ),
      };
      void persist();
    },
  );

  /**
   * Set — or clear — how hard one model should think.
   *
   * Stored against the model id rather than the provider, and an empty
   * choice deletes the entry outright rather than recording a level. That
   * distinction is the safety net: a model with no entry has no thinking
   * parameter sent for it at all, which is the only correct request for a
   * model that does not reason.
   */
  const updateProviderReasoning = $(
    (id: string, modelId: string, setting: AiModelReasoningSetting | null) => {
      store.settings = {
        ...store.settings,
        providers: store.settings.providers.map((provider) => {
          if (provider.id !== id) return provider;
          const next = { ...(provider.modelReasoning ?? {}) };
          if (setting) next[modelId] = setting;
          else delete next[modelId];
          return Object.keys(next).length > 0
            ? { ...provider, modelReasoning: next }
            : { ...provider, modelReasoning: undefined };
        }),
      };
      void persist();
    },
  );

  const runTest = $(async (config: AiProviderConfig) => {
    store.testingProviderId = config.id;
    store.testResults = { ...store.testResults, [config.id]: undefined };
    const result = await testProvider(config);
    const safeResult: {
      ok: boolean;
      latencyMs: number;
      error?: AppError;
      modelCount?: number;
      models?: string[];
    } = result.ok
      ? {
          ok: true,
          latencyMs: result.latencyMs,
          modelCount: result.modelCount,
          models: result.models,
        }
      : {
          ok: false,
          latencyMs: result.latencyMs,
          error: normalizeApplicationError(
            result.error ?? "Provider connection failed",
            {
              source: "provider",
              metadata: {
                operation: "test-provider",
                providerId: config.id,
              },
            },
          ),
        };
    if (!result.ok) {
      reportApplicationDiagnostic(
        "twyne:settings:test-provider",
        result.error ?? "Provider connection failed",
        {
          operation: "test-provider",
          providerId: config.id,
        },
      );
    }
    store.testResults = { ...store.testResults, [config.id]: safeResult };
    if (result.ok && result.models) {
      store.settings = {
        ...store.settings,
        providers: store.settings.providers.map((provider) =>
          provider.id === config.id
            ? {
                ...provider,
                availableModels: result.models,
                defaultModel:
                  result.models?.includes(provider.defaultModel) &&
                  provider.defaultModel
                    ? provider.defaultModel
                    : (result.models?.[0] ?? provider.defaultModel),
              }
            : provider,
        ),
      };
      await persist();
    }
    store.testingProviderId = null;
    if (result.ok) {
      await refreshProviderModels(config.id);
    }
  });

  const setFeatureOverride = $(
    (feature: AiFeature, override: AiFeatureOverride | undefined) => {
      const cleaned =
        override &&
        (override.providerId ||
          override.model ||
          override.temperature !== undefined ||
          override.maxTokens !== undefined ||
          override.voice ||
          override.speed !== undefined ||
          override.responseFormat ||
          override.instructions)
          ? override
          : undefined;
      store.settings = {
        ...store.settings,
        perFeature: {
          ...store.settings.perFeature,
          [feature]: cleaned,
        },
      };
      void persist();
    },
  );

  const resetAll = $(async () => {
    store.showResetDialog = false;
    store.settings = DEFAULT_AI_SETTINGS;
    await saveAiSettingsToIdb(DEFAULT_AI_SETTINGS);
    store.toast = "Reset to defaults";
    setTimeout(() => (store.toast = null), 2000);
  });

  const openDeleteAccountDialog = $(() => {
    if (!convexClientSig.value) {
      store.accountError = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "delete-account" },
      });
      return;
    }
    store.showDeleteDialog = true;
    store.deleteConfirmText = "";
    store.deleteDialogError = null;
    store.accountError = null;
  });

  const handleDeleteAccount = $(async () => {
    const client = convexClientSig.value;
    if (!client) {
      store.accountError = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "delete-account" },
      });
      return;
    }
    if (store.deleteConfirmText.trim() !== "DELETE") {
      store.deleteDialogError = "Type DELETE exactly to continue.";
      return;
    }
    store.deletingAccount = true;
    store.deleteDialogError = null;
    store.accountError = null;
    try {
      const result = await client.mutation(api.account.deleteAccount, {});
      // Wipe the local session and any synced state, then bounce to the home
      // page so nothing authed lingers in memory.
      try {
        await signOut();
      } catch {
        /* sign-out is best-effort; the server account is already gone */
      }
      clearConvexSyncContext();
      store.accountToast = result?.identityPurged
        ? "Your account and synced data have been deleted."
        : "Synced data deleted. We're finishing the account teardown — if you can still sign in, contact support@twyne.love.";
      store.showDeleteDialog = false;
      store.deletingAccount = false;
      window.location.href = "/";
    } catch (error) {
      reportApplicationDiagnostic("twyne:settings:delete-account", error, {
        operation: "delete-account",
      });
      store.accountError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "delete-account" },
      });
      store.deleteDialogError = store.accountError.message;
      store.deletingAccount = false;
    }
  });

  const refreshIntegrationTokens = $(async () => {
    const client = convexClientSig.value;
    if (!client || auth.value.provider !== "convex") {
      store.integrationTokens = [];
      store.integrationTokensLoaded = true;
      return;
    }
    try {
      store.integrationTokens = await client.query(
        api.integrations.listTokens,
        {},
      );
      store.integrationTokenError = null;
    } catch (error) {
      store.integrationTokenError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "list-integration-tokens" },
      });
    } finally {
      store.integrationTokensLoaded = true;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    track(() => auth.value.provider);
    track(() => convexClientSig.value);
    await refreshIntegrationTokens();
  });

  const handleCreateIntegrationToken = $(async () => {
    const client = convexClientSig.value;
    if (!client) return;
    store.integrationTokenBusy = true;
    store.integrationTokenError = null;
    store.integrationTokenCopied = false;
    try {
      const created = await client.mutation(api.integrations.createToken, {
        name: store.integrationTokenName.trim() || "CLI and MCP",
      });
      store.newIntegrationToken = created.token;
      store.integrationTokenName = "";
      await refreshIntegrationTokens();
    } catch (error) {
      store.integrationTokenError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "create-integration-token" },
      });
    } finally {
      store.integrationTokenBusy = false;
    }
  });

  const handleRevokeIntegrationToken = $(
    async (id: Id<"integrationTokens">) => {
      const client = convexClientSig.value;
      if (!client) return;
      store.integrationTokenBusy = true;
      store.integrationTokenError = null;
      try {
        await client.mutation(api.integrations.revokeToken, { id });
        await refreshIntegrationTokens();
      } catch (error) {
        store.integrationTokenError = normalizeApplicationError(error, {
          source: "convex",
          metadata: { operation: "revoke-integration-token" },
        });
      } finally {
        store.integrationTokenBusy = false;
      }
    },
  );

  const handleCopyIntegrationToken = $(async () => {
    if (!store.newIntegrationToken) return;
    await navigator.clipboard.writeText(store.newIntegrationToken);
    store.integrationTokenCopied = true;
  });

  // ── Writer handle (public identity) ──────────────────────────────
  // The handle is the writer's addressable name on Twyne — it appears in
  // share URLs (/<handle>/<slug>) and profile pages (/<handle>). Claimed
  // once per account; can be changed (the old handle is freed). The
  // availability check is debounced and runs server-side via
  // `profiles.checkHandleAvailable`.

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    track(() => auth.value.user?.id);
    track(() => convexClientSig.value);
    const client = convexClientSig.value;
    const user = auth.value.user;
    if (!client || !user) {
      store.handleLoaded = true;
      return;
    }
    if (auth.value.provider !== "convex") {
      store.handleLoaded = true;
      return;
    }
    try {
      const row = (await client.query(api.profiles.getMyHandle, {})) as {
        handle: string;
        displayName: string | null;
        bio: string | null;
        avatarUrl: string | null;
      } | null;
      store.handle = row?.handle ?? null;
      store.handleDraft = row?.handle ?? "";
      store.profileDisplayName = row?.displayName ?? "";
      store.profileBio = row?.bio ?? "";
      store.profileAvatarUrl = row?.avatarUrl ?? null;
    } catch {
      // The Convex client may be in mid-reconnect; we'll retry on next track.
    } finally {
      store.handleLoaded = true;
    }
  });

  // Debounced availability check. Re-fires whenever the draft changes; the
  // server query is the source of truth so reserved words, length, and
  // collisions are all checked there.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const draft = track(() => store.handleDraft);
    const current = track(() => store.handle);
    const client = convexClientSig.value;
    store.handleCheck = null;
    if (!client) return;
    if (!draft.trim() || draft.trim() === current) return;
    store.handleCheckBusy = true;
    const timer = setTimeout(async () => {
      try {
        const result = (await client.query(api.profiles.checkHandleAvailable, {
          handle: draft,
        })) as
          | { available: true; handle: string }
          | { available: false; reason: string };
        store.handleCheck = result.available
          ? result
          : {
              available: false,
              error: normalizeApplicationError(
                {
                  name: "ConvexError",
                  data: { message: result.reason },
                },
                {
                  source: "convex",
                  metadata: { operation: "check-handle" },
                },
              ),
            };
      } catch {
        store.handleCheck = null;
      } finally {
        store.handleCheckBusy = false;
      }
    }, 350);
    return () => clearTimeout(timer);
  });

  const handleClaim = $(async () => {
    const client = convexClientSig.value;
    if (!client) {
      store.handleError = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "claim-handle" },
      });
      return;
    }
    store.handleBusy = true;
    store.handleError = null;
    store.handleToast = null;
    try {
      const result = (await client.mutation(api.profiles.claimHandle, {
        handle: store.handleDraft,
      })) as { handle: string; changed: boolean };
      store.handle = result.handle;
      store.handleDraft = result.handle;
      store.handleCheck = null;
      store.handleToast = result.changed
        ? `Your handle is now @${result.handle}`
        : "Handle unchanged.";
      setTimeout(() => (store.handleToast = null), 4000);
    } catch (error) {
      reportApplicationDiagnostic("twyne:settings:claim-handle", error, {
        operation: "claim-handle",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "claim-handle" },
      });
    } finally {
      store.handleBusy = false;
    }
  });

  const handleSaveProfile = $(async () => {
    const client = convexClientSig.value;
    if (!client) return;
    store.profileBusy = true;
    store.profileToast = null;
    try {
      await client.mutation(api.profiles.updateProfile, {
        displayName: store.profileDisplayName,
        bio: store.profileBio,
      });
      store.profileToast = "Profile saved.";
      setTimeout(() => (store.profileToast = null), 4000);
    } catch (error) {
      store.profileToast = null;
      // Surface via handle's error channel for visibility.
      reportApplicationDiagnostic("twyne:settings:save-profile", error, {
        operation: "save-profile",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "save-profile" },
      });
    } finally {
      store.profileBusy = false;
    }
  });

  const handleAvatarSelected = $(async (file: File) => {
    const client = convexClientSig.value;
    if (!client) return;
    if (!file.type.startsWith("image/")) {
      store.handleError = "Choose an image file for your profile picture.";
      return;
    }
    // Keep avatars small; the bucket isn't a CDN for large media.
    if (file.size > 5 * 1024 * 1024) {
      store.handleError = "Profile pictures must be 5 MB or smaller.";
      return;
    }
    store.profileAvatarBusy = true;
    store.handleError = null;
    store.profileToast = null;
    try {
      const uploadUrl = (await client.mutation(
        api.profiles.generateAvatarUploadUrl,
        {},
      )) as string;
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        throw new Error("Upload failed. Try again.");
      }
      const { storageId } = (await res.json()) as { storageId: string };
      await client.mutation(api.profiles.updateProfile, {
        avatarStorageId: storageId as any,
      });
      // Re-read the resolved URL so the preview reflects the stored blob.
      const row = (await client.query(api.profiles.getMyHandle, {})) as {
        avatarUrl: string | null;
      } | null;
      store.profileAvatarUrl = row?.avatarUrl ?? null;
      store.profileToast = "Profile picture updated.";
      setTimeout(() => (store.profileToast = null), 4000);
    } catch (error) {
      reportApplicationDiagnostic("twyne:settings:update-avatar", error, {
        operation: "update-avatar",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "update-avatar" },
      });
    } finally {
      store.profileAvatarBusy = false;
    }
  });

  const handleAvatarClear = $(async () => {
    const client = convexClientSig.value;
    if (!client) return;
    store.profileAvatarBusy = true;
    store.handleError = null;
    store.profileToast = null;
    try {
      await client.mutation(api.profiles.updateProfile, {
        avatarStorageId: null,
      });
      store.profileAvatarUrl = null;
      store.profileToast = "Profile picture removed.";
      setTimeout(() => (store.profileToast = null), 4000);
    } catch (error) {
      reportApplicationDiagnostic("twyne:settings:remove-avatar", error, {
        operation: "remove-avatar",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "remove-avatar" },
      });
    } finally {
      store.profileAvatarBusy = false;
    }
  });

  return (
    <div
      class="settings-page min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div class="flex items-center justify-between mb-8">
          <div>
            <p
              class="dept-label mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Twyne
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.75rem",
              }}
            >
              The Editor's Desk
            </h1>
            <p class="text-sm text-[var(--color-ink-light)] mt-1">
              Bring your own key. Choose your models. Own the room.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <Link
              href="/editor/"
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ← Back to desk
            </Link>
          </div>
        </div>

        {!store.loaded && (
          <div class="text-center py-20 text-[var(--color-ink-muted)]">
            <p style={{ fontFamily: "var(--font-typewriter)" }}>
              Loading preferences…
            </p>
          </div>
        )}

        {store.loaded && (
          <div class="space-y-8">
            {/* ── Appearance ── */}
            <section class="folio p-5">
              <h2
                class="text-base font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Appearance
              </h2>
              <p class="text-xs text-[var(--color-ink-light)] mt-1 max-w-2xl">
                The palette the room is printed in. This changes the app only —
                colours you apply to your own prose are written into the
                document and stay exactly as you set them, in Twyne and in
                anything you export.
              </p>

              <div class="mt-4 grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ...THEME_PRESETS,
                    {
                      id: "system" as ThemePresetId,
                      label: "System",
                      description:
                        "Follow the machine — Editorial by day, Nightpress when your OS asks for dark.",
                      dark: false,
                      tokens: getThemePreset("editorial").tokens,
                    },
                  ] as const
                ).map((preset) => {
                  const active = store.theme.preset === preset.id;
                  const swatches =
                    preset.id === "system"
                      ? getThemePreset("editorial").tokens
                      : preset.tokens;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      onClick$={() =>
                        persistTheme({
                          preset: preset.id as ThemePresetId,
                          custom: store.theme.custom,
                        })
                      }
                      class="text-left p-3 border transition-colors"
                      style={{
                        borderRadius: "2px",
                        borderColor: active
                          ? "var(--color-vermilion)"
                          : "var(--color-paper-3)",
                        background: active
                          ? "color-mix(in srgb, var(--color-vermilion) 6%, transparent)"
                          : "transparent",
                      }}
                    >
                      <span class="flex items-center gap-2">
                        <span
                          class="text-sm text-[var(--color-ink)]"
                          style={{ fontFamily: "var(--font-display)" }}
                        >
                          {preset.label}
                        </span>
                        {active && (
                          <span
                            class="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--color-vermilion)]"
                            style={{ fontFamily: "var(--font-typewriter)" }}
                          >
                            in use
                          </span>
                        )}
                        <span class="ml-auto flex gap-1" aria-hidden="true">
                          {(
                            [
                              "paper",
                              "paper-3",
                              "ink",
                              "vermilion",
                            ] as ThemeTokenId[]
                          ).map((id) => (
                            <span
                              key={id}
                              class="inline-block h-4 w-4 border border-[var(--color-paper-3)]"
                              style={{ background: swatches[id] }}
                            />
                          ))}
                        </span>
                      </span>
                      <span class="block text-[0.65rem] text-[var(--color-ink-muted)] mt-1">
                        {preset.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                class="mt-4 text-xs text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
                aria-expanded={store.themeCustomOpen}
                onClick$={() =>
                  (store.themeCustomOpen = !store.themeCustomOpen)
                }
              >
                {store.themeCustomOpen ? "▾" : "▸"} Customise palette
              </button>

              {store.themeCustomOpen && (
                <div class="mt-3 space-y-2">
                  <p class="text-[0.65rem] text-[var(--color-ink-muted)] max-w-2xl">
                    Overrides sit on top of whichever preset is selected, so
                    changing preset keeps your edits. Anything you leave alone
                    follows the preset.
                  </p>
                  {THEME_TOKENS.map((token) => {
                    const resolved = resolvedThemeTokens(store.theme);
                    const overridden = Boolean(store.theme.custom?.[token.id]);
                    return (
                      <div
                        key={token.id}
                        class="flex items-center gap-3 py-1.5 border-b border-[var(--color-paper-3)] last:border-b-0"
                      >
                        <input
                          type="color"
                          value={resolved[token.id]}
                          aria-label={token.label}
                          class="h-7 w-9 shrink-0 cursor-pointer border border-[var(--color-paper-3)] bg-transparent p-0"
                          onChange$={(e) =>
                            persistTheme({
                              preset: store.theme.preset,
                              custom: {
                                ...store.theme.custom,
                                [token.id]: (e.target as HTMLInputElement)
                                  .value,
                              },
                            })
                          }
                        />
                        <span class="min-w-0">
                          <span class="block text-xs text-[var(--color-ink)]">
                            {token.label}
                          </span>
                          <span class="block text-[0.62rem] text-[var(--color-ink-muted)]">
                            {token.description}
                          </span>
                        </span>
                        <span
                          class="ml-auto text-[0.62rem] text-[var(--color-ink-muted)]"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {resolved[token.id]}
                        </span>
                        {overridden && (
                          <button
                            type="button"
                            class="text-[0.62rem] text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                            aria-label={`Reset ${token.label}`}
                            onClick$={() => {
                              const custom = { ...store.theme.custom };
                              delete custom[token.id];
                              void persistTheme({
                                preset: store.theme.preset,
                                custom,
                              });
                            }}
                          >
                            reset
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {/*
                    A custom palette is the one place a writer can make the app
                    unreadable, so say so rather than letting them discover it
                    an hour later.
                  */}
                  {(() => {
                    const ratio = themeContrast(store.theme);
                    const passes = ratio >= WCAG_AA_CONTRAST;
                    return (
                      <p
                        class="text-[0.65rem] pt-1"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          color: passes
                            ? "var(--color-ink-muted)"
                            : "var(--color-accent-red)",
                        }}
                      >
                        {passes ? "✓" : "⚠"} Ink on paper: {ratio.toFixed(1)}:1
                        {passes
                          ? " — clears WCAG AA."
                          : ` — below the ${WCAG_AA_CONTRAST}:1 needed for body text.`}
                      </p>
                    );
                  })()}

                  {store.theme.custom && (
                    <button
                      type="button"
                      class="btn-paper px-3 py-1.5 text-xs mt-1"
                      onClick$={() =>
                        persistTheme({ preset: store.theme.preset })
                      }
                    >
                      Reset to{" "}
                      {
                        getThemePreset(
                          resolveThemePreset(
                            store.theme.preset,
                            typeof window !== "undefined" &&
                              window.matchMedia("(prefers-color-scheme: dark)")
                                .matches,
                          ),
                        ).label
                      }
                    </button>
                  )}
                </div>
              )}

              {store.themeToast && (
                <p
                  class="text-[0.65rem] text-[var(--color-accent-green)] mt-3"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {store.themeToast}
                </p>
              )}
            </section>

            {/* ── Writer preferences (always shown, no BYOK required) ── */}
            <section class="folio p-5">
              <h2
                class="text-base font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                About the writer
              </h2>
              <p class="text-xs text-[var(--color-ink-light)] mt-1 max-w-2xl">
                This private context helps the room address you as a person
                while you draft. It stays in this browser and is not part of
                your public profile.
              </p>
              <div class="mt-4 grid gap-4 sm:grid-cols-2">
                <label class="block">
                  <span
                    class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    What should they call you?
                  </span>
                  <input
                    value={store.writerProfile.displayName}
                    placeholder="Your name"
                    onInput$={(e) => {
                      store.writerProfile = {
                        ...store.writerProfile,
                        displayName: (e.target as HTMLInputElement).value,
                      };
                    }}
                    onBlur$={() => void saveWriterProfile(store.writerProfile)}
                    class="w-full text-sm px-3 py-2 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                    style={{ borderRadius: "2px" }}
                  />
                </label>
                <label class="block">
                  <span
                    class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Feedback pressure
                  </span>
                  <SiteSelect
                    value={store.writerProfile.feedbackStyle}
                    ariaLabel="Feedback pressure"
                    options={[
                      { value: "direct", label: "Direct and demanding" },
                      { value: "balanced", label: "Balanced, candid, useful" },
                      { value: "gentle", label: "Gentle, protect momentum" },
                    ]}
                    onChange$={(value) => {
                      const feedbackStyle =
                        value as WriterProfile["feedbackStyle"];
                      void saveWriterProfile({
                        ...store.writerProfile,
                        feedbackStyle,
                      });
                    }}
                  />
                </label>
              </div>
              <div class="mt-4 grid gap-4 sm:grid-cols-2">
                <label class="block">
                  <span
                    class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Personal facts
                  </span>
                  <textarea
                    value={store.writerProfile.personalFacts}
                    rows={5}
                    placeholder="Your background, lived experience, subjects you know well, or constraints the room should remember. One detail per line works well."
                    onInput$={(e) => {
                      store.writerProfile = {
                        ...store.writerProfile,
                        personalFacts: (e.target as HTMLTextAreaElement).value,
                      };
                    }}
                    onBlur$={() => void saveWriterProfile(store.writerProfile)}
                    class="w-full text-sm px-3 py-2 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none resize-y"
                    style={{ borderRadius: "2px" }}
                  />
                </label>
                <label class="block">
                  <span
                    class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    How I like feedback
                  </span>
                  <textarea
                    value={store.writerProfile.feedbackNotes}
                    rows={5}
                    placeholder="For example: question my assumptions before fixing sentences; do not praise every paragraph; flag places where I am hiding behind abstraction."
                    onInput$={(e) => {
                      store.writerProfile = {
                        ...store.writerProfile,
                        feedbackNotes: (e.target as HTMLTextAreaElement).value,
                      };
                    }}
                    onBlur$={() => void saveWriterProfile(store.writerProfile)}
                    class="w-full text-sm px-3 py-2 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none resize-y"
                    style={{ borderRadius: "2px" }}
                  />
                </label>
              </div>
              {store.writerToast && (
                <p
                  class="text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-accent-green)] mt-3"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {store.writerToast}
                </p>
              )}
            </section>

            <section class="folio p-5">
              <h2
                class="text-base font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Interview style
              </h2>
              <p class="text-xs text-[var(--color-ink-light)] mt-1">
                The dossier interview has two modes. The form is fast and
                concrete; the conversation is slower but the room fills in the
                dossier from your answers.
              </p>
              <div class="mt-4 grid sm:grid-cols-2 gap-3">
                <button
                  onClick$={() => {
                    void setWriterStyle("form");
                  }}
                  class={`text-left rounded-lg border p-3 transition-colors ${
                    store.writerStyle === "form"
                      ? "border-[var(--color-vermilion)] bg-[var(--color-vermilion)]/5"
                      : "border-[var(--color-surface-3)] hover:border-[var(--color-ink-muted)]"
                  }`}
                >
                  <p
                    class="text-sm font-semibold"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Form
                  </p>
                  <p
                    class="text-[0.7rem] text-[var(--color-ink-muted)] mt-1"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Eight fixed fields. Fast.
                  </p>
                </button>
                <button
                  onClick$={() => {
                    void setWriterStyle("conversational");
                  }}
                  class={`text-left rounded-lg border p-3 transition-colors ${
                    store.writerStyle === "conversational"
                      ? "border-[var(--color-vermilion)] bg-[var(--color-vermilion)]/5"
                      : "border-[var(--color-surface-3)] hover:border-[var(--color-ink-muted)]"
                  }`}
                >
                  <p
                    class="text-sm font-semibold"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Conversation
                  </p>
                  <p
                    class="text-[0.7rem] text-[var(--color-ink-muted)] mt-1"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    The room interviews you, one question at a time.
                  </p>
                </button>
              </div>
              {store.writerToast && (
                <p
                  class="text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-accent-green)] mt-2"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {store.writerToast}
                </p>
              )}
            </section>

            {/* ── BYOK Toggle ── */}
            <section class="folio p-5">
              <div class="flex items-center justify-between">
                <div>
                  <h2
                    class="text-base font-semibold"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Bring Your Own Key
                  </h2>
                  <p class="text-xs text-[var(--color-ink-light)] mt-1">
                    Enable advanced mode to use your own API keys instead of the
                    shared server.
                  </p>
                </div>
                <button
                  onClick$={() => {
                    store.settings = {
                      ...store.settings,
                      advancedMode: !store.settings.advancedMode,
                    };
                    void persist();
                  }}
                  class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    store.settings.advancedMode
                      ? "bg-[var(--color-vermilion)]"
                      : "bg-[var(--color-paper-3)]"
                  }`}
                  aria-pressed={store.settings.advancedMode}
                >
                  <span
                    class={`inline-block h-4 w-4 transform rounded-full bg-[var(--color-paper)] transition-transform ${
                      store.settings.advancedMode
                        ? "translate-x-6"
                        : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {store.settings.advancedMode &&
                store.settings.providers.length === 0 && (
                  <div class="mt-4 p-3 bg-[rgba(193,39,45,0.05)] border border-[var(--color-vermilion)]">
                    <p
                      class="text-xs text-[var(--color-vermilion-2)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      ⚠ No providers configured yet. Add one below to start
                      using your own keys.
                    </p>
                  </div>
                )}
            </section>

            {/* ── AI Providers ── */}
            {store.settings.advancedMode && (
              <section class="folio p-5">
                <div class="flex items-center justify-between mb-4">
                  <h2
                    class="text-base font-semibold"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    AI Providers
                  </h2>
                  {!store.showAddProvider && (
                    <button
                      onClick$={() => {
                        store.showAddProvider = true;
                        store.newProviderType = "openai";
                        store.modelsDevProviderId = null;
                        store.providerSearch = "";
                      }}
                      class="btn-press text-xs"
                    >
                      Add provider
                    </button>
                  )}
                </div>

                {/* Provider list */}
                <div class={store.showAddProvider ? "hidden" : "space-y-3"}>
                  {store.settings.providers.map((p) => {
                    const isManagedLocal = p.id === LOCAL_PROVIDER_ID;
                    const isManagedBrowserVoice =
                      p.id === BROWSER_TTS_PROVIDER_ID;
                    const isManagedVoice =
                      isManagedLocal || isManagedBrowserVoice;
                    const isDefault = store.settings.defaultProviderId === p.id;
                    // Only offered for models the catalog marks as reasoning.
                    const thinkingModels = reasoningModelsFor(
                      p,
                      store.modelsDevProviders,
                    );
                    return (
                      <div
                        key={p.id}
                        class="desk-card border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
                        style={{
                          ["--card-accent" as never]: isDefault
                            ? "var(--color-accent-green)"
                            : "var(--color-ink-muted)",
                        }}
                      >
                        {/* Name against the left margin, what it is stamped
                          against the right, the endpoint as the byline. */}
                        <div class="desk-card__head">
                          <p
                            class="desk-card__name desk-card__name--wrap"
                            title={p.name}
                          >
                            {p.name}
                          </p>
                          <span class="desk-card__stamp">
                            {isDefault
                              ? "default"
                              : isManagedLocal
                                ? "desktop"
                                : isManagedBrowserVoice
                                  ? "on device"
                                  : (PROVIDER_METAS.find(
                                      (m) => m.type === p.type,
                                    )?.label ?? p.type)}
                          </span>
                          <div class="desk-card__byline">
                            <span class="truncate">
                              {PROVIDER_METAS.find((m) => m.type === p.type)
                                ?.label ?? p.type}
                            </span>
                          </div>
                        </div>
                        <div class="flex-1 min-w-0">
                          <div>
                            <div class="space-y-1">
                              {p.baseUrl && (
                                <p class="desk-card__detail">{p.baseUrl}</p>
                              )}
                              {isTinkerProvider(p) &&
                                p.type === "anthropic-compatible" && (
                                  <p
                                    class="text-[0.65rem] text-[var(--color-ink-light)]"
                                    style={{
                                      fontFamily: "var(--font-typewriter)",
                                    }}
                                  >
                                    Tinker blocks direct browser requests, so
                                    Twyne uses a fixed same-origin bridge to its
                                    OpenAI-compatible route. Your key passes
                                    through only for that request and is not
                                    stored or logged by Twyne.
                                  </p>
                                )}
                              <p
                                class="text-[0.65rem] text-[var(--color-ink-muted)]"
                                style={{ fontFamily: "var(--font-typewriter)" }}
                              >
                                {providerModelOptions(p).length > 0
                                  ? `${providerModelOptions(p).length} model options available`
                                  : "No model catalog loaded yet"}
                              </p>
                            </div>

                            {store.editingProviderId === p.id ? (
                              <div class="mt-2 space-y-2">
                                <input
                                  type="password"
                                  value={store.editKey}
                                  onInput$={(e) => {
                                    store.editKey = (
                                      e.target as HTMLInputElement
                                    ).value;
                                  }}
                                  onBlur$={() => {
                                    updateProviderKey(p.id);
                                  }}
                                  placeholder="New API key"
                                  class="w-full text-xs px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                    borderRadius: "2px",
                                  }}
                                />
                                <div class="flex gap-2">
                                  <button
                                    onClick$={() => updateProviderKey(p.id)}
                                    class="btn-press text-xs"
                                  >
                                    Update key
                                  </button>
                                  <button
                                    onClick$={() => {
                                      store.editingProviderId = null;
                                      store.editKey = "";
                                    }}
                                    class="btn-paper text-xs"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              // Maintenance on the left, the two decisions
                              // that change what this provider *is* — make it
                              // default, take it away — on the right.
                              <div class="desk-card__foot">
                                <div class="desk-card__foot-start">
                                  {!isManagedVoice && (
                                    <button
                                      onClick$={() => {
                                        store.editingProviderId = p.id;
                                        store.editKey = "";
                                      }}
                                      class="card-key"
                                      title="Replace the stored API key"
                                    >
                                      Change key
                                    </button>
                                  )}
                                  {!isManagedBrowserVoice && (
                                    <button
                                      onClick$={() => runTest(p)}
                                      disabled={
                                        store.testingProviderId === p.id
                                      }
                                      class="card-key card-key--go"
                                      title="Validate the key by asking the endpoint for its model list"
                                    >
                                      {store.testingProviderId === p.id
                                        ? "Testing key…"
                                        : "Test key"}
                                    </button>
                                  )}
                                  {!isManagedBrowserVoice && (
                                    <button
                                      onClick$={() =>
                                        refreshProviderModels(p.id)
                                      }
                                      disabled={
                                        store.discoveringProviderId === p.id
                                      }
                                      class="card-key"
                                      title="Read the model catalog from this endpoint"
                                    >
                                      {store.discoveringProviderId === p.id
                                        ? "Loading models…"
                                        : "Refresh models"}
                                    </button>
                                  )}
                                </div>
                                <div class="desk-card__foot-end">
                                  {!isManagedBrowserVoice && !isDefault && (
                                    <button
                                      onClick$={() => setDefaultProvider(p.id)}
                                      class="card-key"
                                      title="Use this provider wherever no other is chosen"
                                    >
                                      Make default
                                    </button>
                                  )}
                                  {!isManagedVoice && (
                                    <button
                                      onClick$={() => {
                                        if (store.removingProviderId === p.id) {
                                          removeProvider(p.id);
                                        } else {
                                          store.removingProviderId = p.id;
                                        }
                                      }}
                                      onBlur$={() => {
                                        if (store.removingProviderId === p.id) {
                                          store.removingProviderId = null;
                                        }
                                      }}
                                      class={`card-key card-key--danger${
                                        store.removingProviderId === p.id
                                          ? " card-key--arming"
                                          : ""
                                      }`}
                                      aria-label={
                                        store.removingProviderId === p.id
                                          ? `Confirm removal of ${p.name}`
                                          : `Remove ${p.name}`
                                      }
                                    >
                                      {store.removingProviderId === p.id
                                        ? "Confirm remove"
                                        : "Remove"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {!isManagedVoice &&
                              (supportsOpenAiApiMode(p) ||
                                thinkingModels.length > 0) && (
                                <div class="provider-controls">
                                  {supportsOpenAiApiMode(p) && (
                                    <label class="card-field">
                                      <span>Generation API</span>
                                      <SiteSelect
                                        value={p.apiMode ?? "chat"}
                                        ariaLabel={`Generation API for ${p.name}`}
                                        options={[
                                          {
                                            value: "chat",
                                            label: "Chat Completions",
                                            description:
                                              "The widely supported chat endpoint.",
                                          },
                                          {
                                            value: "responses",
                                            label: "Responses API",
                                            description:
                                              "Use only when this endpoint exposes /responses.",
                                          },
                                        ]}
                                        onChange$={(value) =>
                                          updateProviderApiMode(
                                            p.id,
                                            value as "chat" | "responses",
                                          )
                                        }
                                      />
                                      <span class="card-field__hint">
                                        Select Responses only when this endpoint
                                        exposes <code>/responses</code>.
                                      </span>
                                    </label>
                                  )}

                                  {thinkingModels.flatMap((model) =>
                                    (model.reasoningOptions ?? []).map(
                                      (option, optionIndex) => {
                                        const setting =
                                          p.modelReasoning?.[model.id];
                                        const label = `Thinking: ${
                                          model.name || model.id
                                        }`;
                                        if (option.type === "budget_tokens") {
                                          return (
                                            <div
                                              key={`${model.id}-${option.type}-${optionIndex}`}
                                              class="card-field"
                                            >
                                              <span title={model.id}>
                                                {label}
                                              </span>
                                              <NumericStepper
                                                ariaLabel={`${label} token budget`}
                                                min={option.min}
                                                max={option.max}
                                                suffix="tok"
                                                placeholder="Model default"
                                                value={
                                                  setting?.type ===
                                                  "budget_tokens"
                                                    ? setting.value
                                                    : ""
                                                }
                                                onValue$={(value) => {
                                                  updateProviderReasoning(
                                                    p.id,
                                                    model.id,
                                                    value !== null
                                                      ? {
                                                          type: "budget_tokens",
                                                          value,
                                                        }
                                                      : null,
                                                  );
                                                }}
                                              />
                                              <span class="card-field__hint">
                                                Token budget, {option.min} to{" "}
                                                {option.max}. Blank uses the
                                                model default.
                                              </span>
                                            </div>
                                          );
                                        }
                                        if (option.type === "toggle") {
                                          return (
                                            <label
                                              key={`${model.id}-${option.type}-${optionIndex}`}
                                              class="card-field"
                                            >
                                              <span title={model.id}>
                                                {label}
                                              </span>
                                              <SiteSelect
                                                value={
                                                  setting?.type === "toggle"
                                                    ? String(setting.value)
                                                    : ""
                                                }
                                                ariaLabel={label}
                                                options={[
                                                  {
                                                    value: "",
                                                    label: "Model default",
                                                  },
                                                  {
                                                    value: "true",
                                                    label: "On",
                                                  },
                                                  {
                                                    value: "false",
                                                    label: "Off",
                                                  },
                                                ]}
                                                onChange$={(value) => {
                                                  updateProviderReasoning(
                                                    p.id,
                                                    model.id,
                                                    value
                                                      ? {
                                                          type: "toggle",
                                                          value:
                                                            value === "true",
                                                        }
                                                      : null,
                                                  );
                                                }}
                                              />
                                              <span class="card-field__hint">
                                                This model exposes an on or off
                                                thinking mode.
                                              </span>
                                            </label>
                                          );
                                        }
                                        const values = option.values.filter(
                                          (value): value is AiReasoningEffort =>
                                            value !== null,
                                        );
                                        return (
                                          <label
                                            key={`${model.id}-${option.type}-${optionIndex}`}
                                            class="card-field"
                                          >
                                            <span title={model.id}>
                                              {label}
                                            </span>
                                            <SiteSelect
                                              value={
                                                setting?.type === "effort"
                                                  ? setting.value
                                                  : ""
                                              }
                                              ariaLabel={label}
                                              options={[
                                                {
                                                  value: "",
                                                  label: "Model default",
                                                },
                                                ...values.map((value) => ({
                                                  value,
                                                  label:
                                                    value
                                                      .charAt(0)
                                                      .toUpperCase() +
                                                    value.slice(1),
                                                })),
                                              ]}
                                              onChange$={(rawValue) => {
                                                const value = rawValue as
                                                  | AiReasoningEffort
                                                  | "";
                                                updateProviderReasoning(
                                                  p.id,
                                                  model.id,
                                                  value
                                                    ? {
                                                        type: "effort",
                                                        value,
                                                      }
                                                    : null,
                                                );
                                              }}
                                            />
                                            <span class="card-field__hint">
                                              Choices reported for this model by
                                              models.dev.
                                            </span>
                                          </label>
                                        );
                                      },
                                    ),
                                  )}
                                </div>
                              )}

                            {store.testResults[p.id] && (
                              <>
                                {store.testResults[p.id]?.ok ? (
                                  <p
                                    class="mt-1.5 text-[0.65rem] text-[var(--color-accent-green)]"
                                    style={{
                                      fontFamily: "var(--font-typewriter)",
                                    }}
                                  >
                                    Connected in{" "}
                                    {store.testResults[p.id]?.latencyMs ?? 0}
                                    ms
                                    {store.testResults[p.id]?.modelCount !==
                                    undefined
                                      ? `, ${store.testResults[p.id]?.modelCount} models found`
                                      : ""}
                                  </p>
                                ) : (
                                  store.testResults[p.id]?.error && (
                                    <div class="mt-2">
                                      <ApplicationNotice
                                        error={
                                          store.testResults[p.id]
                                            ?.error as AppError
                                        }
                                        compact
                                        onRetry$={() => runTest(p)}
                                      />
                                    </div>
                                  )
                                )}
                              </>
                            )}
                            {store.providerModelErrors[p.id] && (
                              <div class="mt-2">
                                {(() => {
                                  const modelError =
                                    store.providerModelErrors[p.id];
                                  return modelError ? (
                                    <ApplicationNotice
                                      error={modelError}
                                      compact
                                      onRetry$={() =>
                                        refreshProviderModels(p.id)
                                      }
                                    />
                                  ) : null;
                                })()}
                              </div>
                            )}

                            {isManagedBrowserVoice && (
                              <div class="mt-3 p-3 border border-dashed border-[var(--color-paper-3)]">
                                <div class="flex items-center justify-between gap-2">
                                  <p
                                    class="text-[0.65rem] text-[var(--color-ink-muted)]"
                                    style={{
                                      fontFamily: "var(--font-display)",
                                    }}
                                  >
                                    On-device voice
                                  </p>
                                  {store.supertonicStatus?.phase === "ready" ? (
                                    <button
                                      onClick$={clearSupertonic}
                                      class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                                      style={{
                                        fontFamily: "var(--font-typewriter)",
                                      }}
                                    >
                                      Remove pack
                                    </button>
                                  ) : (
                                    <button
                                      onClick$={downloadSupertonic}
                                      disabled={store.supertonicDownloading}
                                      class="btn-press text-xs"
                                    >
                                      {store.supertonicDownloading
                                        ? "Downloading…"
                                        : "Download pack"}
                                    </button>
                                  )}
                                </div>
                                {store.supertonicDownloading &&
                                  store.supertonicStatus && (
                                    <div class="mt-2">
                                      <div class="h-1 w-full bg-[var(--color-paper-3)]">
                                        <div
                                          class="h-full bg-[var(--color-vermilion)] transition-[width]"
                                          style={{
                                            width: `${Math.round(
                                              (store.supertonicStatus.progress *
                                                100) as number,
                                            )}%`,
                                          }}
                                        />
                                      </div>
                                      <p
                                        class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        {formatBytes(
                                          store.supertonicStatus
                                            .downloadedBytes,
                                        )}{" "}
                                        of{" "}
                                        {formatBytes(
                                          store.supertonicStatus.totalBytes,
                                        )}
                                      </p>
                                    </div>
                                  )}
                                <p
                                  class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                  }}
                                >
                                  {store.supertonicStatus?.phase === "ready"
                                    ? "Ready — reading works offline."
                                    : `${formatBytes(
                                        BROWSER_TTS_BUNDLE_BYTES,
                                      )} downloaded once, then voiced entirely in this browser with no key or network.`}
                                </p>
                                {store.supertonicError && (
                                  <div class="mt-2">
                                    <ApplicationNotice
                                      error={store.supertonicError}
                                      compact
                                      onRecovery$={downloadSupertonic}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add provider form */}
                {store.showAddProvider && (
                  <div class="p-4 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
                    <h3
                      class="text-sm font-semibold mb-3"
                      style={{
                        fontFamily: "var(--font-display)",
                        color: "var(--color-vermilion)",
                      }}
                    >
                      New provider
                    </h3>
                    <div class="space-y-3">
                      <div>
                        <label
                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Provider
                        </label>
                        <input
                          value={store.providerSearch}
                          onInput$={(event) => {
                            store.providerSearch = (
                              event.target as HTMLInputElement
                            ).value;
                          }}
                          placeholder="Search models.dev providers"
                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "2px",
                          }}
                        />
                        <div class="mt-1 max-h-48 overflow-y-auto border border-[var(--color-paper-3)] bg-[var(--color-paper)]">
                          {searchModelsDevProviders(
                            store.modelsDevProviders,
                            store.providerSearch,
                          )
                            .slice(0, 80)
                            .map((provider) => (
                              <button
                                key={provider.id}
                                type="button"
                                class={`block w-full px-2 py-1.5 text-left hover:bg-[var(--color-paper-soft)] ${
                                  store.modelsDevProviderId === provider.id
                                    ? "bg-[var(--color-paper-soft)]"
                                    : ""
                                }`}
                                onClick$={() => {
                                  store.modelsDevProviderId = provider.id;
                                  store.newProviderType = provider.type;
                                  store.newProviderName = provider.name;
                                  store.newProviderBaseUrl =
                                    provider.api ??
                                    providerMetaFor(provider.type)
                                      ?.defaultBaseUrl ??
                                    "";
                                  const meta = providerMetaFor(provider.type);
                                  if (
                                    meta?.apiKeyOptional &&
                                    !store.newProviderKey.trim()
                                  ) {
                                    store.newProviderKey =
                                      meta.defaultApiKey ?? "";
                                  }
                                }}
                              >
                                <span
                                  class="block text-xs text-[var(--color-ink)]"
                                  style="font-family: var(--font-typewriter);"
                                >
                                  {provider.name}
                                </span>
                                <span class="block text-[10px] text-[var(--color-ink-muted)]">
                                  {provider.id} · {provider.models.length}{" "}
                                  models
                                </span>
                              </button>
                            ))}
                          {store.modelsDevProviders.length === 0 && (
                            <p class="px-2 py-2 text-xs text-[var(--color-ink-muted)]">
                              The models.dev catalog is unavailable. Choose a
                              custom provider below.
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          class="mt-1 text-[10px] tracking-[0.12em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                          style="font-family: var(--font-typewriter);"
                          onClick$={() => {
                            store.modelsDevProviderId = null;
                            store.newProviderType = "openai-compatible";
                            store.newProviderName = "Custom provider";
                            store.newProviderBaseUrl = "";
                          }}
                        >
                          Use a custom OpenAI-compatible provider
                        </button>
                      </div>

                      <div>
                        <label
                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Name
                        </label>
                        <input
                          value={store.newProviderName}
                          onInput$={(e) => {
                            store.newProviderName = (
                              e.target as HTMLInputElement
                            ).value;
                          }}
                          placeholder="e.g. My OpenAI"
                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "2px",
                          }}
                        />
                      </div>

                      <div>
                        <label
                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          API key
                        </label>
                        <input
                          type="password"
                          value={store.newProviderKey}
                          onInput$={(e) => {
                            store.newProviderKey = (
                              e.target as HTMLInputElement
                            ).value;
                          }}
                          placeholder={
                            providerMetaForForm(store.newProviderType)
                              ?.apiKeyOptional
                              ? "Optional"
                              : "sk-..."
                          }
                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "2px",
                          }}
                        />
                        <p
                          class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Stored only in your browser. Tinker keys pass
                          transiently through Twyne&apos;s fixed same-origin
                          bridge because Tinker blocks direct browser calls.
                        </p>
                      </div>

                      {PROVIDER_METAS.find(
                        (m) => m.type === store.newProviderType,
                      )?.needsBaseUrl && (
                        <div>
                          <label
                            class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                            style={{ fontFamily: "var(--font-typewriter)" }}
                          >
                            Base URL
                          </label>
                          <input
                            value={store.newProviderBaseUrl}
                            onInput$={(e) => {
                              store.newProviderBaseUrl = (
                                e.target as HTMLInputElement
                              ).value;
                            }}
                            placeholder={
                              providerMetaForForm(store.newProviderType)
                                ?.defaultBaseUrl ?? "https://api.example.com/v1"
                            }
                            class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                              borderRadius: "2px",
                            }}
                          />
                        </div>
                      )}

                      {supportsOpenAiApiMode({
                        id: "new-provider",
                        name: store.newProviderName,
                        type: store.newProviderType as AiProviderConfig["type"],
                        apiKey: store.newProviderKey,
                        defaultModel: "",
                      }) && (
                        <div>
                          <label
                            class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                            style={{ fontFamily: "var(--font-typewriter)" }}
                          >
                            Generation API
                          </label>
                          <SiteSelect
                            value={store.newProviderApiMode}
                            ariaLabel="Generation API for new provider"
                            options={[
                              {
                                value: "chat",
                                label: "Chat Completions",
                                description:
                                  "The widely supported chat endpoint.",
                              },
                              {
                                value: "responses",
                                label: "Responses API",
                                description:
                                  "Use only when this endpoint exposes /responses.",
                              },
                            ]}
                            onChange$={(value) => {
                              store.newProviderApiMode = value as
                                | "chat"
                                | "responses";
                            }}
                          />
                        </div>
                      )}

                      <p
                        class="text-[0.65rem] text-[var(--color-ink-muted)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        Provider and model metadata comes from models.dev. Your
                        API key remains stored in this browser and is only used
                        with the provider you configure. Tinker requests use
                        Twyne&apos;s fixed same-origin bridge because its API
                        does not support browser CORS.
                      </p>

                      <div class="flex gap-2 pt-1">
                        <button
                          onClick$={addProvider}
                          class="btn-press text-xs"
                        >
                          Add provider
                        </button>
                        <button
                          onClick$={() => {
                            store.showAddProvider = false;
                          }}
                          class="btn-paper text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── Default Models ── */}
            {store.settings.advancedMode &&
              store.settings.providers.length > 0 && (
                <section class="folio p-5">
                  <h2
                    class="text-base font-semibold mb-1"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Default Models
                  </h2>
                  <p class="text-xs text-[var(--color-ink-light)] mb-4">
                    Connection details live with the provider. Model choice
                    lives here.
                  </p>

                  <div class="space-y-3">
                    {store.settings.providers.map((provider) => {
                      const models = catalogModelsForProvider(
                        provider,
                        store.modelsDevProviders,
                      );
                      return (
                        <div
                          key={`model-${provider.id}`}
                          class="border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-3"
                          style={{ borderRadius: "2px" }}
                        >
                          <div class="flex items-center justify-between gap-3">
                            <div>
                              <p
                                class="text-sm text-[var(--color-ink)]"
                                style={{
                                  fontFamily: "var(--font-display)",
                                  fontWeight: 600,
                                }}
                              >
                                {provider.name}
                              </p>
                              <p
                                class="text-[0.65rem] text-[var(--color-ink-muted)]"
                                style={{ fontFamily: "var(--font-typewriter)" }}
                              >
                                {providerMetaFor(provider.type)?.label ??
                                  provider.type}
                              </p>
                            </div>
                            <button
                              onClick$={() =>
                                refreshProviderModels(provider.id)
                              }
                              disabled={
                                store.discoveringProviderId === provider.id
                              }
                              class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] disabled:opacity-40"
                              style={{
                                fontFamily: "var(--font-typewriter)",
                              }}
                            >
                              {store.discoveringProviderId === provider.id
                                ? "Loading models…"
                                : "Refresh models"}
                            </button>
                          </div>

                          <div class="mt-3">
                            <label
                              class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              Default model
                            </label>
                            <SearchableModelSelect
                              value={provider.defaultModel}
                              models={models}
                              onSelect$={(model) =>
                                updateProviderDefaultModel(provider.id, model)
                              }
                            />
                            <p
                              class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              {models.length > 0
                                ? `${models.length} searchable models available.`
                                : "No catalog available yet. Refresh models or enter a model id manually."}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

            {/* ── Per-Feature Models ── */}
            {store.settings.advancedMode &&
              store.settings.providers.length > 0 && (
                <section class="folio p-5">
                  <h2
                    class="text-base font-semibold mb-1"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Per-Feature Models
                  </h2>
                  <p class="text-xs text-[var(--color-ink-light)] mb-4">
                    Choose which provider handles each feature. Unconfigured
                    features use the default provider.
                  </p>

                  <div class="space-y-2">
                    {(Object.keys(FEATURE_LABELS) as AiFeature[]).map(
                      (feature) => {
                        const resolved = resolveFeatureConfig(
                          store.settings,
                          feature,
                        );
                        const isOpen = store.openFeature === feature;
                        const eligibleProviders =
                          store.settings.providers.filter((provider) =>
                            providerSupportsFeature(
                              provider.type,
                              feature,
                              provider,
                            ),
                          );
                        const configuredProviderId =
                          store.settings.perFeature[feature]?.providerId;
                        const selectedProvider =
                          eligibleProviders.find(
                            (provider) => provider.id === configuredProviderId,
                          ) ??
                          eligibleProviders.find(
                            (provider) =>
                              provider.id === store.settings.defaultProviderId,
                          ) ??
                          eligibleProviders[0];
                        const selectedProviderId = configuredProviderId ?? "";
                        const selectedProviderModels = selectedProvider
                          ? providerModelOptions(selectedProvider)
                          : [];
                        const selectedModel =
                          store.settings.perFeature[feature]?.model ??
                          resolved?.model ??
                          "";
                        const selectedModelOptions = selectedModel
                          ? Array.from(
                              new Set([
                                selectedModel,
                                ...selectedProviderModels,
                              ]),
                            )
                          : selectedProviderModels;
                        const selectedCatalogModels = selectedProvider
                          ? catalogModelsForProvider(
                              {
                                ...selectedProvider,
                                availableModels: selectedModelOptions,
                              },
                              store.modelsDevProviders,
                              feature,
                            )
                          : selectedModelOptions.map((id) => ({
                              id,
                              name: id,
                            }));
                        return (
                          <div
                            key={feature}
                            class="border border-[var(--color-paper-3)]"
                            style={{ borderRadius: "2px" }}
                          >
                            <button
                              onClick$={() => {
                                store.openFeature = isOpen ? null : feature;
                              }}
                              class="w-full text-left px-3 py-2.5 flex items-center justify-between"
                            >
                              <div>
                                <p
                                  class="text-sm text-[var(--color-ink)]"
                                  style={{
                                    fontFamily: "var(--font-display)",
                                    fontWeight: 600,
                                  }}
                                >
                                  {FEATURE_LABELS[feature]}
                                </p>
                                <p
                                  class="text-[0.65rem] text-[var(--color-ink-muted)] mt-0.5"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                  }}
                                >
                                  {FEATURE_DESCRIPTIONS[feature]}
                                </p>
                              </div>
                              <div class="flex items-center gap-3">
                                <span
                                  class="text-[0.65rem] tracking-[0.1em] text-[var(--color-ink-light)]"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                  }}
                                >
                                  {resolved
                                    ? `${resolved.provider.name} · ${resolved.model}`
                                    : "Default provider"}
                                </span>
                                <span class="text-[var(--color-ink-muted)]">
                                  {isOpen ? "▾" : "▸"}
                                </span>
                              </div>
                            </button>

                            {isOpen && (
                              <div class="px-3 pb-3 border-t border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
                                <div class="mt-3 space-y-3">
                                  <div>
                                    <label
                                      class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                      style={{
                                        fontFamily: "var(--font-typewriter)",
                                      }}
                                    >
                                      Provider
                                    </label>
                                    <SiteSelect
                                      value={selectedProviderId}
                                      ariaLabel={`Provider for ${FEATURE_LABELS[feature] ?? feature}`}
                                      options={[
                                        {
                                          value: "",
                                          label: selectedProvider
                                            ? `Automatic (${selectedProvider.name})`
                                            : "No compatible provider",
                                        },
                                        ...eligibleProviders.map(
                                          (provider) => ({
                                            value: provider.id,
                                            label: provider.name,
                                            description: provider.type,
                                          }),
                                        ),
                                      ]}
                                      onChange$={(providerId) => {
                                        const existing =
                                          store.settings.perFeature[feature];
                                        setFeatureOverride(feature, {
                                          providerId: providerId || undefined,
                                          // Models are provider-specific. Do
                                          // not carry a model chosen for the
                                          // old provider into the new one.
                                          model: undefined,
                                          temperature: existing?.temperature,
                                          maxTokens: existing?.maxTokens,
                                          voice: existing?.voice,
                                          speed: existing?.speed,
                                          responseFormat:
                                            existing?.responseFormat,
                                          instructions: existing?.instructions,
                                        });
                                      }}
                                    />
                                  </div>

                                  <div class="grid grid-cols-3 gap-3">
                                    <div>
                                      <label
                                        class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Model
                                      </label>
                                      <SearchableModelSelect
                                        value={selectedModel}
                                        models={selectedCatalogModels}
                                        placeholder="Search or enter a model ID"
                                        disabled={!selectedProvider}
                                        onSelect$={(model) => {
                                          const existing =
                                            store.settings.perFeature[feature];
                                          setFeatureOverride(feature, {
                                            providerId:
                                              existing?.providerId ?? undefined,
                                            model:
                                              feature !== "voice-narration" &&
                                              selectedProvider &&
                                              model ===
                                                selectedProvider.defaultModel
                                                ? undefined
                                                : model || undefined,
                                            temperature: existing?.temperature,
                                            maxTokens: existing?.maxTokens,
                                            voice: existing?.voice,
                                            speed: existing?.speed,
                                            responseFormat:
                                              existing?.responseFormat,
                                            instructions:
                                              existing?.instructions,
                                          });
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <label
                                        class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Temperature
                                      </label>
                                      <NumericStepper
                                        ariaLabel={`${FEATURE_LABELS[feature]} temperature`}
                                        min={0}
                                        max={1}
                                        step={0.1}
                                        value={
                                          store.settings.perFeature[feature]
                                            ?.temperature ?? ""
                                        }
                                        placeholder="auto"
                                        onValue$={(temperature) => {
                                          const existing =
                                            store.settings.perFeature[feature];
                                          setFeatureOverride(feature, {
                                            providerId:
                                              existing?.providerId ??
                                              store.settings
                                                .defaultProviderId ??
                                              "",
                                            model: existing?.model,
                                            temperature:
                                              temperature !== null &&
                                              temperature >= 0 &&
                                              temperature <= 1
                                                ? temperature
                                                : undefined,
                                            maxTokens: existing?.maxTokens,
                                          });
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <label
                                        class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Max tokens
                                      </label>
                                      <NumericStepper
                                        ariaLabel={`${FEATURE_LABELS[feature]} maximum tokens`}
                                        min={50}
                                        max={4000}
                                        step={10}
                                        suffix="tok"
                                        value={
                                          store.settings.perFeature[feature]
                                            ?.maxTokens ?? ""
                                        }
                                        placeholder="auto"
                                        onValue$={(tokens) => {
                                          const existing =
                                            store.settings.perFeature[feature];
                                          setFeatureOverride(feature, {
                                            providerId:
                                              existing?.providerId ??
                                              store.settings
                                                .defaultProviderId ??
                                              "",
                                            model: existing?.model,
                                            temperature: existing?.temperature,
                                            maxTokens:
                                              tokens !== null && tokens > 0
                                                ? tokens
                                                : undefined,
                                          });
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {feature === "voice-narration" && (
                                    <div class="grid gap-3 border-t border-dashed border-[var(--color-paper-3)] pt-3 sm:grid-cols-3">
                                      <div>
                                        <label
                                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                          }}
                                        >
                                          Voice
                                        </label>
                                        <input
                                          value={
                                            store.settings.perFeature[feature]
                                              ?.voice ?? ""
                                          }
                                          onInput$={(e) => {
                                            const voice = (
                                              e.target as HTMLInputElement
                                            ).value;
                                            const existing =
                                              store.settings.perFeature[
                                                feature
                                              ];
                                            setFeatureOverride(feature, {
                                              providerId:
                                                existing?.providerId ??
                                                store.settings
                                                  .defaultProviderId ??
                                                "",
                                              model: existing?.model,
                                              temperature:
                                                existing?.temperature,
                                              maxTokens: existing?.maxTokens,
                                              voice: voice || undefined,
                                              speed: existing?.speed,
                                              responseFormat:
                                                existing?.responseFormat,
                                              instructions:
                                                existing?.instructions,
                                            });
                                          }}
                                          placeholder="alloy"
                                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                            borderRadius: "2px",
                                          }}
                                        />
                                        {resolveFeatureConfig(
                                          store.settings,
                                          "voice-narration",
                                        )?.provider.type === "fishaudio" && (
                                          <p class="text-[0.65rem] text-[var(--color-ink-muted)] mt-1">
                                            Fish Audio needs the 32-character
                                            reference voice id from its voice
                                            page. Persona notes already carry
                                            their own Fish voice ids.
                                          </p>
                                        )}
                                      </div>
                                      <div>
                                        <label
                                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                          }}
                                        >
                                          Format
                                        </label>
                                        <SiteSelect
                                          value={
                                            store.settings.perFeature[feature]
                                              ?.responseFormat ?? "mp3"
                                          }
                                          ariaLabel={`Audio format for ${FEATURE_LABELS[feature]}`}
                                          options={[
                                            "mp3",
                                            "opus",
                                            "aac",
                                            "flac",
                                            "wav",
                                            "pcm",
                                          ].map((format) => ({
                                            value: format,
                                            label: format.toUpperCase(),
                                          }))}
                                          onChange$={(value) => {
                                            const responseFormat =
                                              value as AiFeatureOverride["responseFormat"];
                                            const existing =
                                              store.settings.perFeature[
                                                feature
                                              ];
                                            setFeatureOverride(feature, {
                                              providerId:
                                                existing?.providerId ??
                                                store.settings
                                                  .defaultProviderId ??
                                                "",
                                              model: existing?.model,
                                              temperature:
                                                existing?.temperature,
                                              maxTokens: existing?.maxTokens,
                                              voice: existing?.voice,
                                              speed: existing?.speed,
                                              responseFormat,
                                              instructions:
                                                existing?.instructions,
                                            });
                                          }}
                                        />
                                      </div>
                                      <div>
                                        <label
                                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                          }}
                                        >
                                          Speed
                                        </label>
                                        <NumericStepper
                                          ariaLabel={`${FEATURE_LABELS[feature]} speed`}
                                          min={0.25}
                                          max={4}
                                          step={0.05}
                                          emptyValue={1}
                                          suffix="×"
                                          value={
                                            store.settings.perFeature[feature]
                                              ?.speed ?? ""
                                          }
                                          placeholder="1"
                                          onValue$={(speed) => {
                                            const existing =
                                              store.settings.perFeature[
                                                feature
                                              ];
                                            setFeatureOverride(feature, {
                                              providerId:
                                                existing?.providerId ??
                                                store.settings
                                                  .defaultProviderId ??
                                                "",
                                              model: existing?.model,
                                              temperature:
                                                existing?.temperature,
                                              maxTokens: existing?.maxTokens,
                                              voice: existing?.voice,
                                              speed:
                                                speed !== null &&
                                                speed >= 0.25 &&
                                                speed <= 4
                                                  ? speed
                                                  : undefined,
                                              responseFormat:
                                                existing?.responseFormat,
                                              instructions:
                                                existing?.instructions,
                                            });
                                          }}
                                        />
                                      </div>
                                      <div class="sm:col-span-3">
                                        <label
                                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                          }}
                                        >
                                          Voice direction
                                        </label>
                                        <textarea
                                          value={
                                            store.settings.perFeature[feature]
                                              ?.instructions ?? ""
                                          }
                                          onInput$={(e) => {
                                            const instructions = (
                                              e.target as HTMLTextAreaElement
                                            ).value;
                                            const existing =
                                              store.settings.perFeature[
                                                feature
                                              ];
                                            setFeatureOverride(feature, {
                                              providerId:
                                                existing?.providerId ??
                                                store.settings
                                                  .defaultProviderId ??
                                                "",
                                              model: existing?.model,
                                              temperature:
                                                existing?.temperature,
                                              maxTokens: existing?.maxTokens,
                                              voice: existing?.voice,
                                              speed: existing?.speed,
                                              responseFormat:
                                                existing?.responseFormat,
                                              instructions:
                                                instructions || undefined,
                                            });
                                          }}
                                          placeholder="A calm literary-radio read, precise but not theatrical."
                                          class="w-full min-h-20 text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                                          style={{
                                            fontFamily: "var(--font-serif)",
                                            borderRadius: "2px",
                                          }}
                                        />
                                        <p
                                          class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                          }}
                                        >
                                          Built-in voices include alloy, ash,
                                          ballad, coral, echo, fable, onyx,
                                          nova, sage, shimmer, verse, marin, and
                                          cedar. Voice direction works with
                                          modern speech models, not older tts-1
                                          models.
                                        </p>
                                      </div>
                                    </div>
                                  )}

                                  <button
                                    onClick$={() => {
                                      setFeatureOverride(feature, undefined);
                                      store.openFeature = null;
                                    }}
                                    class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                                    style={{
                                      fontFamily: "var(--font-typewriter)",
                                    }}
                                  >
                                    Reset to defaults
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      },
                    )}
                  </div>
                </section>
              )}

            {/* ── Apparatus ── */}
            <section class="folio p-5">
              <h2
                class="text-base font-semibold mb-4"
                style={{ fontFamily: "var(--font-display)" }}
              >
                The Apparatus
              </h2>
              <div class="space-y-4">
                <div>
                  <label
                    class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-2"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Default citation style
                  </label>
                  <div class="flex gap-1">
                    {(["mla", "apa", "chicago"] as const).map((s) => (
                      <button
                        key={s}
                        onClick$={() => {
                          void persistApparatusSettings({
                            ...buildApparatusSettings(store),
                            defaultCitationStyle: s,
                          });
                        }}
                        class={`flex-1 text-sm py-1.5 border ${
                          store.defaultCitationStyle === s
                            ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]"
                            : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"
                        }`}
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          borderRadius: "2px",
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                        }}
                        aria-pressed={store.defaultCitationStyle === s}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <label class="flex items-center justify-between cursor-pointer">
                  <span
                    class="text-sm text-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    AI-enhance detected citations
                  </span>
                  <input
                    type="checkbox"
                    checked={store.aiEnhanceCitations}
                    onChange$={(e) => {
                      void persistApparatusSettings({
                        ...buildApparatusSettings(store),
                        aiEnhanceCitations: (e.target as HTMLInputElement)
                          .checked,
                      });
                    }}
                    class="sr-only"
                  />
                  <span
                    class={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      store.aiEnhanceCitations
                        ? "bg-[var(--color-vermilion)]"
                        : "bg-[var(--color-paper-3)]"
                    }`}
                  >
                    <span
                      class={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--color-paper)] transition-transform ${
                        store.aiEnhanceCitations
                          ? "translate-x-5"
                          : "translate-x-1"
                      }`}
                    />
                  </span>
                </label>

                <label class="flex items-center justify-between cursor-pointer">
                  <span
                    class="text-sm text-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    Flag missing sources
                  </span>
                  <input
                    type="checkbox"
                    checked={store.flagMissingSources}
                    onChange$={(e) => {
                      void persistApparatusSettings({
                        ...buildApparatusSettings(store),
                        flagMissingSources: (e.target as HTMLInputElement)
                          .checked,
                      });
                    }}
                    class="sr-only"
                  />
                  <span
                    class={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      store.flagMissingSources
                        ? "bg-[var(--color-vermilion)]"
                        : "bg-[var(--color-paper-3)]"
                    }`}
                  >
                    <span
                      class={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--color-paper)] transition-transform ${
                        store.flagMissingSources
                          ? "translate-x-5"
                          : "translate-x-1"
                      }`}
                    />
                  </span>
                </label>

                <label class="flex items-center justify-between gap-4 cursor-pointer">
                  <span>
                    <span
                      class="block text-sm text-[var(--color-ink)]"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      Auto-insert researched footnotes
                    </span>
                    <span
                      class="mt-0.5 block text-[0.65rem] text-[var(--color-ink-muted)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Place each new source beside the claim it was found for.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={store.autoInsertFootnotes}
                    onChange$={(e) => {
                      void persistApparatusSettings({
                        ...buildApparatusSettings(store),
                        autoInsertFootnotes: (e.target as HTMLInputElement)
                          .checked,
                      });
                    }}
                    class="sr-only"
                  />
                  <span
                    class={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      store.autoInsertFootnotes
                        ? "bg-[var(--color-vermilion)]"
                        : "bg-[var(--color-paper-3)]"
                    }`}
                  >
                    <span
                      class={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--color-paper)] transition-transform ${
                        store.autoInsertFootnotes
                          ? "translate-x-5"
                          : "translate-x-1"
                      }`}
                    />
                  </span>
                </label>

                <div class="pt-4 border-t border-dashed border-[var(--color-paper-3)] space-y-3">
                  <div>
                    <label
                      class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Research provider
                    </label>
                    <SiteSelect
                      value={store.researchProvider}
                      ariaLabel="Research provider"
                      options={[
                        {
                          value: "hosted",
                          label: "Hosted Twyne search",
                        },
                        {
                          value: "search-api",
                          label: "Search API key in this browser",
                        },
                        {
                          value: "model-web-search",
                          label: "Model endpoint web search",
                        },
                        { value: "web-mcp", label: "Your MCP servers" },
                      ]}
                      onChange$={(value) => {
                        void persistApparatusSettings({
                          ...buildApparatusSettings(store),
                          researchProvider:
                            value as ApparatusSettings["researchProvider"],
                        });
                      }}
                    />
                    <p
                      class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Browser-side providers fall back to hosted search if they
                      cannot return sources.
                    </p>
                  </div>

                  <div>
                    <label
                      class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Max sources per search
                    </label>
                    <NumericStepper
                      density="compact"
                      ariaLabel="maximum sources per search"
                      min={1}
                      max={20}
                      value={store.maxResults}
                      onValue$={(value) => {
                        store.maxResults = Math.max(
                          1,
                          Math.min(20, value ?? 8),
                        );
                      }}
                      onCommit$={() => {
                        void persistApparatusSettings(
                          buildApparatusSettings(store),
                        );
                      }}
                    />
                  </div>

                  {store.researchProvider === "search-api" && (
                    <div class="space-y-3">
                      <div>
                        <label
                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Search service
                        </label>
                        <SiteSelect
                          value={store.searchBackend.id}
                          ariaLabel="Search service"
                          options={SEARCH_BACKEND_IDS.map((id) => ({
                            value: id,
                            label: SEARCH_BACKENDS[id].label,
                          }))}
                          onChange$={(value) => {
                            store.searchBackend = {
                              ...store.searchBackend,
                              id: value as SearchBackendId,
                            };
                            void persistApparatusSettings(
                              buildApparatusSettings(store),
                            );
                          }}
                        />
                      </div>
                      <div>
                        <label
                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          API key
                        </label>
                        <input
                          type="password"
                          value={store.searchBackend.apiKey}
                          onInput$={(e) => {
                            store.searchBackend = {
                              ...store.searchBackend,
                              apiKey: (e.target as HTMLInputElement).value,
                            };
                          }}
                          onBlur$={() => {
                            void persistApparatusSettings(
                              buildApparatusSettings(store),
                            );
                          }}
                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "2px",
                          }}
                        />
                        <p
                          class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Stored in this browser and sent directly to{" "}
                          {SEARCH_BACKENDS[store.searchBackend.id].keyHint}.
                        </p>
                      </div>
                      <div>
                        <label
                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Endpoint URL
                          {store.searchBackend.id === "custom"
                            ? ""
                            : " (optional)"}
                        </label>
                        <input
                          value={store.searchBackend.baseUrl}
                          onInput$={(e) => {
                            store.searchBackend = {
                              ...store.searchBackend,
                              baseUrl: (e.target as HTMLInputElement).value,
                            };
                          }}
                          onBlur$={() => {
                            void persistApparatusSettings(
                              buildApparatusSettings(store),
                            );
                          }}
                          placeholder={
                            SEARCH_BACKENDS[store.searchBackend.id]
                              .defaultUrl || "https://example.com/search"
                          }
                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "2px",
                          }}
                        />
                      </div>
                      {store.searchBackend.id === "custom" && (
                        <div>
                          <label
                            class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                            style={{ fontFamily: "var(--font-typewriter)" }}
                          >
                            Results path (optional)
                          </label>
                          <input
                            value={store.searchBackend.resultsPath}
                            onInput$={(e) => {
                              store.searchBackend = {
                                ...store.searchBackend,
                                resultsPath: (e.target as HTMLInputElement)
                                  .value,
                              };
                            }}
                            onBlur$={() => {
                              void persistApparatusSettings(
                                buildApparatusSettings(store),
                              );
                            }}
                            placeholder="data.results"
                            class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                              borderRadius: "2px",
                            }}
                          />
                          <p
                            class="mt-1 text-[0.6rem] text-[var(--color-ink-muted)]"
                            style={{ fontFamily: "var(--font-typewriter)" }}
                          >
                            Where the result array sits in the response. Left
                            blank, Twyne looks for the first array of objects
                            with a url.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {store.researchProvider === "model-web-search" && (
                    <p
                      class="text-[0.65rem] text-[var(--color-ink-muted)] leading-relaxed"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Uses the Apparatus Web Search feature routing above.
                      Choose a provider/model whose endpoint has web search
                      enabled.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* ── MCP servers ── */}
            <section class="folio p-5">
              <h2
                class="text-base font-semibold mb-1"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Knowledge bases
              </h2>
              <p
                class="text-[0.65rem] text-[var(--color-ink-muted)] leading-relaxed mb-4"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Connect MCP servers — a documentation search, a notes vault, a
                company wiki. Their tools answer claim checks when the research
                provider above is set to your MCP servers, and their documents
                are readable as sources either way.
              </p>

              <div class="space-y-4">
                {store.mcpServers.map((server, index) => (
                  <div
                    key={server.id}
                    class="border border-[var(--color-paper-3)] p-3 space-y-2"
                    style={{ borderRadius: "2px" }}
                  >
                    <div class="flex items-center gap-2">
                      <input
                        value={server.label}
                        onInput$={(e) => {
                          store.mcpServers[index] = {
                            ...server,
                            label: (e.target as HTMLInputElement).value,
                          };
                        }}
                        onBlur$={() => {
                          void persistApparatusSettings(
                            buildApparatusSettings(store),
                          );
                        }}
                        placeholder="Name"
                        class="flex-1 text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          borderRadius: "2px",
                        }}
                      />
                      <label
                        class="flex items-center gap-1 text-[0.6rem] uppercase tracking-[0.15em] text-[var(--color-ink-light)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        <input
                          type="checkbox"
                          checked={server.enabled}
                          onChange$={(e) => {
                            store.mcpServers[index] = {
                              ...server,
                              enabled: (e.target as HTMLInputElement).checked,
                            };
                            void persistApparatusSettings(
                              buildApparatusSettings(store),
                            );
                          }}
                        />
                        On
                      </label>
                      <button
                        type="button"
                        onClick$={() => {
                          store.mcpServers = store.mcpServers.filter(
                            (s) => s.id !== server.id,
                          );
                          void persistApparatusSettings(
                            buildApparatusSettings(store),
                          );
                        }}
                        class="text-[0.6rem] uppercase tracking-[0.15em] text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        Remove
                      </button>
                    </div>

                    <input
                      value={server.url}
                      onInput$={(e) => {
                        store.mcpServers[index] = {
                          ...server,
                          url: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onBlur$={() => {
                        void persistApparatusSettings(
                          buildApparatusSettings(store),
                        );
                      }}
                      placeholder="https://example.com/mcp"
                      class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        borderRadius: "2px",
                      }}
                    />

                    <input
                      type="password"
                      value={server.bearerToken}
                      onInput$={(e) => {
                        store.mcpServers[index] = {
                          ...server,
                          bearerToken: (e.target as HTMLInputElement).value,
                        };
                      }}
                      onBlur$={() => {
                        void persistApparatusSettings(
                          buildApparatusSettings(store),
                        );
                      }}
                      placeholder="Bearer token (optional)"
                      class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        borderRadius: "2px",
                      }}
                    />

                    <div class="flex flex-wrap items-center gap-3">
                      <SiteSelect
                        value={server.connection}
                        ariaLabel={`Connection mode for ${server.label || "MCP server"}`}
                        class="mcp-connection-select"
                        options={[
                          { value: "auto", label: "Direct, then relay" },
                          { value: "direct", label: "Direct only" },
                          {
                            value: "proxy",
                            label: "Relay through Twyne",
                          },
                        ]}
                        onChange$={(value) => {
                          store.mcpServers[index] = {
                            ...server,
                            connection: value as McpServerConfig["connection"],
                          };
                          void persistApparatusSettings(
                            buildApparatusSettings(store),
                          );
                        }}
                      />

                      <input
                        value={server.searchToolName}
                        onInput$={(e) => {
                          store.mcpServers[index] = {
                            ...server,
                            searchToolName: (e.target as HTMLInputElement)
                              .value,
                          };
                        }}
                        onBlur$={() => {
                          void persistApparatusSettings(
                            buildApparatusSettings(store),
                          );
                        }}
                        placeholder="Search tool (auto)"
                        class="text-xs px-2 py-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          borderRadius: "2px",
                        }}
                      />

                      <label
                        class="flex items-center gap-1 text-[0.6rem] uppercase tracking-[0.15em] text-[var(--color-ink-light)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        <input
                          type="checkbox"
                          checked={server.exposeToModel}
                          onChange$={(e) => {
                            store.mcpServers[index] = {
                              ...server,
                              exposeToModel: (e.target as HTMLInputElement)
                                .checked,
                            };
                            void persistApparatusSettings(
                              buildApparatusSettings(store),
                            );
                          }}
                        />
                        Offer tools while writing
                      </label>

                      <button
                        type="button"
                        disabled={store.mcpProbeBusy === server.id}
                        onClick$={async () => {
                          store.mcpProbeBusy = server.id;
                          store.mcpProbes = {
                            ...store.mcpProbes,
                            [server.id]: "Connecting…",
                          };
                          const report = await probeMcpServer(
                            store.mcpServers[index],
                            convexClientSig.value ?? null,
                          );
                          store.mcpProbes = {
                            ...store.mcpProbes,
                            [server.id]: report,
                          };
                          store.mcpProbeBusy = null;
                        }}
                        class="text-[0.6rem] uppercase tracking-[0.15em] px-2 py-1 border border-[var(--color-paper-3)] hover:border-[var(--color-vermilion)] disabled:opacity-50"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          borderRadius: "2px",
                        }}
                      >
                        {store.mcpProbeBusy === server.id ? "…" : "Test"}
                      </button>
                    </div>

                    {store.mcpProbes[server.id] && (
                      <p
                        class="text-[0.6rem] text-[var(--color-ink-muted)] leading-relaxed whitespace-pre-line"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        {store.mcpProbes[server.id]}
                      </p>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick$={() => {
                    store.mcpServers = [
                      ...store.mcpServers,
                      {
                        ...DEFAULT_MCP_SERVER,
                        id: `mcp-${crypto.randomUUID().slice(0, 8)}`,
                      },
                    ];
                  }}
                  class="text-[0.65rem] uppercase tracking-[0.15em] px-3 py-1.5 border border-[var(--color-paper-3)] hover:border-[var(--color-vermilion)]"
                  style={{
                    fontFamily: "var(--font-typewriter)",
                    borderRadius: "2px",
                  }}
                >
                  Add server
                </button>
              </div>
            </section>

            {/* ── Advanced ── */}
            <section class="folio p-5">
              <h2
                class="text-base font-semibold mb-4"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Advanced
              </h2>
              <div class="space-y-4">
                <label class="flex items-center justify-between cursor-pointer">
                  <div>
                    <span
                      class="text-sm text-[var(--color-ink)] block"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      Show provider tags
                    </span>
                    <span
                      class="text-[0.65rem] text-[var(--color-ink-muted)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Display which AI served each response
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={store.settings.showProviderTags}
                    onChange$={(e) => {
                      store.settings = {
                        ...store.settings,
                        showProviderTags: (e.target as HTMLInputElement)
                          .checked,
                      };
                      void persist();
                    }}
                    class="sr-only"
                  />
                  <span
                    class={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      store.settings.showProviderTags
                        ? "bg-[var(--color-vermilion)]"
                        : "bg-[var(--color-paper-3)]"
                    }`}
                  >
                    <span
                      class={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--color-paper)] transition-transform ${
                        store.settings.showProviderTags
                          ? "translate-x-5"
                          : "translate-x-1"
                      }`}
                    />
                  </span>
                </label>

                <div class="pt-3 border-t border-dashed border-[var(--color-paper-3)]">
                  <button
                    onClick$={() => {
                      store.showResetDialog = true;
                    }}
                    class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-vermilion)] hover:text-[var(--color-vermilion-2)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Reset all AI settings
                  </button>
                </div>

                <div class="p-3 bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)]">
                  <p
                    class="text-[0.65rem] text-[var(--color-ink-muted)] leading-relaxed"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    <strong
                      class="text-[var(--color-ink-light)]"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      Privacy note
                    </strong>
                    <br />
                    Your API keys are stored only in your browser&apos;s
                    IndexedDB. Most calls go directly to your provider. Tinker
                    blocks browser CORS, so its key passes transiently through a
                    fixed Twyne relay for Tinker requests only; it is not stored
                    or logged by Twyne.
                  </p>
                </div>
              </div>
            </section>

            {/* ── Writer handle (public identity) ── */}
            {auth.value.provider === "convex" && store.handleLoaded && (
              <section class="folio p-5 border border-[var(--color-paper-3)]">
                <h2
                  class="text-base font-semibold mb-1"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Writer handle
                </h2>
                <p class="text-xs text-[var(--color-ink-light)] mb-4">
                  Your handle is your public address on Twyne — it appears in
                  your share URLs (
                  <code
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >{`/<handle>/<slug>`}</code>
                  ) and on your profile page (
                  <code
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >{`/<handle>`}</code>
                  ). You can change it; the old handle is freed immediately.
                </p>

                {store.handleToast && (
                  <p
                    class="mb-3 text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-accent-green)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    {store.handleToast}
                  </p>
                )}
                {store.handleError && (
                  <div class="mb-3">
                    {typeof store.handleError === "string" ? (
                      <p
                        class="text-[0.7rem] text-[var(--color-vermilion)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                        role="alert"
                      >
                        {store.handleError}
                      </p>
                    ) : (
                      <ApplicationNotice
                        error={store.handleError}
                        compact
                        onDismiss$={() => {
                          store.handleError = null;
                        }}
                      />
                    )}
                  </div>
                )}

                <label
                  class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                  for="writer-handle"
                >
                  Handle
                </label>
                <div class="flex items-stretch gap-2 mb-1">
                  <span
                    class="inline-flex items-center px-2 text-[0.7rem] text-[var(--color-ink-muted)] border border-r-0 border-[var(--color-paper-3)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    twyne.love/
                  </span>
                  <input
                    id="writer-handle"
                    type="text"
                    value={store.handleDraft}
                    onInput$={(e) => {
                      store.handleDraft = (e.target as HTMLInputElement).value;
                      store.handleError = null;
                      store.handleToast = null;
                    }}
                    placeholder="your-name"
                    spellcheck={false}
                    autocomplete="off"
                    autocapitalize="off"
                    class="flex-1 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  />
                </div>
                <div class="text-[0.7rem] min-h-[1.2em] mb-3">
                  {store.handleCheckBusy && (
                    <span
                      class="text-[var(--color-ink-muted)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Checking…
                    </span>
                  )}
                  {!store.handleCheckBusy && store.handleCheck?.available && (
                    <span
                      class="text-[var(--color-accent-green)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      @{store.handleCheck.handle} is available.
                    </span>
                  )}
                  {!store.handleCheckBusy &&
                    store.handleCheck &&
                    !store.handleCheck.available && (
                      <div class="mt-2">
                        {store.handleCheck.error && (
                          <ApplicationNotice
                            error={store.handleCheck.error}
                            compact
                          />
                        )}
                      </div>
                    )}
                  {!store.handleCheck &&
                    !store.handleCheckBusy &&
                    store.handleDraft.trim() === store.handle && (
                      <span
                        class="text-[var(--color-ink-muted)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        Current handle: @{store.handle}.
                      </span>
                    )}
                </div>
                <button
                  onClick$={handleClaim}
                  disabled={
                    store.handleBusy ||
                    !store.handleDraft.trim() ||
                    store.handleDraft.trim() === store.handle
                  }
                  class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--color-ink)",
                    fontFamily: "var(--font-typewriter)",
                  }}
                >
                  {store.handleBusy
                    ? "Saving…"
                    : store.handle
                      ? "Change handle"
                      : "Claim handle"}
                </button>

                {/* Optional profile metadata — shown only after a handle is claimed. */}
                {store.handle && (
                  <div class="mt-6 pt-5 border-t border-dashed border-[var(--color-paper-3)]">
                    <p
                      class="text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-3"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Profile (optional)
                    </p>
                    {/* Profile picture */}
                    <div class="mb-4 flex items-center gap-4">
                      <div
                        class="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--color-paper-3)] bg-[var(--color-paper)]"
                        aria-hidden="true"
                      >
                        {store.profileAvatarUrl ? (
                          <img
                            src={store.profileAvatarUrl}
                            alt=""
                            width="64"
                            height="64"
                            class="h-full w-full object-cover"
                          />
                        ) : (
                          <svg
                            width="28"
                            height="28"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--color-ink-muted)"
                            stroke-width="1.5"
                          >
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        )}
                      </div>
                      <div class="flex-1">
                        <label
                          class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                          for="writer-avatar"
                        >
                          Profile picture
                        </label>
                        <div class="flex flex-wrap items-center gap-2">
                          <input
                            id="writer-avatar"
                            type="file"
                            accept="image/*"
                            disabled={store.profileAvatarBusy}
                            onChange$={(e) => {
                              const input = e.target as HTMLInputElement;
                              const file = input.files?.[0];
                              if (file) void handleAvatarSelected(file);
                              input.value = "";
                            }}
                            class="block w-full text-xs text-[var(--color-ink-light)] file:mr-3 file:border file:border-[var(--color-paper-3)] file:bg-[var(--color-paper)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--color-ink)] hover:file:border-[var(--color-ink)]"
                            style={{ fontFamily: "var(--font-typewriter)" }}
                          />
                          {store.profileAvatarUrl && (
                            <button
                              type="button"
                              onClick$={handleAvatarClear}
                              disabled={store.profileAvatarBusy}
                              class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline disabled:opacity-50"
                              style={{ fontFamily: "var(--font-typewriter)" }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <p
                          class="mt-1 text-[0.65rem] text-[var(--color-ink-muted)]"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          {store.profileAvatarBusy
                            ? "Working…"
                            : "PNG or JPG, up to 5 MB. Shown on your public profile."}
                        </p>
                      </div>
                    </div>
                    <label
                      class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                      for="writer-display-name"
                    >
                      Display name
                    </label>
                    <input
                      id="writer-display-name"
                      type="text"
                      value={store.profileDisplayName}
                      onInput$={(e) =>
                        (store.profileDisplayName = (
                          e.target as HTMLInputElement
                        ).value)
                      }
                      placeholder="The name shown on your profile"
                      class="w-full mb-3 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                      maxLength={60}
                    />
                    <label
                      class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                      for="writer-bio"
                    >
                      Bio
                    </label>
                    <textarea
                      id="writer-bio"
                      value={store.profileBio}
                      onInput$={(e) =>
                        (store.profileBio = (
                          e.target as HTMLTextAreaElement
                        ).value)
                      }
                      placeholder="One short line about your writing."
                      rows={2}
                      class="w-full mb-3 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)] resize-none"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                      maxLength={280}
                    />
                    {store.profileToast && (
                      <p
                        class="mb-2 text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-accent-green)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        {store.profileToast}
                      </p>
                    )}
                    <div class="flex items-center gap-3">
                      <button
                        onClick$={handleSaveProfile}
                        disabled={store.profileBusy}
                        class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
                        style={{
                          backgroundColor: "var(--color-ink)",
                          fontFamily: "var(--font-typewriter)",
                        }}
                      >
                        {store.profileBusy ? "Saving…" : "Save profile"}
                      </button>
                      <a
                        href={`/${store.handle}`}
                        class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        View your public profile →
                      </a>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── CLI and MCP access ── */}
            {auth.value.provider === "convex" && (
              <section class="folio p-5 border border-[var(--color-paper-3)]">
                <h2
                  class="text-base font-semibold mb-1"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  CLI &amp; MCP access
                </h2>
                <p class="text-xs text-[var(--color-ink-light)] mb-4 leading-relaxed">
                  Give writing tools permission to import and export folios,
                  read critiques and rubrics, and work with your citations. A
                  token is shown once; Twyne stores only its fingerprint.
                </p>

                {store.integrationTokenError && (
                  <div class="mb-3">
                    <ApplicationNotice
                      error={store.integrationTokenError}
                      compact
                      onRetry$={refreshIntegrationTokens}
                      onDismiss$={() => {
                        store.integrationTokenError = null;
                      }}
                    />
                  </div>
                )}

                {store.newIntegrationToken && (
                  <div class="mb-5 p-3 border border-[var(--color-accent-green)] bg-[var(--color-paper-soft)]">
                    <p
                      class="text-[0.65rem] tracking-[0.14em] uppercase text-[var(--color-accent-green)] mb-2"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Copy this token now — it won&apos;t be shown again
                    </p>
                    <textarea
                      readOnly
                      rows={3}
                      value={store.newIntegrationToken}
                      class="w-full p-2 text-xs break-all bg-[var(--color-paper)] text-[var(--color-ink)] border border-[var(--color-paper-3)] resize-none"
                      style={{ fontFamily: "var(--font-mono)" }}
                      aria-label="New Twyne access token"
                    />
                    <div class="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        onClick$={handleCopyIntegrationToken}
                        class="btn-press text-xs text-[var(--color-paper)]"
                        style={{
                          backgroundColor: "var(--color-ink)",
                          fontFamily: "var(--font-typewriter)",
                        }}
                      >
                        {store.integrationTokenCopied ? "Copied" : "Copy token"}
                      </button>
                      <button
                        type="button"
                        onClick$={() => {
                          store.newIntegrationToken = null;
                          store.integrationTokenCopied = false;
                        }}
                        class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-ink-muted)] hover:underline"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}

                <div class="flex flex-col sm:flex-row gap-2 mb-3">
                  <input
                    type="text"
                    value={store.integrationTokenName}
                    onInput$={(event) => {
                      store.integrationTokenName = (
                        event.target as HTMLInputElement
                      ).value;
                    }}
                    placeholder="Token name, e.g. Claude Desktop"
                    maxLength={80}
                    class="flex-1 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  />
                  <button
                    type="button"
                    onClick$={handleCreateIntegrationToken}
                    disabled={store.integrationTokenBusy}
                    class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
                    style={{
                      backgroundColor: "var(--color-ink)",
                      fontFamily: "var(--font-typewriter)",
                    }}
                  >
                    {store.integrationTokenBusy ? "Working…" : "Create token"}
                  </button>
                </div>

                {integrationApiUrl && (
                  <div class="mb-4 p-3 bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)]">
                    <p class="text-xs text-[var(--color-ink-light)] mb-2">
                      After installing the Twyne tools, run this once and paste
                      the token when asked:
                    </p>
                    <code
                      class="block text-[0.7rem] text-[var(--color-ink)] break-all"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      twyne auth login --url {integrationApiUrl}
                    </code>
                    <p class="mt-2 text-[0.68rem] text-[var(--color-ink-muted)]">
                      MCP hosts can then launch <code>twyne-mcp</code>; it reads
                      the same local login.
                    </p>
                  </div>
                )}

                <div class="space-y-2">
                  {!store.integrationTokensLoaded && (
                    <p class="text-xs text-[var(--color-ink-muted)]">
                      Loading tokens…
                    </p>
                  )}
                  {store.integrationTokensLoaded &&
                    store.integrationTokens.length === 0 && (
                      <p class="text-xs text-[var(--color-ink-muted)]">
                        No CLI or MCP tokens yet.
                      </p>
                    )}
                  {store.integrationTokens.map((token) => (
                    <div
                      key={token.id}
                      class="flex items-center justify-between gap-3 p-2 border border-[var(--color-paper-3)]"
                    >
                      <div class="min-w-0">
                        <p class="text-sm text-[var(--color-ink)] truncate">
                          {token.name}
                        </p>
                        <p
                          class="text-[0.65rem] text-[var(--color-ink-muted)]"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {token.prefix}… · created{" "}
                          {new Date(token.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick$={() => handleRevokeIntegrationToken(token.id)}
                        disabled={store.integrationTokenBusy}
                        class="text-[0.65rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline disabled:opacity-50"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Danger zone: account deletion ── */}
            {auth.value.provider === "convex" && (
              <section class="folio p-5 border border-[var(--color-vermilion)]/40">
                <h2
                  class="text-base font-semibold mb-1"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Delete account
                </h2>
                <p class="text-xs text-[var(--color-ink-light)] mb-4">
                  Permanently deletes your account and everything you've synced
                  — folios, briefs, persona notes, rubric, published pieces, and
                  payment state. Local-only browser data stays until you clear
                  it. This cannot be undone.
                </p>
                {store.accountToast && (
                  <p
                    class="mb-3 text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-accent-green)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    {store.accountToast}
                  </p>
                )}
                {store.accountError && (
                  <div class="mb-3">
                    <ApplicationNotice
                      error={store.accountError}
                      compact
                      onRetry$={
                        store.accountError.recovery.canRetry
                          ? openDeleteAccountDialog
                          : undefined
                      }
                      onDismiss$={() => {
                        store.accountError = null;
                      }}
                    />
                  </div>
                )}
                <button
                  onClick$={openDeleteAccountDialog}
                  disabled={store.deletingAccount}
                  class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-60"
                  style={{
                    backgroundColor: "var(--color-vermilion)",
                    fontFamily: "var(--font-typewriter)",
                  }}
                >
                  {store.deletingAccount
                    ? "Deleting…"
                    : "Delete my account and synced data"}
                </button>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {store.toast && (
        <div
          class="fixed bottom-6 right-6 z-50 px-4 py-2.5 bg-[var(--color-ink)] text-[var(--color-paper)]"
          style={{
            fontFamily: "var(--font-typewriter)",
            fontSize: "0.75rem",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            borderRadius: "2px",
          }}
        >
          {store.toast}
        </div>
      )}

      <ThemedDialog
        open={store.showResetDialog}
        title="Reset all AI settings?"
        message="This removes saved providers, models, and keys from the current browser and restores Twyne's defaults."
        confirmLabel="Reset settings"
        tone="danger"
        onCancel$={() => {
          store.showResetDialog = false;
        }}
        onConfirm$={resetAll}
      />

      <ThemedDialog
        open={store.showDeleteDialog}
        title="Delete your account?"
        message="This permanently deletes your Twyne account and every synced folio, brief, note, rubric result, and published piece. Export anything you want to keep first."
        confirmLabel={store.deletingAccount ? "Deleting…" : "Delete account"}
        tone="danger"
        busy={store.deletingAccount}
        confirmDisabled={store.deletingAccount}
        error={store.deleteDialogError}
        inputLabel="Type DELETE to confirm"
        inputValue={store.deleteConfirmText}
        inputPlaceholder="DELETE"
        inputHelp="This step is irreversible."
        onInput$={(value) => {
          store.deleteConfirmText = value;
          store.deleteDialogError = null;
        }}
        onCancel$={() => {
          if (store.deletingAccount) return;
          store.showDeleteDialog = false;
          store.deleteConfirmText = "";
          store.deleteDialogError = null;
        }}
        onConfirm$={handleDeleteAccount}
      />
    </div>
  );
});

export const head: DocumentHead = {
  title: "The Editor's Desk · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Configure AI providers, models, and per-feature settings for Twyne.",
    },
  ],
};
