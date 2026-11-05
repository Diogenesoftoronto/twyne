import {
  component$,
  useStore,
  useSignal,
  useVisibleTask$,
  $,
  type PropFunction,
} from "@qwik.dev/core";
import { useConvexClient } from "../../utils/convex-context";
import { accountDisplayName } from "../../utils/account-display";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { api } from "../../../convex/_generated/api";
import {
  promoteToShared,
  requestActiveDraftSnapshot,
  stopPresence,
  stopWatchingRemote,
} from "../../utils/collaboration";
import type { AppError } from "../../types/application-errors";
import { normalizeApplicationError } from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import { ApplicationNotice } from "../ui/application-notice";
import { DestinationTag } from "../ui/destination-tag";
import { HoldToConfirm } from "../ui/hold-to-confirm";

interface ShareState {
  open: boolean;
  shared: boolean;
  lixId: string | null;
  folioId: string;
  folioName: string;
  sharing: boolean;
  error: AppError | null;
  inviteEmail: string;
  inviteRole: "editor" | "commenter";
  inviting: boolean;
  inviteMsg: string | null;
  inviteError: AppError | null;
  collaborators: Array<{
    userId: string;
    role: string;
    status: string;
    invitedAt: number;
    acceptedAt?: number;
  }>;
}

interface PresenceUser {
  userId: string;
  displayName: string;
  color: string;
  cursorPos?: number;
}

