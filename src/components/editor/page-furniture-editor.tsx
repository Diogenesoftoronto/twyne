import {
  $,
  component$,
  sync$,
  useSignal,
  useStore,
  useStylesScoped$,
  useTask$,
  type PropFunction,
} from "@builder.io/qwik";

export type PageFurnitureKind = "header" | "footer";

export const PAGE_FURNITURE_EVENT = {
  header: "twyne:header",
  footer: "twyne:footer",
} as const satisfies Record<PageFurnitureKind, string>;

export interface PageFurnitureChange {
  kind: PageFurnitureKind;
  value: string;
  eventName: (typeof PAGE_FURNITURE_EVENT)[PageFurnitureKind];
}

export interface PageFurnitureCancel {
  kind: PageFurnitureKind;
  value: string;
}

export interface PageFurnitureEditorState {
  editing: boolean;
  value: string;
  original: string;
  draft: string;
}

export type PageFurnitureEditorAction =
  | { type: "begin"; value?: string | null }
  | { type: "input"; value: string }
  | { type: "commit" }
  | { type: "cancel" }
  | { type: "external"; value?: string | null };

export type PageFurnitureEditorEffect =
  | { type: "commit"; value: string; changed: boolean }
  | { type: "cancel"; value: string };

export interface PageFurnitureEditorTransition {
  state: PageFurnitureEditorState;
  effect?: PageFurnitureEditorEffect;
}

export interface PageFurnitureEventTarget {
  dispatchEvent(event: Event): boolean;
}

export interface PageFurnitureEditorProps {
  kind: PageFurnitureKind;
  /** Persisted custom text. An empty value displays `fallback`. */
  value?: string | null;
  /** Existing page-band value, such as the folio title or page number. */
  fallback: string;
  /** Input hint. This is never persisted as a value. */
  placeholder?: string;
  /** Accessible name for both the resting control and its input. */
  label?: string;
  /**
   * Emit the existing folio persistence event on a changed commit.
   * Disable only when the integration callback already emits the same event.
   */
  emitFolioEvent?: boolean;
  onCommit$?: PropFunction<(change: PageFurnitureChange) => void>;
  onCancel$?: PropFunction<(cancel: PageFurnitureCancel) => void>;
  onEditingChange$?: PropFunction<(editing: boolean) => void>;
}

/**
 * Empty custom furniture means "use the existing page fallback". Preserve
 * non-empty input exactly, but prevent whitespace-only text from masking that
 * fallback.
 */
export function normalizePageFurnitureValue(value?: string | null): string {
  const next = value ?? "";
  return next.trim().length === 0 ? "" : next;
}

export function pageFurnitureDisplayValue(
  value: string | null | undefined,
  fallback: string,
): string {
  return normalizePageFurnitureValue(value) || fallback;
}

export function createPageFurnitureChange(
  kind: PageFurnitureKind,
  value?: string | null,
): PageFurnitureChange {
  return {
    kind,
    value: normalizePageFurnitureValue(value),
    eventName: PAGE_FURNITURE_EVENT[kind],
  };
}

/**
 * Dispatch the event already consumed by the editor route's per-folio
 * persistence handlers. The optional target keeps the contract testable
 * without a browser and useful in embedded editor hosts.
 */
export function dispatchPageFurnitureChange(
  change: PageFurnitureChange,
  target?: PageFurnitureEventTarget,
): boolean {
  const destination =
    target ??
    (typeof window !== "undefined"
      ? (window as PageFurnitureEventTarget)
      : undefined);
  if (!destination) return false;
  return destination.dispatchEvent(
    new CustomEvent(change.eventName, { detail: change.value }),
  );
}

export function createPageFurnitureEditorState(
  value?: string | null,
): PageFurnitureEditorState {
  const normalized = normalizePageFurnitureValue(value);
  return {
    editing: false,
    value: normalized,
    original: normalized,
    draft: normalized,
  };
}

/**
 * Pure editing state machine used by the component and its focused tests.
 * External folio changes never overwrite an in-progress draft.
 */
export function transitionPageFurnitureEditor(
  current: PageFurnitureEditorState,
  action: PageFurnitureEditorAction,
): PageFurnitureEditorTransition {
  switch (action.type) {
    case "begin": {
      const value = normalizePageFurnitureValue(action.value ?? current.value);
      return {
        state: {
          editing: true,
          value,
          original: value,
          draft: value,
        },
      };
    }
    case "input":
      if (!current.editing) return { state: current };
      return { state: { ...current, draft: action.value } };
    case "commit": {
      if (!current.editing) return { state: current };
      const value = normalizePageFurnitureValue(current.draft);
      return {
        state: {
          editing: false,
          value,
          original: value,
          draft: value,
        },
        effect: {
          type: "commit",
          value,
          changed: value !== current.original,
        },
      };
    }
    case "cancel":
      if (!current.editing) return { state: current };
      return {
        state: {
          editing: false,
          value: current.original,
          original: current.original,
          draft: current.original,
        },
        effect: { type: "cancel", value: current.original },
      };
    case "external": {
      if (current.editing) return { state: current };
      const value = normalizePageFurnitureValue(action.value);
      return {
        state: {
          editing: false,
          value,
          original: value,
          draft: value,
        },
      };
    }
  }
}

