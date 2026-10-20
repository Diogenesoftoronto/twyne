import { htmlToTypst } from "../../utils/typst/document";
import { SiteSelect } from "../ui/site-select";
import { Icon } from "../ui/icon";
import { RevisionSummary } from "./revision-summary";
import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import {
  readActiveFolioHtml,
  readActiveFolioTypstSource,
} from "../../utils/folio-export";
import { loadPersonaNotesLocally } from "../../utils/convex-sync";
import type { PersonaFeedback } from "../../types";
import {
  compareRevisionPassages,
  compareRevisions,
  createRevisionSnapshot,
  loadRevisionHistory,
  describeRevision,
  loadRevisionTasks,
  notesTouchedBy,
  setRevisionTaskStatus,
  type RevisionSnapshot,
  type RevisionTask,
} from "../../utils/revision-history";
import { saveFolioTypstToIdb } from "../../utils/idb";
import { markDirty } from "../../utils/convex-sync";

interface VersionHistoryPanelProps {
  activeFolioId: string;
  folioName: string;
}

interface VersionHistoryStore {
  loading: boolean;
  currentHtml: string;
  revisions: RevisionSnapshot[];
  tasks: RevisionTask[];
  /** Editors' notes on this folio, to show which changes touched them. */
  notes: PersonaFeedback[];
  /** What the writer says the next checkpoint is for. */
  intentDraft: string;
  selectedId: string | null;
  compareId: "current" | string;
  confirmRestore: boolean;
  message: string | null;
}

function checkpointLabel(revision: RevisionSnapshot): string {
  const name = revision.intent || revision.label;
  return `${name} · ${new Date(revision.createdAt).toLocaleString()}`;
}

