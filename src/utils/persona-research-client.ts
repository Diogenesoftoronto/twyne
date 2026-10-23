import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { JudgementSettings } from "../types";
import { askExtraction } from "./extraction-client";
import { backOffExtraction, extractionBackedOff } from "./extraction-budget";
import { accountKnowledgeSnapshot } from "./account-knowledge";
import { askJudgement, normalizeEndpointUrl } from "./judgement-client";
import {
  backOffSystemOne,
  spendSystemOne,
  systemOneWait,
} from "./system-one-budget";
import {
  personaResearchBudget,
  type PersonaResearch,
} from "./persona-research";

/** Capability checks do not run inference or spend wallet credit. */
export async function clientPersonaResearch(
  client: ConvexClient | null | undefined,
  settings?: JudgementSettings | null,
): Promise<PersonaResearch> {
  let extraction = false;
  let hostedJudge = false;
  let authenticated = false;
  if (client) {
    try {
      const linked = await client.query(
        api.providerIdentity.getMyProviderIdentity,
        {},
      );
      authenticated = !!linked || !!accountKnowledgeSnapshot().account;
      if (authenticated) {
        const [e, j] = await Promise.all([
          client.action(api.extraction.isAvailable, {}),
          client.action(api.systemOne.isAvailable, {}),
        ]);
        extraction = e.available && (e.transport === "direct" || !!linked);
        hostedJudge = j.available && (j.transport === "direct" || !!linked);
      }
    } catch {
      // Signed-out and unavailable deployments keep the literal quote tool.
    }
  }
  const endpoint =
    settings?.source === "endpoint" &&
    !!normalizeEndpointUrl(settings.endpointUrl);
  const judge =
    settings?.source === "typesafe"
      ? authenticated && !!settings.typesafeKey?.trim()
      : settings?.source === "endpoint"
        ? endpoint
        : hostedJudge;
  const reserveNote = personaResearchBudget();
  // Each service backs off on its own failures: a Clairic outage must not
  // silence Jev judgements, nor the reverse.
  const quietOnFailure = async <T extends { ok: boolean }>(
    request: () => Promise<T>,
    backOff: () => void,
  ): Promise<T> => {
    try {
      const result = await request();
      if (!result.ok) backOff();
      return result;
    } catch {
      backOff();
      throw new Error("research unavailable");
    }
  };
  return {
    // Share the note cap without spending or checking another service's budget.
    reserve: reserveNote,
    ...(extraction
      ? {
          extract: (request: Parameters<typeof askExtraction>[1]) =>
            extractionBackedOff()
              ? Promise.resolve({ ok: false, error: "backing off" })
              : quietOnFailure(
                  () => askExtraction(client, request),
                  () => backOffExtraction(),
                ),
        }
      : {}),
    ...(judge
      ? {
          judge: (request: Parameters<typeof askJudgement>[1]) => {
            if (systemOneWait() > 0)
              return Promise.resolve({ ok: false, error: "backing off" });
            spendSystemOne();
            return quietOnFailure(
              () => askJudgement(client, request, settings),
              () => backOffSystemOne(),
            );
          },
        }
      : {}),
  };
}
