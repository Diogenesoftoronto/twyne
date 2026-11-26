import {
  $,
  component$,
  sync$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
  type Signal,
} from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type { Folio } from "../../types";
import { folioNumeral } from "../../utils/editorial-format";
import { isPlaceholderFolioName } from "../../utils/anti-tabula-rasa";
import {
  createCollection,
  HOUSE_CHANGED_EVENT,
  loadHouseState,
  setFolioCollection,
  updateCollection,
  type HouseChangedDetail,
} from "../../utils/house-store";
import type { Collection } from "../../utils/house-model";

const HIDDEN_FOLIOS_KEY = "twyne.drawer.hidden-folios";

/**
 * Where a dragged folio will land relative to the row under the pointer:
 * above it, below it, or filed together with it in a collection.
 */
type DropPosition = "before" | "after" | "into";
interface DropHint {
  /** A folio id, or `collection:<id>` / `loose` for group headers. */
  target: string;
  position: DropPosition;
}

interface FolioDrawerProps {
  folios: Folio[];
  activeFolioId: string | null;
  onOpen$: PropFunction<(folio: Folio) => void>;
  /** Rename the folio and its dossier's working title together. */
  onRename$: PropFunction<(id: string, name: string) => void>;
  /** The drawer's new folio order, as ids. */
  onReorder$: PropFunction<(ids: string[]) => void>;
}

interface DragState {
  /** The row or collection header whose name is being edited. */
  editing: Signal<string | null>;
}

/*
 * Drag bookkeeping runs in sync$ handlers: the browser only exposes the drag
 * data, and only honours preventDefault, during the event itself — before any
 * lazily loaded handler could run. They keep their state on the elements'
 * data attributes; the async drop handler then reads what was captured.
 */
const startDrag = sync$((event: DragEvent, element: HTMLElement) => {
  const id = element.dataset.folioId;
  if (!id || !event.dataTransfer) return;
  event.dataTransfer.setData("text/x-twyne-folio", id);
  event.dataTransfer.setData("text/plain", element.dataset.folioName ?? id);
  event.dataTransfer.effectAllowed = "move";
  element.dataset.dragging = "true";
  element.closest("nav")?.setAttribute("data-dragging", "true");
});

const endDrag = sync$((_: DragEvent, element: HTMLElement) => {
  delete element.dataset.dragging;
  const nav = element.closest("nav");
  nav?.removeAttribute("data-dragging");
  nav
    ?.querySelectorAll<HTMLElement>("[data-drop]")
    .forEach((node) => delete node.dataset.drop);
});

