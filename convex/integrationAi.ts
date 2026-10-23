"use node";

/**
 * The room, reachable by personal access token.
 *
 * `http.ts` authenticates `POST /api/integrations/v1` by hashing the bearer
 * token and looking up its owner, so by the time a request gets here there is
 * a verified owner but no Convex identity: `ctx.auth` is empty. These internal
 * actions take that owner explicitly and run the same cores the browser's
 * `api.agents.*` actions run, so a note from the CLI, the MCP server or an
 * eval is produced by the production code path rather than a replay of its
 * prompts. Rate limits are the browser ones, keyed by the owner's
 * tokenIdentifier, because the cores apply them.
 *
 * The editors' research tools and the System One review run here too: both
 * go through the caller-taking `extractAs` and `askAs` actions, so a note
 * written for a token owner is researched and gated the way a browser note
 * is. The contract is `docs/app-harness.md`.
 */

import { ConvexError, v, type ObjectType } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  briefValidator,
  callerFromTokenIdentifier,
  conveneRoomCore,
  generateWithSecondChance,
  judgeCustomCriterionCore,
  judgeEvidenceCore,
  judgeIntegrityCore,
  judgeRoomCore,
  judgeSufficiencyCore,
  judgeTargetFitCore,
  personaValidator,
  pickProvider,
  projectBriefValidator,
  responseLocaleValidator,
  reviewRubricCore,
  runDossierCheckCore,
  runInterviewTurnCore,
  runPersonaCore,
  suggestRewriteCore,
  writerProfileValidator,
  type HostedCaller,
  type InterviewTurnResult,
  type RewriteResult,
} from "./agents";
import {
  toAgentPersona,
  type AgentPersona,
  type AgentResponse,
} from "./agentPrompts";
import { PERSONAS } from "../src/utils/personas";
import type { DossierCheckResult, ProjectBrief } from "../src/types";
import {
  gradeWithRoom,
  type RubricRoomGrade,
} from "../src/utils/rubric-room-grade";
import { countWords, MIN_RUBRIC_WORDS } from "../src/utils/draft-thresholds";
import { applicationError } from "./lib/applicationErrors";
import { internal } from "./_generated/api";
import { consumeRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { flushArize } from "./arizeTracing";
import {
  claimCandidates,
  candidateRequest,
  confirmedTargets,
} from "../src/utils/research-candidates";
import {
  buildDossierResearchInstructions,
  buildResearchExtractSystemPrompt,
  buildResearchExtractUserPrompt,
  buildResearchSearchContext,
  DEFAULT_TARGETS_PER_PASS,
  dossierResearchMode,
  parseResearchTargets,
  rankSourcesForTarget,
} from "../src/utils/research-targets";
import {
  liveSearchConfigured,
  searchSourcesCore,
  sourceValidator,
} from "./research";
import type { ResearchTarget } from "../src/types";
import type { ClaimCandidate } from "../src/utils/research-candidates";
import type { DossierResearchMode } from "../src/utils/research-targets";
import {
  extractFirstJsonObject,
  stripJsonFences,
} from "../src/utils/llm-parsing";

/** The panel judges with the whole cast; so does the harness. */
const ROOM_JUDGES = PERSONAS.map(toAgentPersona);

/** `EditorNote` in the contract: an `AgentResponse` that knows who wrote it. */
function editorNote(persona: AgentPersona, response: AgentResponse) {
  return {
    personaId: persona.id,
    personaName: persona.name,
    text: response.text,
    type: response.type,
    provider: response.provider,
    ...(response.anchor !== undefined ? { anchor: response.anchor } : {}),
    ...(response.anchors !== undefined ? { anchors: response.anchors } : {}),
    ...(response.extractions !== undefined
      ? { extractions: response.extractions }
      : {}),
    ...(response.traceId !== undefined ? { traceId: response.traceId } : {}),
  };
}

const ownerArgs = {
  /** The token owner's tokenIdentifier, as `integrations.authenticate` returns it. */
  ownerId: v.string(),
};

const researchKindValidator = v.union(
  v.literal("quote"),
  v.literal("work"),
  v.literal("person"),
  v.literal("statistic"),
  v.literal("claim"),
  v.literal("event"),
);
const candidateValidator = v.object({
  kind: researchKindValidator,
  anchor: v.string(),
  reason: v.string(),
});
const strategyValidator = v.union(v.literal("hosted"), v.literal("model"));

interface ResearchTargetsResult {
  strategy: "hosted" | "model";
  provider: string;
  mode: DossierResearchMode;
  targets: ResearchTarget[];
  candidates?: ClaimCandidate[];
}

function extractedTargets(text: string): ResearchTarget[] | null {
  const targets = parseResearchTargets(text);
  if (targets.length) return targets;
  // A valid empty intake is different from a silent or malformed answer.
  const clean = stripJsonFences(text);
  try {
    const body: unknown = JSON.parse(extractFirstJsonObject(clean) ?? clean);
    const list = Array.isArray(body)
      ? body
      : (body as { targets?: unknown } | null)?.targets;
    return Array.isArray(list) && list.length === 0 ? [] : null;
  } catch {
    return null;
  }
}

/** The browser's two extraction strategies, using the hosted caller's models. */
export const researchTargets = internalAction({
  args: {
    ...ownerArgs,
    draftText: v.string(),
    brief: briefValidator,
    strategy: v.optional(strategyValidator),
    maxTargets: v.optional(v.number()),
    existingSources: v.optional(v.array(v.string())),
  },
  returns: v.object({
    strategy: strategyValidator,
    provider: v.string(),
    mode: v.union(
      v.literal("fiction"),
      v.literal("nonfiction"),
      v.literal("general"),
    ),
    targets: v.array(
      candidateValidator.extend({
        id: v.string(),
        query: v.string(),
        importance: v.number(),
      }),
    ),
    candidates: v.optional(v.array(candidateValidator)),
  }),
  handler: async (
    ctx,
    { ownerId, ...args },
  ): Promise<ResearchTargetsResult> => {
    const caller = callerFromTokenIdentifier(ownerId);
    const strategy = args.strategy ?? "hosted";
    const brief = (args.brief ?? null) as ProjectBrief | null;
    const mode = dossierResearchMode(brief);
    const maxTargets = Math.max(
      1,
      Math.min(12, Math.floor(args.maxTargets ?? DEFAULT_TARGETS_PER_PASS)),
    );
    if (strategy === "hosted") {
      // Keep the browser's ten-candidate scan; maxTargets caps confirmed output.
      const candidates = claimCandidates(args.draftText);
      if (!candidates.length)
        return { strategy, provider: "hosted", mode, targets: [], candidates };
      // System One runs in the default runtime; this module runs in Node.
      const result = await ctx.runAction(internal.systemOne.askAs, {
        ownerId,
        ...candidateRequest(candidates, mode),
      });
      if (!result.ok) {
        throw applicationError(
          result.error === "unconfigured" ||
            result.error === "account not linked"
            ? "configuration_required"
            : result.error === "rate limited"
              ? "rate_limited"
              : "provider_unavailable",
        );
      }
      return {
        strategy,
        provider: "hosted",
        mode,
        targets: confirmedTargets(candidates, result).slice(0, maxTargets),
        candidates,
      };
    }

    await consumeRateLimit(ctx, {
      action: "agent:feedback",
      identifier: caller.tokenIdentifier,
      ...RATE_LIMITS.agentFeedback,
    });
    try {
      const provider = await pickProvider(
        ctx,
        caller,
        "research-extract",
        "balanced",
      );
      if (!provider) throw applicationError("configuration_required");
      const extracted = await generateWithSecondChance(
        {
          ctx,
          caller,
          provider,
          feature: "research-extract",
          usageFeature: "research-extract",
          system: buildResearchExtractSystemPrompt(),
          prompt: buildResearchExtractUserPrompt({
            draftText: args.draftText,
            existingSources: args.existingSources ?? [],
            maxTargets,
            instructions: buildDossierResearchInstructions(brief),
          }),
          temperature: 0.2,
          functionId: "research_extract",
        },
        extractedTargets,
      );
      if (!extracted) throw applicationError("provider_unavailable");
      return {
        strategy,
        provider: extracted.provider.label,
        mode,
        targets: extracted.value.slice(0, maxTargets),
      };
    } catch (error) {
      if (error instanceof ConvexError) throw error;
      throw applicationError("provider_unavailable");
    } finally {
      await flushArize();
    }
  },
});

/** Search and rank with the same context, provider and quota as the browser. */
export const researchSources = internalAction({
  args: {
    ...ownerArgs,
    target: v.object({
      kind: researchKindValidator,
      anchor: v.string(),
      query: v.string(),
      reason: v.optional(v.string()),
    }),
    maxResults: v.optional(v.number()),
  },
  returns: v.object({
    provider: v.string(),
    results: v.array(sourceValidator),
    ranked: v.array(sourceValidator),
  }),
  handler: async (ctx, { ownerId, target: input, maxResults }) => {
    if (!liveSearchConfigured())
      throw applicationError("configuration_required");
    const target: ResearchTarget = {
      ...input,
      id: "integration",
      importance: 5,
      reason: input.reason ?? "Needs a verifiable source",
    };
    const { provider, results } = await searchSourcesCore(
      ctx,
      callerFromTokenIdentifier(ownerId),
      {
        query: target.query,
        context: buildResearchSearchContext(target),
        maxResults,
      },
    );
    return { provider, results, ranked: rankSourcesForTarget(results) };
  },
});

export const conveneRoom = internalAction({
  args: {
    ...ownerArgs,
    responseLocale: responseLocaleValidator,
    personas: v.array(personaValidator),
    brief: briefValidator,
    draftText: v.string(),
    writerProfile: writerProfileValidator,
    newMaterial: v.optional(v.string()),
    trajectory: v.optional(v.string()),
  },
  handler: async (ctx, { ownerId, ...args }) => {
    const notes = await conveneRoomCore(
      ctx,
      callerFromTokenIdentifier(ownerId),
      args,
    );
    const released = new Set(notes.map((note) => note.personaId));
    return {
      notes: notes.map((note) =>
        editorNote(
          args.personas.find((p) => p.id === note.personaId) as AgentPersona,
          note,
        ),
      ),
      // Editors whose notes the editorial review would not release.
      withheld: args.personas
        .map((p) => p.id)
        .filter((id) => !released.has(id)),
    };
  },
});

export const askEditor = internalAction({
  args: {
    ...ownerArgs,
    responseLocale: responseLocaleValidator,
    persona: personaValidator,
    brief: briefValidator,
    draftText: v.string(),
    writerProfile: writerProfileValidator,
    anchor: v.optional(v.string()),
    priorMessages: v.optional(
      v.array(
        v.object({
          author: v.union(v.literal("user"), v.literal("persona")),
          text: v.string(),
        }),
      ),
    ),
    userMessage: v.optional(v.string()),
    instruction: v.optional(
      v.union(
        v.literal("feedback"),
        v.literal("elaborate"),
        v.literal("riff"),
        v.literal("rewrite-suggestion"),
      ),
    ),
  },
  handler: async (ctx, { ownerId, ...args }) => {
    const note = await runPersonaCore(
      ctx,
      callerFromTokenIdentifier(ownerId),
      args,
    );
    return { note: editorNote(args.persona as AgentPersona, note) };
  },
});

export const suggestRewrite = internalAction({
  args: {
    ...ownerArgs,
    responseLocale: responseLocaleValidator,
    persona: personaValidator,
    brief: briefValidator,
    draftText: v.string(),
    writerProfile: writerProfileValidator,
    original: v.string(),
    level: v.union(v.literal("sentence"), v.literal("paragraph")),
  },
  handler: async (ctx, { ownerId, ...args }): Promise<RewriteResult> =>
    suggestRewriteCore(ctx, callerFromTokenIdentifier(ownerId), args),
});

export const checkDossier = internalAction({
  args: {
    ...ownerArgs,
    responseLocale: responseLocaleValidator,
    brief: projectBriefValidator,
    draftText: v.string(),
  },
  handler: async (ctx, { ownerId, ...args }): Promise<DossierCheckResult> =>
    runDossierCheckCore(ctx, callerFromTokenIdentifier(ownerId), args),
});

export const interviewTurn = internalAction({
  args: {
    ...ownerArgs,
    responseLocale: responseLocaleValidator,
    messages: v.array(
      v.object({
        author: v.union(v.literal("writer"), v.literal("interviewer")),
        text: v.string(),
      }),
    ),
    mode: v.union(v.literal("first-run"), v.literal("refine")),
    currentBrief: briefValidator,
    startingMaterial: v.optional(v.string()),
  },
  handler: async (ctx, { ownerId, ...args }): Promise<InterviewTurnResult> =>
    runInterviewTurnCore(ctx, callerFromTokenIdentifier(ownerId), args),
});

const gradeRubricArgs = {
  ...ownerArgs,
  responseLocale: responseLocaleValidator,
  brief: briefValidator,
  draftText: v.string(),
  criteria: v.optional(
    v.array(v.object({ label: v.string(), description: v.string() })),
  ),
};

/**
 * The grade the rubric panel would show, assembled server-side.
 *
 * The sequence lives in `src/utils/rubric-room-grade.ts`, which mirrors the
 * panel's hosted path (`rubric-panel.tsx` `runAnalysis`, steps 1 through 4,
 * roughly lines 330-700): static features, `judgeRoom`, then the sufficiency,
 * evidence, integrity and target-fit judges, `combineJudgesAndStatic`, the
 * writer's criteria, and finally `reviewRubric`. Each judge here is the same
 * core the panel's `api.agents.*` call reaches, with this owner as the caller.
 */
export const gradeRubric = internalAction({
  args: gradeRubricArgs,
  handler: async (ctx, { ownerId, ...args }): Promise<RubricRoomGrade> => {
    const caller = callerFromTokenIdentifier(ownerId);
    if (countWords(args.draftText) < MIN_RUBRIC_WORDS) {
      // The panel does not start until the draft is this long; below it every
      // judge answers locally and there is no grade to report.
      throw new Error(
        `draftText must be at least ${MIN_RUBRIC_WORDS} words before the rubric can grade it`,
      );
    }
    return gradeRoom(ctx, caller, args);
  },
});

async function gradeRoom(
  ctx: ActionCtx,
  caller: HostedCaller,
  args: Omit<ObjectType<typeof gradeRubricArgs>, "ownerId">,
): Promise<RubricRoomGrade> {
  const { responseLocale, draftText } = args;
  const brief = (args.brief ?? null) as ProjectBrief | null;
  const judgeArgs = { responseLocale, brief: args.brief, draftText };
  try {
    return await gradeWithRoom(
      {
        draftText,
        brief,
        personaIds: ROOM_JUDGES.map((p) => p.id),
        criteria: args.criteria,
      },
      {
        judgeRoom: () =>
          judgeRoomCore(ctx, caller, {
            ...judgeArgs,
            personas: ROOM_JUDGES,
          }),
        judgeSufficiency: () => judgeSufficiencyCore(ctx, caller, judgeArgs),
        judgeEvidence: () => judgeEvidenceCore(ctx, caller, judgeArgs),
        judgeIntegrity: () => judgeIntegrityCore(ctx, caller, judgeArgs),
        judgeTargetFit: () => judgeTargetFitCore(ctx, caller, judgeArgs),
        judgeCustomCriterion: (criterion) =>
          judgeCustomCriterionCore(ctx, caller, { ...judgeArgs, ...criterion }),
        reviewRubric: async (summary) => {
          const { review, provider } = await reviewRubricCore(ctx, caller, {
            ...judgeArgs,
            ...summary,
          });
          return review ? { text: review, provider } : null;
        },
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "RubricRoomUnavailableError") {
      throw applicationError("provider_unavailable", { recovery: "retry" });
    }
    throw error;
  }
}
