/**
 * The whole Convex backend in one process, for tests and evals.
 *
 * `convex-test` loads every module under `convex/` and runs queries,
 * mutations, actions and the HTTP router in memory. On top of that this file
 * seeds writers with personal access tokens and serves the real
 * `/api/integrations/v1` route on a local port, so the unmodified `twyne` CLI
 * and `twyne-mcp` server can drive the app exactly as they drive a deployment.
 *
 * Hosted model calls go where `model` says:
 *
 *   mock               the scripted endpoint in ./mock-model.ts, through the
 *                      app's legacy OpenAI-compatible route (RIVET_ENDPOINT)
 *   openai-compatible  TWYNE_APP_MODEL_BASE_URL / _API_KEY / TWYNE_APP_MODEL,
 *                      through the same route
 *   notorganic         the app's own Not Organic routing; each seeded writer
 *                      is linked to TWYNE_EVAL_DID
 *
 * Run it standalone to point the CLI or an MCP client at it:
 *
 *   bun evals/app/local-app.ts --model mock [--port 8788]
 */
import { readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { startKeenableBridge, type KeenableBridge } from "./keenable-bridge";
import { startMockModel, type MockModelServer } from "./mock-model";

export type AppModelMode = "mock" | "openai-compatible" | "notorganic";

/**
 * Where the editorial review gate's System One judgements go. Not Organic
 * routes them itself; otherwise `mock` answers from ./mock-model.ts and
 * `direct` uses TYPESAFE_API_KEY. Defaults: mock with the mock model, direct
 * when a TypeSafe key is present, off otherwise.
 */
export type SystemOneMode = "mock" | "direct" | "off";

/**
 * Where auto-research searches. `mock` answers from ./mock-model.ts;
 * `notorganic` uses Not Organic's metered web search as the writer's linked
 * account; `keenable` makes Not Organic's upstream Keenable search locally
 * (./keenable-bridge.ts, KEENABLE_API_KEY) while the gateway's own search is
 * down; `custom` points the app's custom provider at TWYNE_APP_SEARCH_URL
 * (with optional TWYNE_APP_SEARCH_API_KEY); `off` leaves research
 * unconfigured, which `research.sources` answers with 503. Defaults: mock with
 * the mock model, notorganic with --model notorganic.
 */
export type ResearchMode =
  | "mock"
  | "notorganic"
  | "keenable"
  | "custom"
  | "off";

export interface ArizeTracingConfig {
  apiKey: string;
  spaceId: string;
  projectName: string;
  region?: string;
  /** Spans carry prompts and outputs. Eval corpora are synthetic, so on by default. */
  captureContent?: boolean;
}

export interface LocalAppOptions {
  model: AppModelMode;
  /** Where credentials are read from. Defaults to the environment at call time. */
  env?: Readonly<Record<string, string | undefined>>;
  port?: number;
  tracing?: ArizeTracingConfig | null;
  systemOne?: SystemOneMode;
  research?: ResearchMode;
}

export interface LocalWriter {
  token: string;
  tokenIdentifier: string;
}

export interface UsageTotals {
  calls: number;
  /** The app's own cost estimate (`aiUsageEvents.costMicrousd`). */
  costMicrousd: number;
  /** Calls the app could not price. */
  unpriced: number;
  inputTokens: number;
  outputTokens: number;
}

/** What Not Organic billed the eval account, read through the app itself. */
export interface HostedBilling {
  billedMicrousd: number;
  settledRequests: number;
  unresolvedRequests: number;
  truncated: boolean;
}

/** A System One (Jev) request, as `convex/systemOne.ts` validates it. */
export interface JudgementAsk {
  state: Record<string, string>;
  questions: Record<
    string,
    {
      type: "noul" | "choice" | "score";
      instructions: string;
      criteria?: string[];
    }
  >;
  model?: string;
}

export interface JudgementAnswer {
  ok: boolean;
  model?: string;
  answers?: Record<string, unknown>;
  transport?: string;
  error?: string;
}

/** A Clairic extraction request, as `convex/extraction.ts` validates it. */
export interface ExtractionAsk {
  state?: string;
  fields: Record<
    string,
    { type: string; instructions?: string; [key: string]: unknown }
  >;
  reference_date?: string;
}

export interface ExtractionAnswer {
  ok: boolean;
  model?: string;
  answers?: Record<string, unknown>;
  transport?: string;
  error?: string;
}

export interface LocalApp {
  /** Origin serving `/api/integrations/v1`; use as TWYNE_API_URL. */
  url: string;
  /** Short description of where hosted calls go, for reports. */
  modelLabel: string;
  mock?: MockModelServer;
  /** A fresh writer with its own token. Rate limits are per writer. */
  newWriter(name?: string): Promise<LocalWriter>;
  /**
   * The integration route without a socket in between. Async context survives
   * the call, so spans the app emits nest under the caller's active span.
   */
  fetch: typeof fetch;
  /** Every hosted call the app recorded since it started. */
  usage(): Promise<UsageTotals>;
  /**
   * With `--model notorganic`: what the account was billed between two
   * instants, from the app's own `providerIdentity.getHostedUsage`. Null for
   * other modes or when the provider cannot say.
   */
  billed(from: number, to: number): Promise<HostedBilling | null>;
  /**
   * Ask Jev through the app's own System One path (`systemOne.askAs`), as an
   * evaluator writer: the same transport, metering and rate limits the
   * editors' review gate uses, so evals need no separate credentials.
   */
  judge(request: JudgementAsk): Promise<JudgementAnswer>;
  /** Clairic typed extraction through the app's own path (`extraction.extractAs`). */
  extract(request: ExtractionAsk): Promise<ExtractionAnswer>;
  close(): Promise<void>;
}

const CONVEX_DIR = resolve(
  fileURLToPath(new URL("../../convex", import.meta.url)),
);
const ISSUER = "https://twyne.test";

/**
 * Keys the Convex modules read for outside services. Bun loads `.env` files on
 * its own, so without this a mock run could quietly reach TypeSafe, PostHog or
 * a legacy provider. Each mode below re-adds only what it needs.
 */
const SERVICE_KEY =
  /^(NOTORGANIC_|TYPESAFE_|POSTHOG_|PUBLIC_POSTHOG_|RESEND_|ARIZE_|RESEARCH_|TINYFISH_|ANTHROPIC_|OPENAI_|RIVET_|PORTKEY_|VOICE_|FISH_|ELEVENLABS_|FAL_|GEMINI_|GOOGLE_|TWYNE_ALLOW_)/;

function isolateServiceEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (SERVICE_KEY.test(key)) delete process.env[key];
  }
}

