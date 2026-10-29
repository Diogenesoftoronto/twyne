import {
  $,
  component$,
  useSignal,
  useStore,
  useStyles$,
  useTask$,
  useVisibleTask$,
} from "@qwik.dev/core";
import type { SentenceLabProps } from "./catalog";
import { inFlowController } from "../editor/extensions/struggle-tracker";
import { SpeechTransport } from "../ui/speech-transport";
import {
  bindingKey,
  checkTrial,
  sentenceWordDiff,
  type RevisionBinding,
  type RevisionObservation,
} from "../../utils/sentence-bench";
import styles from "./sentence-bench.css?inline";
import { InstrumentRoom } from "../instruments/instrument-room";

type View = "changes" | "revision" | "original";
interface Reading {
  /** The binding the reading belongs to; any edit makes it stale. */
  key: string;
  status: "loading" | "ready" | "error";
  observations: RevisionObservation[];
  dropped: number;
  message: string;
}
interface BenchSession {
  sentence: string;
  trial: string;
  /** The last trial handed in by the controller, so a new one replaces it. */
  offered: string;
  view: View;
  preview: boolean;
  message: string;
  roomOpen: boolean;
  /** The caret went into the revision once; a replaced instance never steals it. */
  focused: boolean;
}

// The margin can replace this component's instance while a reading is in
// flight, so readings live per tool session, outside any one instance, and
// every instance for that tool follows them.
const READING_EVENT = "twyne:revision-reading";
const readings = new Map<string, Reading>();
function publishReading(toolId: string, reading: Reading | null) {
  if (reading) readings.set(toolId, reading);
  else readings.delete(toolId);
  while (readings.size > 8) readings.delete(readings.keys().next().value!);
  window.dispatchEvent(
    new CustomEvent<string>(READING_EVENT, { detail: toolId }),
  );
}
const copyReading = (toolId: string): Reading | null => {
  const r = readings.get(toolId);
  return r
    ? { ...r, observations: r.observations.map((o) => ({ ...o })) }
    : null;
};

// A spec update (a stale flag, a handed-in transcript) can replace the
// renderer's component instance. Keep the writer's trial with this tool
// session, not that instance. Each instance owns its own store and copies its
// changes back here: a store shared between instances keeps the replaced
// instance's subscriptions. Browser-only, bounded; a new tool ID starts fresh.
const benchSessions = new Map<string, BenchSession>();
function benchSession(toolId: string, props: SentenceLabProps): BenchSession {
  const previous = typeof window !== "undefined" && benchSessions.get(toolId);
  if (previous && previous.sentence === props.sentence) return { ...previous };
  const session: BenchSession = {
    sentence: props.sentence,
    trial: props.trial ?? props.sentence,
    offered: props.trial ?? "",
    view: "changes",
    preview: false,
    message: "",
    roomOpen: false,
    focused: false,
  };
  if (typeof window !== "undefined") {
    benchSessions.set(toolId, session);
    while (benchSessions.size > 8)
      benchSessions.delete(benchSessions.keys().next().value!);
  }
  return { ...session };
}

const VIEWS: Array<[View, string]> = [
  ["changes", "Changes"],
  ["revision", "Revision"],
  ["original", "Original"],
];

