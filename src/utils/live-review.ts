import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { RubricResult } from "../types";
import { htmlToPlainText } from "./anti-tabula-rasa";
import { paragraphTextFromHtml } from "./draft-trajectory";
import { requestActiveDraftSnapshot } from "./collaboration";
import {
  loadActiveFolioIdFromIdb,
  loadBriefFromIdb,
  loadFolioContentFromIdb,
  loadMetaFromIdb,
  saveMetaToIdb,
  saveRubricResultToIdb,
  loadWriterSettingsFromIdb,
  loadPersonasFromIdb,
} from "./idb";
import { loadPersonaNotesLocally } from "./convex-sync";
import { loadRevisionHistory } from "./revision-history";
import { loadWritingToolsNotebook } from "./writing-tools-storage";
import { appendRubricHistory, loadCriteriaSpecs } from "./rubric-criteria";
import { buildRubricQuestions, readRubricAnswers } from "./rubric-grade";
import {
  judgementRubricResult,
  rubricDraftFingerprint,
} from "./rubric-judgement-result";
import { scoreStaticFeatures } from "./rubric";
import { draftReadiness, MIN_RUBRIC_WORDS } from "./draft-thresholds";
import {
  buildBriefQuestions,
  buildBriefState,
  readBriefAssessment,
  type BriefAssessment,
} from "./brief-coach";
import {
  buildTriageQuestions,
  buildTriageState,
  readTriage,
  splitPassages,
  type TriagedPassage,
} from "./passage-triage";
import {
  WRITING_LENSES,
  type WritingLensId,
  type WritingLensResult,
  type WritingLensInput,
} from "./writing-lenses";
import { cachedWritingLens } from "./writing-lens-cache";
import { reviewEditorialNote } from "./editorial-note-review";
import type { NoteVerdict } from "./note-gate";
import { PERSONAS } from "./personas";
import type {
  SystemOneAnswer,
  SystemOneQuestion,
  SystemOneUsage,
} from "./system-one";

export interface LiveReview {
  folioId: string;
  fingerprint: string;
  at: number;
  rubric: RubricResult | null;
  brief: BriefAssessment | null;
  passages: TriagedPassage[];
  coverage: string;
  lenses: Partial<Record<WritingLensId, WritingLensResult>>;
  notes?: Array<{ id: string; author: string; verdict: NoteVerdict | null }>;
}
export interface LiveReviewSnapshot {
  folioId: string | null;
  status:
    | "waiting"
    | "reading"
    | "current"
    | "paused"
    | "offline"
    | "unavailable";
  message: string;
  result: LiveReview | null;
}
type Response = {
  ok: boolean;
  model?: string;
  answers?: Record<string, unknown>;
  usage?: SystemOneUsage;
  error?: string;
};
let snapshot: LiveReviewSnapshot = {
  folioId: null,
  status: "waiting",
  message: "Review updates after your draft is saved.",
  result: null,
};
export const liveReviewSnapshot = () => snapshot;
export const liveReviewKey = (folioId: string) => `live-review:${folioId}`;

function publish(next: LiveReviewSnapshot) {
  snapshot = next;
  window.dispatchEvent(new CustomEvent("twyne:live-review", { detail: next }));
}

