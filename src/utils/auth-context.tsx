import {
  component$,
  createContextId,
  Slot,
  useContext,
  useContextProvider,
  useSignal,
  useVisibleTask$,
  type Signal,
} from "@qwik.dev/core";
import { authClient } from "./auth-client";
import { createConvexTokenFetcher } from "./convex-token";
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
  useVisibleTask$(
    async ({ cleanup, track }) => {
      track(convexClient);

      const convex = convexClient.value;
      let disposed = false;
      let currentUserId: string | null = null;
      let authGeneration = 0;
      let atproto: AuthState["atproto"];
      let atprotoPending = true;
      let betterAuthPending = true;
      const isAtprotoCallback = window.location.pathname === "/auth/callback/";
      let unsubscribe: (() => void) | undefined;
      cleanup(() => {
        disposed = true;
        authGeneration++;
        unsubscribe?.();
        clearConvexSyncContext();
      });

      const publishAtproto = () => {
        if (disposed) return;
        if (authState.value.provider === "convex") {
          authState.value = {
            ...authState.value,
            atproto,
            loading: isAtprotoCallback && atprotoPending,
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
                loading: betterAuthPending,
                provider: "atproto",
                atproto,
              }
            : { user: null, loading: atprotoPending || betterAuthPending };
        }
      };
      // A Bluesky refresh must not delay the separate Twyne/Convex session.
      void import("./atproto").then(
        async ({ initSession, ATPROTO_SESSION_CHANGED }) => {
          if (disposed) return;
          const onSessionChange = () => {
            atproto = undefined;
            publishAtproto();
          };
          window.addEventListener(ATPROTO_SESSION_CHANGED, onSessionChange);
          cleanup(() =>
            window.removeEventListener(
              ATPROTO_SESSION_CHANGED,
              onSessionChange,
            ),
          );
          atproto = (await initSession()) ?? undefined;
          atprotoPending = false;
          publishAtproto();
        },
      );

      const sessionAtom = authClient.useSession;
      if (!sessionAtom || typeof sessionAtom !== "object") {
        betterAuthPending = false;
        return;
      }

      function syncFromAtom() {
        if (disposed) return;
        const val = sessionAtom.get?.() ?? sessionAtom;
        betterAuthPending = val?.isPending ?? false;
        const sessionData = val?.data;
        if (val?.isPending && !sessionData?.user) return;
        if (sessionData?.user) {
          if (currentUserId === sessionData.user.id) return;
          currentUserId = sessionData.user.id;
          const generation = ++authGeneration;
          const isCurrent = () => !disposed && generation === authGeneration;
          const user: AuthUser = {
            id: sessionData.user.id,
            email: sessionData.user.email ?? "",
            name: sessionData.user.name ?? undefined,
            image: sessionData.user.image ?? undefined,
          };
          authState.value = {
            user,
            loading: isAtprotoCallback && atprotoPending,
            provider: "convex",
            convexAuthenticated: false,
            atproto,
          };
          clearConvexSyncContext();
          if (!convex) return;
          const fetchToken = createConvexTokenFetcher(async () => {
            try {
              const result = await (authClient as any).convex.token({
                fetchOptions: { throw: false },
              });
              const token = result?.data?.token ?? null;
              if (isCurrent())
                user.analyticsId = analyticsIdFromConvexJwt(token);
              return token;
            } catch (error) {
              if (isCurrent())
                reportApplicationError(
                  "twyne:auth:install-convex-token",
                  error,
                  {
                    source: "auth",
                    title: "Cloud sync is paused",
                    dedupeKey: "convex-auth",
                    metadata: { operation: "install-convex-token" },
                  },
                );
              return null;
            }
          }, isCurrent);
          convex.setAuth(fetchToken, (authenticated) => {
            if (!isCurrent()) return;
            authState.value = {
              user,
              loading: isAtprotoCallback && atprotoPending,
              provider: "convex",
              convexAuthenticated: authenticated,
              atproto,
            };
            if (authenticated) setConvexSyncContext(convex, user.id);
            else clearConvexSyncContext();
          });
        } else {
          currentUserId = null;
          authGeneration++;
          convex?.setAuth(async () => null);
          clearConvexSyncContext();
          authState.value = { user: null, loading: val?.isPending ?? false };
          publishAtproto();
        }
      }
      syncFromAtom();
      if (typeof sessionAtom.subscribe === "function") {
        unsubscribe = sessionAtom.subscribe(syncFromAtom);
      }
    },
    { strategy: "document-ready" },
  );

  return <Slot />;
});
