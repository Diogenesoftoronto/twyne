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

import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { type DocumentHead, useLocation, Link } from "@builder.io/qwik-city";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";

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

export default component$(() => {
  const loc = useLocation();
  const clientSig = useConvexClient();
  const profile = useSignal<Profile | null>(null);
  const posts = useSignal<PublishedSummary[]>([]);
  const isLoading = useSignal(true);
  const missing = useSignal(false);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const handle = (loc.params.handle ?? "").toLowerCase();
    const client = clientSig.value;
    if (!client || !handle) {
      isLoading.value = false;
      return;
    }
    try {
      const [profileData, postData] = await Promise.all([
        client.query(api.profiles.getProfile, { handle }) as Promise<
          Profile | null
        >,
        client.query(api.published.listByHandle, { handle }) as Promise<
          PublishedSummary[]
        >,
      ]);
      if (!profileData) {
        missing.value = true;
        isLoading.value = false;
        return;
      }
      profile.value = profileData;
      posts.value = postData;
    } catch {
      missing.value = true;
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
            <Link
              href="/"
              class="hover:text-[var(--color-vermilion)]"
            >
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
                    href={`/${handle}/${post.slug}`}
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

export const head: DocumentHead = ({ params }) => ({
  title: `Twyne · @${params.handle ?? "writer"}`,
  meta: [
    {
      name: "description",
      content: `Writing by @${params.handle ?? ""} on Twyne.`,
    },
    { property: "og:title", content: `Twyne · @${params.handle ?? "writer"}` },
  ],
});
