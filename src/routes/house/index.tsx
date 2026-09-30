import {
  useAuth,
  hasAuthenticatedConvexIdentity,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { startHouseSync } from "../../utils/house-sync";
/**
 * The House — where a writer sees, and shapes, everything that tells Twyne
 * what their writing is for.
 *
 *   Cabinet      the hierarchy, drawn as a filing cabinet: the House on its
 *                letterhead, collections as drawers, folios as folders. Pick
 *                any of them to open its sheet — its dossier, its charter,
 *                and exactly what the models are handed.
 *   Register     every change to that context, newest first: who or what
 *                made it, from what, to what, and why.
 *   Engine room  for whoever is tuning the plumbing: what the flow reader has
 *                learned, the thresholds it derived, and its decision log.
 */
import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link, useLocation, type DocumentHead } from "@qwik.dev/router";
import "../../components/house/house.css";
import type { Folio, ProjectBrief } from "../../types";
import {
  loadActiveFolioIdFromIdb,
  loadAllBriefsFromIdb,
  loadFoliosFromIdb,
  loadMetaFromIdb,
} from "../../utils/idb";
import {
  loadBriefEditions,
  type BriefEdition,
} from "../../utils/brief-history";
import { DEFAULT_INTERVIEW_ANSWERS } from "../../utils/anti-tabula-rasa";
import {
  assembleContextStack,
  collectionForFolio,
  contextForModels,
  DOSSIER_FIELD_LABELS,
  DOSSIER_FIELDS,
  emptyHouseState,
  INHERITABLE_FIELDS,
  LAYER_LABELS,
  LEDGER_SOURCE_LABELS,
  type CharterItem,
  type CharterScope,
  type ContextLayer,
  type DossierField,
  type HouseState,
  type LedgerEntry,
} from "../../utils/house-model";
import {
  createCollection,
  deleteCollection,
  HOUSE_CHANGED_EVENT,
  loadHouseState,
  removeCharterItem,
  setFolioCollection,
  setHouseField,
  setHouseName,
  updateCollection,
  upsertCharterItem,
  type HouseChangedDetail,
} from "../../utils/house-store";
import {
  kindWeight,
  normalizeProfile,
  thresholdsFor,
  writingHours,
  type FlowProfile,
} from "../../utils/flow-profile";
import { KIND_LABELS, type FlowItemKind } from "../../utils/flow-items";
import {
  clearFlowDiagnostics,
  FLOW_DIAGNOSTICS_EVENT,
  loadFlowDiagnostics,
  type DiagnosticEntry,
} from "../../utils/flow-diagnostics";
import {
  appendSession,
  FLOW_SESSION_EVENT,
  loadFlowSessions,
  type FlowSession,
  type FlowSessionEnd,
} from "../../utils/flow-session";

type Tab = "cabinet" | "register" | "engine";
type Selection =
  | { kind: "house" }
  | { kind: "collection"; id: string }
  | { kind: "folio"; id: string };
type RegisterFilter =
  | "all"
  | "amendment"
  | "dossier"
  | "charter"
  | "collection";

interface HouseStore {
  loaded: boolean;
  tab: Tab;
  selection: Selection;
  house: HouseState;
  folios: Folio[];
  briefs: Record<string, ProjectBrief>;
  editions: Record<string, BriefEdition[]>;
  activeFolioId: string | null;
  profile: FlowProfile | null;
  log: DiagnosticEntry[];
  sessions: FlowSession[];
  status: string;
  error: boolean;
  newArticle: string;
  newSeverity: "must" | "prefer";
  confirmDissolve: boolean;
  filter: RegisterFilter;
}

/* ── Module helpers (kept out of the component so handlers can use them) ── */

async function commit(
  state: HouseStore,
  work: Promise<HouseState>,
  done = "Filed.",
) {
  try {
    state.house = await work;
    state.status = done;
    state.error = false;
  } catch (error) {
    state.status =
      error instanceof Error
        ? error.message
        : "That could not be saved on this device.";
    state.error = true;
  }
}

