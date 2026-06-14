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
import { setConvexSyncContext, clearConvexSyncContext } from "./convex-sync";
import { useConvexClient } from "./convex-context";

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /**
   * Which identity backs the current session. "atproto" means the user
   * signed in with Bluesky (PDS publishing available, but Convex-backed
   * cloud features degrade to local-first); "convex" is the email/passkey
   * better-auth account.
   */
  provider?: "convex" | "atproto";
}

export const AuthContext = createContextId<Signal<AuthState>>(
  "twyne.auth-context",
);

export function useAuth(): Signal<AuthState> {
  return useContext(AuthContext);
}

export const AuthProvider = component$(() => {
  const authState = useSignal<AuthState>({ user: null, loading: true });
  const convexClient = useConvexClient();

  useContextProvider(AuthContext, authState);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup, track }) => {
    track(convexClient);

    // A Bluesky/ATProto session takes precedence: it also completes any
    // pending OAuth `?code&state` callback on this load. If present, we
    // treat the user as signed in and skip the better-auth wiring.
    const { initSession } = await import("./atproto");
    const atproto = await initSession();
    if (atproto) {
      authState.value = {
        user: {
          id: atproto.did,
          email: atproto.handle,
          name: atproto.displayName ?? atproto.handle,
          image: atproto.avatar,
        },
        loading: false,
        provider: "atproto",
      };
      // Bluesky sessions don't carry a Convex identity; cloud sync stays
      // local-first until the user signs in with an email/passkey account.
      clearConvexSyncContext();
      return;
    }

    const sessionAtom = authClient.useSession;
    if (!sessionAtom || typeof sessionAtom !== "object") {
      authState.value = { user: null, loading: false };
      clearConvexSyncContext();
      return;
    }

    function syncFromAtom() {
      const val = sessionAtom.get?.() ?? sessionAtom;
      const sessionData = val?.data;

      if (sessionData?.user) {
        const user: AuthUser = {
          id: sessionData.user.id,
          email: sessionData.user.email ?? "",
          name: sessionData.user.name ?? undefined,
          image: sessionData.user.image ?? undefined,
        };
        authState.value = { user, loading: false, provider: "convex" };
        if (convexClient.value) {
          setConvexSyncContext(convexClient.value, user.id);
        } else {
          clearConvexSyncContext();
        }
      } else {
        authState.value = { user: null, loading: val?.isPending ?? false };
        clearConvexSyncContext();
      }
    }

    syncFromAtom();

    if (typeof sessionAtom.subscribe === "function") {
      const unsub = sessionAtom.subscribe(() => {
        syncFromAtom();
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
