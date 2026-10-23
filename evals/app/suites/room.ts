/**
 * The room of editors, convened on a draft through `twyne_convene_room`.
 *
 * Each case plants checkable features in a 550-900 word draft: unsupported
 * claims, weak arguments, bloat, a strong passage worth protecting. The
 * deterministic checks ask whether the room found them, whether each note
 * pinned itself to a passage the writer actually wrote, and whether five
 * editors read like five people. The judge, when enabled, applies the same
 * faithfulness and helpfulness rubrics as `evals/judge.ts` to every note.
 */
import {
  askJev,
  judged,
  judgeFaithfulness,
  judgeHelpfulness,
  judgeNoteValue,
  JEV_NOTE_QUESTIONS,
} from "../judges";
import {
  contains,
  distinctness,
  fold,
  mean,
  ratio,
  sharesRun,
  spansOverlap,
  visibleToEditors,
  type Score,
} from "../scoring";
import { readJsonl } from "./load";
import type { EditorNote, ProjectBrief, Suite } from "./types";

interface Plant {
  id: string;
  kind: string;
  passage: string;
  expectedEditors: string[];
  note: string;
}

export interface RoomCase {
  case_id: string;
  genre: string;
  brief: ProjectBrief;
  draftText: string;
  plants: Plant[];
}

function notesOf(raw: unknown): EditorNote[] {
  const notes = (raw as { notes?: unknown })?.notes;
  return Array.isArray(notes) ? (notes as EditorNote[]) : [];
}

/** Editors whose notes the app's editorial review would not release. */
function withheldOf(raw: unknown): string[] {
  const withheld = (raw as { withheld?: unknown })?.withheld;
  return Array.isArray(withheld) ? (withheld as string[]) : [];
}

function anchorsOf(note: EditorNote): string[] {
  if (note.anchors?.length) return note.anchors;
  return note.anchor ? [note.anchor] : [];
}

function covers(draft: string, note: EditorNote, plant: Plant): boolean {
  return (
    anchorsOf(note).some((anchor) =>
      spansOverlap(draft, anchor, plant.passage),
    ) || sharesRun(note.text, plant.passage, 5)
  );
}

export function renderNotes(notes: EditorNote[]): string {
  return notes
    .map((note) => {
      const head = `[${note.personaName ?? note.personaId}] (${note.type ?? "note"}, ${note.provider ?? "?"})`;
      const anchor = note.anchor ? `\n  > ${note.anchor}` : "";
      return `${head} ${note.text}${anchor}`;
    })
    .join("\n\n");
}

