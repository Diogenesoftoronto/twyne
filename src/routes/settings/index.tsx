import { component$, useStore, useVisibleTask$, $ } from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { signOut } from "../../utils/auth-client";
import { clearConvexSyncContext } from "../../utils/convex-sync";
import { api } from "../../../convex/_generated/api";
import type {
  AiSettings,
  AiProviderConfig,
  AiFeature,
  AiFeatureOverride,
} from "../../types";
import { DEFAULT_AI_SETTINGS, PROVIDER_METAS } from "../../types";
import {
  loadAiSettingsFromIdb,
  saveAiSettingsToIdb,
  loadWriterSettingsFromIdb,
  saveWriterSettingsToIdb,
} from "../../utils/idb";
import {
  testProvider,
  resolveFeatureConfig,
  normalizeAiSettings,
  stripManagedDesktopLocalProvider,
} from "../../utils/ai-client";
import { LOCAL_PROVIDER_ID } from "../../utils/desktop-bridge";
import { useFeatureFlags } from "../../utils/posthog-context";

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
  newProviderModel: string;
  testingProvider: boolean;
  testResult: { ok: boolean; latencyMs: number; error?: string } | null;
  /* editing */
  editingProviderId: string | null;
  editKey: string;
  /* per-feature overrides open */
  openFeature: AiFeature | null;
  /* writer preferences */
  writerStyle: "form" | "conversational";
  writerToast: string | null;
  /* apparatus */
  defaultCitationStyle: "mla" | "apa" | "chicago";
  aiEnhanceCitations: boolean;
  flagMissingSources: boolean;
  /* account deletion (danger zone) */
  deletingAccount: boolean;
  accountToast: string | null;
  accountError: string | null;
  /* writer handle (public identity) */
  handleLoaded: boolean;
  handle: string | null;
  handleDraft: string;
  handleBusy: boolean;
  handleError: string | null;
  handleToast: string | null;
  handleCheck: {
    available: boolean;
    normalized?: string;
    reason?: string;
  } | null;
  handleCheckBusy: boolean;
  profileDisplayName: string;
  profileBio: string;
  profileBusy: boolean;
  profileToast: string | null;
}

const FEATURE_LABELS: Record<AiFeature, string> = {
  "persona-feedback": "Convene the Room",
  "persona-reply": "Reply Thread",
  "persona-rewrite": "Mark Up Draft",
  "rubric-judge": "Galley Proof",
  "voice-narration": "Voice Narration",
  "comment-reply": "Ask Editor (Notes)",
  "citation-format": "Citation Format",
  "source-summarize": "Source Summarize",
  "source-detect-missing": "Missing Source Detection",
  "interview-turn": "Conversational Interview",
  "dossier-check": "Read My Draft",
};

const FEATURE_DESCRIPTIONS: Record<AiFeature, string> = {
  "persona-feedback": "All five editors read your draft at once.",
  "persona-reply": "A single editor responds in a threaded conversation.",
  "persona-rewrite": "Editors propose specific text replacements.",
  "rubric-judge": "Five judges score the draft, then the rubric combines.",
  "voice-narration":
    "Turns selected prose into spoken audio. BYOK uses your speech-capable provider; Pro can use Twyne-hosted voice.",
  "comment-reply": "Ask an editor to weigh in on a margin note.",
  "citation-format": "Auto-format detected citations in your chosen style.",
  "source-summarize": "AI summarizes saved sources for your bibliography.",
  "source-detect-missing":
    "AI detects claims in your draft that need citations.",
  "interview-turn":
    "The room interviews you, one question at a time, and synthesises a dossier from your answers.",
  "dossier-check":
    "Cross-references the dossier against the current draft and surfaces where the draft has outgrown the brief.",
};

/* ── Component ──────────────────────────────────────────────────── */