/** One owner per editor workspace; independent of which board panel is visible. */
export function startLiveReview(
  client: ConvexClient | null,
  folioId: string,
): () => void {
  let stopped = false;
  let generation = 0;
  let running = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastStarted = 0;
  let failures = 0;
  // Cache semantic requests, not weights or presentation settings. Bounded to this folio session.
  const cache = new Map<string, Response>();
  const lensCache = new Map<string, WritingLensResult>();
  const setStatus = (status: LiveReviewSnapshot["status"], message: string) => {
    if (!stopped) publish({ ...snapshot, folioId, status, message });
  };
  publish({
    folioId,
    status: "waiting",
    message: "Review updates after your draft is saved.",
    result: null,
  });
  void loadMetaFromIdb<LiveReview>(liveReviewKey(folioId)).then((result) => {
    if (!stopped && !snapshot.result && result?.folioId === folioId)
      publish({ ...snapshot, result });
  });

  const schedule = () => {
    if (stopped) return;
    generation++;
    pending = true;
    clearTimeout(timer);
    if (!running) {
      setStatus("waiting", "Waiting for a pause in writing…");
      timer = setTimeout(
        () => void run(),
        Math.max(2500, lastStarted + 30_000 - Date.now()),
      );
    }
  };
  const run = async () => {
    if (stopped || running) return;
    pending = false;
    if (document.hidden) return;
    if (navigator.onLine === false) {
      setStatus(
        "offline",
        "Saved locally. Review will resume when you reconnect.",
      );
      return;
    }
    if ((await loadMetaFromIdb<boolean>("live-review-enabled")) === false) {
      setStatus("paused", "Automatic review is paused.");
      return;
    }
    if (stopped) return;
    if (!client) {
      setStatus(
        "unavailable",
        "Connect your account to keep the review up to date.",
      );
      return;
    }
    running = true;
    lastStarted = Date.now();
    const token = generation;
    const current = () => !stopped && token === generation;
    let calls = 0;
    try {
      const [html, brief, specs, notebook, revisions, notes] =
        await Promise.all([
          loadFolioContentFromIdb(folioId),
          loadBriefFromIdb(folioId),
          loadCriteriaSpecs(folioId),
          loadWritingToolsNotebook(folioId),
          loadRevisionHistory(folioId),
          loadPersonaNotesLocally(folioId),
        ]);
      if (!current()) return;
      const draft = paragraphTextFromHtml(html);
      const plain = htmlToPlainText(html);
      if (!draftReadiness(plain, MIN_RUBRIC_WORDS).ok) {
        publish({
          folioId,
          status: "waiting",
          message: `Review begins at ${MIN_RUBRIC_WORDS} words. Your draft is saved as usual.`,
          result: null,
        });
        return;
      }
      const fresh = async () => {
        if (!current() || (await loadActiveFolioIdFromIdb()) !== folioId)
          return false;
        let latest: string;
        try {
          latest = requestActiveDraftSnapshot(folioId);
        } catch {
          latest = await loadFolioContentFromIdb(folioId);
        }
        return current() && htmlToPlainText(latest) === plain;
      };
      if (!(await fresh())) return;
      setStatus("reading", "Reading the saved draft…");
      let transportUnavailable = false;
      const ask = async (input: {
        state: Record<string, unknown>;
        questions: Record<string, SystemOneQuestion>;
      }): Promise<Response> => {
        if (!current()) throw new Error("superseded");
        const key = await rubricDraftFingerprint(JSON.stringify(input));
        if (!current()) throw new Error("superseded");
        const cached = cache.get(key);
        if (cached) return cached;
        if (transportUnavailable) throw new Error("unavailable");
        if (++calls > 32) throw new Error("budget");
        const response = (await client.action(api.systemOne.ask, {
          state: Object.fromEntries(
            Object.entries(input.state).map(([key, value]) => [
              key,
              typeof value === "string" ? value : JSON.stringify(value),
            ]),
          ),
          questions: input.questions,
        })) as Response;
        if (!response.ok || !response.answers) {
          transportUnavailable = true;
          if (
            [
              "account not linked",
              "signed out",
              "no credit",
              "unconfigured",
            ].includes(response.error ?? "")
          )
            throw new Error(response.error);
          throw new Error("unavailable");
        }
        if (Object.keys(input.questions).some((id) => !response.answers?.[id]))
          throw new Error("incomplete");
        cache.set(key, response);
        if (cache.size > 64) cache.delete(cache.keys().next().value!);
        return response;
      };
      // Grade the whole draft only when it fits. A bounded excerpt must never earn a whole-piece grade.
      const bounded = draft.slice(0, 40_000);
      const candidates = splitPassages(bounded).slice(0, 12);
      const rubricQuestions =
        draft.length <= 40_000 ? buildRubricQuestions(specs) : {};
      const questions = {
        ...Object.fromEntries(
          Object.entries(rubricQuestions).map(([id, q]) => [`rubric_${id}`, q]),
        ),
        ...buildTriageQuestions(candidates),
      };
      const state = {
        ...buildTriageState(candidates, bounded),
        audience: brief?.answers.audience ?? "",
        goal: brief?.answers.goal ?? "",
      };
      const answers: Record<string, SystemOneAnswer> = {};
      let model = "";
      const usage = { input_tokens: 0, output_tokens: 0 };
      const entries = Object.entries(questions);
      for (let i = 0; i < entries.length; i += 64) {
        const response = await ask({
          state,
          questions: Object.fromEntries(entries.slice(i, i + 64)),
        });
        Object.assign(answers, response.answers);
        model = response.model ?? "unknown";
        usage.input_tokens += response.usage?.input_tokens ?? 0;
        usage.output_tokens += response.usage?.output_tokens ?? 0;
      }
      const fingerprint = await rubricDraftFingerprint(plain);
      const rubric = Object.keys(rubricQuestions).length
        ? judgementRubricResult({
            folioId,
            fingerprint,
            specs,
            staticScore: scoreStaticFeatures(plain),
            grade: readRubricAnswers(
              Object.fromEntries(
                Object.entries(answers)
                  .filter(([id]) => id.startsWith("rubric_"))
                  .map(([id, answer]) => [id.slice(7), answer]),
              ),
              { model, usage },
            ),
          })
        : null;
      const previous = snapshot.result;
      const result: LiveReview = {
        folioId,
        fingerprint,
        at: Date.now(),
        rubric,
        brief: null,
        passages: readTriage(candidates, answers),
        coverage: `${candidates.length} passages checked for attention${draft.length > 40_000 ? "; opening 40,000 characters only, no whole-draft grade" : ""}.`,
        lenses: {},
      };
      // Publish the first useful reading immediately; independent lenses must not delay marks or passages.
      if (!(await fresh())) return;
      publish({
        folioId,
        status: "reading",
        message: "Marks and passages are ready. Reading the remaining lenses…",
        result: { ...result },
      });
      if (rubric) {
        await saveRubricResultToIdb(rubric, folioId);
        if (!current()) return;
        if (
          previous?.fingerprint !== fingerprint ||
          JSON.stringify(previous.rubric?.criteria) !==
            JSON.stringify(rubric.criteria)
        )
          await appendRubricHistory(
            {
              folioId,
              at: rubric.timestamp,
              overall: rubric.overallScore,
              grade: rubric.overallGrade,
              targetFit: rubric.targetFit,
              scoringMethod: "judgement",
              perCriterion: Object.fromEntries(
                rubric.criteria.map((c) => [c.id, c.score]),
              ),
            },
            folioId,
          );
        window.dispatchEvent(
          new CustomEvent("twyne:rubric-updated", { detail: { folioId } }),
        );
      }
      if (brief) {
        const response = await ask({
          state: buildBriefState(brief),
          questions: buildBriefQuestions(brief),
        });
        result.brief = readBriefAssessment(
          brief,
          response.answers as Record<string, SystemOneAnswer>,
        );
        if (!current()) return;
        publish({
          folioId,
          status: "reading",
          message: "Reading the remaining lenses…",
          result: { ...result, lenses: { ...result.lenses } },
        });
      }
      const history = revisions.map((revision) => ({
        id: revision.id,
        text: paragraphTextFromHtml(revision.html),
      }));
      const previousDraft = history.find(
        (revision) => revision.text !== draft,
      )?.text;
      for (const { id } of WRITING_LENSES) {
        if (!current()) return;
        const input: WritingLensInput = {
          draft,
          audience: notebook.audience || brief?.answers.audience,
          ...(id === "revision" || id === "voice" ? { previousDraft } : {}),
          ...(id === "voice" ? { voiceSamples: notebook.voiceSamples } : {}),
          ...(id === "scraps" ? { scraps: notebook.scraps } : {}),
          ...(id === "room"
            ? {
                notes: notes.slice(-8).map((note, index) => ({
                  id: note.noteId ?? String(index),
                  text: note.feedback,
                  author: note.personaName,
                })),
              }
            : {}),
          ...(id === "circling" ? { revisions: [...history].reverse() } : {}),
          ...(id === "research" ? { sources: notebook.sources } : {}),
          ...(id === "promises"
            ? { intentionalPromises: notebook.intentionalPromises }
            : {}),
        };
        const key = await rubricDraftFingerprint(JSON.stringify([id, input]));
        if (
          id === "research" &&
          notebook.sources.some((pair) => !draft.includes(pair.claim))
        ) {
          result.lenses[id] = {
            status: "missing-input",
            findings: [],
            coverage: "No source pairs sent.",
            notice:
              "Update saved claims to match the current draft before checking research drift.",
          };
        } else {
          const lens =
            lensCache.get(key) ??
            (await cachedWritingLens(folioId, id, input, ask));
          result.lenses[id] = lens;
          if (lens.status !== "unavailable" && !lens.incomplete)
            lensCache.set(key, lens);
          if (lensCache.size > 32)
            lensCache.delete(lensCache.keys().next().value!);
        }
        if (!current()) return;
        publish({
          folioId,
          status: "reading",
          message: "Reading the remaining lenses…",
          result: { ...result, lenses: { ...result.lenses } },
        });
      }
      const [writer, personas] = await Promise.all([
        loadWriterSettingsFromIdb(),
        loadPersonasFromIdb(),
      ]);
      result.notes = [];
      for (const [index, note] of notes.slice(-5).entries()) {
        if (!current()) return;
        const verdict = await reviewEditorialNote(ask, {
          note: note.feedback,
          quote: note.anchor,
          draft,
          brief,
          profile: writer.profile,
          persona: (personas?.length ? personas : PERSONAS).find(
            (persona) => persona.id === note.personaId,
          ),
        });
        result.notes.push({
          id: note.noteId ?? String(index),
          author: note.personaName,
          verdict,
        });
      }
      if (!(await fresh())) return;
      // Keep the authored review assembled from typed findings; no fictional persona metrics or generated essay.
      await saveMetaToIdb(liveReviewKey(folioId), result);
      if (!current()) return;
      const incomplete =
        transportUnavailable ||
        Object.values(result.lenses).some(
          (lens) => lens.status === "unavailable" || lens.incomplete,
        );
      failures = incomplete ? failures + 1 : 0;
      publish({
        folioId,
        status: incomplete ? "unavailable" : "current",
        message: incomplete
          ? "Available findings are ready. Some checks will be retried shortly."
          : "Review is up to date with the saved draft.",
        result,
      });
      if (incomplete)
        timer = setTimeout(
          schedule,
          Math.min(300_000, 30_000 * 2 ** Math.min(failures, 4)),
        );
      window.dispatchEvent(
        new CustomEvent("twyne:rubric-updated", { detail: { folioId } }),
      );
    } catch (error) {
      if (current()) {
        failures++;
        const reason = error instanceof Error ? error.message : "";
        const accountMessages: Record<string, string> = {
          "account not linked":
            "Connect Not Organic in Settings to enable automatic review.",
          "signed out":
            "Sign in and connect Not Organic in Settings to enable automatic review.",
          "no credit":
            "Your Not Organic account needs credit to continue reviewing.",
          unconfigured:
            "Hosted review is not configured. Your draft is saved as usual.",
        };
        setStatus(
          "unavailable",
          accountMessages[reason] ??
            "Review is temporarily unavailable. Your draft is saved; another reading will be tried shortly.",
        );
        if (!accountMessages[reason])
          timer = setTimeout(
            schedule,
            Math.min(300_000, 30_000 * 2 ** Math.min(failures, 4)),
          );
      }
    } finally {
      running = false;
      if (pending && !stopped) schedule();
    }
  };
  const onSave = (event: Event) => {
    const saved = (event as CustomEvent<{ folioId?: string }>).detail;
    if (!saved?.folioId || saved.folioId === folioId) schedule();
  };
  const onContent = () => {
    // Invalidate immediately, even before persistence completes.
    generation++;
    if (snapshot.status === "current")
      setStatus("waiting", "Draft changed. Review will update after saving.");
  };
  const onResume = () => {
    if (!document.hidden) schedule();
  };
  const events = [
    "twyne:draft-saved",
    "twyne:criteria-changed",
    "twyne:writing-material-changed",
    "twyne:background-room-notes",
    "twyne:live-review-setting",
    "twyne:remote-sync",
  ];
  events.forEach((event) => window.addEventListener(event, onSave));
  window.addEventListener("twyne:content", onContent);
  window.addEventListener("online", onResume);
  document.addEventListener("visibilitychange", onResume);
  schedule();
  return () => {
    stopped = true;
    generation++;
    clearTimeout(timer);
    events.forEach((event) => window.removeEventListener(event, onSave));
    window.removeEventListener("twyne:content", onContent);
    window.removeEventListener("online", onResume);
    document.removeEventListener("visibilitychange", onResume);
  };
}
