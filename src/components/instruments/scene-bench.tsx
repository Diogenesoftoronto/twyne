import {
  component$,
  useComputed$,
  useStore,
  useStyles$,
  useVisibleTask$,
  type QRL,
} from "@qwik.dev/core";
import type {
  JudgementRequest,
  JudgementResult,
} from "../../utils/judgement-client";
import {
  createSceneInventory,
  createSceneJudgementRequest,
  createSceneMediaBrief,
  loadSceneProposals,
  resolveSceneJudgement,
  saveSceneProposals,
  SCENE_DIMENSIONS,
  SCENE_TENSION_LABELS,
  sceneSnapshotMatches,
  scenePassageKey,
  sceneSpanMatches,
  sceneSpeechId,
  type SceneAssessment,
  type SceneDimension,
  type SceneMedium,
  type ScenePassage,
  type SceneProposal,
  type SceneSpan,
} from "../../utils/scene-bench";
import { useSpeechPlayer } from "../../utils/use-speech-player";
import { InstrumentArt, InstrumentRule } from "./instrument-art";
import { InstrumentMotion, InstrumentMotionPart } from "./instrument-motion";
import styles from "./scene-bench.css?inline";

export interface SceneProviderCapability {
  available: boolean;
  /** Show the actual chosen provider/endpoint; never pass a credential. */
  destination: string;
  /** Current price, a budget, or an honest statement that the price is unknown. */
  costLabel: string;
  unavailableReason?: string;
}

export interface SceneBenchProps {
  passage: ScenePassage;
  quiet?: boolean;
  onLocate$?: QRL<
    (span: SceneSpan, passage: ScenePassage) => void | Promise<void>
  >;
  judgement?: SceneProviderCapability;
  onJudge$?: QRL<(request: JudgementRequest) => Promise<JudgementResult>>;
  narration?: SceneProviderCapability;
  /** Delegate to startSceneNarration(passage, { client, signedIn }). */
  onRead$?: QRL<(passage: ScenePassage) => Promise<void>>;
}

function canRequest(capability: SceneProviderCapability | undefined): boolean {
  return (
    !!capability?.available &&
    !!capability.destination.trim() &&
    !!capability.costLabel.trim()
  );
}

