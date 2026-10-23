/**
 * Account-metered Not Organic client shared by evals and prompt optimization.
 * Requires NOTORGANIC_ENABLED, assertion signing configuration, TWYNE_EVAL_DID,
 * and an explicit TWYNE_EVAL_MAX_COST_MICROUSD ceiling. See README.notorganic.md.
 */
import {
  issueNotOrganicAccessToken,
  notOrganicEnabled,
  notOrganicGenerationBudgetMicrousd,
  notOrganicGenerationRequestHeaders,
  notOrganicIssuer,
  notOrganicOpenAiRoute,
} from "../convex/lib/notorganic";

export const DEFAULT_MODEL = process.env.TWYNE_EVAL_MODEL ?? "balanced";
export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "reasoning";
const TEXT_ALIASES = ["fast", "balanced", "reasoning"] as const;
type TextAlias = (typeof TEXT_ALIASES)[number];

export interface ChatOptions {
  system: string;
  user: string;
  model: string;
  temperature: number;
  maxTokens?: number | null;
  signal: AbortSignal;
}

type Env = Readonly<Record<string, string | undefined>>;

export function evalConfiguration(env: Env = process.env) {
  if (!notOrganicEnabled(env))
    throw new Error("NOTORGANIC_ENABLED must be true for hosted evals");
  if (!env.NOTORGANIC_ASSERTION_PRIVATE_KEY)
    throw new Error(
      "NOTORGANIC_ASSERTION_PRIVATE_KEY is required for hosted evals",
    );
  const did = env.TWYNE_EVAL_DID?.trim();
  if (!did || !/^did:[a-z0-9]+:[^\s]+$/.test(did))
    throw new Error(
      "TWYNE_EVAL_DID must explicitly identify the account funding evals",
    );
  const maxCostMicrousd = notOrganicGenerationBudgetMicrousd(
    env.TWYNE_EVAL_MAX_COST_MICROUSD,
  );
  const issuer = notOrganicIssuer(env);
  const url = new URL(issuer);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("NOTORGANIC_ISSUER must be an HTTPS origin");
  }
  // Not Organic refuses an assertion whose session version differs from the
  // account's; an eval DID that never opened an account there is at 0.
  const rawVersion = env.TWYNE_EVAL_SESSION_VERSION?.trim();
  const sessionVersion = rawVersion ? Number(rawVersion) : undefined;
  if (
    sessionVersion !== undefined &&
    (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0)
  )
    throw new Error(
      "TWYNE_EVAL_SESSION_VERSION must be a non-negative integer",
    );
  return { did, maxCostMicrousd, issuer, sessionVersion };
}

function textAlias(value: unknown): TextAlias {
  if (!TEXT_ALIASES.includes(value as TextAlias))
    throw new Error(
      "Eval model must be a Not Organic alias: fast, balanced, or reasoning",
    );
  return value as TextAlias;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Dependency injection is for offline contract tests; production uses fetch. */
export function createEvalClient(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
) {
  return async function completeChatBody(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const config = evalConfiguration(env);
    const alias = textAlias(body.model);
    if (!Array.isArray(body.messages) || body.messages.length === 0)
      throw new Error("Chat messages are required");
    const feature = "offline-eval";
    const authenticatedFetch = ((
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => fetchImpl(input, { ...init, signal })) as typeof fetch;
    const token = await issueNotOrganicAccessToken(
      {
        did: config.did,
        feature,
        capabilities: [`infer:${alias}`],
        ...(config.sessionVersion !== undefined
          ? { sessionVersion: config.sessionVersion }
          : {}),
      },
      env,
      authenticatedFetch,
    );
    const route = notOrganicOpenAiRoute(
      token,
      alias,
      feature,
      config.issuer,
      authenticatedFetch,
      {
        maxCostMicrousd: config.maxCostMicrousd,
      },
    );
    // All retries of this logical generation retain the same metering identity.
    const headers = notOrganicGenerationRequestHeaders(route.headers);
    const requestHeaders = Object.fromEntries(
      Object.entries(headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const payload = JSON.stringify({
      ...body,
      model: route.model,
      stream: false,
    });
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await route.fetch(
          `${route.baseURL}/chat/completions`,
          {
            method: "POST",
            headers: { ...requestHeaders, "content-type": "application/json" },
            body: payload,
            signal,
          },
        );
        if (!response.ok) {
          // Never print gateway bodies: they may contain request or credential details.
          await response.body?.cancel();
          throw Object.assign(
            new Error(`Not Organic chat failed (${response.status})`),
            { status: response.status },
          );
        }
        const json = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== "string")
          throw new Error("Not Organic response missing chat content");
        return content;
      } catch (error) {
        signal.throwIfAborted();
        const e = error as Error & { status?: number };
        const retryable =
          e instanceof TypeError ||
          e.name === "FetchError" ||
          e.name === "UndiciError" ||
          (typeof e.status === "number" &&
            (e.status === 408 || e.status === 429 || e.status >= 500));
        if (!retryable || attempt >= 2) throw error;
        await sleep([1_500, 4_000][attempt]!, signal);
      }
    }
  };
}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
  return createEvalClient()(
    {
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature,
      ...(opts.maxTokens == null ? {} : { max_tokens: opts.maxTokens }),
    },
    opts.signal,
  );
}
