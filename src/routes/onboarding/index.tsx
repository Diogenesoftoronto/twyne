import { component$, $ } from "@builder.io/qwik";
import { useNavigate } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AntiTabulaRasa } from "../../components/onboarding/anti-tabula-rasa";
import type { ProjectInterviewAnswers } from "../../types";
import {
  buildStarterDocument,
  createProjectBrief,
  loadDraftHtml,
  saveDraftHtml,
  saveProjectBrief,
} from "../../utils/anti-tabula-rasa";

/**
 * The first-run interview. Renders the AntiTabulaRasa component
 * in `first-run` mode, saves the resulting brief to IndexedDB, seeds
 * a starter document if the writer has nothing yet, and then sends
 * the writer to /editor.
 *
 * Replaces the previous `window.dispatchEvent("twyne:submit-interview")`
 * pattern — that needed the root route to be on the page listening.
 * Now that onboarding is its own route, the callback owns the work.
 */
export default component$(() => {
  const nav = useNavigate();

  const onSubmit$ = $((answers: ProjectInterviewAnswers) => {
    const brief = createProjectBrief(answers, null);
    saveProjectBrief(brief);

    if (!loadDraftHtml().trim()) {
      saveDraftHtml(buildStarterDocument(answers));
    }

    void nav("/editor/");
  });

  const onCancel$ = $(() => {
    void nav("/");
  });

  return (
    <AntiTabulaRasa
      mode="first-run"
      initialAnswers={null}
      onSubmit$={onSubmit$}
      onCancel$={onCancel$}
    />
  );
});

export const head: DocumentHead = {
  title: "Begin the dossier · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Twyne's onboarding interview: the dossier the room will read from as you write.",
    },
  ],
};
