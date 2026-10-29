/**
 * Account — who the writer is and what they own: their public Twyne address
 * and profile, their Not Organic identity and achievements, their data, tool
 * access, and account deletion. How the app behaves lives in Preferences
 * (/settings/); what the writer has done lives in My Desk (/desk/).
 */
import { $, component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { Link, type DocumentHead } from "@qwik.dev/router";
import { api } from "../../../convex/_generated/api";
import { WriterProfileSettings } from "../../components/account/writer-profile-settings";
import { NotOrganicAchievements } from "../../components/account/notorganic-achievements";
import { DeveloperAccess } from "../../components/account/developer-access";
import { DeleteAccount } from "../../components/account/delete-account";
import { DataControls } from "../../components/desk/data-controls";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { createUsageRange } from "../../utils/usage-domain";

const SECTIONS = [
  { id: "address", label: "Address" },
  { id: "profile", label: "Profile" },
  { id: "notorganic", label: "Not Organic" },
  { id: "data", label: "Your data" },
  { id: "developer", label: "CLI & MCP" },
  { id: "delete", label: "Delete account" },
] as const;

export default component$(() => {
  const auth = useAuth();
  const convex = useConvexClient();
  const did = useSignal<string | null>(null);
  const signedIn = auth.value.provider === "convex";
  const range = createUsageRange("all", Date.now());

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const identity = track(() =>
      hasAuthenticatedConvexIdentity(auth.value) ? auth.value.user?.id : null,
    );
    const client = track(() => convex.value);
    did.value = null;
    if (!identity || !client) return;
    cleanup(
      client.onUpdate(
        api.providerIdentity.getMyProviderIdentity,
        {},
        (link) => {
          did.value = link?.did ?? null;
        },
        () => undefined,
      ),
    );
  });

  const deleteSynchronized = $(async () => {
    const client = convex.value;
    if (!client || auth.value.provider !== "convex")
      throw new Error("Synchronized deletion requires a signed-in account");
    await client.mutation(api.usage.deleteMyUsageHistory, {});
  });

  return (
    <div
      class="settings-page min-h-screen bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
      style={{ fontFamily: "var(--font-serif)" }}
    >
      <div class="max-w-4xl mx-auto px-6 py-8">
        <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <p
              class="dept-label mb-1"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              Twyne
            </p>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: "1.75rem",
              }}
            >
              Account
            </h1>
            <p class="text-sm text-[var(--color-ink-light)] mt-1">
              Your public address and profile, your Not Organic identity, your
              data, and access for tools.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <Link
              href="/settings/"
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Preferences
            </Link>
            <Link
              href="/editor/"
              class="btn-paper text-sm"
              style={{ fontFamily: "var(--font-display)" }}
            >
              ← Writing room
            </Link>
          </div>
        </div>

        {!signedIn ? (
          <section class="folio p-5">
            <p class="text-sm text-[var(--color-ink-light)]">
              Sign in to claim your Twyne address, edit your profile, and manage
              your data.
            </p>
            <Link
              href="/signin/?returnTo=%2Faccount%2F"
              class="btn-paper mt-3 inline-block text-sm"
            >
              Continue with Not Organic
            </Link>
          </section>
        ) : (
          <>
            <nav
              aria-label="Account sections"
              class="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-b border-dotted border-[var(--color-ink-muted)] pb-3 text-[0.7rem] uppercase tracking-[0.12em]"
              style={{ fontFamily: "var(--font-typewriter)" }}
            >
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  class="text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                >
                  {section.label}
                </a>
              ))}
            </nav>

            <div class="space-y-8">
              <WriterProfileSettings />

              <section id="notorganic" class="folio p-5 scroll-mt-6">
                <h2
                  class="text-base font-semibold mb-1"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Not Organic
                </h2>
                <p class="mb-4 text-xs text-[var(--color-ink-light)]">
                  You sign in to Twyne with Not Organic. Your wallet, credits,
                  and achievements are shared across its apps.
                </p>
                <dl class="mb-4 grid gap-3 sm:grid-cols-2">
                  {auth.value.user?.email && (
                    <div>
                      <dt class="text-xs text-[var(--color-ink-light)]">
                        Email (private)
                      </dt>
                      <dd class="mt-1 break-all text-sm">
                        {auth.value.user.email}
                      </dd>
                    </div>
                  )}
                  {did.value && (
                    <div>
                      <dt class="text-xs text-[var(--color-ink-light)]">
                        Account DID
                      </dt>
                      <dd
                        class="mt-1 break-all text-xs"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {did.value}
                      </dd>
                    </div>
                  )}
                </dl>
                <div class="mb-5 flex flex-wrap gap-3 text-sm">
                  <a
                    href="https://id.notorganic.info/?product=twyne"
                    target="_blank"
                    rel="noopener"
                    class="underline"
                  >
                    Wallet &amp; credits
                  </a>
                  <a
                    href="https://id.notorganic.info/?view=profile&product=twyne"
                    target="_blank"
                    rel="noopener"
                    class="underline"
                  >
                    Not Organic account
                  </a>
                </div>
                <NotOrganicAchievements />
              </section>

              <div id="data" class="folio p-5 scroll-mt-6">
                <DataControls
                  range={range}
                  accountId={auth.value.user?.analyticsId}
                  onSynchronizedDelete$={
                    auth.value.user?.analyticsId && convex.value
                      ? deleteSynchronized
                      : undefined
                  }
                />
              </div>

              <div id="developer" class="scroll-mt-6">
                <DeveloperAccess />
              </div>

              <div id="delete" class="scroll-mt-6">
                <DeleteAccount />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "Account · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Manage your Twyne address, public profile, Not Organic achievements, data, and tool access.",
    },
  ],
};
