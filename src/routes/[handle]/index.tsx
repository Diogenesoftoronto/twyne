/**
 * The writer's public profile. Canonical URL: /<handle>
 *
 * Reverse-chronological list of the writer's published "post" pieces. The
 * blog feed is separate (`/blog`), so a writer who is also an admin sees
 * their admin-authored posts on `/blog`, and everything else they've
 * published here.
 *
 * No auth. The profile (handle + display name + bio) is loaded first; the
 * piece list follows. A missing handle renders the same shape as an empty
 * profile, to avoid user enumeration.
 */

import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import {
  type DocumentHead,
  useLocation,
  Link,
  routeLoader$,
} from "@qwik.dev/router";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import {
  WritingHeatmap,
  type ActivityDay,
} from "../../components/profile/writing-heatmap";
import {
  loadPublicWriterProfile,
  type PublicWriterProfileLoaderData,
} from "../../utils/published-metadata";

interface Profile {
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
}

interface PublishedSummary {
  slug: string;
  ownerHandle: string | null;
  title: string;
  briefSummary: string | null;
  publishedAt: number;
}

interface PublicProfileStats {
  writingHeatmap?: ActivityDay[];
  writingHeatmapTruncated?: boolean;
  daysWritten30?: number;
  streak?: number;
  streakKind?: "current" | "longest";
  streakTruncated?: boolean;
  publicPieceCount?: number;
  publicPieceCountTruncated?: boolean;
  folioCount?: number;
  folioCountTruncated?: boolean;
}

export const useWriterProfile = routeLoader$(
  async ({ params, status }): Promise<PublicWriterProfileLoaderData> => {
    const handle = (params.handle ?? "").toLowerCase();
    if (!handle) {
      status(404);
      return { profile: null, posts: [], status: "loaded" };
    }

    const result = await loadPublicWriterProfile(handle);
    if (result.status === "loaded" && !result.profile) status(404);
    return result;
  },
);

