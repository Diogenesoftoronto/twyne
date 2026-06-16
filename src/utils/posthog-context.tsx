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
import type posthog from "posthog-js";
import { useAuth } from "./auth-context";
import {
  FALLBACK_FEATURES,
  POSTHOG_FEATURE_FLAG_KEYS,
  setRuntimeFeatures,
  type FeatureFlags,
} from "./feature-flags";

interface FeatureFlagState {
  flags: FeatureFlags;
  loaded: boolean;
  configured: boolean;
  error?: string;
}

type PostHogClient = typeof posthog;

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
      client.init(config.key, {
        api_host: config.host,
        defaults: "2026-01-30",
        autocapture: config.capture,
        capture_pageview: config.capture,
        capture_pageleave: config.capture,
        disable_session_recording: !config.capture,
        opt_out_capturing_by_default: !config.capture,
        flag_keys: Object.values(POSTHOG_FEATURE_FLAG_KEYS),
      });
      initialized = true;
    }
    return client;
  });

  return clientPromise;
}

export async function capturePostHogEvent(
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const client = await getPostHogClient();
  if (!client) return;
  client.capture(event, properties);
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
  useVisibleTask$(async ({ cleanup }) => {
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
      const next = meta?.errorsLoading ? FALLBACK_FEATURES : readFlags(client);
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
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    track(() => auth.value.user?.id);
    track(() => auth.value.loading);

    const client = await getPostHogClient();
    if (!client || auth.value.loading) return;

    if (auth.value.user) {
      client.identify(auth.value.user.id, {
        email: auth.value.user.email,
        name: auth.value.user.name,
        authProvider: auth.value.provider,
      });
    } else {
      client.reset();
    }
  });

  return <Slot />;
});
