import { $, component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { api } from "../../../convex/_generated/api";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { downloadAccountExport } from "../../utils/account-export";

interface ExportStatus {
  status: "running" | "ready" | "failed";
  createdAt: number;
  expiresAt: number;
  bytes: number | null;
  rowCount: number | null;
  error: string | null;
  url: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * One zip of everything the account holds: synced rows and files built on the
 * server, plus this browser's local-only data added at download time.
 */
export const ExportEverything = component$(() => {
  const auth = useAuth();
  const convex = useConvexClient();
  const latest = useSignal<ExportStatus | null>(null);
  const busy = useSignal(false);
  const message = useSignal("");
  // Download as soon as an export this page started is ready.
  const awaiting = useSignal(false);

  const download = $(async (url: string) => {
    busy.value = true;
    message.value = "Adding this device's data and saving the archive…";
    try {
      await downloadAccountExport(url);
      message.value = "Export downloaded.";
    } catch {
      message.value =
        "The archive could not be downloaded. Try the download button again.";
    } finally {
      busy.value = false;
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const identity = track(() =>
      hasAuthenticatedConvexIdentity(auth.value) ? auth.value.user?.id : null,
    );
    const client = track(() => convex.value);
    latest.value = null;
    if (!identity || !client) return;
    cleanup(
      client.onUpdate(
        api.accountExport.getMyLatestExport,
        {},
        (row) => {
          latest.value = row;
          if (!awaiting.value || !row || row.status === "running") return;
          awaiting.value = false;
          if (row.status === "ready" && row.url) void download(row.url);
          else message.value = row.error ?? "The export could not be built.";
        },
        () => undefined,
      ),
    );
  });

  const start = $(async () => {
    const client = convex.value;
    if (!client || busy.value) return;
    message.value = "";
    try {
      await client.mutation(api.accountExport.requestExport, {});
      awaiting.value = true;
    } catch {
      message.value = "The export could not be started. Try again.";
    }
  });

  const current = latest.value;
  const running = current?.status === "running" || awaiting.value;

  return (
    <div class="border-t border-[var(--color-ink)] pt-3">
      <h3 class="font-display text-sm font-semibold">Export everything</h3>
      <p class="mt-1 max-w-2xl text-xs text-[var(--color-ink-light)]">
        A zip of your manuscripts and their version history, briefs, personas,
        notes, comments, citations, published pieces, profile, settings, usage
        history, and Not Organic achievements. API keys and token secrets are
        never included.
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-paper"
          disabled={running || busy.value}
          onClick$={start}
        >
          {running ? "Preparing export…" : "Export everything"}
        </button>
        {current?.status === "ready" && current.url && !running && (
          <button
            type="button"
            class="text-xs underline disabled:opacity-50"
            disabled={busy.value}
            onClick$={() => download(current.url!)}
          >
            Download the {new Date(current.createdAt).toLocaleString()} export
            {current.bytes ? ` (${formatBytes(current.bytes)})` : ""}
          </button>
        )}
      </div>
      {current?.status === "ready" && !running && (
        <p class="mt-2 text-xs text-[var(--color-ink-muted)]">
          Kept until {new Date(current.expiresAt).toLocaleString()}, then
          deleted.
        </p>
      )}
      {message.value && (
        <p class="mt-2 text-sm" role="status">
          {message.value}
        </p>
      )}
    </div>
  );
});
