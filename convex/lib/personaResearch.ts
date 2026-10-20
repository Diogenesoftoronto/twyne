import { api } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { ExtractionResult } from "../../src/utils/extraction";
import {
  personaResearchBudget,
  type PersonaResearch,
} from "../../src/utils/persona-research";

/** agents.ts is Node; these calls cross into Convex's default runtime. */
export async function hostedPersonaResearch(
  ctx: ActionCtx,
): Promise<PersonaResearch> {
  const reserve = personaResearchBudget();
  try {
    if (!(await ctx.auth.getUserIdentity())) return { reserve };
    const [extraction, judgement, linked] = await Promise.all([
      ctx.runAction(api.extraction.isAvailable, {}),
      ctx.runAction(api.systemOne.isAvailable, {}),
      ctx.runQuery(api.providerIdentity.getMyProviderIdentity, {}),
    ]);
    return {
      reserve,
      ...(extraction.available && (extraction.transport === "direct" || linked)
        ? {
            extract: async (
              request: Parameters<NonNullable<PersonaResearch["extract"]>>[0],
            ) =>
              (await ctx.runAction(
                api.extraction.extract,
                request,
              )) as ExtractionResult,
          }
        : {}),
      ...(judgement.available && (judgement.transport === "direct" || linked)
        ? {
            judge: async (
              request: Parameters<NonNullable<PersonaResearch["judge"]>>[0],
            ) => ctx.runAction(api.systemOne.ask, request),
          }
        : {}),
    };
  } catch {
    return { reserve };
  }
}
