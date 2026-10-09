import {
  $,
  component$,
  useStore,
  useStylesScoped$,
  useTask$,
  useVisibleTask$,
  type QRL,
} from "@qwik.dev/core";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { loadAiSettingsFromIdb, loadPersonasFromIdb } from "../../utils/idb";
import { PERSONAS } from "../../utils/personas";
import {
  askJudgement,
  describeJudgement,
  normalizeEndpointUrl,
} from "../../utils/judgement-client";
import {
  backOffSystemOne,
  spendSystemOne,
  systemOneWait,
} from "../../utils/system-one-budget";
import {
  buildInstrumentRoomRequest,
  instrumentRoomCast,
  instrumentRoomContextKey,
  requestInstrumentRoomComment,
  selectInstrumentRoomEditor,
  type InstrumentRoomContext,
  type InstrumentRoomRequest,
  type InstrumentRoomResult,
  type InstrumentRoomSelection,
} from "../../utils/instrument-room";
import type { Persona } from "../../types";
import { PersonaMasthead } from "../personas/persona-portrait";
import styles from "./instrument-room.css?inline";

export interface InstrumentRoomProps {
  context: InstrumentRoomContext;
  onAsk$: QRL<
    (
      request: InstrumentRoomRequest,
    ) => InstrumentRoomResult | Promise<InstrumentRoomResult>
  >;
  disabled?: boolean;
}

