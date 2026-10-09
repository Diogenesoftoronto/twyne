import {
  component$,
  useSignal,
  useStore,
  useStyles$,
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
import { InstrumentArt } from "../instruments/instrument-art";
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
}

// Checked candidate updates can replace the renderer's component instance.
// Keep the writer's unfinished choices with this tool session, not that instance.
// This is browser-only, bounded, and a new tool ID starts a fresh working copy.
const benchSessions = new Map<string, BenchSession>();
function benchSession(toolId: string, props: SentenceLabProps): BenchSession {
  const previous = typeof window !== "undefined" && benchSessions.get(toolId);
  if (previous && previous.sentence === props.sentence) return previous;
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
  };
  if (typeof window !== "undefined") {
    benchSessions.set(toolId, session);
    while (benchSessions.size > 8)
      benchSessions.delete(benchSessions.keys().next().value!);
  }
  return session;
}

export const SentenceBench = component$<{
  props: SentenceLabProps;
  filling: boolean;
  toolId: string;
}>(({ props, filling, toolId }) => {
  useStyles$(styles);
  const wordPackReady = useSignal(false);
  const state = useStore<BenchSession>(benchSession(toolId, props));
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
  return (
    <div
      class="in-flow-body sentence-bench"
      data-sentence-bench={props.sentenceId ?? "selection"}
    >
      <InstrumentMotion state="open">
        <InstrumentArt kind="sentence-bench" size="compact" />
      </InstrumentMotion>
      <nav aria-label="Sentence bench sections" class="sentence-bench-tabs">
        {[
          ["rewrite", "Rewrite"],
          ["words", "Words"],
          ["place", "Place"],
          ["hear", "Hear"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-pressed={state.tab === id}
            class={state.tab === id ? "is-on" : ""}
            onClick$={() => {
              state.tab = id;
              inFlowController()?.previewVariant(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {props.stale && (
        <p class="sentence-bench-notice" role="status">
          This sentence changed. Reopen the bench before using a wording or
          moving it.
        </p>
      )}
      {state.tab === "rewrite" && (
        <section aria-label="Complete sentence alternatives">
          <p class="in-flow-label">Complete wordings</p>
          <ol class="in-flow-list sentence-bench-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  class={[
                    "in-flow-choice",
                    { "in-flow-choice--on": state.working === candidate.text },
                  ]}
                  onClick$={() => {
                    state.typing = false;
                    state.working = candidate.text;
                    state.message = "";
                  }}
                  onMouseEnter$={() =>
                    inFlowController()?.previewVariant(candidate.text)
                  }
                  onMouseLeave$={() => inFlowController()?.previewVariant(null)}
                  onFocus$={() =>
                    inFlowController()?.previewVariant(candidate.text)
                  }
                  onBlur$={() => inFlowController()?.previewVariant(null)}
                  aria-label={`Compare ${candidate.operation}: ${candidate.text}`}
                >
                  <Diff text={candidate.text} />
                  <span class="sentence-bench-facts">
                    <span class="sentence-bench-chip">
                      {candidate.source === "text-model"
                        ? "text model"
                        : candidate.source}
                    </span>
                    <span>{candidate.operation}</span>
                    <span>
                      {candidate.wordDelta > 0 ? "+" : ""}
                      {candidate.wordDelta} words
                    </span>
                  </span>
                </button>
                <p class="sentence-bench-note">
                  {candidate.grammar === "checked"
                    ? "Harper checked"
                    : candidate.grammar === "pending"
                      ? "Grammar check pending"
                      : "Grammar check unavailable"}
                  {candidate.meaning
                    ? ` · ${candidate.meaning.model} meaning ${candidate.meaning.probability.toFixed(2)}`
                    : " · meaning unverified"}
                </p>
                {candidate.caution && (
                  <p class="sentence-bench-note">{candidate.caution}</p>
                )}
                <button
                  type="button"
                  class="sentence-bench-link"
                  aria-pressed={state.compare === candidate.text}
                  onClick$={() => {
                    state.compare =
                      state.compare === candidate.text ? "" : candidate.text;
                  }}
                >
                  Compare alongside
                </button>
              </li>
            ))}
          </ol>
          {filling && (
            <p class="sentence-bench-note" role="status">
              Checking complete alternatives…
            </p>
          )}
          {!candidates.length && !filling && (
            <p class="sentence-bench-note">
              No safe rule change for this sentence. Try a word below, move it,
              hear it, or edit a complete wording.
            </p>
          )}
        </section>
      )}
      {state.tab === "words" && (
        <section aria-label="Word alternatives">
          <p class="in-flow-label">Choose a word</p>
          <p class="sentence-bench-word-line">
            {words.map((word) => (
              <span key={word.from}>
                <button
                  type="button"
                  disabled={!word.available && !wordPackReady.value}
                  aria-pressed={state.wordFrom === word.from}
                  class={{
                    "is-repeated": repeated(word.word) > 1,
                    "is-on": state.wordFrom === word.from,
                  }}
                  title={
                    word.available
                      ? `${repeated(word.word)} use${repeated(word.word) === 1 ? "" : "s"} in this paragraph; show alternatives`
                      : `${repeated(word.word)} use${repeated(word.word) === 1 ? "" : "s"}; no bundled alternatives`
                  }
                  onClick$={() => {
                    state.wordFrom = word.from;
                    state.wordTo = word.to;
                    state.modelWords = [];
                  }}
                >
                  {word.word}
                </button>{" "}
              </span>
            ))}
          </p>
          <p class="sentence-bench-note">
            Underlined words repeat in this paragraph. The bundled thesaurus
            offers possible meanings; it does not rank fit.
          </p>
          <ol class="in-flow-list">
            {alternatives.map((choice) => (
              <li key={choice.replacement}>
                <button
                  type="button"
                  class="in-flow-choice"
                  onClick$={() => {
                    state.working = choice.sentence;
                    state.message = "";
                  }}
                  onMouseEnter$={() =>
                    inFlowController()?.previewVariant(choice.sentence)
                  }
                  onMouseLeave$={() => inFlowController()?.previewVariant(null)}
                >
                  <Diff text={choice.sentence} />
                  <span class="sentence-bench-facts">
                    <span class="sentence-bench-chip">thesaurus</span>
                    <span>{choice.nuance}</span>
                  </span>
                </button>
                <p class="sentence-bench-note">
                  May change meaning. Harper checks the full sentence before
                  use.
                </p>
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
                  class="in-flow-choice"
                  onClick$={() => {
                    state.typing = false;
                    state.working = candidate.text;
                  }}
                  onMouseEnter$={() =>
                    inFlowController()?.previewVariant(candidate.text)
                  }
                  onMouseLeave$={() => inFlowController()?.previewVariant(null)}
                >
                  <Diff text={candidate.text} />
                  <span class="sentence-bench-facts">
                    <span class="sentence-bench-chip">on-device</span>
                    <span>
                      Word likelihood{" "}
                      {candidate.likelihood?.probability.toFixed(3)}
                    </span>
                  </span>
                </button>
                <p class="sentence-bench-note">
                  {candidate.likelihood?.model} · Harper checked · meaning
                  unverified.
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {state.tab === "place" && (
        <section aria-label="Sentence placement choices">
          <p class="in-flow-label">Read another position</p>
          <p class="sentence-bench-note">
            These are neighbouring slots, by rule. Their fit has not been
            judged.
          </p>
          <ol class="in-flow-list">
            {(props.placements ?? []).map((slot) => (
              <li key={slot.id} class="sentence-bench-slot">
                <p class="sentence-bench-context">
                  {slot.before && <span>{slot.before} </span>}
                  <strong>{props.sentence}</strong>
                  {slot.after && <span> {slot.after}</span>}
                </p>
                <p class="sentence-bench-note">{slot.reason}</p>
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
          {!props.placements?.length && (
            <p class="sentence-bench-note">
              Add another complete sentence to compare positions.
            </p>
          )}
        </section>
      )}
      {state.tab === "hear" && (
        <section aria-label="Hear the sentence in context">
          <p class="in-flow-label">Listen in context</p>
          <p class="sentence-bench-note">
            Reads the preceding sentence, this wording, and the following
            sentence through your narration player. Local speech works when its
            voice is installed.
          </p>
          <SpeechTransport
            id={`sentence-bench-${toolId}`}
            playLabel="Hear this wording in context"
            onPlay$={() => inFlowController()?.hearVariant(state.working)}
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
            <p class="in-flow-label">Alongside</p>
            <InstrumentMotionPart part="source">
              <p>
                <span class="sentence-bench-chip">original</span>
                {props.sentence}
              </p>
            </InstrumentMotionPart>
            <InstrumentMotionPart part="alternative">
              <p>
                <span class="sentence-bench-chip">comparison</span>
                <Diff text={state.compare} />
              </p>
            </InstrumentMotionPart>
          </section>
        </InstrumentMotion>
      )}
      <section
        class="sentence-bench-working"
        aria-label="Working sentence in context"
      >
        <label class="in-flow-label" for={`sentence-bench-working-${toolId}`}>
          Working wording
        </label>
        {props.context?.before && (
          <p class="sentence-bench-context">{props.context.before}</p>
        )}
        <textarea
          id={`sentence-bench-working-${toolId}`}
          class="in-flow-textarea"
          rows={3}
          value={state.working}
          onInput$={(_, el) => {
            state.typing = true;
            state.working = el.value;
            state.message = "";
          }}
        />
        {props.context?.after && (
          <p class="sentence-bench-context">{props.context.after}</p>
        )}
        {state.working !== props.sentence && (
          <p class="sentence-bench-preview">
            <Diff text={state.working} />
          </p>
        )}
        <div class="in-flow-actions">
          <button
            type="button"
            class="btn-press"
            disabled={
              props.stale ||
              state.applying ||
              !completeSentence(state.working) ||
              state.working === props.sentence
            }
            onClick$={async () => {
              state.applying = true;
              const used = await inFlowController()?.applyVariant(
                state.working.trim(),
              );
              state.applying = false;
              if (!used)
                state.message =
                  "The wording could not be used. Check the bench notice and try again.";
            }}
          >
            {state.applying ? "Checking…" : "Use this wording"}
          </button>
          <button
            type="button"
            class="btn-paper in-flow-mini"
            disabled={state.working === props.sentence}
            onClick$={() => {
              state.working = props.sentence;
              inFlowController()?.previewVariant(null);
            }}
          >
            Keep original
          </button>
        </div>
        <p class="sentence-bench-note">
          Use a complete sentence. Undo restores the wording or position.
        </p>
        {state.message && (
          <p class="sentence-bench-notice" role="status">
            {state.message}
          </p>
        )}
      </section>
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
            props.context?.before ? `Before: ${props.context.before}` : "",
            props.context?.after ? `After: ${props.context.after}` : "",
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
    </div>
  );
});
