import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import {
  keybindingList,
  shortcutPlatform,
  type ShortcutPlatform,
} from "../../utils/keybindings";
import { KeybindingList } from "./keybinding-list";
import { filterKeybindingEntries } from "./shortcut-dialog-helpers";

interface ShortcutDialogProps {
  open: boolean;
  platform?: ShortcutPlatform;
  onClose$: PropFunction<() => void>;
}

/**
 * Searchable keyboard reference.
 *
 * The parent owns the `?` / Mod-/ binding and open state; this component owns
 * focus, filtering, and dismissal. Keeping the listener here means Escape
 * behaves identically whether the dialog was opened from a button or a key.
 */
export const ShortcutDialog = component$<ShortcutDialogProps>((props) => {
  const query = useSignal("");
  const searchInput = useSignal<HTMLInputElement>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup, track }) => {
    const open = track(() => props.open);
    if (!open) {
      query.value = "";
      return;
    }

    requestAnimationFrame(() => searchInput.value?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void props.onClose$();
    };
    window.addEventListener("keydown", onKeyDown);
    cleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const close = $(() => props.onClose$());
  if (!props.open) return null;

  const platform = props.platform ?? shortcutPlatform();
  const entries = filterKeybindingEntries(
    keybindingList(platform),
    query.value,
  );

  return (
    <div
      class="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: "var(--z-modal)",
        background: "rgba(20, 16, 10, 0.58)",
      }}
      onClick$={(event) => {
        if (event.target === event.currentTarget) void close();
      }}
    >
      <div
        class="folio flex max-h-[min(44rem,calc(100vh-2rem))] w-full max-w-2xl flex-col p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-dialog-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="dept-label mb-1">The compositor's keys</p>
            <h2
              id="shortcut-dialog-title"
              class="text-xl font-semibold text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Keyboard shortcuts
            </h2>
          </div>
          <button
            type="button"
            class="tool-btn"
            aria-label="Close keyboard shortcuts"
            onClick$={close}
          >
            Esc
          </button>
        </div>

        <label class="mt-4">
          <span class="sr-only">Search keyboard shortcuts</span>
          <input
            ref={searchInput}
            type="search"
            value={query.value}
            placeholder="Search commands or keys"
            class="field-input"
            style={{ fontFamily: "var(--font-sans)" }}
            onInput$={(_, element) => {
              query.value = element.value;
            }}
          />
        </label>

        <div class="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          <KeybindingList entries={entries} />
        </div>
      </div>
    </div>
  );
});
