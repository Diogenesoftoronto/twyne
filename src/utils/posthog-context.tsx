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
import { useAuth } from "./auth-context";
import { ANALYTICS_VERSION } from "./analytics-version";
import { authIdentityTransition, consumeAuthAttempt } from "./auth-analytics";
import {
  FALLBACK_FEATURES,
  POSTHOG_FEATURE_FLAG_KEYS,
  setRuntimeFeatures,
  type FeatureFlags,
} from "./feature-flags";
import { buildPostHogInitOptions, shouldLoadPostHog } from "./posthog-config";
import { createPostHogRuntime, type PostHogClient } from "./posthog-runtime";

interface FeatureFlagState {
  flags: FeatureFlags;
  loaded: boolean;
  configured: boolean;
  error?: string;
}

export interface PostHogIdentityContext {
  distinctId?: string;
  anonymousId?: string;
  sessionId?: string;
}

export const FeatureFlagContext = createContextId<Signal<FeatureFlagState>>(
  "twyne.feature-flags",
);

function posthogConfig(): {
  key: string;
  host: string;
  capture: boolean;
} | null {
  if (
    typeof navigator !== "undefined" &&
    !shouldLoadPostHog(navigator.userAgent)
  ) {
    return null;
  }
  const key = import.meta.env.PUBLIC_POSTHOG_KEY as string | undefined;
  if (!key) return null;
  return {
    key,
    host:
      (import.meta.env.PUBLIC_POSTHOG_HOST as string | undefined) ??
      "https://us.i.posthog.com",
    capture: import.meta.env.PUBLIC_POSTHOG_CAPTURE !== "false",
  };
}

async function getPostHogClient(): Promise<PostHogClient | null> {
  if (typeof window === "undefined") return null;
  if (!posthogConfig()) return null;
  return posthogRuntime.get();
}

const posthogRuntime = createPostHogRuntime(
  () => import("posthog-js").then((mod) => mod.default),
  (client) => {
    const config = posthogConfig();
    if (!config) return;
    client.init(config.key, {
      ...buildPostHogInitOptions({
        host: config.host,
        capture: config.capture,
        flagKeys: Object.values(POSTHOG_FEATURE_FLAG_KEYS),
      }),
      // SDK failures are optional analytics failures, not app errors.
      on_request_error: () => {},
    });
  },
);