function convexModules(): Record<string, () => Promise<unknown>> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /\.(ts|js)$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.endsWith(".test.ts")
      )
        files.push(path);
    }
  };
  walk(CONVEX_DIR);
  return Object.fromEntries(files.map((file) => [file, () => import(file)]));
}

function required(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required for this model mode`);
  return value;
}

async function routeModel(
  mode: AppModelMode,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{
  label: string;
  mock?: MockModelServer;
  did?: string;
  sessionVersion?: number;
}> {
  if (mode === "mock") {
    const mock = await startMockModel();
    process.env.RIVET_ENDPOINT = mock.url;
    process.env.RIVET_MODEL = "twyne-mock";
    return { label: "mock (scripted)", mock };
  }
  if (mode === "openai-compatible") {
    // The legacy route appends /v1 itself.
    process.env.RIVET_ENDPOINT = required(env, "TWYNE_APP_MODEL_BASE_URL")
      .replace(/\/+$/, "")
      .replace(/\/v1$/, "");
    process.env.RIVET_MODEL = required(env, "TWYNE_APP_MODEL");
    if (env.TWYNE_APP_MODEL_API_KEY)
      process.env.RIVET_TOKEN = env.TWYNE_APP_MODEL_API_KEY;
    return { label: `openai-compatible ${process.env.RIVET_MODEL}` };
  }
  for (const key of [
    "NOTORGANIC_ISSUER",
    "NOTORGANIC_ASSERTION_PRIVATE_KEY",
    "NOTORGANIC_ASSERTION_KEY_ID",
    "NOTORGANIC_AUDIENCE",
  ]) {
    if (env[key] !== undefined) process.env[key] = env[key];
  }
  required(env, "NOTORGANIC_ASSERTION_PRIVATE_KEY");
  process.env.NOTORGANIC_ENABLED = "true";
  process.env.NOTORGANIC_GENERATION_MAX_COST_MICROUSD =
    env.NOTORGANIC_GENERATION_MAX_COST_MICROUSD ??
    required(env, "TWYNE_EVAL_MAX_COST_MICROUSD");
  return {
    label: "notorganic",
    did: required(env, "TWYNE_EVAL_DID"),
    // The version Not Organic holds for the account; a DID without an account
    // row there is at 0, and a mismatch is refused as a revoked session.
    sessionVersion: Number(env.TWYNE_EVAL_SESSION_VERSION ?? 1),
  };
}

function applyTracing(tracing: ArizeTracingConfig | null | undefined): void {
  if (!tracing) return;
  process.env.ARIZE_API_KEY = tracing.apiKey;
  process.env.ARIZE_SPACE_ID = tracing.spaceId;
  process.env.ARIZE_PROJECT_NAME = tracing.projectName;
  if (tracing.region) process.env.ARIZE_REGION = tracing.region;
  process.env.ARIZE_CAPTURE_CONTENT =
    tracing.captureContent === false ? "false" : "true";
}

export async function startLocalApp(
  options: LocalAppOptions,
): Promise<LocalApp> {
  const env = options.env ?? { ...process.env };
  const before = { ...process.env };
  isolateServiceEnv();
  const routed = await routeModel(options.model, env);
  applyTracing(options.tracing);
  const systemOne =
    options.systemOne ??
    (options.model === "notorganic"
      ? "notorganic"
      : options.model === "mock"
        ? "mock"
        : env.TYPESAFE_API_KEY
          ? "direct"
          : "off");
  if (systemOne === "direct" && options.model === "notorganic") {
    // Not Organic wins over a direct key in the app's transport rules
    // (convex/lib/hostedTransports.ts). Its System One route can be down while
    // its inference is up, so for an eval the judgements are pinned to the
    // direct key and only the models go through Not Organic.
    process.env.TWYNE_EVAL_JUDGEMENT_TRANSPORT = "direct";
  }
  if (systemOne === "mock") {
    routed.mock ??= await startMockModel();
    process.env.TYPESAFE_API_KEY = "twyne-mock";
    process.env.TYPESAFE_BASE_URL = routed.mock.url;
  } else if (systemOne === "direct") {
    process.env.TYPESAFE_API_KEY = required(env, "TYPESAFE_API_KEY");
    if (env.TYPESAFE_BASE_URL)
      process.env.TYPESAFE_BASE_URL = env.TYPESAFE_BASE_URL;
  }

  let keenable: KeenableBridge | undefined;
  const research: ResearchMode =
    options.research ??
    (options.model === "mock"
      ? "mock"
      : options.model === "notorganic"
        ? "notorganic"
        : "off");
  if (research === "mock") {
    routed.mock ??= await startMockModel();
    process.env.RESEARCH_PROVIDER = "custom";
    process.env.RESEARCH_SEARCH_URL = `${routed.mock.url}/v1/search`;
  } else if (research === "notorganic") {
    if (options.model !== "notorganic")
      throw new Error("--research notorganic needs --model notorganic");
    process.env.RESEARCH_PROVIDER = "notorganic";
    if (env.NOTORGANIC_SEARCH_MAX_COST_MICROUSD)
      process.env.NOTORGANIC_SEARCH_MAX_COST_MICROUSD =
        env.NOTORGANIC_SEARCH_MAX_COST_MICROUSD;
  } else if (research === "keenable") {
    keenable = await startKeenableBridge(required(env, "KEENABLE_API_KEY"));
    process.env.RESEARCH_PROVIDER = "custom";
    process.env.RESEARCH_SEARCH_URL = keenable.url;
  } else if (research === "custom") {
    process.env.RESEARCH_PROVIDER = "custom";
    process.env.RESEARCH_SEARCH_URL = required(env, "TWYNE_APP_SEARCH_URL");
    if (env.TWYNE_APP_SEARCH_API_KEY)
      process.env.RESEARCH_API_KEY = env.TWYNE_APP_SEARCH_API_KEY;
  }

  const t = convexTest(schema, convexModules() as never);
  let writers = 0;
  let billingWriter: LocalWriter | undefined;
  // Jev and Clairic are rate-limited per writer (20 a minute on the free
  // tier), so evaluator calls rotate through a small pool of writers.
  const evaluators: LocalWriter[] = [];
  let evaluatorTurn = 0;
  const EVALUATOR_POOL = 8;
  const nextEvaluator = async (): Promise<LocalWriter> => {
    const slot = evaluatorTurn++ % EVALUATOR_POOL;
    evaluators[slot] ??= await newWriter(`evaluator-${slot}`);
    return evaluators[slot];
  };

  const newWriter = async (name = "eval-writer"): Promise<LocalWriter> => {
    writers += 1;
    const subject = `${name}-${writers}`;
    const tokenIdentifier = `${ISSUER}|${subject}`;
    const writer = t.withIdentity({ tokenIdentifier, subject, issuer: ISSUER });
    if (routed.did) {
      const now = Date.now();
      await t.run(async (ctx) => {
        await ctx.db.insert("providerIdentities", {
          productSubject: subject,
          did: routed.did as string,
          verificationMethod: "notorganic_pkce",
          sessionVersion: routed.sessionVersion ?? 1,
          verifiedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      });
    }
    const created = await writer.mutation(api.integrations.createToken, {
      name: subject,
    });
    return { token: created.token, tokenIdentifier };
  };

  const appFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      "http://local.twyne",
    );
    const request = input instanceof Request ? input : undefined;
    return t.fetch(`${url.pathname}${url.search}`, {
      method: init?.method ?? request?.method ?? "GET",
      headers: init?.headers ?? request?.headers,
      body: init?.body ?? (request ? await request.text() : undefined),
    });
  }) as typeof fetch;

  const server: Server = createServer(async (req, res) => {
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
      const response = await t.fetch(req.url ?? "/", {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
  await new Promise<void>((done) =>
    server.listen(options.port ?? 0, "127.0.0.1", () => done()),
  );
  const { port } = server.address() as { port: number };
  // This is a local deployment; the direct transports only run on one.
  process.env.CONVEX_CLOUD_URL = `http://127.0.0.1:${port}`;

  return {
    url: `http://127.0.0.1:${port}`,
    modelLabel: `${routed.label}; System One ${systemOne}; research ${research}`,
    mock: routed.mock,
    newWriter,
    fetch: appFetch,
    judge: async (request) =>
      (await t.action(internal.systemOne.askAs, {
        ownerId: (await nextEvaluator()).tokenIdentifier,
        ...request,
      })) as JudgementAnswer,
    extract: async (request) =>
      (await t.action(internal.extraction.extractAs, {
        ownerId: (await nextEvaluator()).tokenIdentifier,
        ...request,
      } as never)) as ExtractionAnswer,
    billed: async (from, to) => {
      if (!routed.did) return null;
      billingWriter ??= await newWriter("billing");
      try {
        return (await t
          .withIdentity({
            tokenIdentifier: billingWriter.tokenIdentifier,
            subject: billingWriter.tokenIdentifier.slice(ISSUER.length + 1),
            issuer: ISSUER,
          })
          .action(api.providerIdentity.getHostedUsage, {
            from,
            to,
          })) as HostedBilling;
      } catch {
        return null;
      }
    },
    usage: () =>
      t.run(async (ctx) => {
        const totals: UsageTotals = {
          calls: 0,
          costMicrousd: 0,
          unpriced: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        for (const event of await ctx.db.query("aiUsageEvents").collect()) {
          totals.calls += 1;
          if (typeof event.costMicrousd === "number")
            totals.costMicrousd += event.costMicrousd;
          else totals.unpriced += 1;
          totals.inputTokens += event.inputTokens ?? 0;
          totals.outputTokens += event.outputTokens ?? 0;
        }
        return totals;
      }),
    close: async () => {
      await new Promise<void>((done) => server.close(() => done()));
      await routed.mock?.close();
      await keenable?.close();
      // Leave the process as it was found; tests share one.
      for (const key of Object.keys(process.env))
        if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    },
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const model = (flag("--model") ?? "mock") as AppModelMode;
  if (!["mock", "openai-compatible", "notorganic"].includes(model)) {
    console.error("--model must be mock, openai-compatible or notorganic");
    process.exit(2);
  }
  const app = await startLocalApp({
    model,
    port: Number(flag("--port") ?? 0),
  });
  const writer = await app.newWriter("local");
  console.log(`Twyne is running in-process (${app.modelLabel}).\n`);
  console.log(`export TWYNE_API_URL=${app.url}`);
  console.log(`export TWYNE_ACCESS_TOKEN=${writer.token}\n`);
  console.log("Ctrl-C to stop.");
  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