/** Typewriter date stamp: 29 SEPT 2026 · 14:05. */
function stamp(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${day} · ${time}`.toUpperCase();
}

function seconds(ms: number): string {
  return ms >= 60_000
    ? `${Math.round(ms / 6_000) / 10} min`
    : `${Math.round(ms / 1000)} s`;
}

const SESSION_END_LABELS: Record<FlowSessionEnd, string> = {
  pause: "A long pause",
  reached: "Reached for the room",
  manual: "Focus turned off",
  away: "Stepped away",
  closed: "Folio closed",
};

function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour % 24).toLocaleTimeString(undefined, {
    hour: "numeric",
  });
}

/** [6, 7, 8, 21] → "6 AM–9 AM, 9 PM–10 PM": contiguous hours read as spans. */
function hoursLabel(hours: number[]): string {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const spans: Array<[number, number]> = [];
  for (const hour of sorted) {
    const last = spans[spans.length - 1];
    if (last && hour === last[1] + 1) last[1] = hour;
    else spans.push([hour, hour]);
  }
  return spans
    .map(([from, to]) => `${hourLabel(from)}–${hourLabel(to + 1)}`)
    .join(", ");
}

function ownerName(state: HouseStore, ownerRef: string): string {
  if (ownerRef === "house") return state.house.house.name || "The House";
  const collection = state.house.collections.find((c) => c.id === ownerRef);
  if (collection) return collection.name;
  return state.folios.find((f) => f.id === ownerRef)?.name ?? "A folio";
}

function matchesFilter(entry: LedgerEntry, filter: RegisterFilter): boolean {
  switch (filter) {
    case "amendment":
      return entry.source === "amendment";
    case "dossier":
      return (
        entry.layer !== "charter" &&
        !!entry.field &&
        entry.source !== "amendment"
      );
    case "charter":
      return entry.layer === "charter";
    case "collection":
      return entry.layer === "collection";
    default:
      return true;
  }
}

function fieldLabel(field?: string): string {
  if (!field) return "";
  if (field === "must" || field === "prefer")
    return field === "must" ? "Article (must)" : "Article (prefer)";
  return DOSSIER_FIELD_LABELS[field as DossierField] ?? field;
}

// Plain objects, not tuples: the optimizer drops names destructured from an
// array parameter when an event handler captures them.
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "cabinet", label: "The cabinet" },
  { id: "register", label: "The register" },
  { id: "engine", label: "Engine room" },
];

const REGISTER_FILTERS: ReadonlyArray<{
  value: RegisterFilter;
  label: string;
}> = [
  { value: "all", label: "Everything" },
  { value: "amendment", label: "Amendments" },
  { value: "dossier", label: "Dossiers" },
  { value: "charter", label: "Charters" },
  { value: "collection", label: "Collections" },
];

const LEGEND: Array<[string, string]> = [
  ["The House", "You. Defaults every piece inherits, and the house charter."],
  [
    "Collection",
    "A series — a column, a book's chapters, a newsletter. Narrows the House for its folios.",
  ],
  ["Folio", "One piece. Its dossier has the last word on what it is for."],
  [
    "Charter",
    "Standards that follow you. Every article from above still applies below.",
  ],
  [
    "Edition · Revision",
    "An edition changes what the words are for; a revision changes the words.",
  ],
  ["Amendment", "A dossier change the draft itself proposed, and you filed."],
];

export default component$(() => {
  const location = useLocation();
  const clientSig = useConvexClient();
  const auth = useAuth();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    track(() => clientSig.value);
    track(() => auth.value);
    if (!hasAuthenticatedConvexIdentity(auth.value)) return;
    cleanup(
      startHouseSync(
        () =>
          hasAuthenticatedConvexIdentity(auth.value)
            ? (clientSig.value ?? null)
            : null,
        auth.value.user!.id,
      ),
    );
  });
  const state = useStore<HouseStore>({
    loaded: false,
    tab: "cabinet",
    selection: { kind: "house" },
    house: emptyHouseState(),
    folios: [],
    briefs: {},
    editions: {},
    activeFolioId: null,
    profile: null,
    log: [],
    sessions: [],
    status: "",
    error: false,
    newArticle: "",
    newSeverity: "prefer",
    confirmDissolve: false,
    filter: "all",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup }) => {
    const params = location.url.searchParams;
    const [house, folios, briefs, active, profile, log, sessions] =
      await Promise.all([
        loadHouseState(),
        loadFoliosFromIdb(),
        loadAllBriefsFromIdb(),
        loadActiveFolioIdFromIdb(),
        loadMetaFromIdb<FlowProfile>("flow-profile"),
        loadFlowDiagnostics(),
        loadFlowSessions(),
      ]);
    state.house = house;
    state.folios = [...folios].sort((a, b) => b.updatedAt - a.updatedAt);
    state.briefs = Object.fromEntries(briefs.map((b) => [b.folioId, b.brief]));
    state.activeFolioId = active;
    state.profile = normalizeProfile(profile);
    state.log = [...log].reverse();
    state.sessions = [...sessions].reverse();
    const editions = await Promise.all(
      folios.map((f) => loadBriefEditions(f.id)),
    );
    state.editions = Object.fromEntries(
      folios.map((f, i) => [f.id, editions[i]]),
    );

    const requested = params.get("folio");
    const tab = params.get("tab");
    if (tab === "register" || tab === "engine") state.tab = tab;
    if (requested && folios.some((f) => f.id === requested))
      state.selection = { kind: "folio", id: requested };
    else if (active && folios.some((f) => f.id === active))
      state.selection = { kind: "folio", id: active };
    state.loaded = true;

    const onHouse = (event: Event) => {
      state.house = (event as CustomEvent<HouseChangedDetail>).detail.state;
    };
    const onLog = (event: Event) => {
      state.log = [
        (event as CustomEvent<DiagnosticEntry>).detail,
        ...state.log,
      ].slice(0, 300);
    };
    const onSession = (event: Event) => {
      state.sessions = appendSession(
        state.sessions,
        (event as CustomEvent<FlowSession>).detail,
      ).reverse();
    };
    window.addEventListener(HOUSE_CHANGED_EVENT, onHouse);
    window.addEventListener(FLOW_DIAGNOSTICS_EVENT, onLog);
    window.addEventListener(FLOW_SESSION_EVENT, onSession);
    cleanup(() => {
      window.removeEventListener(HOUSE_CHANGED_EVENT, onHouse);
      window.removeEventListener(FLOW_DIAGNOSTICS_EVENT, onLog);
      window.removeEventListener(FLOW_SESSION_EVENT, onSession);
    });
  });

  const select = $((selection: Selection) => {
    state.selection = selection;
    state.newArticle = "";
    state.newSeverity = "prefer";
    state.confirmDissolve = false;
    state.status = "";
  });

  const addArticle = $(async (scope: CharterScope, ownerRef: string) => {
    const text = state.newArticle.trim();
    if (!text) return;
    await commit(
      state,
      upsertCharterItem({
        scope,
        ownerRef,
        text,
        severity: state.newSeverity,
        kind: "other",
      }),
      "Article added to the charter.",
    );
    if (!state.error) state.newArticle = "";
  });

  const founding = $(async () => {
    const before = new Set(state.house.collections.map((c) => c.id));
    await commit(
      state,
      createCollection("New collection"),
      "Collection founded.",
    );
    const fresh = state.house.collections.find((c) => !before.has(c.id));
    if (fresh) await select({ kind: "collection", id: fresh.id });
  });

  const exportEngine = $(() => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            profile: state.profile,
            log: state.log,
            sessions: state.sessions,
            house: state.house,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `twyne-engine-room-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ── Pieces of the page ─────────────────────────────────────── */

  const houseName = state.house.house.name;
  const collections = state.house.collections;
  const looseFolios = state.folios.filter(
    (f) => !collectionForFolio(state.house, f.id),
  );
  const sel = state.selection;

  const layerStamp = (layer: ContextLayer | "charter" | null) =>
    layer ? (
      <span class={`house-stamp house-stamp--${layer}`}>
        {layer === "charter" ? "Charter" : LAYER_LABELS[layer]}
      </span>
    ) : null;

  const folder = (folio: Folio) => {
    const brief = state.briefs[folio.id];
    const editions = state.editions[folio.id]?.length ?? 0;
    const articles = state.house.charter.filter(
      (c) => c.ownerRef === folio.id,
    ).length;
    return (
      <button
        key={folio.id}
        type="button"
        class="house-folder"
        aria-current={
          sel.kind === "folio" && sel.id === folio.id ? "true" : undefined
        }
        onClick$={() => select({ kind: "folio", id: folio.id })}
      >
        <span class="house-folder__name">{folio.name || "Untitled"}</span>
        <span class="house-folder__marks">
          {brief ? (
            <span title="Dossier filed">D</span>
          ) : (
            <span title="No dossier">—</span>
          )}
          {editions > 0 && (
            <span
              title={`${editions} earlier ${editions === 1 ? "edition" : "editions"} of the dossier`}
            >
              {editions} ed.
            </span>
          )}
          {articles > 0 && <span title="Charter articles">§{articles}</span>}
          {state.activeFolioId === folio.id && (
            <span title="Open on the desk">●</span>
          )}
        </span>
      </button>
    );
  };

  const article = (item: CharterItem, inherited: boolean) => (
    <li
      key={item.id}
      class={["house-article", { "house-article--inherited": inherited }]}
    >
      {inherited ? (
        <span class="house-article__text">{item.text}</span>
      ) : (
        <input
          class="house-input house-article__text"
          value={item.text}
          aria-label="Charter article"
          onChange$={(_, el) => {
            const text = el.value.trim();
            if (!text || text === item.text) return;
            void commit(
              state,
              upsertCharterItem({ ...item, text }),
              "Article amended.",
            );
          }}
        />
      )}
      <span class="house-article__controls">
        {inherited
          ? layerStamp(item.scope === "house" ? "house" : "collection")
          : null}
        <button
          type="button"
          class="house-severity"
          data-severity={item.severity}
          disabled={inherited}
          title={
            inherited
              ? "Set where this article was written"
              : item.severity === "must"
                ? "A requirement. Click to make it a preference."
                : "A preference. Click to make it a requirement."
          }
          onClick$={() =>
            commit(
              state,
              upsertCharterItem({
                ...item,
                severity: item.severity === "must" ? "prefer" : "must",
              }),
              "Article amended.",
            )
          }
        >
          {item.severity}
        </button>
        {!inherited && (
          <button
            type="button"
            class="house-remove"
            aria-label={`Withdraw: ${item.text}`}
            title="Withdraw this article"
            onClick$={() =>
              commit(state, removeCharterItem(item.id), "Article withdrawn.")
            }
          >
            ✕
          </button>
        )}
      </span>
    </li>
  );

  const charterSection = (
    scope: CharterScope,
    ownerRef: string,
    inherited: CharterItem[],
  ) => {
    const own = state.house.charter
      .filter((c) => c.ownerRef === ownerRef)
      .sort((a, b) => a.order - b.order);
    return (
      <section class="house-section">
        <header class="house-section__head">
          <h3 class="house-section__title">Charter</h3>
          <span class="house-section__note">
            {scope === "house"
              ? "Standards for everything you write"
              : scope === "collection"
                ? "Standards for every piece in this collection"
                : "Standards for this piece alone"}
          </span>
        </header>
        {inherited.length + own.length === 0 ? (
          <p class="house-folder__empty">
            No articles yet. Twyne checks your draft against each one on a
            pause, and says so in the margin when a passage breaks it.
          </p>
        ) : (
          <ol class="house-charter">
            {inherited.map((item) => article(item, true))}
            {own.map((item) => article(item, false))}
          </ol>
        )}
        <form
          class="house-new-article"
          preventdefault:submit
          onSubmit$={() => addArticle(scope, ownerRef)}
        >
          <input
            value={state.newArticle}
            placeholder={
              scope === "house"
                ? "e.g. Cite a primary source for every statistic"
                : scope === "collection"
                  ? "e.g. Every issue opens on a scene, not a thesis"
                  : "e.g. Stay under 1,200 words"
            }
            aria-label="New charter article"
            onInput$={(_, el) => {
              state.newArticle = el.value;
            }}
          />
          <button
            type="button"
            class="house-severity"
            data-severity={state.newSeverity}
            onClick$={() => {
              state.newSeverity =
                state.newSeverity === "must" ? "prefer" : "must";
            }}
            title="Requirement or preference"
          >
            {state.newSeverity}
          </button>
          <button
            type="submit"
            class="btn-press"
            disabled={!state.newArticle.trim()}
          >
            Add article
          </button>
        </form>
      </section>
    );
  };

  const saveLine = state.status ? (
    <span
      class={["house-saved", { "house-saved--error": state.error }]}
      role="status"
    >
      {state.status}
    </span>
  ) : (
    <span class="house-saved">Changes are filed as you make them.</span>
  );

  /* ── Sheets ─────────────────────────────────────────────────── */

  const houseSheet = () => (
    <article class="house-sheet" key="house">
      <p class="house-sheet__kicker">The House</p>
      <h2 class="house-sheet__title">House defaults</h2>
      <p class="house-sheet__lede">
        Set these once. Every piece inherits them unless its collection, or its
        own dossier, says otherwise.
      </p>
      <section class="house-section">
        <header class="house-section__head">
          <h3 class="house-section__title">Dossier</h3>
          <span class="house-section__note">Inherited by every folio</span>
        </header>
        <div class="house-fields">
          {INHERITABLE_FIELDS.map((field) => (
            <label key={field} class="house-field">
              <span class="house-field__label">
                {DOSSIER_FIELD_LABELS[field]}
              </span>
              <span class="house-field__value">
                <textarea
                  class="house-input"
                  rows={1}
                  value={state.house.house.dossier[field] ?? ""}
                  placeholder="Leave blank to let each piece decide"
                  onChange$={(_, el) =>
                    commit(
                      state,
                      setHouseField(field, el.value),
                      `${DOSSIER_FIELD_LABELS[field]} set for the House.`,
                    )
                  }
                />
              </span>
            </label>
          ))}
        </div>
      </section>
      {charterSection("house", "house", [])}
      <footer class="house-sheet__foot">{saveLine}</footer>
    </article>
  );

  const collectionSheet = (id: string) => {
    const collection = collections.find((c) => c.id === id);
    if (!collection) return houseSheet();
    const inherited = state.house.charter.filter((c) => c.ownerRef === "house");
    return (
      <article class="house-sheet" key={`collection-${id}`}>
        <p class="house-sheet__kicker">Collection</p>
        <input
          class="house-sheet__title"
          value={collection.name}
          aria-label="Collection name"
          onChange$={(_, el) =>
            commit(state, updateCollection(id, { name: el.value }), "Renamed.")
          }
        />
        <textarea
          class="house-input house-sheet__lede"
          rows={1}
          value={collection.description}
          placeholder="What binds this series together?"
          aria-label="What binds this series together"
          onChange$={(_, el) =>
            commit(state, updateCollection(id, { description: el.value }))
          }
        />

        <section class="house-section">
          <header class="house-section__head">
            <h3 class="house-section__title">Dossier</h3>
            <span class="house-section__note">
              Narrows the House for these folios
            </span>
          </header>
          <div class="house-fields">
            {INHERITABLE_FIELDS.map((field) => {
              const fromHouse = state.house.house.dossier[field]?.trim();
              return (
                <label key={field} class="house-field">
                  <span class="house-field__label">
                    {DOSSIER_FIELD_LABELS[field]}
                  </span>
                  <span class="house-field__value">
                    <textarea
                      class="house-input"
                      rows={1}
                      value={collection.dossier[field] ?? ""}
                      placeholder={
                        fromHouse
                          ? `Inherits: ${fromHouse}`
                          : "Leave blank to let each piece decide"
                      }
                      onChange$={(_, el) =>
                        commit(
                          state,
                          updateCollection(id, {
                            field: { name: field, value: el.value },
                          }),
                          `${DOSSIER_FIELD_LABELS[field]} set for ${collection.name}.`,
                        )
                      }
                    />
                    {fromHouse && collection.dossier[field]?.trim() && (
                      <span class="house-inherit">
                        {layerStamp("house")} overrides <s>{fromHouse}</s>
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {charterSection("collection", id, inherited)}

        <section class="house-section">
          <header class="house-section__head">
            <h3 class="house-section__title">Folios in this collection</h3>
            <span class="house-section__note">
              A folio sits in one drawer at a time
            </span>
          </header>
          {state.folios.length === 0 ? (
            <p class="house-folder__empty">No folios yet.</p>
          ) : (
            <div class="house-members">
              {state.folios.map((folio) => {
                const other = collectionForFolio(state.house, folio.id);
                const inHere = other?.id === id;
                return (
                  <label key={folio.id} class="house-member">
                    <input
                      type="checkbox"
                      checked={inHere}
                      onChange$={(_, el) =>
                        commit(
                          state,
                          setFolioCollection(folio.id, el.checked ? id : null),
                          el.checked
                            ? `Filed under ${collection.name}.`
                            : "Taken out of the collection.",
                        )
                      }
                    />
                    <span>
                      {folio.name || "Untitled"}
                      {other && !inHere && <small>now in {other.name}</small>}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <footer class="house-sheet__foot">
          {saveLine}
          {state.confirmDissolve ? (
            <span style={{ display: "flex", gap: "0.5rem" }}>
              <button
                type="button"
                class="btn-paper"
                onClick$={() => (state.confirmDissolve = false)}
              >
                Keep it
              </button>
              <button
                type="button"
                class="btn-press"
                onClick$={async () => {
                  await commit(
                    state,
                    deleteCollection(id),
                    "Collection dissolved; its folios are loose.",
                  );
                  await select({ kind: "house" });
                }}
              >
                Dissolve
              </button>
            </span>
          ) : (
            <button
              type="button"
              class="btn-paper"
              onClick$={() => (state.confirmDissolve = true)}
            >
              Dissolve collection…
            </button>
          )}
        </footer>
      </article>
    );
  };

  const folioSheet = (id: string) => {
    const folio = state.folios.find((f) => f.id === id);
    if (!folio) return houseSheet();
    const brief = state.briefs[id] ?? null;
    const stack = assembleContextStack(
      state.house,
      id,
      brief,
      DEFAULT_INTERVIEW_ANSWERS,
    );
    const models = contextForModels(stack);
    const inherited = stack.charter.filter((c) => c.inherited);
    const editions = state.editions[id] ?? [];
    return (
      <article class="house-sheet" key={`folio-${id}`}>
        <p class="house-sheet__kicker">
          Folio{stack.collection ? ` · ${stack.collection.name}` : ""}
        </p>
        <h2 class="house-sheet__title">{folio.name || "Untitled"}</h2>
        <p class="house-sheet__lede">
          What this piece is for, and where each part of that came from.
        </p>

        <section class="house-section">
          <header class="house-section__head">
            <h3 class="house-section__title">Dossier, as the models see it</h3>
            <Link
              href={`/dossier/refine/?folio=${encodeURIComponent(id)}`}
              class="flow-link"
            >
              Refine the dossier →
            </Link>
          </header>
          <div class="house-fields">
            {DOSSIER_FIELDS.map((field) => {
              const entry = stack.fields[field];
              return (
                <div key={field} class="house-field">
                  <span class="house-field__label">
                    {DOSSIER_FIELD_LABELS[field]}
                  </span>
                  <span class="house-field__value">
                    {entry.value ? (
                      <span
                        class="house-input"
                        style={{ whiteSpace: "pre-wrap" }}
                      >
                        {entry.value}
                      </span>
                    ) : (
                      <span class="house-folder__empty">
                        Nothing set at any level.
                      </span>
                    )}
                    {(entry.layer || entry.shadowed.length > 0) && (
                      <span class="house-inherit">
                        {layerStamp(entry.layer)}
                        {entry.shadowed.map((s) => (
                          <span key={s.layer}>
                            overrides {LAYER_LABELS[s.layer].toLowerCase()}{" "}
                            <s>{s.value}</s>
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section class="house-section">
          <header class="house-section__head">
            <h3 class="house-section__title">Filed under</h3>
          </header>
          <select
            class="btn-paper"
            value={stack.collection?.id ?? ""}
            aria-label="Collection"
            onChange$={(_, el) =>
              commit(
                state,
                setFolioCollection(id, el.value || null),
                el.value ? "Filed under the collection." : "Now a loose folio.",
              )
            }
          >
            <option value="" selected={!stack.collection}>
              Loose — no collection
            </option>
            {collections.map((c) => (
              <option
                key={c.id}
                value={c.id}
                selected={stack.collection?.id === c.id}
              >
                {c.name}
              </option>
            ))}
          </select>
        </section>

        {charterSection("folio", id, inherited)}

        <section class="house-section">
          <header class="house-section__head">
            <h3 class="house-section__title">What the models read</h3>
            <span class="house-section__note">
              Inherited dossier and charter; individual tools add task-specific
              context
            </span>
          </header>
          {models.text ? (
            <pre class="house-carbon">{models.text}</pre>
          ) : (
            <p class="house-folder__empty">
              Nothing yet — the models see only the draft.
            </p>
          )}
          <div class="house-costs">
            {models.layers.map((l) => (
              <span key={l.layer} class="house-chip">
                {l.layer === "charter" ? "Charter" : LAYER_LABELS[l.layer]} · ≈
                {l.tokens} tokens
              </span>
            ))}
          </div>
        </section>

        <section class="house-section">
          <header class="house-section__head">
            <h3 class="house-section__title">Editions</h3>
            <span class="house-section__note">
              {editions.length
                ? `${editions.length} earlier ${editions.length === 1 ? "edition" : "editions"} of this dossier`
                : "The dossier has not changed since it was filed"}
            </span>
          </header>
          {editions.length > 0 && (
            <div class="house-register" style={{ marginTop: 0 }}>
              {editions.slice(0, 5).map((edition) => (
                <div
                  key={edition.id}
                  class={[
                    "house-register__row",
                    {
                      "house-register__row--amendment":
                        edition.source === "amendment",
                    },
                  ]}
                >
                  <span class="house-register__when">
                    {stamp(edition.savedAt)}
                  </span>
                  <span class="house-register__what">
                    {edition.source
                      ? LEDGER_SOURCE_LABELS[edition.source]
                      : "Superseded"}
                  </span>
                  <span class="house-register__diff">
                    <span>
                      {edition.brief.answers.goal ||
                        edition.brief.answers.workingTitle}
                    </span>
                    {edition.reason && (
                      <span class="house-register__why">{edition.reason}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer class="house-sheet__foot">
          {saveLine}
          {state.activeFolioId === id ? (
            <Link href="/editor/" class="btn-press">
              Back to the desk
            </Link>
          ) : null}
        </footer>
      </article>
    );
  };

  /* ── Tabs ───────────────────────────────────────────────────── */

  const cabinet = () => (
    <div class="house-cabinet">
      <nav
        class="house-diagram"
        aria-label="The House, its collections and folios"
      >
        <p class="house-diagram__caption">The cabinet</p>
        <div class="house-tree">
          <button
            type="button"
            class="house-node house-node--house"
            aria-current={sel.kind === "house" ? "true" : undefined}
            onClick$={() => select({ kind: "house" })}
          >
            <span class="house-node__kind">The House</span>
            <span class="house-node__name">{houseName || "Your house"}</span>
            <span class="house-node__meta">
              <span class="house-chip">
                {
                  Object.values(state.house.house.dossier).filter((v) =>
                    v?.trim(),
                  ).length
                }{" "}
                defaults
              </span>
              <span class="house-chip">
                §
                {
                  state.house.charter.filter((c) => c.ownerRef === "house")
                    .length
                }{" "}
                house charter
              </span>
            </span>
          </button>

          {collections.map((collection) => (
            <div key={collection.id} class="house-drawer">
              <button
                type="button"
                class="house-node house-node--collection"
                aria-current={
                  sel.kind === "collection" && sel.id === collection.id
                    ? "true"
                    : undefined
                }
                onClick$={() =>
                  select({ kind: "collection", id: collection.id })
                }
              >
                <span class="house-node__kind">Collection</span>
                <span class="house-node__name">{collection.name}</span>
                <span class="house-node__meta">
                  <span class="house-chip">
                    {collection.folioIds.length}{" "}
                    {collection.folioIds.length === 1 ? "folio" : "folios"}
                  </span>
                  {state.house.charter.some(
                    (c) => c.ownerRef === collection.id,
                  ) && (
                    <span class="house-chip">
                      §
                      {
                        state.house.charter.filter(
                          (c) => c.ownerRef === collection.id,
                        ).length
                      }
                    </span>
                  )}
                </span>
              </button>
              <div class="house-folders">
                {collection.folioIds
                  .map((fid) => state.folios.find((f) => f.id === fid))
                  .filter((f): f is Folio => !!f)
                  .map(folder)}
                {collection.folioIds.length === 0 && (
                  <p class="house-folder__empty">
                    Empty drawer — file folios from its sheet.
                  </p>
                )}
              </div>
            </div>
          ))}

          <div class="house-drawer">
            <div
              class="house-node house-node--collection house-node--loose"
              aria-hidden="true"
            >
              <span class="house-node__kind">Loose folios</span>
              <span class="house-node__name">Not in a collection</span>
            </div>
            <div class="house-folders">
              {looseFolios.map(folder)}
              {looseFolios.length === 0 && state.loaded && (
                <p class="house-folder__empty">Every folio is filed.</p>
              )}
            </div>
          </div>

          <button type="button" class="btn-paper" onClick$={founding}>
            + Found a collection
          </button>
        </div>

        <dl class="house-legend">
          {LEGEND.map(([term, meaning]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </nav>

      {sel.kind === "house"
        ? houseSheet()
        : sel.kind === "collection"
          ? collectionSheet(sel.id)
          : folioSheet(sel.id)}
    </div>
  );

  const entries = state.house.ledger.filter((e) =>
    matchesFilter(e, state.filter),
  );
  const register = () => (
    <div>
      <div
        class="house-register__filters"
        role="group"
        aria-label="Filter the register"
      >
        {REGISTER_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            class="house-filter"
            aria-pressed={state.filter === filter.value}
            onClick$={() => (state.filter = filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <p class="house-empty">
          The register is empty. It fills as dossiers are filed, refined and
          amended, and as charters change.
        </p>
      ) : (
        <div class="house-register">
          {entries.slice(0, 200).map((entry) => (
            <div
              key={entry.id}
              class={[
                "house-register__row",
                {
                  "house-register__row--amendment":
                    entry.source === "amendment",
                },
              ]}
            >
              <span class="house-register__when">{stamp(entry.at)}</span>
              <span class="house-register__what">
                <strong>{ownerName(state, entry.ownerRef)}</strong>
                <span>
                  {layerStamp(
                    entry.layer === "charter"
                      ? "charter"
                      : entry.source === "amendment"
                        ? "amendment"
                        : entry.layer,
                  )}
                </span>
              </span>
              <span class="house-register__diff">
                <span
                  class="house-section__note"
                  style={{ fontStyle: "normal" }}
                >
                  {LEDGER_SOURCE_LABELS[entry.source]}
                  {entry.field ? ` — ${fieldLabel(entry.field)}` : ""}
                </span>
                {entry.from && (
                  <span class="house-register__from">{entry.from}</span>
                )}
                {entry.to && <span>{entry.to}</span>}
                {entry.reason && (
                  <span class="house-register__why">{entry.reason}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const profile = state.profile;
  const t = profile ? thresholdsFor(profile) : null;
  const kinds = Object.keys(KIND_LABELS) as FlowItemKind[];
  const engine = () => (
    <div class="house-engine">
      <p class="house-sheet__lede" style={{ margin: 0 }}>
        What the flow reader has learned about how you write, the thresholds it
        derived from that, and every decision it made — for tuning the plumbing.
        Logs can include draft excerpts, titles and dossier changes. They stay
        on this device; review them before exporting.
      </p>
      {profile && t && (
        <div class="house-gauges">
          {[
            [
              "Pauses learned",
              String(profile.pauses.length),
              profile.pauses.length >= 12
                ? "Thresholds fitted to you"
                : "Defaults until 12",
            ],
            ["Stuck after", seconds(t.stuckPauseMs), "a pause after circling"],
            ["Focus after", seconds(t.flowMs), "of steady writing"],
            ["Focus ends after", seconds(t.exitPauseMs), "a pause this long"],
            [
              "Times in flow",
              String(profile.flowEntries.length),
              "confirmed runs",
            ],
            [
              "Hand overrides",
              String(profile.overrides),
              "you left focus yourself",
            ],
            [
              "Usual hours",
              hoursLabel(writingHours(profile)) || "—",
              "when you write most",
            ],
          ].map(([label, value, hint]) => (
            <div key={label} class="house-gauge">
              <div class="house-gauge__label">{label}</div>
              <div class="house-gauge__value">{value}</div>
              <div class="house-gauge__hint">{hint}</div>
            </div>
          ))}
        </div>
      )}

      {profile && (
        <section class="house-sheet" style={{ animation: "none" }}>
          <header class="house-section__head">
            <h3 class="house-section__title">What helps you</h3>
            <span class="house-section__note">
              Weight 1.0 is neutral; used kinds rise, waved-away kinds sink
            </span>
          </header>
          <div class="house-weights">
            {kinds.map((kind) => {
              const w = kindWeight(profile, kind);
              const s = profile.kinds[kind];
              return (
                <div
                  key={kind}
                  class="house-weight"
                  title={
                    s
                      ? `${s.shown} shown · ${s.engaged} used · ${s.dismissed} set aside`
                      : "Not seen yet"
                  }
                >
                  <span>{KIND_LABELS[kind]}</span>
                  <span class="house-weight__bar">
                    <span style={{ width: `${(w / 1.8) * 100}%` }} />
                  </span>
                  <span>{w.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section class="house-sheet" style={{ animation: "none" }}>
        <header class="house-section__head">
          <h3 class="house-section__title">Galley slips</h3>
          <span class="house-section__note">
            The last 30 runs, saved on this device
          </span>
        </header>
        {state.sessions.length === 0 ? (
          <p class="house-empty">
            A minute in flow, or forty words, leaves a slip here.
          </p>
        ) : (
          <div class="house-register house-log">
            {state.sessions.map((session) => (
              <div key={session.id} class="house-register__row">
                <time
                  class="house-register__when"
                  dateTime={new Date(session.startedAt).toISOString()}
                >
                  {stamp(session.startedAt)}
                </time>
                <div class="house-register__what">
                  <strong>
                    {state.folios.find((folio) => folio.id === session.folioId)
                      ?.name || "A folio"}
                  </strong>
                </div>
                <div class="house-register__diff">
                  <div>
                    {Math.round(session.flowMs / 6_000) / 10} min in flow ·{" "}
                    {session.words} words · {session.wpm} wpm
                  </div>
                  <div class="house-register__why">
                    {session.waited} items waited · {session.amendments}{" "}
                    amendments · {SESSION_END_LABELS[session.ended]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <header class="house-section__head">
          <h3 class="house-section__title">Decision log</h3>
          <span style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" class="btn-paper" onClick$={exportEngine}>
              Export JSON
            </button>
            <button
              type="button"
              class="btn-paper"
              onClick$={async () => {
                await clearFlowDiagnostics();
                state.log = [];
              }}
            >
              Clear
            </button>
          </span>
        </header>
        {state.log.length === 0 ? (
          <p class="house-empty">
            Nothing logged yet. Write for a while on the desk and the reader's
            decisions appear here as they happen.
          </p>
        ) : (
          <div class="house-log">
            {state.log.map((entry) => (
              <details key={entry.id} class="house-log__row">
                <summary style={{ display: "contents" }}>
                  <span class="house-register__when">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                  <span
                    class={`house-log__kind house-log__kind--${entry.kind}`}
                  >
                    {entry.kind}
                  </span>
                  <span>{entry.summary}</span>
                </summary>
                {entry.detail && (
                  <pre style={{ gridColumn: "1 / -1" }}>
                    {JSON.stringify(entry.detail, null, 2)}
                  </pre>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  return (
    <div class="house">
      <div class="house__inner">
        <header class="house-letterhead">
          <div>
            <p class="house-letterhead__eyebrow">Maison d'édition</p>
            <input
              class="house-letterhead__name"
              value={houseName}
              placeholder="Name your house"
              aria-label="The name of your house"
              onChange$={(_, el) =>
                commit(
                  state,
                  setHouseName(el.value),
                  "The letterhead is reset.",
                )
              }
            />
            <p class="house-letterhead__motto">
              Everything that tells Twyne what your writing is for — and how it
              has changed.
            </p>
          </div>
          <div class="house-letterhead__actions">
            <Link href="/library/" class="btn-paper">
              Library
            </Link>
            <Link href="/editor/" class="btn-press">
              ← The desk
            </Link>
          </div>
        </header>

        <div class="house-tabs" role="group" aria-label="The House">
          {TABS.map((tab) => {
            const count = tab.id === "register" ? state.house.ledger.length : 0;
            return (
              <button
                key={tab.id}
                type="button"
                class="house-tab"
                aria-pressed={state.tab === tab.id}
                onClick$={() => (state.tab = tab.id)}
              >
                {tab.label}
                {count ? <span class="house-tab__count">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {!state.loaded ? (
          <p class="house-empty">Opening the cabinet…</p>
        ) : state.tab === "cabinet" ? (
          cabinet()
        ) : state.tab === "register" ? (
          register()
        ) : (
          engine()
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "The House · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Your house, its collections, dossiers and charters — everything that tells Twyne what your writing is for.",
    },
  ],
};