export default component$(() => {
  const loadedProfile = useWriterProfile();
  const loc = useLocation();
  const clientSig = useConvexClient();
  const profile = useSignal<Profile | null>(loadedProfile.value.profile);
  const posts = useSignal<PublishedSummary[]>(loadedProfile.value.posts);
  const publicStats = useSignal<PublicProfileStats | null>(null);
  const isLoading = useSignal(loadedProfile.value.status === "unavailable");
  const missing = useSignal(
    loadedProfile.value.status === "loaded" && !loadedProfile.value.profile,
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const handle = (loc.params.handle ?? "").toLowerCase();
    const client = clientSig.value;
    if (!client || !handle) {
      isLoading.value = false;
      return;
    }
    try {
      if (loadedProfile.value.status === "loaded") {
        publicStats.value = await client.query(api.usage.getPublicStats, {
          handle,
          now: Date.now(),
        });
        return;
      }

      const [profileData, postData, statsData] = await Promise.all([
        client.query(api.profiles.getProfile, {
          handle,
        }) as Promise<Profile | null>,
        client.query(api.published.listByHandle, { handle }) as Promise<
          PublishedSummary[]
        >,
        client.query(api.usage.getPublicStats, {
          handle,
          now: Date.now(),
        }) as Promise<PublicProfileStats | null>,
      ]);
      if (!profileData) {
        missing.value = true;
        isLoading.value = false;
        return;
      }
      profile.value = profileData;
      posts.value = postData;
      publicStats.value = statsData;
    } catch {
      if (loadedProfile.value.status === "unavailable") {
        missing.value = true;
      }
    } finally {
      isLoading.value = false;
    }
  });

  const handle = (loc.params.handle ?? "").toLowerCase();

  return (
    <main class="min-h-screen bg-[var(--color-paper)] text-[var(--color-ink)]">
      <header class="border-b border-[var(--color-paper-3)]">
        <div class="mx-auto max-w-2xl px-6 pt-10 pb-8">
          <p
            class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-2"
            style="font-family: var(--font-typewriter);"
          >
            <Link href="/" class="hover:text-[var(--color-vermilion)]">
              ← Twyne
            </Link>
          </p>
          {isLoading.value && (
            <p
              class="text-sm text-[var(--color-ink-muted)]"
              style="font-family: var(--font-typewriter); letter-spacing: 0.16em; text-transform: uppercase;"
            >
              Loading the desk…
            </p>
          )}
          {missing.value && !isLoading.value && (
            <>
              <h1
                class="text-3xl text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 700;"
              >
                No writer by that handle.
              </h1>
              <p
                class="mt-2 text-sm text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif);"
              >
                If you arrived here from an old link, the writer may have
                changed their handle.
              </p>
            </>
          )}
          {profile.value && (
            <>
              <div class="flex items-center gap-4">
                {profile.value.avatarUrl && (
                  <img
                    src={profile.value.avatarUrl}
                    alt={`${profile.value.displayName || profile.value.handle}'s profile picture`}
                    width="64"
                    height="64"
                    class="h-16 w-16 flex-shrink-0 rounded-full border border-[var(--color-paper-3)] object-cover"
                  />
                )}
                <h1
                  class="text-3xl text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 700;"
                >
                  {profile.value.displayName || `@${profile.value.handle}`}
                </h1>
              </div>
              <p
                class="mt-1 text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                twyne.love/{profile.value.handle}
              </p>
              {profile.value.bio && (
                <p
                  class="mt-3 text-base text-[var(--color-ink-light)] leading-relaxed"
                  style="font-family: var(--font-serif);"
                >
                  {profile.value.bio}
                </p>
              )}
            </>
          )}
        </div>
      </header>

      {profile.value &&
        publicStats.value &&
        Object.keys(publicStats.value).length > 0 && (
          <div class="border-b border-[var(--color-paper-3)]">
            <div class="mx-auto max-w-2xl px-6 py-8">
              <p
                class="text-[11px] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-3"
                style="font-family: var(--font-typewriter);"
              >
                Writing
              </p>
              <div
                class="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif);"
              >
                {publicStats.value.daysWritten30 !== undefined && (
                  <span>
                    wrote on {publicStats.value.daysWritten30} of the last 30
                    days
                  </span>
                )}
                {publicStats.value.streak !== undefined && (
                  <span>
                    {publicStats.value.streakKind === "longest"
                      ? "longest"
                      : "current"}{" "}
                    streak: {publicStats.value.streak}{" "}
                    {publicStats.value.streak === 1 ? "day" : "days"}
                    {publicStats.value.streakTruncated ? " or more" : ""}
                  </span>
                )}
                {publicStats.value.publicPieceCount !== undefined && (
                  <span>
                    {publicStats.value.publicPieceCount}
                    {publicStats.value.publicPieceCountTruncated
                      ? "+"
                      : ""}{" "}
                    published{" "}
                    {publicStats.value.publicPieceCount === 1
                      ? "piece"
                      : "pieces"}
                  </span>
                )}
                {publicStats.value.folioCount !== undefined && (
                  <span>
                    {publicStats.value.folioCount}
                    {publicStats.value.folioCountTruncated ? "+" : ""}{" "}
                    {publicStats.value.folioCount === 1 ? "piece" : "pieces"} on
                    the desk
                  </span>
                )}
              </div>
              {publicStats.value.writingHeatmap && (
                <>
                  <WritingHeatmap days={publicStats.value.writingHeatmap} />
                  {publicStats.value.writingHeatmapTruncated && (
                    <p
                      class="mt-2 text-[0.65rem] text-[var(--color-ink-muted)]"
                      style="font-family: var(--font-typewriter);"
                    >
                      Showing the most recent activity.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

      <div class="mx-auto max-w-2xl px-6 py-10">
        {profile.value && posts.value.length === 0 && (
          <p
            class="text-sm text-[var(--color-ink-muted)] italic"
            style="font-family: var(--font-serif);"
          >
            Nothing published yet.
          </p>
        )}
        {posts.value.length > 0 && (
          <ul class="space-y-8">
            {posts.value.map((post) => (
              <li key={post.slug}>
                <p
                  class="text-[10px] tracking-[0.2em] uppercase text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  {formatDate(post.publishedAt)}
                </p>
                <h2
                  class="mt-1 text-2xl text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 700;"
                >
                  <Link
                    href={`/${handle}/${post.slug}/`}
                    class="hover:text-[var(--color-vermilion)]"
                  >
                    {post.title}
                  </Link>
                </h2>
                {post.briefSummary && (
                  <p
                    class="mt-1 text-sm text-[var(--color-ink-light)] leading-relaxed"
                    style="font-family: var(--font-serif);"
                  >
                    {post.briefSummary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
});

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export const head: DocumentHead = ({ params, resolveValue }) => {
  const { profile } = resolveValue(useWriterProfile);
  const handle = profile?.handle ?? params.handle ?? "writer";
  const byline = profile?.displayName
    ? `${profile.displayName} (@${handle})`
    : `@${handle}`;
  const title = `${byline} — Writing on Twyne`;
  const description =
    profile?.bio?.trim() || `Published writing by @${handle} on Twyne.`;

  return {
    title,
    meta: [
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  };
};
