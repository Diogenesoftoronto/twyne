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
import { api } from "../../convex/_generated/api";
import { withAccountProfile, type AccountProfile } from "./account-display";

export interface AuthUser {
  id: string;
  /** Stable identifier shared by browser and authenticated server analytics. */
  analyticsId?: string;
  email: string;
  name?: string;
  image?: string;
  handle?: string;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** True only after a Better Auth token has been installed in Convex. */
  convexAuthenticated?: boolean;
  /**
   * Restored ATProto OAuth session, used only to write records to a PDS.
   * It is never a Twyne identity; sign-in is Not Organic only.
   */
  atproto?: {
    did: string;
    handle: string;
    displayName?: string;
    avatar?: string;
  };
  /** Set once a Not Organic–backed Better Auth session is present. */
  provider?: "convex";
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
      let unsubscribeProfile: (() => void) | undefined;
      let profile: AccountProfile | null = null;
      let sessionUser: AuthUser | null = null;
      cleanup(() => {
        disposed = true;
        authGeneration++;
        unsubscribe?.();
        unsubscribeProfile?.();
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
          authState.value = {
            user: null,
            loading: betterAuthPending,
            atproto,
          };
        }
      };
      // A PDS publishing session must not delay the Twyne/Convex session.
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
          const user: AuthUser = {
            id: sessionData.user.id,
            // Not Organic users carry an undeliverable placeholder address.
            email: sessionData.user.email?.endsWith("@notorganic.invalid")
              ? ""
              : (sessionData.user.email ?? ""),
            name: sessionData.user.name ?? undefined,
            image: sessionData.user.image ?? undefined,
          };
          if (currentUserId === user.id && sessionUser) {
            // A refresh can update a name/photo without changing the account.
            // Keep the token callback's base user current as well as the UI.
            Object.assign(sessionUser, user);
            authState.value = {
              ...authState.value,
              user: withAccountProfile(sessionUser, profile),
            };
            return;
          }
          unsubscribeProfile?.();
          unsubscribeProfile = undefined;
          profile = null;
          sessionUser = user;
          currentUserId = user.id;
          const generation = ++authGeneration;
          const isCurrent = () => !disposed && generation === authGeneration;
          authState.value = {
            user: withAccountProfile(user, profile),
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
            if (!authenticated) {
              unsubscribeProfile?.();
              unsubscribeProfile = undefined;
              profile = null;
            }
            authState.value = {
              user: withAccountProfile(user, profile),
              loading: isAtprotoCallback && atprotoPending,
              provider: "convex",
              convexAuthenticated: authenticated,
              atproto,
            };
            if (authenticated) {
              setConvexSyncContext(convex, user.id);
              if (!unsubscribeProfile) {
                unsubscribeProfile = convex.onUpdate(
                  api.profiles.getMyHandle,
                  {},
                  (row) => {
                    if (!isCurrent() || !authState.value.convexAuthenticated)
                      return;
                    profile = row;
                    authState.value = {
                      ...authState.value,
                      user: withAccountProfile(user, profile),
                    };
                  },
                  () => undefined,
                );
              }
            } else clearConvexSyncContext();
          });
        } else {
          unsubscribeProfile?.();
          unsubscribeProfile = undefined;
          profile = null;
          sessionUser = null;
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
