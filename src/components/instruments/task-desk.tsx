import {
  component$,
  useStore,
  useSignal,
  useVisibleTask$,
  useStylesScoped$,
  $,
} from "@qwik.dev/core";
import {
  useAuth,
  hasAuthenticatedConvexIdentity,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import {
  accountKnowledgeSnapshot,
  subscribeAccountKnowledge,
  refreshAccountKnowledge,
  accountResources,
  chooseAccountSource,
  type AccountKnowledgeSnapshot,
  type AccountResource,
} from "../../utils/account-knowledge";
import {
  instrumentTaskRefs,
  safeInstrumentTaskError,
} from "../../utils/instrument-tasks";
import {
  instrumentContextIsStale,
  instrumentTaskCanCancel,
  type InstrumentTaskKind,
  type InstrumentSourceRef,
  type InstrumentTaskView,
} from "../../utils/instrument-tasks-model";
import type { Id } from "../../../convex/_generated/dataModel";
import styles from "./task-desk.css?inline";
import { InstrumentIntentField } from "./instrument-intent-field";

export interface TaskDeskProps {
  folioId: string;
  selectedText?: string;
}
/** Mount inside the existing AuthProvider and ConvexProvider. */
export const TaskDesk = component$((props: TaskDeskProps) => {
  useStylesScoped$(styles);
  const auth = useAuth();
  const client = useConvexClient();
  const text = useSignal(props.selectedText ?? "");
  const instruction = useSignal(
    "Review this passage for clarity and identify the most useful next revision.",
  );
  const kind = useSignal<InstrumentTaskKind>("writing-review");
  const sourceId = useSignal("");
  const state = useStore<{
    tasks: InstrumentTaskView[];
    snapshot: AccountKnowledgeSnapshot;
    resources: AccountResource[];
    selected: InstrumentSourceRef[];
    busy: boolean;
    error: string;
    request: string;
    comments: Record<string, string>;
    alive: boolean;
    version: number;
  }>({
    tasks: [],
    snapshot: {
      account: null,
      sources: [],
      choices: {},
      loading: false,
      error: "",
    },
    resources: [],
    selected: [],
    busy: false,
    error: "",
    request: "",
    comments: {},
    alive: false,
    version: 0,
  });
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const currentClient = track(() => client.value);
    const signedIn = track(() => hasAuthenticatedConvexIdentity(auth.value));
    const account = track(() => auth.value.user?.id);
    const folioId = track(() => props.folioId);
    const version = ++state.version;
    state.alive = true;
    state.tasks = [];
    state.selected = [];
    state.resources = [];
    state.comments = {};
    state.error = "";
    state.request = "";
    sourceId.value = "";
    const syncKnowledge = () => {
      if (!state.alive || state.version !== version) return;
      const next = accountKnowledgeSnapshot();
      if (state.snapshot.account !== next.account) {
        state.selected = [];
        state.resources = [];
        sourceId.value = "";
      }
      state.selected = state.selected.filter(
        (ref) =>
          next.choices[ref.sourceId]?.resources &&
          next.sources.some(
            (source) => source.id === ref.sourceId && source.resources_allowed,
          ),
      );
      state.snapshot = next;
    };
    syncKnowledge();
    const stopKnowledge = subscribeAccountKnowledge(syncKnowledge);
    const stopTasks =
      signedIn && currentClient && account
        ? currentClient.onUpdate(
            instrumentTaskRefs.list,
            { folioId },
            (rows) => {
              if (state.alive && state.version === version) state.tasks = rows;
            },
            (error) => {
              if (state.alive && state.version === version)
                state.error = safeInstrumentTaskError(error);
            },
          )
        : undefined;
    cleanup(() => {
      state.alive = false;
      stopKnowledge();
      stopTasks?.();
    });
  });
  const loadResources = $(async () => {
    const account = auth.value.user?.id;
    const source = sourceId.value;
    const version = state.version;
    state.busy = true;
    state.error = "";
    state.resources = [];
    try {
      const resources = await accountResources(source);
      if (
        state.alive &&
        state.version === version &&
        auth.value.user?.id === account &&
        sourceId.value === source
      )
        state.resources = resources;
    } catch {
      if (
        state.alive &&
        state.version === version &&
        auth.value.user?.id === account
      )
        state.error =
          "Enable resource access for this source in Account sources, then refresh and try again.";
    } finally {
      if (state.alive && state.version === version) state.busy = false;
    }
  });
  const queue = $(async () => {
    if (!client.value || !hasAuthenticatedConvexIdentity(auth.value)) return;
    const account = auth.value.user?.id;
    const version = state.version;
    state.busy = true;
    state.error = "";
    state.request ||= crypto.randomUUID();
    try {
      await client.value.mutation(instrumentTaskRefs.queue, {
        requestId: state.request,
        folioId: props.folioId,
        kind: kind.value,
        instruction: instruction.value,
        selectedText: text.value,
        sources: state.selected,
      });
      if (
        state.alive &&
        state.version === version &&
        auth.value.user?.id === account
      )
        state.request = "";
    } catch (error) {
      if (
        state.alive &&
        state.version === version &&
        auth.value.user?.id === account
      )
        state.error = safeInstrumentTaskError(error);
    } finally {
      if (state.alive && state.version === version) state.busy = false;
    }
  });
  const cancel = $(async (id: string) => {
    try {
      await client.value?.mutation(instrumentTaskRefs.cancel, {
        taskId: id as Id<"instrumentTasks">,
      });
    } catch (error) {
      state.error = safeInstrumentTaskError(error);
    }
  });
  const giveFeedback = $(
    async (id: string, verdict: "useful" | "not-useful") => {
      try {
        await client.value?.mutation(instrumentTaskRefs.feedback, {
          taskId: id as Id<"instrumentTasks">,
          verdict,
          comment: state.comments[id] ?? "",
        });
      } catch (error) {
        state.error = safeInstrumentTaskError(error);
      }
    },
  );
  const signedIn = hasAuthenticatedConvexIdentity(auth.value);
  return (
    <section class="task-desk" aria-label="Task desk">
      <header>
        <p class="dept-label">Writing instruments</p>
        <h2>Task desk</h2>
        <p>
          Choose a passage and a task. After your account accepts the queue
          request, work continues on the server and the result waits here when
          you return.
        </p>
      </header>
      {!signedIn && (
        <p class="task-notice">
          Sign in with Not Organic and sync this folio to queue durable tasks.
          Local browser work cannot continue after the tab closes.
        </p>
      )}
      <div class="task-form">
        <label>
          Task
          <select
            value={kind.value}
            onChange$={(_, el) => {
              kind.value = el.value as InstrumentTaskKind;
              state.request = "";
              instruction.value =
                kind.value === "source-research"
                  ? "Answer this passage's research question using the selected account resources. Identify missing evidence."
                  : "Review this passage for clarity and identify the most useful next revision.";
            }}
          >
            <option value="writing-review">Writing review</option>
            <option value="source-research">
              Research selected account resources
            </option>
          </select>
        </label>
        <label>
          Reference passage
          <textarea
            value={text.value}
            maxLength={20000}
            onInput$={(_, el) => {
              text.value = el.value;
              state.request = "";
            }}
          />
        </label>
        {props.selectedText && (
          <button
            type="button"
            onClick$={() => {
              text.value = props.selectedText ?? "";
              state.request = "";
            }}
          >
            Use current selected passage
          </button>
        )}
        <InstrumentIntentField
          value={instruction.value}
          contextKey={JSON.stringify([
            props.folioId,
            kind.value,
            text.value,
            state.selected,
          ])}
          label="What should this task do?"
          disabled={state.busy}
          onValue$={$((value) => {
            instruction.value = value;
            state.request = "";
          })}
        />
        <fieldset>
          <legend>Selected source scope</legend>
          <p class="task-small">
            Up to three resources shared with Twyne. Research uses these
            resources only. No web search or external tool calls are included.
          </p>
          <div class="task-actions">
            <button
              type="button"
              disabled={!signedIn || state.busy}
              onClick$={async () => {
                await refreshAccountKnowledge();
              }}
            >
              Refresh account sources
            </button>
            <a href="/settings">Manage account sources</a>
          </div>
          <label>
            Account source
            <select
              value={sourceId.value}
              onChange$={(_, el) => {
                sourceId.value = el.value;
                state.resources = [];
              }}
            >
              <option value="">Choose a resource-enabled source</option>
              {state.snapshot.sources
                .filter((source) => source.resources_allowed)
                .map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
            </select>
          </label>
          {sourceId.value && (
            <label class="resource-choice">
              <input
                type="checkbox"
                checked={
                  state.snapshot.choices[sourceId.value]?.resources === true
                }
                disabled={state.busy}
                onChange$={(_, el) => {
                  chooseAccountSource(sourceId.value, "resources", el.checked);
                  state.resources = [];
                  state.request = "";
                }}
              />
              Enable resource reading from this source in Twyne
            </label>
          )}
          {state.snapshot.error && (
            <p role="status" class="task-notice">
              {state.snapshot.error}
            </p>
          )}
          {state.snapshot.loading && (
            <p role="status">Refreshing shared sources…</p>
          )}
          <button
            type="button"
            disabled={
              !sourceId.value ||
              !state.snapshot.choices[sourceId.value]?.resources ||
              state.busy
            }
            onClick$={loadResources}
          >
            List resources
          </button>
          {state.resources.map((resource) => (
            <label class="resource-choice" key={resource.uri}>
              <input
                type="checkbox"
                checked={state.selected.some(
                  (ref) =>
                    ref.sourceId === sourceId.value && ref.uri === resource.uri,
                )}
                disabled={state.busy}
                onChange$={(_, el) => {
                  const chosenSource = state.snapshot.sources.find(
                    (source) => source.id === sourceId.value,
                  );
                  if (!chosenSource) return;
                  const existing = state.selected.filter(
                    (ref) =>
                      ref.sourceId !== chosenSource.id ||
                      ref.uri !== resource.uri,
                  );
                  if (el.checked && existing.length >= 3) {
                    state.error = "Choose up to three resources.";
                    el.checked = false;
                    return;
                  }
                  state.selected = el.checked
                    ? [
                        ...existing,
                        {
                          sourceId: chosenSource.id,
                          uri: resource.uri,
                          label: (resource.title ?? resource.name).slice(
                            0,
                            200,
                          ),
                        },
                      ]
                    : existing;
                  state.request = "";
                }}
              />
              {resource.title ?? resource.name}
            </label>
          ))}
          {state.selected.length > 0 && (
            <ul>
              {state.selected.map((ref) => (
                <li key={`${ref.sourceId}:${ref.uri}`}>
                  {ref.label} <span class="task-small">({ref.sourceId})</span>{" "}
                  <code class="task-small">{ref.uri}</code>{" "}
                  <button
                    type="button"
                    onClick$={() => {
                      state.selected = state.selected.filter(
                        (selected) =>
                          selected.sourceId !== ref.sourceId ||
                          selected.uri !== ref.uri,
                      );
                      state.request = "";
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        <p class="task-small">
          Uses your hosted Not Organic model and account credit. Suggestions
          remain proposals for your review.
        </p>
        <button
          class="btn-press"
          type="button"
          disabled={
            !signedIn ||
            !client.value ||
            state.busy ||
            !text.value.trim() ||
            !instruction.value.trim() ||
            (kind.value === "source-research" && !state.selected.length)
          }
          onClick$={queue}
        >
          {state.busy ? "Working…" : "Queue task"}
        </button>
        {state.error && (
          <p role="alert" class="task-notice">
            {state.error}
          </p>
        )}
      </div>
      <div aria-live="polite" aria-relevant="additions text">
        {state.tasks.length === 0 && signedIn && (
          <p>No tasks queued for this folio.</p>
        )}
        {state.tasks.map((task) => (
          <article class="task-card" key={task._id}>
            <div class="task-meta">
              <h3>
                {task.kind === "source-research"
                  ? "Account source research"
                  : "Writing review"}
              </h3>
              <span class="task-status">
                {task.status === "failed" && task.failureKind === "needs-input"
                  ? "Needs your attention"
                  : task.status === "failed" &&
                      task.failureKind === "provider-unavailable"
                    ? "Provider unavailable"
                    : task.status}
              </span>
            </div>
            <p>{task.instruction}</p>
            {instrumentTaskCanCancel(task.status) && (
              <div class="task-actions">
                <button type="button" onClick$={() => cancel(task._id)}>
                  Cancel task
                </button>
                <span class="task-small">
                  Cancellation discards an in-flight result; an already sent
                  provider request may finish.
                </span>
              </div>
            )}
            {task.error && <p class="task-notice">{task.error}</p>}
            {instrumentContextIsStale(
              task,
              props.selectedText ?? text.value,
            ) && (
              <p class="task-small">
                This task refers to an earlier passage snapshot. Review its
                saved context before using the result.
              </p>
            )}
            <details>
              <summary>Exact task context and source scope</summary>
              <blockquote>{task.selectedText}</blockquote>
              <p class="task-small">Passage fingerprint: {task.fingerprint}</p>
              {task.sources.length ? (
                <ul>
                  {task.sources.map((ref) => (
                    <li key={`${ref.sourceId}:${ref.uri}`}>
                      {ref.label} — {ref.uri}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Passage only; no account resources selected.</p>
              )}
            </details>
            {task.result && (
              <>
                <div class="task-result">{task.result.text}</div>
                <p class="task-small">
                  {task.result.provider} · {task.result.model} ·{" "}
                  {new Date(task.result.completedAt).toLocaleString()}
                </p>
                {task.result.citations.map((ref, index) => (
                  <details key={`${ref.sourceId}:${ref.uri}`}>
                    <summary>
                      [{index + 1}] {ref.label}
                    </summary>
                    <p>{ref.uri}</p>
                    <blockquote>{ref.excerpt}</blockquote>
                    <p class="task-small">
                      Read {new Date(ref.retrievedAt).toLocaleString()} ·{" "}
                      {ref.fingerprint}
                    </p>
                  </details>
                ))}
                <label>
                  Feedback for this result
                  <textarea
                    value={
                      state.comments[task._id] ?? task.feedback?.comment ?? ""
                    }
                    maxLength={2000}
                    onInput$={(_, el) => {
                      state.comments[task._id] = el.value;
                    }}
                  />
                </label>
                <div class="task-actions">
                  <button
                    type="button"
                    aria-pressed={task.feedback?.verdict === "useful"}
                    onClick$={() => giveFeedback(task._id, "useful")}
                  >
                    Useful
                  </button>
                  <button
                    type="button"
                    aria-pressed={task.feedback?.verdict === "not-useful"}
                    onClick$={() => giveFeedback(task._id, "not-useful")}
                  >
                    Not useful
                  </button>
                  {task.feedback && (
                    <span class="task-small">
                      Feedback saved to your account.
                    </span>
                  )}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
});
