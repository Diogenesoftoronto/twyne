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
import { completeSentence } from "../../utils/sentence-ledger";
import {
  localSentenceCandidates,
  sentenceCandidate,
  sentenceWordDiff,
  sentenceWords,
  wordAlternatives,
  type SentenceCandidate,
} from "../../utils/sentence-bench";
import styles from "./sentence-bench.css?inline";
import { InstrumentRoom } from "../instruments/instrument-room";
import {
  InstrumentMotion,
  InstrumentMotionPart,
} from "../instruments/instrument-motion";
import { localWritingStatus } from "../../utils/local-writing-models";
import { onModelDownload } from "../../utils/models-cache";
import { localPackId } from "../../utils/local-writing-manifest";

interface BenchSession {
  sentence: string;
  working: string;
  tab: string;
  typing: boolean;
  wordFrom: number;
  wordTo: number;
  compare: string;
  applying: boolean;
  message: string;
  modelBusy: boolean;
  modelWords: SentenceCandidate[];
  /** Disclosures the writer opened; a replaced instance keeps them open. */
  contextOpen: boolean;
  paragraphOpen: boolean;
  roomOpen: boolean;
}

// The collapsed context keeps one sentence on each side of the working wording.
const SENTENCE_PATTERN = /[^.!?]+[.!?]+["'”’)]*\s*|[^.!?]+$/g;
function lastSentence(text: string): string {
  const parts = text.trim().match(SENTENCE_PATTERN) ?? [];
  return parts.length > 1 ? (parts.at(-1)?.trim() ?? text) : text;
}
function firstSentence(text: string): string {
  const parts = text.trim().match(SENTENCE_PATTERN) ?? [];
  return parts.length > 1 ? (parts[0]?.trim() ?? text) : text;
}

const SECTIONS = [
  ["rewrite", "Rewrite"],
  ["words", "Words"],
  ["place", "Place"],
  ["hear", "Hear"],
] as const;

// Checked candidate updates can replace the renderer's component instance.
// Keep the writer's unfinished choices with this tool session, not that
// instance. Each instance owns its own store and copies its changes back
// here: a store shared between instances keeps the replaced instance's
// subscriptions, and every choice then renders one click late.
// This is browser-only, bounded, and a new tool ID starts a fresh working copy.
const benchSessions = new Map<string, BenchSession>();
function benchSession(toolId: string, props: SentenceLabProps): BenchSession {
  const previous = typeof window !== "undefined" && benchSessions.get(toolId);
  // Work in flight belongs to the instance that started it.
  if (previous && previous.sentence === props.sentence)
    return { ...previous, applying: false, modelBusy: false };
  const session: BenchSession = {
    sentence: props.sentence,
    working: props.sentence,
    tab: props.initialSection ?? "rewrite",
    typing: false,
    wordFrom: props.initialWord?.from ?? -1,
    wordTo: props.initialWord?.to ?? -1,
    compare: "",
    applying: false,
    message: "",
    modelBusy: false,
    modelWords: [],
    contextOpen: false,
    paragraphOpen: false,
    roomOpen: false,
  };
  if (typeof window !== "undefined") {
    benchSessions.set(toolId, session);
    while (benchSessions.size > 8)
      benchSessions.delete(benchSessions.keys().next().value!);
  }
  return { ...session };
}

const signedDelta = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} word${Math.abs(n) === 1 ? "" : "s"}`;

export const SentenceBench = component$<{
  props: SentenceLabProps;
  filling: boolean;
  toolId: string;
}>(({ props, filling, toolId }) => {
  useStyles$(styles);
  const wordPackReady = useSignal(false);
  const state = useStore<BenchSession>(benchSession(toolId, props));
  useTask$(({ track }) => {
    const next = track(() => ({ ...state, modelWords: [...state.modelWords] }));
    if (typeof window === "undefined") return;
    const kept = benchSessions.get(toolId);
    if (kept && kept.sentence === next.sentence) Object.assign(kept, next);
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    let alive = true;
    const refresh = async () => {
      try {
        const status = await localWritingStatus("words");
        if (alive) wordPackReady.value = status.phase === "ready";
      } catch {
        if (alive) wordPackReady.value = false;
      }
    };
    void refresh();
    const off = onModelDownload(localPackId("words"), () => {
      void refresh();
    });
    cleanup(() => {
      alive = false;
      off();
    });
  });
  const candidates = props.candidates ?? [
    ...localSentenceCandidates(props.sentence),
    ...props.attempts
      .filter(completeSentence)
      .map((text) =>
        sentenceCandidate(props.sentence, text, "yours", "Earlier wording"),
      ),
    ...props.variants
      .filter(completeSentence)
      .map((text) =>
        sentenceCandidate(
          props.sentence,
          text,
          "text-model",
          "Model wording",
          "Meaning has not been checked.",
        ),
      ),
  ];
  const before = props.context?.before ?? "";
  const after = props.context?.after ?? "";
  const contextTrimmed =
    (!!before && lastSentence(before) !== before) ||
    (!!after && firstSentence(after) !== after);
  const changed = state.working !== props.sentence;
  const words = sentenceWords(props.sentence);
  const alternatives = wordAlternatives(
    props.sentence,
    state.wordFrom,
    state.wordTo,
  );
  const allWords = sentenceWords(props.context?.paragraph ?? props.sentence);
  const repeated = (word: string) =>
    allWords.filter(
      (w) => w.word.toLocaleLowerCase() === word.toLocaleLowerCase(),
    ).length;
  const Diff = ({ text }: { text: string }) => (
    <span class="sentence-bench-diff">
      {sentenceWordDiff(props.sentence, text).map((part, i) =>
        part.kind === "removed" ? (
          <del key={i}>{part.text}</del>
        ) : part.kind === "added" ? (
          <ins key={i}>{part.text}</ins>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
  /** Provenance and caveats stay one deliberate click away. */
  const About = ({ label, lines }: { label: string; lines: string[] }) => (
    <details class="sentence-bench-about">
      <summary>{label}</summary>
      <ul>
        {lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </details>
  );
  const choose = $((text: string) => {
    state.typing = false;
    state.working = text;
    state.message = "";
  });
  return (
    <div
      class="in-flow-body sentence-bench"
      data-sentence-bench={props.sentenceId ?? "selection"}
    >
      {props.stale && (
        <p class="sentence-bench-notice" role="status">
          This sentence changed. Reopen the bench before using a wording or
          moving it.
        </p>
      )}
      <section
        class="sentence-bench-working"
        aria-label="Working sentence in context"
      >
        <label class="in-flow-label" for={`sentence-bench-working-${toolId}`}>
          Working wording
        </label>
        {state.contextOpen && before && (
          <p
            id={`sentence-bench-before-${toolId}`}
            class="sentence-bench-context"
          >
            {state.paragraphOpen ? before : lastSentence(before)}
          </p>
        )}
        <textarea
          id={`sentence-bench-working-${toolId}`}
          class="in-flow-textarea sentence-bench-textarea"
          rows={3}
          value={state.working}
          onInput$={(_, el) => {
            state.typing = true;
            state.working = el.value;
            state.message = "";
          }}
        />
        {state.contextOpen && after && (
          <p
            id={`sentence-bench-after-${toolId}`}
            class="sentence-bench-context"
          >
            {state.paragraphOpen ? after : firstSentence(after)}
          </p>
        )}
        {changed && (
          <p
            class="sentence-bench-preview"
            aria-label="Changes from the original"
          >
            <Diff text={state.working} />
          </p>
        )}
        <div class="sentence-bench-actions">
          <button
            type="button"
            class="btn-press"
            disabled={
              props.stale ||
              state.applying ||
              !completeSentence(state.working) ||
              !changed
            }
            onClick$={async () => {
              state.applying = true;
              state.message = "";
              try {
                const used = await inFlowController()?.applyVariant(
                  state.working.trim(),
                );
                if (!used)
                  state.message =
                    "The wording could not be used. Check the bench notice and try again.";
              } catch {
                state.message =
                  "The wording could not be checked. Try again or reopen the bench.";
              } finally {
                state.applying = false;
              }
            }}
          >
            {state.applying ? "Checking…" : "Use this wording"}
          </button>
          <button
            type="button"
            class="btn-paper in-flow-mini"
            disabled={!changed}
            onClick$={() => {
              choose(props.sentence);
              inFlowController()?.previewVariant(null);
            }}
          >
            Keep original
          </button>
          {(before || after) && (
            <button
              type="button"
              class="sentence-bench-link"
              aria-expanded={state.contextOpen}
              onClick$={() => {
                state.contextOpen = !state.contextOpen;
              }}
            >
              {state.contextOpen ? "Hide context" : "Context"}
            </button>
          )}
          {state.contextOpen && contextTrimmed && (
            <button
              type="button"
              class="sentence-bench-link"
              aria-expanded={state.paragraphOpen}
              aria-controls={`sentence-bench-before-${toolId} sentence-bench-after-${toolId}`}
              onClick$={() => {
                state.paragraphOpen = !state.paragraphOpen;
              }}
            >
              {state.paragraphOpen ? "Less" : "Whole paragraph"}
            </button>
          )}
        </div>
        {changed && !completeSentence(state.working) && (
          <p class="sentence-bench-hint" role="status">
            Finish the wording with sentence punctuation before using it.
          </p>
        )}
        {state.message && (
          <p class="sentence-bench-notice" role="status">
            {state.message}
          </p>
        )}
      </section>
      <nav aria-label="Sentence bench sections" class="sentence-bench-tabs">
        {SECTIONS.map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={state.tab === id}
            class={state.tab === id ? "is-on" : ""}
            onClick$={() => {
              state.tab = id;
              state.message = "";
              inFlowController()?.previewVariant(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {state.tab === "rewrite" && (
        <section
          aria-label="Complete sentence alternatives"
          class="sentence-bench-pane"
        >
          <ol class="in-flow-list sentence-bench-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  class={[
                    "in-flow-choice",
                    { "in-flow-choice--on": state.working === candidate.text },
                  ]}
                  aria-pressed={state.working === candidate.text}
                  onClick$={() => choose(candidate.text)}
                  onMouseEnter$={() =>
                    inFlowController()?.previewVariant(candidate.text)
                  }
                  onMouseLeave$={() => inFlowController()?.previewVariant(null)}
                  onFocus$={() =>
                    inFlowController()?.previewVariant(candidate.text)
                  }
                  onBlur$={() => inFlowController()?.previewVariant(null)}
                  aria-label={`Try ${candidate.operation}: ${candidate.text}`}
                >
                  <Diff text={candidate.text} />
                  <span class="sentence-bench-meta">
                    {candidate.source !== "rule" && (
                      <span class="sentence-bench-chip">
                        {candidate.source === "text-model"
                          ? "model"
                          : candidate.source}
                      </span>
                    )}
                    {candidate.operation} · {signedDelta(candidate.wordDelta)}
                  </span>
                </button>
                <button
                  type="button"
                  class="sentence-bench-side"
                  aria-pressed={state.compare === candidate.text}
                  aria-label={`Compare alongside the original: ${candidate.operation}`}
                  onClick$={() => {
                    state.compare =
                      state.compare === candidate.text ? "" : candidate.text;
                  }}
                >
                  Compare
                </button>
              </li>
            ))}
          </ol>
          {filling && (
            <p class="sentence-bench-hint" role="status">
              Checking complete alternatives…
            </p>
          )}
          {!candidates.length && !filling && (
            <p class="sentence-bench-hint">
              No safe rule change for this sentence. Try Words, Place or Hear,
              or edit the wording above.
            </p>
          )}
          {candidates.length > 0 && (
            <About
              label="How these were checked"
              lines={candidates.map(
                (candidate) =>
                  `${candidate.operation}: ${
                    candidate.grammar === "checked"
                      ? "Harper checked"
                      : candidate.grammar === "pending"
                        ? "grammar check pending"
                        : "grammar check unavailable"
                  }${
                    candidate.meaning
                      ? `, ${candidate.meaning.model} meaning ${candidate.meaning.probability.toFixed(2)}`
                      : ", meaning unverified"
                  }${candidate.caution ? `. ${candidate.caution}` : "."}`,
              )}
            />
          )}
        </section>
      )}
      {state.tab === "words" && (
        <section aria-label="Word alternatives" class="sentence-bench-pane">
          <p class="sentence-bench-word-line">
            {words.map((word) => (
              <span key={word.from}>
                <button
                  type="button"
                  aria-pressed={state.wordFrom === word.from}
                  class={{
                    "is-repeated": repeated(word.word) > 1,
                    "is-on": state.wordFrom === word.from,
                  }}
                  title={`${repeated(word.word)} use${repeated(word.word) === 1 ? "" : "s"} in this paragraph`}
                  onClick$={() => {
                    state.wordFrom = word.from;
                    state.wordTo = word.to;
                    state.modelWords = [];
                    state.message = "";
                  }}
                >
                  {word.word}
                </button>{" "}
              </span>
            ))}
          </p>
          {state.wordFrom < 0 ? (
            <p class="sentence-bench-hint" role="status">
              Pick a word. Dotted words repeat in this paragraph.
            </p>
          ) : !alternatives.length ? (
            <p class="sentence-bench-hint" role="status">
              No bundled alternatives for “
              {props.sentence.slice(state.wordFrom, state.wordTo)}”.
              {wordPackReady.value
                ? " Try on-device alternatives."
                : " Edit the wording above, or add word alternatives in Preferences."}
            </p>
          ) : null}
          <ol class="in-flow-list">
            {alternatives.map((choice) => (
              <li key={choice.replacement}>
                <button
                  type="button"
                  class={[
                    "in-flow-choice",
                    {
                      "in-flow-choice--on": state.working === choice.sentence,
                    },
                  ]}
                  aria-pressed={state.working === choice.sentence}
                  onClick$={() => choose(choice.sentence)}
                  onMouseEnter$={() =>
                    inFlowController()?.previewVariant(choice.sentence)
                  }
                  onMouseLeave$={() => inFlowController()?.previewVariant(null)}
                  onFocus$={() =>
                    inFlowController()?.previewVariant(choice.sentence)
                  }
                  onBlur$={() => inFlowController()?.previewVariant(null)}
                >
                  <Diff text={choice.sentence} />
                  <span class="sentence-bench-meta">{choice.nuance}</span>
                </button>
              </li>
            ))}
          </ol>
          {wordPackReady.value && (
            <button
              type="button"
              class="btn-paper in-flow-mini"
              disabled={props.stale || state.modelBusy || state.wordFrom < 0}
              onClick$={async () => {
                const from = state.wordFrom,
                  to = state.wordTo;
                state.modelBusy = true;
                state.message = "";
                try {
                  const result = await inFlowController()?.wordVariants(
                    from,
                    to,
                  );
                  if (state.wordFrom === from && state.wordTo === to) {
                    state.modelWords = result ?? [];
                    if (!result?.length)
                      state.message =
                        "No checked word predictions for this use.";
                  }
                } catch (error) {
                  state.message =
                    error instanceof Error
                      ? error.message
                      : "The on-device word check could not finish.";
                } finally {
                  state.modelBusy = false;
                }
              }}
            >
              {state.modelBusy
                ? "Checking word predictions…"
                : "On-device alternatives"}
            </button>
          )}
          <ol class="in-flow-list">
            {state.modelWords.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  class={[
                    "in-flow-choice",
                    {
                      "in-flow-choice--on": state.working === candidate.text,
                    },
                  ]}
                  aria-pressed={state.working === candidate.text}
                  onClick$={() => choose(candidate.text)}
                  onMouseEnter$={() =>
                    inFlowController()?.previewVariant(candidate.text)
                  }
                  onMouseLeave$={() => inFlowController()?.previewVariant(null)}
                  title={`${candidate.likelihood?.model ?? "On-device model"} · Harper checked · meaning unverified`}
                >
                  <Diff text={candidate.text} />
                  <span class="sentence-bench-meta">
                    <span class="sentence-bench-chip">on-device</span>
                    likelihood {candidate.likelihood?.probability.toFixed(3)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <About
            label="About word choices"
            lines={[
              "The bundled thesaurus offers possible meanings; it does not rank fit.",
              "A word can change the meaning. Harper checks the whole sentence before it is used.",
              ...(state.modelWords.length
                ? [
                    `On-device predictions come from ${state.modelWords[0]?.likelihood?.model ?? "a local model"}; their meaning is unverified.`,
                  ]
                : []),
            ]}
          />
        </section>
      )}
      {state.tab === "place" && (
        <section
          aria-label="Sentence placement choices"
          class="sentence-bench-pane"
        >
          <ol class="in-flow-list">
            {(props.placements ?? []).map((slot) => (
              <li key={slot.id} class="sentence-bench-slot">
                <p class="sentence-bench-meta">{slot.reason}</p>
                <p class="sentence-bench-context">
                  {slot.before && <span>{slot.before} </span>}
                  <strong>{props.sentence}</strong>
                  {slot.after && <span> {slot.after}</span>}
                </p>
                <button
                  type="button"
                  class="btn-paper in-flow-mini"
                  disabled={props.stale}
                  onClick$={() => {
                    if (!inFlowController()?.moveSentence(slot.id))
                      state.message =
                        "The paragraph changed. Reopen the bench to choose a position.";
                  }}
                >
                  Move here
                </button>
              </li>
            ))}
          </ol>
          {props.placements?.length ? (
            <About
              label="About positions"
              lines={[
                "These are neighbouring slots, chosen by rule. Their fit has not been judged.",
                "Moving keeps the sentence's marks; one undo puts it back.",
              ]}
            />
          ) : (
            <p class="sentence-bench-hint">
              Add another complete sentence to compare positions.
            </p>
          )}
        </section>
      )}
      {state.tab === "hear" && (
        <section
          aria-label="Hear the sentence in context"
          class="sentence-bench-pane"
        >
          <p class="sentence-bench-hint">
            The sentence before, this wording, then the one after.
          </p>
          <SpeechTransport
            id={`sentence-bench-${toolId}`}
            playLabel="Hear this wording in context"
            onPlay$={() => {
              state.message = "";
              if (!state.working.trim()) {
                state.message = "Enter a wording to hear it in context.";
              } else if (!inFlowController()?.hearVariant(state.working)) {
                state.message =
                  "This bench is no longer connected to the manuscript. Reopen it to hear the wording.";
              }
            }}
          />
        </section>
      )}
      {state.compare && (
        <InstrumentMotion
          key={state.compare}
          state="compare"
          quiet={state.typing}
        >
          <section
            aria-label="Candidate comparison"
            class="sentence-bench-comparison"
          >
            <InstrumentMotionPart part="source">
              <p>
                <span class="sentence-bench-chip">original</span>
                {props.sentence}
              </p>
            </InstrumentMotionPart>
            <InstrumentMotionPart part="alternative">
              <p>
                <span class="sentence-bench-chip">alternative</span>
                <Diff text={state.compare} />
              </p>
            </InstrumentMotionPart>
            <div class="sentence-bench-actions">
              <button
                type="button"
                class="btn-paper in-flow-mini"
                disabled={state.working === state.compare}
                onClick$={() => choose(state.compare)}
              >
                Try this one
              </button>
              <button
                type="button"
                class="sentence-bench-link"
                onClick$={() => {
                  state.compare = "";
                }}
              >
                Close comparison
              </button>
            </div>
          </section>
        </InstrumentMotion>
      )}
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
              key: JSON.stringify([
                toolId,
                props.sentence,
                state.working,
                state.tab,
              ]),
              source: props.sentence,
              proposal: state.working,
              question:
                {
                  rewrite:
                    "What might this wording lose or strengthen in its context?",
                  words:
                    "Does this word choice fit this use and preserve the intended nuance?",
                  place:
                    "What should guide this sentence's position among its neighbours?",
                  hear: "How does this wording's rhythm read aloud beside its neighbours?",
                }[state.tab] ??
                "What would you attend to in this sentence and its proposed wording?",
              detail: [
                `Active pane: ${state.tab}`,
                before ? `Before: ${before}` : "",
                after ? `After: ${after}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            }}
            disabled={props.stale || filling || state.applying}
            onAsk$={async (request) =>
              (await inFlowController()?.askRoom(request, toolId)) ?? {
                ok: false,
                message:
                  "This sentence bench is no longer connected to the manuscript. Reopen it before asking an editor.",
              }
            }
          />
        )}
      </details>
    </div>
  );
});
