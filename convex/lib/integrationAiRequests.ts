/**
 * The AI half of the integration API: request parsing and dispatch.
 *
 * `POST /api/integrations/v1` arrives as untyped JSON. Each operation here
 * narrows its fields, resolves `folioId` into the owner's draft and brief, and
 * hands typed arguments to an internal action in `integrationAi.ts`. Field
 * errors are thrown as plain `Error`s whose messages contain "is required" or
 * "must be", which is what `http.ts` lets through to the caller as a 400.
 *
 * Kept out of `http.ts` so the route stays one dispatch block, and out of the
 * `"use node"` module so the parser can run in the default runtime alongside
 * the folio operations. The contract is `docs/app-harness.md`.
 */
import type { FunctionArgs, GenericActionCtx } from "convex/server";
import { internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { PERSONAS } from "../../src/utils/personas";
import { htmlToPlainText } from "../../src/utils/html-to-plain-text";

type Ctx = GenericActionCtx<DataModel>;

/**
 * Briefs and writer profiles are narrowed only in outline here; the internal
 * action's validators do the field-level check at the call boundary. These
 * aliases let the parsed records cross that boundary with the action's type.
 */
type ActionArgs<Name extends keyof typeof internal.integrationAi> =
  FunctionArgs<(typeof internal.integrationAi)[Name]>;
type Brief = ActionArgs<"conveneRoom">["brief"];
type FiledBrief = ActionArgs<"checkDossier">["brief"];
type WriterProfile = ActionArgs<"conveneRoom">["writerProfile"];

export const INTEGRATION_AI_OPERATIONS = [
  "editors.list",
  "room.convene",
  "editor.ask",
  "rewrite.suggest",
  "rubric.grade",
  "dossier.check",
  "interview.turn",
  "research.targets",
  "research.sources",
] as const;
export type IntegrationAiOperation = (typeof INTEGRATION_AI_OPERATIONS)[number];

export function isIntegrationAiOperation(
  value: unknown,
): value is IntegrationAiOperation {
  return (INTEGRATION_AI_OPERATIONS as readonly unknown[]).includes(value);
}

const RESPONSE_LOCALES = ["en", "fr", "es", "zh", "hi", "ja"] as const;
type ResponseLocale = (typeof RESPONSE_LOCALES)[number];
const INSTRUCTIONS = ["feedback", "elaborate", "riff", "rewrite-suggestion"] as const;
const REWRITE_LEVELS = ["sentence", "paragraph"] as const;
const INTERVIEW_MODES = ["first-run", "refine"] as const;
const RESEARCH_KINDS = ["quote", "work", "person", "statistic", "claim", "event"] as const;

function optionalLimit(value: unknown, field: string, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${field} must be an integer between 1 and ${max}`);
  }
  return value;
}

/* ── The built-in cast ──────────────────────────────────────────── */

/**
 * The five resident editors in the shape `agents.ts` validates. The UI-only
 * fields (colour, glyph, speech voices) are dropped; everything that shapes a
 * note — doctrine, voice, hallmarks, temperature — travels.
 */
export function builtInEditor(personaId: string) {
  const p = PERSONAS.find((candidate) => candidate.id === personaId);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    role: p.role,
    description: p.description,
    focus: p.focus,
    ...(p.backstory !== undefined ? { backstory: p.backstory } : {}),
    ...(p.criticalMethod !== undefined
      ? { criticalMethod: p.criticalMethod }
      : {}),
    ...(p.voice !== undefined ? { voice: p.voice } : {}),
    ...(p.signatureMoves !== undefined
      ? { signatureMoves: p.signatureMoves }
      : {}),
    ...(p.hallmarks !== undefined ? { hallmarks: p.hallmarks } : {}),
    ...(p.avoidances !== undefined ? { avoidances: p.avoidances } : {}),
    ...(p.sampleLines !== undefined ? { sampleLines: p.sampleLines } : {}),
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
  };
}

export type BuiltInEditor = NonNullable<ReturnType<typeof builtInEditor>>;

export function listBuiltInEditors() {
  return PERSONAS.map(({ id, name, role, description, focus }) => ({
    id,
    name,
    role,
    description,
    focus,
  }));
}

/* ── Field narrowing ────────────────────────────────────────────── */

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): T[number] {
  if (!(allowed as readonly unknown[]).includes(value)) {
    throw new Error(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function optionalOneOf<const T extends readonly string[]>(
  value: unknown,
  field: string,
  allowed: T,
): T[number] | undefined {
  return value === undefined || value === null
    ? undefined
    : oneOf(value, field, allowed);
}

function responseLocale(body: Record<string, unknown>): ResponseLocale | undefined {
  return optionalOneOf(body.responseLocale, "responseLocale", RESPONSE_LOCALES);
}

/**
 * A brief is passed through to the action's `projectBriefValidator`, which
 * does the field-level work. Only the outline is checked here so the error
 * names the field the caller sent rather than a validator path.
 */
function optionalBrief(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const brief = record(value);
  if (!brief || !record(brief.answers)) {
    throw new Error("brief must be a ProjectBrief with answers");
  }
  return brief;
}

function requiredBrief(value: unknown): Record<string, unknown> {
  const brief = optionalBrief(value);
  if (!brief) throw new Error("brief is required");
  return brief;
}

function optionalWriterProfile(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  const profile = record(value);
  if (!profile) throw new Error("writerProfile must be an object");
  return profile;
}

function personaIds(value: unknown): string[] {
  if (value === undefined || value === null) return PERSONAS.map((p) => p.id);
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("personaIds must be a non-empty array");
  }
  return value.map((id) => editorId(id, "personaIds"));
}

function editorId(value: unknown, field: string): string {
  const known = PERSONAS.map((p) => p.id);
  if (typeof value !== "string" || !known.includes(value)) {
    throw new Error(`${field} must be one of ${known.join(", ")}`);
  }
  return value;
}

/* ── The manuscript ─────────────────────────────────────────────── */

/**
 * `draftText` wins when present. Otherwise `folioId` names one of the owner's
 * folios, whose HTML is flattened and whose filed brief fills in when the
 * caller sent none. Neither is a 400.
 */
async function resolveDraft(
  ctx: Ctx,
  ownerId: string,
  body: Record<string, unknown>,
): Promise<{ draftText: string; brief: Record<string, unknown> | null | undefined }> {
  const brief = optionalBrief(body.brief);
  if (typeof body.draftText === "string" && body.draftText.trim()) {
    return { draftText: body.draftText, brief };
  }
  if (body.draftText !== undefined && typeof body.draftText !== "string") {
    throw new Error("draftText must be a string");
  }
  if (typeof body.folioId !== "string" || !body.folioId.trim()) {
    throw new Error("draftText or folioId is required");
  }
  const bundle = (await ctx.runQuery(internal.integrations.getFolio, {
    userId: ownerId,
    folioId: body.folioId.trim(),
    include: ["content", "brief"],
  })) as { html?: string; brief?: unknown } | null;
  if (!bundle) throw new Error("folioId must be one of your folios");
  const draftText = htmlToPlainText(bundle.html ?? "");
  const filed = record(bundle.brief);
  return {
    draftText,
    brief: brief !== undefined ? brief : filed && record(filed.answers) ? filed : null,
  };
}

/* ── Dispatch ───────────────────────────────────────────────────── */

/**
 * Run one AI operation for the token's owner. Argument validation inside the
 * internal action (a malformed brief, say) surfaces as a generic validator
 * error; it is restated here so the caller gets a 400 naming the operation
 * rather than a 500.
 */
export async function runIntegrationAiOperation(
  ctx: Ctx,
  ownerId: string,
  operation: IntegrationAiOperation,
  body: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await dispatch(ctx, ownerId, operation, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/ArgumentValidationError|Validator error/.test(message)) {
      // Name the field, never the value: the path and the missing key are
      // enough for an agent to correct its call.
      const path = message.match(/Path: (\.[\w.[\]]+)/)?.[1]?.slice(1);
      const field = message.match(/required field `([\w]+)`/)?.[1];
      const where = [path, field].filter(Boolean).join(".");
      throw new Error(
        `Request fields must be valid for ${operation}${where ? ` (${where})` : ""}`,
      );
    }
    throw error;
  }
}

async function dispatch(
  ctx: Ctx,
  ownerId: string,
  operation: IntegrationAiOperation,
  body: Record<string, unknown>,
): Promise<unknown> {
  switch (operation) {
    case "editors.list":
      return listBuiltInEditors();

    case "research.targets": {
      const { draftText, brief } = await resolveDraft(ctx, ownerId, body);
      let existingSources: string[] | undefined;
      if (body.existingSources !== undefined) {
        if (!Array.isArray(body.existingSources) || body.existingSources.some((s) => typeof s !== "string")) {
          throw new Error("existingSources must be an array of strings");
        }
        existingSources = body.existingSources as string[];
      }
      return ctx.runAction(internal.integrationAi.researchTargets, {
        ownerId,
        draftText,
        brief: (brief ?? null) as Brief,
        strategy: optionalOneOf(body.strategy, "strategy", ["hosted", "model"] as const),
        maxTargets: optionalLimit(body.maxTargets, "maxTargets", 12),
        existingSources,
      });
    }

    case "research.sources": {
      const target = record(body.target);
      if (!target) throw new Error("target must be an object");
      return ctx.runAction(internal.integrationAi.researchSources, {
        ownerId,
        target: {
          kind: oneOf(target.kind, "target.kind", RESEARCH_KINDS),
          anchor: requiredString(target.anchor, "target.anchor"),
          query: requiredString(target.query, "target.query"),
          reason: optionalString(target.reason, "target.reason"),
        },
        maxResults: optionalLimit(body.maxResults, "maxResults", 10),
      });
    }

    case "room.convene": {
      const ids = personaIds(body.personaIds);
      const { draftText, brief } = await resolveDraft(ctx, ownerId, body);
      return ctx.runAction(internal.integrationAi.conveneRoom, {
        ownerId,
        personas: ids.map((id) => builtInEditor(id)!),
        draftText,
        brief: (brief ?? null) as Brief,
        writerProfile: optionalWriterProfile(
          body.writerProfile,
        ) as WriterProfile,
        responseLocale: responseLocale(body),
        newMaterial: optionalString(body.newMaterial, "newMaterial"),
        trajectory: optionalString(body.trajectory, "trajectory"),
      });
    }

    case "editor.ask": {
      const persona = builtInEditor(editorId(body.personaId, "personaId"))!;
      const { draftText, brief } = await resolveDraft(ctx, ownerId, body);
      let priorMessages:
        | Array<{ author: "user" | "persona"; text: string }>
        | undefined;
      if (body.priorMessages !== undefined && body.priorMessages !== null) {
        if (!Array.isArray(body.priorMessages)) {
          throw new Error("priorMessages must be an array");
        }
        priorMessages = body.priorMessages.map((entry, index) => {
          const message = record(entry);
          if (!message) throw new Error("priorMessages must be an array of messages");
          return {
            author: oneOf(message.author, `priorMessages[${index}].author`, [
              "user",
              "persona",
            ] as const),
            text: requiredString(message.text, `priorMessages[${index}].text`),
          };
        });
      }
      return ctx.runAction(internal.integrationAi.askEditor, {
        ownerId,
        persona,
        draftText,
        brief: (brief ?? null) as Brief,
        instruction: optionalOneOf(body.instruction, "instruction", INSTRUCTIONS),
        userMessage: optionalString(body.userMessage, "userMessage"),
        priorMessages,
        anchor: optionalString(body.anchor, "anchor"),
        writerProfile: optionalWriterProfile(
          body.writerProfile,
        ) as WriterProfile,
        responseLocale: responseLocale(body),
      });
    }

    case "rewrite.suggest": {
      const persona = builtInEditor(editorId(body.personaId, "personaId"))!;
      const original = requiredString(body.original, "original");
      const level = oneOf(body.level, "level", REWRITE_LEVELS);
      const { draftText, brief } = await resolveDraft(ctx, ownerId, body);
      return ctx.runAction(internal.integrationAi.suggestRewrite, {
        ownerId,
        persona,
        draftText,
        brief: (brief ?? null) as Brief,
        original,
        level,
        writerProfile: optionalWriterProfile(
          body.writerProfile,
        ) as WriterProfile,
        responseLocale: responseLocale(body),
      });
    }

    case "rubric.grade": {
      let criteria: Array<{ label: string; description: string }> | undefined;
      if (body.criteria !== undefined && body.criteria !== null) {
        if (!Array.isArray(body.criteria)) {
          throw new Error("criteria must be an array");
        }
        criteria = body.criteria.map((entry, index) => {
          const criterion = record(entry);
          if (!criterion) throw new Error("criteria must be an array of objects");
          return {
            label: requiredString(criterion.label, `criteria[${index}].label`),
            description:
              optionalString(
                criterion.description,
                `criteria[${index}].description`,
              ) ?? "",
          };
        });
      }
      const { draftText, brief } = await resolveDraft(ctx, ownerId, body);
      return ctx.runAction(internal.integrationAi.gradeRubric, {
        ownerId,
        draftText,
        brief: (brief ?? null) as Brief,
        criteria,
        responseLocale: responseLocale(body),
      });
    }

    case "dossier.check": {
      const brief = requiredBrief(body.brief);
      const { draftText } = await resolveDraft(ctx, ownerId, body);
      return ctx.runAction(internal.integrationAi.checkDossier, {
        ownerId,
        brief: brief as FiledBrief,
        draftText,
        responseLocale: responseLocale(body),
      });
    }

    case "interview.turn": {
      if (!Array.isArray(body.messages)) {
        throw new Error("messages must be an array");
      }
      const messages = body.messages.map((entry, index) => {
        const message = record(entry);
        if (!message) throw new Error("messages must be an array of messages");
        return {
          author: oneOf(message.author, `messages[${index}].author`, [
            "writer",
            "interviewer",
          ] as const),
          text: requiredString(message.text, `messages[${index}].text`),
        };
      });
      return ctx.runAction(internal.integrationAi.interviewTurn, {
        ownerId,
        messages,
        mode: oneOf(body.mode, "mode", INTERVIEW_MODES),
        currentBrief: (optionalBrief(body.currentBrief) ?? null) as Brief,
        startingMaterial: optionalString(body.startingMaterial, "startingMaterial"),
        responseLocale: responseLocale(body),
      });
    }
  }
}
