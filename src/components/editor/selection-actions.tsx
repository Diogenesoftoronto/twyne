import {
  component$,
  useSignal,
  useStore,
  useTask$,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import type { Persona } from "../../types";
import { loadPersonasFromIdb } from "../../utils/idb";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import type { SelectionActionState } from "./editor-state";

/** Move keyboard focus from the manuscript into the actions (Alt+F10). */
export const FOCUS_SELECTION_ACTIONS_EVENT = "twyne:focus-selection-actions";

type Menu = "persona" | "more";

interface SelectionActionsProps {
  selection: SelectionActionState | null;
  disabled?: boolean;
  onSentenceBench$?: PropFunction<() => void>;
  onHear$?: PropFunction<() => void>;
  onThreads$?: PropFunction<() => void>;
  onTaskDesk$?: PropFunction<() => void>;
  onSceneBench$?: PropFunction<() => void>;
  onGetSources$: PropFunction<() => void>;
  onAddMargin$: PropFunction<() => void>;
  onSendToPersona$: PropFunction<
    (personaId: string, personaName: string) => void
  >;
  onClose$: PropFunction<() => void>;
}

interface SelectionActionsStore {
  personas: Persona[];
  menu: Menu | null;
  /** A menu opened from the keyboard takes focus at this end. */
  menuFocus: "first" | "last" | null;
  /** The selected text the open menu belongs to. */
  menuFor: string;
}

/** A compact, manuscript-anchored action card for a selected passage. */
export const SelectionActions = component$<SelectionActionsProps>((props) => {
  const root = useSignal<HTMLDivElement>();
  const store = useStore<SelectionActionsStore>({
    personas: DEFAULT_PERSONAS,
    menu: null,
    menuFocus: null,
    menuFor: "",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const custom = await loadPersonasFromIdb();
    if (custom?.length) store.personas = custom;
  });

  // A menu belongs to the selection it was opened for. The selection state is
  // rebuilt on every editor transaction, so compare the text itself, or any
  // background update would close an open menu.
  useTask$(({ track }) => {
    const text = track(() => props.selection?.text ?? "");
    if (text === store.menuFor) return;
    store.menuFor = text;
    store.menu = null;
  });

  // Escape closes an open menu first. The listener is in the capture phase so
  // the editor's global Escape handler never sees it and the toolbar stays.
  // If the menu had focus, focus goes back to the button that opened it.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const menu = track(() => store.menu);
    if (!menu) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      const hadFocus = !!root.value?.contains(document.activeElement);
      store.menu = null;
      if (hadFocus)
        root.value
          ?.querySelector<HTMLElement>(`[data-menu-trigger="${menu}"]`)
          ?.focus();
    };
    window.addEventListener("keydown", onKeydown, true);
    cleanup(() => window.removeEventListener("keydown", onKeydown, true));
  });

  // A menu opened from the keyboard puts focus on its first or last item.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const menu = track(() => store.menu);
    const end = track(() => store.menuFocus);
    if (!menu || !end) return;
    requestAnimationFrame(() => {
      const items = root.value?.querySelectorAll<HTMLElement>(
        '[role="menu"] [role="menuitem"]:not([disabled])',
      );
      if (!items?.length) return;
      (end === "first" ? items[0] : items[items.length - 1])?.focus();
      store.menuFocus = null;
    });
  });

  // Keyboard use, as a toolbar: Alt+F10 moves in from the manuscript, the
  // arrow keys move along the row and through an open menu, and Escape goes
  // back to the text with the selection intact. Native listeners, because
  // a lazily loaded handler cannot stop the key in time. The document hears
  // the key before the editor's window-level Escape, which would close us.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const rowButtons = (el: HTMLElement) =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          ".selection-actions__row > button:not([disabled])",
        ),
      );
    const focusRow = () => {
      const el = root.value;
      if (el?.isConnected) rowButtons(el)[0]?.focus();
    };
    const step = (list: HTMLElement[], from: number, key: string) => {
      if (key === "Home") return 0;
      if (key === "End") return list.length - 1;
      const delta = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
      return (from + delta + list.length) % list.length;
    };
    const onKeydown = (event: KeyboardEvent) => {
      const el = root.value;
      const target = event.target as HTMLElement;
      if (!el?.isConnected || !el.contains(target)) return;
      const menu = target.closest('[role="menu"]');
      if (menu) {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
          return;
        const items = Array.from(
          menu.querySelectorAll<HTMLElement>(
            '[role="menuitem"]:not([disabled])',
          ),
        );
        event.preventDefault();
        event.stopPropagation();
        items[step(items, items.indexOf(target), event.key)]?.focus();
        return;
      }
      const row = rowButtons(el);
      const index = row.indexOf(target);
      if (index < 0) return;
      const trigger = target.dataset.menuTrigger as Menu | undefined;
      if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        store.menu = null;
        row[step(row, index, event.key)]?.focus();
      } else if (trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        // Enter and Space arrive as a click; see the triggers below.
        event.preventDefault();
        event.stopPropagation();
        store.menuFocus = event.key === "ArrowUp" ? "last" : "first";
        store.menu = trigger;
      } else if (event.key === "Escape") {
        // Back to the manuscript; the toolbar stays for the selection.
        event.preventDefault();
        event.stopPropagation();
        document
          .querySelector<HTMLElement>("#twyne-editor-mount .ProseMirror")
          ?.focus({ preventScroll: true });
      }
    };
    window.addEventListener(FOCUS_SELECTION_ACTIONS_EVENT, focusRow);
    document.addEventListener("keydown", onKeydown);
    cleanup(() => {
      window.removeEventListener(FOCUS_SELECTION_ACTIONS_EVENT, focusRow);
      document.removeEventListener("keydown", onKeydown);
    });
  });

  const selection = props.selection;
  if (!selection) return null;

  const multiWord = /\s/.test(selection.text.trim());
  const moreItems: {
    id: "hear" | "threads" | "scene" | "task";
    label: string;
  }[] = [];
  if (props.onHear$) moreItems.push({ id: "hear", label: "Hear it read" });
  if (props.onThreads$ && multiWord)
    moreItems.push({ id: "threads", label: "Threads" });
  if (props.onSceneBench$ && multiWord)
    moreItems.push({ id: "scene", label: "Scene bench" });
  if (props.onTaskDesk$) moreItems.push({ id: "task", label: "Task desk" });

  return (
    <div
      ref={root}
      class={["selection-actions", `selection-actions--${selection.placement}`]}
      style={{ left: `${selection.x}px`, top: `${selection.y}px` }}
      role="toolbar"
      aria-label={`Actions for “${selection.text.slice(0, 70)}”`}
      title={selection.text.slice(0, 200)}
      // This must be declarative: a Qwik onMouseDown$ handler runs after the
      // browser has already collapsed the ProseMirror range. Keeping the
      // range lets every action act on the passage the writer just selected.
      preventdefault:mousedown
    >
      <div class="selection-actions__row">
        {props.onSentenceBench$ && (
          <button
            type="button"
            title="Write your own revision of this sentence and compare it with the original"
            onClick$={props.onSentenceBench$}
            disabled={props.disabled}
          >
            Compare a revision
          </button>
        )}
        <button
          type="button"
          onClick$={props.onGetSources$}
          disabled={props.disabled}
        >
          Find sources
        </button>
        <button
          type="button"
          onClick$={props.onAddMargin$}
          disabled={props.disabled}
        >
          Comment
        </button>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={store.menu === "persona"}
          data-menu-trigger="persona"
          onClick$={(event) => {
            store.menu = store.menu === "persona" ? null : "persona";
            // A click with no pointer behind it came from Enter or Space.
            if (store.menu && event.detail === 0) store.menuFocus = "first";
          }}
          disabled={props.disabled}
        >
          Ask an editor ▾
        </button>
        {moreItems.length > 0 && (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={store.menu === "more"}
            data-menu-trigger="more"
            onClick$={(event) => {
              store.menu = store.menu === "more" ? null : "more";
              if (store.menu && event.detail === 0) store.menuFocus = "first";
            }}
            disabled={props.disabled}
          >
            More ▾
          </button>
        )}
        <button
          type="button"
          class="selection-actions__close"
          onClick$={props.onClose$}
          aria-label="Dismiss selection actions"
        >
          ×
        </button>
      </div>
      {selection.error && (
        <p class="selection-actions__error" role="status">
          {selection.error}
        </p>
      )}
      {store.menu === "persona" && (
        <div
          class="selection-actions__personas"
          role="menu"
          aria-label="Ask an editor"
        >
          <p>Request a reading from</p>
          {store.personas.map((persona) => (
            <button
              key={persona.id}
              type="button"
              role="menuitem"
              onClick$={() => {
                store.menu = null;
                props.onSendToPersona$(persona.id, persona.name);
              }}
            >
              <span
                class="selection-actions__persona-mark"
                style={{ color: persona.color }}
                aria-hidden="true"
              >
                {persona.icon}
              </span>
              <span>
                <strong>{persona.name}</strong>
                <small>{persona.role}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      {store.menu === "more" && moreItems.length > 0 && (
        <div
          class="selection-actions__personas selection-actions__more"
          role="menu"
          aria-label="More tools"
        >
          {moreItems.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={props.disabled}
              onClick$={() => {
                store.menu = null;
                if (item.id === "hear") props.onHear$?.();
                else if (item.id === "threads") props.onThreads$?.();
                else if (item.id === "scene") props.onSceneBench$?.();
                else props.onTaskDesk$?.();
              }}
            >
              <span>
                <strong>{item.label}</strong>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