export const VersionHistoryPanel = component$<VersionHistoryPanelProps>(
  ({ activeFolioId, folioName }) => {
    const store = useStore<VersionHistoryStore>({
      loading: true,
      currentHtml: "",
      revisions: [],
      tasks: [],
      notes: [],
      intentDraft: "",
      selectedId: null,
      compareId: "current",
      confirmRestore: false,
      message: null,
    });

    const refresh = $(async () => {
      store.loading = true;
      const [currentHtml, revisions, tasks, notes] = await Promise.all([
        readActiveFolioHtml(activeFolioId),
        loadRevisionHistory(activeFolioId),
        loadRevisionTasks(activeFolioId),
        loadPersonaNotesLocally(activeFolioId),
      ]);
      store.currentHtml = currentHtml;
      store.revisions = revisions;
      store.tasks = tasks;
      store.notes = notes;
      if (!revisions.some((revision) => revision.id === store.selectedId)) {
        store.selectedId = revisions[0]?.id ?? null;
      }
      if (
        store.compareId !== "current" &&
        !revisions.some((revision) => revision.id === store.compareId)
      ) {
        store.compareId = "current";
      }
      store.loading = false;
    });

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ cleanup }) => {
      void refresh();
      const onOpen = () => void refresh();
      window.addEventListener("twyne:version-history-opened", onOpen);
      cleanup(() =>
        window.removeEventListener("twyne:version-history-opened", onOpen),
      );
    });

    const saveCheckpoint = $(async () => {
      const html = await readActiveFolioHtml(activeFolioId);
      let typstSource: string | undefined;
      try {
        typstSource = await readActiveFolioTypstSource(activeFolioId, html);
      } catch (error) {
        store.message =
          error instanceof Error
            ? error.message
            : "Could not read the current source.";
        return;
      }
      const snapshot = await createRevisionSnapshot({
        typstSource,
        folioId: activeFolioId,
        html,
        label: "Manual checkpoint",
        intent: store.intentDraft,
        source: "manual",
      });
      store.message = snapshot
        ? "Checkpoint saved."
        : "The current manuscript already has a checkpoint.";
      if (snapshot) store.intentDraft = "";
      store.currentHtml = html;
      store.revisions = await loadRevisionHistory(activeFolioId);
      store.selectedId = store.revisions[0]?.id ?? null;
      store.compareId = "current";
    });

    const restoreSelected = $(async () => {
      const selected = store.revisions.find(
        (revision) => revision.id === store.selectedId,
      );
      if (!selected) return;
      const currentHtml = await readActiveFolioHtml(activeFolioId);
      let typstSource: string | undefined;
      try {
        typstSource = await readActiveFolioTypstSource(
          activeFolioId,
          currentHtml,
        );
      } catch (error) {
        store.message =
          error instanceof Error
            ? error.message
            : "Could not read the current source.";
        return;
      }
      await createRevisionSnapshot({
        typstSource,
        folioId: activeFolioId,
        html: currentHtml,
        label: "Before restoring an earlier version",
        source: "manual",
        force: true,
      });
      const restoredSource = selected.typstSource ?? htmlToTypst(selected.html);
      window.dispatchEvent(
        new CustomEvent("twyne:typst-applying", {
          detail: { folioId: activeFolioId },
        }),
      );
      await saveFolioTypstToIdb(activeFolioId, restoredSource, selected.html);
      window.dispatchEvent(
        new CustomEvent("twyne:typst-remote-change", {
          detail: {
            intentionalReplacement: true,
            folioId: activeFolioId,
            source: restoredSource,
            html: selected.html,
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("twyne:typst-source-committed", {
          detail: {
            folioId: activeFolioId,
            source: restoredSource,
            html: selected.html,
          },
        }),
      );
      markDirty(["folioContent"], activeFolioId);
      window.dispatchEvent(
        new CustomEvent("twyne:load-folio", { detail: selected.html }),
      );
      store.currentHtml = selected.html;
      store.revisions = await loadRevisionHistory(activeFolioId);
      store.compareId = "current";
      store.confirmRestore = false;
      store.message = `Restored “${selected.label}”. Your previous draft was saved as a checkpoint.`;
    });

    const toggleTask = $(async (taskId: string, done: boolean) => {
      store.tasks = await setRevisionTaskStatus(
        activeFolioId,
        taskId,
        done ? "done" : "open",
      );
    });

    const selected = store.revisions.find(
      (revision) => revision.id === store.selectedId,
    );
    const compared =
      store.compareId === "current"
        ? {
            html: store.currentHtml,
            label: "Current manuscript",
            createdAt: Number.POSITIVE_INFINITY,
          }
        : store.revisions.find((revision) => revision.id === store.compareId);
    const comparison =
      selected && compared
        ? compareRevisions(selected.html, compared.html)
        : null;
    const passageChanges =
      selected && compared
        ? compareRevisionPassages(selected.html, compared.html)
        : [];
    const openTaskCount = store.tasks.filter(
      (task) => task.status === "open",
    ).length;

    return (
      <section class="h-full overflow-y-auto bg-[var(--color-paper)] p-4 text-[var(--color-ink)]">
        <header class="border-b border-[var(--color-paper-3)] pb-4">
          <p class="dept-label">Version history</p>
          <div class="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="truncate font-display text-lg font-semibold">
                {folioName}
              </h2>
              <p class="mt-1 max-w-prose text-sm leading-5 text-[var(--color-ink-light)]">
                Review what changed, save a checkpoint, or restore an earlier
                manuscript without leaving the editor.
              </p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap items-end gap-2">
            <label class="min-w-[12rem] flex-1 text-xs font-semibold text-[var(--color-ink-light)]">
              What was this revision for? (optional)
              <input
                type="text"
                class="mt-1 w-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-2 py-1.5 font-serif text-sm font-normal text-[var(--color-ink)]"
                placeholder="e.g. Pay off the promise in the opening"
                value={store.intentDraft}
                onInput$={(_, el) => {
                  store.intentDraft = el.value;
                }}
              />
            </label>
            <button
              type="button"
              class="btn-press inline-flex shrink-0 items-center gap-2"
              onClick$={saveCheckpoint}
            >
              <Icon name="add" /> Save checkpoint
            </button>
          </div>
        </header>

        {store.message && (
          <p class="mt-4 text-sm text-[var(--color-sage)]" role="status">
            {store.message}
          </p>
        )}

        {store.loading ? (
          <p class="py-8 text-sm text-[var(--color-ink-light)]">
            Opening version history…
          </p>
        ) : store.revisions.length === 0 ? (
          <div class="py-10 text-center">
            <h3 class="font-display text-lg">No checkpoints yet</h3>
            <p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--color-ink-light)]">
              Save the current manuscript to start a history you can compare and
              restore.
            </p>
          </div>
        ) : (
          <>
            <div
              class="mt-5 grid gap-3"
              style={{
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(100%, 15rem), 1fr))",
              }}
            >
              <div class="min-w-0 text-xs font-semibold text-[var(--color-ink-light)]">
                <p>Earlier checkpoint</p>
                <SiteSelect
                  class="mt-1"
                  ariaLabel="Earlier checkpoint"
                  value={store.selectedId ?? ""}
                  options={store.revisions.map((revision) => ({
                    value: revision.id,
                    label: checkpointLabel(revision),
                  }))}
                  onChange$={(value) => {
                    store.selectedId = value || null;
                    if (store.compareId === store.selectedId)
                      store.compareId = "current";
                    store.confirmRestore = false;
                  }}
                />
              </div>
              <div class="min-w-0 text-xs font-semibold text-[var(--color-ink-light)]">
                <p>Compare with</p>
                <SiteSelect
                  class="mt-1"
                  ariaLabel="Compare with"
                  value={store.compareId}
                  options={[
                    { value: "current", label: "Current manuscript" },
                    ...store.revisions
                      .filter((revision) => revision.id !== store.selectedId)
                      .map((revision) => ({
                        value: revision.id,
                        label: checkpointLabel(revision),
                      })),
                  ]}
                  onChange$={(value) => {
                    store.compareId = value;
                  }}
                />
              </div>
            </div>

            <section class="mt-5" aria-labelledby="changed-passages-heading">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3
                    id="changed-passages-heading"
                    class="font-display text-base font-semibold"
                  >
                    Changed passages
                  </h3>
                  {selected && compared && (
                    <p class="mt-1 text-xs text-[var(--color-ink-light)]">
                      {selected.label} compared with {compared.label}
                    </p>
                  )}
                  {compared && "intent" in compared && compared.intent && (
                    <p class="mt-1 font-serif text-sm italic text-[var(--color-ink)]">
                      Intent: {compared.intent}
                    </p>
                  )}
                  {selected && compared && (
                    <p class="mt-1 font-serif text-sm text-[var(--color-ink)]">
                      {describeRevision(passageChanges, store.notes)}
                    </p>
                  )}
                </div>
                {selected && (
                  <button
                    type="button"
                    class="btn-paper"
                    onClick$={() => {
                      store.confirmRestore = true;
                    }}
                  >
                    Restore checkpoint
                  </button>
                )}
              </div>

              {passageChanges.length === 0 ? (
                <p class="mt-4 bg-[var(--color-paper-soft)] p-4 text-sm text-[var(--color-ink-light)]">
                  These versions have the same manuscript text.
                </p>
              ) : (
                <ol class="mt-4 space-y-3">
                  {passageChanges.map((change, index) => {
                    const touched = notesTouchedBy(change, store.notes);
                    return (
                      <li
                        key={`${index}-${change.before ?? "added"}`}
                        class="border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-3"
                      >
                        <p class="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-light)]">
                          {change.before && change.after
                            ? "Rewritten"
                            : change.before
                              ? "Cut"
                              : "New passage"}
                        </p>
                        {change.before && (
                          <div class="bg-[color-mix(in_srgb,var(--color-vermilion)_7%,var(--color-paper))] p-3">
                            <p class="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-vermilion)]">
                              Before
                            </p>
                            <p class="mt-1 whitespace-pre-wrap font-serif text-sm leading-6">
                              {change.before}
                            </p>
                          </div>
                        )}
                        {change.after && (
                          <div
                            class={[
                              "bg-[color-mix(in_srgb,var(--color-sage)_9%,var(--color-paper))] p-3",
                              { "mt-2": Boolean(change.before) },
                            ]}
                          >
                            <p class="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-sage)]">
                              After
                            </p>
                            <p class="mt-1 whitespace-pre-wrap font-serif text-sm leading-6">
                              {change.after}
                            </p>
                          </div>
                        )}
                        {touched.length > 0 && (
                          <div class="mt-2 border-l-2 border-[var(--color-paper-3)] pl-3 text-xs leading-5 text-[var(--color-ink-light)]">
                            <p class="font-semibold">
                              This change rewrote the passage{" "}
                              {touched.length === 1
                                ? "an editor's note was on"
                                : `${touched.length} editors' notes were on`}
                              :
                            </p>
                            {touched.slice(0, 3).map((note) => (
                              <p key={note.noteId ?? note.timestamp}>
                                <span style={{ color: note.personaColor }}>
                                  {note.personaName}
                                </span>
                                {": "}
                                {note.feedback.length > 160
                                  ? `${note.feedback.slice(0, 159)}…`
                                  : note.feedback}
                              </p>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {comparison && (
              <details class="mt-5">
                <summary class="cursor-pointer text-xs font-semibold text-[var(--color-ink-light)] focus-ring">
                  Size of the change: {comparison.wordsChanged.toLocaleString()}{" "}
                  words changed
                </summary>
                <RevisionSummary comparison={comparison} />
              </details>
            )}

            {store.confirmRestore && selected && (
              <div class="mt-5 border border-[var(--color-vermilion)] bg-[var(--color-paper-soft)] p-4">
                <p class="text-sm leading-6">
                  Twyne will save the current manuscript first, then restore “
                  {selected.label}”.
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn-press"
                    onClick$={restoreSelected}
                  >
                    Save current and restore
                  </button>
                  <button
                    type="button"
                    class="btn-paper"
                    onClick$={() => {
                      store.confirmRestore = false;
                    }}
                  >
                    Keep current manuscript
                  </button>
                </div>
              </div>
            )}

            {store.tasks.length > 0 && (
              <details class="mt-5 border-t border-[var(--color-paper-3)] pt-4">
                <summary class="cursor-pointer text-sm font-semibold focus-ring">
                  Revision tasks ({openTaskCount} open)
                </summary>
                <div class="mt-3 space-y-2">
                  {store.tasks.map((task) => (
                    <label
                      key={task.id}
                      class="flex cursor-pointer gap-3 bg-[var(--color-paper-soft)] p-3"
                    >
                      <input
                        type="checkbox"
                        class="mt-1"
                        checked={task.status === "done"}
                        onChange$={(_, element) =>
                          toggleTask(task.id, element.checked)
                        }
                      />
                      <span
                        class={[
                          "text-sm leading-5",
                          {
                            "text-[var(--color-ink-light)] line-through":
                              task.status === "done",
                          },
                        ]}
                      >
                        {task.title}
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </section>
    );
  },
);
