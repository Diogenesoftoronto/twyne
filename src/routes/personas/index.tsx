import {
  component$,
  useStore,
  $,
  useStylesScoped$,
  useVisibleTask$,
} from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import type { Persona, RoomSettings, AssistanceLevel } from "../../types";
import { DEFAULT_ROOM_SETTINGS } from "../../types";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import { loadPersonasFromIdb, savePersonasToIdb } from "../../utils/idb";
import {
  loadRoomSettingsLocally,
  saveRoomSettingsLocally,
} from "../../utils/convex-sync";

/** Inline, read-only voice preview. Mirrors `convex/agentPrompts.ts:buildSystemPrompt` so a writer can see exactly what the editor will be told. */
function buildVoicePreview(p: Persona): string {
  return `You are ${p.name}, the ${p.role} on the editorial board of "Twyne," a 1955-style magazine bullpen.

Voice and remit:
${p.description}

You focus your reading on: ${p.focus}.

You are one of five editors in residence. Speak in your own voice. Quote specific sentences when you have a claim. Be willing to say "this is not yet working" if it is not. Keep replies between 60 and 220 words.`;
}

const COLOR_SWATCHES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "vermilion", value: "var(--color-vermilion)" },
  { label: "mustard", value: "var(--color-mustard)" },
  { label: "cobalt", value: "var(--color-cobalt)" },
  { label: "forest", value: "var(--color-accent-green)" },
  { label: "indigo", value: "var(--color-accent-blue)" },
  { label: "wine", value: "var(--color-persona-editor)" },
];

const __COLOR_SWATCHES: ReadonlyArray<{ label: string; value: string }> = [
  { label: "vermilion", value: "var(--color-vermilion)" },
  { label: "mustard", value: "var(--color-mustard)" },
  { label: "cobalt", value: "var(--color-cobalt)" },
  { label: "forest", value: "var(--color-accent-green)" },
  { label: "indigo", value: "var(--color-accent-blue)" },
  { label: "wine", value: "var(--color-persona-editor)" },
];

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
  draftIcon: string;
  draftColor: string;
  adding: boolean;
  newName: string;
  newRole: string;
  newDescription: string;
  newFocus: string;
  newIcon: string;
  newColor: string;
  showResetConfirm: boolean;
  showVoicePreviewId: string | null;
  roomSettings: RoomSettings;
  hasLoadedSettings: boolean;
}

