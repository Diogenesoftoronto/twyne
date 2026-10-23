/**
 * The dossier interview through `twyne_interview_turn`, on the conversations
 * in `evals/interview.jsonl` (shared with `bun run eval:interview`, which
 * replays the prompt directly; this suite runs the app's own turn handler and
 * protocol parser).
 *
 * A turn either asks one question, asks while recording what it has learned
 * (DOSSIER), or ends the interview (SYNTHESIZE). The checks compare that with
 * the expected behaviour and look for the fields the writer already gave.
 *
 * With `--jev`, the transcript itself becomes the answer key. Clairic reads
 * each dossier field out of what the writer said, as a span of the
 * conversation or null, so `clairic_field_recall` asks whether the app filed
 * what the writer actually stated and `clairic_field_support` whether what it
 * filed was stated at all. Jev, blind to the app's dossier, gives a second
 * reading of which fields were stated and rates the question the app asked;
 * a separate request asks whether each field the app filed is true to the
 * conversation.
 */
import {
  askClairic,
  askJev,
  BRIEF_FIELDS,
  CLAIRIC_BRIEF_FIELDS,
  jevInterviewRequest,
  jevNot,
  jevRecordRequest,
  jevShare,
  type BriefField,
  type ClairicReading,
} from "../judges";
import { pass, ratio, type Score } from "../scoring";
import { readJsonl } from "./load";
import type { ProjectBrief, Suite } from "./types";

export interface InterviewCase {
  case_id: string;
  mode: "first-run" | "refine";
  currentBrief: Partial<ProjectBrief> | null;
  messages: Array<{ author: "writer" | "interviewer"; text: string }>;
  expectedBehavior: "question" | "question_with_dossier" | "synthesize";
  expectedDossierFields: string[];
  tags?: string[];
}

interface InterviewTurn {
  kind?: "question" | "synthesis";
  text?: string;
  draft?: { brief?: Record<string, string> };
  brief?: Record<string, string>;
  provider?: string;
}

/**
 * The shared interview corpus records only a brief's answers; the app takes
 * the dossier as the browser files it.
 */
function filedBrief(brief: Partial<ProjectBrief>): ProjectBrief {
  return {
    attachments: [],
    completedAt: 1_790_000_000_000,
    updatedAt: 1_790_000_000_000,
    ...brief,
    answers: brief.answers ?? {},
  };
}

function behaviourOf(
  turn: InterviewTurn,
): InterviewCase["expectedBehavior"] | "unknown" {
  if (turn.kind === "synthesis") return "synthesize";
  if (turn.kind === "question")
    return turn.draft?.brief && Object.keys(turn.draft.brief).length
      ? "question_with_dossier"
      : "question";
  return "unknown";
}

function recordedOf(turn: InterviewTurn): Record<string, string> {
  return (turn.kind === "synthesis" ? turn.brief : turn.draft?.brief) ?? {};
}

const filled = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * The conversation as one text, with the span each message's words occupy,
 * so a Clairic span can be traced back to who said it.
 */
export function transcript(messages: InterviewCase["messages"]): {
  text: string;
  turns: Array<{
    author: "writer" | "interviewer";
    start: number;
    end: number;
  }>;
} {
  let text = "";
  const turns: Array<{
    author: "writer" | "interviewer";
    start: number;
    end: number;
  }> = [];
  for (const message of messages) {
    if (text) text += "\n\n";
    text += message.author === "writer" ? "Writer: " : "Interviewer: ";
    turns.push({
      author: message.author,
      start: text.length,
      end: text.length + message.text.length,
    });
    text += message.text;
  }
  return { text, turns };
}

/**
 * How likely Clairic thinks it is that the writer stated the field: 1 −
 * p_null, or 0 when the span it found lies in an interviewer's line (the
 * interviewer saying "one sentence" is not a constraint the writer set).
 */
function statedByWriter(
  reading: ClairicReading | undefined,
  turns: ReturnType<typeof transcript>["turns"],
): number {
  if (!reading) return 0;
  const present =
    typeof reading.p_null === "number"
      ? 1 - reading.p_null
      : reading.value == null
        ? 0
        : 1;
  const span = reading.span;
  if (!span) return present;
  const turn = turns.find((t) => span[0] < t.end && span[1] > t.start);
  return turn?.author === "writer" ? present : 0;
}

