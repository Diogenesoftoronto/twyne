import {
  $,
  component$,
  useOnDocument,
  useSignal,
  useStore,
  useVisibleTask$,
  type Signal,
} from "@qwik.dev/core";
import { useNavigate } from "@qwik.dev/router";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import { AuthPanel } from "./auth-panel";

interface AccountMenuProps {
  /**
   * Optional externally-controlled open state. When provided, the menu reads
   * and writes this signal so other UI (deep links, sign-in nudges) can open
   * it. When omitted, the menu manages its own open state internally.
   */
  open?: Signal<boolean>;
}

interface PendingInvitation {
  lixId: string;
  folioName: string;
  role: "editor" | "commenter";
  invitedAt: number;
}

interface SharedFolio {
  lixId: string;
  folioId: string;
  folioName: string;
  role: "editor" | "commenter";
  updatedAt: number;
}

/**
 * The Editor's Office — the account affordance shared across the app.
 *
 * Signed out, it's a single user icon that opens the sign-in panel. Signed in,
 * it shows the writer's name (and avatar, if their session carries one) with a
 * dropdown to Preferences, the Manual, and the AuthPanel (which holds sign-out
 * and the passkey offer).
 *
 * This is the exact control the editor toolbar uses; the landing header mounts
 * the same component so a signed-in writer sees a consistent account menu
 * instead of a "Sign in" link.
 */
