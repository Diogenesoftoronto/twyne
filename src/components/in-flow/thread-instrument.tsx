import {
  $,
  component$,
  useSignal,
  useStore,
  useStyles$,
  useVisibleTask$,
} from "@qwik.dev/core";
import {
  THREAD_INSTRUMENT_EVENT,
  threadInstrumentController,
  threadInstrumentSnapshot,
  type InstrumentThread,
  type ThreadInstrumentSnapshot,
} from "../../utils/thread-instrument";
import {
  openPassageGather,
  type GatherPassage,
} from "../../utils/passage-gather";
import { InstrumentArt } from "../instruments/instrument-art";
import { InstrumentRoom } from "../instruments/instrument-room";
import { localWritingStatus } from "../../utils/local-writing-models";
import { localPackId } from "../../utils/local-writing-manifest";
import { onModelDownload } from "../../utils/models-cache";
import {
  InstrumentMotion,
  InstrumentMotionPart,
} from "../instruments/instrument-motion";

/** A focused view of code-backed sentence pairs. The manuscript remains the
 * source of every node; model output can name only a permitted relation.
 * "See together" gathers a pair (or every pair) into one read-only sheet of
 * real manuscript excerpts; resting the pointer on a pair does the same.
 */
const GATHER_HOLD_MS = 1_100;
// Mutated in place: Qwik's handler segments cannot reassign module bindings.
const hold: { timer?: ReturnType<typeof setTimeout> } = {};

const relationLabel = (thread: InstrumentThread): string =>
  thread.state === "confirmed" && thread.relation
    ? thread.relation
    : thread.state === "no-relation"
      ? "No judged relation"
      : thread.hypothesis === "exact-wording"
        ? "Repeated wording"
        : thread.hypothesis === "reference"
          ? "Possible reference"
          : thread.hypothesis === "embedding-neighbours"
            ? "Similar sentence vectors"
            : "Word overlap";
