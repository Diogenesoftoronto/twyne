import { PREFERENCES_APPLIED } from "../../utils/preference-outbox";
import {
  component$,
  useStore,
  $,
  useStylesScoped$,
  useVisibleTask$,
} from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type { Persona, RoomSettings, AssistanceLevel } from "../../types";
import { DEFAULT_ROOM_SETTINGS } from "../../types";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import {
  buildVoicePreview as sharedVoicePreview,
  toAgentPersona,
} from "../../../convex/agentPrompts";
import { loadPersonasFromIdb } from "../../utils/idb";
import { PersonaCard } from "../../components/personas/persona-card";
import { INK_SWATCHES } from "../../utils/palette";
import {
  loadRoomSettingsLocally,
  saveCustomPersonasLocally,
  saveRoomSettingsLocally,
} from "../../utils/convex-sync";

/**
 * Inline, read-only voice preview — the exact system prompt the editor will be
 * given. Shared with `convex/agentPrompts.ts` so it never drifts.
 */
function buildVoicePreview(p: Persona): string {
  return sharedVoicePreview(toAgentPersona(p));
}

function linesFromTextarea(value: string): string[] | undefined {
  const lines = value
    .split("\n")
    .map((line) => line.trim().replace(/^[-•—]\s*/, ""))
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

/**
 * Sample notes may span lines — a ruling, then a sign-off on its own — so
 * they are separated by a blank line. A box with no blank lines at all is
 * read the older way, one sample per line.
 */
function samplesFromTextarea(value: string): string[] | undefined {
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (!/\n\s*\n/.test(normalized)) return linesFromTextarea(normalized);
  const samples = normalized
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.trim())
        .join("\n"),
    )
    .filter(Boolean);
  return samples.length > 0 ? samples : undefined;
}

/**
 * The cast's colours, from the shared palette.
 *
 * Stored as `var(--color-…)` rather than as literals, which is safe here
 * because persona colour never leaves the app — `stripEditorMarks` removes
 * persona-note spans from every export, so there is no document that needs to
 * resolve the custom property without a stylesheet.
 *
 * This replaces two byte-identical local copies of a six-entry list that held
 * only four colours: "wine" was `--color-persona-editor`, which is mustard,
 * and "indigo" was `--color-accent-blue`, which is cobalt. A persona already
 * saved with either still renders exactly as before — it was always that
 * paint — it simply no longer appears twice in the picker.
 */
const COLOR_SWATCHES: ReadonlyArray<{ label: string; value: string }> =
  INK_SWATCHES.map((s) => ({ label: s.label.toLowerCase(), value: s.cssVar }));

const ASSISTANCE_LEVELS: ReadonlyArray<{
  value: AssistanceLevel;
  label: string;
  hint: string;
}> = [
  { value: "comments", label: "comments", hint: "Notes only, no rewrites" },
  {
    value: "sentence",
    label: "sentence",
    hint: "Notes + sentence-level edits",
  },
  {
    value: "paragraph",
    label: "paragraph",
    hint: "Notes + sentence + paragraph edits",
  },
];

interface BoardStore {
  personas: Persona[];
  editingId: string | null;
  draftName: string;
  draftRole: string;
  draftDescription: string;
  draftFocus: string;
  draftBackstory: string;
  draftCriticalMethod: string;
  draftVoice: string;
  draftSignatureMoves: string;
  draftHallmarks: string;
  draftAvoidances: string;
  draftSampleLines: string;
  draftIcon: string;
  draftColor: string;
  adding: boolean;
  newName: string;
  newRole: string;
  newDescription: string;
  newFocus: string;
  newBackstory: string;
  newCriticalMethod: string;
  newVoice: string;
  newSignatureMoves: string;
  newHallmarks: string;
  newAvoidances: string;
  newSampleLines: string;
  newIcon: string;
  newColor: string;
  newImage: string;
  showResetConfirm: boolean;
  showVoicePreviewId: string | null;
  roomSettings: RoomSettings;
  hasLoadedSettings: boolean;
}

