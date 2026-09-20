import {
  component$,
  type PropFunction,
  useSignal,
  useTask$,
  useVisibleTask$,
} from "@qwik.dev/core";
import { renderTwyneMermaid } from "../editor/mermaid-theme";

/**
 * Modal for collecting a multi-line text payload — notes, footnotes,
 * mermaid source, anything a single-line input can't hold. The textarea
 * autofocuses and grows to fill the available height, with Cmd/Ctrl+Enter
 * to submit and Escape to cancel, so the writer can stay on the keyboard.
 */
interface TextModalProps {
  open: boolean;
  /** Section label above the title — e.g. "Insert" or "Add". */
  kicker?: string;
  /** Modal heading. */
  title: string;
  /** Helper text shown under the title. */
  description?: string;
  /** Label for the textarea. */
  inputLabel: string;
  /** Placeholder shown when the textarea is empty. */
  placeholder?: string;
  /** Hint shown beneath the textarea — syntax reminders, format tips. */
  helpText?: string;
  /** Minimum height of the textarea, in rem. */
  minHeightRem?: number;
  /** Number of visible text rows; sets the initial size of the textarea. */
  rows?: number;
  /** Submit button label. */
  submitLabel: string;
  /** True when the current text can't be submitted (empty, invalid, etc). */
  submitDisabled?: boolean;
  /** Initial value shown when the modal opens. */
  initialValue?: string;
  /**
   * Live preview rendered under the textarea while the writer types.
   * `"mermaid"` renders the diagram source as SVG on the client (debounced).
   * Omit for plain-text modals (notes, footnotes).
   */
  preview?: "mermaid";
  /** Label shown above the preview region. Defaults to "Preview". */
  previewLabel?: string;
  onCancel$: PropFunction<() => void>;
  onConfirm$: PropFunction<(value: string) => void>;
}

let mermaidPreviewId = 0;

export const TextModal = component$((props: TextModalProps) => {
  const text = useSignal(props.initialValue ?? "");
  const textareaRef = useSignal<HTMLTextAreaElement>();
  const previewHtml = useSignal("");
  const previewError = useSignal("");
  const previewBusy = useSignal(false);

  // Reset the textarea each time the modal (re)opens so the writer doesn't
  // see a stale value from the previous session.
  useTask$(({ track }) => {
    track(() => props.open);
    if (props.open) {
      text.value = props.initialValue ?? "";
      previewHtml.value = "";
      previewError.value = "";
      previewBusy.value = false;
      // Defer focus so Qwik has rendered the textarea into the DOM.
      queueMicrotask(() => textareaRef.value?.focus());
    }
  });

  // Live diagram preview. Client-only (mermaid needs the DOM) and debounced
  // so fast typing doesn't queue a render per keystroke. A generation guard
  // keeps a slow render from overwriting a newer one.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const source = track(() => text.value);
    const enabled = track(() => props.preview);
    if (enabled !== "mermaid") return;
    previewError.value = "";
    if (!source.trim()) {
      previewHtml.value = "";
      previewBusy.value = false;
      return;
    }
    previewBusy.value = true;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        mermaidPreviewId += 1;
        const svg = await renderTwyneMermaid(
          `twyne-modal-preview-${mermaidPreviewId}`,
          source,
        );
        if (cancelled) return;
        previewHtml.value = svg;
        previewBusy.value = false;
      } catch (error) {
        if (cancelled) return;
        previewHtml.value = "";
        previewBusy.value = false;
        previewError.value =
          error instanceof Error && error.message.trim()
            ? error.message.replace(/^Syntax error in (text|graph):\s*/i, "")
            : "This diagram could not be rendered yet.";
      }
    }, 400);
    cleanup(() => {
      cancelled = true;
      clearTimeout(timer);
    });
  });

  if (!props.open) return null;

  return (
    <div
      class="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: "var(--z-modal)",
        background: "rgba(20, 16, 10, 0.58)",
      }}
      onClick$={(e) => {
        if (e.target === e.currentTarget) {
          void props.onCancel$();
        }
      }}
    >
      <div
        class={[
          "folio w-full p-5",
          props.preview === "mermaid" ? "max-w-4xl" : "max-w-lg",
        ]}
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-modal-title"
      >
        {props.kicker && <p class="dept-label mb-2">{props.kicker}</p>}
        <h2
          id="text-modal-title"
          class="text-base font-semibold text-[var(--color-ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {props.title}
        </h2>
        {props.description && (
          <p class="mt-2 text-sm leading-relaxed text-[var(--color-ink-light)]">
            {props.description}
          </p>
        )}

        <div
          class={[
            "mt-4",
            props.preview === "mermaid" &&
              "grid gap-4 md:grid-cols-2 md:items-stretch",
          ]}
        >
          <div class="min-w-0">
            <label
              class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
              for="text-modal-textarea"
            >
              {props.inputLabel}
            </label>
            <textarea
              id="text-modal-textarea"
              ref={textareaRef}
              value={text.value}
              placeholder={props.placeholder}
              rows={props.rows ?? 6}
              class="field-input resize-y"
              style={{
                fontFamily: "var(--font-typewriter)",
                minHeight: `${props.minHeightRem ?? 10}rem`,
                lineHeight: "1.5",
              }}
              onInput$={(e) => {
                text.value = (e.target as HTMLTextAreaElement).value;
              }}
              onKeyDown$={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  void props.onCancel$();
                  return;
                }
                // Cmd/Ctrl+Enter submits; Enter alone stays a newline.
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (!props.submitDisabled && text.value.trim()) {
                    void props.onConfirm$(text.value);
                  }
                }
              }}
            />
            {props.helpText && (
              <p
                class="mt-2 text-[0.68rem] text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {props.helpText}
              </p>
            )}
          </div>
          {props.preview === "mermaid" && (
            <div class="min-w-0">
              <p
                class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {props.previewLabel ?? "Preview"}
              </p>
              <div
                class="border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-4 py-3 overflow-auto h-full"
                style={{
                  borderRadius: "2px",
                  minHeight: `${props.minHeightRem ?? 10}rem`,
                  maxHeight: "24rem",
                  fontFamily: "var(--font-serif)",
                  color: "var(--color-ink)",
                }}
                aria-live="polite"
              >
                {previewHtml.value ? (
                  <div
                    class="mermaid twyne-mermaid-preview mx-auto max-w-full [&>svg]:mx-auto [&>svg]:max-w-full [&>svg]:h-auto"
                    dangerouslySetInnerHTML={previewHtml.value}
                  />
                ) : previewBusy.value ? (
                  <p
                    class="text-[0.72rem] text-[var(--color-ink-muted)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    Rendering preview…
                  </p>
                ) : previewError.value ? (
                  <p
                    role="alert"
                    class="text-[0.72rem] text-[var(--color-vermilion)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    {previewError.value}
                  </p>
                ) : (
                  <p
                    class="text-[0.72rem] text-[var(--color-ink-muted)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  >
                    A live preview of the diagram will appear here as you type.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div class="mt-5 flex items-center justify-end gap-2">
          <button onClick$={() => props.onCancel$()} class="btn-paper text-xs">
            Cancel
          </button>
          <button
            onClick$={() => props.onConfirm$(text.value)}
            disabled={props.submitDisabled || !text.value.trim()}
            class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "var(--color-vermilion)",
              borderColor: "var(--color-vermilion)",
              fontFamily: "var(--font-typewriter)",
            }}
          >
            {props.submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
});