export const InstrumentRoom = component$<InstrumentRoomProps>((props) => {
  useStylesScoped$(styles);
  const auth = useAuth(),
    client = useConvexClient();
  const state = useStore({
    cast: [] as Persona[],
    loaded: false,
    loadError: "",
    busy: false,
    generation: 0,
    manual: "",
    notice: "",
    selected: "",
    provenance: "",
    resultKey: "",
    account: null as string | null,
    selection: null as InstrumentRoomSelection | null,
  });
  const contextKey = instrumentRoomContextKey(props.context);
  // Context changes invalidate outstanding requests; this task never calls a model.
  useTask$(({ track }) => {
    track(() => instrumentRoomContextKey(props.context));
    track(() => props.disabled);
    track(() => auth.value.user?.id ?? null);
    state.generation++;
    state.busy = false;
    state.notice = "";
    state.selection = null;
    state.selected = "";
    state.resultKey = "";
  });
  // Only local cast data loads on mount. Selection and comment calls require a button press.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    let alive = true;
    void loadPersonasFromIdb()
      .then((saved) => {
        if (!alive) return;
        state.cast = saved.length ? saved : PERSONAS;
        state.loaded = true;
      })
      .catch(() => {
        if (!alive) return;
        state.loaded = true;
        state.loadError =
          "The current cast could not be loaded. Reopen this instrument before inviting an editor.";
      });
    cleanup(() => {
      alive = false;
      state.generation++;
    });
  });

  const invite = $(async (manual: boolean) => {
    if (props.disabled || state.busy) return;
    state.notice = "";
    state.selection = null;
    state.selected = "";
    state.provenance = "";
    state.resultKey = "";
    const generation = ++state.generation;
    const account = auth.value.user?.id ?? null;
    const context = instrumentRoomContextKey(props.context);
    const manualId = state.manual;
    const active = () =>
      generation === state.generation &&
      !props.disabled &&
      account === (auth.value.user?.id ?? null) &&
      context === instrumentRoomContextKey(props.context) &&
      (!manual || state.manual === manualId);
    state.busy = true;
    try {
      const [savedCast, settings] = await Promise.all([
        loadPersonasFromIdb(),
        loadAiSettingsFromIdb(),
      ]);
      if (!active()) return;
      const cast = savedCast.length ? savedCast : PERSONAS;
      state.cast = cast;
      state.loaded = true;
      const prepared = buildInstrumentRoomRequest(props.context, cast);
      const castSnapshot = JSON.stringify(cast),
        settingsSnapshot = JSON.stringify(settings);
      const current = async () => {
        if (!active()) return false;
        const [latestCast, latestSettings] = await Promise.all([
          loadPersonasFromIdb(),
          loadAiSettingsFromIdb(),
        ]);
        return (
          active() &&
          JSON.stringify(latestCast.length ? latestCast : PERSONAS) ===
            castSnapshot &&
          JSON.stringify(latestSettings) === settingsSnapshot
        );
      };
      let personaId = manualId;
      if (!manual) {
        const judgement = settings?.judgement ?? null;
        const endpoint = judgement?.source === "endpoint";
        if (
          endpoint
            ? !normalizeEndpointUrl(judgement.endpointUrl)
            : !account || !client.value
        ) {
          state.notice =
            "Editor selection needs a reachable judgement model. Sign in or configure an endpoint in Settings, or choose an editor yourself.";
          return;
        }
        if (
          judgement?.source === "typesafe" &&
          !judgement.typesafeKey?.trim()
        ) {
          state.notice =
            "Add your TypeSafe key in Settings, or choose an editor yourself.";
          return;
        }
        const wait = systemOneWait();
        if (wait > 0) {
          state.notice = `The shared judgement budget is resting. Try again in ${Math.ceil(wait / 1000)} seconds, or choose an editor yourself.`;
          return;
        }
        if (!(await current())) {
          state.notice =
            "The passage, room or settings changed. Invite the room again.";
          return;
        }
        const latestWait = systemOneWait();
        if (latestWait > 0) {
          state.notice = `The shared judgement budget is resting. Try again in ${Math.ceil(latestWait / 1000)} seconds, or choose an editor yourself.`;
          return;
        }
        spendSystemOne();
        const selection = await selectInstrumentRoomEditor(
          prepared,
          (input) => askJudgement(client.value, input, judgement),
          current,
        );
        if (!active()) return;
        if (selection.status === "stale") {
          state.notice =
            selection.message ?? "The room changed. Invite it again.";
          return;
        }
        state.selection = selection;
        state.resultKey = context;
        state.account = account;
        state.provenance = selection.model ?? describeJudgement(judgement);
        if (selection.status === "none") {
          state.selected = "";
          state.notice =
            "The judgement model selected no editor for this question. No comment was requested. You can still choose an editor yourself.";
          return;
        }
        if (selection.status !== "selected") {
          state.notice =
            selection.message ?? "No valid editor selection was returned.";
          backOffSystemOne();
          return;
        }
        personaId = selection.personaId!;
      }
      const editor = prepared.cast.find(
        (candidate) => candidate.id === personaId,
      );
      if (!editor) {
        state.notice = "Choose an editor from the current cast before asking.";
        return;
      }
      if (!(await current())) {
        state.notice =
          "The passage, room or settings changed. Invite an editor again.";
        return;
      }
      state.selected = editor.id;
      state.provenance = manual ? "Your choice" : state.provenance;
      state.resultKey = context;
      state.account = account;
      const result = await requestInstrumentRoomComment(
        prepared,
        editor.id,
        props.onAsk$,
        current,
        manual ? undefined : (state.selection ?? undefined),
      );
      if (active())
        state.notice =
          result.message ??
          (result.ok
            ? "The question was sent to Marginalia. Read the editor's contribution there."
            : "The question could not be sent. Try again from the current passage.");
    } catch (error) {
      if (active())
        state.notice =
          error instanceof Error
            ? error.message
            : "The room invitation could not finish.";
    } finally {
      if (generation === state.generation) state.busy = false;
    }
  });
  let cast: ReturnType<typeof instrumentRoomCast> = [];
  let castError = state.loadError;
  if (state.loaded && !castError) {
    try {
      cast = instrumentRoomCast(state.cast);
    } catch (error) {
      castError =
        error instanceof Error
          ? error.message
          : "The current cast could not be read.";
    }
  }
  const resultCurrent =
    state.resultKey === contextKey &&
    state.account === (auth.value.user?.id ?? null);
  const selected = resultCurrent
    ? cast.find((editor) => editor.id === state.selected)
    : undefined;
  return (
    <section class="instrument-room" aria-label="Ask the editorial room">
      <p class="instrument-room__title">A question for the room</p>
      <p class="instrument-room__question">{props.context.question}</p>
      <div class="instrument-room__actions">
        <button
          type="button"
          class="btn-paper in-flow-mini"
          disabled={
            props.disabled || state.busy || !state.loaded || !!castError
          }
          onClick$={() => invite(false)}
        >
          {state.busy ? "Inviting…" : "Ask the room"}
        </button>
        <span class="instrument-room__note">
          Your judgement model chooses one editor, or no one.
        </span>
      </div>
      <p class="instrument-room__note">
        Ask the room sends this source and proposal to your selected judgement
        service, then the selected writer model. Provider settings govern
        charges.
      </p>
      <details class="instrument-room__manual">
        <summary>Choose an editor</summary>
        <p class="instrument-room__note">
          Your choice, without model selection. Every current editor can
          comment. This sends the source and proposal only to the selected
          writer model; provider settings govern charges.
        </p>
        <label>
          Editor for this question
          <select
            value={state.manual}
            disabled={props.disabled || state.busy || !cast.length}
            onChange$={(_, el) => {
              state.manual = el.value;
              state.generation++;
              state.selection = null;
              state.selected = "";
              state.notice = "";
            }}
          >
            <option value="">Choose an editor…</option>
            {cast.map((editor) => (
              <option key={editor.id} value={editor.id}>
                {`${editor.name} · ${editor.role}`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="btn-paper in-flow-mini"
          disabled={
            props.disabled ||
            state.busy ||
            !state.manual ||
            !cast.some((editor) => editor.id === state.manual)
          }
          onClick$={() => invite(true)}
        >
          Ask chosen editor
        </button>
      </details>
      {selected && (
        <div class="instrument-room__selected">
          <PersonaMasthead
            personaId={selected.id}
            name={selected.name}
            role={selected.role}
            label={
              state.provenance === "Your choice"
                ? "Chosen by you"
                : `Selected by ${state.provenance}`
            }
            size={56}
          />
        </div>
      )}
      {resultCurrent && state.selection?.probabilities && (
        <details class="instrument-room__distribution">
          <summary>Inspect selection distribution</summary>
          <p class="instrument-room__note">
            {state.provenance} · confidence{" "}
            {state.selection.confidence?.toFixed(3)}. Distribution weights
            compare editors; they do not verify a contribution's quality.
          </p>
          <dl>
            {Object.entries(state.selection.probabilities).map(
              ([choice, probability]) => {
                const at = Number(choice.replace("editor-", ""));
                const editor = choice === "none" ? undefined : cast[at];
                return (
                  <div key={choice}>
                    <dt>{editor ? editor.name : "No editor"}</dt>
                    <dd>{probability.toFixed(3)}</dd>
                  </div>
                );
              },
            )}
          </dl>
        </details>
      )}
      <details class="instrument-room__context">
        <summary>Inspect this invitation</summary>
        <p class="instrument-room__note">Current source</p>
        <blockquote>{props.context.source}</blockquote>
        {props.context.proposal?.trim() && (
          <>
            <p class="instrument-room__note">
              Unapplied proposal · comparison only
            </p>
            <blockquote>{props.context.proposal}</blockquote>
          </>
        )}
        {props.context.detail && (
          <p class="instrument-room__note">{props.context.detail}</p>
        )}
      </details>
      {(castError || state.notice) && (
        <p class="instrument-room__notice" role="status">
          {castError || state.notice}
        </p>
      )}
    </section>
  );
});