export default component$(() => {
  const store = useStore<BoardStore>({
    personas: DEFAULT_PERSONAS,
    editingId: null,
    draftName: "",
    draftRole: "",
    draftDescription: "",
    draftFocus: "",
    draftBackstory: "",
    draftCriticalMethod: "",
    draftVoice: "",
    draftSignatureMoves: "",
    draftHallmarks: "",
    draftAvoidances: "",
    draftSampleLines: "",
    draftIcon: "",
    draftColor: COLOR_SWATCHES[0].value,
    adding: false,
    newName: "",
    newRole: "",
    newDescription: "",
    newFocus: "",
    newBackstory: "",
    newCriticalMethod: "",
    newVoice: "",
    newSignatureMoves: "",
    newHallmarks: "",
    newAvoidances: "",
    newSampleLines: "",
    newIcon: "❧",
    newColor: COLOR_SWATCHES[0].value,
    newImage: "",
    showResetConfirm: false,
    showVoicePreviewId: null,
    roomSettings: DEFAULT_ROOM_SETTINGS,
    hasLoadedSettings: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const [custom, settings] = await Promise.all([
      loadPersonasFromIdb(),
      loadRoomSettingsLocally(),
    ]);
    if (custom && custom.length > 0) store.personas = custom;
    store.roomSettings = settings;
    store.hasLoadedSettings = true;
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const refresh = async () => {
      store.roomSettings = await loadRoomSettingsLocally();
    };
    window.addEventListener(PREFERENCES_APPLIED, refresh);
    cleanup(() => window.removeEventListener(PREFERENCES_APPLIED, refresh));
  });

  useStylesScoped$(`
    .room-card {
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper);
      transition: box-shadow 0.2s;
      border-radius: 4px;
    }
    .room-card:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .room-input,
    .room-textarea,
    .room-select {
      width: 100%;
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper-soft);
      padding: 0.5rem 0.75rem;
      color: var(--color-ink);
      border-radius: 2px;
      font-family: var(--font-typewriter);
      font-size: 0.875rem;
    }
    .room-input:focus,
    .room-textarea:focus,
    .room-select:focus {
      border-color: var(--color-vermilion);
      outline: none;
    }
    .room-textarea { resize: vertical; min-height: 4rem; }
    .scope-pill {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      font-family: var(--font-typewriter);
      font-size: 0.65rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      border: 1px solid var(--color-paper-3);
      background: var(--color-paper-soft);
      color: var(--color-ink-light);
    }
    .scope-pill[aria-pressed="true"] {
      background: var(--color-vermilion);
      color: var(--color-paper);
      border-color: var(--color-vermilion);
    }
    .preview {
      background: var(--color-paper-2);
      border-left: 3px solid var(--color-vermilion);
      padding: 0.6rem 0.8rem;
      font-family: var(--font-typewriter);
      font-size: 0.7rem;
      line-height: 1.5;
      color: var(--color-ink-light);
      white-space: pre-wrap;
      max-height: 14rem;
      overflow-y: auto;
    }
  `);

  const persistPersonas = $(async (next: Persona[]) => {
    store.personas = next;
    await saveCustomPersonasLocally(next);
  });

  const persistSettings = $(async (next: RoomSettings) => {
    store.roomSettings = next;
    await saveRoomSettingsLocally(next);
  });

  const startEditing = $((p: Persona) => {
    store.editingId = p.id;
    store.draftName = p.name;
    store.draftRole = p.role;
    store.draftDescription = p.description;
    store.draftFocus = p.focus;
    store.draftBackstory = p.backstory ?? "";
    store.draftCriticalMethod = p.criticalMethod ?? "";
    store.draftVoice = p.voice ?? "";
    store.draftSignatureMoves = (p.signatureMoves ?? []).join("\n");
    store.draftHallmarks = (p.hallmarks ?? []).join("\n");
    store.draftAvoidances = (p.avoidances ?? []).join("\n");
    store.draftSampleLines = (p.sampleLines ?? []).join("\n\n");
    store.draftIcon = p.icon;
    store.draftColor = p.color;
  });

  const saveEdit = $(() => {
    if (!store.editingId) return;
    const next = store.personas.map((p) =>
      p.id === store.editingId
        ? {
            ...p,
            name: store.draftName,
            role: store.draftRole,
            description: store.draftDescription,
            focus: store.draftFocus,
            backstory: store.draftBackstory.trim() || undefined,
            criticalMethod: store.draftCriticalMethod.trim() || undefined,
            voice: store.draftVoice.trim() || undefined,
            signatureMoves: linesFromTextarea(store.draftSignatureMoves),
            hallmarks: linesFromTextarea(store.draftHallmarks),
            avoidances: linesFromTextarea(store.draftAvoidances),
            sampleLines: samplesFromTextarea(store.draftSampleLines),
            icon: store.draftIcon,
            color: store.draftColor,
          }
        : p,
    );
    store.editingId = null;
    void persistPersonas(next);
  });

  const remove = $(async (id: string) => {
    const next = store.personas.filter((p) => p.id !== id);
    await persistPersonas(next);
    // Drop any per-persona overrides for the removed editor.
    const settings = store.roomSettings;
    if (settings.perPersona && settings.perPersona[id]) {
      const next_perPersona = { ...settings.perPersona };
      delete next_perPersona[id];
      const next_settings: RoomSettings = {
        ...settings,
        perPersona: next_perPersona,
        personaScope: settings.personaScope.filter((s) => s !== id),
      };
      await persistSettings(next_settings);
    }
  });

  const move = $(async (idx: number, dir: -1 | 1) => {
    const next = [...store.personas];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    await persistPersonas(next);
  });

  const addPersona = $(async () => {
    if (!store.newName.trim()) return;
    const p: Persona = {
      id: crypto.randomUUID(),
      name: store.newName.trim(),
      role: store.newRole.trim() || "The Editor",
      color: store.newColor,
      icon: store.newIcon.trim() || "❧",
      imageUrl: store.newImage || undefined,
      description:
        store.newDescription.trim() || "A sharp, insightful editorial voice.",
      focus: store.newFocus.trim() || "General editing",
      backstory: store.newBackstory.trim() || undefined,
      criticalMethod: store.newCriticalMethod.trim() || undefined,
      voice: store.newVoice.trim() || undefined,
      signatureMoves: linesFromTextarea(store.newSignatureMoves),
      hallmarks: linesFromTextarea(store.newHallmarks),
      avoidances: linesFromTextarea(store.newAvoidances),
      sampleLines: samplesFromTextarea(store.newSampleLines),
    };
    store.newName = "";
    store.newRole = "";
    store.newDescription = "";
    store.newFocus = "";
    store.newBackstory = "";
    store.newCriticalMethod = "";
    store.newVoice = "";
    store.newSignatureMoves = "";
    store.newHallmarks = "";
    store.newAvoidances = "";
    store.newSampleLines = "";
    store.newIcon = "❧";
    store.newColor = COLOR_SWATCHES[0].value;
    store.newImage = "";
    store.adding = false;
    await persistPersonas([...store.personas, p]);
  });

  const reset = $(() => {
    store.showResetConfirm = true;
  });

  const doReset = $(async () => {
    await saveCustomPersonasLocally(DEFAULT_PERSONAS);
    store.personas = DEFAULT_PERSONAS;
    store.showResetConfirm = false;
  });

  const setPersonaLevel = $(async (id: string, level: AssistanceLevel) => {
    const cur = store.roomSettings;
    const next_perPersona = { ...(cur.perPersona ?? {}) };
    if (next_perPersona[id] === level) {
      // toggling same value back to default removes the override
      delete next_perPersona[id];
    } else {
      next_perPersona[id] = level;
    }
    await persistSettings({ ...cur, perPersona: next_perPersona });
  });

  const toggleScope = $(async (id: string) => {
    const cur = store.roomSettings;
    const inScope = cur.personaScope.includes(id);
    // Empty scope = "all in scope". Once the user touches it, we maintain
    // an explicit list of allowed ids.
    const next_scope = inScope
      ? cur.personaScope.filter((s) => s !== id)
      : [...cur.personaScope, id];
    await persistSettings({ ...cur, personaScope: next_scope });
  });

  const toggleVoicePreview = $((id: string) => {
    store.showVoicePreviewId = store.showVoicePreviewId === id ? null : id;
  });

  return (
    <div
      class="min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-4xl mx-auto px-6 py-8">
        <div class="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 mb-8">
          <div class="min-w-0 flex-1 basis-80">
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
                color: "var(--color-ink)",
              }}
            >
              Room of Editors
            </h1>
            <p class="text-sm text-[var(--color-ink-light)] mt-1">
              Hire, edit, and tune the editorial board. Each editor's voice
              drives the notes they file.
            </p>
          </div>
          <Link
            href="/editor"
            class="btn-paper inline-flex min-w-40 shrink-0 items-center justify-center whitespace-nowrap"
          >
            ← Back to desk
          </Link>
        </div>

        {store.adding && (
          <div class="room-card p-4 mb-6">
            <h3
              class="text-sm font-semibold mb-3"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-accent)",
              }}
            >
              New editor
            </h3>
            <div class="grid grid-cols-[auto_1fr] gap-4 items-start">
              <div class="flex w-40 flex-col gap-2">
                <input
                  value={store.newIcon}
                  onInput$={(e) => {
                    store.newIcon = (e.target as HTMLInputElement).value;
                  }}
                  class="room-input w-12 text-center text-lg"
                  maxLength={2}
                  placeholder="❧"
                />
                <div
                  class="flex aspect-[4/5] w-full items-center justify-center overflow-hidden"
                  style={{
                    border: "1px dashed var(--color-paper-3)",
                    background: store.newImage
                      ? `center / cover no-repeat url("${store.newImage}")`
                      : "transparent",
                    color: "var(--color-ink-light)",
                  }}
                  aria-label="Portrait preview"
                >
                  {!store.newImage && (
                    <span class="px-2 text-center text-xs">No portrait</span>
                  )}
                </div>
                <label class="btn-paper cursor-pointer text-center text-xs">
                  {store.newImage ? "Change portrait" : "Upload portrait"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    class="sr-only"
                    onChange$={async (e) => {
                      const input = e.target as HTMLInputElement;
                      const file = input.files?.[0];
                      input.value = "";
                      if (!file) return;
                      const bmp = await createImageBitmap(file);
                      // Cover-crop to the 4:5 plate and keep it small: the
                      // portrait is stored inline with the persona.
                      const W = 480;
                      const H = 600;
                      const scale = Math.max(W / bmp.width, H / bmp.height);
                      const canvas = document.createElement("canvas");
                      canvas.width = W;
                      canvas.height = H;
                      const ctx = canvas.getContext("2d")!;
                      ctx.drawImage(
                        bmp,
                        (W - bmp.width * scale) / 2,
                        (H - bmp.height * scale) / 2,
                        bmp.width * scale,
                        bmp.height * scale,
                      );
                      store.newImage = canvas.toDataURL("image/webp", 0.82);
                    }}
                  />
                </label>
                {store.newImage && (
                  <button
                    type="button"
                    class="text-xs underline"
                    style={{ color: "var(--color-ink-light)" }}
                    onClick$={() => {
                      store.newImage = "";
                    }}
                  >
                    Remove portrait
                  </button>
                )}
              </div>
              <div class="space-y-2">
                <input
                  value={store.newName}
                  onInput$={(e) => {
                    store.newName = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="Editor name"
                  class="room-input"
                />
                <input
                  value={store.newRole}
                  onInput$={(e) => {
                    store.newRole = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="Role (e.g. The Copy Chief)"
                  class="room-input"
                />
                <textarea
                  value={store.newDescription}
                  onInput$={(e) => {
                    store.newDescription = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="Voice description (what perspective do they bring?)"
                  class="room-textarea"
                />
                <input
                  value={store.newFocus}
                  onInput$={(e) => {
                    store.newFocus = (e.target as HTMLInputElement).value;
                  }}
                  placeholder="Focus (e.g. diction, evidence, audience fit)"
                  class="room-input"
                />
                <textarea
                  value={store.newBackstory}
                  onInput$={(e) => {
                    store.newBackstory = (
                      e.target as HTMLTextAreaElement
                    ).value;
                  }}
                  placeholder="Short backstory: where did this editor come from, and what shaped them?"
                  class="room-textarea"
                />
                <textarea
                  value={store.newCriticalMethod}
                  onInput$={(e) => {
                    store.newCriticalMethod = (
                      e.target as HTMLTextAreaElement
                    ).value;
                  }}
                  placeholder="Editorial doctrine: what do they notice first, and how do they judge a draft?"
                  class="room-textarea"
                />
                <textarea
                  value={store.newVoice}
                  onInput$={(e) => {
                    store.newVoice = (e.target as HTMLTextAreaElement).value;
                  }}
                  placeholder="Voiceprint: diction, sentence rhythm, warmth, humor, and point of view"
                  class="room-textarea"
                />
                <textarea
                  value={store.newSignatureMoves}
                  onInput$={(e) => {
                    store.newSignatureMoves = (
                      e.target as HTMLTextAreaElement
                    ).value;
                  }}
                  placeholder={
                    "Signature moves, one per line\nQuote the strongest phrase\nEnd on a question"
                  }
                  class="room-textarea"
                />
                <textarea
                  value={store.newHallmarks}
                  onInput$={(e) => {
                    store.newHallmarks = (
                      e.target as HTMLTextAreaElement
                    ).value;
                  }}
                  placeholder={
                    "Hallmarks — visible tics that sign every note, one per line\nOpen with a one-word verdict in bold\nSign off with « — L. »"
                  }
                  class="room-textarea"
                />
                <textarea
                  value={store.newAvoidances}
                  onInput$={(e) => {
                    store.newAvoidances = (
                      e.target as HTMLTextAreaElement
                    ).value;
                  }}
                  placeholder={
                    "Never does, one per line\nNo praise sandwiches\nNo craft jargon"
                  }
                  class="room-textarea"
                />
                <textarea
                  value={store.newSampleLines}
                  onInput$={(e) => {
                    store.newSampleLines = (
                      e.target as HTMLTextAreaElement
                    ).value;
                  }}
                  placeholder="Sample notes in this editor's voice, separated by a blank line"
                  class="room-textarea"
                />
                <div>
                  <p
                    class="text-[0.6rem] text-[var(--color-ink-muted)] mb-1.5"
                    style="font-family: var(--font-typewriter); letter-spacing: 0.12em; text-transform: uppercase;"
                  >
                    Colour
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {COLOR_SWATCHES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        class="swatch"
                        aria-pressed={store.newColor === c.value}
                        title={c.label}
                        aria-label={c.label}
                        style={{ background: c.value }}
                        onClick$={() => (store.newColor = c.value)}
                      />
                    ))}
                  </div>
                </div>
                <div class="flex gap-2">
                  <button onClick$={addPersona} class="btn-press text-xs">
                    Create
                  </button>
                  <button
                    onClick$={() => {
                      store.adding = false;
                    }}
                    class="btn-paper text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {store.showResetConfirm && (
          <div class="room-card p-4 mb-6 bg-[rgba(193,39,45,0.06)]">
            <p
              class="text-sm text-[var(--color-ink-light)] mb-3"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Reset all editors to the default five? This will discard your
              changes.
            </p>
            <div class="flex gap-2">
              <button onClick$={doReset} class="btn-press text-xs">
                Reset
              </button>
              <button
                onClick$={() => {
                  store.showResetConfirm = false;
                }}
                class="btn-paper text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Tunable assistance, per persona */}
        <section class="room-card p-4 mb-6">
          <p class="dept-label">Tunable Assistance</p>
          <h2
            class="text-base font-semibold mt-0.5"
            style={{ fontFamily: "var(--font-display)" }}
          >
            How much each editor edits
          </h2>
          <p
            class="text-xs text-[var(--color-ink-light)] mt-1"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            The room-wide ceiling lives in the right-rail Cast panel. Here you
            can override individual editors — useful if you want one editor
            filing notes only while another rewrites freely.
          </p>
          <div class="mt-4 space-y-3">
            {store.personas.map((p) => {
              const override = store.roomSettings.perPersona?.[p.id];
              const inScope = store.roomSettings.personaScope.includes(p.id);
              const scopeImplicit =
                store.roomSettings.personaScope.length === 0;
              const showInScope = scopeImplicit || inScope;
              return (
                <div
                  key={p.id}
                  class="flex flex-wrap items-center gap-3 py-1.5 border-b border-dashed border-[var(--color-paper-3)] last:border-b-0"
                >
                  <span
                    class="inline-flex items-center gap-1.5 min-w-[10rem]"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ color: p.color }}>{p.icon}</span>
                    {p.name}
                  </span>
                  <div class="flex items-center gap-1.5 flex-wrap">
                    {ASSISTANCE_LEVELS.map((lvl) => {
                      const active =
                        (override ?? store.roomSettings.level) === lvl.value;
                      return (
                        <button
                          key={lvl.value}
                          onClick$={() => setPersonaLevel(p.id, lvl.value)}
                          title={lvl.hint}
                          class="scope-pill"
                          aria-pressed={active}
                          style={
                            active
                              ? {
                                  background: p.color,
                                  borderColor: p.color,
                                  color: "var(--color-paper)",
                                }
                              : undefined
                          }
                        >
                          {lvl.label}
                        </button>
                      );
                    })}
                    {override && (
                      <span
                        class="text-[0.6rem] text-[var(--color-ink-muted)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        override
                      </span>
                    )}
                  </div>
                  <button
                    onClick$={() => toggleScope(p.id)}
                    class="scope-pill ml-auto"
                    aria-pressed={showInScope}
                    title={
                      scopeImplicit
                        ? "All editors in scope (click to start narrowing)"
                        : showInScope
                          ? "Allowed to propose edits"
                          : "Blocked from proposing edits"
                    }
                    style={
                      showInScope
                        ? {
                            background: "var(--color-accent-green)",
                            color: "var(--color-paper)",
                            borderColor: "var(--color-accent-green)",
                          }
                        : undefined
                    }
                  >
                    {showInScope ? "may propose" : "blocked"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <div class="space-y-5">
          {store.personas.map((p, idx) => {
            const isEditing = store.editingId === p.id;
            const showPreview = store.showVoicePreviewId === p.id;
            return (
              <div key={p.id}>
                {isEditing ? (
                  <div class="room-card p-4 flex items-start gap-3">
                    <div class="flex-1 grid grid-cols-[auto_1fr] gap-4 items-start">
                      <input
                        value={store.draftIcon}
                        onInput$={(e) => {
                          store.draftIcon = (
                            e.target as HTMLInputElement
                          ).value;
                        }}
                        class="room-input w-12 text-center text-lg"
                        maxLength={2}
                      />
                      <div class="space-y-2">
                        <input
                          value={store.draftName}
                          onInput$={(e) => {
                            store.draftName = (
                              e.target as HTMLInputElement
                            ).value;
                          }}
                          class="room-input"
                          placeholder="Name"
                        />
                        <input
                          value={store.draftRole}
                          onInput$={(e) => {
                            store.draftRole = (
                              e.target as HTMLInputElement
                            ).value;
                          }}
                          class="room-input"
                          placeholder="Role"
                        />
                        <textarea
                          value={store.draftDescription}
                          onInput$={(e) => {
                            store.draftDescription = (
                              e.target as HTMLInputElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Voice description"
                        />
                        <input
                          value={store.draftFocus}
                          onInput$={(e) => {
                            store.draftFocus = (
                              e.target as HTMLInputElement
                            ).value;
                          }}
                          class="room-input"
                          placeholder="Focus"
                        />
                        <textarea
                          value={store.draftBackstory}
                          onInput$={(e) => {
                            store.draftBackstory = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Short backstory"
                        />
                        <textarea
                          value={store.draftCriticalMethod}
                          onInput$={(e) => {
                            store.draftCriticalMethod = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Editorial doctrine"
                        />
                        <textarea
                          value={store.draftVoice}
                          onInput$={(e) => {
                            store.draftVoice = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Voiceprint"
                        />
                        <textarea
                          value={store.draftSignatureMoves}
                          onInput$={(e) => {
                            store.draftSignatureMoves = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Signature moves, one per line"
                        />
                        <textarea
                          value={store.draftHallmarks}
                          onInput$={(e) => {
                            store.draftHallmarks = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Hallmarks — visible tics, one per line"
                        />
                        <textarea
                          value={store.draftAvoidances}
                          onInput$={(e) => {
                            store.draftAvoidances = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Never does, one per line"
                        />
                        <textarea
                          value={store.draftSampleLines}
                          onInput$={(e) => {
                            store.draftSampleLines = (
                              e.target as HTMLTextAreaElement
                            ).value;
                          }}
                          class="room-textarea"
                          placeholder="Sample notes, separated by a blank line"
                        />
                        <div>
                          <p
                            class="text-[0.6rem] text-[var(--color-ink-muted)] mb-1.5"
                            style="font-family: var(--font-typewriter); letter-spacing: 0.12em; text-transform: uppercase;"
                          >
                            Colour
                          </p>
                          <div class="flex flex-wrap gap-2">
                            {COLOR_SWATCHES.map((c) => (
                              <button
                                key={c.value}
                                type="button"
                                class="swatch"
                                aria-pressed={store.draftColor === c.value}
                                title={c.label}
                                aria-label={c.label}
                                style={{ background: c.value }}
                                onClick$={() => (store.draftColor = c.value)}
                              />
                            ))}
                          </div>
                        </div>
                        <div class="flex gap-2">
                          <button onClick$={saveEdit} class="btn-press text-xs">
                            Save
                          </button>
                          <button
                            onClick$={() => {
                              store.editingId = null;
                            }}
                            class="btn-paper text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <PersonaCard persona={p}>
                      <button
                        onClick$={() => move(idx, -1)}
                        disabled={idx === 0}
                        class="disabled:opacity-20 hover:text-[var(--color-ink)]"
                        title="Move up"
                        aria-label={`Move ${p.name} up`}
                      >
                        ▲
                      </button>
                      <button
                        onClick$={() => move(idx, 1)}
                        disabled={idx === store.personas.length - 1}
                        class="disabled:opacity-20 hover:text-[var(--color-ink)]"
                        title="Move down"
                        aria-label={`Move ${p.name} down`}
                      >
                        ▼
                      </button>
                      <button
                        onClick$={() => startEditing(p)}
                        class="hover:text-[var(--color-accent)]"
                      >
                        Edit
                      </button>
                      <button
                        onClick$={() => remove(p.id)}
                        class="hover:text-[var(--color-vermilion)]"
                      >
                        Remove
                      </button>
                    </PersonaCard>
                    <button
                      onClick$={() => toggleVoicePreview(p.id)}
                      class="mt-1.5 ml-1 text-[0.65rem] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                      }}
                    >
                      {showPreview
                        ? "▾ Hide voice prompt"
                        : "▸ Show voice prompt"}
                    </button>
                    {showPreview && (
                      <pre class="preview mt-2">{buildVoicePreview(p)}</pre>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div class="flex items-center justify-end gap-4 mt-8 mb-8">
          <button
            onClick$={reset}
            class="btn-paper inline-flex min-w-40 items-center justify-center whitespace-nowrap"
          >
            Reset defaults
          </button>
          <button
            onClick$={() => {
              store.adding = true;
            }}
            class="btn-paper inline-flex min-w-40 items-center justify-center whitespace-nowrap"
            style={{
              background: "var(--color-ink)",
              color: "var(--color-paper)",
              borderColor: "var(--color-ink)",
            }}
          >
            + New editor
          </button>
        </div>

        {store.personas.length === 0 && (
          <div class="text-center py-16 text-[var(--color-ink-muted)]">
            <p>No editors on staff.</p>
            <button
              onClick$={() => {
                store.adding = true;
              }}
              class="btn-press mt-4 text-sm"
            >
              + Hire your first editor
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
