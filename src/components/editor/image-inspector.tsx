import { component$, type PropFunction } from "@builder.io/qwik";
import {
  IMAGE_WIDTH_PRESETS,
  normalizeImageWidth,
  type ImageAlignment,
  type ImageNodeAttributes,
} from "./extensions/image-node";

export interface ImageInspectorProps {
  attributes: ImageNodeAttributes;
  onPatch$: PropFunction<(patch: Partial<ImageNodeAttributes>) => void>;
  onChooseFiles$?: PropFunction<() => void>;
  onRetry$?: PropFunction<() => void>;
  onRemove$?: PropFunction<() => void>;
  disabled?: boolean;
}

const ALIGNMENTS: ReadonlyArray<{
  value: ImageAlignment;
  label: string;
}> = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
];

/**
 * Editor-agnostic controls for a selected image. The coordinator supplies the
 * node attrs and applies patches with `editor.commands.updateAttributes`.
 */
export const ImageInspector = component$<ImageInspectorProps>((props) => {
  const disabled = props.disabled === true;
  const progress = Math.round(
    Math.min(1, Math.max(0, props.attributes.uploadProgress)) * 100,
  );

  return (
    <aside
      data-image-inspector
      aria-label="Image inspector"
      class="grid gap-3 border border-[var(--color-paper-3)] bg-[var(--color-paper)] p-3 text-xs"
    >
      <div class="flex items-center justify-between gap-2">
        <strong class="font-semibold">Image</strong>
        {props.onChooseFiles$ && (
          <button
            type="button"
            class="btn-paper px-2 py-1"
            disabled={disabled}
            onClick$={() => props.onChooseFiles$?.()}
          >
            Choose file…
          </button>
        )}
      </div>

      {props.attributes.uploadStatus !== "ready" && (
        <div
          role={props.attributes.uploadStatus === "failed" ? "alert" : "status"}
          class="grid gap-1 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-2"
        >
          <span>
            {props.attributes.uploadStatus === "uploading"
              ? `Uploading… ${progress}%`
              : props.attributes.uploadError || "Upload failed."}
          </span>
          {props.attributes.uploadStatus === "uploading" && (
            <progress
              aria-label="Image upload progress"
              max={100}
              value={progress}
              class="w-full"
            />
          )}
          {props.attributes.uploadStatus === "failed" && props.onRetry$ && (
            <button
              type="button"
              class="btn-paper justify-self-start px-2 py-1"
              onClick$={() => props.onRetry$?.()}
            >
              Retry upload
            </button>
          )}
        </div>
      )}

      <label class="grid gap-1">
        <span>Alt text</span>
        <input
          type="text"
          aria-label="Image alt text"
          value={props.attributes.alt}
          disabled={disabled}
          class="border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1.5"
          placeholder="Describe the image for readers who cannot see it"
          onInput$={(_, element) => props.onPatch$({ alt: element.value })}
        />
      </label>

      <label class="grid gap-1">
        <span>Caption</span>
        <textarea
          aria-label="Image caption"
          value={props.attributes.caption}
          disabled={disabled}
          rows={2}
          class="resize-y border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-2 py-1.5"
          onInput$={(_, element) => props.onPatch$({ caption: element.value })}
        />
      </label>

      <div class="grid gap-1">
        <span>Alignment</span>
        <div role="group" aria-label="Image alignment" class="flex">
          {ALIGNMENTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              disabled={disabled}
              aria-pressed={props.attributes.alignment === value}
              class="btn-paper flex-1 px-2 py-1"
              onClick$={() => props.onPatch$({ alignment: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div class="grid gap-1">
        <span>Width</span>
        <div role="group" aria-label="Image width presets" class="flex">
          {IMAGE_WIDTH_PRESETS.map((width) => (
            <button
              key={width}
              type="button"
              disabled={disabled}
              aria-pressed={
                normalizeImageWidth(props.attributes.width) === width
              }
              class="btn-paper flex-1 px-1.5 py-1"
              onClick$={() => props.onPatch$({ width })}
            >
              {width}%
            </button>
          ))}
        </div>
        <input
          type="range"
          aria-label="Custom image width"
          min={10}
          max={100}
          step={1}
          value={normalizeImageWidth(props.attributes.width)}
          disabled={disabled}
          onInput$={(_, element) =>
            props.onPatch$({ width: normalizeImageWidth(element.value) })
          }
        />
      </div>

      {props.onRemove$ && (
        <button
          type="button"
          disabled={disabled}
          class="btn-paper justify-self-start px-2 py-1"
          onClick$={() => props.onRemove$?.()}
        >
          Remove image
        </button>
      )}
    </aside>
  );
});
