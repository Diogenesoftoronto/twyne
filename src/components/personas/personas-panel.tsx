import {
  component$,
  useStore,
  $,
  useStylesScoped$,
  useVisibleTask$,
  noSerialize,
  type NoSerialize,
} from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { renderMarkdown } from "../../utils/markdown";
import {
  downloadBlob,
  exportRoomAnalysisMarkdown,
  safeFilename,
} from "../../utils/exchange";
import { api } from "../../../convex/_generated/api";
import type {
  PersonaFeedback,
  Persona,
  PersonaNotePayload,
  ProjectBrief,
  PersonaReply,
  RoomSettings,
  AssistanceLevel,
  SuggestionKind,
  RoomAnalysis,
  PersonaMemo,
} from "../../types";
import { DEFAULT_ROOM_SETTINGS } from "../../types";
import { loadDraftText } from "../../utils/anti-tabula-rasa";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import { toAgentPersona } from "../../../convex/agentPrompts";
import { loadPersonasFromIdb } from "../../utils/idb";
import {
  savePersonaNoteLocally,
  loadPersonaNotesLocally,
  addPersonaReplyLocally,
  loadPersonaRepliesLocally,
  strikeRoomLocally,
  loadRoomSettingsLocally,
  saveRoomSettingsLocally,
} from "../../utils/convex-sync";
import {
  runClientAgent,
  runClientRewrite,
  runClientRoomSynthesis,
  normalizeAiSettings,
  hasConfiguredAiProvider,
} from "../../utils/ai-client";
import type { AiSettings } from "../../types";
import {
  loadAiSettingsFromIdb,
  loadWriterSettingsFromIdb,
  loadRoomAnalysisFromIdb,
  saveRoomAnalysisToIdb,
} from "../../utils/idb";
import { useAuth } from "../../utils/auth-context";
import {
  draftReadiness,
  MIN_EDITOR_WORDS,
  MIN_MARKUP_WORDS,
} from "../../utils/draft-thresholds";
import { ApplicationNotice } from "../ui/application-notice";
import { SpeakButton } from "../ui/speak-button";
import type { AppError } from "../../types/application-errors";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import {
  capturePostHogEvent,
  getPostHogIdentityContext,
} from "../../utils/posthog-context";
import {
  currentTrajectoryDigest,
  noteExplicitConvene,
  setBackgroundRoomEnabled,
  WORD_DELTA_THRESHOLD,
  type BackgroundRoomSnapshot,
} from "../../utils/background-room";

/* ── Types ──────────────────────────────────────────────────────── */

interface PersonasStore {
  feedback: PersonaFeedback[];
  aiFeedback: Record<
    string,
    { sentiment: "positive" | "negative"; reason?: string }
  >;
  isGenerating: boolean;
  expandedFeedback: Set<string>;
  /** When true, note bodies are clamped to a few lines until clicked open. */
  compactView: boolean;
  personas: Persona[];
  /** Open the reply box for a given note. */
  replyingTo: string | null;
  /** Whether a per-persona reply is in flight. */
  isReplying: boolean;
  /** Persona ids the user has pinned in the active convene. */
  pinnedPersonas: Set<string>;
  /** Last room action error, if any. */
  conveneError: AppError | null;
  /** Replies keyed by noteId. */
  repliesByNote: Record<string, PersonaReply[]>;
  /**
   * Notes still being written, keyed by persona id, and the reply still being
   * written, keyed by note id. Both hold the visible text so far.
   *
   * Kept apart from `feedback` and `repliesByNote` on purpose: those are the
   * record, persisted and synced, and a half-finished sentence does not
   * belong in a record. They are rendered beside it and cleared the moment
   * the real thing lands.
   */
  streamingNotes: Record<string, string>;
  streamingReplies: Record<string, string>;
  /** The room's verdict as it is being written, during a full analysis. */
  streamingSynthesis: string;
  /** When true, group feedback by persona (latest + count). */
  groupByPersona: boolean;
  /** Expanded persona ids (for the per-persona "see older" toggle). */
  expandedPersonas: Set<string>;
  /** Draft text the writer is composing in the reply box. */
  replyDraft: string;
  /** Active note id being replied to. */
  replyNoteId: string | null;
  /** Provider that served the last successful model-dependent action. */
  lastProvider: string | null;
  /** Whether sync has completed since sign-in. */
  hydrated: boolean;
  /** Cached Convex client ref (noSerialize so Qwik doesn't try to ship it). */
  clientRef: NoSerialize<ReturnType<typeof useConvexClient>["value"]> | null;
  /** Brief snapshot captured at convene time (for the running notes). */
  convenedBriefTitle: string | null;
  /** Tunable assistance settings for the room. */
  roomSettings: RoomSettings;
  /** Whether the room-settings disclosure is open. */
  settingsOpen: boolean;
  /** Whether the cast + controls header is collapsed to give the notes room. */
  controlsCollapsed: boolean;
  /** Whether a proactive markup pass is running. */
  isMarkingUp: boolean;
  /** Note id whose "ask for a fix" request is in flight. */
  fixingNoteId: string | null;
  /** Large-edit budget spent in the current session (paragraph-class). */
  largeEditsUsed: number;
  /** Total proposals made in the current session. */
  proposalsUsed: number;
  /** Loaded BYOK settings (null until hydrated). */
  aiSettings: AiSettings | null;
  /** Private writer context used to address the writer directly. */
  writerProfile: import("../../types").WriterProfile;
  /** The expanded full-page cast analysis, when generated. */
  analysis: RoomAnalysis | null;
  /** Whether the full-analysis pass is in flight. */
  isAnalyzing: boolean;
  /** Whether the full-screen analysis modal is open. */
  analysisOpen: boolean;
  /** Persona ids whose memo is collapsed in the full-analysis modal. */
  analysisCollapsed: Record<string, boolean>;
  /** Persona id (or "synthesis") most recently copied, for a brief confirmation. */
  analysisCopiedId: string | null;
  /** Live status of the background room, for the footer indicator. */
  backgroundRoom: BackgroundRoomSnapshot | null;
}

interface PersonasPanelProps {
  brief: ProjectBrief | null;
  activeFolioId: string;
}

/** Effective assistance level for a persona (per-persona override wins). */
function effectiveLevel(
  settings: RoomSettings,
  personaId: string,
): AssistanceLevel {
  return settings.perPersona?.[personaId] ?? settings.level;
}

function localDraftValidationError(
  operation: string,
  validationKey: "too_short" | "required" = "too_short",
): AppError {
  return createAppError("VALIDATION_FAILED", {
    source: "validation",
    validationKey,
    metadata: { feature: "personas", operation, kind: "local-readiness" },
  });
}

function providerUnavailableError(operation: string): AppError {
  return createAppError("PROVIDER_ERROR", {
    source: "provider",
    recovery: { action: "retry", canRetry: true },
    metadata: { feature: "personas", operation },
  });
}

function providerConfigurationError(operation: string): AppError {
  return createAppError("CONFIGURATION_ERROR", {
    source: "application",
    recovery: { action: "choose-provider", canRetry: false },
    metadata: { feature: "personas", operation },
  });
}

function malformedProviderResponseError(operation: string): AppError {
  return createAppError("MALFORMED_RESPONSE", {
    source: "provider",
    metadata: { feature: "personas", operation },
  });
}

function normalizePersonaError(
  scope: string,
  thrown: unknown,
  source: "application" | "convex" | "provider",
  operation: string,
): AppError {
  const metadata = { feature: "personas", operation };
  reportApplicationDiagnostic(scope, thrown, metadata);
  return normalizeApplicationError(thrown, { source, metadata });
}

/* ── Rewrite anchor selection (deterministic edit targets) ─────── */

function pickAnchorSentences(
  text: string,
  personaIds: string[],
): Record<string, string> {
  const sentences: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const matches = paragraph.match(/[^.!?]+[.!?]+(?=\s|$)/g) ?? [];
    for (const raw of matches) {
      const sentence = raw.trim();
      if (sentence.split(/\s+/).length >= 6) sentences.push(sentence);
    }
  }
  if (sentences.length === 0) return {};

  const used = new Set<number>();
  const take = (start: number): string | undefined => {
    for (let step = 0; step < sentences.length; step++) {
      const i = (start + step) % sentences.length;
      if (!used.has(i)) {
        used.add(i);
        return sentences[i];
      }
    }
    return undefined;
  };

  const longest = sentences.reduce(
    (best, s, i) => (s.length > sentences[best].length ? i : best),
    0,
  );
  const evidence = sentences.findIndex((s) =>
    /\d|percent|study|studies|research|according to|evidence/i.test(s),
  );
  const claim = sentences.findIndex((s) =>
    /\b(must|should|clearly|obviously|always|never|every|all of|no one|undeniabl)/i.test(
      s,
    ),
  );

  const preferred: Record<string, number> = {
    reader: 0,
    editor: longest,
    devil: claim >= 0 ? claim : Math.floor(sentences.length / 2),
    scholar: evidence >= 0 ? evidence : Math.floor((sentences.length * 2) / 3),
    angel: Math.floor(sentences.length / 3),
  };

  const result: Record<string, string> = {};
  for (const id of personaIds) {
    if (id in preferred) {
      const s = take(preferred[id]);
      if (s) result[id] = s;
    }
  }
  let cursor = 0;
  for (const id of personaIds) {
    if (result[id] !== undefined || id in preferred) continue;
    const s = take(cursor++ % sentences.length);
    if (s) result[id] = s;
  }
  return result;
}

/* ── Component ──────────────────────────────────────────────────── */