export const ShareDialog = component$(
  (props: {
    folioId: string;
    folioName: string;
    onShared$?: PropFunction<
      (lixId: string, folioId: string, draftHtml?: string) => Promise<boolean>
    >;
    onUnshared$?: PropFunction<(folioId: string) => void>;
  }) => {
    const clientSig = useConvexClient();
    const auth = useAuth();

    const store = useStore<ShareState>({
      open: false,
      shared: false,
      lixId: null,
      folioId: props.folioId,
      folioName: props.folioName,
      sharing: false,
      error: null,
      inviteEmail: "",
      inviteRole: "editor",
      inviting: false,
      inviteMsg: null,
      inviteError: null,
      collaborators: [],
    });

    const presenceSig = useSignal<PresenceUser[]>([]);
    const shareTrigger = useSignal<HTMLButtonElement>();

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async ({ track, cleanup }) => {
      const client = track(clientSig);
      const authState = track(auth);
      const folioId = track(() => props.folioId);
      if (!client || !hasAuthenticatedConvexIdentity(authState)) return;
      let active = true;
      const accountId = authState.user?.id;
      const isCurrent = () =>
        active &&
        props.folioId === folioId &&
        auth.value.user?.id === accountId &&
        hasAuthenticatedConvexIdentity(auth.value);
      cleanup(() => {
        active = false;
      });

      // Check if this folio is already shared.
      try {
        const shares = await client.query(api.collaboration.listMyShares, {});
        if (!isCurrent()) return;
        const match = shares.find((s) => s.folioId === folioId);
        if (match) {
          // Membership is known even when opening waits for a local review.
          store.shared = true;
          store.lixId = match.lixId;
          const opened = await props.onShared$?.(match.lixId, folioId);
          if (!isCurrent() || opened === false) return;
          store.shared = true;
          store.lixId = match.lixId;
        } else {
          // The active folio changed and the new one is not shared.
          shareTrigger.value?.focus();
          store.shared = false;
          store.lixId = null;
          await props.onUnshared$?.(folioId);
        }
      } catch (error) {
        if (isCurrent())
          store.error = normalizeApplicationError(error, {
            source: "convex",
            metadata: { operation: "open-own-share" },
          });
      }
    });

    // When shared, poll for collaborators + presence.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ track, cleanup }) => {
      const client = track(clientSig);
      const lixId = track(() => store.lixId);
      const authenticated = track(() =>
        hasAuthenticatedConvexIdentity(auth.value),
      );
      if (!client || !lixId || !authenticated) {
        presenceSig.value = [];
        return;
      }

      let active = true;
      const poll = async () => {
        if (!active || !lixId) return;
        try {
          const [collabs, presence] = await Promise.all([
            client.query(api.collaboration.getCollaborators, { lixId }),
            client.query(api.collaboration.getPresence, { lixId }),
          ]);
          if (!active) return;
          store.collaborators = collabs as any;
          presenceSig.value = presence as any;
        } catch {
          // Best-effort.
        }
      };

      void poll();
      const timer = setInterval(poll, 4000);
      cleanup(() => {
        active = false;
        clearInterval(timer);
      });
    });

    const handleShare = $(async () => {
      const client = clientSig.value;
      if (!client || !hasAuthenticatedConvexIdentity(auth.value)) return;
      store.sharing = true;
      store.error = null;
      const folioId = props.folioId;
      const folioName = props.folioName;
      const accountId = auth.value.user?.id;
      const isCurrent = () =>
        props.folioId === folioId &&
        auth.value.user?.id === accountId &&
        hasAuthenticatedConvexIdentity(auth.value);
      try {
        const draftHtml = requestActiveDraftSnapshot(folioId);
        const result = await promoteToShared(
          client,
          folioId,
          folioName,
          draftHtml,
          { isCurrent },
        );
        if (!result || !isCurrent()) return;
        const { lixId } = result;
        const opened = await props.onShared$?.(
          lixId,
          folioId,
          result.alreadyShared ? undefined : draftHtml,
        );
        if (!isCurrent() || opened === false) return;
        store.lixId = lixId;
        store.shared = true;
      } catch (error) {
        reportApplicationDiagnostic("twyne:collaboration:share", error, {
          operation: "share-folio",
        });
        store.error = normalizeApplicationError(error, {
          source: "convex",
          metadata: { operation: "share-folio" },
        });
      } finally {
        store.sharing = false;
      }
    });

    const handleInvite = $(async () => {
      const client = clientSig.value;
      if (
        !client ||
        !store.lixId ||
        !hasAuthenticatedConvexIdentity(auth.value)
      )
        return;
      const email = store.inviteEmail.trim();
      if (!email || !email.includes("@")) {
        store.inviteError = null;
        store.inviteMsg = "Enter a valid email.";
        return;
      }
      store.inviting = true;
      store.inviteMsg = null;
      store.inviteError = null;
      try {
        const result = await client.action(
          api.collaboration.inviteCollaborator,
          {
            lixId: store.lixId,
            folioName: props.folioName,
            email,
            role: store.inviteRole,
          },
        );
        store.inviteMsg = result.alreadyInvited
          ? "Already invited."
          : result.emailDelivered
            ? `Invitation emailed to ${email}.`
            : `Invitation created for ${email}. Copy the invite link to deliver it.`;
        store.inviteEmail = "";
        // Refresh collaborator list.
        const collabs = await client.query(api.collaboration.getCollaborators, {
          lixId: store.lixId,
        });
        store.collaborators = collabs as any;
      } catch (error) {
        reportApplicationDiagnostic("twyne:collaboration:invite", error, {
          operation: "invite-collaborator",
        });
        store.inviteError = normalizeApplicationError(error, {
          source: "convex",
          metadata: { operation: "invite-collaborator" },
        });
      } finally {
        store.inviting = false;
      }
    });

    const handleRemoveCollab = $(async (targetUserId: string) => {
      const client = clientSig.value;
      if (
        !client ||
        !store.lixId ||
        !hasAuthenticatedConvexIdentity(auth.value)
      )
        return;
      try {
        await client.mutation(api.collaboration.removeCollaborator, {
          lixId: store.lixId,
          userId: targetUserId,
        });
        store.collaborators = store.collaborators.filter(
          (c) => c.userId !== targetUserId,
        );
        shareTrigger.value?.focus();
      } catch (error) {
        reportApplicationDiagnostic(
          "twyne:collaboration:remove-collaborator",
          error,
          { operation: "remove-collaborator" },
        );
        store.error = normalizeApplicationError(error, {
          source: "convex",
          metadata: { operation: "remove-collaborator" },
        });
      }
    });

    const handleUnshare = $(async () => {
      const client = clientSig.value;
      if (
        !client ||
        !store.lixId ||
        !hasAuthenticatedConvexIdentity(auth.value)
      )
        return;
      const folioId = props.folioId;
      const lixId = store.lixId;
      try {
        await client.mutation(api.collaboration.unshareFolio, {
          lixId,
        });
        if (props.folioId !== folioId || store.lixId !== lixId) return;
        stopPresence();
        stopWatchingRemote();
        store.shared = false;
        store.lixId = null;
        store.collaborators = [];
        presenceSig.value = [];
        await props.onUnshared$?.(folioId);
      } catch (error) {
        reportApplicationDiagnostic("twyne:collaboration:unshare", error, {
          operation: "unshare-folio",
        });
        store.error = normalizeApplicationError(error, {
          source: "convex",
          metadata: { operation: "unshare-folio" },
        });
      }
    });

    const copyInviteLink = $(async () => {
      if (!store.lixId) return;
      const url = `${window.location.origin}/editor?shared=${store.lixId}`;
      try {
        await navigator.clipboard.writeText(url);
        store.inviteMsg = "Invite link copied.";
      } catch {
        store.inviteMsg = url;
      }
    });

    return (
      <div class="relative">
        <button
          ref={shareTrigger}
          onClick$={() => {
            store.open = !store.open;
          }}
          class="btn-paper text-xs"
          title="Share this folio with collaborators"
          aria-expanded={store.open}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            style="display:inline;vertical-align:-2px;margin-right:4px;"
          >
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
            <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
          </svg>
          Share
        </button>

        {/* Presence avatars */}
        {presenceSig.value.length > 0 && (
          <div
            class="inline-flex items-center gap-1 ml-2"
            style="vertical-align:middle;"
          >
            {presenceSig.value.slice(0, 4).map((p) => (
              <span
                key={p.userId}
                title={accountDisplayName({ name: p.displayName })}
                class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white"
                style={{
                  backgroundColor: p.color,
                  fontFamily: "var(--font-typewriter)",
                }}
              >
                {accountDisplayName({ name: p.displayName })
                  .charAt(0)
                  .toUpperCase()}
              </span>
            ))}
            {presenceSig.value.length > 4 && (
              <span class="text-[10px] text-[var(--color-ink-muted)]">
                +{presenceSig.value.length - 4}
              </span>
            )}
          </div>
        )}

        {store.open && (
          <>
            <div
              class="fixed inset-0"
              // The click-catcher must sit beneath the panel, or every
              // click inside the panel lands here and closes it.
              style="z-index: var(--z-dropdown);"
              onClick$={() => {
                store.open = false;
              }}
            />
            <div
              class="press-popover absolute right-0 top-full mt-2 w-80 max-w-[92vw] folio p-4 space-y-3 whitespace-normal [overflow-wrap:anywhere]"
              style="z-index: calc(var(--z-dropdown) + 1);"
              onKeyDown$={(event) => {
                if (event.key === "Escape") {
                  store.open = false;
                  shareTrigger.value?.focus();
                }
              }}
            >
              <div class="flex items-center justify-between">
                <p
                  class="text-sm font-semibold"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {store.shared ? "Collaborators" : "Share this folio"}
                </p>
                <button
                  onClick$={() => {
                    store.open = false;
                    shareTrigger.value?.focus();
                  }}
                  aria-label="Close sharing"
                  class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  ✕
                </button>
              </div>

              {store.error && (
                <ApplicationNotice
                  error={store.error}
                  compact
                  onDismiss$={() => {
                    store.error = null;
                  }}
                />
              )}

              {!store.shared ? (
                <div class="space-y-2">
                  <p class="text-xs text-[var(--color-ink-light)]">
                    Promote this folio to a shared document. You'll be the
                    owner; invited collaborators can edit or comment in real
                    time. Multiplayer is a Pro feature.
                  </p>
                  <button
                    onClick$={handleShare}
                    data-consequence="synced"
                    disabled={store.sharing}
                    class="btn-press w-full text-xs"
                  >
                    {store.sharing ? "Promoting…" : "Share this folio"}{" "}
                    <DestinationTag to="synced" />
                  </button>
                </div>
              ) : (
                <div class="space-y-3">
                  {/* Invite form */}
                  <div class="space-y-2 border-b border-[var(--color-paper-3)] pb-3">
                    <input
                      type="email"
                      value={store.inviteEmail}
                      onInput$={(e) => {
                        store.inviteEmail = (
                          e.target as HTMLInputElement
                        ).value;
                      }}
                      placeholder="email@example.com"
                      class="w-full text-xs px-2 py-1.5 border border-[var(--color-paper-3)] bg-[var(--color-paper)] focus:border-[var(--color-vermilion)] focus:outline-none"
                      style={{
                        fontFamily: "var(--font-typewriter)",
                        borderRadius: "2px",
                      }}
                    />
                    <div class="flex gap-2">
                      <select
                        value={store.inviteRole}
                        onChange$={(e) => {
                          store.inviteRole = (e.target as HTMLSelectElement)
                            .value as "editor" | "commenter";
                        }}
                        class="text-xs px-2 py-1 border border-[var(--color-paper-3)] bg-[var(--color-paper)]"
                        style={{
                          fontFamily: "var(--font-typewriter)",
                          borderRadius: "2px",
                        }}
                      >
                        <option value="editor">Editor</option>
                        <option value="commenter">Commenter</option>
                      </select>
                      <button
                        onClick$={handleInvite}
                        data-consequence="public"
                        disabled={store.inviting}
                        class="btn-press text-xs flex-1"
                      >
                        {store.inviting ? "Inviting…" : "Invite"}{" "}
                        <DestinationTag to="public" />
                      </button>
                    </div>
                    {store.inviteMsg && (
                      <p
                        class="text-[0.65rem]"
                        style={{ fontFamily: "var(--font-typewriter)" }}
                      >
                        {store.inviteMsg}
                      </p>
                    )}
                    {store.inviteError && (
                      <ApplicationNotice
                        error={store.inviteError}
                        compact
                        onDismiss$={() => {
                          store.inviteError = null;
                        }}
                      />
                    )}
                  </div>

                  {/* Collaborator list */}
                  <div class="space-y-1.5">
                    {store.collaborators.map((c) => (
                      <div
                        key={c.userId}
                        class="flex items-center justify-between text-xs py-1"
                      >
                        <div class="min-w-0">
                          <p
                            class="truncate text-[var(--color-ink)]"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                            }}
                          >
                            {c.userId.includes("@")
                              ? c.userId
                              : c.userId.slice(0, 12) + "…"}
                          </p>
                          <p class="text-[0.6rem] text-[var(--color-ink-muted)]">
                            {c.role}
                            {c.status === "pending" ? " · pending" : ""}
                          </p>
                        </div>
                        {c.role !== "owner" && (
                          <HoldToConfirm
                            onConfirm$={() => handleRemoveCollab(c.userId)}
                            class="text-[0.6rem] text-[var(--color-ink-muted)]"
                            label={`Remove ${c.userId}`}
                            hint="hold to remove"
                            consequence="erase"
                          >
                            remove
                          </HoldToConfirm>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Invite link + unshare */}
                  <button
                    class="text-xs underline underline-offset-4"
                    onClick$={async () => {
                      if (!store.lixId) return;
                      const { showSharedRecovery } = await import(
                        "./shared-reconciliation-dialog"
                      );
                      await showSharedRecovery(store.lixId);
                    }}
                  >
                    View recovery copies
                  </button>
                  <div class="flex gap-2 pt-2 border-t border-[var(--color-paper-3)]">
                    <button
                      onClick$={copyInviteLink}
                      class="btn-paper text-xs flex-1"
                    >
                      Copy invite link
                    </button>
                    <HoldToConfirm
                      onConfirm$={handleUnshare}
                      class="text-xs text-[var(--color-vermilion)]"
                      label="Stop sharing this folio; collaborators lose access and the invite link stops working"
                      hint="hold to stop"
                      consequence="erase"
                    >
                      Stop sharing
                    </HoldToConfirm>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  },
);
