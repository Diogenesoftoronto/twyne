import { component$, $, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { useNavigate } from "@builder.io/qwik-city";
import type { DocumentHead } from "@builder.io/qwik-city";
import { AntiTabulaRasa } from "../../components/onboarding/anti-tabula-rasa";
import type { ProjectBrief, ProjectInterviewAnswers } from "../../types";
import {
  createProjectBrief,
  loadProjectBrief,
  saveProjectBrief,
} from "../../utils/anti-tabula-rasa";

interface RefiningStore {
  brief: ProjectBrief | null;
  hydrated: boolean;
}

/**
 * The brief refinery. The writer returns to the interview with their
 * current answers pre-filled (mode = "refine"). Saving updates the
 * brief in place; cancelling returns to /editor unchanged.
 *
 * No new brief is created — `createProjectBrief(answers, previous)`
 * preserves the original `completedAt` so the dossier keeps its history.
 */
export default component$(() => {
  const nav = useNavigate();
  const store = useStore<RefiningStore>({
    brief: null,
    hydrated: false,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    store.brief = loadProjectBrief();
    store.hydrated = true;
  });

  const onSubmit$ = $((answers: ProjectInterviewAnswers) => {
    const next = createProjectBrief(answers, store.brief);
    saveProjectBrief(next);
    void nav("/editor/");
  });

  const onCancel$ = $(() => {
    void nav("/editor/");
  });

  if (!store.hydrated) {
    return (
      <div class="flex h-screen items-center justify-center bg-[var(--color-surface)] text-[var(--color-ink-muted)]">
        <div class="rounded-2xl border border-[var(--color-surface-3)] bg-white px-5 py-4 shadow-sm">
          Loading dossier…
        </div>
      </div>
    );
  }

  return (
    <AntiTabulaRasa
      mode="refine"
      initialAnswers={store.brief?.answers ?? null}
      onSubmit$={onSubmit$}
      onCancel$={onCancel$}
    />
  );
});

export const head: DocumentHead = {
  title: "Refine the dossier · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Refine the project brief that anchors the room of editors.",
    },
  ],
};
