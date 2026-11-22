import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type { Folio } from "../../types";
import { folioNumeral } from "../../utils/editorial-format";
import {
  HOUSE_CHANGED_EVENT,
  loadHouseState,
  type HouseChangedDetail,
} from "../../utils/house-store";
import type { Collection } from "../../utils/house-model";

const HIDDEN_FOLIOS_KEY = "twyne.drawer.hidden-folios";

interface FolioDrawerProps {
  folios: Folio[];
  activeFolioId: string | null;
  onOpen$: PropFunction<(folio: Folio) => void>;
}

interface FolioRowProps {
  folio: Folio;
  number: string;
  active: boolean;
  hidden?: boolean;
  onOpen$: FolioDrawerProps["onOpen$"];
  onVisibility$: PropFunction<(id: string, hidden: boolean) => void>;
}

const FolioRow = component$<FolioRowProps>(
  ({ folio, number, active, hidden, onOpen$, onVisibility$ }) => (
    <div
      class={`flex items-center gap-1 rounded-sm border ${
        active
          ? "border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
          : "border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)]"
      }`}
    >
      <button
        type="button"
        class={`min-w-0 flex-1 break-words px-2 py-2 text-left text-sm focus-ring ${active ? "font-medium" : ""}`}
        aria-current={active ? "true" : undefined}
        onClick$={() => onOpen$(folio)}
      >
        <span class="dept-label block">Folio {number}</span>
        {folio.name}
      </button>
      <button
        type="button"
        class="shrink-0 rounded-sm px-2 py-1.5 text-xs underline-offset-2 hover:underline focus-ring"
        aria-label={`${hidden ? "Show" : "Hide"} folio: ${folio.name}`}
        onClick$={() => onVisibility$(folio.id, !hidden)}
      >
        {hidden ? "Show" : "Hide"}
      </button>
    </div>
  ),
);

export const FolioDrawer = component$<FolioDrawerProps>((props) => {
  const collections = useSignal<Collection[]>([]);
  const hiddenIds = useSignal<string[]>([]);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    let receivedChange = false;
    let disposed = false;
    const onHouseChange = (event: Event) => {
      receivedChange = true;
      collections.value = (
        event as CustomEvent<HouseChangedDetail>
      ).detail.state.collections;
    };
    window.addEventListener(HOUSE_CHANGED_EVENT, onHouseChange);
    cleanup(() => {
      disposed = true;
      window.removeEventListener(HOUSE_CHANGED_EVENT, onHouseChange);
    });
    void loadHouseState().then((state) => {
      if (!disposed && !receivedChange) collections.value = state.collections;
    });
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(HIDDEN_FOLIOS_KEY) ?? "[]",
      );
      if (Array.isArray(saved)) {
        hiddenIds.value = saved.filter(
          (id): id is string => typeof id === "string",
        );
      }
    } catch {
      // The drawer still works for the current visit if storage is unavailable.
    }
  });

  const setHidden = $((id: string, hidden: boolean) => {
    const ids = new Set(hiddenIds.value);
    if (hidden) ids.add(id);
    else ids.delete(id);
    hiddenIds.value = [...ids];
    try {
      localStorage.setItem(HIDDEN_FOLIOS_KEY, JSON.stringify(hiddenIds.value));
    } catch {
      // Keep the in-memory preference for this visit.
    }
  });

  const hidden = new Set(hiddenIds.value);
  const membership = new Map<string, string>();
  for (const collection of collections.value) {
    for (const id of collection.folioIds) {
      if (!membership.has(id)) membership.set(id, collection.id);
    }
  }
  const visibleGroups = new Map<
    string | null,
    Array<{ folio: Folio; number: string }>
  >();
  const hiddenRows: Array<{ folio: Folio; number: string }> = [];
  props.folios.forEach((folio, index) => {
    const row = { folio, number: folioNumeral(index) };
    if (hidden.has(folio.id)) {
      hiddenRows.push(row);
      return;
    }
    const collectionId = membership.get(folio.id) ?? null;
    const rows = visibleGroups.get(collectionId);
    if (rows) rows.push(row);
    else visibleGroups.set(collectionId, [row]);
  });

  const row = (
    { folio, number }: { folio: Folio; number: string },
    isHidden = false,
  ) => (
    <FolioRow
      key={folio.id}
      folio={folio}
      number={number}
      active={props.activeFolioId === folio.id}
      hidden={isHidden}
      onOpen$={props.onOpen$}
      onVisibility$={setHidden}
    />
  );
  const loose = visibleGroups.get(null);

  return (
    <nav aria-label="Folios" class="space-y-2">
      {collections.value.length > 0
        ? collections.value.map((collection) => {
            const rows = visibleGroups.get(collection.id);
            return (
              <details key={collection.id} open>
                <summary class="cursor-pointer break-words rounded-sm px-2 py-2 text-sm font-medium focus-ring">
                  {collection.name}
                </summary>
                {rows ? (
                  <div class="ml-3 space-y-1 border-l border-[var(--color-paper-3)] pl-2">
                    {rows.map((entry) => row(entry))}
                  </div>
                ) : (
                  <p class="ml-5 px-2 pb-2 text-xs text-[var(--color-ink-light)]">
                    No visible folios
                  </p>
                )}
              </details>
            );
          })
        : null}
      {loose && (
        <div class="space-y-1">
          {collections.value.length > 0 && (
            <p class="dept-label px-2 pt-2">Loose folios</p>
          )}
          {loose.map((entry) => row(entry))}
        </div>
      )}
      {hiddenRows.length > 0 && (
        <details>
          <summary class="cursor-pointer rounded-sm px-2 py-2 text-sm text-[var(--color-ink-light)] focus-ring">
            Hidden folios ({hiddenRows.length})
          </summary>
          <div class="ml-3 space-y-1 border-l border-[var(--color-paper-3)] pl-2">
            {hiddenRows.map((entry) => row(entry, true))}
          </div>
        </details>
      )}
      <Link
        href="/house/"
        class="inline-block px-2 py-1 text-xs underline underline-offset-2 focus-ring"
      >
        Manage collections
      </Link>
    </nav>
  );
});
