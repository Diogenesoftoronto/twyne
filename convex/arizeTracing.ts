"use node";

/**
 * Arize / Phoenix OpenInference tracer for Convex "use node" actions.
 *
 * Mirrors the dormant-when-unconfigured style of `convex/posthog.ts`: if the
 * Arize credentials are not in the deployment env we skip registering a
 * provider and turn `flushArize()` into a no-op. Convex actions are
 * serverless / short-lived, so we use `OpenInferenceSimpleSpanProcessor`
 * (synchronous export per span) rather than `BatchSpanProcessor`, which can
 * drop spans when the runtime freezes mid-batch. Each action must call
 * `await flushArize()` right before it returns so the in-flight spans
 * finish posting.
 */
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  isOpenInferenceSpan,
  OpenInferenceSimpleSpanProcessor,
} from "@arizeai/openinference-vercel";

const ARIZE_API_KEY = process.env.ARIZE_API_KEY;
const ARIZE_SPACE_ID = process.env.ARIZE_SPACE_ID;
const ARIZE_PROJECT_NAME =
  process.env.ARIZE_PROJECT_NAME ?? "twyne";
// Arize is region-sharded. The OTLP host is region-specific
// (otlp.<region>.arize.com); the US default would silently 401 a CA space.
// Override the full endpoint, or just the region, via env.
const ARIZE_REGION = process.env.ARIZE_REGION ?? "ca-central-1a";
const ARIZE_OTLP_ENDPOINT =
  process.env.ARIZE_OTLP_ENDPOINT ??
  `https://otlp.${ARIZE_REGION}.arize.com/v1/traces`;

export const tracingEnabled = Boolean(
  ARIZE_API_KEY && ARIZE_SPACE_ID,
);

let provider: NodeTracerProvider | null = null;

if (tracingEnabled) {
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      model_id: ARIZE_PROJECT_NAME,
      model_version: "1.0.0",
    }),
    spanProcessors: [
      new OpenInferenceSimpleSpanProcessor({
        exporter: new OTLPTraceExporter({
          url: ARIZE_OTLP_ENDPOINT,
          headers: {
            "arize-space-id": ARIZE_SPACE_ID as string,
            "arize-api-key": ARIZE_API_KEY as string,
          },
        }),
        spanFilter: isOpenInferenceSpan,
        reparentOrphanedSpans: true,
      }),
    ],
  });
  provider.register();
}

export async function flushArize(): Promise<void> {
  if (!provider) return;
  try {
    await provider.forceFlush();
  } catch (err) {
    console.warn("[twyne:arize] failed to flush spans:", err);
  }
}