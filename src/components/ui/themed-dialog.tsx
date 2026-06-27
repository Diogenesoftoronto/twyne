import { component$, type PropFunction } from "@builder.io/qwik";

interface ThemedDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  confirmDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
  inputLabel?: string;
  inputValue?: string;
  inputPlaceholder?: string;
  inputHelp?: string;
  onInput$?: PropFunction<(value: string) => void>;
  onCancel$?: PropFunction<() => void>;
  onConfirm$?: PropFunction<() => void>;
}

export const ThemedDialog = component$((props: ThemedDialogProps) => {
  if (!props.open) return null;

  const confirmClass =
    props.tone === "danger"
      ? "btn-press text-xs text-[var(--color-paper)]"
      : "btn-paper text-xs";

  return (
    <div
      class="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: "var(--z-modal)",
        background: "rgba(20, 16, 10, 0.58)",
      }}
      onClick$={(e) => {
        if (e.target === e.currentTarget) {
          props.onCancel$?.();
        }
      }}
    >
      <div
        class="folio w-full max-w-md p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="themed-dialog-title"
      >
        <p class="dept-label mb-2">Confirm action</p>
        <h2
          id="themed-dialog-title"
          class="text-base font-semibold text-[var(--color-ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {props.title}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-[var(--color-ink-light)]">
          {props.message}
        </p>

        {props.inputLabel && (
          <div class="mt-4">
            <label
              class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
              for="themed-dialog-input"
            >
              {props.inputLabel}
            </label>
            <input
              id="themed-dialog-input"
              autoFocus
              value={props.inputValue ?? ""}
              placeholder={props.inputPlaceholder}
              class="field-input"
              style={{ fontFamily: "var(--font-typewriter)" }}
              onInput$={(e) =>
                props.onInput$?.((e.target as HTMLInputElement).value)
              }
              onKeyDown$={(e) => {
                if (e.key === "Enter" && !props.confirmDisabled && !props.busy) {
                  void props.onConfirm$?.();
                }
              }}
            />
            {props.inputHelp && (
              <p
                class="mt-2 text-[0.68rem] text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {props.inputHelp}
              </p>
            )}
          </div>
        )}

        {props.error && (
          <p class="error-slip mt-4" role="alert">
            {props.error}
          </p>
        )}

        <div class="mt-5 flex items-center justify-end gap-2">
          <button onClick$={() => props.onCancel$?.()} class="btn-paper text-xs">
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick$={() => props.onConfirm$?.()}
            disabled={props.confirmDisabled || props.busy}
            class={`${confirmClass} disabled:opacity-50 disabled:cursor-not-allowed`}
            style={
              props.tone === "danger"
                ? {
                    backgroundColor: "var(--color-vermilion)",
                    borderColor: "var(--color-vermilion)",
                    fontFamily: "var(--font-typewriter)",
                  }
                : undefined
            }
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
});
