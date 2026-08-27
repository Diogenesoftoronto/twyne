import {
  $,
  component$,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@builder.io/qwik";
import { Link, type DocumentHead } from "@builder.io/qwik-city";
import { api } from "../../../convex/_generated/api";
import { DataControls } from "../../components/desk/data-controls";
import {
  combinedDataIsPartial,
  combineDeskUsage,
  type ServerBreakdownRow,
  type ServerDailyUsage,
  type ServerUsageMetrics,
  type ServerWritingActivity,
} from "../../components/desk/desk-data";
import {
  DeskSummary,
  type SynchronizedCoverage,
} from "../../components/desk/desk-summary";
import { RecentWork } from "../../components/desk/recent-work";
import { UsageCost } from "../../components/desk/usage-cost";
import { WriterPatterns } from "../../components/desk/writer-patterns";
import { WritingActivity } from "../../components/desk/writing-activity";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { loadFolioContentFromIdb, loadFoliosFromIdb } from "../../utils/idb";
import {
  captureProductEvent,
  countDraftWords,
} from "../../utils/product-analytics";
import {
  createUsageRange,
  type UsageEvent,
  type UsageRange,
  type UsageRangePreset,
} from "../../utils/usage-domain";
import { usageLedger } from "../../utils/usage-ledger";
import {
  buildUsageSummary,
  type FolioUsageMetadata,
  type UsageSummary,
} from "../../utils/usage-summary";

const RANGE_LABELS: Record<UsageRangePreset, string> = {
  "7d": "Last 7 UTC days",
  "30d": "Last 30 UTC days",
  "90d": "Last 90 UTC days",
  all: "All recorded usage",
};
const MAX_LOCAL_PAGES = 20;
const MAX_REMOTE_PAGES = 10;

interface DeskStore {
  summary: UsageSummary;
  titles: Record<string, string>;
  folioCount: number;
  writingDays: number;
  eventCount: number;
  loaded: boolean;
  detailsTruncated: boolean;
  combinedPartial: boolean;
  remoteState: "idle" | "loading" | "ready" | "offline" | "error";
  synchronized?: SynchronizedCoverage;
}

interface EventPage {
  events: UsageEvent[];
  truncated: boolean;
}

async function listLocalEvents(range: UsageRange): Promise<EventPage> {
  const events: UsageEvent[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await usageLedger.listUsageEvents({
      from: range.from,
      to: range.to,
      cursor,
    });
    events.push(...page.events);
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < MAX_LOCAL_PAGES);
  return { events, truncated: Boolean(cursor) };
}

async function listPendingEvents(
  accountId: string,
  range: UsageRange,
): Promise<EventPage> {
  const events: UsageEvent[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await usageLedger.listPendingUsageEvents({
      accountId,
      cursor,
      limit: 100,
    });
    events.push(
      ...page.events.filter(
        (event) =>
          event.occurredAt < range.to &&
          (range.from === null || event.occurredAt >= range.from),
      ),
    );
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < MAX_LOCAL_PAGES);
  return { events, truncated: Boolean(cursor) };
}

async function folioMetadata() {
  const folios = await loadFoliosFromIdb();
  const metadata: FolioUsageMetadata[] = await Promise.all(
    folios.map(async (folio) => ({
      folioId: folio.id,
      currentWords: countDraftWords(await loadFolioContentFromIdb(folio.id)),
      updatedAt: folio.updatedAt,
    })),
  );
  return { folios, metadata };
}

export default component$(() => {
  const now = Date.now();
  const auth = useAuth();
  const clientSignal = useConvexClient();
  const preset = useSignal<UsageRangePreset>("30d");
  const revision = useSignal(0);
  const deskViewCaptured = useSignal(false);
  const initialRange = createUsageRange("30d", now);
  const store = useStore<DeskStore>({
    summary: buildUsageSummary({
      events: [],
      activities: [],
      range: initialRange,
      now,
    }),
    titles: {},
    folioCount: 0,
    writingDays: 0,
    eventCount: 0,
    loaded: false,
    detailsTruncated: false,
    combinedPartial: false,
    remoteState: "idle",
  });

  // Validate the URL before the ledger tasks react to a non-default range.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const value = new URLSearchParams(location.search).get("range");
    if (value === "7d" || value === "30d" || value === "90d" || value === "all")
      preset.value = value;
    else if (value !== null)
      history.replaceState(history.state, "", "/desk/?range=30d");
  });

  // Local-first paint: this never waits for auth, network, or Convex.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup, track }) => {
    const selectedPreset = track(() => preset.value);
    track(() => revision.value);
    let cancelled = false;
    cleanup(() => {
      cancelled = true;
    });
    store.loaded = false;
    const loadedAt = Date.now();
    const range = createUsageRange(selectedPreset, loadedAt);
    const [{ events, truncated }, localFolios, activities] = await Promise.all([
      listLocalEvents(range),
      folioMetadata(),
      usageLedger.listWritingActivity({
        from: range.from ?? 0,
        to: range.to,
        limit: 2_000,
      }),
    ]);
    if (cancelled) return;
    store.titles = Object.fromEntries(
      localFolios.folios.map((folio) => [folio.id, folio.name]),
    );
    store.folioCount = localFolios.folios.length;
    store.eventCount = events.length;
    store.detailsTruncated = truncated || activities.length === 2_000;
    store.combinedPartial = false;
    const summary = buildUsageSummary({
      events,
      activities,
      folios: localFolios.metadata,
      range,
      now: loadedAt,
    });
    store.summary = summary;
    store.writingDays = summary.writingHeatmap.filter(
      (day) => day.count > 0,
    ).length;
    store.loaded = true;
  });

  // Signed-in rebase: server aggregates are authoritative; only pending local
  // events are added so already-synchronized browser rows cannot double count.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup, track }) => {
    const client = track(() => clientSignal.value);
    const provider = track(() => auth.value.provider);
    const user = track(() => auth.value.user);
    const loading = track(() => auth.value.loading);
    const selectedPreset = track(() => preset.value);
    const localLoaded = track(() => store.loaded);
    let cancelled = false;
    cleanup(() => {
      cancelled = true;
    });
    if (loading || provider !== "convex" || !user || !client || !localLoaded) {
      store.remoteState =
        typeof navigator !== "undefined" && !navigator.onLine
          ? "offline"
          : "idle";
      store.synchronized = undefined;
      return;
    }
    const accountId = user.analyticsId;
    if (!accountId || !navigator.onLine) {
      store.remoteState = navigator.onLine ? "error" : "offline";
      return;
    }
    store.remoteState = "loading";
    const queriedAt = Date.now();
    const requested = createUsageRange(selectedPreset, queriedAt);
    const recent =
      selectedPreset === "all" ? createUsageRange("90d", queriedAt) : requested;
    const loadBreakdown = async (
      dimension: "feature" | "provider_model" | "folio",
    ) => {
      const rows: ServerBreakdownRow[] = [];
      let cursor: string | null = null;
      let isDone = false;
      let pages = 0;
      while (!isDone && pages < MAX_REMOTE_PAGES) {
        const result = (await client.query(api.usage.getMyBreakdown, {
          from: requested.from,
          to: requested.to,
          now: queriedAt,
          dimension,
          paginationOpts: { numItems: 100, cursor },
        })) as unknown as {
          page: ServerBreakdownRow[];
          isDone: boolean;
          continueCursor: string;
        };
        rows.push(...result.page);
        cursor = result.continueCursor;
        isDone = result.isDone;
        pages += 1;
      }
      return { rows, truncated: !isDone };
    };
    try {
      const [
        coverage,
        remoteOverall,
        remoteDaily,
        remoteWriting,
        feature,
        providerModel,
        folio,
        recentPage,
        pending,
        localActivities,
        localFolios,
      ] = await Promise.all([
        client.query(api.usage.getMyCoverage, {}),
        client.query(api.usage.getMySummary, {
          from: requested.from,
          to: requested.to,
          now: queriedAt,
        }),
        client.query(api.usage.getMyDaily, {
          from: recent.from!,
          to: recent.to,
        }),
        client.query(api.writingActivity.getMyActivity, {
          from: recent.from!,
          to: recent.to,
        }),
        loadBreakdown("feature"),
        loadBreakdown("provider_model"),
        loadBreakdown("folio"),
        client.query(api.usage.listMyRecent, {
          paginationOpts: { numItems: 100, cursor: null },
        }),
        listPendingEvents(accountId, requested),
        usageLedger.listWritingActivity({
          from: requested.from ?? recent.from!,
          to: requested.to,
          limit: 2_000,
        }),
        folioMetadata(),
      ]);
      const boundedRecent = recentPage as unknown as {
        page: UsageEvent[];
        isDone: boolean;
      };
      if (cancelled) return;
      const summary = combineDeskUsage({
        range: requested,
        now: queriedAt,
        remoteOverall: remoteOverall as ServerUsageMetrics,
        remoteDaily: remoteDaily as ServerDailyUsage[],
        remoteBreakdowns: {
          feature: feature.rows,
          provider_model: providerModel.rows,
          folio: folio.rows,
        },
        remoteWriting: remoteWriting as ServerWritingActivity,
        recentServerEvents: boundedRecent.page,
        pendingEvents: pending.events,
        localActivities,
        folios: localFolios.metadata,
      });
      store.summary = summary;
      store.writingDays = summary.writingHeatmap.filter(
        (day) => day.count > 0,
      ).length;
      store.synchronized = coverage as SynchronizedCoverage;
      store.combinedPartial = combinedDataIsPartial([
        feature.truncated,
        providerModel.truncated,
        folio.truncated,
        !boundedRecent.isDone,
        pending.truncated,
        localActivities.length === 2_000,
        (remoteWriting as ServerWritingActivity).detailsTruncated,
      ]);
      store.remoteState = "ready";
    } catch {
      if (!cancelled)
        store.remoteState = navigator.onLine ? "error" : "offline";
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const loading = track(() => auth.value.loading);
    const signedIn = track(
      () => auth.value.provider === "convex" && Boolean(auth.value.user),
    );
    const range = track(() => preset.value);
    if (loading || deskViewCaptured.value) return;
    deskViewCaptured.value = true;
    void captureProductEvent("desk_viewed", {
      signed_in: signedIn,
      range,
    });
  });

  const selectRange = $((range: UsageRangePreset) => {
    preset.value = range;
    history.replaceState(history.state, "", `/desk/?range=${range}`);
    void captureProductEvent("usage_range_changed", { range });
  });
  const reloadLocal = $(() => {
    revision.value += 1;
  });
  const deleteSynchronized = $(async () => {
    const client = clientSignal.value;
    if (!client || auth.value.provider !== "convex")
      throw new Error("Synchronized deletion requires a signed-in account");
    await client.mutation(api.usage.deleteMyUsageHistory, {});
    store.synchronized = undefined;
  });

  const sourceState = !store.loaded
    ? "loading"
    : store.detailsTruncated ||
        store.combinedPartial ||
        store.remoteState === "error"
      ? "partial"
      : store.remoteState === "offline"
        ? "offline"
        : store.remoteState === "ready"
          ? "combined"
          : "local";
  const accountId =
    auth.value.provider === "convex" ? auth.value.user?.analyticsId : undefined;

  return (
    <main class="min-h-screen bg-[var(--color-paper)] px-4 py-8 text-[var(--color-ink)] sm:px-8">
      <div class="mx-auto max-w-6xl">
        <nav
          aria-label="Desk navigation"
          class="mb-5 flex items-center justify-between border-b border-dotted border-[var(--color-ink-muted)] pb-3 text-xs"
        >
          <Link href="/editor/" class="hover:text-[var(--color-vermilion)]">
            ← Writing room
          </Link>
          <Link href="/settings/" class="hover:text-[var(--color-vermilion)]">
            Preferences
          </Link>
        </nav>
        <DeskSummary
          displayName={
            auth.value.user?.name ??
            auth.value.atproto?.displayName ??
            "Writer on this device"
          }
          signedIn={auth.value.provider === "convex"}
          rangeLabel={RANGE_LABELS[preset.value]}
          writingDays={store.writingDays}
          folioCount={store.folioCount}
          metrics={store.summary.overall}
          sourceState={sourceState}
          combined={store.remoteState === "ready"}
          writingDaysLabel={
            preset.value === "all" ? "Days writing (recent 90)" : undefined
          }
          synchronized={store.synchronized}
        />
        <nav
          class="flex flex-wrap items-center gap-2 border-b border-dotted border-[var(--color-ink-muted)] py-4"
          aria-label="Usage range"
        >
          <span class="mr-2 text-xs font-semibold tracking-[0.1em] uppercase text-[var(--color-ink-muted)]">
            Range
          </span>
          {(["7d", "30d", "90d", "all"] as UsageRangePreset[]).map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={preset.value === range}
              class={{
                "btn-paper": true,
                "bg-[var(--color-ink)] text-[var(--color-paper)]":
                  preset.value === range,
              }}
              onClick$={() => selectRange(range)}
            >
              {range === "all" ? "All" : range.slice(0, -1)}
            </button>
          ))}
        </nav>
        {!store.loaded ? (
          <div class="py-20" role="status">
            <p class="dept-label">Reading the ledger</p>
            <div class="mt-4 h-px w-full animate-pulse bg-[var(--color-ink-muted)]" />
          </div>
        ) : (
          <>
            <WritingActivity
              days={store.summary.writingHeatmap}
              daily={store.summary.daily}
              folioTitles={store.titles}
              truncated={store.detailsTruncated || store.combinedPartial}
              windowLabel={
                preset.value === "all"
                  ? "Lifetime totals and breakdowns; daily writing and AI activity below cover the recent 90 UTC days."
                  : undefined
              }
            />
            <UsageCost
              summary={store.summary}
              totalsOnly={preset.value === "all"}
            />
            <WriterPatterns
              patterns={store.summary.patterns}
              folioTitles={store.titles}
            />
            <RecentWork
              entries={store.summary.recentWork}
              folioTitles={store.titles}
            />
            <DataControls
              range={store.summary.range}
              rowCount={store.eventCount}
              accountId={accountId}
              onLocalDeleted$={reloadLocal}
              onSynchronizedDelete$={
                accountId && clientSignal.value ? deleteSynchronized : undefined
              }
            />
          </>
        )}
      </div>
    </main>
  );
});

export const head: DocumentHead = {
  title: "My Desk · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Review your writing activity, content-free AI usage, costs, and data controls.",
    },
  ],
};
