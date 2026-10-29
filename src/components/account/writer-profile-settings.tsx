import { $, component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import { api } from "../../../convex/_generated/api";
import type { AppError } from "../../types/application-errors";
import { ApplicationNotice } from "../ui/application-notice";
import { SiteSelect } from "../ui/site-select";
import { PublicDeskSettings } from "../desk/public-desk";
import { useAuth } from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { EXTRA_ALIAS_PRICE_LABEL } from "../../utils/alias-policy";
import { captureProductEvent } from "../../utils/product-analytics";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";

/** Mirrors `PROFILE_LINK_MAX` in convex/profiles.ts. */
const PROFILE_LINK_MAX = 6;

interface PublicStatsPreferences {
  writingHeatmap: boolean;
  daysWritten30: boolean;
  streak: "off" | "current" | "longest";
  publicPieceCount: boolean;
  folioCount: boolean;
}

interface ProfileLink {
  label: string;
  url: string;
}

interface WriterProfileStore {
  handleLoaded: boolean;
  handle: string | null;
  handleDraft: string;
  ownedAliases: string[];
  additionalAliasDraft: string;
  additionalAliasRequests: string[];
  handleBusy: boolean;
  handleError: AppError | string | null;
  handleToast: string | null;
  handleCheck: {
    available: boolean;
    handle?: string;
    error?: AppError;
  } | null;
  handleCheckBusy: boolean;
  profileDisplayName: string;
  profileBio: string;
  profileLinks: ProfileLink[];
  profileBusy: boolean;
  profileToast: string | null;
  publicStats: PublicStatsPreferences;
  publicStatsBusy: boolean;
  publicStatsToast: string | null;
  /** Resolved URL of the saved profile picture, or null if none. */
  profileAvatarUrl: string | null;
  /** True while an avatar upload/clear round-trip is in flight. */
  profileAvatarBusy: boolean;
}

/**
 * The writer's public identity: their Twyne address (alias), the profile shown
 * at that address, and which writing facts it shares.
 */
export const WriterProfileSettings = component$(() => {
  const convexClientSig = useConvexClient();
  const auth = useAuth();
  const store = useStore<WriterProfileStore>({
    handleLoaded: false,
    handle: null,
    handleDraft: "",
    ownedAliases: [],
    additionalAliasDraft: "",
    additionalAliasRequests: [],
    handleBusy: false,
    handleError: null,
    handleToast: null,
    handleCheck: null,
    handleCheckBusy: false,
    profileDisplayName: "",
    profileBio: "",
    profileLinks: [],
    profileBusy: false,
    profileToast: null,
    publicStats: {
      writingHeatmap: false,
      daysWritten30: false,
      streak: "off",
      publicPieceCount: false,
      folioCount: false,
    },
    publicStatsBusy: false,
    publicStatsToast: null,
    profileAvatarUrl: null,
    profileAvatarBusy: false,
  });

  // ── Writer handle (public identity) ──────────────────────────────
  // The handle is the writer's addressable name on Twyne — it appears in
  // share URLs (/<handle>/<slug>) and profile pages (/<handle>). Claimed
  // once per account; additional aliases require a separate request. The
  // availability check is debounced and runs server-side via
  // `profiles.checkHandleAvailable`.

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    track(() => auth.value.user?.id);
    track(() => convexClientSig.value);
    const client = convexClientSig.value;
    const user = auth.value.user;
    let cancelled = false;
    cleanup(() => {
      cancelled = true;
    });
    store.handle = null;
    store.handleDraft = "";
    store.ownedAliases = [];
    store.additionalAliasDraft = "";
    store.additionalAliasRequests = [];
    store.handleBusy = false;
    store.handleToast = null;
    store.handleError = null;
    store.handleLoaded = false;
    if (!client || !user) {
      store.handleLoaded = true;
      return;
    }
    if (auth.value.provider !== "convex") {
      store.handleLoaded = true;
      return;
    }
    try {
      const row = (await client.query(api.profiles.getMyHandle, {})) as {
        handle: string;
        ownedAliases: string[];
        additionalAliasRequests: Array<{ handle: string }>;
        displayName: string | null;
        bio: string | null;
        avatarUrl: string | null;
        links: ProfileLink[];
        publicStats: PublicStatsPreferences;
      } | null;
      if (
        cancelled ||
        auth.value.user?.id !== user.id ||
        convexClientSig.value !== client
      )
        return;
      store.handle = row?.handle ?? null;
      store.handleDraft = row?.handle ?? "";
      store.ownedAliases = row?.ownedAliases ?? (row ? [row.handle] : []);
      store.additionalAliasRequests =
        row?.additionalAliasRequests.map((request) => request.handle) ?? [];
      store.profileDisplayName = row?.displayName ?? "";
      store.profileBio = row?.bio ?? "";
      store.profileLinks = (row?.links ?? []).map((link) => ({ ...link }));
      store.profileAvatarUrl = row?.avatarUrl ?? null;
      if (row) {
        store.publicStats = { ...row.publicStats };
        // S1 returns the legacy effective preference (heatmap only) for rows
        // that predate sharing controls. Persisting the complete object here
        // turns that compatibility behavior into an explicit, reversible
        // choice the first time the writer opens Account.
        await client.mutation(api.profiles.updatePublicStats, row.publicStats);
      }
    } catch {
      // The Convex client may be in mid-reconnect; we'll retry on next track.
    } finally {
      if (
        !cancelled &&
        auth.value.user?.id === user.id &&
        convexClientSig.value === client
      )
        store.handleLoaded = true;
    }
  });

  // Debounced availability check. Re-fires whenever the draft changes; the
  // server query is the source of truth so reserved words, length, and
  // collisions are all checked there.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const draft = track(() => store.handleDraft);
    const current = track(() => store.handle);
    const client = convexClientSig.value;
    store.handleCheck = null;
    if (!client) return;
    if (!draft.trim() || draft.trim() === current) return;
    store.handleCheckBusy = true;
    const timer = setTimeout(async () => {
      try {
        const result = (await client.query(api.profiles.checkHandleAvailable, {
          handle: draft,
        })) as
          | { available: true; handle: string }
          | { available: false; reason: string };
        store.handleCheck = result.available
          ? result
          : {
              available: false,
              error: normalizeApplicationError(
                {
                  name: "ConvexError",
                  data: { message: result.reason },
                },
                {
                  source: "convex",
                  metadata: { operation: "check-handle" },
                },
              ),
            };
      } catch {
        store.handleCheck = null;
      } finally {
        store.handleCheckBusy = false;
      }
    }, 350);
    return () => clearTimeout(timer);
  });

  const handleClaim = $(async () => {
    const client = convexClientSig.value;
    const ownerId = auth.value.user?.id;
    if (!ownerId || store.handleBusy) return;
    if (!client) {
      store.handleError = createAppError("NETWORK_UNAVAILABLE", {
        source: "convex",
        metadata: { operation: "claim-handle" },
      });
      return;
    }
    store.handleBusy = true;
    store.handleError = null;
    store.handleToast = null;
    try {
      const result = (await client.mutation(api.profiles.claimHandle, {
        handle: store.handleDraft,
      })) as { handle: string; changed: boolean };
      if (auth.value.user?.id !== ownerId || convexClientSig.value !== client)
        return;
      store.handle = result.handle;
      store.handleDraft = result.handle;
      if (result.changed || !store.ownedAliases.length)
        store.ownedAliases = [result.handle];
      store.handleCheck = null;
      store.handleToast = result.changed
        ? `Your Twyne alias is /${result.handle}`
        : "Your existing alias is unchanged.";
      setTimeout(() => (store.handleToast = null), 4000);
    } catch (error) {
      if (auth.value.user?.id !== ownerId || convexClientSig.value !== client)
        return;
      reportApplicationDiagnostic("twyne:account:claim-handle", error, {
        operation: "claim-handle",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "claim-handle" },
      });
    } finally {
      if (auth.value.user?.id === ownerId && convexClientSig.value === client)
        store.handleBusy = false;
    }
  });

  const requestAdditionalAlias = $(async () => {
    const client = convexClientSig.value;
    const ownerId = auth.value.user?.id;
    if (!client || !ownerId || store.handleBusy) return;
    store.handleBusy = true;
    store.handleError = null;
    try {
      const result = await client.mutation(
        api.profiles.requestAdditionalAlias,
        { handle: store.additionalAliasDraft },
      );
      if (auth.value.user?.id !== ownerId || convexClientSig.value !== client)
        return;
      if (!store.additionalAliasRequests.includes(result.handle))
        store.additionalAliasRequests.push(result.handle);
      store.additionalAliasDraft = "";
      store.handleToast = `Request for /${result.handle} is pending review. The price is ${EXTRA_ALIAS_PRICE_LABEL}; no credits have been charged.`;
    } catch (error) {
      if (auth.value.user?.id !== ownerId || convexClientSig.value !== client)
        return;
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "request-additional-alias" },
      });
    } finally {
      if (auth.value.user?.id === ownerId && convexClientSig.value === client)
        store.handleBusy = false;
    }
  });

  const handleSaveProfile = $(async () => {
    const client = convexClientSig.value;
    if (!client) return;
    store.profileBusy = true;
    store.profileToast = null;
    try {
      await client.mutation(api.profiles.updateProfile, {
        displayName: store.profileDisplayName,
        bio: store.profileBio,
        links: store.profileLinks.map(({ label, url }) => ({ label, url })),
      });
      const row = await client.query(api.profiles.getMyHandle, {});
      store.profileLinks = (row?.links ?? []).map((link) => ({ ...link }));
      store.profileToast = "Profile saved.";
      setTimeout(() => (store.profileToast = null), 4000);
    } catch (error) {
      store.profileToast = null;
      // Surface via handle's error channel for visibility.
      reportApplicationDiagnostic("twyne:account:save-profile", error, {
        operation: "save-profile",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "save-profile" },
      });
    } finally {
      store.profileBusy = false;
    }
  });

  const handleSavePublicStats = $(async (next: PublicStatsPreferences) => {
    const client = convexClientSig.value;
    if (!client || store.publicStatsBusy) return;
    const previous = { ...store.publicStats };
    store.publicStats = { ...next };
    store.publicStatsBusy = true;
    store.publicStatsToast = null;
    store.handleError = null;
    try {
      await client.mutation(api.profiles.updatePublicStats, next);
      void captureProductEvent("public_profile_stats_updated", {
        enabled_stat_count:
          Number(next.writingHeatmap) +
          Number(next.daysWritten30) +
          Number(next.publicPieceCount) +
          Number(next.folioCount) +
          Number(next.streak !== "off"),
      });
      store.publicStatsToast = "Public statistics updated.";
      setTimeout(() => (store.publicStatsToast = null), 3000);
    } catch (error) {
      store.publicStats = previous;
      reportApplicationDiagnostic("twyne:account:public-stats", error, {
        operation: "update-public-stats",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "update-public-stats" },
      });
    } finally {
      store.publicStatsBusy = false;
    }
  });

  const handleAvatarSelected = $(async (file: File) => {
    const client = convexClientSig.value;
    if (!client) return;
    if (!file.type.startsWith("image/")) {
      store.handleError = "Choose an image file for your profile picture.";
      return;
    }
    // Keep avatars small; the bucket isn't a CDN for large media.
    if (file.size > 5 * 1024 * 1024) {
      store.handleError = "Profile pictures must be 5 MB or smaller.";
      return;
    }
    store.profileAvatarBusy = true;
    store.handleError = null;
    store.profileToast = null;
    try {
      const uploadUrl = (await client.mutation(
        api.profiles.generateAvatarUploadUrl,
        {},
      )) as string;
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        throw new Error("Upload failed. Try again.");
      }
      const { storageId } = (await res.json()) as { storageId: string };
      await client.mutation(api.profiles.updateProfile, {
        avatarStorageId: storageId as any,
      });
      // Re-read the resolved URL so the preview reflects the stored blob.
      const row = (await client.query(api.profiles.getMyHandle, {})) as {
        avatarUrl: string | null;
      } | null;
      store.profileAvatarUrl = row?.avatarUrl ?? null;
      store.profileToast = "Profile picture updated.";
      setTimeout(() => (store.profileToast = null), 4000);
    } catch (error) {
      reportApplicationDiagnostic("twyne:account:update-avatar", error, {
        operation: "update-avatar",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "update-avatar" },
      });
    } finally {
      store.profileAvatarBusy = false;
    }
  });

  const handleDefaultAvatar = $(async (name: string) => {
    if (store.profileAvatarBusy) return;
    store.profileAvatarBusy = true;
    store.handleError = null;
    try {
      const response = await fetch(
        `/assets/avatars/engraved-2026-09/${name}.avif`,
      );
      if (!response.ok)
        throw new Error("Could not load that portrait. Try again.");
      const blob = await response.blob();
      await handleAvatarSelected(
        new File([blob], `${name}.avif`, { type: "image/avif" }),
      );
    } catch {
      store.handleError = "Could not load that portrait. Try again.";
    } finally {
      store.profileAvatarBusy = false;
    }
  });

  const handleAvatarClear = $(async () => {
    const client = convexClientSig.value;
    if (!client) return;
    store.profileAvatarBusy = true;
    store.handleError = null;
    store.profileToast = null;
    try {
      await client.mutation(api.profiles.updateProfile, {
        avatarStorageId: null,
      });
      store.profileAvatarUrl = null;
      store.profileToast = "Profile picture removed.";
      setTimeout(() => (store.profileToast = null), 4000);
    } catch (error) {
      reportApplicationDiagnostic("twyne:account:remove-avatar", error, {
        operation: "remove-avatar",
      });
      store.handleError = normalizeApplicationError(error, {
        source: "convex",
        metadata: { operation: "remove-avatar" },
      });
    } finally {
      store.profileAvatarBusy = false;
    }
  });

  if (!store.handleLoaded) return null;

  return (
    <>
      <section id="address" class="folio p-5 scroll-mt-6">
        <h2
          class="text-base font-semibold mb-1"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Twyne address
        </h2>
        <p class="text-xs text-[var(--color-ink-light)] mb-4">
          Your alias is your public address on Twyne — it appears in your share
          URLs (
          <code
            style={{ fontFamily: "var(--font-typewriter)" }}
          >{`/<alias>/<slug>`}</code>
          ) and on your profile page (
          <code
            style={{ fontFamily: "var(--font-typewriter)" }}
          >{`/<alias>`}</code>
          ).
        </p>

        {store.handleToast && (
          <p
            class="mb-3 text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-accent-green)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            {store.handleToast}
          </p>
        )}
        {store.handleError && (
          <div class="mb-3">
            {typeof store.handleError === "string" ? (
              <p
                class="text-[0.7rem] text-[var(--color-vermilion)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
                role="alert"
              >
                {store.handleError}
              </p>
            ) : (
              <ApplicationNotice
                error={store.handleError}
                compact
                onDismiss$={() => {
                  store.handleError = null;
                }}
              />
            )}
          </div>
        )}

        <label
          class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
          style={{ fontFamily: "var(--font-typewriter)" }}
          for="writer-handle"
        >
          Twyne public alias
        </label>
        <div class="flex items-stretch gap-2 mb-1">
          <span
            class="inline-flex items-center px-2 text-[0.7rem] text-[var(--color-ink-muted)] border border-r-0 border-[var(--color-paper-3)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            twyne.love/
          </span>
          <input
            id="writer-handle"
            type="text"
            value={store.handleDraft}
            readOnly={!!store.handle}
            onInput$={(e) => {
              store.handleDraft = (e.target as HTMLInputElement).value;
              store.handleError = null;
              store.handleToast = null;
            }}
            placeholder="your-name"
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            class="flex-1 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          />
        </div>
        <div class="text-[0.7rem] min-h-[1.2em] mb-3">
          {store.handleCheckBusy && (
            <span
              class="text-[var(--color-ink-muted)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Checking…
            </span>
          )}
          {!store.handleCheckBusy && store.handleCheck?.available && (
            <span
              class="text-[var(--color-accent-green)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              @{store.handleCheck.handle} is available.
            </span>
          )}
          {!store.handleCheckBusy &&
            store.handleCheck &&
            !store.handleCheck.available && (
              <div class="mt-2">
                {store.handleCheck.error && (
                  <ApplicationNotice error={store.handleCheck.error} compact />
                )}
              </div>
            )}
          {!store.handleCheck &&
            !store.handleCheckBusy &&
            store.handleDraft.trim() === store.handle && (
              <span
                class="text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Your included alias: /{store.handle}.
              </span>
            )}
        </div>
        <button
          onClick$={handleClaim}
          disabled={
            store.handleBusy ||
            !!store.handle ||
            !store.handleDraft.trim() ||
            store.handleDraft.trim() === store.handle
          }
          class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-ink)",
            fontFamily: "var(--font-typewriter)",
          }}
        >
          {store.handleBusy
            ? "Saving…"
            : store.handle
              ? "Alias claimed"
              : "Claim included alias"}
        </button>

        {store.handle && (
          <div class="mt-4 space-y-2 text-sm">
            <p>
              Owned Twyne aliases:{" "}
              {store.ownedAliases.map((alias) => (
                <Link key={alias} href={`/${alias}/`} class="mr-2 underline">
                  /{alias}
                </Link>
              ))}
            </p>
            <p>
              One standard alias is included. Additional aliases are available
              on request for {EXTRA_ALIAS_PRICE_LABEL} each.
            </p>
            <label class="block" for="additional-alias">
              Request an additional alias
            </label>
            <input
              id="additional-alias"
              value={store.additionalAliasDraft}
              placeholder="another-name"
              class="border px-2 py-1"
              onInput$={(event) => {
                store.additionalAliasDraft = (
                  event.target as HTMLInputElement
                ).value;
              }}
            />
            <button
              type="button"
              class="btn-press text-xs"
              disabled={store.handleBusy || !store.additionalAliasDraft.trim()}
              onClick$={requestAdditionalAlias}
            >
              Submit request
            </button>
            <p class="text-xs">
              Requests are reviewed before payment and assignment. Submission
              does not reserve the alias or charge credits.
            </p>
            {store.additionalAliasRequests.map((alias) => (
              <p key={alias}>/{alias} — pending review</p>
            ))}
          </div>
        )}
      </section>

      <section id="profile" class="folio p-5 scroll-mt-6">
        <h2
          class="text-base font-semibold mb-1"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Public profile
        </h2>
        {!store.handle ? (
          <p class="text-xs text-[var(--color-ink-light)]">
            Claim your Twyne address above to set up a public profile.
          </p>
        ) : (
          <>
            <p class="mb-4 text-xs text-[var(--color-ink-light)]">
              What readers see at{" "}
              <Link href={`/${store.handle}/`} class="underline">
                twyne.love/{store.handle}
              </Link>
              .
            </p>
            {/* Profile picture */}
            <div class="mb-4 flex items-center gap-4">
              <div
                class="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--color-paper-3)] bg-[var(--color-paper)]"
                aria-hidden="true"
              >
                {store.profileAvatarUrl ? (
                  <img
                    src={store.profileAvatarUrl}
                    alt=""
                    width="64"
                    height="64"
                    class="h-full w-full object-cover"
                  />
                ) : (
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-ink-muted)"
                    stroke-width="1.5"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </div>
              <div class="flex-1">
                <label
                  class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                  for="writer-avatar"
                >
                  Profile picture
                </label>
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    id="writer-avatar"
                    type="file"
                    accept="image/*"
                    disabled={store.profileAvatarBusy}
                    onChange$={(e) => {
                      const input = e.target as HTMLInputElement;
                      const file = input.files?.[0];
                      if (file) void handleAvatarSelected(file);
                      input.value = "";
                    }}
                    class="block w-full text-xs text-[var(--color-ink-light)] file:mr-3 file:border file:border-[var(--color-paper-3)] file:bg-[var(--color-paper)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--color-ink)] hover:file:border-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-typewriter)" }}
                  />
                  {store.profileAvatarUrl && (
                    <button
                      type="button"
                      onClick$={handleAvatarClear}
                      disabled={store.profileAvatarBusy}
                      class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline disabled:opacity-50"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p
                  class="mt-1 text-[0.65rem] text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  {store.profileAvatarBusy
                    ? "Working…"
                    : "Upload an image up to 5 MB. Shown in My Desk and on your public profile."}
                </p>
              </div>
            </div>
            <fieldset class="mb-5" disabled={store.profileAvatarBusy}>
              <legend class="mb-2 text-sm text-[var(--color-ink-light)]">
                Or choose a portrait
              </legend>
              <div class="flex flex-wrap gap-3">
                {["owl", "fox", "hare", "raven"].map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Use the ${name} as your profile picture`}
                    onClick$={() => handleDefaultAvatar(name)}
                    class="flex flex-col items-center gap-1 rounded-sm p-1 text-xs text-[var(--color-ink)] hover:bg-[var(--color-paper-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-vermilion)] disabled:opacity-50"
                  >
                    <img
                      src={`/assets/avatars/engraved-2026-09/${name}.avif`}
                      alt=""
                      width={56}
                      height={56}
                      class="h-14 w-14 rounded-full object-cover"
                      loading="lazy"
                    />
                    <span class="capitalize">{name}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label
              class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
              for="writer-display-name"
            >
              Display name
            </label>
            <input
              id="writer-display-name"
              type="text"
              value={store.profileDisplayName}
              onInput$={(e) =>
                (store.profileDisplayName = (
                  e.target as HTMLInputElement
                ).value)
              }
              placeholder="The name shown on your profile"
              class="w-full mb-3 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
              maxLength={60}
            />
            <label
              class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
              for="writer-bio"
            >
              Bio
            </label>
            <textarea
              id="writer-bio"
              value={store.profileBio}
              onInput$={(e) =>
                (store.profileBio = (e.target as HTMLTextAreaElement).value)
              }
              placeholder="One short line about your writing."
              rows={2}
              class="w-full mb-3 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)] resize-none"
              style={{ fontFamily: "var(--font-typewriter)" }}
              maxLength={280}
            />
            {store.profileToast && (
              <p
                class="mb-2 text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-accent-green)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                {store.profileToast}
              </p>
            )}

            <fieldset class="mb-4" disabled={store.profileBusy}>
              <legend
                class="block text-[0.65rem] tracking-[0.18em] uppercase text-[var(--color-ink-muted)] mb-1"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                Links
              </legend>
              <p class="mb-2 text-xs text-[var(--color-ink-light)]">
                Your site, newsletter, Bluesky, or anywhere else readers can
                find you. Shown under your bio.
              </p>
              <div class="space-y-2">
                {store.profileLinks.map((link, index) => (
                  <div key={index} class="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={link.label}
                      onInput$={(e) => {
                        store.profileLinks[index].label = (
                          e.target as HTMLInputElement
                        ).value;
                      }}
                      placeholder="Label"
                      aria-label={`Link ${index + 1} label`}
                      maxLength={40}
                      class="sm:w-40 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    />
                    <input
                      type="url"
                      value={link.url}
                      onInput$={(e) => {
                        store.profileLinks[index].url = (
                          e.target as HTMLInputElement
                        ).value;
                      }}
                      placeholder="https://"
                      aria-label={`Link ${index + 1} address`}
                      maxLength={300}
                      class="flex-1 px-2 py-1.5 bg-[var(--color-paper)] text-sm text-[var(--color-ink)] border border-[var(--color-paper-3)] focus:outline-none focus:border-[var(--color-ink)]"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    />
                    <button
                      type="button"
                      onClick$={() => {
                        store.profileLinks.splice(index, 1);
                      }}
                      aria-label={`Remove link ${index + 1}`}
                      class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {store.profileLinks.length < PROFILE_LINK_MAX && (
                <button
                  type="button"
                  onClick$={() => {
                    store.profileLinks.push({ label: "", url: "" });
                  }}
                  class="mt-2 text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-ink)] hover:text-[var(--color-vermilion)] hover:underline"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  + Add link
                </button>
              )}
            </fieldset>
            <div class="flex items-center gap-3">
              <button
                onClick$={handleSaveProfile}
                disabled={store.profileBusy}
                class="btn-press text-xs text-[var(--color-paper)] disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-ink)",
                  fontFamily: "var(--font-typewriter)",
                }}
              >
                {store.profileBusy ? "Saving…" : "Save profile"}
              </button>
              <a
                href={`/${store.handle}`}
                class="text-[0.7rem] tracking-[0.12em] uppercase text-[var(--color-vermilion)] hover:underline"
                style={{ fontFamily: "var(--font-typewriter)" }}
              >
                View your public profile →
              </a>
            </div>
          </>
        )}
      </section>

      {store.handle && (
        <section id="sharing" class="folio p-5 scroll-mt-6">
          <h2
            class="text-base font-semibold mb-1"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What your profile shares
          </h2>
          <p class="mt-1 mb-4 text-xs leading-relaxed text-[var(--color-ink-light)]">
            Share only the writing facts you choose. AI usage, costs, tokens,
            providers, models, private folio names, and recent actions are never
            part of your public profile.
          </p>
          <div class="space-y-4">
            {(
              [
                {
                  key: "writingHeatmap",
                  label: "Writing activity heatmap",
                  description:
                    "Show your recent writing days and activity counts.",
                },
                {
                  key: "daysWritten30",
                  label: "Days written in the last 30",
                  description:
                    "Show the number of days you wrote during the current 30-day window.",
                },
                {
                  key: "publicPieceCount",
                  label: "Published piece count",
                  description:
                    "Show how many pieces are publicly available on your profile.",
                },
                {
                  key: "folioCount",
                  label: "Desk piece count",
                  description:
                    "Show only the count of private desk pieces, never their names or IDs.",
                },
              ] as const
            ).map((option) => (
              <label
                key={option.key}
                class="flex cursor-pointer items-center justify-between gap-4"
              >
                <span>
                  <span
                    class="block text-sm text-[var(--color-ink)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {option.label}
                  </span>
                  <span
                    class="mt-0.5 block text-[0.65rem] text-[var(--color-ink-muted)]"
                    style={{
                      fontFamily: "var(--font-typewriter)",
                    }}
                  >
                    {option.description}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={store.publicStats[option.key]}
                  disabled={store.publicStatsBusy}
                  onChange$={(event) => {
                    void handleSavePublicStats({
                      ...store.publicStats,
                      [option.key]: (event.target as HTMLInputElement).checked,
                    });
                  }}
                  class="sr-only"
                  aria-label={`Share ${option.label.toLowerCase()}`}
                />
                <span
                  class={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    store.publicStats[option.key]
                      ? "bg-[var(--color-vermilion)]"
                      : "bg-[var(--color-paper-3)]"
                  }`}
                  aria-hidden="true"
                >
                  <span
                    class={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--color-paper)] transition-transform ${
                      store.publicStats[option.key]
                        ? "translate-x-5"
                        : "translate-x-1"
                    }`}
                  />
                </span>
              </label>
            ))}

            <div class="grid gap-1 sm:grid-cols-[1fr_13rem] sm:items-center sm:gap-4">
              <div>
                <span
                  class="block text-sm text-[var(--color-ink)]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Writing streak
                </span>
                <span
                  class="mt-0.5 block text-[0.65rem] text-[var(--color-ink-muted)]"
                  style={{ fontFamily: "var(--font-typewriter)" }}
                >
                  Keep it private, or share your current or longest streak.
                </span>
              </div>
              <SiteSelect
                value={store.publicStats.streak}
                options={[
                  { value: "off", label: "Private" },
                  { value: "current", label: "Current streak" },
                  { value: "longest", label: "Longest streak" },
                ]}
                onChange$={(value: string) => {
                  void handleSavePublicStats({
                    ...store.publicStats,
                    streak: value as PublicStatsPreferences["streak"],
                  });
                }}
                ariaLabel="Public writing streak"
                disabled={store.publicStatsBusy}
              />
            </div>
          </div>
          <PublicDeskSettings />
          {store.publicStatsToast && (
            <p
              class="mt-3 text-[0.65rem] tracking-[0.15em] uppercase text-[var(--color-accent-green)]"
              style={{ fontFamily: "var(--font-typewriter)" }}
              role="status"
            >
              {store.publicStatsToast}
            </p>
          )}
        </section>
      )}
    </>
  );
});
