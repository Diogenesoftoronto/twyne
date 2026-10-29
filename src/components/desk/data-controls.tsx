import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
} from "@qwik.dev/core";
import type { UsageRange } from "../../utils/usage-domain";
import { usageLedger } from "../../utils/usage-ledger";
import {
  resolveUsageAccountSwitch,
  setUsageSyncEnabled,
  usageSyncReadiness,
  type UsageSyncReadiness,
} from "../../utils/usage-sync";
import {
  captureProductEvent,
  usageExportRowCountBucket,
} from "../../utils/product-analytics";
import { USAGE_SYNC_REQUEST_EVENT } from "./usage-sync-controller";
import { ExportEverything } from "../account/export-everything";

function download(content: string, filename: string, mime: string): void {
  const href = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

async function countUsageRows(range: UsageRange): Promise<number> {
  let rows = 0;
  let cursor: string | undefined;
  do {
    const page = await usageLedger.listUsageEvents({
      from: range.from,
      to: range.to,
      cursor,
    });
    rows += page.events.length;
    cursor = page.cursor;
  } while (cursor);
  return rows;
}

/** Export, sync, and delete the content-free usage ledger. Lives in Account. */
export const DataControls = component$<{
  range: UsageRange;
  accountId?: string;
  onLocalDeleted$?: QRL<() => void>;
  onSynchronizedDelete$?: QRL<() => Promise<void>>;
}>((props) => {
  const message = useSignal("");
  const readiness = useSignal<UsageSyncReadiness>({ status: "disabled" });
  const confirmLocal = useSignal(false);
  const confirmRemote = useSignal(false);
  const busy = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    const accountId = track(() => props.accountId);
    try {
      readiness.value = accountId
        ? await usageSyncReadiness(accountId)
        : { status: "disabled" };
    } catch {
      message.value =
        "Usage sync preference could not be read. Nothing was changed.";
    }
  });

  const exportHistory = $(async (format: "json" | "csv") => {
    busy.value = true;
    try {
      const [content, rowCount] = await Promise.all([
        usageLedger.exportUsageHistory({
          from: props.range.from,
          to: props.range.to,
          format,
        }),
        countUsageRows(props.range),
      ]);
      download(
        content,
        `twyne-usage-${new Date().toISOString().slice(0, 10)}.${format}`,
        format === "json" ? "application/json" : "text/csv",
      );
      void captureProductEvent("usage_exported", {
        format,
        row_count_bucket: usageExportRowCountBucket(rowCount),
      });
      message.value = `Downloaded ${rowCount.toLocaleString()} content-free usage rows.`;
    } catch {
      message.value =
        "The export could not be prepared. Your local history was not changed.";
    } finally {
      busy.value = false;
    }
  });
  const toggleSync = $(async () => {
    if (!props.accountId) return;
    busy.value = true;
    try {
      const current = await usageSyncReadiness(props.accountId);
      readiness.value =
        current.status === "ready"
          ? await setUsageSyncEnabled({
              accountId: props.accountId,
              enabled: false,
            })
          : await setUsageSyncEnabled({
              accountId: props.accountId,
              enabled: true,
            });
      if (readiness.value.status === "ready")
        window.dispatchEvent(new Event(USAGE_SYNC_REQUEST_EVENT));
      message.value =
        readiness.value.status === "disabled"
          ? "Usage sync is off. Existing account history was not deleted."
          : "Usage sync preference saved.";
    } catch {
      message.value = "Usage sync preference was not changed.";
    } finally {
      busy.value = false;
    }
  });
  const resolveSwitch = $(
    async (choice: "attach-unsynchronized" | "keep-device-only") => {
      if (!props.accountId) return;
      busy.value = true;
      try {
        await resolveUsageAccountSwitch({ accountId: props.accountId, choice });
        readiness.value = await usageSyncReadiness(props.accountId);
        window.dispatchEvent(new Event(USAGE_SYNC_REQUEST_EVENT));
        message.value = "Account choice saved. Usage sync has been requested.";
      } catch {
        message.value =
          "The account choice was not saved. Nothing was attached.";
      } finally {
        busy.value = false;
      }
    },
  );
  const deleteLocal = $(async () => {
    busy.value = true;
    try {
      await usageLedger.deleteUsageHistory({ includeWritingActivity: true });
      const [usage, writing] = await Promise.all([
        usageLedger.listUsageEvents({
          from: null,
          to: Number.MAX_SAFE_INTEGER,
          limit: 1,
        }),
        usageLedger.listWritingActivity({
          from: 0,
          to: Date.now() + 86_400_000,
          limit: 1,
        }),
      ]);
      if (usage.events.length || writing.length)
        throw new Error("local rows remain");
      void captureProductEvent("usage_history_deleted", { scope: "local" });
      confirmLocal.value = false;
      message.value =
        "Local usage and writing-activity history was removed from this browser.";
      await props.onLocalDeleted$?.();
    } catch {
      message.value =
        "Local deletion could not be verified. Reload the page before trying again.";
    } finally {
      busy.value = false;
    }
  });
  const deleteSynchronized = $(async () => {
    if (!props.onSynchronizedDelete$) return;
    busy.value = true;
    try {
      await props.onSynchronizedDelete$();
      void captureProductEvent("usage_history_deleted", {
        scope: "synchronized",
      });
      confirmRemote.value = false;
      message.value =
        "Synchronized usage deletion was scheduled. Background removal has started.";
    } catch {
      message.value =
        "Synchronized deletion was not scheduled; nothing changed.";
    } finally {
      busy.value = false;
    }
  });

  return (
    <section aria-labelledby="data-controls-heading">
      <h2
        id="data-controls-heading"
        class="text-base font-semibold mb-1"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Your data
      </h2>
      {props.accountId && (
        <div class="mt-4">
          <ExportEverything />
        </div>
      )}
      <p class="mt-6 max-w-2xl text-xs text-[var(--color-ink-light)]">
        Usage history is the record behind My Desk. Its exports contain usage
        metadata and may include token counts. They structurally exclude
        manuscripts, prompts, responses, and API credentials.
      </p>
      <div class="mt-5 grid gap-5 lg:grid-cols-3">
        <div class="border-t border-[var(--color-ink)] pt-3">
          <h3 class="font-display text-sm font-semibold">
            Export usage history
          </h3>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              class="btn-paper"
              disabled={busy.value}
              onClick$={() => exportHistory("json")}
            >
              JSON
            </button>
            <button
              type="button"
              class="btn-paper"
              disabled={busy.value}
              onClick$={() => exportHistory("csv")}
            >
              CSV
            </button>
          </div>
        </div>
        <div class="border-t border-[var(--color-ink)] pt-3">
          <h3 class="font-display text-sm font-semibold">Combine devices</h3>
          {props.accountId ? (
            <>
              <button
                type="button"
                class="btn-paper mt-3"
                disabled={busy.value}
                onClick$={toggleSync}
              >
                {readiness.value.status === "ready"
                  ? "Stop usage sync"
                  : "Enable usage sync"}
              </button>
              {readiness.value.status === "account_choice_required" && (
                <div class="mt-3 text-sm">
                  <p>
                    This browser was associated with another account. Choose how
                    unsynchronized rows should be handled.
                  </p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <button
                      class="btn-paper"
                      type="button"
                      disabled={busy.value}
                      onClick$={() => resolveSwitch("attach-unsynchronized")}
                    >
                      Attach to this account
                    </button>
                    <button
                      class="btn-paper"
                      type="button"
                      disabled={busy.value}
                      onClick$={() => resolveSwitch("keep-device-only")}
                    >
                      Keep device-only
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p class="mt-3 text-sm text-[var(--color-ink-muted)]">
              Sign in to explicitly combine content-free usage across devices.
            </p>
          )}
        </div>
        <div class="border-t border-[var(--color-ink)] pt-3">
          <h3 class="font-display text-sm font-semibold">Delete history</h3>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn-paper"
              disabled={busy.value}
              onClick$={() => {
                confirmLocal.value = true;
              }}
            >
              This device
            </button>
            <button
              type="button"
              class="btn-paper"
              disabled={busy.value || !props.onSynchronizedDelete$}
              onClick$={() => {
                confirmRemote.value = true;
              }}
            >
              Synchronized
            </button>
          </div>
          {!props.onSynchronizedDelete$ && props.accountId && (
            <p class="mt-2 text-xs text-[var(--color-ink-muted)]">
              Synchronized deletion is unavailable until the account endpoint is
              ready.
            </p>
          )}
        </div>
      </div>
      {confirmLocal.value && (
        <div
          role="alertdialog"
          aria-label="Confirm local usage deletion"
          class="mt-5 border border-[var(--color-vermilion)] p-4 text-sm"
        >
          <p>
            Delete local usage and writing-activity history from this browser?
            This cannot be undone.
          </p>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              class="btn-press"
              disabled={busy.value}
              onClick$={deleteLocal}
            >
              Delete local history
            </button>
            <button
              type="button"
              class="btn-paper"
              disabled={busy.value}
              onClick$={() => {
                confirmLocal.value = false;
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmRemote.value && (
        <div
          role="alertdialog"
          aria-label="Confirm synchronized usage deletion"
          class="mt-5 border border-[var(--color-vermilion)] p-4 text-sm"
        >
          <p>
            Delete synchronized usage history from this account? Local browser
            rows remain unless you remove them separately.
          </p>
          <div class="mt-3 flex gap-2">
            <button
              type="button"
              class="btn-press"
              disabled={busy.value}
              onClick$={deleteSynchronized}
            >
              Delete synchronized history
            </button>
            <button
              type="button"
              class="btn-paper"
              disabled={busy.value}
              onClick$={() => {
                confirmRemote.value = false;
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {message.value && (
        <p class="mt-4 text-sm" role="status">
          {message.value}
        </p>
      )}
    </section>
  );
});
