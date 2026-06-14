import {
  component$,
  useStore,
  $,
  useStylesScoped$,
  useVisibleTask$,
  noSerialize,
  type NoSerialize,
} from "@builder.io/qwik";
import { useConvexClient } from "../../utils/convex-context";
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
} from "../../types";
import { DEFAULT_ROOM_SETTINGS } from "../../types";
import { loadDraftText, summarizeBrief } from "../../utils/anti-tabula-rasa";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
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
  normalizeAiSettings,
} from "../../utils/ai-client";
import type { AiSettings } from "../../types";
import { loadAiSettingsFromIdb } from "../../utils/idb";

/* ── Types ──────────────────────────────────────────────────────── */

interface PersonasStore {
  activePersona: string | null;
  feedback: PersonaFeedback[];
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
  /** Last convene error, if any. */
  conveneError: string | null;
  /** Replies keyed by noteId. */
  repliesByNote: Record<string, PersonaReply[]>;
  /** When true, group feedback by persona (latest + count). */
  groupByPersona: boolean;
  /** Expanded persona ids (for the per-persona "see older" toggle). */
  expandedPersonas: Set<string>;
  /** Draft text the writer is composing in the reply box. */
  replyDraft: string;
  /** Active note id being replied to. */
  replyNoteId: string | null;
  /** Whether the last convene was served by an LLM (false = local fallback). */
  lastProvider: "rivet" | "anthropic" | "openai" | "local" | null;
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
}

interface PersonasPanelProps {
  brief: ProjectBrief | null;
}

/** Effective assistance level for a persona (per-persona override wins). */
function effectiveLevel(
  settings: RoomSettings,
  personaId: string,
): AssistanceLevel {
  return settings.perPersona?.[personaId] ?? settings.level;
}

/* ── Anchor selection (kept from the original — deterministic) ─── */

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

