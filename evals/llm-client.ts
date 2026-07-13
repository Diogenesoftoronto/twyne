/**
 * Shared Portkey gateway client for the eval harness.
 *
 * All eval scripts call the hosted Portkey gateway (https://api.portkey.ai/v1)
 * instead of talking to model providers directly. Routing uses Portkey's
 * model-catalog model strings ("@neuralwatt/<model>"), so no provider header
 * or upstream credential is needed here — the neuralwatt key lives in the
 * Portkey Model Catalog.
 *
 * Env:
 *   PORTKEY_API_KEY        required
 *   PORTKEY_BASE_URL       optional, defaults to https://api.portkey.ai/v1
 *   PORTKEY_DEFAULT_MODEL  optional, defaults to @neuralwatt/qwen3.5-397b-fast
 *   JUDGE_MODEL            optional, defaults to @neuralwatt/kimi-k2.6
 */

const PORTKEY_API_KEY = process.env.PORTKEY_API_KEY;
const PORTKEY_BASE_URL = (
  process.env.PORTKEY_BASE_URL ?? "https://api.portkey.ai/v1"
).replace(/\/$/, "");

export const DEFAULT_MODEL =
  process.env.PORTKEY_DEFAULT_MODEL ?? "@neuralwatt/qwen3.5-397b-fast";
export const JUDGE_MODEL =
  process.env.JUDGE_MODEL ?? "@neuralwatt/kimi-k2.6";

export interface ChatOptions {
  system: string;
  user: string;
  model: string;
  temperature: number;
  /** Omitted / null → no max_tokens sent. */
  maxTokens?: number | null;
  signal: AbortSignal;
}

const RETRY_DELAYS_MS = [1_500, 4_000];
const MAX_ATTEMPTS = 3;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal.aborted) {
      clearTimeout(t);
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function chatCompletionOnce(
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<string> {
  if (!PORTKEY_API_KEY) {
    throw new Error("PORTKEY_API_KEY is required");
  }
  const res = await fetch(`${PORTKEY_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-portkey-api-key": PORTKEY_API_KEY,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Portkey ${res.status}: ${text.slice(0, 300)}`);
    // Attach status so the retry layer can decide without parsing the message.
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Portkey response missing choices[0].message.content");
  }
  return content;
}

/**
 * Chat-completions call with retry. Network errors and HTTP 5xx / 504 / 408 /
 * 429 responses are retried up to {@link MAX_ATTEMPTS} total attempts with a
 * short backoff; other 4xx and non-retryable errors propagate immediately.
 * The AbortSignal is owned by the caller and is left untouched.
 */
export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: opts.temperature,
  };
  if (opts.maxTokens !== undefined && opts.maxTokens !== null) {
    body.max_tokens = opts.maxTokens;
  }
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await chatCompletionOnce(body, opts.signal);
    } catch (err) {
      const e = err as Error & { status?: number; name?: string };
      lastErr = e;
      const isAbort = e.name === "AbortError";
      const status = e.status;
      const retryableNetwork =
        e instanceof TypeError ||
        // node fetch surfaces transient failures as system errors
        e.name === "FetchError" ||
        // undici uses these
        e.name === "UndiciError";
      const retryableStatus =
        typeof status === "number" &&
        (status === 504 || status === 408 || status === 429 || status >= 500);
      const shouldRetry =
        attempt < MAX_ATTEMPTS - 1 &&
        !isAbort &&
        (retryableNetwork || retryableStatus);
      if (!shouldRetry) throw e;
      await sleep(RETRY_DELAYS_MS[attempt], opts.signal);
    }
  }
  // Unreachable, but keep TS happy.
  throw lastErr ?? new Error("Portkey call failed");
}
