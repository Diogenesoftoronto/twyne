import {
  component$,
  useStore,
  useVisibleTask$,
  type PropFunction,
} from "@builder.io/qwik";
import type { Persona } from "../../types";
import { loadPersonasFromIdb } from "../../utils/idb";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import type { SelectionActionState } from "./editor-state";

interface SelectionActionsProps {
  selection: SelectionActionState | null;
  disabled?: boolean;
  onGetSources$: PropFunction<() => void>;
  onAddMargin$: PropFunction<() => void>;
  onSendToPersona$: PropFunction<
    (personaId: string, personaName: string) => void
  >;
  onClose$: PropFunction<() => void>;
}

interface SelectionActionsStore {
  personas: Persona[];
  personaOpen: boolean;
}

/** A compact, manuscript-anchored action card for a selected passage. */
export const SelectionActions = component$<SelectionActionsProps>((props) => {
  const store = useStore<SelectionActionsStore>({
    personas: DEFAULT_PERSONAS,
    personaOpen: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const custom = await loadPersonasFromIdb();
    if (custom?.length) store.personas = custom;
  });

  const selection = props.selection;
  if (!selection) return null;

  return (
    <div
      class={["selection-actions", `selection-actions--${selection.placement}`]}
      style={{ left: `${selection.x}px`, top: `${selection.y}px` }}
      role="toolbar"
      aria-label={`Actions for “${selection.text.slice(0, 70)}”`}
      onMouseDown$={(event) => {
        // Keep the Tiptap selection intact while a card control receives focus.
        if (!(event.target instanceof HTMLTextAreaElement))
          event.preventDefault();
      }}
    >
      <div class="selection-actions__quote" title={selection.text}>
        “{selection.text.slice(0, 82)}
        {selection.text.length > 82 ? "…" : ""}”
      </div>
      <div class="selection-actions__row">
        <button
          type="button"
          onClick$={props.onGetSources$}
          disabled={props.disabled}
        >
          Get sources
        </button>
        <button
          type="button"
          onClick$={props.onAddMargin$}
          disabled={props.disabled}
        >
          Add margin
        </button>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={store.personaOpen}
          onClick$={() => {
            store.personaOpen = !store.personaOpen;
          }}
          disabled={props.disabled}
        >
          Send to persona
        </button>
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
      {store.personaOpen && (
        <div class="selection-actions__personas" role="menu">
          <p>Request a reading from</p>
          {store.personas.map((persona) => (
            <button
              key={persona.id}
              type="button"
              role="menuitem"
              onClick$={() => {
                store.personaOpen = false;
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
    </div>
  );
});
