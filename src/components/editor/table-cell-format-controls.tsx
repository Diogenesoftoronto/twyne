import { component$, useSignal, type PropFunction } from "@qwik.dev/core";
import { ColorPicker } from "../ui/color-picker";
import {
  CELL_BORDER_STYLES,
  CELL_HORIZONTAL_ALIGNMENTS,
  CELL_STYLE_PRESETS,
  CELL_VERTICAL_ALIGNMENTS,
  MIXED_CELL_FORMAT,
  type CellBorderStyle,
  type CellHorizontalAlignment,
  type CellStylePresetId,
  type CellVerticalAlignment,
  type SelectedCellFormat,
  type TableCellFormatIntent,
} from "./extensions/table-cell-format";

export interface TableCellFormatControlsProps {
  format: SelectedCellFormat;
  onIntent$: PropFunction<(intent: TableCellFormatIntent) => void>;
  disabled?: boolean;
}

function selectValue(value: string | number | null): string {
  if (value === MIXED_CELL_FORMAT) return MIXED_CELL_FORMAT;
  return value == null ? "default" : String(value);
}

/**
 * Editor-agnostic cell controls. The coordinator supplies a selection snapshot
 * from `getSelectedCellFormat` and dispatches intents with
 * `runTableCellFormatIntent`.
 */
