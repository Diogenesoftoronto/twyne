import {
  component$,
  useStore,
  useSignal,
  useVisibleTask$,
  $,
  type PropFunction,
} from "@builder.io/qwik";
import { useConvexClient } from "../../utils/convex-context";
import { useAuth } from "../../utils/auth-context";
import { api } from "../../../convex/_generated/api";
import {
  promoteToShared,
  startPresence,
  stopPresence,
  stopWatchingRemote,
} from "../../utils/collaboration";

interface ShareState {
  open: boolean;
  shared: boolean;
  lixId: string | null;
  folioId: string;
  folioName: string;
  sharing: boolean;
  error: string | null;
  inviteEmail: string;
  inviteRole: "editor" | "commenter";
  inviting: boolean;
  inviteMsg: string | null;
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
    onShared$?: PropFunction<(lixId: string) => void>;
    onUnshared$?: PropFunction<() => void>;
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
      collaborators: [],
    });

    const presenceSig = useSignal<PresenceUser[]>([]);

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(async ({ track }) => {
      const client = track(clientSig);
      const user = track(auth).user;
      const folioId = track(() => props.folioId);
      if (!client || !user) return;

      // Check if this folio is already shared.
      try {
        const shares = await client.query(api.collaboration.listMyShares, {});
        const match = shares.find((s) => s.folioId === folioId);
        if (match) {
          store.shared = true;
          store.lixId = match.lixId;
          props.onShared$?.(match.lixId);
        } else {
          // The active folio changed and the new one is not shared.
          store.shared = false;
          store.lixId = null;
          props.onUnshared$?.();
        }
      } catch {
        // Not shared yet — that's fine.
      }
    });

    // When shared, poll for collaborators + presence.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(({ track, cleanup }) => {
      const client = track(clientSig);
      const lixId = track(() => store.lixId);
      if (!client || !lixId) {
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
      if (!client) return;
      store.sharing = true;
      store.error = null;
      try {
        const { lixId } = await promoteToShared(
          client,
          props.folioId,
          props.folioName,
        );
        store.lixId = lixId;
        store.shared = true;
        props.onShared$?.(lixId);
        startPresence(client, lixId, auth.value.user?.email);
      } catch (e: any) {
        store.error =
          e?.message ?? "Could not share. Pro subscription required.";
      } finally {
        store.sharing = false;
      }
    });

    const handleInvite = $(async () => {
      const client = clientSig.value;
      if (!client || !store.lixId) return;
      const email = store.inviteEmail.trim();
      if (!email || !email.includes("@")) {
        store.inviteMsg = "Enter a valid email.";
        return;
      }
      store.inviting = true;
      store.inviteMsg = null;
      try {
        const result = await client.mutation(
          api.collaboration.inviteCollaborator,
          {
            lixId: store.lixId,
            email,
            role: store.inviteRole,
          },
        );
        store.inviteMsg = result.alreadyInvited
          ? "Already invited."
          : `Invitation sent to ${email}.`;
        store.inviteEmail = "";
        // Refresh collaborator list.
        const collabs = await client.query(api.collaboration.getCollaborators, {
          lixId: store.lixId,
        });
        store.collaborators = collabs as any;
      } catch (e: any) {
        store.inviteMsg = e?.message ?? "Could not invite.";
      } finally {
        store.inviting = false;
      }
    });

    const handleRemoveCollab = $(async (targetUserId: string) => {
      const client = clientSig.value;
      if (!client || !store.lixId) return;
      try {
        await client.mutation(api.collaboration.removeCollaborator, {
          lixId: store.lixId,
          userId: targetUserId,
        });
        store.collaborators = store.collaborators.filter(
          (c) => c.userId !== targetUserId,
        );
      } catch (e: any) {
        store.error = e?.message ?? "Could not remove.";
      }
    });

    const handleUnshare = $(async () => {
      const client = clientSig.value;
      if (!client || !store.lixId) return;
      if (!confirm("Stop sharing? Collaborators will lose access immediately."))
        return;
      try {
        await client.mutation(api.collaboration.unshareFolio, {
          lixId: store.lixId,
        });
        stopPresence();
        stopWatchingRemote();
        store.shared = false;
        store.lixId = null;
        store.collaborators = [];
        presenceSig.value = [];
        props.onUnshared$?.();
      } catch (e: any) {
        store.error = e?.message ?? "Could not stop sharing.";
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
                title={p.displayName}
                class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white"
                style={{
                  backgroundColor: p.color,
                  fontFamily: "var(--font-typewriter)",
                }}
              >
                {p.displayName.charAt(0).toUpperCase()}
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
              style="z-index: var(--z-overlay);"
              onClick$={() => {
                store.open = false;
              }}
            />
            <div
              class="absolute right-0 top-full mt-2 w-80 folio p-4 space-y-3"
              style="z-index: var(--z-dropdown);"
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
                  }}
                  class="text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  ✕
                </button>
              </div>

              {store.error && (
                <p class="text-xs text-[var(--color-vermilion)]" role="alert">
                  {store.error}
                </p>
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
                    disabled={store.sharing}
                    class="btn-press w-full text-xs"
                  >
                    {store.sharing ? "Promoting…" : "Share this folio"}
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
                        disabled={store.inviting}
                        class="btn-press text-xs flex-1"
                      >
                        {store.inviting ? "Inviting…" : "Invite"}
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
                          <button
                            onClick$={() => void handleRemoveCollab(c.userId)}
                            class="text-[0.6rem] text-[var(--color-ink-muted)] hover:text-[var(--color-vermilion)]"
                            style={{
                              fontFamily: "var(--font-typewriter)",
                            }}
                          >
                            remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Invite link + unshare */}
                  <div class="flex gap-2 pt-2 border-t border-[var(--color-paper-3)]">
                    <button
                      onClick$={copyInviteLink}
                      class="btn-paper text-xs flex-1"
                    >
                      Copy invite link
                    </button>
                    <button
                      onClick$={handleUnshare}
                      class="text-xs text-[var(--color-vermilion)] hover:underline"
                      style={{ fontFamily: "var(--font-typewriter)" }}
                    >
                      Stop sharing
                    </button>
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
