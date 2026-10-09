export interface InstrumentCommentSummary {
  instrument: "Sentence bench" | "Threads" | "Scene bench";
  personaName: string;
  question: string;
}

const SOURCE_LABEL =
  "\n\nSource passage (current manuscript; quoted evidence):\n";
const INVITATION_END =
  "\n\nPlease contribute one focused editorial comment on this question. Distinguish the current source from any unapplied proposal. Do not apply edits or claim the proposal is already in the manuscript.";

/** Display-only recognition of the bounded, exact instrument invitation format. */
export function parseInstrumentComment(
  body: string,
): InstrumentCommentSummary | null {
  if (body.length > 32_000 || !body.endsWith(INVITATION_END)) return null;
  const header =
    /^(Sentence bench|Threads|Scene bench) · A focused question for ([^\r\n]{1,160})\n\n/.exec(
      body,
    );
  if (!header || !header[2].trim()) return null;
  const sourceAt = body.indexOf(SOURCE_LABEL, header[0].length);
  if (sourceAt < 0) return null;
  const question = body.slice(header[0].length, sourceAt);
  if (!question.trim() || question.length > 600) return null;
  const evidence = body.slice(
    sourceAt + SOURCE_LABEL.length,
    -INVITATION_END.length,
  );
  if (!evidence.trim()) return null;
  return {
    instrument: header[1] as InstrumentCommentSummary["instrument"],
    personaName: header[2],
    question,
  };
}
