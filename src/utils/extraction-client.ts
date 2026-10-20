/**
 * One door for every Clairic extraction Twyne asks for, as `judgement-client`
 * is for Jev. Always through the Convex action: the provider credential lives
 * on the server, and Not Organic meters the spend.
 */
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { ExtractionRequest, ExtractionResult } from "./extraction";

export async function askExtraction(
  client: ConvexClient | null | undefined,
  request: ExtractionRequest,
): Promise<ExtractionResult> {
  if (!client) return { ok: false, transport: "none", error: "signed out" };
  const started = performance.now();
  try {
    const result = (await client.action(
      api.extraction.extract,
      request,
    )) as ExtractionResult;
    return { ...result, latencyMs: Math.round(performance.now() - started) };
  } catch {
    // Rate limits throw from the action; every caller has a deterministic path.
    return { ok: false, error: "rate limited" };
  }
}
