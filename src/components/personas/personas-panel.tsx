import { component$, useStore, $, useStylesScoped$ } from "@builder.io/qwik";
import type { PersonaFeedback, Persona, ProjectBrief } from "../../types";
import { loadDraftText, summarizeBrief } from "../../utils/anti-tabula-rasa";
import { PERSONAS } from "../../utils/personas";

interface PersonasStore {
  activePersona: string | null;
  feedback: PersonaFeedback[];
  isGenerating: boolean;
  expandedFeedback: Set<string>;
}

interface PersonasPanelProps {
  brief: ProjectBrief | null;
}

export const PersonasPanel = component$(({ brief }: PersonasPanelProps) => {
  const store = useStore<PersonasStore>({
    activePersona: null,
    feedback: [],
    isGenerating: false,
    expandedFeedback: new Set(),
  });

  useStylesScoped$(`
    .feedback-enter {
      animation: feedbackSlide 0.3s ease-out;
    }
    @keyframes feedbackSlide {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `);

  const requestFeedback = $(() => {
    store.isGenerating = true;

    setTimeout(() => {
      const draftText = loadDraftText();
      const simulated: PersonaFeedback[] = PERSONAS.map((p) =>
        generateContextualFeedback(p, brief, draftText),
      );
      store.feedback = simulated;
      store.isGenerating = false;
    }, 1500);
  });

  const toggleFeedback = $((id: string) => {
    const next = new Set(store.expandedFeedback);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    store.expandedFeedback = next;
  });

  const getTypeIcon = (type: PersonaFeedback["type"]) => {
    switch (type) {
      case "encouragement":
        return "✨";
      case "suggestion":
        return "💡";
      case "critique":
        return "🔍";
      case "perspective":
        return "👁️";
    }
  };

  return (
    <div class="flex flex-col h-full">
      <div class="px-4 py-3 border-b border-[var(--color-surface-3)]">
        <h2 class="text-sm font-semibold text-[var(--color-ink)] flex items-center gap-2">
          <span>🎭</span> Your Room of Editors
        </h2>
        <p class="text-xs text-[var(--color-ink-muted)] mt-1">
          {summarizeBrief(brief)}
        </p>
      </div>

      {/* Persona selector */}
      <div class="px-4 py-3 border-b border-[var(--color-surface-3)]">
        <div class="flex flex-wrap gap-2">
          {PERSONAS.map((persona) => (
            <button
              key={persona.id}
              onClick$={() => {
                store.activePersona =
                  store.activePersona === persona.id ? null : persona.id;
              }}
              class={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                store.activePersona === persona.id
                  ? "ring-2 ring-offset-1"
                  : "opacity-75 hover:opacity-100"
              }`}
              style={
                {
                  backgroundColor: `${persona.color}15`,
                  color: persona.color,
                  borderColor: persona.color,
                  "--tw-ring-color": persona.color,
                } as any
              }
            >
              <span>{persona.icon}</span>
              <span>{persona.name.split(" ").pop()}</span>
            </button>
          ))}
        </div>

        <button
          onClick$={requestFeedback}
          disabled={store.isGenerating}
          class="mt-3 w-full py-2 px-3 rounded-lg text-sm font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {store.isGenerating ? (
            <span class="flex items-center justify-center gap-2">
              <span class="animate-spin">⟳</span> Editors are reading...
            </span>
          ) : (
            "Ask the Room"
          )}
        </button>
      </div>

      {/* Feedback feed */}
      <div class="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {store.feedback.length === 0 && !store.isGenerating && (
          <div class="text-center py-8 text-[var(--color-ink-muted)]">
            <p class="text-3xl mb-3">📝</p>
            <p class="text-sm">
              Write something, then ask the room for feedback
            </p>
            <p class="text-xs mt-1">Your editors are ready when you are</p>
          </div>
        )}

        {store.feedback
          .filter(
            (f) => !store.activePersona || f.personaId === store.activePersona,
          )
          .map((feedback) => (
            <div
              key={`${feedback.personaId}-${feedback.timestamp}`}
              class="persona-feedback-card feedback-enter rounded-lg bg-white p-3 shadow-sm"
              style={{ borderLeftColor: feedback.personaColor }}
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <span class="text-sm">
                    {PERSONAS.find((p) => p.id === feedback.personaId)?.icon}
                  </span>
                  <span
                    class="text-xs font-semibold"
                    style={{ color: feedback.personaColor }}
                  >
                    {feedback.personaName}
                  </span>
                  <span class="text-xs text-[var(--color-ink-muted)]">
                    {getTypeIcon(feedback.type)}
                  </span>
                </div>
                <button
                  onClick$={() => toggleFeedback(feedback.personaId)}
                  class="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                >
                  {store.expandedFeedback.has(feedback.personaId)
                    ? "▾ less"
                    : "▸ more"}
                </button>
              </div>
              <p class="text-sm text-[var(--color-ink-light)] leading-relaxed">
                {store.expandedFeedback.has(feedback.personaId)
                  ? feedback.feedback
                  : feedback.feedback.slice(0, 120) +
                    (feedback.feedback.length > 120 ? "..." : "")}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
});

function generateContextualFeedback(
  persona: Persona,
  brief: ProjectBrief | null,
  draftText: string,
): PersonaFeedback {
  const answers = brief?.answers;
  const wordCount = draftText.split(/\s+/).filter(Boolean).length;
  const hasBodyDraft = wordCount > 80;
  const audience = answers?.audience || "your intended reader";
  const goal = answers?.goal || "the central purpose of the piece";
  const tone = answers?.tone || "the chosen tone";
  const constraints = answers?.constraints || "the project constraints";
  const successSignal = answers?.successSignal || "the intended reader outcome";

  const feedbackMap: Record<string, string> = {
    devil: hasBodyDraft
      ? `I am testing this against the stated goal: ${goal}. The draft needs sharper proof of why that goal follows from the argument on the page. I would look for one claim that the audience could reject, then add the strongest counterpoint before you answer it. Also check whether the constraints are actually visible: ${constraints}.`
      : `The brief gives us a useful target, but the draft is still mostly setup. Before adding polish, write the risky version of the argument: what would make ${audience} disagree, and what evidence would force them to keep reading?`,
    angel: hasBodyDraft
      ? `The strongest thing here is that the piece already has a declared destination: ${goal}. Keep using that as the spine. When a paragraph directly helps ${audience}, protect it; that is where the draft starts feeling authored rather than assembled.`
      : `The context is doing useful work already. You have a reader, a goal, and a success signal before the first real paragraph. That means the next move can be specific: write toward ${successSignal}.`,
    scholar: hasBodyDraft
      ? `For ${audience}, evidence should be chosen for credibility, not decoration. Scan each major claim and mark whether it needs a source, an example, or a definition. The constraint to protect is: ${constraints}.`
      : `The research plan should follow the brief. Collect sources that help prove ${goal}, then keep a separate note for facts that are interesting but do not move ${audience} toward the success signal.`,
    editor: hasBodyDraft
      ? `Edit for the requested tone: ${tone}. If a sentence does not advance ${goal}, compress it or move it into notes. The current priority is not elegance in isolation; it is making every paragraph serve the reader outcome.`
      : `Use the brief as a style guide. Start with one paragraph in the target tone: ${tone}. Then revise the first sentence until it makes the piece's promise concrete.`,
    reader: hasBodyDraft
      ? `Reading as ${audience}, I need the opening to tell me why this matters now and what I will understand by the end. The success test is clear: ${successSignal}. Make that promise visible early.`
      : `As ${audience}, I would rather see a rough, direct opening than more setup. Tell me what problem I am walking into, then give me one reason to trust you.`,
  };

  const typeMap: Record<string, PersonaFeedback["type"]> = {
    devil: "critique",
    angel: "encouragement",
    scholar: "suggestion",
    editor: "suggestion",
    reader: "perspective",
  };

  return {
    personaId: persona.id,
    personaName: persona.name,
    personaColor: persona.color,
    feedback: feedbackMap[persona.id] || "Interesting writing here.",
    timestamp: Date.now(),
    type: typeMap[persona.id] || "perspective",
  };
}
