/**
 * Which way a judgement or an extraction goes, decided from the environment.
 *
 * Shared by the `systemOne` and `extraction` actions and by the persona
 * research wiring in `agents.ts`, which needs to know whether each is
 * reachable without crossing a function boundary to ask. Not Organic wins
 * whenever it is enabled, even if a direct key is also present: a deployment
 * that has both is a developer machine mid-migration, and silently preferring
 * the local key there would mean shipping a surface that was never exercised
 * against the real boundary. The direct credentials only unlock on a loopback
 * deployment.
 */
import { directJudgementKey } from "./judgementContract";
import { notOrganicEnabled } from "./notorganic";

export type JudgementTransport = "notorganic" | "direct" | "none";

export function judgementTransport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): JudgementTransport {
  // The app evals (evals/app/local-app.ts) can pin judgements to the direct
  // key while inference stays on Not Organic. Only honoured where the direct
  // key itself is — a loopback deployment — so no hosted deployment can opt
  // out of Not Organic this way.
  if (
    env.TWYNE_EVAL_JUDGEMENT_TRANSPORT === "direct" &&
    directJudgementKey(env)
  )
    return "direct";
  if (notOrganicEnabled(env)) return "notorganic";
  if (directJudgementKey(env)) return "direct";
  return "none";
}

export type ExtractionTransport = "notorganic" | "direct" | "none";

export function directExtractionCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { token: string; account: string } | null {
  if (
    env.NODE_ENV !== "development" ||
    env.TWYNE_ALLOW_DIRECT_EXTRACTION !== "1"
  )
    return null;
  try {
    const url = new URL(env.CONVEX_CLOUD_URL ?? "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return null;
  } catch {
    return null;
  }
  const token = env.CLOUDFLARE_AI_API_TOKEN?.trim();
  const account = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  return token && account ? { token, account } : null;
}

export function extractionTransport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExtractionTransport {
  if (notOrganicEnabled(env)) return "notorganic";
  if (directExtractionCredentials(env)) return "direct";
  return "none";
}