export const SceneBench = component$<SceneBenchProps>((props) => {
  useStyles$(styles);
  const inventory = useComputed$(() => createSceneInventory(props.passage));
  const speech = useSpeechPlayer();
  const ui = useStore({
    busy: false,
    error: "",
    assessment: null as SceneAssessment | null,
    notesKey: "",
    proposals: [] as SceneProposal[],
    draft: "",
    dimension: "light" as SceneDimension,
    notesReady: false,
    saving: false,
    noteMessage: "",
    removedIdeas: null as SceneProposal[] | null,
    medium: "image" as SceneMedium,
    brief: "",
    briefPassage: null as ScenePassage | null,
    copied: false,
  });

  // Load only when the selected passage changes; this is not a keystroke listener.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const snapshot = track(() => inventory.value);
    let disposed = false;
    cleanup(() => {
      disposed = true;
    });
    ui.notesReady = false;
    ui.notesKey = snapshot.key;
    ui.proposals = [];
    ui.draft = "";
    ui.noteMessage = "";
    ui.error = "";
    ui.removedIdeas = null;
    if (snapshot.status !== "ready") return;
    try {
      const proposals = await loadSceneProposals(snapshot.passage);
      if (!disposed && sceneSnapshotMatches(snapshot, props.passage)) {
        ui.proposals = proposals;
        ui.notesReady = true;
      }
    } catch {
      if (!disposed)
        ui.noteMessage =
          "Local idea storage is unavailable. You can still inspect this passage.";
    }
  });

  const current = inventory.value;
  const assessment =
    ui.assessment && sceneSnapshotMatches(ui.assessment, props.passage)
      ? ui.assessment
      : null;
  const proposals = ui.notesKey === current.key ? ui.proposals : [];
  const activeSpeech =
    speech.state.id === sceneSpeechId(props.passage) &&
    ["loading", "playing", "paused"].includes(speech.state.status);
  const briefCurrent =
    ui.briefPassage &&
    sceneSnapshotMatches({ passage: ui.briefPassage }, props.passage);

  return (
    <InstrumentMotion
      state={assessment ? "arrive" : "rest"}
      quiet={props.quiet}
      class="scene-bench"
    >
      <header class="scene-bench__head">
        <InstrumentArt kind="scene" size="compact" />
        <div>
          <h2>Scene bench</h2>
          <p>See what the passage gives you, then try an idea.</p>
        </div>
      </header>
      {current.status !== "ready" ? (
        <p class="scene-bench__notice">{current.reason}</p>
      ) : (
        <>
          <details class="scene-bench__source">
            <summary>
              Selected passage · {current.spans.length}{" "}
              {current.spans.length === 1 ? "sentence" : "sentences"}
            </summary>
            <blockquote>{props.passage.text}</blockquote>
          </details>
          <p class="scene-bench__method">
            Local English cue scan. A quoted cue is evidence to inspect; an
            unlisted detail may still be present.
          </p>
          <dl class="scene-bench__inventory">
            {SCENE_DIMENSIONS.map(({ id, label }) => {
              const model = assessment?.dimensions[id];
              const selected =
                model?.state === "selected"
                  ? current.spans.find((span) => span.id === model.spanId)
                  : null;
              const local = current.dimensions[id];
              const spans = selected
                ? [selected]
                : local
                    .slice(0, 2)
                    .flatMap((cue) =>
                      current.spans.filter((span) => span.id === cue.spanId),
                    );
              return (
                <div
                  key={id}
                  class="scene-bench__dimension"
                  data-scene-dimension={id}
                >
                  <dt>{label}</dt>
                  <dd>
                    {spans.map((span) => (
                      <div class="scene-bench__evidence" key={span.id}>
                        <blockquote>{span.text}</blockquote>
                        <div class="scene-bench__evidence-foot">
                          <span>
                            {selected
                              ? `${assessment!.model} selection`
                              : `Local cue: “${local.find((cue) => cue.spanId === span.id)?.cue ?? ""}”`}
                          </span>
                          {props.onLocate$ && (
                            <button
                              type="button"
                              onClick$={async () => {
                                if (sceneSpanMatches(span, props.passage))
                                  await props.onLocate$?.(span, props.passage);
                              }}
                            >
                              Find in passage
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {!spans.length && (
                      <p class="scene-bench__unidentified">
                        No cue identified locally.
                      </p>
                    )}
                    {local.length > 2 && !selected && (
                      <p class="scene-bench__method">
                        Showing 2 of {local.length} local cues.
                      </p>
                    )}
                    {model?.state === "uncertain" && (
                      <p class="scene-bench__method">
                        The model reading was uncertain; local cues remain for
                        inspection.
                      </p>
                    )}
                    {model?.state === "not-identified" && (
                      <p class="scene-bench__method">
                        The model did not identify explicit evidence for this
                        dimension.
                      </p>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          <details class="scene-bench__provider">
            <summary>Ask for a model reading</summary>
            <p>
              Selects evidence and reads the scene's pressure. It does not
              rewrite or add scene details.
            </p>
            <p class="scene-bench__method">
              {canRequest(props.judgement) && props.onJudge$
                ? `Sends this selected passage to ${props.judgement!.destination}. ${props.judgement!.costLabel}`
                : (props.judgement?.unavailableReason ??
                  "No judgement provider is connected here. The local inventory remains available.")}
            </p>
            <button
              type="button"
              disabled={
                ui.busy || !canRequest(props.judgement) || !props.onJudge$
              }
              onClick$={async () => {
                if (!props.onJudge$ || !canRequest(props.judgement) || ui.busy)
                  return;
                const snapshot = createSceneInventory(props.passage);
                const request = createSceneJudgementRequest(snapshot);
                if (!request) return;
                ui.busy = true;
                ui.error = "";
                try {
                  const result = resolveSceneJudgement(
                    snapshot,
                    await props.onJudge$(request),
                    props.passage,
                  );
                  if (result.ok) ui.assessment = result.assessment;
                  else
                    ui.error =
                      result.reason === "stale"
                        ? "The passage changed while the model read it. Ask again for this version."
                        : "The model did not return a usable reading. The local inventory is still available.";
                } catch {
                  ui.error =
                    "The model reading is unavailable. The local inventory is still available.";
                } finally {
                  ui.busy = false;
                }
              }}
            >
              {ui.busy ? "Reading the passage…" : "Read the scene with a model"}
            </button>
          </details>
          {ui.error && (
            <p class="scene-bench__notice" role="status">
              {ui.error}
            </p>
          )}
          {ui.assessment && !assessment && (
            <p class="scene-bench__notice">
              The previous model reading belongs to an earlier selection.
            </p>
          )}
          {assessment && (
            <InstrumentMotionPart part="result" class="scene-bench__reading">
              <InstrumentRule />
              <h3>
                {assessment.tension.uncertain
                  ? "The scene pressure is uncertain"
                  : SCENE_TENSION_LABELS[assessment.tension.choice]}
              </h3>
              <p class="scene-bench__method">
                {assessment.model} reading ·{" "}
                {Math.round(assessment.tension.probability * 100)}% probability
                for this interpretation. This is not a writing grade.
              </p>
            </InstrumentMotionPart>
          )}

          <section
            class="scene-bench__section"
            aria-label="Read the scene aloud"
          >
            <h3>Hear the passage</h3>
            <p class="scene-bench__method">
              {canRequest(props.narration) && props.onRead$
                ? `Reads this selected text using ${props.narration!.destination}. ${props.narration!.costLabel}`
                : (props.narration?.unavailableReason ??
                  "Connect a narration provider to hear this passage. No audio request has been made.")}
            </p>
            <div class="scene-bench__actions">
              <button
                type="button"
                disabled={
                  activeSpeech
                    ? speech.state.status === "loading"
                    : !canRequest(props.narration) || !props.onRead$
                }
                onClick$={async () => {
                  if (activeSpeech) {
                    await speech.toggle$();
                    return;
                  }
                  if (!props.onRead$ || !canRequest(props.narration)) return;
                  ui.error = "";
                  try {
                    await props.onRead$(props.passage);
                  } catch {
                    ui.error =
                      "The scene could not be read aloud. Check the narration provider and try again.";
                  }
                }}
              >
                {activeSpeech
                  ? speech.state.status === "loading"
                    ? "Preparing voice…"
                    : speech.state.status === "playing"
                      ? "Pause reading"
                      : "Resume reading"
                  : "Read scene aloud"}
              </button>
              {activeSpeech && (
                <button type="button" onClick$={speech.stop$}>
                  Stop reading
                </button>
              )}
            </div>
          </section>

          <section
            class="scene-bench__section"
            aria-label="Proposed scene details"
          >
            <h3>Try a detail</h3>
            <p class="scene-bench__method">
              Your ideas stay separate from the manuscript. Saved on this device
              for this exact selection.
            </p>
            {proposals.length > 0 && (
              <ul class="scene-bench__ideas">
                {proposals.map((proposal, i) => (
                  <li key={`${i}:${proposal.text}`}>
                    <strong>
                      {
                        SCENE_DIMENSIONS.find(
                          ({ id }) => id === proposal.dimension,
                        )?.label
                      }
                    </strong>
                    <p>{proposal.text}</p>
                    <span class="scene-bench__method">
                      Your proposed addition
                    </span>
                    <button
                      type="button"
                      class="scene-bench__remove"
                      disabled={ui.saving}
                      aria-label={`Remove idea ${i + 1}`}
                      onClick$={async () => {
                        const passage = { ...props.passage };
                        if (
                          ui.saving ||
                          ui.notesKey !== scenePassageKey(passage) ||
                          ui.proposals[i]?.text !== proposal.text
                        )
                          return;
                        const previous = [...ui.proposals];
                        const next = ui.proposals.filter(
                          (_, index) => index !== i,
                        );
                        ui.saving = true;
                        try {
                          await saveSceneProposals(passage, next);
                          if (
                            sceneSnapshotMatches({ passage }, props.passage)
                          ) {
                            ui.proposals = next;
                            ui.removedIdeas = previous;
                            ui.brief = "";
                            ui.noteMessage = "Idea removed.";
                          }
                        } catch {
                          ui.noteMessage =
                            "The idea could not be removed. It is still saved.";
                        } finally {
                          ui.saving = false;
                        }
                      }}
                    >
                      Remove idea
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label class="scene-bench__field">
              Explore
              <select
                value={ui.dimension}
                onChange$={(_, element) => {
                  ui.dimension = element.value as SceneDimension;
                }}
              >
                {SCENE_DIMENSIONS.map(({ id, label }) => (
                  <option value={id} key={id} selected={ui.dimension === id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label class="scene-bench__field">
              An idea to try
              <textarea
                value={ui.draft}
                maxLength={600}
                rows={3}
                placeholder="For example: a lamp flickering in the window."
                onInput$={(_, element) => {
                  ui.draft = element.value;
                }}
              />
            </label>
            <button
              type="button"
              disabled={
                !ui.draft.trim() ||
                ui.saving ||
                !ui.notesReady ||
                proposals.length >= 12
              }
              onClick$={async () => {
                if (
                  !ui.draft.trim() ||
                  ui.saving ||
                  !ui.notesReady ||
                  ui.notesKey !== scenePassageKey(props.passage) ||
                  ui.proposals.length >= 12
                )
                  return;
                const passage = { ...props.passage };
                const next: SceneProposal[] = [
                  ...ui.proposals,
                  {
                    dimension: ui.dimension,
                    text: ui.draft.trim(),
                    origin: "writer",
                  },
                ];
                ui.saving = true;
                try {
                  await saveSceneProposals(passage, next);
                  if (sceneSnapshotMatches({ passage }, props.passage)) {
                    ui.proposals = next;
                    ui.removedIdeas = null;
                    ui.draft = "";
                    ui.noteMessage =
                      "Idea saved on this device. The manuscript is unchanged.";
                    ui.brief = "";
                  }
                } catch {
                  ui.noteMessage =
                    "The idea could not be saved locally. It is still in the field.";
                } finally {
                  ui.saving = false;
                }
              }}
            >
              {ui.saving ? "Saving idea…" : "Save this idea"}
            </button>
            {proposals.length >= 12 && (
              <p class="scene-bench__method">
                Twelve ideas are saved for this selection. Remove an idea to
                collect another.
              </p>
            )}
            {ui.noteMessage && (
              <p class="scene-bench__method" role="status">
                {ui.noteMessage}
              </p>
            )}
            {ui.removedIdeas && (
              <button
                type="button"
                disabled={ui.saving}
                onClick$={async () => {
                  const passage = { ...props.passage };
                  if (
                    ui.saving ||
                    !ui.removedIdeas ||
                    ui.notesKey !== scenePassageKey(passage)
                  )
                    return;
                  const restored = [...ui.removedIdeas];
                  ui.saving = true;
                  try {
                    await saveSceneProposals(passage, restored);
                    if (sceneSnapshotMatches({ passage }, props.passage)) {
                      ui.proposals = restored;
                      ui.removedIdeas = null;
                      ui.brief = "";
                      ui.noteMessage = "Idea restored.";
                    }
                  } catch {
                    ui.noteMessage =
                      "The idea could not be restored. Try again.";
                  } finally {
                    ui.saving = false;
                  }
                }}
              >
                Undo removal
              </button>
            )}
          </section>

          <section
            class="scene-bench__section"
            aria-label="Prepare a media brief"
          >
            <h3>Explore an image, sound, or movement</h3>
            <p class="scene-bench__method">
              Media generation is not connected to this instrument. Preparing a
              brief stays on this device, sends nothing, and incurs no
              generation charge.
            </p>
            <div class="scene-bench__actions">
              {(["image", "sound", "motion"] as const).map((medium) => (
                <button
                  type="button"
                  key={medium}
                  onClick$={() => {
                    const snapshot = createSceneInventory(props.passage);
                    ui.medium = medium;
                    ui.brief =
                      createSceneMediaBrief(
                        snapshot,
                        medium,
                        ui.notesKey === snapshot.key ? ui.proposals : [],
                      ) ?? "";
                    ui.briefPassage = { ...props.passage };
                    ui.copied = false;
                  }}
                >
                  Prepare {medium} brief
                </button>
              ))}
            </div>
            {ui.brief && briefCurrent && (
              <div class="scene-bench__brief">
                <label class="scene-bench__field">
                  {ui.medium[0].toUpperCase() + ui.medium.slice(1)} brief
                  <textarea value={ui.brief} readOnly rows={8} />
                </label>
                <button
                  type="button"
                  onClick$={async () => {
                    try {
                      await navigator.clipboard.writeText(ui.brief);
                      ui.copied = true;
                    } catch {
                      ui.noteMessage =
                        "Copy is unavailable. Select the brief text and copy it with your keyboard.";
                    }
                  }}
                >
                  {ui.copied ? "Brief copied" : "Copy brief"}
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </InstrumentMotion>
  );
});
