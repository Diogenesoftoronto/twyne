/**
 * The House, stored on this device. One `meta` record holds the whole
 * `HouseState`; every write is read back, because the IDB helper absorbs
 * storage failures and a Qwik store proxy fails structured clone silently.
 *
 * Changes fire `HOUSE_CHANGED_EVENT` with the new state; `house-sync.ts`
 * listens to push them to Convex, and the inspector and editor listen to
 * redraw. Remote pulls write through `replaceHouseState(…, { remote: true })`
 * so they do not bounce straight back out.
 */
import { loadMetaFromIdb, saveMetaToIdb, toStorable } from "./idb";
import {
  emptyHouseState,
  type CharterItem,
  type Collection,
  type DossierField,
  type HouseState,
  type LedgerEntry,
} from "./house-model";

export const HOUSE_META_KEY = "house-state";
export const HOUSE_CHANGED_EVENT = "twyne:house-changed";
const MAX_LOCAL_LEDGER = 500;

export interface HouseChangedDetail {
  state: HouseState;
  /** True when the change arrived from sync rather than the writer. */
  remote: boolean;
}

function normalize(value: unknown): HouseState {
  const base = emptyHouseState();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<HouseState>;
  return {
    house: {
      name: typeof raw.house?.name === "string" ? raw.house.name : "",
      dossier:
        raw.house?.dossier && typeof raw.house.dossier === "object"
          ? raw.house.dossier
          : {},
      updatedAt:
        typeof raw.house?.updatedAt === "number" ? raw.house.updatedAt : 0,
    },
    collections: Array.isArray(raw.collections) ? raw.collections : [],
    charter: Array.isArray(raw.charter) ? raw.charter : [],
    ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
  };
}

export async function loadHouseState(): Promise<HouseState> {
  if (typeof window === "undefined") return emptyHouseState();
  return normalize(await loadMetaFromIdb<HouseState>(HOUSE_META_KEY));
}

export async function replaceHouseState(
  next: HouseState,
  options: { remote?: boolean } = {},
): Promise<HouseState> {
  const state = toStorable({
    ...next,
    ledger: next.ledger.slice(0, MAX_LOCAL_LEDGER),
  });
  await saveMetaToIdb(HOUSE_META_KEY, state);
  const saved = await loadMetaFromIdb<HouseState>(HOUSE_META_KEY);
  if (JSON.stringify(saved) !== JSON.stringify(state)) {
    throw new Error("The House could not be saved on this device.");
  }
  window.dispatchEvent(
    new CustomEvent<HouseChangedDetail>(HOUSE_CHANGED_EVENT, {
      detail: { state, remote: options.remote === true },
    }),
  );
  return state;
}

/** Load, apply `change`, save — the one path every edit below takes. */
let pendingUpdate: Promise<unknown> = Promise.resolve();
function update(
  change: (state: HouseState, now: number) => HouseState,
): Promise<HouseState> {
  // Serialise edits from separate fields so asynchronous IDB reads cannot
  // overwrite each other. The house timestamp versions the whole snapshot.
  const task = pendingUpdate.then(async () => {
    const current = await loadHouseState();
    const now = Math.max(Date.now(), current.house.updatedAt + 1);
    const next = change(current, now);
    if (next === current) return current;
    return replaceHouseState({
      ...next,
      house: { ...next.house, updatedAt: now },
    });
  });
  pendingUpdate = task.catch(() => {});
  return task;
}

export function ledgerEntry(
  entry: Omit<LedgerEntry, "id" | "at">,
  now = Date.now(),
): LedgerEntry {
  return { id: crypto.randomUUID(), at: now, ...entry };
}

export function appendLedger(
  entries: Array<Omit<LedgerEntry, "id" | "at">>,
): Promise<HouseState> {
  return update((state, now) => ({
    ...state,
    ledger: [...entries.map((e) => ledgerEntry(e, now)), ...state.ledger],
  }));
}

export function setHouseName(name: string): Promise<HouseState> {
  return update((state, now) => ({
    ...state,
    house: { ...state.house, name: name.trim(), updatedAt: now },
    ledger: [
      ledgerEntry(
        {
          layer: "house",
          ownerRef: "house",
          field: "name",
          from: state.house.name,
          to: name.trim(),
          source: "house",
        },
        now,
      ),
      ...state.ledger,
    ],
  }));
}

export function setHouseField(
  field: DossierField,
  value: string,
): Promise<HouseState> {
  return update((state, now) => {
    const from = state.house.dossier[field] ?? "";
    if (from === value.trim()) return state;
    return {
      ...state,
      house: {
        ...state.house,
        dossier: { ...state.house.dossier, [field]: value.trim() },
        updatedAt: now,
      },
      ledger: [
        ledgerEntry(
          {
            layer: "house",
            ownerRef: "house",
            field,
            from,
            to: value.trim(),
            source: "house",
          },
          now,
        ),
        ...state.ledger,
      ],
    };
  });
}