export const SentenceBench = component$<{
  props: SentenceLabProps;
  filling: boolean;
  toolId: string;
}>(({ props, toolId }) => {
  useStyles$(styles);
  const field = useSignal<HTMLTextAreaElement>();
  const state = useStore<BenchSession>(benchSession(toolId, props));
  const current = useStore<{ reading: Reading | null }>({
    reading: typeof window === "undefined" ? null : copyReading(toolId),
  });
  useTask$(({ track }) => {
    const next = track(() => ({ ...state }));
    if (typeof window === "undefined") return;
    const kept = benchSessions.get(toolId);
    if (kept && kept.sentence === next.sentence) Object.assign(kept, next);
  });
  // An edited transcript arrives as a new trial; it never touches the page.
  useTask$(({ track }) => {
    const offered = track(() => props.trial);
    if (offered && offered !== state.offered) {
      state.offered = offered;
      state.trial = offered;
      state.message = "";
    }
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const follow = (event: Event) => {
      if ((event as CustomEvent<string>).detail === toolId)
        current.reading = copyReading(toolId);
    };
    current.reading = copyReading(toolId);
    window.addEventListener(READING_EVENT, follow);
    cleanup(() => window.removeEventListener(READING_EVENT, follow));
    // Opened by the writer's request: put the caret in the revision, once.
    if (!state.focused) {
      state.focused = true;
      field.value?.focus({ preventScroll: true });
    }
  });

  const before = props.context?.before ?? "";
  const after = props.context?.after ?? "";
  const checked = checkTrial(state.trial);
  const changed = checked.ok && checked.text !== props.sentence;
  const key = changed
    ? bindingKey({
        original: props.sentence,
        trial: checked.text,
        before,
        after,
      })
    : "";
  const reading = current.reading;
  const readingCurrent = !!reading && reading.key === key;
  const blocked = !!props.stale;

  const close = $(() => {
    inFlowController()?.previewVariant(null);
    inFlowController()?.closeRevision();
  });
  const use = $(() => {
    state.message = "";
    const result = inFlowController()?.applyRevision(state.trial) ?? {
      ok: false as const,
      message:
        "This bench is no longer connected to the manuscript. Copy your revision and reopen it.",
    };
    if (!result.ok) state.message = result.message;
  });
  const read = $(async () => {
    // Bind to the texts on the bench at the moment of the click.
    const trial = checkTrial(state.trial);
    if (!trial.ok || trial.text === props.sentence || props.stale) return;
    const binding: RevisionBinding = {
      original: props.sentence,
      trial: trial.text,
      before: props.context?.before ?? "",
      after: props.context?.after ?? "",
    };
    const requestKey = bindingKey(binding);
    publishReading(toolId, {
      key: requestKey,
      status: "loading",
      observations: [],
      dropped: 0,
      message: "",
    });
    let result;
    try {
      result = await inFlowController()?.readRevision(toolId, binding);
    } catch {
      result = undefined;
    }
    // Discard an answer that was stopped or superseded.
    const pending = readings.get(toolId);
    if (pending?.key !== requestKey || pending.status !== "loading") return;
    publishReading(
      toolId,
      result?.ok === true
        ? {
            key: requestKey,
            status: "ready",
            observations: result.observations,
            dropped: result.dropped,
            message: "",
          }
        : {
            key: requestKey,
            status: "error",
            observations: [],
            dropped: 0,
            message:
              result?.message ??
              "This bench is no longer connected to the manuscript. Your revision is unchanged.",
          },
    );
  });

  const Diff = ({ text }: { text: string }) => (
    <>
      {sentenceWordDiff(props.sentence, text).map((part, i) =>
        part.kind === "removed" ? (
          <del key={i}>{part.text}</del>
        ) : part.kind === "added" ? (
          <ins key={i}>{part.text}</ins>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );

  if (props.refusal)
    return (
      <div class="in-flow-body sentence-bench" data-sentence-bench="refused">
        <p class="sentence-bench-notice" role="status">
          {props.refusal}
        </p>
        <div class="sentence-bench-actions">
          <button type="button" class="btn-paper in-flow-mini" onClick$={close}>
            Close
          </button>
        </div>
      </div>
    );

  return (
    <div
      class="in-flow-body sentence-bench"
      data-sentence-bench={props.sentenceId ?? "selection"}
      onKeyDown$={(event) => {
        if (event.key === "Escape") void close();
        // The controller re-checks the trial and the source before editing.
        else if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
          void use();
      }}
    >
      {blocked && (
        <p class="sentence-bench-notice" role="status">
          The sentence or its paragraph changed in the manuscript. Your revision
          is kept here: copy it, or close and reopen the bench on the current
          text.
        </p>
      )}
      <section class="sentence-bench-source" aria-label="Original sentence">
        <p class="in-flow-label">Original</p>
        <p class="sentence-bench-original">{props.sentence}</p>
      </section>
      <section class="sentence-bench-working">
        <label class="in-flow-label" for={`sentence-bench-trial-${toolId}`}>
          Your revision
        </label>
        <textarea
          ref={field}
          id={`sentence-bench-trial-${toolId}`}
          class="in-flow-textarea sentence-bench-textarea"
          rows={3}
          maxLength={1400}
          aria-describedby={`sentence-bench-trial-hint-${toolId}`}
          value={state.trial}
          onInput$={(_, el) => {
            state.trial = el.value;
            state.message = "";
            if (state.preview)
              inFlowController()?.previewVariant(el.value || null);
          }}
        />
        <p
          id={`sentence-bench-trial-hint-${toolId}`}
          class="sentence-bench-hint"
          role={!checked.ok && state.trial.trim() ? "status" : undefined}
        >
          {!checked.ok && state.trial.trim()
            ? checked.message
            : changed
              ? "Fragments and more than one sentence are fine."
              : "Edit the copy above. The original stays as it is until you use the revision."}
        </p>
      </section>

      <div class="sentence-bench-actions">
        <button
          type="button"
          class="btn-press"
          disabled={blocked || !changed}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          onClick$={use}
        >
          Use revision
        </button>
        <button
          type="button"
          class="btn-paper in-flow-mini"
          aria-keyshortcuts="Escape"
          onClick$={close}
        >
          Keep original
        </button>
        {state.trial.trim() && (
          <button
            type="button"
            class="sentence-bench-link"
            onClick$={async () => {
              try {
                await navigator.clipboard.writeText(state.trial.trim());
                state.message = "Revision copied.";
              } catch {
                field.value?.select();
                state.message =
                  "Copying was blocked. The revision is selected; copy it with your keyboard.";
              }
            }}
          >
            Copy revision
          </button>
        )}
      </div>
      {state.message && (
        <p class="sentence-bench-notice" role="status">
          {state.message}
        </p>
      )}

      {props.context && (
        <section
          class="sentence-bench-paragraph-wrap"
          aria-label="Sentence in its paragraph"
        >
          <div
            class="sentence-bench-views"
            role="group"
            aria-label="Show in the paragraph"
          >
            {VIEWS.map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={state.view === id}
                class={state.view === id ? "is-on" : ""}
                onClick$={() => {
                  state.view = id;
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p class="sentence-bench-paragraph">
            {before && <span class="sentence-bench-context">{before}</span>}
            <mark class="sentence-bench-slot-text">
              {state.view === "original" || !changed ? (
                props.sentence
              ) : state.view === "revision" ? (
                checked.ok ? (
                  checked.text
                ) : (
                  props.sentence
                )
              ) : (
                <Diff text={checked.ok ? checked.text : props.sentence} />
              )}
            </mark>
            {after && <span class="sentence-bench-context">{after}</span>}
          </p>
        </section>
      )}

      <section class="sentence-bench-reading" aria-label="Read the difference">
        <div class="sentence-bench-actions">
          {reading?.status === "loading" && readingCurrent ? (
            <>
              <span class="sentence-bench-hint" role="status">
                Reading the difference…
              </span>
              <button
                type="button"
                class="sentence-bench-link"
                onClick$={() => publishReading(toolId, null)}
              >
                Stop
              </button>
            </>
          ) : (
            <button
              type="button"
              class="btn-paper in-flow-mini"
              disabled={blocked || !changed}
              onClick$={read}
            >
              Read the difference
            </button>
          )}
        </div>
        {!readingCurrent && (
          <p class="sentence-bench-hint">
            {reading && reading.status !== "loading"
              ? "The revision changed since the last reading. Read the difference again for this version."
              : "Sends the original, your revision and this paragraph to your connected prose model, once. It points out up to two changes in what a reader would understand; it does not rewrite or rank."}
          </p>
        )}
        {readingCurrent && reading.status === "error" && (
          <p class="sentence-bench-notice" role="status">
            {reading.message}
          </p>
        )}
        {readingCurrent && reading.status === "ready" && (
          <>
            {reading.observations.length ? (
              <ol class="sentence-bench-observations">
                {reading.observations.map((o, i) => (
                  <li key={i}>
                    <p class="sentence-bench-quotes">
                      {o.originalQuote ? (
                        <del>“{o.originalQuote}”</del>
                      ) : (
                        <span class="sentence-bench-quiet">
                          new in revision
                        </span>
                      )}
                      <span aria-hidden="true"> → </span>
                      <span class="sentence-bench-sr"> becomes </span>
                      {o.trialQuote ? (
                        <ins>“{o.trialQuote}”</ins>
                      ) : (
                        <span class="sentence-bench-quiet">gone</span>
                      )}
                    </p>
                    <p class="sentence-bench-observation">{o.reading}</p>
                    {o.contextQuote && (
                      <p class="sentence-bench-hint">
                        Uses the paragraph: “{o.contextQuote}”
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p class="sentence-bench-hint" role="status">
                The model returned no observations for this revision.
              </p>
            )}
            {reading.dropped > 0 && (
              <p class="sentence-bench-hint">
                {reading.dropped === 1
                  ? "One observation was left out: its quotes did not match the text."
                  : `${reading.dropped} observations were left out: their quotes did not match the text.`}
              </p>
            )}
          </>
        )}
      </section>

      <div class="sentence-bench-tools">
        <button
          type="button"
          class="sentence-bench-link"
          aria-pressed={state.preview}
          disabled={blocked || !changed}
          onClick$={() => {
            state.preview = !state.preview;
            inFlowController()?.previewVariant(
              state.preview ? state.trial : null,
            );
          }}
        >
          {state.preview ? "Hide in manuscript" : "Preview in manuscript"}
        </button>
        <SpeechTransport
          id={`sentence-bench-${toolId}`}
          playLabel="Hear it in context"
          onPlay$={() => {
            state.message = "";
            const text = checked.ok ? checked.text : props.sentence;
            if (!inFlowController()?.hearVariant(text))
              state.message =
                "This bench is no longer connected to the manuscript. Reopen it to hear the revision.";
          }}
        />
      </div>

      <details
        class="sentence-bench-room"
        open={state.roomOpen}
        onToggle$={(_, el) => {
          state.roomOpen = el.open;
        }}
      >
        <summary>Ask an editor</summary>
        {/* Mounted only while open: a closed disclosure has no box, so the
            room's visible-task would never load its cast. */}
        {state.roomOpen && (
          <InstrumentRoom
            context={{
              instrument: "sentence",
              key: JSON.stringify([toolId, props.sentence, state.trial]),
              source: props.sentence,
              proposal: state.trial,
              question:
                "What might this revision change for a reader of this paragraph?",
              detail: [
                before ? `Before: ${before}` : "",
                after ? `After: ${after}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            }}
            disabled={blocked}
            onAsk$={async (request) =>
              (await inFlowController()?.askRoom(request, toolId)) ?? {
                ok: false,
                message:
                  "This bench is no longer connected to the manuscript. Reopen it before asking an editor.",
              }
            }
          />
        )}
      </details>
    </div>
  );
});