export default component$(() => {
  const clientSig = useConvexClient();
  const store = useStore<BoardStore>({
    personas: DEFAULT_PERSONAS,
    editingId: null,
    draftName: "",
    draftRole: "",
    draftDescription: "",
    draftFocus: "",
    draftIcon: "",
    draftColor: COLOR_SWATCHES[0].value,
    adding: false,
    newName: "",
    newRole: "",
    newDescription: "",
    newFocus: "",
    newIcon: "❧",
    newColor: COLOR_SWATCHES[0].value,
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
    .swatch {
      width: 1.4rem;
      height: 1.4rem;
      border-radius: 999px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.1s, border-color 0.1s;
    }
    .swatch[aria-pressed="true"] {
      border-color: var(--color-ink);
      transform: scale(1.1);
    }
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
    await savePersonasToIdb(next);
    // Mirror to Convex so the board travels with the writer.
    const client = clientSig.value;
    if (client) {
      try {
        await client.mutation(api.sync.putCustomPersonas, {
          personas: next,
        });
      } catch {
        // sync will retry; IDB is the source of truth locally.
      }
    }
  });

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

  const startEditing = $((p: Persona) => {
    store.editingId = p.id;
    store.draftName = p.name;
    store.draftRole = p.role;
    store.draftDescription = p.description;
    store.draftFocus = p.focus;
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
      description:
        store.newDescription.trim() || "A sharp, insightful editorial voice.",
      focus: store.newFocus.trim() || "General editing",
    };
    store.newName = "";
    store.newRole = "";
    store.newDescription = "";
    store.newFocus = "";
    store.newIcon = "❧";
    store.newColor = COLOR_SWATCHES[0].value;
    store.adding = false;
    await persistPersonas([...store.personas, p]);
  });

  const reset = $(() => {
    store.showResetConfirm = true;
  });

  const doReset = $(async () => {
    await savePersonasToIdb(DEFAULT_PERSONAS);
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
        <div class="flex items-center justify-between mb-6">
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
          <div class="flex items-center gap-3">
            <button
              onClick$={() => {
                store.adding = true;
              }}
              class="btn-press text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              + New editor
            </button>
            <button
              onClick$={reset}
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Reset defaults
            </button>
            <Link
              href="/"
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ← Back to desk
            </Link>
          </div>
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
            <div class="grid grid-cols-[auto_1fr] gap-3 items-start">
              <input
                value={store.newIcon}
                onInput$={(e) => {
                  store.newIcon = (e.target as HTMLInputElement).value;
                }}
                class="room-input w-12 text-center text-lg"
                maxLength={2}
                placeholder="❧"
              />
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
                <div>
                  <p
                    class="text-[0.6rem] text-[var(--color-ink-muted)] mb-1.5"
                    style="font-family: var(--font-typewriter); letter-spacing: 0.12em; text-transform: uppercase;"
                  >
                    Colour
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {__COLOR_SWATCHES.map((c) => (
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

        <div class="space-y-3">
          {store.personas.map((p, idx) => {
            const isEditing = store.editingId === p.id;
            const showPreview = store.showVoicePreviewId === p.id;
            return (
              <div key={p.id} class="room-card p-4">
                <div class="flex items-start gap-3">
                  <div class="flex flex-col gap-1 pt-1">
                    <button
                      onClick$={() => move(idx, -1)}
                      disabled={idx === 0}
                      class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-20"
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick$={() => move(idx, 1)}
                      disabled={idx === store.personas.length - 1}
                      class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-20"
                      title="Move down"
                    >
                      ▼
                    </button>
                  </div>

                  {isEditing ? (
                    <div class="flex-1 grid grid-cols-[auto_1fr] gap-3 items-start">
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
                        <div>
                          <p
                            class="text-[0.6rem] text-[var(--color-ink-muted)] mb-1.5"
                            style="font-family: var(--font-typewriter); letter-spacing: 0.12em; text-transform: uppercase;"
                          >
                            Colour
                          </p>
                          <div class="flex flex-wrap gap-2">
                            {__COLOR_SWATCHES.map((c) => (
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
                  ) : (
                    <div class="flex-1">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-xl" style={{ color: p.color }}>
                          {p.icon}
                        </span>
                        <h3
                          class="text-base font-semibold"
                          style={{
                            fontFamily: "var(--font-display)",
                            color: "var(--color-ink)",
                          }}
                        >
                          {p.name}
                        </h3>
                        <span
                          class="text-[0.6rem] text-[var(--color-ink-muted)] uppercase"
                          style={{
                            fontFamily: "var(--font-typewriter)",
                            letterSpacing: "0.15em",
                          }}
                        >
                          {p.id}
                        </span>
                      </div>
                      <p
                        class="text-xs text-[var(--color-accent)] mb-1"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        {p.role}
                      </p>
                      <p
                        class="text-sm text-[var(--color-ink-light)] leading-relaxed mb-1"
                        style={{ fontFamily: "var(--font-serif)" }}
                      >
                        {p.description}
                      </p>
                      <p
                        class="text-[0.7rem] text-[var(--color-ink-muted)]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        Focus: {p.focus}
                      </p>

                      <button
                        onClick$={() => toggleVoicePreview(p.id)}
                        class="mt-2 text-[0.65rem] text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
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
                    </div>
                  )}

                  {!isEditing && (
                    <div class="flex gap-2">
                      <button
                        onClick$={() => startEditing(p)}
                        class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                      >
                        Edit
                      </button>
                      <button
                        onClick$={() => remove(p.id)}
                        class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
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