export const roomSuite: Suite<RoomCase> = {
  name: "room",
  surface: "MCP twyne_convene_room",
  load: () => readJsonl<RoomCase>("app/cases/room.jsonl"),

  async run({ mcp }, testCase) {
    const raw = await mcp.call("twyne_convene_room", {
      draftText: testCase.draftText,
      brief: testCase.brief,
    });
    return { raw, output: renderNotes(notesOf(raw)) };
  },

  async score({ judge, jev }, testCase, raw) {
    const draft = testCase.draftText;
    const notes = notesOf(raw);
    const written = notes.filter((note) => note.text?.trim());
    const anchors = notes.flatMap(anchorsOf);
    const verbatim = anchors.filter((anchor) => contains(draft, anchor));
    const visible = testCase.plants.filter((plant) =>
      visibleToEditors(draft, plant.passage),
    );
    const coveredBy = (plant: Plant) =>
      notes.filter((note) => covers(draft, note, plant));
    const missed = testCase.plants.filter((p) => coveredBy(p).length === 0);
    const expectedHit = testCase.plants.filter((plant) =>
      coveredBy(plant).some((note) =>
        plant.expectedEditors.includes(note.personaId),
      ),
    );
    const primary = notes
      .map((note) => note.anchor)
      .filter(Boolean) as string[];

    const scores: Record<string, Score> = {
      notes_complete: {
        score: ratio(written.length, 5),
        explanation:
          `${written.length} of 5 editors wrote a note` +
          (withheldOf(raw).length
            ? `; withheld by the editorial review: ${withheldOf(raw).join(", ")}`
            : ""),
      },
      hosted: {
        score:
          ratio(
            notes.filter((note) => note.provider && note.provider !== "local")
              .length,
            notes.length,
          ) ?? 0,
        explanation: `providers: ${[...new Set(notes.map((n) => n.provider))].join(", ")}`,
      },
      anchored: {
        score:
          ratio(notes.filter((note) => note.anchor).length, notes.length) ?? 0,
        explanation: "share of notes pinned to a passage by quote_passage",
      },
      anchor_verbatim: {
        // No anchors at all is a room that pinned nothing, not a missing check.
        score: ratio(verbatim.length, anchors.length) ?? 0,
        explanation: `${verbatim.length}/${anchors.length} anchors appear verbatim in the draft`,
      },
      plant_coverage: {
        score: ratio(
          testCase.plants.length - missed.length,
          testCase.plants.length,
        ),
        explanation: missed.length
          ? `missed: ${missed.map((p) => `${p.id} (${p.kind})`).join(", ")}`
          : "every planted feature was noticed",
      },
      plant_coverage_visible: {
        score:
          ratio(
            visible.filter((plant) => coveredBy(plant).length > 0).length,
            visible.length,
          ) ?? 1,
        explanation: `${testCase.plants.length - visible.length} plant(s) fall outside the context sampled for the editors`,
      },
      expected_editor: {
        score: ratio(expectedHit.length, testCase.plants.length),
        explanation:
          "planted features noticed by an editor whose remit covers them",
      },
      anchor_spread: {
        score: ratio(new Set(primary.map(fold)).size, primary.length) ?? 0,
        explanation: "distinct passages chosen across the room",
      },
      voice_distinctness: {
        score: distinctness(written.map((note) => note.text)) ?? 0,
        explanation: "1 minus mean pairwise trigram overlap between notes",
      },
    };

    if (judge) {
      const verdicts = await Promise.all(
        written.map(async (note) => ({
          note,
          faithful: await judgeFaithfulness(judge, draft, note.text),
          helpful: await judgeHelpfulness(
            judge,
            `${note.personaName ?? note.personaId} (${note.personaId})`,
            draft,
            note.text,
          ),
          value: await judgeNoteValue(judge, {
            draft,
            persona: `${note.personaName ?? note.personaId} (${note.personaId})`,
            note: note.text,
            anchor: note.anchor,
          }),
        })),
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const perNote = (pick: "faithful" | "helpful" | "value"): Score =>
        verdicts.ok
          ? {
              score: verdicts.value.some((v) => v[pick].score === null)
                ? null
                : (mean(verdicts.value.map((v) => v[pick].score)) ?? 0),
              label: verdicts.value.some((v) => v[pick].score === null)
                ? "judge-error"
                : undefined,
              explanation:
                verdicts.value
                  .map((v) => `${v.note.personaId}: ${v[pick].label}`)
                  .join("; ") || "no notes to judge",
            }
          : {
              score: null,
              label: "judge-error",
              explanation:
                verdicts.error instanceof Error
                  ? verdicts.error.message
                  : String(verdicts.error),
            };
      scores.faithfulness = await judged(async () => perNote("faithful"));
      scores.helpfulness = await judged(async () => perNote("helpful"));
      // The discriminating one: anchored 1-5 levels, scaled to 0-1.
      scores.note_value = await judged(async () => perNote("value"));
    }
    if (jev && written.length) {
      // One batched Jev request per note, all notes in parallel.
      const perNote = await Promise.all(
        written.map((note) =>
          askJev(
            jev,
            {
              draft,
              note: note.text,
              anchor: note.anchor ?? "(no passage quoted)",
            },
            JEV_NOTE_QUESTIONS,
          ),
        ),
      );
      for (const key of Object.keys(JEV_NOTE_QUESTIONS)) {
        const values = perNote.map((answers) => answers[key]?.score ?? null);
        const failed = perNote.filter(
          (answers) => answers[key]?.label === "jev-error",
        ).length;
        scores[key] = {
          score: failed ? null : mean(values),
          label: failed ? "jev-error" : undefined,
          explanation: written
            .map(
              (note, i) =>
                `${note.personaId}: ${perNote[i][key]?.label ?? "?"}`,
            )
            .join("; "),
        };
      }
    }
    return scores;
  },

  example: (testCase) => ({
    case_id: testCase.case_id,
    genre: testCase.genre,
    draftText: testCase.draftText,
    brief: JSON.stringify(testCase.brief),
    plants: JSON.stringify(testCase.plants),
  }),
};
