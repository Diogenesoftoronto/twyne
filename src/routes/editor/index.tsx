import { component$, $, useStore, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { TwyneEditor } from "../../components/editor/twyne-editor";
import { PersonasPanel } from "../../components/personas/personas-panel";
import { RubricPanel } from "../../components/rubric/rubric-panel";
import { CommentsPanel } from "../../components/comments/comments-panel";
import { CitationsPanel } from "../../components/citations/citations-panel";
import { ProjectBriefCard } from "../../components/brief/project-brief-card";
import type { ProjectBrief } from "../../types";
import {
  buildStarterDocument,
  DEFAULT_INTERVIEW_ANSWERS,
  loadDraftHtml,
  loadProjectBrief,
} from "../../utils/anti-tabula-rasa";

type RightPanel = "personas" | "rubric" | "comments" | "citations";

interface LayoutStore {
  rightPanel: RightPanel;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  hydrated: boolean;
  brief: ProjectBrief | null;
  editorSeed: string;
}

export default component$(() => {
  const store = useStore<LayoutStore>({
    rightPanel: "personas",
    leftSidebarOpen: false,
    rightPanelOpen: true,
    hydrated: false,
    brief: null,
    editorSeed: "",
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    store.brief = loadProjectBrief();
    const draft = loadDraftHtml();
    store.editorSeed =
      draft || buildStarterDocument(store.brief?.answers ?? DEFAULT_INTERVIEW_ANSWERS);
    store.hydrated = true;
  });

  const openRefining = $(() => {
    window.location.href = "/refining/";
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

  return (
    <div class="flex h-screen bg-[var(--color-surface)] overflow-hidden">
      {/* Left sidebar */}
      <div
        class={`sidebar-transition flex-shrink-0 border-r border-[var(--color-surface-3)] bg-white ${
          store.leftSidebarOpen ? "w-64" : "w-0"
        } overflow-hidden`}
      >
        <div class="w-64 h-full flex flex-col">
          <div class="px-4 py-3 border-b border-[var(--color-surface-3)] flex items-center gap-2">
            <a
              href="/"
              class="text-lg font-bold bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand-light)] bg-clip-text text-transparent"
            >
              twyne
            </a>
            <span class="text-xs text-[var(--color-ink-muted)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded-full">
              .love
            </span>
          </div>

          <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            <ProjectBriefCard brief={store.brief} onStartInterview$={openRefining} />

            <div class="space-y-1">
              <button class="w-full text-left px-3 py-2 rounded-lg bg-[var(--color-brand)]/10 text-[var(--color-brand)] text-sm font-medium">
                📄 Current Draft
              </button>
              <a
                href="/apparatus/"
                class="block w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface-2)] text-sm text-[var(--color-ink-light)]"
              >
                📚 The Apparatus
              </a>
              <a
                href="/personas/"
                class="block w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface-2)] text-sm text-[var(--color-ink-light)]"
              >
                🎭 Room of Editors
              </a>
              <a
                href="/rubric/"
                class="block w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface-2)] text-sm text-[var(--color-ink-light)]"
              >
                📋 Galley Proof
              </a>
              <a
                href="/library/"
                class="block w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface-2)] text-sm text-[var(--color-ink-light)]"
              >
                🗂 The Library
              </a>
            </div>
          </div>

          <div class="px-4 py-3 border-t border-[var(--color-surface-3)] space-y-2">
            <a
              href="/settings/"
              class="block w-full py-1.5 px-3 rounded-lg text-xs font-medium bg-[var(--color-surface-2)] text-[var(--color-ink-light)] hover:bg-[var(--color-surface-3)] transition-colors text-center"
            >
              ⚙ Settings
            </a>
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
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-[var(--color-ink-muted)] hidden sm:inline">
              The writer's room
            </span>
            <button
              onClick$={openRefining}
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
  );
});

export const head: DocumentHead = {
  title: "Editor · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Twyne's writing workspace: the dossier beside you, a room of editors in residence, and a galley proof that grades the draft as you write.",
    },
  ],
};
