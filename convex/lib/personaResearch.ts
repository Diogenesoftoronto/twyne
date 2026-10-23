import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { ExtractionResult } from "../../src/utils/extraction";
import {
  personaResearchBudget,
  type PersonaResearch,
} from "../../src/utils/persona-research";
import type { HostedCaller } from "./authIdentity";
import { extractionTransport, judgementTransport } from "./hostedTransports";

/**
 * The research tools an editor may reach for while writing a note, bound to
 * the caller the note is for.
 *
 * agents.ts is Node; the extraction and judgement calls cross into Convex's
 * default runtime through the caller-taking internal actions, so the same
 * tools appear whether the writer is signed in to the browser or acting
 * through a personal access token. Availability is read from the environment
 * the way the public `isAvailable` actions read it; the Not Organic link is
 * looked up by the caller's product subject, as the hosted paths do.
 */
export async function hostedPersonaResearch(
  ctx: ActionCtx,
  caller: HostedCaller,
): Promise<PersonaResearch> {
  const reserve = personaResearchBudget();
  try {
    const extraction = extractionTransport();
    const judgement = judgementTransport();
    const needsLink =
      extraction === "notorganic" || judgement === "notorganic";
    const linked = needsLink
      ? await ctx.runQuery(internal.providerIdentity.getLinkedDidBySubject, {
          productSubject: caller.subject,
        })
      : null;
    const ownerId = caller.tokenIdentifier;
    return {
      reserve,
      ...(extraction === "direct" || (extraction === "notorganic" && linked)
        ? {
            extract: async (
              request: Parameters<NonNullable<PersonaResearch["extract"]>>[0],
            ) =>
              (await ctx.runAction(internal.extraction.extractAs, {
                ownerId,
                ...request,
              })) as ExtractionResult,
          }
        : {}),
      ...(judgement === "direct" || (judgement === "notorganic" && linked)
        ? {
            judge: async (
              request: Parameters<NonNullable<PersonaResearch["judge"]>>[0],
            ) =>
              ctx.runAction(internal.systemOne.askAs, { ownerId, ...request }),
          }
        : {}),
    };
  } catch {
    return { reserve };
  }
}
