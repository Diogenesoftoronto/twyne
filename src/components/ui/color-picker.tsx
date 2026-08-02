import {
  component$,
  useSignal,
  useVisibleTask$,
  $,
  type PropFunction,
} from "@builder.io/qwik";
import {
  normalizeHex,
  swatchesFor,
  type PaletteKind,
} from "../../utils/palette";

const RECENT_KEY = "twyne.colors.recent";
const MAX_RECENT = 8;

interface ColorPickerProps {
  /** Which palette to offer: prose colour, highlighter, or accent. */
  kind: PaletteKind;
  /** Currently applied colour, as a hex literal. */
  value?: string | null;
  /** Applies a colour. Always receives a normalised `#rrggbb`. */
  onPick$: PropFunction<(hex: string) => void>;
  /** Removes the colour entirely. */
  onClear$?: PropFunction<() => void>;
  /** Wording for the clear action, e.g. "No highlight". */
  clearLabel?: string;
  /** Dismisses the popover. */
  onClose$?: PropFunction<() => void>;
  title?: string;
}

/** Read the recent list, tolerating anything that has been put in its place. */
function readRecent(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((v): v is string => typeof v === "string")
      .map((v) => normalizeHex(v))
      .filter((v): v is string => v !== null)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function rememberRecent(hex: string): string[] {
  const next = [hex, ...readRecent().filter((h) => h !== hex)].slice(
    0,
    MAX_RECENT,
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode, quota — a lost history is not worth an error */
  }
  return next;
}

/**
 * A colour popover: the house palette, whatever the writer used recently, and
 * an escape hatch to any colour at all.
 *
 * Colours are handed back as `#rrggbb` literals, never as `var(--color-…)`.
 * That is load-bearing rather than incidental: a mark styled with a custom
 * property renders correctly in the app and renders as *nothing* in an
 * exported standalone HTML file, which carries no stylesheet to resolve it.
 * Anything that can leave the document has to be a literal colour.
 *
 * Anchored by the caller — it renders in flow and expects to sit inside a
 * positioned wrapper, the same shape the layout and table popovers use.
 */
export const ColorPicker = component$<ColorPickerProps>((props) => {
  const recent = useSignal<string[]>([]);
  const custom = useSignal("#c1272d");

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    recent.value = readRecent();
    if (props.value) custom.value = normalizeHex(props.value) ?? custom.value;
  });

  const pick = $(async (raw: string) => {
    const hex = normalizeHex(raw);
    if (!hex) return;
    recent.value = rememberRecent(hex);
    // PropFunctions are asynchronous Qwik boundaries. Closing concurrently
    // can destroy this popover before the formatting command reaches the
    // editor, producing an intermittent "the swatch did nothing" failure.
    await props.onPick$(hex);
    await props.onClose$?.();
  });

  const swatches = swatchesFor(props.kind);
  const active = props.value ? normalizeHex(props.value) : null;

  return (
    <div
      data-color-picker
      class="absolute left-0 top-full mt-1 p-3 bg-[var(--color-paper)] border border-[var(--color-paper-3)] shadow-lg"
      style={{
        zIndex: "var(--z-dropdown)",
        borderRadius: "2px",
        fontFamily: "var(--font-typewriter)",
        width: "13rem",
      }}
      role="dialog"
      aria-label={props.title ?? "Choose a colour"}
    >
      <p class="dept-label mb-2">{props.title ?? "Colour"}</p>

      <div class="flex flex-wrap gap-1.5 mb-3">
        {swatches.map((s) => (
          <button
            key={s.id}
            type="button"
            class="swatch"
            style={{ background: s.hex }}
            aria-pressed={active === s.hex.toLowerCase()}
            title={s.label}
            aria-label={s.label}
            onClick$={() => pick(s.hex)}
          />
        ))}
      </div>

      {recent.value.length > 0 && (
        <>
          <p class="dept-label mb-1.5">Recent</p>
          <div class="flex flex-wrap gap-1.5 mb-3">
            {recent.value.map((hex) => (
              <button
                key={hex}
                type="button"
                class="swatch"
                style={{ background: hex }}
                aria-pressed={active === hex}
                title={hex}
                aria-label={`Recent colour ${hex}`}
                onClick$={() => pick(hex)}
              />
            ))}
          </div>
        </>
      )}

      <label class="flex items-center gap-2 mb-3 text-[0.68rem] text-[var(--color-ink-light)]">
        <input
          type="color"
          class="h-6 w-8 cursor-pointer border border-[var(--color-paper-3)] bg-transparent p-0"
          value={custom.value}
          onInput$={(_, el) => {
            custom.value = el.value;
          }}
          aria-label="Custom colour"
        />
        <span>Custom</span>
        <button
          type="button"
          class="btn-paper ml-auto px-2 py-0.5 text-[0.65rem]"
          onClick$={() => pick(custom.value)}
        >
          Apply
        </button>
      </label>

      {props.onClear$ && (
        <button
          type="button"
          class="w-full text-left text-[0.68rem] text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
          onClick$={async () => {
            await props.onClear$?.();
            await props.onClose$?.();
          }}
        >
          ✕ {props.clearLabel ?? "Remove colour"}
        </button>
      )}
    </div>
  );
});
