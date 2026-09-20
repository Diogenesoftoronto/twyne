import type { Persona, ProjectBrief, WriterProfile } from "../types";
import {
  buildNoteQuestions,
  buildNoteState,
  readNoteVerdict,
  type NoteVerdict,
} from "./note-gate";
import type { SystemOneAnswer } from "./system-one";
import type { WritingLensCaller } from "./writing-lenses";

/** Missing answers are unavailable, never a synthetic pass or a veto. */
export async function reviewEditorialNote(
  call: WritingLensCaller,
  input: {
    note: string;
    quote?: string;
    draft: string;
    persona?: Persona;
    brief: ProjectBrief | null;
    profile: WriterProfile;
  },
): Promise<NoteVerdict | null> {
  const state = buildNoteState({
    note: input.note.slice(0, 8000),
    quote: input.quote || input.draft.slice(0, 16_000),
    draftExcerpt: input.draft.slice(0, 24_000),
    brief: input.brief,
    persona: input.persona ? JSON.stringify(input.persona) : undefined,
    writerProfile: input.profile,
  });
  const questions = buildNoteQuestions({
    hasConstraints: !!state.constraints,
    hasPersonaVoice: !!input.persona?.voice,
    hasAvoidances: !!input.persona?.avoidances?.length,
    hasWriterFacts: !!state.writerFacts,
    hasFeedbackPreferences: !!state.feedbackPreferences,
  });
  // An unanchored note cannot honestly be checked for misquoting a particular passage.
  if (!input.quote || !input.draft.includes(input.quote))
    delete questions.misquotesPassage;
  try {
    const result = await call({ state, questions });
    if (
      !result.ok ||
      !result.answers ||
      Object.entries(questions).some(
        ([id, question]) =>
          (result.answers?.[id] as SystemOneAnswer | undefined)?.type !==
          question.type,
      )
    )
      return null;
    return readNoteVerdict(result.answers as Record<string, SystemOneAnswer>);
  } catch {
    return null;
  }
}