export default component$(() => {
  const featureFlags = useFeatureFlags();
  const convexClientSig = useConvexClient();
  const auth = useAuth();
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
    newProviderModel: "",
    testingProvider: false,
    testResult: null,
    editingProviderId: null,
    editKey: "",
    openFeature: null,
    defaultCitationStyle: "mla",
    aiEnhanceCitations: false,
    flagMissingSources: false,
    writerStyle: "form",
    writerToast: null,
    deletingAccount: false,
    accountToast: null,
    accountError: null,
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
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const raw = await loadAiSettingsFromIdb();
    store.settings = normalizeAiSettings(raw);
    const writer = await loadWriterSettingsFromIdb();
    store.writerStyle = writer.interviewStyle;
    store.loaded = true;
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

  const persist = $(async () => {
    store.saving = true;
    await saveAiSettingsToIdb(stripManagedDesktopLocalProvider(store.settings));
    store.saving = false;
    store.toast = "Settings saved";
    setTimeout(() => (store.toast = null), 2000);
  });

  const addProvider = $(async () => {
    const meta = PROVIDER_METAS.find((m) => m.type === store.newProviderType);
    if (!meta) return;
    if (!store.newProviderName.trim() || !store.newProviderKey.trim()) return;

    const config: AiProviderConfig = {
      id: `pv-${Date.now()}`,
      name: store.newProviderName.trim(),
      type: store.newProviderType as AiProviderConfig["type"],
      apiKey: store.newProviderKey.trim(),
      baseUrl: store.newProviderBaseUrl.trim() || undefined,
      defaultModel:
        store.newProviderModel.trim() || meta.defaultModels[0] || "",
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
    store.newProviderModel = "";
    await persist();
  });

  const removeProvider = $((id: string) => {
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

  const runTest = $(async (config: AiProviderConfig) => {
    store.testingProvider = true;
    store.testResult = null;
    store.testResult = await testProvider(config);
    store.testingProvider = false;
  });

  const setFeatureOverride = $(
    (feature: AiFeature, override: AiFeatureOverride | undefined) => {
      store.settings = {
        ...store.settings,
        perFeature: {
          ...store.settings.perFeature,
          [feature]: override,
        },
      };
      void persist();
    },
  );

  const resetAll = $(async () => {
    if (
      !confirm(
        "Reset all AI settings to defaults? Providers and keys will be removed.",
      )
    )
      return;
    store.settings = DEFAULT_AI_SETTINGS;
    await saveAiSettingsToIdb(DEFAULT_AI_SETTINGS);
    store.toast = "Reset to defaults";
    setTimeout(() => (store.toast = null), 2000);
  });

  const handleDeleteAccount = $(async () => {
    const client = convexClientSig.value;
    if (!client) {
      store.accountError = "Not connected. Try again in a moment.";
      return;
    }
    // The substantive deletion is irreversible. Gate it behind a typed
    // confirmation so a stray click can't wipe an account.
    if (
      !confirm(
        "Permanently delete your Twyne account and all synced data? This cannot be undone. Export any folios you want to keep first.",
      )
    )
      return;
    const typed = prompt("Type DELETE to confirm:");
    if (typed !== "DELETE") {
      store.accountError = "Cancelled — nothing was deleted.";
      return;
    }
    store.deletingAccount = true;
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
      store.deletingAccount = false;
      window.location.href = "/";
    } catch (e: any) {
      store.accountError =
        e?.message ?? "Could not delete account. Please try again.";
      store.deletingAccount = false;
    }
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
      } | null;
      store.handle = row?.handle ?? null;
      store.handleDraft = row?.handle ?? "";
      store.profileDisplayName = row?.displayName ?? "";
      store.profileBio = row?.bio ?? "";
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
        const result = (await client.query(
          api.profiles.checkHandleAvailable,
          { handle: draft },
        )) as
          | { available: true; handle: string }
          | { available: false; reason: string };
        store.handleCheck = result;
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
      store.handleError = "Not connected. Try again in a moment.";
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
    } catch (e: any) {
      store.handleError = e?.message ?? "Could not claim handle.";
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
    } catch (e: any) {
      store.profileToast = null;
      // Surface via handle's error channel for visibility.
      store.handleError = e?.message ?? "Could not save profile.";
    } finally {
      store.profileBusy = false;
    }
  });

  return (
    <div
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
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
            {/* ── Writer preferences (always shown, no BYOK required) ── */}
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
                  onClick$={$(async () => {
                    const cur = await loadWriterSettingsFromIdb();
                    await saveWriterSettingsToIdb({
                      ...cur,
                      interviewStyle: "form",
                    });
                    store.writerStyle = "form";
                    store.writerToast = "Form mode set";
                    setTimeout(() => (store.writerToast = null), 1800);
                  })}
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
                  onClick$={$(async () => {
                    const cur = await loadWriterSettingsFromIdb();
                    await saveWriterSettingsToIdb({
                      ...cur,
                      interviewStyle: "conversational",
                    });
                    store.writerStyle = "conversational";
                    store.writerToast = "Conversation mode set";
                    setTimeout(() => (store.writerToast = null), 1800);
                  })}
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
                  <button
                    onClick$={() => {
                      store.showAddProvider = true;
                      store.newProviderType = "openai";
                      store.newProviderModel =
                        PROVIDER_METAS.find((m) => m.type === "openai")
                          ?.defaultModels[0] ?? "";
                    }}
                    class="btn-press text-xs"
                  >
                    + Add provider
                  </button>
                </div>

                {/* Provider list */}
                <div class="space-y-3">
                  {store.settings.providers.map((p) => {
                    const isManagedLocal = p.id === LOCAL_PROVIDER_ID;
                    return (
                      <div
                        key={p.id}
                        class="p-3 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
                        style={{ borderRadius: "2px" }}
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span
                                class="text-xs font-semibold text-[var(--color-ink)]"
                                style={{ fontFamily: "var(--font-display)" }}
                              >
                                {p.name}
                              </span>
                              <span
                                class="text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)]"
                                style={{ fontFamily: "var(--font-typewriter)" }}
                              >
                                {PROVIDER_METAS.find((m) => m.type === p.type)
                                  ?.label ?? p.type}
                              </span>
                              {store.settings.defaultProviderId === p.id && (
                                <span
                                  class="text-[0.6rem] tracking-[0.15em] uppercase px-1.5 py-0.5 border"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                    borderColor: "var(--color-accent-green)",
                                    color: "var(--color-accent-green)",
                                    borderRadius: "1px",
                                  }}
                                >
                                  default
                                </span>
                              )}
                              {isManagedLocal && (
                                <span
                                  class="text-[0.6rem] tracking-[0.15em] uppercase px-1.5 py-0.5 border"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                    borderColor: "var(--color-accent-blue)",
                                    color: "var(--color-accent-blue)",
                                    borderRadius: "1px",
                                  }}
                                >
                                  desktop
                                </span>
                              )}
                            </div>
                            <p
                              class="text-[0.65rem] text-[var(--color-ink-muted)] mt-0.5"
                              style={{ fontFamily: "var(--font-mono)" }}
                            >
                              {p.defaultModel}
                            </p>

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
                              <div class="mt-2 flex flex-wrap items-center gap-2">
                                {!isManagedLocal && (
                                  <button
                                    onClick$={() => {
                                      store.editingProviderId = p.id;
                                      store.editKey = "";
                                    }}
                                    class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                                    style={{
                                      fontFamily: "var(--font-typewriter)",
                                    }}
                                  >
                                    Change key
                                  </button>
                                )}
                                <button
                                  onClick$={() => runTest(p)}
                                  disabled={store.testingProvider}
                                  class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent-green)] disabled:opacity-40"
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                  }}
                                >
                                  {store.testingProvider
                                    ? "Testing…"
                                    : "Test connection"}
                                </button>
                                {store.settings.defaultProviderId !== p.id && (
                                  <button
                                    onClick$={() => setDefaultProvider(p.id)}
                                    class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                                    style={{
                                      fontFamily: "var(--font-typewriter)",
                                    }}
                                  >
                                    Set as default
                                  </button>
                                )}
                                {!isManagedLocal && (
                                  <button
                                    onClick$={() => removeProvider(p.id)}
                                    class="text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                                    style={{
                                      fontFamily: "var(--font-typewriter)",
                                    }}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            )}

                            {store.testResult &&
                              store.testingProvider === false && (
                                <p
                                  class={`mt-1.5 text-[0.65rem] ${
                                    store.testResult.ok
                                      ? "text-[var(--color-accent-green)]"
                                      : "text-[var(--color-vermilion)]"
                                  }`}
                                  style={{
                                    fontFamily: "var(--font-typewriter)",
                                  }}
                                >
                                  {store.testResult.ok
                                    ? `✓ Connected (${store.testResult.latencyMs}ms)`
                                    : `✗ ${store.testResult.error}`}
                                </p>
                              )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add provider form */}
                {store.showAddProvider && (
                  <div class="mt-4 p-4 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
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
                          Provider type
                        </label>
                        <select
                          value={store.newProviderType}
                          onChange$={(e) => {
                            const type = (e.target as HTMLSelectElement).value;
                            store.newProviderType = type;
                            const m = PROVIDER_METAS.find(
                              (meta) => meta.type === type,
                            );
                            store.newProviderModel = m?.defaultModels[0] ?? "";
                          }}
                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "2px",
                          }}
                        >
                          {PROVIDER_METAS.filter(
                            (m) => m.type !== "litert",
                          ).map((m) => (
                            <option key={m.type} value={m.type}>
                              {m.label}
                            </option>
                          ))}
                        </select>
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
                          placeholder="sk-..."
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
                          Stored only in your browser. Never sent to our
                          servers.
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
                            placeholder="https://api.example.com/v1"
                            class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                              borderRadius: "2px",
                            }}
                          />
                        </div>
                      )}

                      <div>
                        <label
                          class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                          style={{ fontFamily: "var(--font-typewriter)" }}
                        >
                          Model
                        </label>
                        <input
                          value={store.newProviderModel}
                          onInput$={(e) => {
                            store.newProviderModel = (
                              e.target as HTMLInputElement
                            ).value;
                          }}
                          placeholder={
                            PROVIDER_METAS.find(
                              (m) => m.type === store.newProviderType,
                            )?.defaultModels[0] ?? ""
                          }
                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            borderRadius: "2px",
                          }}
                        />
                      </div>

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
                                    <select
                                      value={
                                        store.settings.perFeature[feature]
                                          ?.providerId ??
                                        store.settings.defaultProviderId ??
                                        ""
                                      }
                                      onChange$={(e) => {
                                        const providerId = (
                                          e.target as HTMLSelectElement
                                        ).value;
                                        const existing =
                                          store.settings.perFeature[feature];
                                        setFeatureOverride(feature, {
                                          providerId,
                                          model: existing?.model,
                                          temperature: existing?.temperature,
                                          maxTokens: existing?.maxTokens,
                                        });
                                      }}
                                      class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                                      style={{
                                        fontFamily: "var(--font-typewriter)",
                                        borderRadius: "2px",
                                      }}
                                    >
                                      <option value="">
                                        Use default provider
                                      </option>
                                      {store.settings.providers.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {`${p.name} (${p.type})`}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div class="grid grid-cols-3 gap-3">
                                    <div>
                                      <label
                                        class="block text-[0.6rem] tracking-[0.2em] uppercase text-[var(--color-ink-light)] mb-1"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Model override
                                      </label>
                                      <input
                                        value={
                                          store.settings.perFeature[feature]
                                            ?.model ?? ""
                                        }
                                        onInput$={(e) => {
                                          const model = (
                                            e.target as HTMLInputElement
                                          ).value;
                                          const existing =
                                            store.settings.perFeature[feature];
                                          setFeatureOverride(feature, {
                                            providerId:
                                              existing?.providerId ??
                                              store.settings
                                                .defaultProviderId ??
                                              "",
                                            model: model || undefined,
                                            temperature: existing?.temperature,
                                            maxTokens: existing?.maxTokens,
                                          });
                                        }}
                                        placeholder="default"
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
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Temperature
                                      </label>
                                      <input
                                        type="number"
                                        min={0}
                                        max={1}
                                        step={0.1}
                                        value={
                                          store.settings.perFeature[feature]
                                            ?.temperature ?? ""
                                        }
                                        onInput$={(e) => {
                                          const temp = Number(
                                            (e.target as HTMLInputElement)
                                              .value,
                                          );
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
                                              temp >= 0 && temp <= 1
                                                ? temp
                                                : undefined,
                                            maxTokens: existing?.maxTokens,
                                          });
                                        }}
                                        placeholder="auto"
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
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                        }}
                                      >
                                        Max tokens
                                      </label>
                                      <input
                                        type="number"
                                        min={50}
                                        max={4000}
                                        step={10}
                                        value={
                                          store.settings.perFeature[feature]
                                            ?.maxTokens ?? ""
                                        }
                                        onInput$={(e) => {
                                          const tokens = Number(
                                            (e.target as HTMLInputElement)
                                              .value,
                                          );
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
                                              tokens > 0 ? tokens : undefined,
                                          });
                                        }}
                                        placeholder="auto"
                                        class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                                        style={{
                                          fontFamily: "var(--font-typewriter)",
                                          borderRadius: "2px",
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
                                        <select
                                          value={
                                            store.settings.perFeature[feature]
                                              ?.responseFormat ?? "mp3"
                                          }
                                          onChange$={(e) => {
                                            const responseFormat = (
                                              e.target as HTMLSelectElement
                                            )
                                              .value as AiFeatureOverride["responseFormat"];
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
                                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                            borderRadius: "2px",
                                          }}
                                        >
                                          {(
                                            [
                                              "mp3",
                                              "opus",
                                              "aac",
                                              "flac",
                                              "wav",
                                              "pcm",
                                            ] as const
                                          ).map((fmt) => (
                                            <option key={fmt} value={fmt}>
                                              {fmt}
                                            </option>
                                          ))}
                                        </select>
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
                                        <input
                                          type="number"
                                          min={0.25}
                                          max={4}
                                          step={0.05}
                                          value={
                                            store.settings.perFeature[feature]
                                              ?.speed ?? ""
                                          }
                                          onInput$={(e) => {
                                            const speed = Number(
                                              (e.target as HTMLInputElement)
                                                .value,
                                            );
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
                                                speed >= 0.25 && speed <= 4
                                                  ? speed
                                                  : undefined,
                                              responseFormat:
                                                existing?.responseFormat,
                                              instructions:
                                                existing?.instructions,
                                            });
                                          }}
                                          placeholder="1"
                                          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                                          style={{
                                            fontFamily:
                                              "var(--font-typewriter)",
                                            borderRadius: "2px",
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
                          store.defaultCitationStyle = s;
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
                      store.aiEnhanceCitations = (
                        e.target as HTMLInputElement
                      ).checked;
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
                      store.flagMissingSources = (
                        e.target as HTMLInputElement
                      ).checked;
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
                    onClick$={resetAll}
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
                    Your API keys are stored only in your browser's IndexedDB
                    and are never sent to Twyne's servers. We can't see them,
                    and we don't want to.
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
                  <p
                    class="mb-3 text-[0.7rem] text-[var(--color-vermilion)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                    role="alert"
                  >
                    {store.handleError}
                  </p>
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
                      store.handleDraft = (
                        e.target as HTMLInputElement
                      ).value;
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
                  {!store.handleCheckBusy &&
                    store.handleCheck?.available && (
                      <span
                        class="text-[var(--color-accent-green)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        @{store.handleCheck.normalized} is available.
                      </span>
                    )}
                  {!store.handleCheckBusy &&
                    store.handleCheck &&
                    !store.handleCheck.available && (
                      <span
                        class="text-[var(--color-vermilion)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        {store.handleCheck.reason}
                      </span>
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
                        (store.profileBio = (e.target as HTMLTextAreaElement)
                          .value)
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
                  <p
                    class="mb-3 text-[0.7rem] text-[var(--color-vermilion)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                    role="alert"
                  >
                    {store.accountError}
                  </p>
                )}
                <button
                  onClick$={handleDeleteAccount}
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
