import { $, component$, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { readActiveFolioHtml } from "../../utils/folio-export";
import {
  compareRevisionPassages,
  compareRevisions,
  createRevisionSnapshot,
  loadRevisionHistory,
  loadRevisionTasks,
  setRevisionTaskStatus,
  type RevisionSnapshot,
  type RevisionTask,
} from "../../utils/revision-history";
import { saveFolioContentToIdb } from "../../utils/idb";
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
  selectedId: string | null;
  compareId: "current" | string;
  confirmRestore: boolean;
  message: string | null;
}

function checkpointLabel(revision: RevisionSnapshot): string {
  return `${revision.label} · ${new Date(revision.createdAt).toLocaleString()}`;
}

export const VersionHistoryPanel = component$<VersionHistoryPanelProps>(
  ({ activeFolioId, folioName }) => {
    const store = useStore<VersionHistoryStore>({
      loading: true,
      currentHtml: "",
      revisions: [],
      tasks: [],
      selectedId: null,
      compareId: "current",
      confirmRestore: false,
      message: null,
    });

    const refresh = $(async () => {
      store.loading = true;
      const [currentHtml, revisions, tasks] = await Promise.all([
        readActiveFolioHtml(activeFolioId),
        loadRevisionHistory(activeFolioId),
        loadRevisionTasks(activeFolioId),
      ]);
      store.currentHtml = currentHtml;
      store.revisions = revisions;
      store.tasks = tasks;
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
      const snapshot = await createRevisionSnapshot({
        folioId: activeFolioId,
        html,
        label: "Manual checkpoint",
        source: "manual",
      });
      store.message = snapshot
        ? "Checkpoint saved."
        : "The current manuscript already has a checkpoint.";
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
      await createRevisionSnapshot({
        folioId: activeFolioId,
        html: currentHtml,
        label: "Before restoring an earlier version",
        source: "manual",
        force: true,
      });
      await saveFolioContentToIdb(activeFolioId, selected.html);
      markDirty(["folioContent"]);
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
      <section class="h-full overflow-y-auto bg-[var(--color-paper)] p-4 text-[var(--color-ink)] sm:p-5">
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
            <button
              type="button"
              class="btn-press shrink-0"
              onClick$={saveCheckpoint}
            >
              Save checkpoint
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
            <div class="mt-5 grid gap-3 sm:grid-cols-2">
              <label class="text-xs font-semibold text-[var(--color-ink-light)]">
                Earlier checkpoint
                <select
                  class="mt-1 block w-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-ink)] focus-ring"
                  value={store.selectedId ?? ""}
                  onChange$={(_, element) => {
                    store.selectedId = element.value || null;
                    if (store.compareId === store.selectedId) {
                      store.compareId = "current";
                    }
                    store.confirmRestore = false;
                  }}
                >
                  {store.revisions.map((revision) => (
                    <option key={revision.id} value={revision.id}>
                      {checkpointLabel(revision)}
                    </option>
                  ))}
                </select>
              </label>
              <label class="text-xs font-semibold text-[var(--color-ink-light)]">
                Compare with
                <select
                  class="mt-1 block w-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-3 py-2 text-sm text-[var(--color-ink)] focus-ring"
                  value={store.compareId}
                  onChange$={(_, element) => {
                    store.compareId = element.value;
                  }}
                >
                  <option value="current">Current manuscript</option>
                  {store.revisions
                    .filter((revision) => revision.id !== store.selectedId)
                    .map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        {checkpointLabel(revision)}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            {comparison && (
              <div class="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-y border-[var(--color-paper-3)] py-3 text-xs text-[var(--color-ink-light)]">
                <span>
                  <strong class="text-[var(--color-ink)]">
                    {comparison.wordsChanged}
                  </strong>{" "}
                  words changed
                </span>
                <span>
                  {comparison.wordsBefore} → {comparison.wordsAfter} words
                </span>
                <span>
                  {comparison.paragraphsBefore} → {comparison.paragraphsAfter}{" "}
                  passages
                </span>
              </div>
            )}

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
                  {passageChanges.map((change, index) => (
                    <li
                      key={`${index}-${change.before ?? "added"}`}
                      class="border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] p-3"
                    >
                      {change.before && (
                        <div class="bg-[color-mix(in_srgb,var(--color-vermilion)_7%,var(--color-paper))] p-3">
                          <p class="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-vermilion)]">
                            Removed
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
                            Added
                          </p>
                          <p class="mt-1 whitespace-pre-wrap font-serif text-sm leading-6">
                            {change.after}
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

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
