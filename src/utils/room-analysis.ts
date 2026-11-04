import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { toAgentPersona } from "../../convex/agentPrompts";
import type {
  AiSettings,
  Persona,
  PersonaMemo,
  ProjectBrief,
  RoomAnalysis,
  WriterProfile,
} from "../types";
import { currentModelLocale } from "../i18n/model-language";
import {
  hasConfiguredAiProvider,
  runClientAgent,
  runClientRoomSynthesis,
} from "./ai-client";
import { createAppError } from "./application-errors";
import { draftReadiness, MIN_EDITOR_WORDS } from "./draft-thresholds";
import { createEditorialNoteReviewer } from "./editorial-note-review";
import type { GenerationStreamSnapshot } from "./generation-stream";
import { askJudgement } from "./judgement-client";

interface RoomAnalysisRequest {
  activeFolioId: string;
  draftText: string;
  brief: ProjectBrief | null;
  personas: Persona[];
  writerProfile: WriterProfile;
  settings: AiSettings | null;
  client: ConvexClient | null;
  onMemo?: (personaId: string, snapshot: GenerationStreamSnapshot) => void;
  onSynthesis?: (text: string) => void;
}

const metadata = { feature: "personas", operation: "full-analysis" };

function providerUnavailableError() {
  return createAppError("PROVIDER_ERROR", {
    source: "provider",
    recovery: { action: "retry", canRetry: true },
    metadata,
  });
}

/** The desk and analysis page use the same provider routing and completeness gate. */
export async function runRoomAnalysis({
  activeFolioId,
  draftText,
  brief,
  personas,
  writerProfile,
  settings,
  client,
  onMemo,
  onSynthesis,
}: RoomAnalysisRequest): Promise<RoomAnalysis> {
  if (
    !draftReadiness(draftText, MIN_EDITOR_WORDS).ok ||
    personas.length === 0
  ) {
    throw createAppError("VALIDATION_FAILED", {
      source: "validation",
      validationKey: personas.length === 0 ? "required" : "draft_too_short",
      metadata: { ...metadata, kind: "local-readiness" },
    });
  }
  const hasByok = hasConfiguredAiProvider(settings);

  let memos: PersonaMemo[] = [];
  let synthesis = "";
  let synthesisProvider = "";

  if (hasByok && settings) {
    // Each editor writes a full memo on the BYOK path, honoring their
    // own model/temperature; then synthesise the five.
    const clientMemos = await Promise.all(
      personas.map(async (p) => {
        const reviewer = client
          ? createEditorialNoteReviewer(
              (request) =>
                askJudgement(client, {
                  ...request,
                  state: Object.fromEntries(
                    Object.entries(request.state).map(([key, value]) => [
                      key,
                      typeof value === "string" ? value : JSON.stringify(value),
                    ]),
                  ),
                }),
              {
                draft: draftText,
                brief: brief ?? null,
                persona: p,
                profile: writerProfile,
                operation: "analyze",
              },
            )
          : undefined;
        const res = await runClientAgent(
          "persona-analysis",
          {
            persona: toAgentPersona(p),
            brief: brief ?? null,
            draftText,
            writerProfile: writerProfile,
            instruction: "analyze",
          },
          settings,
          (snapshot) => onMemo?.(p.id, snapshot),
          reviewer
            ? {
                review: reviewer,
              }
            : undefined,
          client,
        );
        if (!res || !res.text.trim() || res.provider === "local") {
          return null;
        }
        return {
          personaId: p.id,
          personaName: p.name,
          personaColor: p.color,
          text: res.text,
          anchor: res.anchor,
          provider: `client-${res.provider}`,
        } as PersonaMemo;
      }),
    );
    if (clientMemos.some((memo) => memo === null)) {
      throw providerUnavailableError();
    }
    memos = clientMemos as PersonaMemo[];
    const synth = await runClientRoomSynthesis(
      memos.map((m) => {
        const persona = personas.find((p) => p.id === m.personaId);
        return {
          personaName: m.personaName,
          role: persona?.role ?? "",
          text: m.text,
        };
      }),
      brief ?? null,
      settings,
      writerProfile,
      (snapshot) => onSynthesis?.(snapshot.text),
    );
    if (!synth || !synth.text.trim()) {
      throw providerUnavailableError();
    }
    synthesis = synth.text;
    synthesisProvider = `client-${synth.provider}`;
  } else if (client) {
    const result = (await client.action(api.agents.analyzeRoom, {
      responseLocale: currentModelLocale(),
      personas: personas.map(toAgentPersona),
      brief: brief ?? null,
      draftText,
      writerProfile: writerProfile,
    })) as {
      memos: Array<{
        personaId: string;
        text: string;
        anchor?: string;
        provider: string;
      }>;
      synthesis: string;
      synthesisProvider: string;
    };
    memos = result.memos.map((m) => {
      const persona = personas.find((p) => p.id === m.personaId);
      return {
        personaId: m.personaId,
        personaName: persona?.name ?? m.personaId,
        personaColor: persona?.color ?? "var(--color-ink)",
        text: m.text,
        anchor: m.anchor,
        provider: m.provider,
      };
    });
    synthesis = result.synthesis;
    synthesisProvider = result.synthesisProvider;
  } else {
    throw createAppError("CONFIGURATION_ERROR", {
      source: "application",
      recovery: { action: "choose-provider", canRetry: false },
      metadata,
    });
  }

  if (
    memos.length !== personas.length ||
    memos.some((memo) => !memo.text.trim()) ||
    memos.some((memo) => memo.provider === "local") ||
    synthesisProvider === "local" ||
    !synthesis.trim()
  ) {
    throw memos.some((memo) => memo.provider === "local") ||
      synthesisProvider === "local"
      ? providerUnavailableError()
      : createAppError("MALFORMED_RESPONSE", { source: "provider", metadata });
  }

  const analysis: RoomAnalysis = {
    folioId: activeFolioId,
    memos,
    synthesis,
    synthesisProvider,
    briefTitle: brief?.answers.workingTitle,
    timestamp: Date.now(),
  };
  return analysis;
}