export function createCollection(
  name: string,
  folioIds: string[] = [],
): Promise<HouseState> {
  return update((state, now) => {
    const collection: Collection = {
      id: crypto.randomUUID(),
      name: name.trim() || "Untitled collection",
      description: "",
      // A folio belongs to at most one collection.
      folioIds,
      dossier: {},
      createdAt: now,
      updatedAt: now,
    };
    return {
      ...state,
      collections: [
        ...state.collections.map((c) => ({
          ...c,
          folioIds: c.folioIds.filter((id) => !folioIds.includes(id)),
        })),
        collection,
      ],
      ledger: [
        ledgerEntry(
          {
            layer: "collection",
            ownerRef: collection.id,
            to: collection.name,
            source: "collection",
            reason: "Collection founded",
          },
          now,
        ),
        ...state.ledger,
      ],
    };
  });
}

export function updateCollection(
  id: string,
  patch: Partial<Pick<Collection, "name" | "description">> & {
    field?: { name: DossierField; value: string };
  },
): Promise<HouseState> {
  return update((state, now) => {
    const ledger: LedgerEntry[] = [];
    const collections = state.collections.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, updatedAt: now };
      if (patch.name !== undefined) next.name = patch.name.trim() || c.name;
      if (patch.description !== undefined)
        next.description = patch.description.trim();
      for (const field of ["name", "description"] as const) {
        if (c[field] !== next[field])
          ledger.push(
            ledgerEntry(
              {
                layer: "collection",
                ownerRef: id,
                field,
                from: c[field],
                to: next[field],
                source: "collection",
              },
              now,
            ),
          );
      }
      if (patch.field) {
        const from = c.dossier[patch.field.name] ?? "";
        const to = patch.field.value.trim();
        if (from !== to) {
          next.dossier = { ...c.dossier, [patch.field.name]: to };
          ledger.push(
            ledgerEntry(
              {
                layer: "collection",
                ownerRef: id,
                field: patch.field.name,
                from,
                to,
                source: "collection",
              },
              now,
            ),
          );
        }
      }
      return next;
    });
    return { ...state, collections, ledger: [...ledger, ...state.ledger] };
  });
}

export function deleteCollection(id: string): Promise<HouseState> {
  return update((state, now) => ({
    ...state,
    collections: state.collections.filter((c) => c.id !== id),
    charter: state.charter.filter((item) => item.ownerRef !== id),
    ledger: [
      ledgerEntry(
        {
          layer: "collection",
          ownerRef: id,
          from: state.collections.find((c) => c.id === id)?.name,
          source: "collection",
          reason: "Collection dissolved; its folios are now loose",
        },
        now,
      ),
      ...state.ledger,
    ],
  }));
}

/** File a folio under a collection, or take it out with `null`. */
export function setFolioCollection(
  folioId: string,
  collectionId: string | null,
): Promise<HouseState> {
  return update((state, now) => ({
    ...state,
    ledger: [
      ledgerEntry(
        {
          layer: "folio",
          ownerRef: folioId,
          field: "collection",
          from: state.collections.find((c) => c.folioIds.includes(folioId))
            ?.name,
          to:
            state.collections.find((c) => c.id === collectionId)?.name ??
            "Loose folios",
          source: "collection",
          reason: "Collection membership changed",
        },
        now,
      ),
      ...state.ledger,
    ],
    collections: state.collections.map((c) => {
      const has = c.folioIds.includes(folioId);
      if (c.id === collectionId && !has)
        return { ...c, folioIds: [...c.folioIds, folioId], updatedAt: now };
      if (c.id !== collectionId && has)
        return {
          ...c,
          folioIds: c.folioIds.filter((f) => f !== folioId),
          updatedAt: now,
        };
      return c;
    }),
  }));
}

export function upsertCharterItem(
  item: Omit<CharterItem, "id" | "order" | "updatedAt"> &
    Partial<Pick<CharterItem, "id" | "order">>,
): Promise<HouseState> {
  return update((state, now) => {
    const existing = item.id
      ? state.charter.find((c) => c.id === item.id)
      : undefined;
    const siblings = state.charter.filter((c) => c.ownerRef === item.ownerRef);
    const next: CharterItem = {
      ...item,
      text: item.text.trim(),
      id: item.id ?? crypto.randomUUID(),
      order: item.order ?? existing?.order ?? siblings.length,
      updatedAt: now,
    };
    return {
      ...state,
      charter: existing
        ? state.charter.map((c) => (c.id === next.id ? next : c))
        : [...state.charter, next],
      ledger: [
        ledgerEntry(
          {
            layer: "charter",
            ownerRef: item.ownerRef,
            field: next.severity,
            from: existing?.text,
            to: next.text,
            source: "charter",
          },
          now,
        ),
        ...state.ledger,
      ],
    };
  });
}

export function removeCharterItem(id: string): Promise<HouseState> {
  return update((state, now) => {
    const item = state.charter.find((c) => c.id === id);
    if (!item) return state;
    return {
      ...state,
      charter: state.charter.filter((c) => c.id !== id),
      ledger: [
        ledgerEntry(
          {
            layer: "charter",
            ownerRef: item.ownerRef,
            from: item.text,
            source: "charter",
            reason: "Standard withdrawn",
          },
          now,
        ),
        ...state.ledger,
      ],
    };
  });
}
