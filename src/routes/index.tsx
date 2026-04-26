import { component$, $, useStore, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { TwyneEditor } from "../components/editor/twyne-editor";
import { PersonasPanel } from "../components/personas/personas-panel";
import { RubricPanel } from "../components/rubric/rubric-panel";
import { CommentsPanel } from "../components/comments/comments-panel";
import { CitationsPanel } from "../components/citations/citations-panel";
import { AntiTabulaRasa } from "../components/onboarding/anti-tabula-rasa";
import { ProjectBriefCard } from "../components/brief/project-brief-card";
import type { ProjectBrief, ProjectInterviewAnswers } from "../types";
import {
  buildStarterDocument,
  createProjectBrief,
  DEFAULT_INTERVIEW_ANSWERS,
  loadDraftHtml,
  loadProjectBrief,
  saveDraftHtml,
  saveProjectBrief,
} from "../utils/anti-tabula-rasa";

type RightPanel = "personas" | "rubric" | "comments" | "citations";

interface LayoutStore {
  rightPanel: RightPanel;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  hydrated: boolean;
  brief: ProjectBrief | null;
  showInterview: boolean;
  editorSeed: string;
}

export default component$(() => {
  const store = useStore<LayoutStore>({
    rightPanel: "personas",
    leftSidebarOpen: false,
    rightPanelOpen: true,
    hydrated: false,
    brief: null,
    showInterview: false,
    editorSeed: "",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    const brief = loadProjectBrief();
    const draft = loadDraftHtml();
    const hasDraft = draft.trim().length > 0;
    const seedAnswers = brief?.answers ?? DEFAULT_INTERVIEW_ANSWERS;

    store.brief = brief;
    store.editorSeed = draft || buildStarterDocument(seedAnswers);
    store.showInterview = !brief && !hasDraft;
    store.hydrated = true;
  });

  const handleInterviewSubmit = $((answers: ProjectInterviewAnswers) => {
    const brief = createProjectBrief(answers, store.brief);

    store.brief = brief;
    saveProjectBrief(brief);

    const currentDraft = loadDraftHtml();
    if (!currentDraft.trim()) {
      const starter = buildStarterDocument(answers);
      saveDraftHtml(starter);
      store.editorSeed = starter;
    } else {
      store.editorSeed = currentDraft;
    }

    store.showInterview = false;
    store.leftSidebarOpen = true;
  });

  const openInterview = $(() => {
    store.showInterview = true;
  });

  const closeInterview = $(() => {
    if (store.brief) {
      store.showInterview = false;
    }
  });

  const panelTabs: { id: RightPanel; label: string; icon: string }[] = [
    { id: "personas", label: "Editors", icon: "🎭" },
    { id: "rubric", label: "Rubric", icon: "📋" },
    { id: "comments", label: "Comments", icon: "💬" },
    { id: "citations", label: "Citations", icon: "📚" },
  ];

  if (!store.hydrated) {
    return (
      <div class="flex h-screen items-center justify-center bg-[var(--color-surface)] text-[var(--color-ink-muted)]">
        <div class="rounded-2xl border border-[var(--color-surface-3)] bg-white px-5 py-4 shadow-sm">
          Loading project context...
        </div>
      </div>
    );
  }

  const workspaceClass =
    store.showInterview && store.brief
      ? "pointer-events-none select-none blur-sm"
      : "";
  const renderWorkspace = store.brief !== null || !store.showInterview;

  return (
    <>
      {store.showInterview && !store.brief && (
        <AntiTabulaRasa
          mode="first-run"
          initialAnswers={null}
          onSubmit$={handleInterviewSubmit}
        />
      )}

      {renderWorkspace && (
        <div
          class={`flex h-screen bg-[var(--color-surface)] overflow-hidden ${workspaceClass}`}
        >
          {/* Left sidebar */}
          <div
            class={`sidebar-transition flex-shrink-0 border-r border-[var(--color-surface-3)] bg-white ${
              store.leftSidebarOpen ? "w-64" : "w-0"
            } overflow-hidden`}
          >
            <div class="w-64 h-full flex flex-col">
              <div class="px-4 py-3 border-b border-[var(--color-surface-3)]">
                <h2 class="text-sm font-semibold text-[var(--color-ink)]">
                  Documents
                </h2>
              </div>

              <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                <ProjectBriefCard
                  brief={store.brief}
                  onStartInterview$={openInterview}
                />

                <div class="space-y-1">
                  <button class="w-full text-left px-3 py-2 rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)] text-sm font-medium">
                    📄 Current Draft
                  </button>
                  <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface-2)] text-sm text-[var(--color-ink-light)]">
                    📄 Research Notes
                  </button>
                  <button class="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface-2)] text-sm text-[var(--color-ink-light)]">
                    📁 Chapter Outlines
                  </button>
                </div>
              </div>

              <div class="px-4 py-3 border-t border-[var(--color-surface-3)]">
                <button class="w-full py-1.5 px-3 rounded-lg text-xs font-medium bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:bg-[var(--color-surface-3)] transition-colors">
                  + New Document
                </button>
              </div>
            </div>
          </div>

          {/* Main area */}
          <div class="flex-1 flex flex-col min-w-0">
            {/* Top bar */}
            <header class="h-12 flex items-center justify-between px-4 border-b border-[var(--color-surface-3)] bg-white/90 backdrop-blur-sm">
              <div class="flex items-center gap-3">
                <button
                  onClick$={() => {
                    store.leftSidebarOpen = !store.leftSidebarOpen;
                  }}
                  class="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] transition-colors"
                  title="Toggle documents"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M3 3h18v18H3zM9 3v18" />
                  </svg>
                </button>
                <div class="flex items-center gap-2">
                  <span class="text-lg font-bold bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-light)] bg-clip-text text-transparent">
                    twyne
                  </span>
                  <span class="text-xs text-[var(--color-ink-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded-full">
                    .love
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-[var(--color-ink-muted)] hidden sm:inline">
                  The writer's room
                </span>
                <button
                  onClick$={openInterview}
                  class="hidden sm:inline-flex rounded-full border border-[var(--color-surface-3)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink-light)] hover:bg-[var(--color-surface-2)] transition-colors"
                  title="Refine the project brief"
                >
                  Refine brief
                </button>
                <button
                  onClick$={() => {
                    store.rightPanelOpen = !store.rightPanelOpen;
                  }}
                  class="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] text-[var(--color-ink-light)] transition-colors"
                  title="Toggle panel"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M15 3v18" />
                  </svg>
                </button>
              </div>
            </header>

            {/* Editor + Right panel */}
            <div class="flex-1 flex min-h-0">
              <TwyneEditor initialContent={store.editorSeed} />

              {/* Right panel */}
              <div
                class={`sidebar-transition flex-shrink-0 border-l border-[var(--color-surface-3)] bg-[var(--color-surface)] ${
                  store.rightPanelOpen ? "w-80 lg:w-96" : "w-0"
                } overflow-hidden`}
              >
                <div class="w-80 lg:w-96 h-full flex flex-col">
                  {/* Panel tabs */}
                  <div class="flex border-b border-[var(--color-surface-3)] bg-white">
                    {panelTabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick$={() => {
                          store.rightPanel = tab.id;
                          store.rightPanelOpen = true;
                        }}
                        class={`flex-1 px-2 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                          store.rightPanel === tab.id && store.rightPanelOpen
                            ? "border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-brand)]/5"
                            : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                        }`}
                      >
                        <span class="mr-1">{tab.icon}</span>
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Panel content */}
                  <div class="flex-1 min-h-0 overflow-hidden">
                    {store.rightPanel === "personas" && (
                      <PersonasPanel brief={store.brief} />
                    )}
                    {store.rightPanel === "rubric" && (
                      <RubricPanel brief={store.brief} />
                    )}
                    {store.rightPanel === "comments" && (
                      <CommentsPanel brief={store.brief} />
                    )}
                    {store.rightPanel === "citations" && <CitationsPanel />}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {store.showInterview && store.brief && (
        <AntiTabulaRasa
          mode="refine"
          initialAnswers={store.brief.answers}
          onSubmit$={handleInterviewSubmit}
          onCancel$={closeInterview}
        />
      )}
    </>
  );
});

export const head: DocumentHead = {
  title: "Twyne — The Writer's Room",
  meta: [
    {
      name: "description",
      content:
        "An anti-tabula-rasa writing workspace with AI personas, rubric analysis, and a room full of editors. Start with context, not a blank page.",
    },
    {
      name: "og:title",
      content: "Twyne — The Writer's Room",
    },
    {
      name: "og:description",
      content:
        "Write with a room full of editors. Twyne starts with an interview, a seeded brief, citation detection, and structured feedback.",
    },
    {
      name: "og:url",
      content: "https://twyne.love",
    },
  ],
};