export const PersonasPanel = component$(({ brief }: PersonasPanelProps) => {
  const clientSig = useConvexClient();
  const store = useStore<PersonasStore>({
    activePersona: null,
    feedback: [],
    isGenerating: false,
    expandedFeedback: new Set(),
    compactView: false,
    personas: DEFAULT_PERSONAS,
    replyingTo: null,
    isReplying: false,
    pinnedPersonas: new Set(),
    conveneError: null,
    repliesByNote: {},
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
    isMarkingUp: false,
    fixingNoteId: null,
    largeEditsUsed: 0,
    proposalsUsed: 0,
    aiSettings: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    // Custom personas from IDB / Convex.
    const custom = await loadPersonasFromIdb();
    if (custom && custom.length > 0) store.personas = custom;

    // Hydrate previously-saved notes & replies + room settings.
    const [notes, replies, settings] = await Promise.all([
      loadPersonaNotesLocally(),
      loadPersonaRepliesLocally(),
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
    const aiRaw = await loadAiSettingsFromIdb();
    store.aiSettings = normalizeAiSettings(aiRaw);

    // Capture the live Convex client (noSerialize keeps Qwik happy).
    if (clientSig.value) {
      store.clientRef = noSerialize(clientSig.value);
    }

    store.hydrated = true;
  });

  useStylesScoped$(`
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

    .portrait {
      position: relative;
      width: 100%;
      padding: 0.4rem 0.55rem 0.5rem;
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper);
      border-radius: 2px;
      transition: transform 0.15s ease, box-shadow 0.2s ease;
      cursor: pointer;
    }
    .portrait::before {
      content: "";
      position: absolute;
      inset: 3px;
      border: 1px solid var(--color-paper-3);
      pointer-events: none;
      border-radius: 1px;
    }
    .portrait:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 14px -10px rgba(31,27,22,0.3);
    }
    .portrait.is-active {
      box-shadow: 0 0 0 2px var(--frame-color, var(--color-vermilion));
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

    .portrait:focus-visible {
      outline: 2px solid var(--frame-color, var(--color-vermilion));
      outline-offset: 2px;
    }

    .convene-btn {
      width: 100%;
      font-family: var(--font-typewriter);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 0.72rem;
      padding: 0.7rem 1rem;
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
    .provider-pill[data-provider="rivet"] { color: var(--color-accent-green); border-color: var(--color-accent-green); }

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
    .reply-input:focus {
      outline: none;
      border-color: var(--color-vermilion);
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
      const anchors = pickAnchorSentences(
        draftText,
        store.personas.map((p) => p.id),
      );

      const client = clientSig.value;
      let responses: Array<{
        personaId: string;
        text: string;
        type: PersonaFeedback["type"];
        provider: "rivet" | "anthropic" | "openai" | "local";
      }> = [];

      // ── Try client-side AI first (BYOK) ─────────────────────────
      const settings = store.aiSettings;
      if (settings?.advancedMode && settings.providers.length > 0) {
        try {
          const tasks = store.personas.map(async (p) => {
            const req = {
              persona: {
                id: p.id,
                name: p.name,
                role: p.role,
                description: p.description,
                focus: p.focus,
                color: p.color,
                icon: p.icon,
              },
              brief: brief ?? null,
              draftText,
              anchor: anchors[p.id],
              instruction: "feedback" as const,
            };
            const res = await runClientAgent("persona-feedback", req, settings);
            return {
              personaId: p.id,
              text: res?.text ?? generateLocalFallback(p, brief, draftText),
              type: res?.type ?? defaultType(p.id),
              provider: (res?.provider ??
                "local") as (typeof responses)[0]["provider"],
            };
          });
          responses = await Promise.all(tasks);
          store.lastProvider = `client` as any;
        } catch (err) {
          console.warn("[twyne:personas] client AI failed, falling back:", err);
        }
      }

      // ── Fallback to Convex server action ────────────────────────
      if (responses.length === 0 && client) {
        try {
          const personasForServer = store.personas.map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            description: p.description,
            focus: p.focus,
            color: p.color,
            icon: p.icon,
          }));
          const result = (await client.action(api.agents.conveneRoom, {
            personas: personasForServer,
            brief: brief ?? null,
            draftText,
            anchors,
          })) as Array<{
            personaId: string;
            text: string;
            type: PersonaFeedback["type"];
            provider: "rivet" | "anthropic" | "openai" | "local";
          }>;
          responses = result;
          store.lastProvider = result[0]?.provider ?? null;
        } catch (err) {
          console.warn(
            "[twyne:personas] conveneRoom failed, using local fallback:",
            err,
          );
          store.conveneError =
            (err as Error).message ?? "Remote convene failed.";
          store.lastProvider = "local";
          responses = store.personas.map((p) => ({
            personaId: p.id,
            text: generateLocalFallback(p, brief, draftText),
            type: defaultType(p.id),
            provider: "local" as const,
          }));
        }
      }

      // No Convex client — local fallback.
      if (responses.length === 0) {
        store.lastProvider = "local";
        responses = store.personas.map((p) => ({
          personaId: p.id,
          text: generateLocalFallback(p, brief, draftText),
          type: defaultType(p.id),
          provider: "local" as const,
        }));
      }

      // Build PersonaFeedback[] from the responses, persisting each as we go.
      const timestamp = Date.now();
      const feedbackList: PersonaFeedback[] = [];
      for (const r of responses) {
        const persona = store.personas.find((p) => p.id === r.personaId);
        if (!persona) continue;
        const anchor = anchors[r.personaId];
        const noteId = `pn-${r.personaId}-${timestamp}`;
        const fb: PersonaFeedback = {
          personaId: r.personaId,
          personaName: persona.name,
          personaColor: persona.color,
          feedback: r.text,
          timestamp,
          type: r.type,
          anchor: anchor,
          noteId,
        };
        feedbackList.push(fb);
        await savePersonaNoteLocally(fb, brief);

        // Server-side push (best-effort, no-op if not signed in).
        const c = clientSig.value;
        if (c) {
          try {
            await c.mutation(api.sync.putPersonaNote, {
              noteId,
              personaId: r.personaId,
              personaName: persona.name,
              personaColor: persona.color,
              type: r.type,
              feedback: r.text,
              anchor,
              briefTitle: brief?.answers.workingTitle,
            });
          } catch (err) {
            console.warn("[twyne:personas] putPersonaNote failed:", err);
          }
        }
      }

      store.feedback = feedbackList;

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
    } finally {
      store.isGenerating = false;
    }
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

  const submitReply = $(async (noteId: string, askPersona: boolean) => {
    const text = store.replyDraft.trim();
    if (!text) return;
    const userReply: PersonaReply = {
      id: `preply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      noteId,
      author: "You",
      authorKind: "user",
      text,
      timestamp: Date.now(),
    };
    const updated = [...(store.repliesByNote[noteId] ?? []), userReply];
    store.repliesByNote = { ...store.repliesByNote, [noteId]: updated };
    await addPersonaReplyLocally(userReply);
    const client = clientSig.value;
    if (client) {
      try {
        await client.mutation(api.sync.addPersonaReply, {
          noteId,
          replyId: userReply.id,
          author: userReply.author,
          authorKind: "user",
          text: userReply.text,
        });
      } catch (err) {
        console.warn("[twyne:personas] addPersonaReply (user) failed:", err);
      }
    }
    store.replyDraft = "";
    store.replyNoteId = null;
    store.replyingTo = null;

    if (askPersona) {
      const note = store.feedback.find((f) => f.noteId === noteId);
      if (!note) return;
      store.isReplying = true;
      try {
        const persona = store.personas.find((p) => p.id === note.personaId);
        if (!persona) return;
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
        if (
          settings2?.advancedMode &&
          settings2.providers.length > 0
        ) {
          try {
            const res = await runClientAgent(
              "persona-reply",
              {
                persona: {
                  id: persona.id,
                  name: persona.name,
                  role: persona.role,
                  description: persona.description,
                  focus: persona.focus,
                  color: persona.color,
                  icon: persona.icon,
                },
                brief: brief ?? null,
                draftText,
                anchor: note.anchor,
                priorMessages,
                userMessage: userReply.text,
                instruction: "elaborate",
              },
              settings2,
            );
            if (res) {
              responseText = res.text;
              store.lastProvider = `client-${res.provider}` as any;
            }
          } catch (err) {
            console.warn("[twyne:personas] client reply failed:", err);
          }
        }

        // ── Fallback to Convex server action ────────────────────────
        const c = clientSig.value;
        if (!responseText && c) {
          try {
            const result = (await c.action(api.agents.runPersona, {
              persona: {
                id: persona.id,
                name: persona.name,
                role: persona.role,
                description: persona.description,
                focus: persona.focus,
                color: persona.color,
                icon: persona.icon,
              },
              brief: brief ?? null,
              draftText,
              anchor: note.anchor,
              priorMessages,
              userMessage: userReply.text,
              instruction: "elaborate",
            })) as { text: string; type: PersonaFeedback["type"] };
            responseText = result.text;
            store.lastProvider = "anthropic"; // best-effort tag
          } catch (err) {
            console.warn("[twyne:personas] runPersona failed:", err);
          }
        }
        if (!responseText) {
          responseText = `I stand by the note I left you. The line "${note.anchor ?? "—"}" is still where the work is. ${userReply.text ? "Your question is fair; " : ""}My honest answer is to revise the paragraph, then bring it back to the room.`;
        }

        const personaReply: PersonaReply = {
          id: `preply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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
        store.repliesByNote = { ...store.repliesByNote, [noteId]: nextReplies };
        await addPersonaReplyLocally(personaReply);

        if (c) {
          try {
            await c.mutation(api.sync.addPersonaReply, {
              noteId,
              replyId: personaReply.id,
              author: personaReply.author,
              authorKind: "persona",
              personaId: personaReply.personaId,
              text: personaReply.text,
            });
          } catch (err) {
            console.warn(
              "[twyne:personas] addPersonaReply (persona) failed:",
              err,
            );
          }
        }
      } finally {
        store.isReplying = false;
      }
    }
  });

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
      };
      if (!detail?.noteId || !detail.text?.trim()) return;
      store.replyDraft = detail.text;
      void submitReply(detail.noteId, true);
    };
    window.addEventListener("twyne:persona-reply", onReply);
    cleanup(() => window.removeEventListener("twyne:persona-reply", onReply));
  });

  /* ── Tunable assistance: settings + propose edits ──────────── */

  const persistSettings = $(async (next: RoomSettings) => {
    store.roomSettings = next;
    await saveRoomSettingsLocally(next);
    const client = clientSig.value;
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
      const client = clientSig.value;
      const draftText = await readCurrentDraftText();
      if (!anchor.trim()) return false;

      let replacement = anchor;
      let rationale = "";

      // ── Try client-side AI first (BYOK) ─────────────────────────
      const settings = store.aiSettings;
      if (
        settings?.advancedMode &&
        settings.providers.length > 0
      ) {
        try {
          const res = await runClientRewrite(
            {
              persona: {
                id: persona.id,
                name: persona.name,
                role: persona.role,
                description: persona.description,
                focus: persona.focus,
                color: persona.color,
                icon: persona.icon,
              },
              brief: brief ?? null,
              draftText,
              original: anchor,
              level: kind,
            },
            settings,
          );
          if (res) {
            replacement = res.replacement || anchor;
            rationale = res.rationale ?? "";
          }
        } catch (err) {
          console.warn("[twyne:personas] client rewrite failed:", err);
        }
      }

      // ── Fallback to Convex server action ────────────────────────
      if (replacement.trim() === anchor.trim() && client) {
        try {
          const r = (await client.action(api.agents.suggestRewrite, {
            persona: {
              id: persona.id,
              name: persona.name,
              role: persona.role,
              description: persona.description,
              focus: persona.focus,
              color: persona.color,
              icon: persona.icon,
            },
            brief: brief ?? null,
            draftText,
            original: anchor,
            level: kind,
          })) as { replacement: string; rationale: string };
          replacement = r.replacement || anchor;
          rationale = r.rationale ?? "";
        } catch (err) {
          console.warn("[twyne:personas] suggestRewrite failed:", err);
          return false;
        }
      }
      if (replacement.trim() === anchor.trim()) return false;

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
    <div class="flex flex-col h-full bg-[var(--color-paper-2)]">
      {/* ── Header ─────────────────────────────────────────── */}
      <div class="px-5 py-4 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
        <div class="flex items-center justify-between gap-2">
          <p class="dept-label">Tonight's Cast</p>
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
              {store.lastProvider === "local" ? "fallback" : store.lastProvider}
            </span>
          )}
        </div>
        <h2
          class="mt-0.5 text-xl text-[var(--color-ink)]"
          style="font-family: var(--font-display); font-weight: 600;"
        >
          The Room of Editors
        </h2>
        <p
          class="mt-2 text-xs leading-5 text-[var(--color-ink-light)]"
          style="font-family: var(--font-serif); font-style: italic;"
        >
          {summarizeBrief(brief)}
        </p>
      </div>

      {/* ── The Cast — portraits ────────────────────────────── */}
      <div class="px-4 pt-4 pb-3 border-b border-[var(--color-paper-3)]">
        <div class="flex items-center justify-between mb-2">
          <span class="dept-label" style="margin: 0;">
            The Cast
          </span>
          <a
            href="/personas"
            class="text-[0.7rem] tracking-[0.14em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)] focus-ring"
            style="font-family: var(--font-typewriter);"
          >
            Manage the cast →
          </a>
        </div>

        <div class="grid grid-cols-2 gap-2">
          {store.personas.map((persona) => {
            const active = store.activePersona === persona.id;
            return (
              <button
                key={persona.id}
                onClick$={() => {
                  store.activePersona = active ? null : persona.id;
                }}
                class={`portrait ${active ? "is-active" : ""}`}
                style={{ ["--frame-color" as never]: persona.color }}
                title={persona.description}
                aria-pressed={active}
              >
                <div class="flex items-center gap-2">
                  <span
                    class="portrait-icon"
                    style={{ ["--frame-color" as never]: persona.color }}
                  >
                    {persona.icon}
                  </span>
                  <div class="text-left min-w-0">
                    <p
                      class="text-[0.7rem] tracking-[0.12em] uppercase truncate"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        color: persona.color,
                      }}
                    >
                      {persona.role.replace(/^The /, "")}
                    </p>
                    <p
                      class="text-xs truncate text-[var(--color-ink)]"
                      style="font-family: var(--font-display); font-weight: 600;"
                    >
                      {persona.name}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick$={requestFeedback}
          disabled={store.isGenerating}
          class="convene-btn mt-4"
        >
          {store.isGenerating ? (
            <span class="flex items-center justify-center gap-2">
              <span class="inline-block animate-spin">✦</span>
              The room is reading…
            </span>
          ) : (
            "✦  Convene the Room"
          )}
        </button>

        {store.feedback.length > 0 && !store.isGenerating && (
          <div class="mt-2 flex items-center gap-2">
            <button
              onClick$={() => {
                store.groupByPersona = !store.groupByPersona;
              }}
              class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
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
              class="text-[10px] tracking-[0.15em] uppercase text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
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
            <button onClick$={clearRoom} class="btn-paper flex-1 text-xs">
              Strike the room
            </button>
          </div>
        )}

        {/* ── Mark up my draft + room settings ── */}
        {store.roomSettings.level !== "comments" && (
          <button
            onClick$={markUpDraft}
            disabled={store.isMarkingUp || store.isGenerating}
            class="btn-paper w-full mt-2 text-xs"
            title="The room proposes edits across your draft"
          >
            {store.isMarkingUp
              ? "The room is marking up…"
              : "✎  Mark up my draft"}
          </button>
        )}

        <div class="mt-2 flex items-center justify-between">
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
          <div class="mt-2 rounded-sm border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-3 space-y-3">
            <div>
              <p
                class="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-light)] mb-1"
                style="font-family: var(--font-typewriter);"
              >
                How much the room edits
              </p>
              <div class="flex gap-1">
                {(
                  ["comments", "sentence", "paragraph"] as AssistanceLevel[]
                ).map((lvl) => (
                  <button
                    key={lvl}
                    onClick$={() =>
                      persistSettings({ ...store.roomSettings, level: lvl })
                    }
                    class={`flex-1 rounded-sm border px-1 py-1 text-[11px] capitalize ${
                      store.roomSettings.level === lvl
                        ? "border-[var(--color-vermilion)] text-[var(--color-vermilion)]"
                        : "border-[var(--color-paper-3)] text-[var(--color-ink-light)]"
                    }`}
                    style="font-family: var(--font-typewriter);"
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
            <label class="flex items-center justify-between text-[11px] text-[var(--color-ink)]">
              <span style="font-family: var(--font-typewriter);">
                Max edits / pass
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
                Max large edits
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
          <p
            class="mt-2 text-[11px] text-[var(--color-vermilion)]"
            style="font-family: var(--font-typewriter);"
          >
            ⚠ {store.conveneError} (using local fallback)
          </p>
        )}
      </div>

      {/* ── Marginalia — feedback feed ──────────────────────── */}
      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {store.feedback.length === 0 && !store.isGenerating && (
          <div class="text-center py-10 px-4">
            <p
              class="text-3xl"
              style="font-family: var(--font-display); color: var(--color-vermilion);"
            >
              ❦
            </p>
            <p
              class="mt-3 text-sm text-[var(--color-ink-light)]"
              style="font-family: var(--font-serif); font-style: italic;"
            >
              The room awaits the manuscript.
            </p>
            <p
              class="mt-1.5 text-[0.7rem] tracking-[0.14em] uppercase text-[var(--color-ink-light)]"
              style="font-family: var(--font-typewriter);"
            >
              Write a few paragraphs, then convene.
            </p>
          </div>
        )}

        {(() => {
          const filtered = store.feedback.filter(
            (f) => !store.activePersona || f.personaId === store.activePersona,
          );
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
            const isExpanded = store.expandedPersonas.has(feedback.personaId);
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
            return (
              <div
                key={noteKey}
                class="clipping feedback-enter p-4"
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
                      <p
                        class="text-[0.65rem] tracking-[0.14em] uppercase"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          color: personaColor,
                        }}
                      >
                        {typeLabel(feedback.type)}
                      </p>
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
                              new CustomEvent("twyne:scroll-to-persona-note", {
                                detail: feedback.noteId,
                              }),
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
                <p
                  class={`text-[14px] leading-6 text-[var(--color-ink-light)]${
                    bodyClamped ? " cursor-pointer" : ""
                  }`}
                  style={
                    bodyClamped
                      ? "font-family: var(--font-serif); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;"
                      : "font-family: var(--font-serif);"
                  }
                  title={bodyClamped ? "Click to read the full note" : undefined}
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
                >
                  {feedback.feedback}
                </p>

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
                        <p class="mt-0.5">{r.text}</p>
                      </div>
                    ))}
                    {store.isReplying && (
                      <div
                        class="reply-bubble is-persona"
                        style={{ ["--reply-color" as never]: personaColor }}
                      >
                        <div class="reply-meta">
                          <strong style={{ color: personaColor }}>
                            {feedback.personaName}
                          </strong>
                          <span>· writing…</span>
                        </div>
                        <p class="mt-0.5">
                          <span class="inline-block animate-pulse">…</span>
                        </p>
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
                        disabled={!store.replyDraft.trim() || store.isReplying}
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
                        disabled={!store.replyDraft.trim() || store.isReplying}
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
                      effectiveLevel(store.roomSettings, feedback.personaId) !==
                        "comments" && (
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
  );
});

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

/* ── Local fallback (no LLM) ────────────────────────────────── */

function defaultType(id: string): PersonaFeedback["type"] {
  switch (id) {
    case "devil":
      return "critique";
    case "angel":
      return "encouragement";
    case "scholar":
    case "editor":
      return "suggestion";
    case "reader":
    default:
      return "perspective";
  }
}

function generateLocalFallback(
  persona: Persona,
  brief: ProjectBrief | null,
  draftText: string,
): string {
  const answers = brief?.answers;
  const wc = draftText.split(/\s+/).filter(Boolean).length;
  const hasBody = wc > 80;
  const audience = answers?.audience || "your intended reader";
  const goal = answers?.goal || "the central purpose of the piece";
  const tone = answers?.tone || "the chosen tone";
  const constraints = answers?.constraints || "the project constraints";
  const successSignal = answers?.successSignal || "the intended reader outcome";
  const map: Record<string, string> = {
    devil: hasBody
      ? `I am testing this against the stated goal: ${goal}. The draft needs sharper proof of why that goal follows from the argument on the page. Find one claim that ${audience} could reject, then add the strongest counterpoint before you answer it. The constraints are only useful if they are visible: ${constraints}.`
      : `The brief gives us a useful target, but the draft is still mostly setup. Write the risky version of the argument: what would make ${audience} disagree, and what evidence would force them to keep reading?`,
    angel: hasBody
      ? `The strongest thing here is that the piece already has a declared destination: ${goal}. Keep using that as the spine. When a paragraph directly helps ${audience}, protect it; that is where the draft starts feeling authored rather than assembled.`
      : `The context is doing useful work already. You have a reader, a goal, and a success signal before the first real paragraph. The next move can be specific: write toward ${successSignal}.`,
    scholar: hasBody
      ? `For ${audience}, evidence should be chosen for credibility, not decoration. Scan each major claim and mark whether it needs a source, an example, or a definition. The constraint to protect is: ${constraints}.`
      : `The research plan should follow the brief. Collect sources that help prove ${goal}, then keep a separate note for facts that are interesting but do not move ${audience} toward the success signal.`,
    editor: hasBody
      ? `Edit for the requested tone: ${tone}. If a sentence does not advance ${goal}, compress it or move it into notes. The current priority is not elegance in isolation; it is making every paragraph serve the reader outcome.`
      : `Use the brief as a style guide. Start with one paragraph in the target tone: ${tone}. Then revise the first sentence until it makes the piece's promise concrete.`,
    reader: hasBody
      ? `Reading as ${audience}, I need the opening to tell me why this matters now and what I will understand by the end. The success test is clear: ${successSignal}. Make that promise visible early.`
      : `As ${audience}, I would rather see a rough, direct opening than more setup. Tell me what problem I am walking into, then give me one reason to trust you.`,
  };
  return (
    map[persona.id] ||
    "I read it, and I want to come back to you on one thing in particular."
  );
}

/* ── Display helpers ────────────────────────────────────────── */

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
