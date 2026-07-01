import {
  $,
  component$,
  useOnDocument,
  useSignal,
  useVisibleTask$,
  type Signal,
} from "@builder.io/qwik";
import { useNavigate } from "@builder.io/qwik-city";
import { useAuth } from "../../utils/auth-context";
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
  // Pick the effective signal once. Signals are serializable across the QRL
  // boundary, so handlers can use `menuOpen.value` directly (closures can't).
  const menuOpen = open ?? internalOpen;
  const rootRef = useSignal<HTMLElement>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    const userId = track(() => auth.value.user?.id);
    const provider = track(() => auth.value.provider);
    const client = track(() => convexClient.value);

    profileAvatarUrl.value = null;
    profileDisplay.value = null;
    if (!userId || provider !== "convex" || !client) return;

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
                void nav("/docs/");
              }}
            >
              ❦ The Manual
            </button>
          </div>
          <AuthPanel />
        </div>
      )}
    </div>
  );
});
