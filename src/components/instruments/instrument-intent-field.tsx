import {
  component$,
  useStore,
  useStylesScoped$,
  $,
  type QRL,
} from "@qwik.dev/core";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { askJudgement } from "../../utils/judgement-client";
import {
  systemOneWait,
  spendSystemOne,
  backOffSystemOne,
} from "../../utils/system-one-budget";
import {
  parseInstrumentIntent,
  classifyInstrumentIntent,
  confirmInstrumentIntent,
  type InstrumentIntentInterpretation,
  type ConfirmedInstrumentIntent,
} from "../../utils/instrument-intent";
import styles from "./instrument-intent-field.css?inline";
export interface InstrumentIntentFieldProps {
  value: string;
  contextKey: string;
  onValue$: QRL<(value: string) => void>;
  onConfirm$?: QRL<(value: ConfirmedInstrumentIntent | null) => void>;
  label?: string;
  disabled?: boolean;
}
export const InstrumentIntentField = component$(
  (props: InstrumentIntentFieldProps) => {
    useStylesScoped$(styles);
    const client = useConvexClient();
    const auth = useAuth();
    const state = useStore<{
      labels: InstrumentIntentInterpretation[];
      text: string;
      context: string;
      account: string | null;
      busy: boolean;
      confirmed: boolean;
      error: string;
      request: number;
    }>({
      labels: [],
      text: "",
      context: "",
      account: null,
      busy: false,
      confirmed: false,
      error: "",
      request: 0,
    });
    const parsed = parseInstrumentIntent(props.value);
    const labelsCurrent =
      state.text === props.value &&
      state.context === props.contextKey &&
      state.account === (auth.value.user?.id ?? null);
    const classify = $(async () => {
      const wait = systemOneWait();
      if (wait > 0) {
        state.error = `The shared judgement budget is resting. Try again in ${Math.ceil(wait / 1000)} seconds.`;
        return;
      }
      const snapshot = parseInstrumentIntent(props.value),
        context = props.contextKey,
        account = auth.value.user?.id;
      const request = ++state.request;
      state.busy = true;
      state.error = "";
      state.confirmed = false;
      const current = () =>
        props.value === snapshot.text &&
        props.contextKey === context &&
        auth.value.user?.id === account &&
        state.request === request;
      spendSystemOne();
      const labels = await classifyInstrumentIntent(
        snapshot,
        context,
        (input) => askJudgement(client.value, input),
        current,
      );
      if (current()) {
        state.labels = labels ?? [];
        state.text = snapshot.text;
        state.context = context;
        state.account = account ?? null;
        if (!labels) {
          state.error =
            "The judgement model could not label this instruction. The exact code-parsed tokens are still available.";
          backOffSystemOne();
        }
      }
      if (state.request === request) state.busy = false;
    });
    const confirm = $(async () => {
      if (state.account !== (auth.value.user?.id ?? null)) return;
      const confirmation = confirmInstrumentIntent(
        parseInstrumentIntent(state.text),
        state.context,
        state.labels,
        props.value,
        props.contextKey,
      );
      if (!confirmation) return;
      state.confirmed = true;
      await props.onConfirm$?.(confirmation);
    });
    return (
      <div class="intent-field">
        <label>
          {props.label ?? "Task instruction"}
          <textarea
            value={props.value}
            disabled={props.disabled}
            maxLength={2000}
            onInput$={async (_, element) => {
              state.request++;
              state.busy = false;
              state.confirmed = false;
              state.labels = [];
              state.error = "";
              await props.onValue$(element.value);
              await props.onConfirm$?.(null);
            }}
          />
        </label>
        {(parsed.tokens.length > 0 || parsed.softSpans.length > 0) && (
          <div class="intent-preview" aria-label="Instruction preview">
            <h4>Instruction preview</h4>
            {parsed.tokens.map((token) => (
              <div class="intent-token" key={token.id}>
                <span class="intent-label">
                  {token.kind === "word-limit"
                    ? "Word count"
                    : token.kind === "date"
                      ? "Date"
                      : "Quoted text"}{" "}
                  · code
                </span>
                <code>{token.text}</code>
                <span class="intent-label">
                  {!token.valid
                    ? "Check this value"
                    : token.kind === "date"
                      ? token.value
                      : token.limits
                        ? token.limits.approximate
                          ? "Approximate target"
                          : token.limits.min !== undefined &&
                              token.limits.max !== undefined
                            ? `${token.limits.min}–${token.limits.max} words`
                            : token.limits.max !== undefined
                              ? `Maximum ${token.limits.max} words`
                              : `Minimum ${token.limits.min} words`
                        : "Exact literal"}
                </span>
              </div>
            ))}
            <p class="intent-notice">
              Dates, quotes and word counts are read from the exact text.
              Optional model labels describe its intent; your selected task and
              source resources control what is queued.
            </p>
            <div class="intent-actions">
              <button
                type="button"
                disabled={
                  props.disabled || state.busy || !parsed.softSpans.length
                }
                onClick$={classify}
              >
                {state.busy ? "Labeling…" : "Label task intent"}
              </button>
              {labelsCurrent && state.labels.length > 0 && (
                <button
                  type="button"
                  disabled={props.disabled || state.confirmed}
                  onClick$={confirm}
                >
                  {state.confirmed
                    ? "Labels confirmed"
                    : "Confirm these labels"}
                </button>
              )}
            </div>
            {labelsCurrent &&
              state.labels.map((label) => (
                <div class="intent-token" key={label.id}>
                  <span class="intent-label">
                    {label.label.replace("-", " ")} · Jev{" "}
                    {Math.round(label.probability * 100)}% distribution weight ·{" "}
                    {state.confirmed ? "confirmed" : "review required"}
                  </span>
                  <code>{label.text}</code>
                </div>
              ))}
            {state.error && (
              <p role="status" class="intent-notice">
                {state.error}
              </p>
            )}
          </div>
        )}
      </div>
    );
  },
);
