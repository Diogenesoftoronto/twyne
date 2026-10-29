import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import {
  getNotOrganicAchievements,
  type NotOrganicAchievement,
} from "../../utils/notorganic-provider";

const PORTAL_ACHIEVEMENTS_URL =
  "https://id.notorganic.info/?view=achievements&product=twyne";

/** Achievements earned across Not Organic applications, read from its ledger. */
export const NotOrganicAchievements = component$(() => {
  const auth = useAuth();
  const convex = useConvexClient();
  const awards = useSignal<NotOrganicAchievement[] | null>(null);
  const failed = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const identity = track(() =>
      hasAuthenticatedConvexIdentity(auth.value) ? auth.value.user?.id : null,
    );
    const client = track(() => convex.value);
    let cancelled = false;
    cleanup(() => {
      cancelled = true;
    });
    awards.value = null;
    failed.value = false;
    if (!identity || !client) return;
    try {
      const result = await getNotOrganicAchievements(client);
      if (!cancelled) awards.value = result;
    } catch {
      if (!cancelled) failed.value = true;
    }
  });

  return (
    <div>
      <div class="flex items-baseline justify-between gap-3">
        <h3
          class="text-sm font-semibold"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Achievements
        </h3>
        <a
          href={PORTAL_ACHIEVEMENTS_URL}
          target="_blank"
          rel="noopener"
          class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline"
          style={{ fontFamily: "var(--font-typewriter)" }}
        >
          All on Not Organic →
        </a>
      </div>
      {failed.value ? (
        <p class="mt-2 text-xs text-[var(--color-ink-light)]">
          Achievements could not be loaded from Not Organic right now.
        </p>
      ) : awards.value === null ? (
        <p class="mt-2 text-xs text-[var(--color-ink-muted)]">
          Loading achievements…
        </p>
      ) : awards.value.length === 0 ? (
        <p class="mt-2 text-xs text-[var(--color-ink-light)]">
          No achievements yet. They appear here as you earn them in Twyne and
          other Not Organic apps.
        </p>
      ) : (
        <ul class="mt-3 grid gap-3 sm:grid-cols-2">
          {awards.value.map((award) => (
            <li
              key={award.id}
              class="flex items-start gap-3 border border-[var(--color-paper-3)] p-3"
            >
              {award.imageUrl && (
                <img
                  src={award.imageUrl}
                  alt=""
                  width="40"
                  height="40"
                  class="h-10 w-10 flex-shrink-0 object-contain"
                  loading="lazy"
                />
              )}
              <div class="min-w-0">
                <p
                  class="text-sm text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {award.title}
                </p>
                <p class="mt-0.5 text-xs text-[var(--color-ink-light)]">
                  {award.description}
                </p>
                <p
                  class="mt-1 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {award.application && award.application !== "twyne"
                    ? `${award.application} · `
                    : ""}
                  {new Date(award.awardedAt).toLocaleDateString()}
                  {award.recordUrl && (
                    <>
                      {" · "}
                      <a href={award.recordUrl} class="underline">
                        Public record
                      </a>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