export const TableCellFormatControls = component$<TableCellFormatControlsProps>(
  (props) => {
    const shadingOpen = useSignal(false);
    const borderColorOpen = useSignal(false);
    const disabled = props.disabled || props.format.cellCount === 0;
    const background =
      props.format.backgroundColor === MIXED_CELL_FORMAT
        ? null
        : props.format.backgroundColor;
    const borderColor =
      props.format.borderColor === MIXED_CELL_FORMAT
        ? null
        : props.format.borderColor;

    return (
      <div
        data-table-cell-format-controls
        role="toolbar"
        aria-label="Cell formatting"
        class="flex min-w-max items-center gap-2"
      >
        <label class="flex items-center gap-1 text-[0.65rem]">
          <span>Cell style</span>
          <select
            disabled={disabled}
            class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1.5 py-1 disabled:opacity-40"
            value={selectValue(props.format.stylePreset)}
            onChange$={(_, element) => {
              if (
                element.value !== MIXED_CELL_FORMAT &&
                element.value !== "default"
              ) {
                props.onIntent$({
                  kind: "preset",
                  preset: element.value as CellStylePresetId,
                });
              }
            }}
          >
            {props.format.stylePreset === MIXED_CELL_FORMAT && (
              <option value={MIXED_CELL_FORMAT}>Mixed</option>
            )}
            <option value="default">Custom</option>
            {CELL_STYLE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <div class="relative">
          <button
            type="button"
            disabled={disabled}
            class="btn-paper flex items-center gap-1.5 px-2 py-1 text-[0.65rem] disabled:opacity-40"
            aria-expanded={shadingOpen.value}
            aria-haspopup="dialog"
            onClick$={() => {
              shadingOpen.value = !shadingOpen.value;
              borderColorOpen.value = false;
            }}
          >
            <span
              aria-hidden="true"
              class="inline-block h-3 w-3 border border-[var(--color-paper-3)]"
              style={{ backgroundColor: background ?? "transparent" }}
            />
            Shading
          </button>
          {shadingOpen.value && (
            <ColorPicker
              kind="highlight"
              value={background}
              title="Cell shading"
              clearLabel="No cell shading"
              onPick$={(color) =>
                props.onIntent$({ kind: "background", color })
              }
              onClear$={() =>
                props.onIntent$({ kind: "background", color: null })
              }
              onClose$={() => {
                shadingOpen.value = false;
              }}
            />
          )}
        </div>

        <div role="group" aria-label="Horizontal cell alignment" class="flex">
          {CELL_HORIZONTAL_ALIGNMENTS.map((alignment) => (
            <button
              key={alignment}
              type="button"
              disabled={disabled}
              class="btn-paper px-2 py-1 text-[0.65rem] disabled:opacity-40"
              aria-label={`Align cell ${alignment}`}
              aria-pressed={props.format.horizontalAlignment === alignment}
              onClick$={() =>
                props.onIntent$({
                  kind: "horizontal-alignment",
                  alignment,
                })
              }
            >
              {alignment}
            </button>
          ))}
        </div>

        <label class="flex items-center gap-1 text-[0.65rem]">
          <span>Vertical</span>
          <select
            disabled={disabled}
            class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1.5 py-1 disabled:opacity-40"
            value={selectValue(props.format.verticalAlignment)}
            onChange$={(_, element) =>
              props.onIntent$({
                kind: "vertical-alignment",
                alignment:
                  element.value === "default"
                    ? null
                    : (element.value as CellVerticalAlignment),
              })
            }
          >
            {props.format.verticalAlignment === MIXED_CELL_FORMAT && (
              <option value={MIXED_CELL_FORMAT}>Mixed</option>
            )}
            <option value="default">Default</option>
            {CELL_VERTICAL_ALIGNMENTS.map((alignment) => (
              <option key={alignment} value={alignment}>
                {alignment}
              </option>
            ))}
          </select>
        </label>

        <label class="flex items-center gap-1 text-[0.65rem]">
          <span>Border</span>
          <select
            disabled={disabled}
            class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1.5 py-1 disabled:opacity-40"
            value={selectValue(props.format.borderStyle)}
            onChange$={(_, element) =>
              props.onIntent$({
                kind: "border",
                border: {
                  style:
                    element.value === "default"
                      ? null
                      : (element.value as CellBorderStyle),
                },
              })
            }
          >
            {props.format.borderStyle === MIXED_CELL_FORMAT && (
              <option value={MIXED_CELL_FORMAT}>Mixed</option>
            )}
            <option value="default">Default</option>
            {CELL_BORDER_STYLES.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </select>
        </label>

        <label class="flex items-center gap-1 text-[0.65rem]">
          <span>Width</span>
          <select
            disabled={disabled}
            class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-1.5 py-1 disabled:opacity-40"
            value={selectValue(props.format.borderWidth)}
            onChange$={(_, element) =>
              props.onIntent$({
                kind: "border",
                border: {
                  width:
                    element.value === "default" ? null : Number(element.value),
                },
              })
            }
          >
            {props.format.borderWidth === MIXED_CELL_FORMAT && (
              <option value={MIXED_CELL_FORMAT}>Mixed</option>
            )}
            <option value="default">Default</option>
            {[0, 1, 2, 3, 4].map((width) => (
              <option key={String(width)} value={String(width)}>
                {`${width} px`}
              </option>
            ))}
          </select>
        </label>

        <div class="relative">
          <button
            type="button"
            disabled={disabled}
            class="btn-paper flex items-center gap-1.5 px-2 py-1 text-[0.65rem] disabled:opacity-40"
            aria-expanded={borderColorOpen.value}
            aria-haspopup="dialog"
            onClick$={() => {
              borderColorOpen.value = !borderColorOpen.value;
              shadingOpen.value = false;
            }}
          >
            <span
              aria-hidden="true"
              class="inline-block h-3 w-3 border border-[var(--color-paper-3)]"
              style={{ backgroundColor: borderColor ?? "transparent" }}
            />
            Border colour
          </button>
          {borderColorOpen.value && (
            <ColorPicker
              kind="ink"
              value={borderColor}
              title="Cell border colour"
              clearLabel="Default border colour"
              onPick$={(color) =>
                props.onIntent$({ kind: "border", border: { color } })
              }
              onClear$={() =>
                props.onIntent$({ kind: "border", border: { color: null } })
              }
              onClose$={() => {
                borderColorOpen.value = false;
              }}
            />
          )}
        </div>

        <button
          type="button"
          disabled={disabled}
          class="btn-paper px-2 py-1 text-[0.65rem] disabled:opacity-40"
          onClick$={() => props.onIntent$({ kind: "clear" })}
        >
          Clear cell format
        </button>
      </div>
    );
  },
);

// Re-exporting these types keeps coordinator imports on the UI integration
// surface and avoids coupling central editor code to implementation details.
export type {
  CellHorizontalAlignment,
  CellVerticalAlignment,
  SelectedCellFormat,
  TableCellFormatIntent,
};
