import {
  component$,
  useStore,
  useStylesScoped$,
  $,
  type QRL,
} from "@qwik.dev/core";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { askJudgement } from "../../utils/judgement-client";
import {
  systemOneWait,
  spendSystemOne,
  backOffSystemOne,
} from "../../utils/system-one-budget";
import {
  buildEntityInstrumentRequest,
  classifyEntityInstrument,
  type EntityInstrumentIndex,
  type EntityInstrumentResult,
  type EntityReadingKind,
  type EntityEvidence,
} from "../../utils/entity-instrument";
import styles from "./entity-instrument.css?inline";

export interface EntityInstrumentProps {
  index: EntityInstrumentIndex;
  contextKey: string;
  context?: string;
  /** Parent verifies exact current document text before jumping. */
  onJump$?: QRL<(span: EntityEvidence, indexKey: string) => void>;
}
export const EntityInstrument = component$<EntityInstrumentProps>((props) => {
  useStylesScoped$(styles);
  const client = useConvexClient(),
    auth = useAuth();
  const state = useStore<{
    selected: string;
    kind: EntityReadingKind;
    attribute: string;
    busy: boolean;
    notice: string;
    generation: number;
    account: string | null;
    result: EntityInstrumentResult | null;
  }>({
    selected: "",
    kind: "relationship",
    attribute: "",
    busy: false,
    notice: "",
    generation: 0,
    account: null,
    result: null,
  });
  const selectedId = props.index.candidates.some(
    (candidate) => candidate.id === state.selected,
  )
    ? state.selected
    : (props.index.candidates[0]?.id ?? "");
  const selected = props.index.candidates.find(
    (candidate) => candidate.id === selectedId,
  );
  let requestKey = "";
  try {
    requestKey = buildEntityInstrumentRequest(
      props.index,
      selectedId,
      state.kind,
      props.contextKey,
      props.context ?? "",
      state.attribute,
    ).key;
  } catch {
    /* Prerequisites appear alongside the input. */
  }
  const currentResult =
    state.result?.key === requestKey &&
    state.account === (auth.value.user?.id ?? null)
      ? state.result
      : null;
  const read = $(async () => {
    state.notice = "";
    if (systemOneWait() > 0) {
      state.notice =
        "The shared judgement budget is resting. Try again shortly.";
      return;
    }
    let request;
    try {
      request = buildEntityInstrumentRequest(
        props.index,
        selectedId,
        state.kind,
        props.contextKey,
        props.context ?? "",
        state.attribute,
      );
    } catch (error) {
      state.notice =
        error instanceof Error
          ? error.message
          : "Choose the source context first.";
      return;
    }
    if (!request.specs.length) {
      state.notice =
        "There are no eligible source pairs or dialogue spans for this reading. Try another entity or task.";
      return;
    }
    const generation = ++state.generation,
      account = auth.value.user?.id ?? null;
    const selection = selectedId,
      kind = state.kind,
      attribute = state.attribute,
      context = props.context ?? "";
    const current = () =>
      generation === state.generation &&
      account === (auth.value.user?.id ?? null) &&
      props.index.key === request.indexKey &&
      props.contextKey === request.contextKey &&
      (props.context ?? "") === context &&
      (state.selected || props.index.candidates[0]?.id) === selection &&
      state.kind === kind &&
      state.attribute === attribute;
    state.busy = true;
    spendSystemOne();
    const result = await classifyEntityInstrument(
      request,
      (input) => askJudgement(client.value, input),
      current,
    );
    if (current()) {
      state.result = result;
      state.account = account;
      state.notice = result
        ? request.excluded
          ? `${request.excluded} additional comparisons were outside this bounded reading.`
          : ""
        : "The selected judgement model could not return this reading. Source presence remains available locally.";
      if (!result) backOffSystemOne();
    }
    if (generation === state.generation) state.busy = false;
  });
  return (
    <section class="entity-instrument" aria-label="Entity instrument">
      <h2>Follow an entity through the piece</h2>
      <p>
        Name candidates and mentions come from code. They may include places or
        ordinary capitalised words; they are not confirmed characters.
      </p>
      {!selected ? (
        <p>No name candidates were found in the indexed passage.</p>
      ) : (
        <>
          <label>
            Entity candidate
            <select
              value={selectedId}
              onChange$={(_, el) => {
                state.selected = el.value;
                state.generation++;
                state.busy = false;
                state.result = null;
              }}
            >
              {props.index.candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {`${candidate.name} · ${candidate.mentions.length} mentions`}
                </option>
              ))}
            </select>
          </label>
          <h3>Presence · code</h3>
          <div class="entity-presence">
            {props.index.sections.map((section, at) => (
              <div key={section.index}>
                <span>{section.title}</span>
                <strong>{selected.counts[at] ?? 0}</strong>
              </div>
            ))}
          </div>
          {selected.variants.length > 0 && (
            <p>
              Spelling variants: {selected.variants.join(", ")}. Grouping is a
              spelling heuristic.
            </p>
          )}
          <details>
            <summary>Inspect source passages</summary>
            {props.index.evidence
              .filter(
                (span) =>
                  span.kind === "passage" &&
                  span.entityIds.includes(selectedId),
              )
              .map((span) => (
                <div key={span.id} class="entity-source">
                  <button
                    type="button"
                    disabled={!props.onJump$}
                    onClick$={() => props.onJump$?.(span, props.index.key)}
                  >
                    ¶{span.paragraph} · jump to exact source
                  </button>
                  <blockquote>{span.text}</blockquote>
                </div>
              ))}
          </details>
          <label>
            Reading
            <select
              value={state.kind}
              onChange$={(_, el) => {
                state.kind = el.value as EntityReadingKind;
                state.generation++;
                state.busy = false;
              }}
            >
              {["relationship", "continuity", "attribution"].map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "relationship"
                    ? "Relationships by section"
                    : kind === "continuity"
                      ? "Attribute continuity"
                      : "Blind dialogue attribution"}
                </option>
              ))}
            </select>
          </label>
          {state.kind === "continuity" && (
            <label>
              Attribute to compare
              <input
                value={state.attribute}
                maxLength={200}
                placeholder="Age, eye colour, coat…"
                onInput$={(_, el) => {
                  state.attribute = el.value;
                  state.generation++;
                  state.busy = false;
                }}
              />
            </label>
          )}
          <p class="entity-note">
            {state.kind === "attribution"
              ? "Only the literal utterance and brief go to this blind reading; speaker tags are withheld. Unknown is a valid answer. This is a voice comparison, not a distinctness or accuracy grade."
              : state.kind === "continuity"
                ? "The model compares adjacent passages for the named attribute. A potential contradiction is a lead for you to inspect, not a verified factual error."
                : "Pairs must occur in the same paragraph. The model reads up to three exact passages per section; co-presence alone does not establish a relationship."}
          </p>
          <button
            type="button"
            disabled={state.busy || !requestKey}
            onClick$={read}
          >
            {state.busy
              ? "Reading selected evidence…"
              : "Read with judgement model"}
          </button>
          {currentResult?.readings.map((reading) => (
            <article class="entity-reading" key={reading.id}>
              <h3>{reading.choice}</h3>
              <p class="entity-note">
                {reading.model} · {Math.round(reading.probability * 100)}%
                distribution weight. Concentration is not correctness.
              </p>
              <p>
                {reading.entityIds
                  .map(
                    (id) =>
                      props.index.candidates.find(
                        (candidate) => candidate.id === id,
                      )?.name ?? "Unknown",
                  )
                  .join(" / ")}
              </p>
              <details>
                <summary>Full distribution and exact evidence</summary>
                {Object.entries(reading.probabilities).map(
                  ([label, probability]) => (
                    <div class="entity-probability" key={label}>
                      <span>{label}</span>
                      <span>{Math.round(probability * 100)}%</span>
                    </div>
                  ),
                )}
                {reading.evidenceIds.map((id) => {
                  const span = props.index.evidence.find(
                    (evidence) => evidence.id === id,
                  );
                  return span ? (
                    <div class="entity-source" key={id}>
                      <button
                        type="button"
                        disabled={!props.onJump$}
                        onClick$={() => props.onJump$?.(span, props.index.key)}
                      >
                        ¶{span.paragraph} · exact source
                      </button>
                      <blockquote>{span.text}</blockquote>
                    </div>
                  ) : null;
                })}
              </details>
            </article>
          ))}
        </>
      )}
      {props.index.limited && (
        <p role="status">
          The local index is bounded to 80 KB of text, 60 candidates and 240
          evidence spans. This is a partial view.
        </p>
      )}
      {state.notice && <p role="status">{state.notice}</p>}
    </section>
  );
});
