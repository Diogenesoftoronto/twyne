import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import type { RecentWorkEntry } from "../../utils/usage-summary";
import { saveActiveFolioIdToIdb } from "../../utils/idb";

export const RecentWork = component$<{
  entries: RecentWorkEntry[];
  folioTitles: Record<string, string>;
}>((props) => (
  <section
    aria-labelledby="recent-work-heading"
    class="border-t-2 border-[var(--color-ink)] py-7"
  >
    <p class="dept-label">04 / Return</p>
    <h2 id="recent-work-heading" class="mt-1 font-display text-2xl">
      Recent work
    </h2>
    {!props.entries.length ? (
      <p class="mt-4 text-sm text-[var(--color-ink-muted)]">
        No local folios have activity in this range.
      </p>
    ) : (
      <ol class="mt-4 divide-y divide-dotted divide-[var(--color-ink-muted)] border-y border-[var(--color-ink)]">
        {props.entries.map((entry) => (
          <li
            key={entry.folioId}
            class="grid items-center gap-2 py-3 sm:grid-cols-[1fr_auto_auto]"
          >
            <div>
              <p class="font-display text-lg">
                {props.folioTitles[entry.folioId] ?? "Untitled local folio"}
              </p>
              <p class="text-xs text-[var(--color-ink-muted)]">
                {entry.currentWords.toLocaleString()} words · {entry.activeDays}{" "}
                active days · {entry.editorialActions} actions
              </p>
            </div>
            <time
              class="text-xs tabular-nums text-[var(--color-ink-muted)]"
              dateTime={new Date(entry.lastActiveAt).toISOString()}
            >
              {new Date(entry.lastActiveAt).toLocaleDateString()}
            </time>
            <Link
              href="/editor/"
              class="btn-paper"
              onClick$={() => saveActiveFolioIdToIdb(entry.folioId)}
            >
              Open folio
            </Link>
          </li>
        ))}
      </ol>
    )}
  </section>
));