const THREAD_COLORS = [
  "var(--color-cobalt)",
  "var(--color-vermilion)",
  "#4f7a52",
  "#8a5a9e",
  "#a2702a",
];
export const ThreadsInstrument = component$<{
  fixture?: ThreadInstrumentSnapshot;
  readOnly?: boolean;
}>(({ fixture, readOnly }) => {
  const snapshot = useSignal(fixture ?? threadInstrumentSnapshot());
  const message = useSignal("");
  const embeddingReady = useSignal(false);
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    if (fixture) return;
    let alive = true;
    const refresh = async () => {
      try {
        const status = await localWritingStatus("embeddings");
        if (alive) embeddingReady.value = status.phase === "ready";
      } catch {
        if (alive) embeddingReady.value = false;
      }
    };
    void refresh();
    const off = onModelDownload(localPackId("embeddings"), () => {
      void refresh();
    });
    cleanup(() => {
      alive = false;
      off();
    });
  });
  useStyles$(`
    .thread-instrument { background:var(--color-paper); color:var(--color-ink); border:1px solid var(--color-paper-3); border-radius:2px; padding:1rem; max-height:65dvh; overflow:auto; width:min(30rem,100%); font:.875rem/1.6 var(--font-serif); }
    .thread-instrument header { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
    .thread-instrument h2 { font:600 1.125rem var(--font-display); }
    .thread-instrument-note { font:.75rem/1.5 var(--font-sans); color:var(--color-ink); opacity:.85; margin:.4rem 0; }
    .thread-instrument ol { list-style:none; padding:0; margin:1rem 0 0; }
    .thread-instrument li { border-top:1px solid var(--color-paper-3); padding:.75rem 0; }
    .thread-instrument-relation { font:.6875rem var(--font-typewriter); letter-spacing:.08em; margin:.4rem 0; }
    .thread-instrument-span { border-left:2px solid var(--color-ink); padding:.35rem .5rem; margin:.3rem 0; background:var(--color-paper-2); }
    .thread-instrument-span button { display:block; text-align:left; width:100%; border:0; font:inherit; color:inherit; background:transparent; cursor:pointer; }
    .thread-instrument-span small { font:.6875rem var(--font-sans); display:block; margin-bottom:.2rem; }
    .thread-instrument-actions { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:.6rem; }
    .thread-instrument-room { margin-top:.6rem; font:.75rem/1.5 var(--font-sans); }
    .thread-instrument-room > summary { cursor:pointer; padding:.25rem 0; }
    .thread-instrument-head { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
    .thread-instrument-gather { position:relative; overflow:hidden; border:1px solid var(--color-paper-3); border-radius:999px; background:var(--color-paper); color:var(--color-ink); font:.6875rem var(--font-sans); padding:.15rem .55rem; cursor:pointer; }
    .thread-instrument-gather::after { content:""; position:absolute; left:0; bottom:0; height:2px; width:0; background:var(--color-cobalt); }
    .thread-instrument li.is-arming .thread-instrument-gather::after { width:100%; transition:width 1.1s linear; }
    @media (prefers-reduced-motion: reduce) { .thread-instrument li.is-arming .thread-instrument-gather::after { transition:none; } }
    .thread-instrument button:focus-visible { outline:2px solid var(--color-ink); outline-offset:2px; }
    @media(max-width:480px) { .thread-instrument { max-height:55dvh; } }
  `);
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    if (fixture) return;
    let opener: HTMLElement | null = null;
    let wasOpen = snapshot.value.open;
    const sync = () => {
      const next = threadInstrumentSnapshot();
      if (next.open && !wasOpen)
        opener =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      if (!next.open && wasOpen) {
        const target =
          opener?.isConnected && opener !== document.body
            ? opener
            : document.querySelector<HTMLElement>(
                '.ProseMirror[contenteditable="true"]',
              );
        target?.focus();
      }
      wasOpen = next.open;
      snapshot.value = next;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !threadInstrumentSnapshot().open) return;
      // An open gathering closes first; Threads stays behind it.
      if (document.querySelector("[data-passage-gather]")) return;
      event.preventDefault();
      event.stopPropagation();
      threadInstrumentController()?.close();
    };
    window.addEventListener(THREAD_INSTRUMENT_EVENT, sync);
    window.addEventListener("keydown", escape, true);
    sync();
    cleanup(() => {
      window.removeEventListener(THREAD_INSTRUMENT_EVENT, sync);
      window.removeEventListener("keydown", escape, true);
    });
  });
  const arming = useSignal<string | null>(null);
  const roomOpen = useStore<Record<string, boolean>>({});
  /** Gather the passages of these pairs, each sentence once. */
  const gather = $((ids: string[], opener: HTMLElement | null) => {
    clearTimeout(hold.timer);
    arming.value = null;
    const current = threadInstrumentSnapshot();
    const controller = threadInstrumentController();
    if (!controller || current.stale) return;
    const pairs = current.threads.filter((t) => ids.includes(t.id));
    const seen = new Set<string>();
    const passages: GatherPassage[] = pairs.flatMap((thread, n) =>
      (
        [
          [thread.firstId, thread.first],
          [thread.secondId, thread.second],
        ] as const
      ).flatMap(([spanId, span]) => {
        if (seen.has(spanId)) return [];
        seen.add(spanId);
        const range = controller.spanRange(spanId);
        if (!range) return [];
        return [
          {
            id: spanId,
            label: `Sentence ${span.ordinal} · ${relationLabel(thread)}`,
            color: THREAD_COLORS[n % THREAD_COLORS.length],
            range,
            resolveRange: () =>
              threadInstrumentController()?.spanRange(spanId) ?? null,
            go: () => {
              threadInstrumentController()?.jump(spanId);
              document
                .querySelector<HTMLElement>(".ProseMirror")
                ?.focus({ preventScroll: true });
            },
          },
        ];
      }),
    );
    if (!passages.length) {
      message.value = "These spans changed. Reopen Threads to see them.";
      return;
    }
    openPassageGather({
      title:
        pairs.length === 1
          ? relationLabel(pairs[0])
          : `${pairs.length} threads in this manuscript`,
      note: pairs.length === 1 ? pairs[0].observation : undefined,
      passages,
      opener,
    });
  });
  const view = snapshot.value;
  if (!view.open) return null;
  return (
    <aside class="thread-instrument" aria-label="Threads">
      <InstrumentMotion state="open">
        <InstrumentArt kind="threads" size="compact" />
      </InstrumentMotion>
      <header>
        <h2>Threads</h2>
        <button
          type="button"
          class="btn-paper in-flow-mini"
          onClick$={() => threadInstrumentController()?.close()}
        >
          Close
        </button>
      </header>
      {view.threads.length > 1 && (
        <button
          type="button"
          class="btn-paper in-flow-mini"
          disabled={view.stale}
          data-gather-opener="threads:all"
          onClick$={(_, el) =>
            gather(
              view.threads.map((t) => t.id),
              el,
            )
          }
        >
          See all {view.threads.length} together
        </button>
      )}
      {embeddingReady.value && view.focusId && (
        <button
          type="button"
          class="btn-paper in-flow-mini"
          disabled={view.stale || view.status === "reading"}
          onClick$={async () => {
            await threadInstrumentController()?.suggestWithEmbeddings();
          }}
        >
          Find on-device neighbours
        </button>
      )}
      {view.notice && (
        <p class="thread-instrument-note" role="status">
          {view.notice}
        </p>
      )}
      {view.status === "reading" && (
        <p class="thread-instrument-note" role="status">
          Reading possible relations…
        </p>
      )}
      <ol>
        {view.threads.map((thread) => (
          <li
            key={thread.id}
            class={{ "is-arming": arming.value === thread.id }}
            onMouseEnter$={() =>
              threadInstrumentController()?.preview(thread.id)
            }
            onMouseLeave$={() => threadInstrumentController()?.preview(null)}
            onFocusIn$={() => threadInstrumentController()?.preview(thread.id)}
            onFocusOut$={() => threadInstrumentController()?.preview(null)}
          >
            <div class="thread-instrument-head">
              <p
                class="thread-instrument-relation"
                title={
                  thread.source === "judgement"
                    ? `${thread.model} · relation ${thread.probability?.toFixed(2)} · exists ${thread.exists?.toFixed(2)}`
                    : thread.source === "on-device"
                      ? `${thread.embedding?.model} · cosine ${thread.embedding?.cosine.toFixed(3)} · relation unverified`
                      : "By rule · relation unverified"
                }
              >
                {relationLabel(thread)}
              </p>
              <button
                type="button"
                class="thread-instrument-gather"
                data-gather-opener={`thread:${thread.id}`}
                disabled={view.stale}
                onClick$={(_, el) => gather([thread.id], el)}
                onMouseEnter$={(_, el) => {
                  // Resting on it gathers the pair; passing over does not.
                  clearTimeout(hold.timer);
                  arming.value = thread.id;
                  hold.timer = setTimeout(() => {
                    if (arming.value === thread.id)
                      void gather([thread.id], el);
                  }, GATHER_HOLD_MS);
                }}
                onPointerDown$={() => {
                  clearTimeout(hold.timer);
                  arming.value = null;
                }}
                onMouseLeave$={() => {
                  clearTimeout(hold.timer);
                  arming.value = null;
                }}
                title="See both passages together (or rest the pointer here)"
              >
                See together
              </button>
            </div>
            <InstrumentMotion state="compare">
              <InstrumentMotionPart part="source">
                <div class="thread-instrument-span">
                  <button
                    type="button"
                    disabled={view.stale}
                    onClick$={() =>
                      threadInstrumentController()?.jump(thread.firstId)
                    }
                  >
                    <small>Sentence {thread.first.ordinal}</small>
                    {thread.first.text}
                  </button>
                </div>
              </InstrumentMotionPart>
              <p class="thread-instrument-relation" aria-hidden="true">
                ↓
              </p>
              <InstrumentMotionPart part="alternative">
                <div class="thread-instrument-span">
                  <button
                    type="button"
                    disabled={view.stale}
                    onClick$={() =>
                      threadInstrumentController()?.jump(thread.secondId)
                    }
                  >
                    <small>Sentence {thread.second.ordinal}</small>
                    {thread.second.text}
                  </button>
                </div>
              </InstrumentMotionPart>
            </InstrumentMotion>
            <p class="thread-instrument-note">{thread.observation}</p>
            {thread.hypothesis === "exact-wording" && !readOnly && (
              <div class="thread-instrument-actions">
                <button
                  type="button"
                  class="btn-paper in-flow-mini"
                  disabled={view.stale}
                  onClick$={() => {
                    if (
                      !threadInstrumentController()?.removeRepeated(
                        thread.id,
                        thread.secondId,
                      )
                    )
                      message.value =
                        "These spans changed. Reopen Threads before removing a repeat.";
                  }}
                >
                  Remove second occurrence
                </button>
                <button
                  type="button"
                  class="btn-paper in-flow-mini"
                  disabled={view.stale}
                  onClick$={() => {
                    if (
                      !threadInstrumentController()?.removeRepeated(
                        thread.id,
                        thread.firstId,
                      )
                    )
                      message.value =
                        "These spans changed. Reopen Threads before removing a repeat.";
                  }}
                >
                  Remove first occurrence
                </button>
              </div>
            )}
            {!fixture && !readOnly && (
              <details
                class="thread-instrument-room"
                open={!!roomOpen[thread.id]}
                onToggle$={(_, el) => {
                  roomOpen[thread.id] = el.open;
                }}
              >
                <summary>Ask an editor about this pair</summary>
                {/* Mounted only while open: a closed disclosure has no box. */}
                {roomOpen[thread.id] && (
                  <InstrumentRoom
                    disabled={view.stale}
                    context={{
                      instrument: "threads",
                      key: `${view.index.fingerprint}:${thread.id}`,
                      source: `First passage (sentence ${thread.first.ordinal}):\n${thread.first.text}\n\nSecond passage (sentence ${thread.second.ordinal}):\n${thread.second.text}`,
                      question:
                        "Does this connection serve the reader as recurrence, contradiction, or setup and payoff, or is it coincidence? Suggest one concrete revision only if it would help.",
                      detail: `The instrument's ${thread.source} observation is ${thread.observation}. Relation status: ${thread.state}. This observation is evidence to review, not a persona's endorsement.`,
                    }}
                    onAsk$={async (request) =>
                      (await threadInstrumentController()?.askRoom(
                        request,
                        thread.id,
                        view.index.fingerprint,
                      )) ?? {
                        ok: false,
                        message:
                          "Reopen Threads to invite an editor about this pair.",
                      }
                    }
                  />
                )}
              </details>
            )}
          </li>
        ))}
      </ol>
      {!view.threads.length && (
        <p class="thread-instrument-note">
          No repeated wording or backward-reference candidate found near this
          sentence.
        </p>
      )}
      {message.value && (
        <p class="thread-instrument-note" role="status">
          {message.value}
        </p>
      )}
    </aside>
  );
});
