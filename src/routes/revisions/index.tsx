import { $, component$, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { Link, type DocumentHead, useNavigate } from "@builder.io/qwik-city";
import {
  loadActiveFolioIdFromIdb,
  loadFolioContentFromIdb,
  loadFoliosFromIdb,
  saveFolioContentToIdb,
} from "../../utils/idb";
import {
  compareRevisions,
  createRevisionSnapshot,
  loadRevisionHistory,
  loadRevisionTasks,
  setRevisionTaskStatus,
  type RevisionSnapshot,
  type RevisionTask,
} from "../../utils/revision-history";
import { markDirty } from "../../utils/convex-sync";

interface RevisionDeskStore {
  loading: boolean;
  folioId: string | null;
  folioName: string;
  currentHtml: string;
  revisions: RevisionSnapshot[];
  tasks: RevisionTask[];
  selectedId: string | null;
  compareId: string | null;
  confirmRestore: boolean;
  message: string | null;
}

export default component$(() => {
  const nav = useNavigate();
  const store = useStore<RevisionDeskStore>({
    loading: true,
    folioId: null,
    folioName: "Revision desk",
    currentHtml: "",
    revisions: [],
    tasks: [],
    selectedId: null,
    compareId: null,
    confirmRestore: false,
    message: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const [folios, activeFolioId] = await Promise.all([
      loadFoliosFromIdb(),
      loadActiveFolioIdFromIdb(),
    ]);
    const folioId = activeFolioId ?? folios[0]?.id ?? null;
    if (!folioId) {
      store.loading = false;
      return;
    }
    const [html, revisions, tasks] = await Promise.all([
      loadFolioContentFromIdb(folioId),
      loadRevisionHistory(folioId),
      loadRevisionTasks(folioId),
    ]);
    store.folioId = folioId;
    store.folioName =
      folios.find((folio) => folio.id === folioId)?.name ?? "Untitled folio";
    store.currentHtml = html;
    store.revisions = revisions;
    store.tasks = tasks;
    store.selectedId = revisions[0]?.id ?? null;
    store.compareId = revisions[1]?.id ?? null;
    store.loading = false;
  });

  const saveCheckpoint = $(async () => {
    if (!store.folioId) return;
    const snapshot = await createRevisionSnapshot({
      folioId: store.folioId,
      html: store.currentHtml,
      label: "Manual checkpoint",
      source: "manual",
      force: true,
    });
    store.message = snapshot
      ? "Checkpoint saved."
      : "The current manuscript already has a checkpoint.";
    store.revisions = await loadRevisionHistory(store.folioId);
    store.selectedId = store.revisions[0]?.id ?? null;
  });

  const restoreSelected = $(async () => {
    if (!store.folioId || !store.selectedId) return;
    const selected = store.revisions.find(
      (revision) => revision.id === store.selectedId,
    );
    if (!selected) return;
    await createRevisionSnapshot({
      folioId: store.folioId,
      html: store.currentHtml,
      label: "Before restoring an earlier revision",
      source: "manual",
      force: true,
    });
    await saveFolioContentToIdb(store.folioId, selected.html);
    markDirty(["folioContent"]);
    void nav("/editor/");
  });

  const toggleTask = $(async (taskId: string, done: boolean) => {
    if (!store.folioId) return;
    store.tasks = await setRevisionTaskStatus(
      store.folioId,
      taskId,
      done ? "done" : "open",
    );
  });

  const selected = store.revisions.find(
    (revision) => revision.id === store.selectedId,
  );
  const compared = store.revisions.find(
    (revision) => revision.id === store.compareId,
  );
  const comparison =
    selected && compared
      ? compareRevisions(compared.html, selected.html)
      : null;

  return (
    <main class="min-h-screen bg-[var(--color-paper)] px-4 py-8 text-[var(--color-ink)] sm:px-8">
      <div class="mx-auto max-w-5xl">
        <header class="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-paper-3)] pb-5">
          <div>
            <p class="dept-label">Revision desk</p>
            <h1 class="mt-2 font-display text-3xl">{store.folioName}</h1>
            <p class="mt-2 max-w-xl text-sm text-[var(--color-ink-light)]">
              Compare meaningful checkpoints, preserve the current draft, and
              return to an earlier version without losing your way back.
            </p>
          </div>
          <div class="flex gap-2">
            <button
              class="btn-secondary"
              type="button"
              onClick$={saveCheckpoint}
            >
              Save checkpoint
            </button>
            <Link class="btn-primary" href="/editor/">
              Back to editor
            </Link>
          </div>
        </header>

        {store.message && (
          <p class="mb-4 text-sm text-[var(--color-sage)]" role="status">
            {store.message}
          </p>
        )}
        {!store.loading && store.folioId && store.tasks.length > 0 && (
          <section class="folio mb-6 p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="dept-label">Revision queue</p>
                <h2 class="mt-1 font-display text-xl">
                  {store.tasks.filter((task) => task.status === "open").length}{" "}
                  open tasks
                </h2>
              </div>
              <Link
                class="text-sm font-semibold text-[var(--color-vermilion)] hover:underline"
                href="/rubric/"
              >
                Run rubric again
              </Link>
            </div>
            <div class="mt-4 grid gap-2 md:grid-cols-2">
              {store.tasks.map((task) => (
                <label
                  key={task.id}
                  class="flex cursor-pointer gap-3 rounded-sm bg-[var(--color-paper-soft)] p-3"
                >
                  <input
                    type="checkbox"
                    checked={task.status === "done"}
                    onChange$={(_, element) =>
                      toggleTask(task.id, element.checked)
                    }
                    class="mt-1"
                  />
                  <span class="min-w-0">
                    <span
                      class={`block text-sm ${
                        task.status === "done"
                          ? "text-[var(--color-ink-light)] line-through"
                          : "text-[var(--color-ink)]"
                      }`}
                    >
                      {task.title}
                    </span>
                    <span class="mt-1 block text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-muted)]">
                      {task.source}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}
        {store.loading ? (
          <p class="text-sm text-[var(--color-ink-light)]">
            Opening the ledger…
          </p>
        ) : !store.folioId ? (
          <p class="folio p-6">
            Create a folio before opening revision history.
          </p>
        ) : store.revisions.length === 0 ? (
          <section class="folio p-8 text-center">
            <h2 class="font-display text-xl">No checkpoints yet</h2>
            <p class="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-light)]">
              Twyne records a checkpoint during sustained writing. You can save
              the current manuscript now to start the ledger.
            </p>
          </section>
        ) : (
          <div class="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <section class="folio max-h-[70vh] overflow-auto p-3">
              <h2 class="dept-label px-2 py-2">Checkpoints</h2>
              <div class="space-y-1">
                {store.revisions.map((revision) => (
                  <button
                    key={revision.id}
                    type="button"
                    class={`block w-full rounded-sm px-3 py-3 text-left focus-ring ${
                      store.selectedId === revision.id
                        ? "bg-[var(--color-paper-3)]"
                        : "hover:bg-[var(--color-paper-soft)]"
                    }`}
                    onClick$={() => {
                      store.selectedId = revision.id;
                      store.confirmRestore = false;
                    }}
                  >
                    <span class="block text-sm font-semibold">
                      {revision.label}
                    </span>
                    <span class="mt-1 block text-xs text-[var(--color-ink-light)]">
                      {new Date(revision.createdAt).toLocaleString()} ·{" "}
                      {revision.wordCount} words
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section class="folio p-5">
              <div class="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-paper-3)] pb-4">
                <div>
                  <label class="dept-label" for="compare-revision">
                    Compare against
                  </label>
                  <select
                    id="compare-revision"
                    class="mt-2 block max-w-full border border-[var(--color-paper-3)] bg-[var(--color-paper)] px-3 py-2 text-sm"
                    value={store.compareId ?? ""}
                    onChange$={(_, element) => {
                      store.compareId = element.value || null;
                    }}
                  >
                    <option value="">Choose a checkpoint</option>
                    {store.revisions
                      .filter((revision) => revision.id !== store.selectedId)
                      .map((revision) => (
                        <option key={revision.id} value={revision.id}>
                          {`${revision.label} · ${new Date(revision.createdAt).toLocaleDateString()}`}
                        </option>
                      ))}
                  </select>
                </div>
                {selected && (
                  <button
                    type="button"
                    class="text-sm font-semibold text-[var(--color-vermilion)] hover:underline"
                    onClick$={() => {
                      store.confirmRestore = true;
                    }}
                  >
                    Restore this revision
                  </button>
                )}
              </div>

              {comparison ? (
                <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Words before" value={comparison.wordsBefore} />
                  <Metric label="Words after" value={comparison.wordsAfter} />
                  <Metric
                    label="Words changed"
                    value={comparison.wordsChanged}
                  />
                  <Metric
                    label="Paragraphs"
                    value={`${comparison.paragraphsBefore} → ${comparison.paragraphsAfter}`}
                  />
                </div>
              ) : (
                <p class="mt-6 text-sm text-[var(--color-ink-light)]">
                  Choose another checkpoint to see what moved.
                </p>
              )}

              {store.confirmRestore && selected && (
                <div class="mt-6 border-l-2 border-[var(--color-vermilion)] bg-[var(--color-paper-soft)] p-4">
                  <p class="text-sm">
                    Twyne will checkpoint the current manuscript first, then
                    restore “{selected.label}”.
                  </p>
                  <div class="mt-3 flex gap-3">
                    <button
                      class="btn-primary"
                      type="button"
                      onClick$={restoreSelected}
                    >
                      Preserve current and restore
                    </button>
                    <button
                      class="btn-secondary"
                      type="button"
                      onClick$={() => {
                        store.confirmRestore = false;
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
});

const Metric = component$<{ label: string; value: string | number }>(
  ({ label, value }) => (
    <div class="bg-[var(--color-paper-soft)] p-3">
      <p class="text-xl font-semibold">{value}</p>
      <p class="mt-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-light)]">
        {label}
      </p>
    </div>
  ),
);

export const head: DocumentHead = {
  title: "Revision desk · Twyne",
  meta: [
    {
      name: "description",
      content: "Compare and restore durable Twyne manuscript checkpoints.",
    },
  ],
};
