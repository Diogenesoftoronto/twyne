/**
 * One door for every Clairic extraction Twyne asks for, as `judgement-client`
 * is for Jev. Always through the Convex action: the provider credential lives
 * on the server, and Not Organic meters the spend.
 */
import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import {
  extractionError,
  type ExtractionRequest,
  type ExtractionResult,
} from "./extraction";
import { validateExtractionAnswers } from "./extraction-validation";

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
    if (result?.ok) {
      if (typeof result.truncated !== "boolean")
        return { ok: false, error: "provider" };
      result.answers = validateExtractionAnswers(
        request,
        result.answers,
        undefined,
        "utf16",
      );
    } else if (result?.ok !== false) return { ok: false, error: "provider" };
    return { ...result, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, error: extractionError(error) };
  }
}
