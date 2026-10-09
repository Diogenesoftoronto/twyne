import {
  component$,
  useSignal,
  useStyles$,
  useVisibleTask$,
} from "@qwik.dev/core";
import {
  THREAD_INSTRUMENT_EVENT,
  threadInstrumentController,
  threadInstrumentSnapshot,
  type ThreadInstrumentSnapshot,
} from "../../utils/thread-instrument";
import { InstrumentArt } from "../instruments/instrument-art";
import { localWritingStatus } from "../../utils/local-writing-models";
import { localPackId } from "../../utils/local-writing-manifest";
import { onModelDownload } from "../../utils/models-cache";
import {
  InstrumentMotion,
  InstrumentMotionPart,
} from "../instruments/instrument-motion";

/** A focused view of code-backed sentence pairs. The manuscript remains the
 * source of every node; model output can name only a permitted relation.
 */
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
      <p class="thread-instrument-note">
        Every passage below is a sentence from this manuscript. Hover or focus a
        pair to mark both spans in the page.
      </p>
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
            onMouseEnter$={() =>
              threadInstrumentController()?.preview(thread.id)
            }
            onMouseLeave$={() => threadInstrumentController()?.preview(null)}
            onFocusIn$={() => threadInstrumentController()?.preview(thread.id)}
            onFocusOut$={() => threadInstrumentController()?.preview(null)}
          >
            <p class="thread-instrument-relation">
              {thread.state === "confirmed"
                ? thread.relation
                : thread.state === "no-relation"
                  ? "No judged relation"
                  : thread.hypothesis === "exact-wording"
                    ? "Repeated wording"
                    : thread.hypothesis === "reference"
                      ? "Possible reference"
                      : thread.hypothesis === "embedding-neighbours"
                        ? "Similar sentence vectors"
                        : "Word overlap"}
            </p>
            <p class="thread-instrument-note">
              {thread.source === "judgement"
                ? `${thread.model} · relation ${thread.probability?.toFixed(2)} · exists ${thread.exists?.toFixed(2)}`
                : thread.source === "on-device"
                  ? `${thread.embedding?.model} · cosine ${thread.embedding?.cosine.toFixed(3)} · relation unverified`
                  : "by rule · relation unverified"}
            </p>
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
            {thread.hypothesis === "exact-wording" && (
              <p class="thread-instrument-note">
                Repetition can be deliberate. Removing an occurrence is one undo
                step.
              </p>
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
