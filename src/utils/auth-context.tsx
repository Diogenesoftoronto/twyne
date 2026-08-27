import {
  component$,
  createContextId,
  Slot,
  useContext,
  useContextProvider,
  useSignal,
  useVisibleTask$,
  type Signal,
} from "@builder.io/qwik";
import { authClient } from "./auth-client";
import { analyticsIdFromConvexJwt } from "./auth-analytics";
import { reportApplicationError } from "./application-diagnostics";
import { setConvexSyncContext, clearConvexSyncContext } from "./convex-sync";
import { useConvexClient } from "./convex-context";

export interface AuthUser {
  id: string;
  /** Stable identifier shared by browser and authenticated server analytics. */
  analyticsId?: string;
  email: string;
  name?: string;
  image?: string;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** True only after a Better Auth token has been installed in Convex. */
  convexAuthenticated?: boolean;
  /** Restored ATProto identity, present alongside a Better Auth session. */
  atproto?: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  /**
   * Which identity backs Convex. ATProto can coexist in `atproto`; it only
   * becomes the primary display identity when Better Auth is absent.
   */
  provider?: "convex" | "atproto";
}

export const AuthContext =
  createContextId<Signal<AuthState>>("twyne.auth-context");

export function useAuth(): Signal<AuthState> {
  return useContext(AuthContext);
}

export function hasAuthenticatedConvexIdentity(state: AuthState): boolean {
  return (
    state.provider === "convex" &&
    state.convexAuthenticated === true &&
    state.user !== null
  );
}

export const AuthProvider = component$(() => {
  const authState = useSignal<AuthState>({ user: null, loading: true });
  const convexClient = useConvexClient();

  useContextProvider(AuthContext, authState);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup, track }) => {
    track(convexClient);

    // Restore/complete ATProto OAuth, but do not let it short-circuit Better
    // Auth. The two sessions serve different purposes and can coexist.
    const { initSession } = await import("./atproto");
    const atproto = await initSession();

    const sessionAtom = authClient.useSession;
    if (!sessionAtom || typeof sessionAtom !== "object") {
      authState.value = atproto
        ? {
            user: {
              id: atproto.did,
              analyticsId: atproto.did,
              email: atproto.handle,
              name: atproto.displayName ?? atproto.handle,
              image: atproto.avatar,
            },
            loading: false,
            provider: "atproto",
            atproto,
          }
        : { user: null, loading: false };
      clearConvexSyncContext();
      return;
    }

    async function syncFromAtom() {
      const val = sessionAtom.get?.() ?? sessionAtom;
      const sessionData = val?.data;

      if (sessionData?.user) {
        const user: AuthUser = {
          id: sessionData.user.id,
          email: sessionData.user.email ?? "",
          name: sessionData.user.name ?? undefined,
          image: sessionData.user.image ?? undefined,
        };
        let convexAuthenticated = false;
        if (convexClient.value) {
          try {
            const tokenResult = await (authClient as any).convex.token({
              fetchOptions: { throw: false },
            });
            const token = tokenResult?.data?.token as string | undefined;
            user.analyticsId = analyticsIdFromConvexJwt(token);
            if (token) {
              convexClient.value.setAuth(async () => token);
              setConvexSyncContext(convexClient.value, user.id);
              convexAuthenticated = true;
            } else {
              convexClient.value.setAuth(async () => null);
              clearConvexSyncContext();
              reportApplicationError(
                "twyne:auth:install-convex-token",
                new Error("Authentication failed: Convex token unavailable"),
                {
                  source: "auth",
                  title: "Cloud sync is paused",
                  dedupeKey: "convex-auth",
                  metadata: { operation: "install-convex-token" },
                },
              );
            }
          } catch (error) {
            convexClient.value.setAuth(async () => null);
            clearConvexSyncContext();
            reportApplicationError("twyne:auth:install-convex-token", error, {
              source: "auth",
              title: "Cloud sync is paused",
              dedupeKey: "convex-auth",
              metadata: { operation: "install-convex-token" },
            });
          }

          // This mutation requires the live Better Auth Convex token above.
          // ATProto proof still comes from the official legacy browser OAuth
          // client; see providerIdentity.ts for the server-conversion boundary.
          if (atproto && convexAuthenticated) {
            try {
              const { linkNotOrganicDid } = await import(
                "./notorganic-provider"
              );
              await linkNotOrganicDid(convexClient.value, atproto.did);
            } catch (error) {
              reportApplicationError("twyne:notorganic:link-did", error, {
                source: "auth",
                title: "Bluesky connection was not linked",
                variant: "warning",
                dedupeKey: "notorganic-did-link",
                metadata: { operation: "link-atproto-identity" },
              });
            }
          }
        } else {
          clearConvexSyncContext();
        }
        authState.value = {
          user,
          loading: false,
          provider: "convex",
          convexAuthenticated,
          atproto: atproto ?? undefined,
        };
      } else {
        authState.value = atproto
          ? {
              user: {
                id: atproto.did,
                analyticsId: atproto.did,
                email: atproto.handle,
                name: atproto.displayName ?? atproto.handle,
                image: atproto.avatar,
              },
              loading: val?.isPending ?? false,
              provider: "atproto",
              atproto,
            }
          : { user: null, loading: val?.isPending ?? false };
        try {
          convexClient.value?.setAuth(async () => null);
        } catch {
          // The client may not have installed an auth token yet.
        }
        clearConvexSyncContext();
      }
    }

    void syncFromAtom();

    if (typeof sessionAtom.subscribe === "function") {
      const unsub = sessionAtom.subscribe(() => {
        void syncFromAtom();
      });
      cleanup(() => {
        unsub();
        clearConvexSyncContext();
      });
    } else {
      cleanup(() => {
        clearConvexSyncContext();
      });
    }
  });

  return <Slot />;
});