export const interviewSuite: Suite<InterviewCase> = {
  name: "interview",
  surface: "MCP twyne_interview_turn",
  load: () => readJsonl<InterviewCase>("interview.jsonl"),

  async run({ mcp }, testCase) {
    const raw = await mcp.call("twyne_interview_turn", {
      messages: testCase.messages,
      mode: testCase.mode,
      ...(testCase.currentBrief
        ? { currentBrief: filedBrief(testCase.currentBrief) }
        : {}),
    });
    const turn = raw as InterviewTurn;
    const recorded = turn.kind === "synthesis" ? turn.brief : turn.draft?.brief;
    return {
      raw,
      output:
        `${turn.kind ?? "?"}: ${turn.text ?? ""}` +
        (recorded ? `\n${JSON.stringify(recorded)}` : ""),
    };
  },

  async score({ jev, extract }, testCase, raw) {
    const turn = raw as InterviewTurn;
    const behaviour = behaviourOf(turn);
    const recorded = recordedOf(turn);
    const captured = testCase.expectedDossierFields.filter((field) =>
      filled(recorded[field]),
    );
    // A question that also records a dossier still asks the right question.
    // The interview prompt (prompts/interview-system.md) also asks what kind of
    // advisors the writer wants before it synthesizes, so a complete brief with
    // no advisors yet earns one more question about them.
    const advisorsDiscussed = testCase.messages.some((m) =>
      /\badvis[eo]r|\beditors?\b/i.test(m.text),
    );
    const askedAdvisors =
      testCase.expectedBehavior === "synthesize" &&
      behaviour === "question_with_dossier" &&
      !advisorsDiscussed &&
      /\badvis[eo]r|\beditors?\b/i.test(turn.text ?? "");
    const protocolOk =
      askedAdvisors ||
      behaviour === testCase.expectedBehavior ||
      (testCase.expectedBehavior === "question" &&
        behaviour === "question_with_dossier");
    const scores: Record<string, Score> = {
      protocol: {
        score: protocolOk ? 1 : 0,
        label: askedAdvisors ? "asked-advisors" : behaviour,
        explanation: askedAdvisors
          ? "brief complete except advisors; asked about them before synthesizing"
          : `expected ${testCase.expectedBehavior}, got ${behaviour}`,
      },
      dossier_fields: {
        // Nothing to capture yet is satisfied by capturing nothing.
        score:
          ratio(captured.length, testCase.expectedDossierFields.length) ?? 1,
        explanation: `captured ${captured.join(", ") || "none"} of ${testCase.expectedDossierFields.join(", ")}`,
        items: Object.fromEntries(
          testCase.expectedDossierFields.map((field) => [
            field,
            captured.includes(field) ? 1 : 0,
          ]),
        ),
      },
      hosted: pass(!!turn.provider && turn.provider !== "local", turn.provider),
    };
    // One question at a time: a question turn asks one (two marks allows a
    // clarifying aside), and a synthesis asks none.
    const questions = (turn.text?.match(/\?/g) ?? []).length;
    scores.one_question = pass(
      turn.kind === "question"
        ? questions >= 1 && questions <= 2
        : questions === 0,
      `${questions} question mark(s) in a ${turn.kind ?? "?"} turn`,
    );

    if (!jev && !extract) return scores;
    const conversation = transcript(testCase.messages);
    const onFile = testCase.currentBrief?.answers ?? {};
    // In refine mode the current brief is already on file: carrying a field
    // over unchanged needs no support from the conversation.
    const carried = (field: BriefField) =>
      filled(onFile[field]) &&
      recorded[field]?.trim() === onFile[field]?.trim();
    const filedFields = BRIEF_FIELDS.filter((field) => filled(recorded[field]));
    const newlyFiled = filedFields.filter((field) => !carried(field));
    const question = turn.kind === "question" ? (turn.text ?? "") : null;

    const [clairic, blind, record] = await Promise.all([
      extract
        ? askClairic(extract, {
            state: conversation.text,
            fields: CLAIRIC_BRIEF_FIELDS,
          })
        : null,
      jev
        ? (async () => {
            const request = jevInterviewRequest({
              conversation: conversation.text,
              question,
            });
            return {
              request,
              answers: await askJev(jev, request.state, request.questions),
            };
          })()
        : null,
      jev && newlyFiled.length
        ? (async () => {
            const request = jevRecordRequest({
              conversation: conversation.text,
              recorded: Object.fromEntries(
                newlyFiled.map((f) => [f, recorded[f]]),
              ),
              onFile: BRIEF_FIELDS.filter((f) => filled(onFile[f]))
                .map((f) => `${f}: ${onFile[f]}`)
                .join("\n"),
            });
            return {
              request,
              answers: await askJev(jev, request.state, request.questions),
            };
          })()
        : null,
    ]);

    if (extract && clairic) {
      if (!clairic.ok) {
        const failed: Score = {
          score: null,
          label: "clairic-error",
          explanation: clairic.error,
        };
        scores.clairic_field_recall = failed;
        scores.clairic_field_support = failed;
      } else {
        const known = Object.fromEntries(
          BRIEF_FIELDS.map((field) => [
            field,
            filled(onFile[field])
              ? 1
              : statedByWriter(clairic.answers[field], conversation.turns),
          ]),
        ) as Record<BriefField, number>;
        // Clairic's own null threshold.
        const stated = BRIEF_FIELDS.filter((field) => known[field] >= 0.5);
        const missed = stated.filter((field) => !filled(recorded[field]));
        const unsupported = filedFields.filter((field) => known[field] < 0.5);
        const detail = BRIEF_FIELDS.filter(
          (field) => clairic.answers[field]?.value != null,
        )
          .map((field) => {
            const a = clairic.answers[field];
            return `${field} "${String(a.value).slice(0, 40)}"${typeof a.confidence === "number" ? ` (${a.confidence.toFixed(2)})` : ""}`;
          })
          .join("; ");
        scores.clairic_field_recall = {
          score: ratio(stated.length - missed.length, stated.length) ?? 1,
          label: stated.length ? undefined : "nothing stated",
          explanation:
            `the writer stated ${stated.join(", ") || "nothing"}` +
            (missed.length ? `; not filed: ${missed.join(", ")}` : "") +
            (detail ? ` (Clairic: ${detail})` : ""),
          items: known,
        };
        scores.clairic_field_support = {
          score:
            ratio(
              filedFields.length - unsupported.length,
              filedFields.length,
            ) ?? 1,
          label: filedFields.length ? undefined : "nothing filed",
          explanation: unsupported.length
            ? `filed without the writer stating it: ${unsupported.join(", ")}`
            : "every filed field was stated by the writer or already on file",
        };
      }
    }

    if (blind) {
      const { request, answers } = blind;
      const known = Object.fromEntries(
        BRIEF_FIELDS.map((field) => [
          field,
          filled(onFile[field]) ? 1 : answers[request.statedIds[field]]?.score,
        ]),
      ) as Record<BriefField, number | null | undefined>;
      const readable = BRIEF_FIELDS.filter(
        (field) => typeof known[field] === "number",
      );
      // Read like Clairic's null threshold: stated at 0.5 or above. The items
      // keep the probabilities, for agreement.
      const stated = readable.filter(
        (field) => (known[field] as number) >= 0.5,
      );
      const missed = stated.filter((field) => !filled(recorded[field]));
      scores.jev_field_recall = !readable.length
        ? {
            score: null,
            label: "jev-error",
            explanation: answers[request.statedIds.workingTitle]?.explanation,
          }
        : {
            score: ratio(stated.length - missed.length, stated.length) ?? 1,
            label: stated.length ? undefined : "nothing stated",
            explanation:
              (missed.length ? `not filed: ${missed.join(", ")}; ` : "") +
              readable
                .map(
                  (field) => `${field} ${(known[field] as number).toFixed(2)}`,
                )
                .join(", "),
            items: Object.fromEntries(
              readable.map((field) => [field, known[field] as number]),
            ),
          };
      if (question !== null) {
        scores.jev_question_value = answers.jev_question_value;
        scores.jev_no_repeat = jevNot(
          answers.repeats,
          "new ground",
          "asks again",
        );
      }
    }
    if (jev) {
      scores.jev_record_faithful = record
        ? jevShare(record.answers, record.request.ids)
        : {
            score: 1,
            label: filedFields.length ? "nothing new filed" : "nothing filed",
            items: {},
          };
    }
    return scores;
  },

  example: (testCase) => ({
    case_id: testCase.case_id,
    mode: testCase.mode,
    messages: JSON.stringify(testCase.messages),
    currentBrief: JSON.stringify(testCase.currentBrief),
    expectedBehavior: testCase.expectedBehavior,
    expectedDossierFields: JSON.stringify(testCase.expectedDossierFields),
  }),
};