const dragOver = sync$((event: DragEvent, element: HTMLElement) => {
  if (!event.dataTransfer?.types.includes("text/x-twyne-folio")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  if (element.dataset.dragging === "true") {
    delete element.dataset.drop;
    return;
  }
  let position = "into";
  if (element.dataset.dropMode !== "into") {
    const box = element.getBoundingClientRect();
    const y = (event.clientY - box.top) / Math.max(1, box.height);
    position = y < 0.3 ? "before" : y > 0.7 ? "after" : "into";
  }
  if (element.dataset.drop !== position) element.dataset.drop = position;
});

const dragLeave = sync$((event: DragEvent, element: HTMLElement) => {
  if (!element.contains(event.relatedTarget as Node | null))
    delete element.dataset.drop;
});

const captureDrop = sync$((event: DragEvent, element: HTMLElement) => {
  event.preventDefault();
  element.dataset.dropped =
    event.dataTransfer?.getData("text/x-twyne-folio") ?? "";
  element.dataset.droppedAt = element.dataset.drop ?? "into";
  delete element.dataset.drop;
});

/** What captureDrop recorded on this element, consumed once. */
function takeDrop(
  element: HTMLElement,
): { dragged: string; position: DropPosition } | null {
  const dragged = element.dataset.dropped ?? "";
  const position = (element.dataset.droppedAt ?? "into") as DropPosition;
  delete element.dataset.dropped;
  delete element.dataset.droppedAt;
  return dragged ? { dragged, position } : null;
}

const FolioRow = component$<{
  folio: Folio;
  number: string;
  active: boolean;
  hidden?: boolean;
  drag: DragState;
  onOpen$: FolioDrawerProps["onOpen$"];
  onRename$: FolioDrawerProps["onRename$"];
  onDrop$: PropFunction<(dragged: string, hint: DropHint) => void>;
  onNudge$: PropFunction<(id: string, delta: -1 | 1) => void>;
  onVisibility$: PropFunction<(id: string, hidden: boolean) => void>;
}>((props) => {
  const { folio, drag } = props;
  const placeholder = isPlaceholderFolioName(folio.name);
  const editing = drag.editing.value === folio.id;

  const commit = $(async (input: HTMLInputElement) => {
    const next = input.value.trim();
    drag.editing.value = null;
    if (next !== folio.name.trim()) await props.onRename$(folio.id, next);
  });

  return (
    <div
      class="folio-row group"
      data-active={props.active ? "true" : undefined}
      data-folio-id={folio.id}
      data-folio-name={folio.name}
      draggable={!editing}
      onDragStart$={startDrag}
      onDragEnd$={endDrag}
      onDragOver$={dragOver}
      onDragLeave$={dragLeave}
      onDrop$={[
        captureDrop,
        $(async (_: DragEvent, element: HTMLElement) => {
          const landed = takeDrop(element);
          if (!landed || landed.dragged === folio.id) return;
          await props.onDrop$(landed.dragged, {
            target: folio.id,
            position: landed.position,
          });
        }),
      ]}
    >
      <span class="folio-row__grip" aria-hidden="true" title="Drag to move">
        ⋮⋮
      </span>
      {editing ? (
        <div class="min-w-0 flex-1 px-1 py-1.5">
          <span class="dept-label block">Folio {props.number}</span>
          <input
            class="folio-row__name-input"
            aria-label={`Rename folio ${props.number}`}
            value={placeholder ? "" : folio.name}
            placeholder="Working title"
            autoFocus
            onKeyDown$={async (event, input) => {
              if (event.key === "Enter") await commit(input);
              if (event.key === "Escape") drag.editing.value = null;
            }}
            onBlur$={(_, input) => commit(input)}
          />
          <span class="folio-row__hint">Also the dossier's working title.</span>
        </div>
      ) : (
        <button
          type="button"
          class={`min-w-0 flex-1 break-words px-1 py-2 text-left text-sm focus-ring ${props.active ? "font-medium" : ""}`}
          aria-current={props.active ? "true" : undefined}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown F2"
          onClick$={() => props.onOpen$(folio)}
          onDblClick$={() => {
            drag.editing.value = folio.id;
          }}
          onKeyDown$={async (event) => {
            if (event.key === "F2") drag.editing.value = folio.id;
            if (event.altKey && event.key === "ArrowUp")
              await props.onNudge$(folio.id, -1);
            if (event.altKey && event.key === "ArrowDown")
              await props.onNudge$(folio.id, 1);
          }}
        >
          <span class="dept-label block">Folio {props.number}</span>
          <span class={placeholder ? "folio-row__placeholder" : undefined}>
            {placeholder ? "Current draft" : folio.name}
          </span>
        </button>
      )}
      {!editing && (
        <span class="folio-row__actions">
          <button
            type="button"
            class="folio-row__action focus-ring"
            aria-label={`Rename folio: ${folio.name}`}
            title="Rename"
            onClick$={() => {
              drag.editing.value = folio.id;
            }}
          >
            ✎
          </button>
          <button
            type="button"
            class="folio-row__action focus-ring"
            aria-label={`${props.hidden ? "Show" : "Hide"} folio: ${folio.name}`}
            onClick$={() => props.onVisibility$(folio.id, !props.hidden)}
          >
            {props.hidden ? "Show" : "Hide"}
          </button>
        </span>
      )}
    </div>
  );
});

/** A collection or "Loose folios" header: drop here to file into it. */
const GroupHeader = component$<{
  target: string;
  label: string;
  collectionId: string | null;
  drag: DragState;
  onDrop$: PropFunction<(dragged: string, hint: DropHint) => void>;
}>((props) => {
  const { drag } = props;
  const editing = drag.editing.value === props.target;
  return (
    <div
      class="folio-group-header group"
      data-drop-mode="into"
      onDragOver$={dragOver}
      onDragLeave$={dragLeave}
      onDrop$={[
        captureDrop,
        $(async (_: DragEvent, element: HTMLElement) => {
          const landed = takeDrop(element);
          if (landed)
            await props.onDrop$(landed.dragged, {
              target: props.target,
              position: "into",
            });
        }),
      ]}
    >
      {editing && props.collectionId ? (
        <input
          class="folio-row__name-input"
          aria-label="Rename collection"
          value={props.label}
          autoFocus
          onKeyDown$={async (event, input) => {
            if (event.key === "Escape") drag.editing.value = null;
            if (event.key === "Enter") {
              drag.editing.value = null;
              await updateCollection(props.collectionId!, {
                name: input.value,
              });
            }
          }}
          onBlur$={async (_, input) => {
            drag.editing.value = null;
            await updateCollection(props.collectionId!, { name: input.value });
          }}
        />
      ) : (
        <>
          <span class="min-w-0 flex-1 break-words">{props.label}</span>
          {props.collectionId && (
            <button
              type="button"
              class="folio-row__action focus-ring"
              aria-label={`Rename collection: ${props.label}`}
              title="Rename"
              onClick$={() => {
                drag.editing.value = props.target;
              }}
            >
              ✎
            </button>
          )}
        </>
      )}
    </div>
  );
});

export const FolioDrawer = component$<FolioDrawerProps>((props) => {
  const collections = useSignal<Collection[]>([]);
  const hiddenIds = useSignal<string[]>([]);
  const drag: DragState = { editing: useSignal<string | null>(null) };

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

  const collectionOf = $(
    (folioId: string): string | null =>
      collections.value.find((c) => c.folioIds.includes(folioId))?.id ?? null,
  );

  /**
   * Land a dragged folio. Between rows it moves there and joins that row's
   * group; onto a folio it files the two together (a new collection when
   * the target is loose); onto a header it joins that group.
   */
  const drop = $(async (dragged: string, hint: DropHint) => {
    if (hint.target === "loose") {
      await setFolioCollection(dragged, null);
      return;
    }
    if (hint.target.startsWith("collection:")) {
      await setFolioCollection(
        dragged,
        hint.target.slice("collection:".length),
      );
      return;
    }
    const targetCollection = await collectionOf(hint.target);
    if (hint.position === "into") {
      if (targetCollection) await setFolioCollection(dragged, targetCollection);
      else {
        const state = await createCollection("New collection", [
          hint.target,
          dragged,
        ]);
        const created = state.collections[state.collections.length - 1];
        if (created) drag.editing.value = `collection:${created.id}`;
      }
    } else if ((await collectionOf(dragged)) !== targetCollection) {
      await setFolioCollection(dragged, targetCollection);
    }
    const ids = props.folios
      .map((folio) => folio.id)
      .filter((id) => id !== dragged);
    const at = ids.indexOf(hint.target);
    if (at < 0) return;
    ids.splice(hint.position === "before" ? at : at + 1, 0, dragged);
    await props.onReorder$(ids);
  });

  /** Keyboard reordering: swap with the neighbour in the drawer order. */
  const nudge = $(async (id: string, delta: -1 | 1) => {
    const ids = props.folios.map((folio) => folio.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await props.onReorder$(ids);
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
      drag={drag}
      onOpen$={props.onOpen$}
      onRename$={props.onRename$}
      onDrop$={drop}
      onNudge$={nudge}
      onVisibility$={setHidden}
    />
  );
  const loose = visibleGroups.get(null);
  const showLooseHeader = collections.value.length > 0;

  return (
    <nav aria-label="Folios" class="space-y-2">
      <div class="space-y-2">
        {collections.value.map((collection) => {
          const rows = visibleGroups.get(collection.id);
          return (
            <details key={collection.id} open class="folio-group">
              <summary class="cursor-pointer rounded-sm text-sm font-medium focus-ring">
                <GroupHeader
                  target={`collection:${collection.id}`}
                  label={collection.name}
                  collectionId={collection.id}
                  drag={drag}
                  onDrop$={drop}
                />
              </summary>
              {rows ? (
                <div class="ml-3 space-y-1 border-l border-[var(--color-paper-3)] pl-2">
                  {rows.map((entry) => row(entry))}
                </div>
              ) : (
                <p class="ml-5 px-2 pb-2 text-xs text-[var(--color-ink-light)]">
                  Drop a folio here
                </p>
              )}
            </details>
          );
        })}
      </div>
      {/* Stable wrappers: Qwik can misplace a sibling that appears later. */}
      <div class="space-y-1">
        {showLooseHeader ? (
          <GroupHeader
            target="loose"
            label="Loose folios"
            collectionId={null}
            drag={drag}
            onDrop$={drop}
          />
        ) : null}
        {loose && loose.length > 0 ? loose.map((entry) => row(entry)) : null}
      </div>
      <div>
        {hiddenRows.length > 0 ? (
          <details>
            <summary class="cursor-pointer rounded-sm px-2 py-2 text-sm text-[var(--color-ink-light)] focus-ring">
              Hidden folios ({hiddenRows.length})
            </summary>
            <div class="ml-3 space-y-1 border-l border-[var(--color-paper-3)] pl-2">
              {hiddenRows.map((entry) => row(entry, true))}
            </div>
          </details>
        ) : null}
      </div>
      <p class="folio-drawer__tip">
        Drag to reorder. Drop one folio on another to group them.
      </p>
      <Link
        href="/house/"
        class="inline-block px-2 py-1 text-xs underline underline-offset-2 focus-ring"
      >
        Manage collections
      </Link>
    </nav>
  );
});
