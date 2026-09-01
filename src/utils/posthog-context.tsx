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
import type posthog from "posthog-js";
import { useAuth } from "./auth-context";
import { ANALYTICS_VERSION } from "./analytics-version";
import { authIdentityTransition, consumeAuthAttempt } from "./auth-analytics";
import {
  FALLBACK_FEATURES,
  POSTHOG_FEATURE_FLAG_KEYS,
  setRuntimeFeatures,
  type FeatureFlags,
} from "./feature-flags";
import { buildPostHogInitOptions } from "./posthog-config";

interface FeatureFlagState {
  flags: FeatureFlags;
  loaded: boolean;
  configured: boolean;
  error?: string;
}

type PostHogClient = typeof posthog;

export interface PostHogIdentityContext {
  distinctId?: string;
  anonymousId?: string;
  sessionId?: string;
}

export const FeatureFlagContext = createContextId<Signal<FeatureFlagState>>(
  "twyne.feature-flags",
);

let clientPromise: Promise<PostHogClient | null> | null = null;
let initialized = false;

function posthogConfig(): {
  key: string;
  host: string;
  capture: boolean;
} | null {
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
  const config = posthogConfig();
  if (!config) return null;

  clientPromise ??= import("posthog-js").then((mod) => {
    const client = mod.default;
    if (!initialized) {
      client.init(
        config.key,
        buildPostHogInitOptions({
          host: config.host,
          capture: config.capture,
          flagKeys: Object.values(POSTHOG_FEATURE_FLAG_KEYS),
        }),
      );
      initialized = true;
    }
    return client;
  });

  return clientPromise;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export async function getPostHogIdentityContext(): Promise<PostHogIdentityContext> {
  const client = await getPostHogClient();
  if (!client) return {};
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
  const client = await getPostHogClient();
  if (!client) return;
  const identity = await getPostHogIdentityContext();
  client.capture(event, {
    ...properties,
    ...(event === "$ai_generation" && !properties.$ai_session_id
      ? { $ai_session_id: identity.sessionId }
      : {}),
    twyne_distinct_id: identity.distinctId,
    twyne_anonymous_id: identity.anonymousId,
    twyne_session_id: identity.sessionId,
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

  const client = await getPostHogClient();
  if (!client) return;

  client.getActiveMatchingSurveys((surveys) => {
    const survey = surveys.find((candidate) => candidate.name === surveyName);
    if (!survey) return;
    client.displaySurvey(survey.id, {
      displayType: "popover",
      ignoreConditions: false,
      ignoreDelay: false,
      properties: { twyne_milestone: milestone },
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
    loaded: !posthogConfig(),
    configured: !!posthogConfig(),
  });
  const auth = useAuth();

  useContextProvider(FeatureFlagContext, flags);

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    async ({ cleanup }) => {
      const client = await getPostHogClient();
      if (!client) {
        setRuntimeFeatures(FALLBACK_FEATURES);
        flags.value = {
          flags: FALLBACK_FEATURES,
          loaded: true,
          configured: false,
        };
        return;
      }

      const apply = (next: FeatureFlags, error?: string) => {
        setRuntimeFeatures(next);
        flags.value = {
          flags: next,
          loaded: true,
          configured: true,
          error,
        };
      };

      const unsubscribe = client.onFeatureFlags((_keys, _variants, meta) => {
        const next = meta?.errorsLoading
          ? FALLBACK_FEATURES
          : readFlags(client);
        apply(
          next,
          meta?.errorsLoading
            ? "PostHog feature flags failed to load"
            : undefined,
        );
      });

      const cached = readFlags(client);
      apply(cached);

      if (typeof unsubscribe === "function") {
        cleanup(unsubscribe);
      }
    },
    { strategy: "document-ready" },
  );

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    async ({ track }) => {
      track(() => auth.value.user?.id);
      track(() => auth.value.user?.analyticsId);
      track(() => auth.value.user?.email);
      track(() => auth.value.user?.name);
      track(() => auth.value.loading);
      track(() => auth.value.provider);

      const client = await getPostHogClient();
      if (!client || auth.value.loading) return;

      if (auth.value.user) {
        const user = auth.value.user;
        const analyticsId = user.analyticsId ?? user.id;
        const previousUserId = optionalString(client.get_property("$user_id"));
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
          auth_provider: auth.value.provider,
          auth_identity_source:
            auth.value.provider === "atproto"
              ? "atproto_did"
              : user.analyticsId
                ? "convex_token_identifier"
                : "better_auth_user_id_fallback",
        });

        const attempt = consumeAuthAttempt();
        if (attempt) {
          client.capture("sign_in_completed", {
            analytics_version: ANALYTICS_VERSION,
            provider: auth.value.provider ?? "convex",
            method: attempt.method,
            flow: attempt.flow,
          });
        } else if (identityTransition !== "already_identified") {
          client.capture("auth_session_restored", {
            analytics_version: ANALYTICS_VERSION,
            provider: auth.value.provider ?? "convex",
          });
        }
      } else if (client.get_property("$user_id")) {
        // `reset()` creates a fresh anonymous id. Only do that when an
        // identified session actually ended; resetting every anonymous page
        // load made the same returning writer look like a brand-new person.
        client.reset();
      }
    },
    { strategy: "document-ready" },
  );

  return <Slot />;
});