export const AccountMenu = component$<AccountMenuProps>(({ open }) => {
  const auth = useAuth();
  const nav = useNavigate();
  const convexClient = useConvexClient();
  const internalOpen = useSignal(false);
  const profileAvatarUrl = useSignal<string | null>(null);
  const profileDisplay = useSignal<string | null>(null);
  const invitations = useStore<PendingInvitation[]>([]);
  const sharedFolios = useStore<SharedFolio[]>([]);
  const invitationError = useSignal<string | null>(null);
  const invitationBusy = useSignal<string | null>(null);
  // Pick the effective signal once. Signals are serializable across the QRL
  // boundary, so handlers can use `menuOpen.value` directly (closures can't).
  const menuOpen = open ?? internalOpen;
  const rootRef = useSignal<HTMLElement>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const authState = track(auth);
    const client = track(() => convexClient.value);

    profileAvatarUrl.value = null;
    profileDisplay.value = null;
    invitations.splice(0, invitations.length);
    sharedFolios.splice(0, sharedFolios.length);
    if (!client || !hasAuthenticatedConvexIdentity(authState)) return;

    const replaceInvitations = (pending: PendingInvitation[]) => {
      invitations.splice(0, invitations.length, ...pending);
    };
    const replaceSharedFolios = (shared: SharedFolio[]) => {
      sharedFolios.splice(0, sharedFolios.length, ...shared);
    };
    const unsubscribeInvitations = client.onUpdate(
      api.collaboration.listPendingInvitations,
      {},
      replaceInvitations,
      () => undefined,
    );
    const unsubscribeShared = client.onUpdate(
      api.collaboration.listSharedWithMe,
      {},
      replaceSharedFolios,
      () => undefined,
    );
    cleanup(unsubscribeInvitations);
    cleanup(unsubscribeShared);

    try {
      const row = (await client.query(api.profiles.getMyHandle, {})) as {
        handle: string;
        displayName: string | null;
        avatarUrl: string | null;
      } | null;
      profileAvatarUrl.value = row?.avatarUrl ?? null;
      profileDisplay.value = row?.displayName || row?.handle || null;
    } catch {
      // The profile query is an enhancement; keep the session-backed display.
    }
  });

  const rejectInvitation = $(async (lixId: string) => {
    const client = convexClient.value;
    if (!client) return;
    invitationBusy.value = lixId;
    invitationError.value = null;
    try {
      await client.mutation(api.collaboration.rejectInvitation, { lixId });
      const index = invitations.findIndex((invite) => invite.lixId === lixId);
      if (index >= 0) invitations.splice(index, 1);
    } catch {
      invitationError.value = "Could not decline that invitation. Try again.";
    } finally {
      invitationBusy.value = null;
    }
  });

  const accountDisplay = auth.value.user
    ? auth.value.provider === "atproto"
      ? auth.value.user.email
      : profileDisplay.value ||
        auth.value.user.email ||
        auth.value.user.name ||
        "Signed in"
    : null;
  const accountTitle = accountDisplay
    ? `Signed in as ${accountDisplay}`
    : "Editor's office";
  const avatar = profileAvatarUrl.value || auth.value.user?.image;

  // Close on outside click / Escape, matching dropdown conventions elsewhere.
  useOnDocument(
    "click",
    $((e) => {
      if (!menuOpen.value) return;
      const root = rootRef.value;
      const target = e.target as Node | null;
      if (root && target && !root.contains(target)) {
        menuOpen.value = false;
      }
    }),
  );
  useOnDocument(
    "keydown",
    $((e) => {
      if (menuOpen.value && (e as KeyboardEvent).key === "Escape") {
        menuOpen.value = false;
      }
    }),
  );

  return (
    <div class="relative" ref={rootRef}>
      <button
        onClick$={() => {
          menuOpen.value = !menuOpen.value;
        }}
        class={`icon-btn ${
          accountDisplay
            ? "gap-1.5 border border-[var(--color-sage)] bg-[var(--color-paper-soft)] px-2 py-1.5 text-[var(--color-ink)] hover:text-[var(--color-vermilion)]"
            : "p-1.5 text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
        }`}
        title={accountTitle}
        aria-label={
          accountDisplay
            ? `Open account menu. Signed in as ${accountDisplay}`
            : "Open the editor's office (account)"
        }
        aria-expanded={menuOpen.value}
      >
        {accountDisplay &&
          (avatar ? (
            <img
              src={avatar}
              alt=""
              width="20"
              height="20"
              class="h-5 w-5 flex-shrink-0 rounded-full object-cover"
              aria-hidden="true"
            />
          ) : (
            <span
              class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--color-sage)]"
              aria-hidden="true"
            />
          ))}
        <svg
          class="flex-shrink-0"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        {accountDisplay && (
          <span
            class="hidden max-w-[8.5rem] truncate text-[11px] font-semibold lg:inline"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {accountDisplay}
          </span>
        )}
      </button>
      {menuOpen.value && (
        <div
          class="absolute right-0 top-full mt-2 w-72 folio p-3 space-y-2"
          style="z-index: var(--z-dropdown);"
        >
          <div class="flex flex-col gap-1 pb-2 border-b border-[var(--color-paper-3)]">
            <button
              type="button"
              class="w-full text-left text-sm text-[var(--color-ink)] hover:text-[var(--color-vermilion)] py-1.5 px-2 focus-ring"
              style={{ fontFamily: "var(--font-display)" }}
              onClick$={() => {
                menuOpen.value = false;
                void nav("/settings/");
              }}
            >
              ⚙ Preferences
            </button>
            <button
              type="button"
              class="w-full text-left text-sm text-[var(--color-ink)] hover:text-[var(--color-vermilion)] py-1.5 px-2 focus-ring"
              style={{ fontFamily: "var(--font-display)" }}
              onClick$={() => {
                menuOpen.value = false;
                void nav("/desk/");
              }}
            >
              My Desk
            </button>
            <button
              type="button"
              class="w-full text-left text-sm text-[var(--color-ink)] hover:text-[var(--color-vermilion)] py-1.5 px-2 focus-ring"
              style={{ fontFamily: "var(--font-display)" }}
              onClick$={() => {
                menuOpen.value = false;
                void nav("/docs/");
              }}
            >
              ❦ The Manual
            </button>
            <button
              type="button"
              class="w-full text-left text-sm text-[var(--color-ink)] hover:text-[var(--color-vermilion)] py-1.5 px-2 focus-ring"
              style={{ fontFamily: "var(--font-display)" }}
              onClick$={() => {
                menuOpen.value = false;
                void nav("/privacy-ledger/");
              }}
            >
              Privacy ledger
            </button>
          </div>
          {invitations.length > 0 && (
            <section class="space-y-2 border-b border-[var(--color-paper-3)] pb-3">
              <p
                class="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Invitations
              </p>
              {invitations.map((invitation) => (
                <div
                  key={invitation.lixId}
                  class="rounded-sm bg-[var(--color-paper-soft)] px-2.5 py-2"
                >
                  <p class="truncate text-sm text-[var(--color-ink)]">
                    {invitation.folioName}
                  </p>
                  <p class="mt-0.5 text-[11px] text-[var(--color-ink-light)]">
                    Invited as {invitation.role}
                  </p>
                  <div class="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      class="text-xs font-semibold text-[var(--color-vermilion)] hover:underline disabled:opacity-50"
                      disabled={invitationBusy.value === invitation.lixId}
                      onClick$={() => {
                        menuOpen.value = false;
                        void nav(
                          `/editor?shared=${encodeURIComponent(invitation.lixId)}`,
                        );
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      class="text-xs text-[var(--color-ink-light)] hover:text-[var(--color-ink)] disabled:opacity-50"
                      disabled={invitationBusy.value === invitation.lixId}
                      onClick$={() => rejectInvitation(invitation.lixId)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
              {invitationError.value && (
                <p
                  class="px-2 text-xs text-[var(--color-vermilion)]"
                  role="alert"
                >
                  {invitationError.value}
                </p>
              )}
            </section>
          )}
          {sharedFolios.length > 0 && (
            <section class="space-y-1 border-b border-[var(--color-paper-3)] pb-3">
              <p
                class="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Shared with me
              </p>
              {sharedFolios.map((folio) => (
                <button
                  key={folio.lixId}
                  type="button"
                  class="block w-full rounded-sm px-2.5 py-2 text-left hover:bg-[var(--color-paper-soft)] focus-ring"
                  onClick$={() => {
                    menuOpen.value = false;
                    void nav(
                      `/editor?shared=${encodeURIComponent(folio.lixId)}`,
                    );
                  }}
                >
                  <span class="block truncate text-sm text-[var(--color-ink)]">
                    {folio.folioName}
                  </span>
                  <span class="mt-0.5 block text-[11px] text-[var(--color-ink-light)]">
                    {folio.role === "editor" ? "Can edit" : "Can comment"}
                  </span>
                </button>
              ))}
            </section>
          )}
          <AuthPanel />
        </div>
      )}
    </div>
  );
});
