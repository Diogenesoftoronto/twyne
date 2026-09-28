/**
 * One door for every typed judgement Twyne asks for.
 *
 * Callers used to reach for `api.systemOne.ask` directly, which fixed the
 * model to whatever Twyne's server was configured with. This routes by the
 * writer's choice in Settings instead:
 *
 *   twyne     → the Convex action, Twyne's hosted Jev (unchanged behaviour)
 *   typesafe  → the same action with the writer's key; TypeSafe refuses
 *               browser requests, so the server relays it (and stores nothing)
 *   endpoint  → a direct browser request to a System One-compatible server,
 *               e.g. Kev on this computer. Nothing goes through Twyne.
 *
 * A writer who chose their own model never silently falls back to Twyne's:
 * if their endpoint is down, the judgement fails and each caller's existing
 * offline path takes over. Choosing a local model is often a privacy choice.
 */
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  judgementQuestions,
  validJudgementResponse,
  type JudgementQuestion,
} from "../../convex/lib/judgementContract";
import type { JudgementSettings } from "../types";
import { loadAiSettingsFromIdb } from "./idb";

export interface JudgementRequest {
  state: Record<string, string>;
  questions: Record<string, JudgementQuestion>;
  model?: string;
}

export interface JudgementResult {
  ok: boolean;
  model?: string;
  answers?: Record<string, unknown>;
  usage?: { input_tokens: number; output_tokens: number };
  transport?: "notorganic" | "direct" | "none" | "byok" | "endpoint";
  error?: string;
  /** Round trip in ms, as the browser saw it. */
  latencyMs?: number;
}

export const DEFAULT_ENDPOINT_MODEL = "kev-latest";
export const DEFAULT_TYPESAFE_MODEL = "jev-latest";
export const LOCAL_KEV_URL = "http://127.0.0.1:8009";

let cached: JudgementSettings | null | undefined;
if (typeof window !== "undefined") {
  window.addEventListener("twyne:ai-settings-saved", () => {
    cached = undefined;
  });
}

async function currentSettings(): Promise<JudgementSettings | null> {
  if (cached !== undefined) return cached;
  cached = (await loadAiSettingsFromIdb())?.judgement ?? null;
  return cached;
}

/** A trimmed base URL, or null when it is not an http(s) URL. */
export function normalizeEndpointUrl(value: string | undefined): string | null {
  const raw = value
    ?.trim()
    .replace(/\/+$/, "")
    .replace(/\/v1\/systemone$/, "");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString().replace(/\/+$/, "")
      : null;
  } catch {
    return null;
  }
}

/** Short, human description of where judgements go, for status lines. */
export function describeJudgement(settings: JudgementSettings | null): string {
  if (!settings || settings.source === "twyne") return "Jev, through Twyne";
  if (settings.source === "typesafe")
    return `${settings.typesafeModel || DEFAULT_TYPESAFE_MODEL} on your TypeSafe key`;
  const url = normalizeEndpointUrl(settings.endpointUrl);
  return `${settings.endpointModel || DEFAULT_ENDPOINT_MODEL} at ${url ?? "your endpoint"}`;
}

async function askEndpoint(
  settings: JudgementSettings,
  request: JudgementRequest,
): Promise<JudgementResult> {
  const base = normalizeEndpointUrl(settings.endpointUrl);
  if (!base) return { ok: false, transport: "endpoint", error: "unconfigured" };
  let questions: ReturnType<typeof judgementQuestions>;
  try {
    questions = judgementQuestions(request.questions);
  } catch {
    return { ok: false, transport: "endpoint", error: "malformed" };
  }
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      // Local CPU models are slow on a cold cache; give them room.
      signal: AbortSignal.timeout(120_000),
      headers: {
        "Content-Type": "application/json",
        ...(settings.endpointKey?.trim()
          ? { Authorization: `Bearer ${settings.endpointKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model:
          request.model ?? (settings.endpointModel || DEFAULT_ENDPOINT_MODEL),
        state: request.state,
        questions,
      }),
    });
  } catch {
    return { ok: false, transport: "endpoint", error: "network" };
  }
  const latencyMs = Math.round(performance.now() - started);
  if (!res.ok) {
    const error =
      res.status === 401 || res.status === 403
        ? "unauthorized"
        : res.status === 429
          ? "rate limited"
          : res.status === 422
            ? "malformed"
            : `http ${res.status}`;
    return { ok: false, transport: "endpoint", error, latencyMs };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, transport: "endpoint", error: "provider", latencyMs };
  }
  if (!validJudgementResponse(body, request.questions))
    return { ok: false, transport: "endpoint", error: "provider", latencyMs };
  return {
    ok: true,
    transport: "endpoint",
    model: body.model,
    answers: body.answers,
    usage: body.usage,
    latencyMs,
  };
}

/**
 * Ask the writer's judgement model. Same request and result shape as the
 * `systemOne.ask` action, so call sites swap one line.
 */
export async function askJudgement(
  client: ConvexClient | null | undefined,
  request: JudgementRequest,
  override?: JudgementSettings | null,
): Promise<JudgementResult> {
  const settings = override !== undefined ? override : await currentSettings();
  if (settings?.source === "endpoint") return askEndpoint(settings, request);
  if (!client) return { ok: false, transport: "none", error: "signed out" };
  const started = performance.now();
  const key =
    settings?.source === "typesafe" ? settings.typesafeKey?.trim() : undefined;
  if (settings?.source === "typesafe" && !key)
    return { ok: false, transport: "byok", error: "unconfigured" };
  const result = (await client.action(api.systemOne.ask, {
    state: request.state,
    questions: request.questions,
    ...(key
      ? {
          apiKey: key,
          model:
            request.model ??
            (settings?.typesafeModel || DEFAULT_TYPESAFE_MODEL),
        }
      : request.model
        ? { model: request.model }
        : {}),
  })) as JudgementResult;
  return { ...result, latencyMs: Math.round(performance.now() - started) };
}

/** A one-question round trip for the Settings "Test" button. */
export async function testJudgement(
  client: ConvexClient | null | undefined,
  settings: JudgementSettings,
): Promise<JudgementResult> {
  return askJudgement(
    client,
    {
      state: { text: "The package arrived two weeks late and damaged." },
      questions: {
        complaint: {
          type: "noul",
          instructions: "Is `text` a complaint?",
        },
      },
    },
    settings,
  );
}
