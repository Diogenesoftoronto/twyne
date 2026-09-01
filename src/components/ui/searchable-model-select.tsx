import {
  component$,
  useSignal,
  useTask$,
  $,
  type QRL,
} from "@qwik.dev/core";
import type { ModelsDevModel } from "../../utils/models-dev";
import { searchModelsDevModels } from "../../utils/models-dev";

interface SearchableModelSelectProps {
  value: string;
  models: ModelsDevModel[];
  onSelect$: QRL<(model: string) => void>;
  placeholder?: string;
  disabled?: boolean;
}

const MAX_VISIBLE_MODELS = 100;

export const SearchableModelSelect = component$<SearchableModelSelectProps>(
  (props) => {
    const query = useSignal(props.value);
    const open = useSignal(false);

    useTask$(({ track }) => {
      const value = track(() => props.value);
      if (!open.value) query.value = value;
    });

    const choose = $((model: string) => {
      query.value = model;
      open.value = false;
      props.onSelect$(model);
    });

    const matches = searchModelsDevModels(props.models, query.value);
    const exact = props.models.some(
      (model) => model.id.toLowerCase() === query.value.trim().toLowerCase(),
    );
    const visible = matches.slice(0, MAX_VISIBLE_MODELS);

    return (
      <div class="relative">
        <input
          value={query.value}
          placeholder={props.placeholder ?? "Search or enter a model ID"}
          disabled={props.disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open.value}
          onFocus$={() => {
            open.value = true;
          }}
          onInput$={(event) => {
            query.value = (event.target as HTMLInputElement).value;
            open.value = true;
          }}
          onKeyDown$={(event) => {
            if (event.key === "Escape") {
              open.value = false;
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const typed = query.value.trim();
              if (exact && typed) {
                choose(
                  props.models.find(
                    (model) =>
                      model.id.toLowerCase() === typed.toLowerCase(),
                  )?.id ?? typed,
                );
              } else if (typed) {
                // The text field doubles as the custom-model escape hatch.
                // Selecting the first fuzzy match on Enter makes exact manual
                // IDs impossible to submit.
                choose(typed);
              } else if (visible[0]) {
                choose(visible[0].id);
              }
            }
          }}
          onBlur$={() => {
            const typed = query.value.trim();
            if (typed && typed !== props.value) props.onSelect$(typed);
            setTimeout(() => {
              open.value = false;
            }, 120);
          }}
          class="w-full text-sm px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none disabled:opacity-50"
          style={{
            fontFamily: "var(--font-typewriter)",
            borderRadius: "2px",
          }}
        />

        {open.value && !props.disabled && (
          <div
            role="listbox"
            class="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto border border-[var(--color-paper-3)] bg-[var(--color-paper)] shadow-md"
            style={{ borderRadius: "2px" }}
          >
            {query.value.trim() && !exact && (
              <button
                type="button"
                role="option"
                class="block w-full border-b border-[var(--color-paper-3)] px-2 py-2 text-left hover:bg-[var(--color-paper-soft)]"
                onMouseDown$={(event) => {
                  event.preventDefault();
                  choose(query.value.trim());
                }}
              >
                <span
                  class="block text-xs text-[var(--color-ink)]"
                  style="font-family: var(--font-typewriter);"
                >
                  Use “{query.value.trim()}”
                </span>
                <span class="block text-[10px] text-[var(--color-ink-muted)]">
                  Custom model ID
                </span>
              </button>
            )}

            {visible.map((model) => (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={model.id === props.value}
                class="block w-full px-2 py-2 text-left hover:bg-[var(--color-paper-soft)]"
                onMouseDown$={(event) => {
                  event.preventDefault();
                  choose(model.id);
                }}
              >
                <span
                  class="block text-xs text-[var(--color-ink)]"
                  style="font-family: var(--font-typewriter);"
                >
                  {model.name}
                </span>
                <span
                  class="block truncate text-[10px] text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  {model.id}
                  {model.reasoning ? " · reasoning" : ""}
                  {model.toolCall ? " · tools" : ""}
                </span>
              </button>
            ))}

            {matches.length > MAX_VISIBLE_MODELS && (
              <p class="px-2 py-1.5 text-[10px] text-[var(--color-ink-muted)]">
                Refine the search to see the remaining{" "}
                {matches.length - MAX_VISIBLE_MODELS} models.
              </p>
            )}
            {visible.length === 0 && !query.value.trim() && (
              <p class="px-2 py-2 text-xs text-[var(--color-ink-muted)]">
                No catalog models are available. Enter a model ID manually.
              </p>
            )}
          </div>
        )}
      </div>
    );
  },
);