export type PageFurnitureKeyboardAction = "commit" | "cancel" | null;

export function pageFurnitureKeyboardAction(
  key: string,
  composing = false,
): PageFurnitureKeyboardAction {
  if (composing) return null;
  if (key === "Enter") return "commit";
  if (key === "Escape") return "cancel";
  return null;
}

/**
 * A small, single-line editor intended to sit directly in a visible page
 * header or footer band. It owns no document state. Changed commits flow
 * through the existing `twyne:header` and `twyne:footer` events.
 */
export const PageFurnitureEditor = component$<PageFurnitureEditorProps>(
  (props) => {
    useStylesScoped$(`
      .page-furniture {
        display: inline-flex;
        min-width: 0;
        max-width: 100%;
        pointer-events: auto;
        font: inherit;
        color: inherit;
      }

      .page-furniture__display,
      .page-furniture__input {
        min-width: 2.5rem;
        max-width: 100%;
        border: 1px solid transparent;
        border-radius: 3px;
        margin: -2px -4px;
        padding: 1px 3px;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: inherit;
        letter-spacing: inherit;
        text-align: inherit;
      }

      .page-furniture__display {
        overflow: hidden;
        cursor: text;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .page-furniture__display:hover {
        border-color: color-mix(in srgb, currentColor 24%, transparent);
      }

      .page-furniture__display:focus-visible,
      .page-furniture__input:focus {
        border-color: currentColor;
        outline: 2px solid color-mix(in srgb, currentColor 24%, transparent);
        outline-offset: 1px;
      }

      .page-furniture__input {
        width: min(28rem, 100%);
      }
    `);

    const state = useStore<PageFurnitureEditorState>(
      createPageFurnitureEditorState(props.value),
    );
    const inputRef = useSignal<HTMLInputElement>();
    const triggerRef = useSignal<HTMLButtonElement>();

    useTask$(({ track }) => {
      const value = track(() => props.value);
      // Only an actual parent-value change should synchronize this local
      // state. Tracking `editing` here would rerun the task immediately after
      // a commit and could restore a stale prop before the folio event has
      // propagated back through the parent.
      if (state.editing) return;
      const transition = transitionPageFurnitureEditor(state, {
        type: "external",
        value,
      });
      Object.assign(state, transition.state);
    });

    const focusInput = $(() => {
      setTimeout(() => {
        inputRef.value?.focus();
        inputRef.value?.select();
      }, 0);
    });

    const focusTrigger = $(() => {
      setTimeout(() => triggerRef.value?.focus(), 0);
    });

    const begin = $(() => {
      const transition = transitionPageFurnitureEditor(state, {
        type: "begin",
      });
      Object.assign(state, transition.state);
      void props.onEditingChange$?.(true);
      void focusInput();
    });

    const commit = $(() => {
      if (!state.editing) return;
      const transition = transitionPageFurnitureEditor(state, {
        type: "commit",
      });
      Object.assign(state, transition.state);
      void props.onEditingChange$?.(false);

      if (transition.effect?.type === "commit" && transition.effect.changed) {
        const change = createPageFurnitureChange(
          props.kind,
          transition.effect.value,
        );
        if (props.emitFolioEvent !== false) {
          dispatchPageFurnitureChange(change);
        }
        void props.onCommit$?.(change);
      }
      void focusTrigger();
    });

    const cancel = $(() => {
      if (!state.editing) return;
      const transition = transitionPageFurnitureEditor(state, {
        type: "cancel",
      });
      Object.assign(state, transition.state);
      void props.onEditingChange$?.(false);
      if (transition.effect?.type === "cancel") {
        void props.onCancel$?.({
          kind: props.kind,
          value: transition.effect.value,
        });
      }
      void focusTrigger();
    });

    const preventEditorKeys = sync$((event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    const handleEditorKey = $((event: KeyboardEvent) => {
      const action = pageFurnitureKeyboardAction(event.key, event.isComposing);
      if (action === "commit") void commit();
      if (action === "cancel") void cancel();
    });

    const label = props.label ?? `Edit page ${props.kind}`;

    return (
      <span
        class="page-furniture"
        data-page-furniture={props.kind}
        data-editing={state.editing ? "true" : "false"}
      >
        {state.editing ? (
          <input
            ref={inputRef}
            class="page-furniture__input"
            type="text"
            value={state.draft}
            placeholder={props.placeholder}
            aria-label={label}
            onInput$={(event) => {
              const transition = transitionPageFurnitureEditor(state, {
                type: "input",
                value: (event.target as HTMLInputElement).value,
              });
              Object.assign(state, transition.state);
            }}
            onBlur$={commit}
            onKeyDown$={[preventEditorKeys, handleEditorKey]}
          />
        ) : (
          <button
            ref={triggerRef}
            class="page-furniture__display"
            type="button"
            aria-label={label}
            title={`${label}. Enter or click to edit.`}
            onClick$={begin}
          >
            {pageFurnitureDisplayValue(state.value, props.fallback)}
          </button>
        )}
      </span>
    );
  },
);