export const PersonasPanel = component$(
  ({ brief, activeFolioId }: PersonasPanelProps) => {
    const clientSig = useConvexClient();
    const auth = useAuth();
    const store = useStore<PersonasStore>({
      feedback: [],
      aiFeedback: {},
      isGenerating: false,
      expandedFeedback: new Set(),
      compactView: false,
      personas: DEFAULT_PERSONAS,
      replyingTo: null,
      isReplying: false,
      pinnedPersonas: new Set(),
      conveneError: null,
      repliesByNote: {},
      streamingNotes: {},
      streamingReplies: {},
      streamingSynthesis: "",
      groupByPersona: true,
      expandedPersonas: new Set(),
      replyDraft: "",
      replyNoteId: null,
      lastProvider: null,
      hydrated: false,
      clientRef: null,
      convenedBriefTitle: null,
      roomSettings: DEFAULT_ROOM_SETTINGS,
      settingsOpen: false,
      controlsCollapsed: false,
      isMarkingUp: false,
      fixingNoteId: null,
      largeEditsUsed: 0,
      proposalsUsed: 0,
      aiSettings: null,
      writerProfile: {
        displayName: "",
        personalFacts: "",
        feedbackStyle: "balanced",
        feedbackNotes: "",
      },
      analysis: null,
      isAnalyzing: false,
      analysisOpen: false,
      analysisCollapsed: {},
      analysisCopiedId: null,
      backgroundRoom: null,
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async () => {
      // Custom personas from IDB / Convex.
      const custom = await loadPersonasFromIdb();
      if (custom && custom.length > 0) store.personas = custom;

      // Hydrate previously-saved notes & replies + room settings.
      const [notes, replies, settings] = await Promise.all([
        loadPersonaNotesLocally(activeFolioId),
        loadPersonaRepliesLocally(activeFolioId),
        loadRoomSettingsLocally(),
      ]);
      if (notes.length > 0) store.feedback = notes;
      store.roomSettings = settings;
      const grouped: Record<string, PersonaReply[]> = {};
      for (const r of replies) {
        (grouped[r.noteId] ??= []).push(r);
      }
      store.repliesByNote = grouped;

      // Load BYOK settings (client-side only, keys never touch the server).
      const [aiRaw, writerSettings] = await Promise.all([
        loadAiSettingsFromIdb(),
        loadWriterSettingsFromIdb(),
      ]);
      store.aiSettings = normalizeAiSettings(aiRaw);
      store.writerProfile = writerSettings.profile;
      const savedAnalysis = await loadRoomAnalysisFromIdb(activeFolioId);
      if (savedAnalysis && !store.analysis) store.analysis = savedAnalysis;

      // Capture the live Convex client (noSerialize keeps Qwik happy).
      if (clientSig.value) {
        store.clientRef = noSerialize(clientSig.value);
      }

      store.hydrated = true;
    });

    useStylesScoped$(`
    /* A note the room left on its own: same information, quieter voice.
       No clipping frame, just a coloured rule down the side, so a glance
       tells the writer which notes they asked for and which simply arrived. */
    .passing-note {
      position: relative;
      border-left: 2px solid var(--clip-color, var(--color-paper-3));
      background: transparent;
      opacity: 0.86;
      transition: opacity 0.2s ease, background 0.2s ease;
    }
    .passing-note:hover {
      opacity: 1;
      background: var(--color-paper-soft);
    }

    .feedback-enter {
      animation: feedbackSlide 0.35s ease-out;
    }
    @keyframes feedbackSlide {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .feedback-enter { animation: none; }
    }

    .portrait-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1.6rem;
      height: 1.6rem;
      border-radius: 999px;
      color: var(--frame-color, var(--color-ink));
      background: var(--color-paper-soft);
      border: 1px solid var(--frame-color, var(--color-paper-3));
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .clipping {
      background: var(--color-paper);
      border: 1px solid
        color-mix(in srgb, var(--clip-color, var(--color-paper-3)) 38%, var(--color-paper-3));
      box-shadow:
        0 1px 0 rgba(255,255,255,0.7) inset,
        0 8px 16px -14px rgba(31,27,22,0.35);
      border-radius: 2px;
    }
    .clipping.is-pinned { cursor: pointer; }
    .clipping.is-pinned:hover {
      box-shadow:
        0 1px 0 rgba(255,255,255,0.7) inset,
        0 10px 20px -12px rgba(31,27,22,0.45);
    }

    .cast-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.35rem;
      height: 1.35rem;
      border: 1px solid var(--frame-color, var(--color-paper-3));
      border-radius: 999px;
      color: var(--frame-color, var(--color-ink));
      background: var(--color-paper-soft);
      font-size: 0.7rem;
    }

    .convene-btn {
      width: 100%;
      font-family: var(--font-typewriter);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 0.6875rem;
      padding: 0.55rem 0.75rem;
      background: var(--color-ink);
      color: var(--color-paper);
      border: 1px solid var(--color-ink);
      border-radius: 2px;
      transition: background 0.2s ease;
      cursor: pointer;
    }
    .convene-btn:hover:not(:disabled) {
      background: var(--color-vermilion-2);
      border-color: var(--color-vermilion-2);
    }
    .convene-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .room-btn-title {
      display: block;
      font-family: var(--font-typewriter);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      font-size: 0.6875rem;
    }

    .markup-btn {
      width: 100%;
      padding: 0.55rem 0.75rem;
      background: var(--color-paper);
      color: var(--color-ink);
      border: 1px solid var(--color-ink-light);
      border-radius: 2px;
      cursor: pointer;
      transition: border-color 0.2s ease, background 0.2s ease;
    }
    .markup-btn:hover:not(:disabled) {
      border-color: var(--color-vermilion);
      background: var(--color-paper-soft);
    }
    .markup-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .room-btn-link {
      display: block;
      width: 100%;
      padding: 0.2rem 0;
      text-align: center;
      font-family: var(--font-typewriter);
      font-size: 0.6875rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: var(--color-ink-muted);
      cursor: pointer;
    }
    .room-btn-link:hover:not(:disabled) { color: var(--color-vermilion); }
    .room-btn-link:disabled { opacity: 0.6; cursor: not-allowed; }

    .provider-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.15rem 0.55rem;
      border: 1px solid var(--color-paper-3);
      border-radius: 999px;
      font-family: var(--font-typewriter);
      font-size: 0.6rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--color-ink-muted);
      background: var(--color-paper-soft);
    }
    .provider-pill[data-provider="local"] { color: var(--color-vermilion); border-color: var(--color-vermilion); }
    .provider-pill[data-provider="anthropic"],
    .provider-pill[data-provider="openai"],
    .provider-pill[data-provider="rivet"],
    .provider-pill[data-provider="portkey"] { color: var(--color-accent-green); border-color: var(--color-accent-green); }

    .reply-thread {
      margin-top: 0.6rem;
      padding-left: 0.75rem;
      border-left: 2px dashed var(--color-paper-3);
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .reply-bubble {
      padding: 0.5rem 0.6rem;
      border-radius: 2px;
      background: var(--color-paper-soft);
      border: 1px solid var(--color-paper-3);
      font-family: var(--font-serif);
      font-size: 0.78rem;
      line-height: 1.45;
      color: var(--color-ink-light);
    }
    .reply-bubble.is-persona {
      background: color-mix(in srgb, var(--reply-color, var(--color-vermilion)) 12%, var(--color-paper));
    }
    .reply-meta {
      display: flex;
      gap: 0.4rem;
      align-items: baseline;
      font-family: var(--font-typewriter);
      font-size: 0.6rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--color-ink-muted);
    }
    .reply-meta strong {
      color: var(--reply-color, var(--color-ink));
      font-family: var(--font-display);
      font-weight: 600;
    }
    .reply-box {
      margin-top: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .reply-input {
      width: 100%;
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper-soft);
      padding: 0.45rem 0.55rem;
      font-family: var(--font-serif);
      font-size: 0.8rem;
      color: var(--color-ink);
      resize: vertical;
      min-height: 3.2rem;
      border-radius: 2px;
    }
    /* Same focus treatment as .composer, so the two places a writer types a
       message to the room do not read as two different applications. */
    .reply-input:focus {
      outline: none;
      border-color: var(--color-vermilion);
      box-shadow:
        0 0 0 3px rgba(193, 39, 45, 0.12),
        0 2px 10px -6px rgba(31, 27, 22, 0.35);
    }
    .reply-actions {
      display: flex;
      gap: 0.4rem;
      align-items: center;
    }
    .reply-actions .ask-again {
      background: var(--color-ink);
      color: var(--color-paper);
      border: 1px solid var(--color-ink);
      padding: 0.3rem 0.55rem;
      font-family: var(--font-typewriter);
      font-size: 0.62rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      border-radius: 2px;
      cursor: pointer;
    }
    .reply-actions .ask-again:disabled { opacity: 0.5; cursor: not-allowed; }
    .reply-actions button.ghost {
      background: transparent;
      color: var(--color-ink-muted);
      border: none;
      font-family: var(--font-typewriter);
      font-size: 0.62rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      cursor: pointer;
    }
  `);

    /* ── Convene the room ──────────────────────────────────────── */

    const requestFeedback = $(async () => {
      store.isGenerating = true;
      store.conveneError = null;
      store.convenedBriefTitle = brief?.answers.workingTitle ?? null;
      try {
        const draftText = await readCurrentDraftText();
        const readiness = draftReadiness(draftText, MIN_EDITOR_WORDS);
        if (!readiness.ok) {
          store.conveneError = localDraftValidationError("convene-room");
          store.lastProvider = null;
          return;
        }
        const client =
          auth.value.provider === "convex" && auth.value.user
            ? clientSig.value
            : null;
        // What the writer has been doing since the room last read. Costs
        // nothing to fetch and lets the editors respond to a direction rather
        // than to a cold snapshot.
        const trajectory = await currentTrajectoryDigest();
        const posthogIdentity = await getPostHogIdentityContext();
        let responses: Array<{
          personaId: string;
          text: string;
          type: PersonaFeedback["type"];
          provider: string;
          anchor?: string;
          traceId?: string;
        }> = [];

        // ── Try client-side AI first (BYOK) ─────────────────────────
        const settings = store.aiSettings;
        const hasByok = hasConfiguredAiProvider(settings);
        if (hasByok && settings) {
          try {
            const clientResults = await Promise.all(
              store.personas.map(async (p) => {
                const req = {
                  persona: toAgentPersona(p),
                  brief: brief ?? null,
                  draftText,
                  writerProfile: store.writerProfile,
                  trajectory,
                  instruction: "feedback" as const,
                };
                const res = await runClientAgent(
                  "persona-feedback",
                  req,
                  settings,
                  // Each editor writes into their own slot, so five of them
                  // filling in at once reads as five people at a table rather
                  // than one queue.
                  (partial) => {
                    store.streamingNotes = {
                      ...store.streamingNotes,
                      [p.id]: partial,
                    };
                  },
                );
                // The finished text is deliberately left on screen: the filed
                // cards are only built once all five editors are in, so
                // clearing here would blank an editor who finished early and
                // leave a hole until the slowest one lands.
                return res
                  ? {
                      personaId: p.id,
                      text: res.text,
                      type: res.type,
                      provider:
                        res.provider as (typeof responses)[0]["provider"],
                      anchor: res.anchor,
                      traceId: res.traceId,
                    }
                  : null;
              }),
            );
            if (clientResults.every(Boolean)) {
              responses = clientResults as typeof responses;
              if (
                responses.some(
                  (response) =>
                    !response.text.trim() || response.provider === "local",
                )
              ) {
                store.lastProvider = null;
                store.conveneError =
                  malformedProviderResponseError("convene-room");
                return;
              }
              store.lastProvider = `client-${responses[0]!.provider}`;
            } else {
              store.lastProvider = null;
              store.conveneError = providerUnavailableError("convene-room");
              return;
            }
          } catch (err) {
            store.lastProvider = null;
            store.conveneError = normalizePersonaError(
              "twyne:personas:convene-client",
              err,
              "provider",
              "convene-room",
            );
            return;
          }
        }

        // ── Server action only when no local provider is configured ──────────
        if (responses.length === 0 && !hasByok && client) {
          try {
            const personasForServer = store.personas.map(toAgentPersona);
            const result = (await client.action(api.agents.conveneRoom, {
              personas: personasForServer,
              brief: brief ?? null,
              draftText,
              writerProfile: store.writerProfile,
              trajectory,
              observability: {
                anonymousId: posthogIdentity.anonymousId,
                sessionId: posthogIdentity.sessionId,
                folioId: activeFolioId,
                editorialActionId: "convene-room",
              },
            })) as Array<{
              personaId: string;
              text: string;
              type: PersonaFeedback["type"];
              provider: string;
              anchor?: string;
              traceId?: string;
            }>;
            if (
              result.some(
                (response) =>
                  !response.text.trim() || response.provider === "local",
              )
            ) {
              store.conveneError = providerUnavailableError("convene-room");
              store.lastProvider = null;
              return;
            }
            responses = result;
            store.lastProvider = result[0]?.provider ?? null;
          } catch (err) {
            store.conveneError = normalizePersonaError(
              "twyne:personas:convene-server",
              err,
              "convex",
              "convene-room",
            );
            store.lastProvider = null;
            return;
          }
        }

        if (responses.length === 0) {
          store.lastProvider = null;
          store.conveneError = hasByok
            ? providerUnavailableError("convene-room")
            : providerConfigurationError("convene-room");
          return;
        }

        if (responses.some((response) => !response.text.trim())) {
          store.lastProvider = null;
          store.conveneError = malformedProviderResponseError("convene-room");
          return;
        }

        // Build PersonaFeedback[] from the responses, persisting each as we go.
        const timestamp = Date.now();
        const feedbackList: PersonaFeedback[] = [];
        for (const r of responses) {
          const persona = store.personas.find((p) => p.id === r.personaId);
          if (!persona) continue;
          const anchor = r.anchor;
          const noteId = `pn-${r.personaId}-${timestamp}`;
          const fb: PersonaFeedback = {
            folioId: activeFolioId,
            personaId: r.personaId,
            personaName: persona.name,
            personaColor: persona.color,
            feedback: r.text,
            traceId: r.traceId,
            timestamp,
            type: r.type,
            anchor: anchor,
            noteId,
          };
          feedbackList.push(fb);
          await savePersonaNoteLocally(fb, brief, activeFolioId);

          // Server-side push (best-effort, no-op if not signed in).
          const c =
            auth.value.provider === "convex" && auth.value.user
              ? clientSig.value
              : null;
          if (c) {
            try {
              await c.mutation(api.sync.putPersonaNote, {
                folioId: activeFolioId,
                noteId,
                personaId: r.personaId,
                personaName: persona.name,
                personaColor: persona.color,
                type: r.type,
                feedback: r.text,
                traceId: r.traceId,
                anchor,
                briefTitle: brief?.answers.workingTitle,
              });
            } catch (err) {
              reportApplicationDiagnostic(
                "twyne:personas:sync-persona-note",
                err,
                {
                  feature: "personas",
                  operation: "sync-persona-note",
                },
              );
            }
          }
        }

        store.feedback = feedbackList;

        // The room has now read everything. Reset the background watcher's
        // baseline so it doesn't immediately re-read the same prose, and
        // restart its interval from here.
        noteExplicitConvene();

        // Pin the notes inline in the manuscript.
        window.dispatchEvent(new CustomEvent("twyne:clear-persona-notes"));
        const notes: PersonaNotePayload[] = feedbackList
          .filter((f) => f.anchor && f.noteId)
          .map((f) => ({
            id: f.noteId!,
            author: f.personaName,
            color: f.personaColor,
            label: typeLabel(f.type),
            note: f.feedback,
            quote: f.anchor!,
          }));
        if (notes.length > 0) {
          window.dispatchEvent(
            new CustomEvent("twyne:persona-notes", { detail: notes }),
          );
        }
      } catch (err) {
        store.lastProvider = null;
        store.conveneError = normalizePersonaError(
          "twyne:personas:convene",
          err,
          "application",
          "convene-room",
        );
      } finally {
        store.isGenerating = false;
        // Whatever happened — filed, failed, or refused — nothing is still
        // being written, and a half-sentence left on screen would say otherwise.
        store.streamingNotes = {};
      }
    });

    const submitAiFeedback = $(
      async (
        feedback: PersonaFeedback,
        sentiment: "positive" | "negative",
        reason?:
          | "grounding"
          | "usefulness"
          | "tone"
          | "incorrect"
          | "too_long"
          | "other",
      ) => {
        if (!feedback.traceId) return;
        store.aiFeedback = {
          ...store.aiFeedback,
          [feedback.traceId]: { sentiment, reason },
        };

        const identity = await getPostHogIdentityContext();
        await capturePostHogEvent("survey sent", {
          $ai_trace_id: feedback.traceId,
          $ai_feedback: sentiment === "positive" ? 1 : 0,
          twyne_feedback_sentiment: sentiment,
          twyne_feedback_reason: reason,
          twyne_feature: "persona-feedback",
          twyne_folio_id: activeFolioId,
        });

        const client =
          auth.value.provider === "convex" && auth.value.user
            ? clientSig.value
            : null;
        if (!client) return;
        try {
          await client.mutation(api.aiFeedback.submit, {
            traceId: feedback.traceId,
            feature: "persona-feedback",
            sentiment,
            reason,
            folioId: activeFolioId,
            sessionId: identity.sessionId,
            editorialActionId: "convene-room",
          });
        } catch (err) {
          reportApplicationDiagnostic("twyne:personas:feedback", err, {
            feature: "personas",
            operation: "submit-ai-feedback",
          });
        }
      },
    );

    /* ── Full-page cast analysis (per-persona memos + synthesis) ── */

    const expandAnalysis = $(async () => {
      if (store.isAnalyzing) return;
      store.isAnalyzing = true;
      store.conveneError = null;
      try {
        const draftText = await loadDraftText();
        const readiness = draftReadiness(draftText, MIN_EDITOR_WORDS);
        if (!readiness.ok) {
          store.conveneError = localDraftValidationError("full-analysis");
          return;
        }
        const client = store.clientRef ?? clientSig.value;
        const settings = store.aiSettings;
        const hasByok = hasConfiguredAiProvider(settings);
        const briefTitle = brief?.answers.workingTitle;

        let memos: PersonaMemo[] = [];
        let synthesis = "";
        let synthesisProvider = "";

        if (hasByok && settings) {
          // Each editor writes a full memo on the BYOK path, honoring their
          // own model/temperature; then synthesise the five.
          const clientMemos = await Promise.all(
            store.personas.map(async (p) => {
              const res = await runClientAgent(
                "persona-analysis",
                {
                  persona: toAgentPersona(p),
                  brief: brief ?? null,
                  draftText,
                  writerProfile: store.writerProfile,
                  instruction: "analyze",
                },
                settings,
                // The analysis is the longest wait in the app. The modal only
                // opens when all five memos are in, so the progress belongs
                // here, in the panel the writer is already looking at.
                (partial) => {
                  store.streamingNotes = {
                    ...store.streamingNotes,
                    [p.id]: partial,
                  };
                },
              );
              if (!res || !res.text.trim() || res.provider === "local") {
                return null;
              }
              return {
                personaId: p.id,
                personaName: p.name,
                personaColor: p.color,
                text: res.text,
                anchor: res.anchor,
                provider: `client-${res.provider}`,
              } as PersonaMemo;
            }),
          );
          if (clientMemos.some((memo) => memo === null)) {
            store.conveneError = providerUnavailableError("full-analysis");
            return;
          }
          memos = clientMemos as PersonaMemo[];
          const synth = await runClientRoomSynthesis(
            memos.map((m) => {
              const persona = store.personas.find((p) => p.id === m.personaId);
              return {
                personaName: m.personaName,
                role: persona?.role ?? "",
                text: m.text,
              };
            }),
            brief ?? null,
            settings,
            store.writerProfile,
            (partial) => {
              store.streamingSynthesis = partial;
            },
          );
          if (!synth || !synth.text.trim()) {
            store.conveneError = providerUnavailableError("full-analysis");
            return;
          }
          synthesis = synth.text;
          synthesisProvider = `client-${synth.provider}`;
        } else if (client) {
          const result = (await client.action(api.agents.analyzeRoom, {
            personas: store.personas.map(toAgentPersona),
            brief: brief ?? null,
            draftText,
            writerProfile: store.writerProfile,
          })) as {
            memos: Array<{
              personaId: string;
              text: string;
              anchor?: string;
              provider: string;
            }>;
            synthesis: string;
            synthesisProvider: string;
          };
          memos = result.memos.map((m) => {
            const persona = store.personas.find((p) => p.id === m.personaId);
            return {
              personaId: m.personaId,
              personaName: persona?.name ?? m.personaId,
              personaColor: persona?.color ?? "var(--color-ink)",
              text: m.text,
              anchor: m.anchor,
              provider: m.provider,
            };
          });
          synthesis = result.synthesis;
          synthesisProvider = result.synthesisProvider;
        } else {
          store.conveneError = providerConfigurationError("full-analysis");
          return;
        }

        if (
          memos.length !== store.personas.length ||
          memos.some((memo) => !memo.text.trim()) ||
          memos.some((memo) => memo.provider === "local") ||
          synthesisProvider === "local" ||
          !synthesis.trim()
        ) {
          store.conveneError =
            memos.some((memo) => memo.provider === "local") ||
            synthesisProvider === "local"
              ? providerUnavailableError("full-analysis")
              : malformedProviderResponseError("full-analysis");
          return;
        }

        const analysis: RoomAnalysis = {
          folioId: activeFolioId,
          memos,
          synthesis,
          synthesisProvider,
          briefTitle,
          timestamp: Date.now(),
        };
        store.analysis = analysis;
        store.analysisOpen = true;
        store.analysisCollapsed = {};
        store.analysisCopiedId = null;
        void saveRoomAnalysisToIdb(analysis, activeFolioId);
      } catch (err) {
        store.conveneError = normalizePersonaError(
          "twyne:personas:full-analysis",
          err,
          hasConfiguredAiProvider(store.aiSettings) ? "provider" : "convex",
          "full-analysis",
        );
      } finally {
        store.isAnalyzing = false;
        store.streamingNotes = {};
        store.streamingSynthesis = "";
      }
    });

    /* ── Full-analysis modal: download, copy, collapse ───────────── */

    const downloadAnalysis = $(() => {
      if (!store.analysis) return;
      const md = exportRoomAnalysisMarkdown(store.analysis);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const namePart = store.analysis.briefTitle
        ? `${store.analysis.briefTitle} full analysis`
        : "full-analysis";
      downloadBlob(blob, safeFilename(namePart, "md"));
    });

    const copyAnalysisText = $(async (id: string, text: string) => {
      try {
        await navigator.clipboard?.writeText(text);
        store.analysisCopiedId = id;
        setTimeout(() => {
          if (store.analysisCopiedId === id) store.analysisCopiedId = null;
        }, 1500);
      } catch {
        // Clipboard may be unavailable (permissions, insecure context) — no-op.
      }
    });

    const toggleMemoCollapsed = $((personaId: string) => {
      store.analysisCollapsed = {
        ...store.analysisCollapsed,
        [personaId]: !store.analysisCollapsed[personaId],
      };
    });

    const scrollToMemo = $((personaId: string) => {
      document
        .getElementById(`analysis-memo-${personaId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    /* ── Reply flow ────────────────────────────────────────────── */

    const openReply = $((noteId: string) => {
      store.replyNoteId = noteId;
      store.replyingTo = noteId;
      store.replyDraft = "";
    });

    const cancelReply = $(() => {
      store.replyNoteId = null;
      store.replyingTo = null;
      store.replyDraft = "";
    });

    const emitReplyThread = $((noteId: string) => {
      window.dispatchEvent(
        new CustomEvent("twyne:persona-reply-thread", {
          detail: {
            noteId,
            replies: store.repliesByNote[noteId] ?? [],
          },
        }),
      );
    });

    const submitReply = $(
      async (noteId: string, askPersona: boolean, authorHint?: string) => {
        const text = store.replyDraft.trim();
        if (!text) return;
        if (store.groupByPersona) {
          const note = store.feedback.find((f) => f.noteId === noteId);
          const latestForPersona = note
            ? store.feedback
                .filter((f) => f.personaId === note.personaId)
                .sort((a, b) => b.timestamp - a.timestamp)[0]
            : null;
          if (note && latestForPersona?.noteId !== noteId) {
            store.groupByPersona = false;
          }
        }
        const userReply: PersonaReply = {
          id: `preply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          folioId: activeFolioId,
          noteId,
          author: "You",
          authorKind: "user",
          text,
          timestamp: Date.now(),
        };
        const updated = [...(store.repliesByNote[noteId] ?? []), userReply];
        store.repliesByNote = { ...store.repliesByNote, [noteId]: updated };
        void emitReplyThread(noteId);
        await addPersonaReplyLocally(userReply, activeFolioId);
        const client =
          auth.value.provider === "convex" && auth.value.user
            ? clientSig.value
            : null;
        if (client) {
          try {
            await client.mutation(api.sync.addPersonaReply, {
              folioId: activeFolioId,
              noteId,
              replyId: userReply.id,
              author: userReply.author,
              authorKind: "user",
              text: userReply.text,
            });
          } catch (err) {
            reportApplicationDiagnostic("twyne:personas:sync-user-reply", err, {
              feature: "personas",
              operation: "sync-user-reply",
            });
          }
        }
        store.replyDraft = "";
        store.replyNoteId = null;
        store.replyingTo = null;

        if (askPersona) {
          const note = store.feedback.find((f) => f.noteId === noteId);
          // The note may not be in this session's feedback list (e.g. it was
          // restored from a saved draft before the room re-convened). Fall
          // back to matching the persona by the name shown on the popover so
          // replying still works instead of silently doing nothing.
          const persona =
            (note && store.personas.find((p) => p.id === note.personaId)) ||
            (authorHint
              ? store.personas.find((p) => p.name === authorHint)
              : undefined);
          if (!persona) {
            const error = createAppError("NOT_FOUND", {
              source: "application",
              metadata: { feature: "personas", operation: "persona-reply" },
            });
            store.conveneError = error;
            window.dispatchEvent(
              new CustomEvent("twyne:persona-reply-error", {
                detail: { noteId, message: error.message },
              }),
            );
            return;
          }
          store.isReplying = true;
          store.streamingReplies = {
            ...store.streamingReplies,
            [noteId]: "",
          };
          window.dispatchEvent(
            new CustomEvent("twyne:persona-replying", {
              detail: { noteId, replying: true },
            }),
          );
          try {
            const draftText = await readCurrentDraftText();
            const priorMessages = [
              ...updated
                .filter((r) => r.authorKind === "persona")
                .map((r) => ({ author: "persona" as const, text: r.text })),
              ...updated
                .filter((r) => r.authorKind === "user")
                .map((r) => ({ author: "user" as const, text: r.text })),
            ];

            let responseText: string | null = null;

            // ── Try client-side AI first (BYOK) ─────────────────────────
            const settings2 = store.aiSettings;
            const hasByok = hasConfiguredAiProvider(settings2);
            if (hasByok && settings2) {
              try {
                const res = await runClientAgent(
                  "persona-reply",
                  {
                    persona: toAgentPersona(persona),
                    brief: brief ?? null,
                    draftText,
                    writerProfile: store.writerProfile,
                    anchor: note?.anchor,
                    priorMessages,
                    userMessage: userReply.text,
                    instruction: "elaborate",
                  },
                  settings2,
                  // The reply lands in two places at once — the panel's thread
                  // and the inline card in the manuscript — so the partial goes
                  // out on the same event bus the finished one uses.
                  (partial) => {
                    store.streamingReplies = {
                      ...store.streamingReplies,
                      [noteId]: partial,
                    };
                    window.dispatchEvent(
                      new CustomEvent("twyne:persona-reply-stream", {
                        detail: { noteId, text: partial, author: persona.name },
                      }),
                    );
                  },
                );
                if (res && res.text.trim() && res.provider !== "local") {
                  responseText = res.text;
                  store.lastProvider = `client-${res.provider}`;
                } else {
                  const error = providerUnavailableError("persona-reply");
                  store.conveneError = error;
                  window.dispatchEvent(
                    new CustomEvent("twyne:persona-reply-error", {
                      detail: { noteId, message: error.message },
                    }),
                  );
                  return;
                }
              } catch (err) {
                const error = normalizePersonaError(
                  "twyne:personas:reply-client",
                  err,
                  "provider",
                  "persona-reply",
                );
                store.conveneError = error;
                window.dispatchEvent(
                  new CustomEvent("twyne:persona-reply-error", {
                    detail: { noteId, message: error.message },
                  }),
                );
                return;
              }
            }

            const c =
              auth.value.provider === "convex" && auth.value.user
                ? clientSig.value
                : null;
            const replyPosthogIdentity = await getPostHogIdentityContext();
            if (!responseText && !hasByok && c) {
              try {
                const result = (await c.action(api.agents.runPersona, {
                  persona: toAgentPersona(persona),
                  brief: brief ?? null,
                  draftText,
                  writerProfile: store.writerProfile,
                  anchor: note?.anchor,
                  priorMessages,
                  userMessage: userReply.text,
                  instruction: "elaborate",
                  observability: {
                    anonymousId: replyPosthogIdentity.anonymousId,
                    sessionId: replyPosthogIdentity.sessionId,
                    folioId: activeFolioId,
                    editorialActionId: "persona-reply",
                  },
                })) as {
                  text: string;
                  type: PersonaFeedback["type"];
                  provider: string;
                };
                if (
                  !result.text.trim() ||
                  !result.provider ||
                  result.provider === "local"
                ) {
                  const error = providerUnavailableError("persona-reply");
                  store.conveneError = error;
                  window.dispatchEvent(
                    new CustomEvent("twyne:persona-reply-error", {
                      detail: { noteId, message: error.message },
                    }),
                  );
                  return;
                }
                responseText = result.text;
                store.lastProvider = result.provider;
              } catch (err) {
                const error = normalizePersonaError(
                  "twyne:personas:reply-server",
                  err,
                  "convex",
                  "persona-reply",
                );
                store.conveneError = error;
                window.dispatchEvent(
                  new CustomEvent("twyne:persona-reply-error", {
                    detail: { noteId, message: error.message },
                  }),
                );
                return;
              }
            }
            if (!responseText) {
              const error = hasByok
                ? providerUnavailableError("persona-reply")
                : providerConfigurationError("persona-reply");
              store.conveneError = error;
              window.dispatchEvent(
                new CustomEvent("twyne:persona-reply-error", {
                  detail: { noteId, message: error.message },
                }),
              );
              return;
            }

            const personaReply: PersonaReply = {
              id: `preply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              folioId: activeFolioId,
              noteId,
              author: persona.name,
              authorKind: "persona",
              personaId: persona.id,
              text: responseText,
              timestamp: Date.now(),
            };
            const nextReplies = [
              ...(store.repliesByNote[noteId] ?? []),
              personaReply,
            ];
            store.repliesByNote = {
              ...store.repliesByNote,
              [noteId]: nextReplies,
            };
            void emitReplyThread(noteId);
            await addPersonaReplyLocally(personaReply, activeFolioId);

            if (c) {
              try {
                await c.mutation(api.sync.addPersonaReply, {
                  folioId: activeFolioId,
                  noteId,
                  replyId: personaReply.id,
                  author: personaReply.author,
                  authorKind: "persona",
                  personaId: personaReply.personaId,
                  text: personaReply.text,
                });
              } catch (err) {
                reportApplicationDiagnostic(
                  "twyne:personas:sync-persona-reply",
                  err,
                  {
                    feature: "personas",
                    operation: "sync-persona-reply",
                  },
                );
              }
            }
          } finally {
            store.isReplying = false;
            // Clear the in-flight text before announcing the end of the reply:
            // the filed version is already in the thread, and leaving the
            // partial up would briefly show the answer twice.
            delete store.streamingReplies[noteId];
            store.streamingReplies = { ...store.streamingReplies };
            window.dispatchEvent(
              new CustomEvent("twyne:persona-reply-stream", {
                detail: { noteId, text: "" },
              }),
            );
            window.dispatchEvent(
              new CustomEvent("twyne:persona-replying", {
                detail: { noteId, replying: false },
              }),
            );
          }
        }
      },
    );

    // Replies filed from the editor's inline-note modal arrive as a window
    // event (the modal lives in the editor component, the thread lives here).
    // Mirror the panel's own reply box: record the writer's reply and pull the
    // editor back into the thread.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      const onReply = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          noteId?: string;
          text?: string;
          author?: string;
        };
        if (!detail?.noteId || !detail.text?.trim()) return;
        store.replyDraft = detail.text;
        void submitReply(detail.noteId, true, detail.author);
      };
      window.addEventListener("twyne:persona-reply", onReply);
      const onRequestThread = (e: Event) => {
        const detail = (e as CustomEvent).detail as { noteId?: string };
        if (!detail?.noteId) return;
        void emitReplyThread(detail.noteId);
      };
      window.addEventListener("twyne:request-persona-thread", onRequestThread);

      // Notes the room left on its own while the writer was working. They join
      // the same feed as convened notes — `origin: "background"` is what makes
      // them render quietly — and pin inline like any other note.
      const onBackgroundNotes = (e: Event) => {
        const notes = (e as CustomEvent).detail as PersonaFeedback[];
        if (!Array.isArray(notes) || notes.length === 0) return;
        const known = new Set(store.feedback.map((f) => f.noteId));
        const fresh = notes.filter((n) => !known.has(n.noteId));
        if (fresh.length === 0) return;
        store.feedback = [...fresh, ...store.feedback];

        const pinned: PersonaNotePayload[] = fresh
          .filter((f) => f.anchor && f.noteId)
          .map((f) => ({
            id: f.noteId!,
            author: f.personaName,
            color: f.personaColor,
            label: typeLabel(f.type),
            note: f.feedback,
            quote: f.anchor!,
          }));
        if (pinned.length > 0) {
          window.dispatchEvent(
            new CustomEvent("twyne:persona-notes", { detail: pinned }),
          );
        }
      };
      window.addEventListener("twyne:background-room-notes", onBackgroundNotes);

      const onBackgroundStatus = (e: Event) => {
        store.backgroundRoom = (e as CustomEvent)
          .detail as BackgroundRoomSnapshot;
      };
      window.addEventListener("twyne:background-room", onBackgroundStatus);

      cleanup(() => {
        window.removeEventListener("twyne:persona-reply", onReply);
        window.removeEventListener(
          "twyne:request-persona-thread",
          onRequestThread,
        );
        window.removeEventListener(
          "twyne:background-room-notes",
          onBackgroundNotes,
        );
        window.removeEventListener("twyne:background-room", onBackgroundStatus);
      });
    });

    /* ── Tunable assistance: settings + propose edits ──────────── */

    const persistSettings = $(async (next: RoomSettings) => {
      store.roomSettings = next;
      // Apply the background-room switch immediately rather than on next mount:
      // a writer who turns it off wants silence now, not after a reload.
      setBackgroundRoomEnabled(next.backgroundRoom !== false);
      await saveRoomSettingsLocally(next);
      const client =
        auth.value.provider === "convex" && auth.value.user
          ? clientSig.value
          : null;
      if (client) {
        try {
          await client.mutation(api.sync.putRoomSettings, { settings: next });
        } catch {
          /* sync will retry */
        }
      }
    });

    /**
     * Ask a single editor to propose a fix for a passage, then hand the
     * rewrite to the editor (which owns the doc + Lix branch). Returns true
     * if a proposal was made.
     */
    const proposeFix = $(
      async (
        persona: Persona,
        anchor: string,
        kind: SuggestionKind,
      ): Promise<boolean> => {
        const client =
          auth.value.provider === "convex" && auth.value.user
            ? clientSig.value
            : null;
        const draftText = await readCurrentDraftText();
        const readiness = draftReadiness(draftText, MIN_MARKUP_WORDS);
        if (!readiness.ok) {
          store.conveneError = localDraftValidationError("propose-fix");
          return false;
        }
        if (!anchor.trim()) return false;

        let replacement = anchor;
        let rationale = "";

        // ── Try client-side AI first (BYOK) ─────────────────────────
        const settings = store.aiSettings;
        const hasByok = hasConfiguredAiProvider(settings);
        if (hasByok && settings) {
          try {
            const res = await runClientRewrite(
              {
                persona: toAgentPersona(persona),
                brief: brief ?? null,
                draftText,
                writerProfile: store.writerProfile,
                original: anchor,
                level: kind,
              },
              settings,
            );
            if (
              res &&
              res.replacement.trim() &&
              res.replacement.trim() !== anchor.trim()
            ) {
              replacement = res.replacement || anchor;
              rationale = res.rationale ?? "";
            } else {
              store.conveneError = providerUnavailableError("propose-fix");
              return false;
            }
          } catch (err) {
            store.conveneError = normalizePersonaError(
              "twyne:personas:rewrite-client",
              err,
              "provider",
              "propose-fix",
            );
            return false;
          }
        }

        // ── Server action only when no local provider is configured ──────────
        if (replacement.trim() === anchor.trim() && !hasByok && client) {
          try {
            const r = (await client.action(api.agents.suggestRewrite, {
              persona: toAgentPersona(persona),
              brief: brief ?? null,
              draftText,
              writerProfile: store.writerProfile,
              original: anchor,
              level: kind,
            })) as {
              replacement: string;
              rationale: string;
              provider?: string;
            };
            if (r.provider === "local") {
              store.conveneError = providerUnavailableError("propose-fix");
              return false;
            }
            replacement = r.replacement || anchor;
            rationale = r.rationale ?? "";
          } catch (err) {
            store.conveneError = normalizePersonaError(
              "twyne:personas:rewrite-server",
              err,
              "convex",
              "propose-fix",
            );
            return false;
          }
        }
        if (replacement.trim() === anchor.trim() && !hasByok && !client) {
          store.conveneError = providerConfigurationError("propose-fix");
          return false;
        }
        if (replacement.trim() === anchor.trim()) {
          store.conveneError = malformedProviderResponseError("propose-fix");
          return false;
        }

        window.dispatchEvent(
          new CustomEvent("twyne:propose-edit", {
            detail: {
              id: `sg-${persona.id}-${Date.now()}`,
              personaId: persona.id,
              personaName: persona.name,
              color: persona.color,
              original: anchor,
              replacement,
              rationale,
              kind,
            },
          }),
        );
        store.proposalsUsed += 1;
        if (kind === "paragraph") store.largeEditsUsed += 1;
        return true;
      },
    );

    /** Per-note "ask for a fix" — uses the note's anchor sentence. */
    const askForFix = $(async (note: PersonaFeedback) => {
      const persona = store.personas.find((p) => p.id === note.personaId);
      if (!persona || !note.anchor) return;
      const level = effectiveLevel(store.roomSettings, persona.id);
      if (level === "comments") return;
      store.fixingNoteId = note.noteId ?? null;
      try {
        await proposeFix(
          persona,
          note.anchor,
          level === "paragraph" ? "paragraph" : "sentence",
        );
      } finally {
        store.fixingNoteId = null;
      }
    });

    /** Proactive "mark up my draft": a budget-bounded pass over the room. */
    const markUpDraft = $(async () => {
      store.isMarkingUp = true;
      store.proposalsUsed = 0;
      store.largeEditsUsed = 0;
      try {
        const draftText = await readCurrentDraftText();
        const readiness = draftReadiness(draftText, MIN_MARKUP_WORDS);
        if (!readiness.ok) {
          store.conveneError = localDraftValidationError("mark-up-draft");
          return;
        }
        const scope = store.roomSettings.personaScope;
        const inScope = store.personas.filter(
          (p) =>
            effectiveLevel(store.roomSettings, p.id) !== "comments" &&
            (scope.length === 0 || scope.includes(p.id)),
        );
        const anchors = pickAnchorSentences(
          draftText,
          inScope.map((p) => p.id),
        );
        for (const persona of inScope) {
          if (store.proposalsUsed >= store.roomSettings.maxProposals) break;
          const level = effectiveLevel(store.roomSettings, persona.id);
          const kind: SuggestionKind =
            level === "paragraph" ? "paragraph" : "sentence";
          if (
            kind === "paragraph" &&
            store.largeEditsUsed >= store.roomSettings.maxLargeEdits
          ) {
            continue;
          }
          const anchor = anchors[persona.id];
          if (!anchor) continue;
          await proposeFix(persona, anchor, kind);
        }
      } finally {
        store.isMarkingUp = false;
      }
    });

    /* ── Strike the room ───────────────────────────────────────── */

    const clearRoom = $(async () => {
      store.feedback = [];
      store.expandedFeedback = new Set();
      store.repliesByNote = {};
      store.replyNoteId = null;
      store.replyingTo = null;
      window.dispatchEvent(new CustomEvent("twyne:clear-persona-notes"));
      await strikeRoomLocally();
    });

    return (
      <>
        <div class="flex h-full min-h-0 flex-col overflow-y-auto bg-[var(--color-paper-2)]">
          {/* ── Header ─────────────────────────────────────────── */}
          <div class="border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-4 py-3">
            <div class="flex min-w-0 items-center justify-between gap-3">
              <div class="min-w-0">
                <h2
                  class="truncate text-lg text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 600;"
                >
                  The Room of Editors
                </h2>
                <p
                  class="mt-0.5 truncate text-[0.7rem] text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif); font-style: italic;"
                >
                  {brief?.answers.workingTitle || "Untitled project"}
                  {brief?.answers.format ? ` · ${brief.answers.format}` : ""}
                </p>
              </div>
              {store.lastProvider && (
                <span
                  class="provider-pill"
                  data-provider={store.lastProvider}
                  title={
                    store.lastProvider === "local"
                      ? "No LLM provider configured — using the local fallback. Set RIVET_ENDPOINT, ANTHROPIC_API_KEY, or OPENAI_API_KEY to upgrade."
                      : `Served by ${store.lastProvider}.`
                  }
                >
                  {store.lastProvider === "local"
                    ? "fallback"
                    : store.lastProvider}
                </span>
              )}
            </div>
          </div>

          {/* ── Collapse toggle — hide the cast & controls to read notes ── */}
          <button
            onClick$={() => {
              store.controlsCollapsed = !store.controlsCollapsed;
            }}
            class="focus-ring w-full flex items-center justify-between px-4 py-1.5 border-b border-[var(--color-paper-3)] text-[11px] text-[var(--color-ink-light)] hover:text-[var(--color-ink)]"
            style="font-family: var(--font-typewriter);"
            aria-expanded={!store.controlsCollapsed}
            title={
              store.controlsCollapsed
                ? "Show the cast & controls"
                : "Collapse the cast & controls for more room"
            }
          >
            <span>
              {store.controlsCollapsed ? "▸ Show controls" : "▾ Hide controls"}
            </span>
            {store.controlsCollapsed && store.feedback.length > 0 && (
              <span class="text-[var(--color-ink-muted)]">
                {store.feedback.length} note
                {store.feedback.length === 1 ? "" : "s"}
              </span>
            )}
          </button>

          {/* ── Cast and room controls ───────────────────────────── */}
          {!store.controlsCollapsed && (
            <div class="border-b border-[var(--color-paper-3)] px-3 pb-2.5 pt-2.5">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="dept-label shrink-0" style="margin: 0;">
                    Cast
                  </span>
                  <ul
                    class="flex items-center gap-1"
                    aria-label={`Current cast, ${store.personas.length} editors`}
                  >
                    {store.personas.map((persona) => (
                      <li key={persona.id}>
                        <span
                          class="cast-icon"
                          style={{ ["--frame-color" as never]: persona.color }}
                          role="img"
                          aria-label={`${persona.role}, ${persona.name}`}
                          title={`${persona.role}: ${persona.name}`}
                        >
                          {persona.icon}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <a
                  href="/personas"
                  class="focus-ring shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Edit cast →
                </a>
              </div>

              <div class="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick$={requestFeedback}
                  disabled={store.isGenerating}
                  class="convene-btn"
                >
                  {store.isGenerating ? (
                    <span class="flex items-center justify-center gap-2">
                      <span class="inline-block animate-spin">✦</span>
                      The room is reading…
                    </span>
                  ) : (
                    <span class="room-btn-title">✦ Get notes</span>
                  )}
                </button>

                {store.roomSettings.level !== "comments" && (
                  <button
                    onClick$={markUpDraft}
                    disabled={store.isMarkingUp || store.isGenerating}
                    class="markup-btn"
                  >
                    {store.isMarkingUp ? (
                      <span class="room-btn-title">Proposing…</span>
                    ) : (
                      <span class="room-btn-title">✎ Propose edits</span>
                    )}
                  </button>
                )}
              </div>

              <div class="mt-1">
                <button
                  onClick$={() => {
                    if (store.analysis && !store.isAnalyzing) {
                      store.analysisOpen = true;
                      return;
                    }
                    void expandAnalysis();
                  }}
                  disabled={store.isAnalyzing}
                  class="room-btn-link"
                  title="The same five editors, at length: a full-page memo each, then the room's synthesis. Opens full screen."
                >
                  {store.isAnalyzing
                    ? "✦ Writing analysis…"
                    : store.analysis
                      ? "❡ Open full analysis ↗"
                      : "❡ Run full analysis ↗"}
                </button>
              </div>

              {/* ── The room reading in the background ──
                A quiet line of status, not a control. The writer should be
                able to tell at a glance whether anyone is listening, and how
                close the next passing note is, without having to ask. */}
              {store.backgroundRoom &&
                store.backgroundRoom.status !== "off" && (
                  <p
                    class="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]"
                    style="font-family: var(--font-typewriter);"
                    role="status"
                  >
                    <span
                      aria-hidden="true"
                      class={
                        store.backgroundRoom.status === "reading"
                          ? "animate-pulse"
                          : ""
                      }
                      style={{
                        color:
                          store.backgroundRoom.status === "error"
                            ? "var(--color-accent-red)"
                            : store.backgroundRoom.status === "reading"
                              ? "var(--color-vermilion)"
                              : "var(--color-ink-muted)",
                      }}
                    >
                      ✦
                    </span>
                    {backgroundRoomLabel(store.backgroundRoom)}
                  </p>
                )}

              <div class="mt-1.5 flex items-center justify-between">
                <button
                  onClick$={() => {
                    store.settingsOpen = !store.settingsOpen;
                  }}
                  class="focus-ring text-[11px] text-[var(--color-ink-light)] hover:text-[var(--color-ink)]"
                  style="font-family: var(--font-typewriter);"
                  aria-expanded={store.settingsOpen}
                >
                  {store.settingsOpen ? "▾" : "▸"} Room settings
                </button>
                {store.roomSettings.level === "paragraph" && (
                  <span
                    class="text-[10px] text-[var(--color-ink-muted)]"
                    style="font-family: var(--font-typewriter);"
                    title="Large (paragraph) edits remaining this pass"
                  >
                    Large edits:{" "}
                    {Math.max(
                      0,
                      store.roomSettings.maxLargeEdits - store.largeEditsUsed,
                    )}{" "}
                    of {store.roomSettings.maxLargeEdits} left
                  </span>
                )}
              </div>

              {store.settingsOpen && (
                <div class="mt-1.5 space-y-2 rounded-sm border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-2.5">
                  <div>
                    <p
                      class="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-light)] mb-1"
                      style="font-family: var(--font-typewriter);"
                    >
                      Edit scope
                    </p>
                    <div class="flex gap-1">
                      {(
                        [
                          "comments",
                          "sentence",
                          "paragraph",
                        ] as AssistanceLevel[]
                      ).map((lvl) => (
                        <button
                          key={lvl}
                          onClick$={() =>
                            persistSettings({
                              ...store.roomSettings,
                              level: lvl,
                            })
                          }
                          class={`flex-1 rounded-sm border px-1 py-1 text-[11px] capitalize ${
                            store.roomSettings.level === lvl
                              ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]"
                              : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"
                          }`}
                          style="font-family: var(--font-typewriter);"
                        >
                          {lvl === "comments" ? "Notes only" : lvl}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label class="flex items-center justify-between text-[11px] text-[var(--color-ink)]">
                      <span style="font-family: var(--font-typewriter);">
                        Read as I write
                      </span>
                      <input
                        type="checkbox"
                        checked={store.roomSettings.backgroundRoom !== false}
                        onChange$={(_, el) =>
                          persistSettings({
                            ...store.roomSettings,
                            backgroundRoom: el.checked,
                          })
                        }
                        class="h-3.5 w-3.5 accent-[var(--color-vermilion)]"
                      />
                    </label>
                    <p
                      class="mt-0.5 text-[10px] leading-4 text-[var(--color-ink-muted)]"
                      style="font-family: var(--font-serif);"
                    >
                      Adds notes after {WORD_DELTA_THRESHOLD} new words.
                    </p>
                  </div>
                  <label class="flex items-center justify-between text-[11px] text-[var(--color-ink)]">
                    <span style="font-family: var(--font-typewriter);">
                      Edits per pass
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={store.roomSettings.maxProposals}
                      onChange$={(_, el) =>
                        persistSettings({
                          ...store.roomSettings,
                          maxProposals: Math.max(
                            1,
                            Math.min(20, Number(el.value) || 1),
                          ),
                        })
                      }
                      class="w-14 rounded-sm border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1 py-0.5 text-right"
                    />
                  </label>
                  <label class="flex items-center justify-between text-[11px] text-[var(--color-ink)]">
                    <span style="font-family: var(--font-typewriter);">
                      Paragraph edits
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={store.roomSettings.maxLargeEdits}
                      onChange$={(_, el) =>
                        persistSettings({
                          ...store.roomSettings,
                          maxLargeEdits: Math.max(
                            0,
                            Math.min(10, Number(el.value) || 0),
                          ),
                        })
                      }
                      class="w-14 rounded-sm border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1 py-0.5 text-right"
                    />
                  </label>
                </div>
              )}

              {store.conveneError && (
                <div class="mt-2">
                  <ApplicationNotice
                    error={store.conveneError}
                    compact
                    title={
                      store.conveneError.source === "validation"
                        ? "Draft too short"
                        : undefined
                    }
                    showReference={store.conveneError.source !== "validation"}
                    recoveryLabel={
                      store.conveneError.source === "validation"
                        ? undefined
                        : "Open AI settings"
                    }
                    recoveryHref={
                      store.conveneError.source === "validation"
                        ? undefined
                        : "/settings/"
                    }
                    onDismiss$={() => {
                      store.conveneError = null;
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── The feed's own header. Striking the room is a delete, not a
            third way to ask the editors for something, so it sits with the
            notes it clears rather than under the buttons that make them. ── */}
          {store.feedback.length > 0 && !store.isGenerating && (
            <div class="flex items-center gap-3 border-b border-[var(--color-paper-3)] px-4 py-1.5">
              <span
                class="panel-meta uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                {store.feedback.length} note
                {store.feedback.length === 1 ? "" : "s"}
              </span>
              <span class="flex-1" />
              <button
                onClick$={() => {
                  store.groupByPersona = !store.groupByPersona;
                }}
                class="panel-meta uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] focus-ring"
                style="font-family: var(--font-typewriter);"
                aria-pressed={store.groupByPersona}
                title={
                  store.groupByPersona
                    ? "Showing latest note per editor — click to show all"
                    : "Showing every note — click to group by editor"
                }
              >
                {store.groupByPersona ? "▾ grouped" : "▸ all notes"}
              </button>
              <button
                onClick$={() => {
                  store.compactView = !store.compactView;
                }}
                class="panel-meta uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] focus-ring"
                style="font-family: var(--font-typewriter);"
                aria-pressed={store.compactView}
                title={
                  store.compactView
                    ? "Notes clamped — click to read in full"
                    : "Showing full notes — click to clamp them"
                }
              >
                {store.compactView ? "▸ compact" : "▾ full"}
              </button>
              <button
                onClick$={clearRoom}
                class="panel-meta uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] focus-ring"
                style="font-family: var(--font-typewriter);"
                title="Strike the room — clears every note here and every pin in the manuscript"
              >
                clear ✕
              </button>
            </div>
          )}

          {/* ── Marginalia — feedback feed ──────────────────────── */}
          <div class="flex-1 space-y-3 px-4 py-3">
            {/* Notes being written, above the filed ones. Each editor fills
              their own card as they go, so the wait is spent reading rather
              than watching a spinner. These are not notes yet: no reply box,
              no strike, nothing to act on until they are filed. */}
            {store.personas
              .filter((p) => (store.streamingNotes[p.id] ?? "").trim())
              .map((persona) => (
                <div
                  key={`streaming-${persona.id}`}
                  class="p-3 border-l-2 bg-[var(--color-paper-soft)]"
                  style={{
                    borderColor: persona.color,
                    borderRadius: "2px",
                  }}
                  aria-live="polite"
                >
                  <div class="flex items-baseline justify-between gap-2">
                    <p
                      class="text-sm truncate text-[var(--color-ink)]"
                      style="font-family: var(--font-display); font-weight: 600;"
                    >
                      {persona.name}
                    </p>
                    <p
                      class="text-[0.65rem] tracking-[0.14em] uppercase"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        color: persona.color,
                      }}
                    >
                      writing…
                    </p>
                  </div>
                  <div
                    class="comment-markdown mt-1.5 text-[0.85rem] leading-5 text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                    dangerouslySetInnerHTML={renderMarkdown(
                      store.streamingNotes[persona.id] ?? "",
                    )}
                  />
                </div>
              ))}

            {store.streamingSynthesis.trim() && (
              <div
                class="p-3 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] rounded"
                aria-live="polite"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <p class="dept-label">The Room's Verdict</p>
                  <p
                    class="text-[0.65rem] tracking-[0.14em] uppercase text-[var(--color-ink-muted)]"
                    style="font-family: var(--font-typewriter);"
                  >
                    writing…
                  </p>
                </div>
                <div
                  class="comment-markdown mt-1.5 text-[0.85rem] leading-5 text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif);"
                  dangerouslySetInnerHTML={renderMarkdown(
                    store.streamingSynthesis,
                  )}
                />
              </div>
            )}

            {store.feedback.length === 0 && !store.isGenerating && (
              <div class="px-4 py-6 text-center">
                <p
                  class="text-xl"
                  style="font-family: var(--font-display); color: var(--color-vermilion);"
                >
                  ❦
                </p>
                <p
                  class="mt-2 text-sm text-[var(--color-ink-light)]"
                  style="font-family: var(--font-serif); font-style: italic;"
                >
                  No notes yet. Write a few paragraphs, then get notes.
                </p>
              </div>
            )}

            {(() => {
              const filtered = store.feedback;
              // When grouped, reduce to one entry per persona (the latest).
              const items: PersonaFeedback[] = store.groupByPersona
                ? Array.from(
                    filtered
                      .reduce((map, f) => {
                        const cur = map.get(f.personaId);
                        if (!cur || cur.timestamp < f.timestamp) {
                          map.set(f.personaId, f);
                        }
                        return map;
                      }, new Map<string, PersonaFeedback>())
                      .values(),
                  )
                : filtered;
              return items.map((feedback) => {
                const persona = store.personas.find(
                  (p) => p.id === feedback.personaId,
                );
                const isExpanded = store.expandedPersonas.has(
                  feedback.personaId,
                );
                const groupCount = store.groupByPersona
                  ? filtered.filter((f) => f.personaId === feedback.personaId)
                      .length
                  : 0;
                const replies = feedback.noteId
                  ? (store.repliesByNote[feedback.noteId] ?? [])
                  : [];
                const replyOpen = store.replyingTo === feedback.noteId;
                const personaColor = feedback.personaColor;
                const noteKey =
                  feedback.noteId ??
                  `${feedback.personaId}-${feedback.timestamp}`;
                const bodyClamped =
                  store.compactView && !store.expandedFeedback.has(noteKey);
                // A note the room left unasked is a remark over the shoulder,
                // not a filed report — so it gets lighter chrome and says where
                // it came from, and never looks like work the writer requested.
                const isPassing = feedback.origin === "background";
                return (
                  <div
                    key={noteKey}
                    class={
                      isPassing
                        ? "passing-note feedback-enter px-4 py-3"
                        : "clipping feedback-enter p-4"
                    }
                    style={{ ["--clip-color" as never]: personaColor }}
                  >
                    <div class="flex items-start gap-3 mb-2">
                      <span
                        class="portrait-icon flex-shrink-0"
                        style={{ ["--frame-color" as never]: personaColor }}
                      >
                        {persona?.icon}
                      </span>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center justify-between gap-2">
                          <p
                            class="text-sm text-[var(--color-ink)] truncate"
                            style="font-family: var(--font-display); font-weight: 600;"
                          >
                            {feedback.personaName}
                          </p>
                          <div class="flex items-center gap-1.5 flex-shrink-0">
                            <p
                              class="text-[0.65rem] tracking-[0.14em] uppercase"
                              style={{
                                fontFamily: "var(--font-typewriter)",
                                color: personaColor,
                              }}
                            >
                              {isPassing
                                ? "in passing"
                                : typeLabel(feedback.type)}
                            </p>
                            <SpeakButton
                              compact
                              id={noteKey}
                              text={feedback.feedback}
                              voice={persona?.speechVoice}
                              voices={persona?.speechVoices}
                              instructions={persona?.voice}
                              label={feedback.personaName}
                            />
                          </div>
                        </div>
                        {feedback.anchor && (
                          <blockquote
                            class="mt-1.5 pl-2 border-l-2 text-[11px] italic text-[var(--color-ink-muted)] cursor-pointer hover:text-[var(--color-ink)]"
                            style={{
                              borderColor: personaColor,
                              fontFamily: "var(--font-serif)",
                            }}
                            onClick$={() => {
                              if (feedback.noteId) {
                                window.dispatchEvent(
                                  new CustomEvent(
                                    "twyne:scroll-to-persona-note",
                                    {
                                      detail: feedback.noteId,
                                    },
                                  ),
                                );
                              }
                            }}
                            title="Show this note in the manuscript"
                          >
                            « {truncate(feedback.anchor, 160)} »
                          </blockquote>
                        )}
                      </div>
                    </div>
                    <div
                      class={`comment-markdown text-[14px] leading-6 text-[var(--color-ink-light)]${
                        bodyClamped ? " cursor-pointer" : ""
                      }`}
                      style={
                        bodyClamped
                          ? "font-family: var(--font-serif); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;"
                          : "font-family: var(--font-serif);"
                      }
                      title={
                        bodyClamped ? "Click to read the full note" : undefined
                      }
                      onClick$={
                        store.compactView
                          ? () => {
                              const cur = new Set(store.expandedFeedback);
                              if (cur.has(noteKey)) cur.delete(noteKey);
                              else cur.add(noteKey);
                              store.expandedFeedback = cur;
                            }
                          : undefined
                      }
                      dangerouslySetInnerHTML={renderMarkdown(
                        feedback.feedback,
                      )}
                    />

                    {feedback.traceId && (
                      <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-paper-3)] pt-2">
                        <span
                          class="text-[0.6rem] tracking-[0.14em] uppercase text-[var(--color-ink-muted)]"
                          style="font-family: var(--font-typewriter);"
                        >
                          useful?
                        </span>
                        <button
                          class="text-[0.65rem] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                          aria-label="Mark this note helpful"
                          onClick$={() =>
                            submitAiFeedback(feedback, "positive")
                          }
                        >
                          ↑ helpful
                        </button>
                        <button
                          class="text-[0.65rem] text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                          aria-label="Mark this note as needing work"
                          onClick$={() =>
                            submitAiFeedback(feedback, "negative")
                          }
                        >
                          ↓ needs work
                        </button>
                        {store.aiFeedback[feedback.traceId]?.sentiment ===
                          "negative" && (
                          <div class="flex flex-wrap gap-1">
                            {(
                              [
                                ["grounding", "not grounded"],
                                ["usefulness", "not useful"],
                                ["tone", "wrong tone"],
                                ["incorrect", "incorrect"],
                                ["too_long", "too long"],
                                ["other", "other"],
                              ] as const
                            ).map(([reason, label]) => (
                              <button
                                key={reason}
                                class="rounded border border-[var(--color-paper-3)] px-1.5 py-0.5 text-[0.6rem] text-[var(--color-ink-muted)] hover:border-[var(--color-vermilion)] hover:text-[var(--color-vermilion)]"
                                onClick$={() =>
                                  submitAiFeedback(feedback, "negative", reason)
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {store.groupByPersona && groupCount > 1 && (
                      <button
                        class="mt-1.5 text-[0.6rem] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                        style="font-family: var(--font-typewriter);"
                        onClick$={() => {
                          const cur = new Set(store.expandedPersonas);
                          if (cur.has(feedback.personaId))
                            cur.delete(feedback.personaId);
                          else cur.add(feedback.personaId);
                          store.expandedPersonas = cur;
                        }}
                      >
                        {isExpanded
                          ? "▾ hide older"
                          : `+ ${groupCount - 1} older from ${feedback.personaName}`}
                      </button>
                    )}

                    {/* Threaded replies */}
                    {replies.length > 0 && (
                      <div class="reply-thread">
                        {replies.map((r) => (
                          <div
                            key={r.id}
                            class={`reply-bubble ${r.authorKind === "persona" ? "is-persona" : ""}`}
                            style={{ ["--reply-color" as never]: personaColor }}
                          >
                            <div class="reply-meta">
                              <strong style={{ color: personaColor }}>
                                {r.author}
                              </strong>
                              <span>· {timeAgo(r.timestamp)}</span>
                            </div>
                            <div
                              class="comment-markdown mt-0.5"
                              dangerouslySetInnerHTML={renderMarkdown(r.text)}
                            />
                          </div>
                        ))}
                        {feedback.noteId &&
                          store.isReplying &&
                          store.streamingReplies[feedback.noteId] !==
                            undefined && (
                            <div
                              class="reply-bubble is-persona"
                              style={{
                                ["--reply-color" as never]: personaColor,
                              }}
                            >
                              <div class="reply-meta">
                                <strong style={{ color: personaColor }}>
                                  {feedback.personaName}
                                </strong>
                                <span>· writing…</span>
                              </div>
                              {/* The reply as it is written. The pulse is only
                              for the gap before the first words arrive. */}
                              {(
                                store.streamingReplies[feedback.noteId] ?? ""
                              ).trim() ? (
                                <div
                                  class="comment-markdown mt-0.5"
                                  dangerouslySetInnerHTML={renderMarkdown(
                                    store.streamingReplies[feedback.noteId],
                                  )}
                                />
                              ) : (
                                <p class="mt-0.5">
                                  <span class="inline-block animate-pulse">
                                    …
                                  </span>
                                </p>
                              )}
                            </div>
                          )}
                      </div>
                    )}

                    {replyOpen ? (
                      <div class="reply-box">
                        <textarea
                          class="reply-input"
                          autoFocus
                          placeholder={`Reply to ${feedback.personaName}…`}
                          value={store.replyDraft}
                          onInput$={(e) => {
                            store.replyDraft = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          onKeyDown$={(e) => {
                            if (
                              (e.metaKey || e.ctrlKey) &&
                              e.key === "Enter" &&
                              feedback.noteId
                            ) {
                              submitReply(feedback.noteId, true);
                            }
                          }}
                        />
                        <div class="reply-actions">
                          <button
                            class="ask-again"
                            disabled={
                              !store.replyDraft.trim() || store.isReplying
                            }
                            onClick$={() => {
                              if (feedback.noteId)
                                submitReply(feedback.noteId, true);
                            }}
                          >
                            {store.isReplying ? "…" : "Ask the editor ↺"}
                          </button>
                          <button
                            class="ghost"
                            onClick$={() => {
                              if (feedback.noteId)
                                submitReply(feedback.noteId, false);
                            }}
                            disabled={
                              !store.replyDraft.trim() || store.isReplying
                            }
                          >
                            File only
                          </button>
                          <button
                            class="ghost"
                            onClick$={cancelReply}
                            disabled={store.isReplying}
                          >
                            Cancel
                          </button>
                        </div>
                        <p
                          class="text-[10px] text-[var(--color-ink-muted)]"
                          style="font-family: var(--font-typewriter); letter-spacing: 0.12em;"
                        >
                          ⌘+Enter to ask the editor to come back
                        </p>
                      </div>
                    ) : (
                      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                          class="text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                          style="font-family: var(--font-typewriter);"
                          onClick$={() => {
                            if (feedback.noteId) openReply(feedback.noteId);
                          }}
                        >
                          + Reply / ask the editor
                        </button>
                        {feedback.anchor &&
                          effectiveLevel(
                            store.roomSettings,
                            feedback.personaId,
                          ) !== "comments" && (
                            <button
                              class="text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)] disabled:opacity-50"
                              style="font-family: var(--font-typewriter);"
                              disabled={store.fixingNoteId === feedback.noteId}
                              onClick$={() => askForFix(feedback)}
                              title="Ask this editor to propose an edit to the anchored passage"
                            >
                              {store.fixingNoteId === feedback.noteId
                                ? "drafting…"
                                : "✎ ask for a fix"}
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* ── Full-page cast analysis: a real expanded view, not a sidebar inset ── */}
        {store.analysis && store.analysisOpen && (
          <div
            class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8"
            onClick$={() => {
              store.analysisOpen = false;
            }}
          >
            <div
              class="w-full max-w-3xl bg-[var(--color-paper)] border border-[var(--color-paper-3)] rounded shadow-xl"
              onClick$={(e) => e.stopPropagation()}
            >
              <div class="sticky top-0 flex items-center justify-between border-b border-[var(--color-paper-3)] bg-[var(--color-paper)] px-6 py-4 rounded-t">
                <div>
                  <p class="dept-label">The Full Analysis</p>
                  {store.analysis.briefTitle && (
                    <p
                      class="mt-0.5 text-[13px] text-[var(--color-ink-light)]"
                      style="font-family: var(--font-serif);"
                    >
                      {store.analysis.briefTitle}
                    </p>
                  )}
                </div>
                <div class="flex items-center gap-4">
                  <Link
                    href="/analysis/"
                    class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                    style="font-family: var(--font-typewriter);"
                    title="Open as a full page"
                  >
                    ↗ full page
                  </Link>
                  <button
                    onClick$={downloadAnalysis}
                    class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                    style="font-family: var(--font-typewriter);"
                    title="Download as Markdown"
                  >
                    ⇩ download
                  </button>
                  <button
                    onClick$={() => {
                      store.analysis = null;
                      store.analysisOpen = false;
                    }}
                    class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                    style="font-family: var(--font-typewriter);"
                    title="Clear the full analysis"
                  >
                    ✕ clear
                  </button>
                  <button
                    onClick$={() => {
                      store.analysisOpen = false;
                    }}
                    class="icon-btn text-sm"
                    aria-label="Close full analysis"
                    title="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {store.analysis.memos.length > 1 && (
                <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-paper-3)] px-6 py-2.5">
                  <span
                    class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)]"
                    style="font-family: var(--font-typewriter);"
                  >
                    Jump to
                  </span>
                  {store.analysis.memos.map((memo) => (
                    <button
                      key={memo.personaId}
                      onClick$={() => scrollToMemo(memo.personaId)}
                      class="rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.1em] uppercase transition-colors hover:bg-[var(--color-paper-soft)]"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        borderColor: memo.personaColor,
                        color: memo.personaColor,
                      }}
                    >
                      {memo.personaName}
                    </button>
                  ))}
                </div>
              )}

              <div class="px-6 py-5">
                {store.analysis.synthesis && (
                  <div class="mb-5 p-3 bg-[var(--color-paper-soft)] border border-[var(--color-paper-3)] rounded">
                    <div class="flex items-center justify-between">
                      <p class="dept-label">The Room's Verdict</p>
                      <div class="flex items-center gap-2">
                        <SpeakButton
                          compact
                          id="analysis-synthesis"
                          text={store.analysis.synthesis}
                          label="the room"
                        />
                        <button
                          onClick$={() =>
                            copyAnalysisText(
                              "synthesis",
                              store.analysis!.synthesis,
                            )
                          }
                          class="text-[10px] tracking-[0.1em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                          style="font-family: var(--font-typewriter);"
                        >
                          {store.analysisCopiedId === "synthesis"
                            ? "✓ copied"
                            : "copy"}
                        </button>
                      </div>
                    </div>
                    <div
                      class="comment-markdown mt-2 text-[13px] leading-6 text-[var(--color-ink)]"
                      style="font-family: var(--font-serif);"
                      dangerouslySetInnerHTML={renderMarkdown(
                        store.analysis.synthesis,
                      )}
                    />
                  </div>
                )}

                <div class="space-y-5">
                  {store.analysis.memos.map((memo) => {
                    const collapsed = !!store.analysisCollapsed[memo.personaId];
                    return (
                      <article
                        key={memo.personaId}
                        id={`analysis-memo-${memo.personaId}`}
                        class="scroll-mt-24 pl-3"
                        style={{ borderLeft: `3px solid ${memo.personaColor}` }}
                      >
                        <div class="flex items-center justify-between gap-2">
                          <button
                            onClick$={() => toggleMemoCollapsed(memo.personaId)}
                            class="flex items-center gap-1.5 text-[11px] tracking-[0.15em] uppercase"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                              color: memo.personaColor,
                            }}
                            aria-expanded={!collapsed}
                          >
                            <span class="inline-block w-3">
                              {collapsed ? "▸" : "▾"}
                            </span>
                            {memo.personaName}
                          </button>
                          <div class="flex items-center gap-2">
                            <SpeakButton
                              compact
                              id={`analysis-memo-${memo.personaId}`}
                              text={memo.text}
                              voice={
                                store.personas.find(
                                  (p) => p.id === memo.personaId,
                                )?.speechVoice
                              }
                              voices={
                                store.personas.find(
                                  (p) => p.id === memo.personaId,
                                )?.speechVoices
                              }
                              instructions={
                                store.personas.find(
                                  (p) => p.id === memo.personaId,
                                )?.voice
                              }
                              label={memo.personaName}
                            />
                            <button
                              onClick$={() =>
                                copyAnalysisText(memo.personaId, memo.text)
                              }
                              class="text-[10px] tracking-[0.1em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                              style="font-family: var(--font-typewriter);"
                            >
                              {store.analysisCopiedId === memo.personaId
                                ? "✓ copied"
                                : "copy"}
                            </button>
                          </div>
                        </div>
                        {!collapsed && (
                          <div
                            class="comment-markdown mt-1 text-[13px] leading-6 text-[var(--color-ink)]"
                            style="font-family: var(--font-serif);"
                            dangerouslySetInnerHTML={renderMarkdown(memo.text)}
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  },
);

/* ── Draft text helpers ──────────────────────────────────────── */

async function readCurrentDraftText(): Promise<string> {
  let draftText = "";
  const receive = (e: Event) => {
    draftText = (e as CustomEvent).detail as string;
  };
  window.addEventListener("twyne:draft-text", receive);
  window.dispatchEvent(new CustomEvent("twyne:request-draft"));
  window.removeEventListener("twyne:draft-text", receive);
  return draftText || (await loadDraftText());
}

/* ── Display helpers ────────────────────────────────────────── */

/**
 * One line describing what the background room is doing. Deliberately states
 * how much more writing it is waiting for, so the cadence never feels
 * arbitrary — a writer who can see "180 more words" understands the room, and
 * a writer watching a silent panel does not.
 */
function backgroundRoomLabel(s: BackgroundRoomSnapshot): string {
  switch (s.status) {
    case "reading":
      return "The room is reading your new pages…";
    case "error":
      return "The room stopped reading — it will try again";
    case "armed": {
      return "The room will read when you pause";
    }
    case "idle":
    default: {
      if (s.passesThisSession >= 1 && s.lastPassAt > 0) {
        return `The room last read ${timeAgo(s.lastPassAt)}`;
      }
      const remaining = Math.max(
        0,
        WORD_DELTA_THRESHOLD - Math.max(0, s.pendingWords),
      );
      return remaining > 0
        ? `The room reads on — ${remaining} more words`
        : "The room is listening";
    }
  }
}

function typeLabel(type: PersonaFeedback["type"]): string {
  switch (type) {
    case "encouragement":
      return "in defense of";
    case "suggestion":
      return "a small suggestion";
    case "critique":
      return "a counter-reading";
    case "perspective":
      return "from the audience";
  }
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1).trimEnd() + "…";
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