function runPostHogAction(action: (client: PostHogClient) => void): void {
  if (typeof window === "undefined" || !posthogConfig()) return;
  posthogRuntime.run(action);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export async function getPostHogIdentityContext(): Promise<PostHogIdentityContext> {
  const client = posthogRuntime.peek();
  if (!client) {
    // Identity is optional: an AI action must not await SDK loading.
    void getPostHogClient();
    return {};
  }
  try {
    return readIdentity(client);
  } catch {
    posthogRuntime.disable();
    return {};
  }
}

function readIdentity(client: PostHogClient): PostHogIdentityContext {
  return {
    distinctId: optionalString(client.get_distinct_id()),
    anonymousId: optionalString(client.get_property("$device_id")),
    sessionId: optionalString(client.get_session_id()),
  };
}

export async function capturePostHogEvent(
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  // Queue analytics independently; callers can continue their work immediately.
  runPostHogAction((client) => {
    const identity = readIdentity(client);
    client.capture(event, {
      ...properties,
      ...(event === "$ai_generation" && !properties.$ai_session_id
        ? { $ai_session_id: identity.sessionId }
        : {}),
      twyne_distinct_id: identity.distinctId,
      twyne_anonymous_id: identity.anonymousId,
      twyne_session_id: identity.sessionId,
    });
  });
}

/**
 * Display the specifically configured progress survey after a meaningful
 * milestone. An explicit survey name prevents a future unrelated survey from
 * interrupting the editor; an unset name keeps this integration inert.
 */
export async function maybeDisplayProgressSurvey(
  milestone: "dossier_completed" | "draft_exported",
): Promise<void> {
  const surveyName = optionalString(
    import.meta.env.PUBLIC_POSTHOG_PROGRESS_SURVEY_NAME as string | undefined,
  );
  if (!surveyName) return;

  runPostHogAction((client) => {
    client.getActiveMatchingSurveys((surveys) => {
      const survey = surveys.find((candidate) => candidate.name === surveyName);
      if (!survey) return;
      runPostHogAction((current) => {
        current.displaySurvey(survey.id, {
          displayType: "popover",
          ignoreConditions: false,
          ignoreDelay: false,
          properties: { twyne_milestone: milestone },
        });
      });
    });
  });
}

function readFlags(client: PostHogClient): FeatureFlags {
  return {
    pricing:
      client.isFeatureEnabled(POSTHOG_FEATURE_FLAG_KEYS.pricing) ??
      FALLBACK_FEATURES.pricing,
    localAi:
      client.isFeatureEnabled(POSTHOG_FEATURE_FLAG_KEYS.localAi) ??
      FALLBACK_FEATURES.localAi,
  };
}

export function useFeatureFlags(): Signal<FeatureFlagState> {
  return useContext(FeatureFlagContext);
}

export const PostHogProvider = component$(() => {
  const flags = useSignal<FeatureFlagState>({
    flags: FALLBACK_FEATURES,
    // The app is ready with its fallback flags before analytics is ready.
    loaded: true,
    configured: !!posthogConfig(),
  });
  const auth = useAuth();

  useContextProvider(FeatureFlagContext, flags);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    async ({ cleanup }) => {
      let disposed = false;
      cleanup(() => {
        disposed = true;
      });
      const client = await getPostHogClient();
      if (disposed) return;
      if (!client) {
        flags.value = {
          flags: flags.value.flags,
          loaded: true,
          configured: false,
        };
        return;
      }

      const apply = (next: FeatureFlags) => {
        const previous = flags.value.flags;
        if (
          previous.pricing === next.pricing &&
          previous.localAi === next.localAi
        ) {
          return;
        }
        setRuntimeFeatures(next);
        flags.value = {
          flags: next,
          loaded: true,
          configured: true,
        };
      };

      try {
        const unsubscribe = client.onFeatureFlags((_keys, _variants, meta) => {
          // Keep defaults or the last good values when a request is blocked.
          if (disposed || meta?.errorsLoading || !posthogRuntime.peek()) return;
          try {
            apply(readFlags(client));
          } catch {
            posthogRuntime.disable();
          }
        });
        if (typeof unsubscribe === "function") cleanup(unsubscribe);
      } catch {
        posthogRuntime.disable();
      }
    },
    { strategy: "document-idle" },
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track, cleanup }) => {
      let disposed = false;
      cleanup(() => {
        disposed = true;
      });
      track(() => auth.value.user?.id);
      track(() => auth.value.user?.analyticsId);
      track(() => auth.value.user?.email);
      track(() => auth.value.user?.name);
      track(() => auth.value.loading);
      track(() => auth.value.provider);

      if (auth.value.loading) return;
      // Snapshot the account so deferred analytics cannot read another account.
      const user = auth.value.user;
      const provider = auth.value.provider;
      runPostHogAction((client) => {
        if (disposed) return;
        if (user) {
          const analyticsId = user.analyticsId ?? user.id;
          const previousUserId = optionalString(
            client.get_property("$user_id"),
          );
          const identityTransition = authIdentityTransition(
            previousUserId,
            user.id,
            analyticsId,
          );

          if (identityTransition === "alias_legacy_id") {
            // Before analytics v2 the browser used Better Auth's raw user ID,
            // while authenticated server events used Convex's tokenIdentifier.
            // Alias only that known same-account legacy ID; a different account
            // must receive a clean anonymous identity instead.
            client.alias(analyticsId, previousUserId);
          } else if (identityTransition === "reset_other_account") {
            client.reset();
          }
          client.identify(analyticsId, {
            email: user.email,
            name: user.name,
            auth_provider: provider,
            auth_identity_source: user.analyticsId
              ? "convex_token_identifier"
              : "better_auth_user_id_fallback",
          });

          const attempt = consumeAuthAttempt();
          if (attempt) {
            client.capture("sign_in_completed", {
              analytics_version: ANALYTICS_VERSION,
              provider: provider ?? "convex",
              method: attempt.method,
              flow: attempt.flow,
            });
          } else if (identityTransition !== "already_identified") {
            client.capture("auth_session_restored", {
              analytics_version: ANALYTICS_VERSION,
              provider: provider ?? "convex",
            });
          }
        } else if (client.get_property("$user_id")) {
          // `reset()` creates a fresh anonymous id. Only do that when an
          // identified session actually ended; resetting every anonymous page
          // load made the same returning writer look like a brand-new person.
          client.reset();
        }
      });
    },
    { strategy: "document-idle" },
  );

  return <Slot />;
});
