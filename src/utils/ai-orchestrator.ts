/**
 * AI orchestrator — routes calls through the priority chain:
 *
 *   1. Client-side AI (BYOK) — if user has configured providers
 *   2. Convex server action — the existing server-side path
 *   3. Local deterministic fallback — always works, no network
 *
 * All panels import this instead of calling Convex actions directly,
 * so BYOK is transparently enabled everywhere.
 */

import type { AiSettings, AiFeature } from "../types";
import { loadAiSettingsFromIdb } from "./idb";
import {
  runClientAgent,
  normalizeAiSettings,
} from "./ai-client";
import type {
  AgentRequest,
  AgentResponse,
} from "../../convex/agentPrompts";
import type { ConvexClient } from "convex/browser";

/* ── Cached settings ────────────────────────────────────────────── */

let _cachedSettings: AiSettings | null = null;

export async function getCachedAiSettings(): Promise<AiSettings> {
  if (_cachedSettings) return _cachedSettings;
  const raw = await loadAiSettingsFromIdb();
  _cachedSettings = normalizeAiSettings(raw);
  return _cachedSettings;
}

export function invalidateAiSettingsCache(): void {
  _cachedSettings = null;
}

/* ── Convenience: run with full fallback chain ──────────────────── */

export interface OrchestratorOptions {
  feature: AiFeature;
  req: AgentRequest;
  client: ConvexClient | null;
  serverAction?: () => Promise<AgentResponse>;
  localFallback?: () => AgentResponse;
}

export async function runAiWithFallback(
  opts: OrchestratorOptions,
): Promise<AgentResponse> {
  // 1. Try client-side AI
  const settings = await getCachedAiSettings();
  if (settings.advancedMode && settings.providers.length > 0) {
    const clientResult = await runClientAgent(opts.feature, opts.req, settings);
    if (clientResult) {
      // Tag with "client" prefix so UI can distinguish
      return {
        ...clientResult,
        provider: `client-${clientResult.provider}` as AgentResponse["provider"],
      };
    }
  }

  // 2. Try server action
  if (opts.serverAction) {
    try {
      return await opts.serverAction();
    } catch (err) {
      console.warn(
        `[twyne:ai-orchestrator] server action failed for ${opts.feature}:`,
        err,
      );
    }
  }

  // 3. Local fallback
  if (opts.localFallback) {
    return opts.localFallback();
  }

  // Ultimate fallback — should never reach here if localFallback is provided
  return {
    text: "The room is quiet. Try again when connected.",
    type: "perspective",
    provider: "local",
  };
}

/* ── Provider tag display helper ────────────────────────────────── */

export function formatProviderTag(
  provider: AgentResponse["provider"] | string,
): string {
  if (provider.startsWith("client-")) {
    const name = provider.slice(7);
    return `client:${name}`;
  }
  return provider;
}
