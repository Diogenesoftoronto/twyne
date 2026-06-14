import { component$ } from "@builder.io/qwik";

const panelTabs = [
  {
    id: "personas",
    label: "Cast",
    accent: "var(--color-vermilion)",
  },
  {
    id: "rubric",
    label: "Rubric",
    accent: "var(--color-cobalt)",
  },
  {
    id: "comments",
    label: "Marginalia",
    accent: "var(--color-mustard)",
  },
  {
    id: "citations",
    label: "Apparatus",
    accent: "var(--color-periwinkle)",
  },
];

const demoPersonas = [
  {
    id: "skeptic",
    name: "The Skeptic",
    role: "Finds the weak seam",
    color: "var(--color-vermilion)",
    icon: "✕",
  },
  {
    id: "reader",
    name: "The Gentle Reader",
    role: "Reads as your reader reads",
    color: "var(--color-sage)",
    icon: "✦",
  },
  {
    id: "editor",
    name: "The Line Editor",
    role: "Watches structure and pace",
    color: "var(--color-mustard)",
    icon: "✎",
  },
  {
    id: "critic",
    name: "The Critic",
    role: "Names what is missing",
    color: "var(--color-cobalt)",
    icon: "❧",
  },
  {
    id: "scholar",
    name: "The Scholar",
    role: "Checks claims against sources",
    color: "var(--color-periwinkle)",
    icon: "§",
  },
];

export const WorkspacePreview = component$(() => {
  return (
    <div class="w-full h-full flex flex-col overflow-hidden rounded-[4px] border-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper)] shadow-[0_30px_80px_-40px_rgba(31,27,22,0.35)]">
      {/* ── Masthead ─────────────────────────────────────── */}
      <header class="flex-shrink-0 border-b-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper)]">
        <div class="flex items-center px-4 pt-3 pb-1.5 gap-3">
          <button class="p-1.5 text-[var(--color-ink-light)]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
            >
              <path d="M3 5h18M3 12h18M3 19h18" />
            </svg>
          </button>

          <div class="flex-1 flex flex-col items-center">
            <p class="dept-label">The Writer's Room</p>
            <h1
              class="press leading-none mt-0.5 ink-bleed"
              style="font-family: var(--font-display); font-weight: 700; font-size: 1.6rem; letter-spacing: 0.06em; color: var(--color-ink);"
            >
              TWYNE
            </h1>
            <p
              class="mt-1 text-[10px] text-[var(--color-ink-muted)] tracking-wider"
              style="font-family: var(--font-typewriter);"
            >
              Vol. I · No. 117 · Sunday, the 26th of April, MMXXVI
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button class="btn-paper hidden sm:inline-flex text-[0.65rem]">
              Refine the dossier
            </button>
            <button class="p-1.5 text-[var(--color-ink-light)]">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
              >
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
            <button class="p-1.5 text-[var(--color-ink-light)]">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
              >
                <rect x="3" y="3" width="18" height="18" />
                <path d="M15 3v18" />
              </svg>
            </button>
          </div>
        </div>
        <div class="flex items-center justify-center gap-3 pb-2 px-5">
          <span class="flex-1 h-px bg-[var(--color-ink)]" />
          <span class="text-[var(--color-vermilion)] text-xs">✦</span>
          <span class="flex-1 h-px bg-[var(--color-ink)]" />
        </div>
      </header>

      {/* ── Editor + Sidebars ────────────────────────────── */}
      <div class="flex-1 flex min-h-0">
        {/* Left Drawer */}
        <aside class="hidden md:flex flex-shrink-0 w-64 md:w-72 border-r-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper-2)] flex-col">
          <div class="px-4 py-3 border-b border-[var(--color-paper-3)]">
            <h2
              class="text-xl text-[var(--color-ink)]"
              style="font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em;"
            >
              Pieces in Progress
            </h2>
          </div>

          <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {/* Demo dossier card */}
            <div class="index-card p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="dept-label">The Dossier</p>
                <span class="stamp">Filed</span>
              </div>
              <h3
                class="mt-1 text-sm leading-tight text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 700;"
              >
                The City is a Sentence
              </h3>
              <dl class="mt-3 space-y-2">
                <div>
                  <dt class="dept-label">Format</dt>
                  <dd
                    class="mt-0.5 text-[12px] leading-5 text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                  >
                    Essay
                  </dd>
                </div>
                <div>
                  <dt class="dept-label">Audience</dt>
                  <dd
                    class="mt-0.5 text-[12px] leading-5 text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                  >
                    Curious urbanists
                  </dd>
                </div>
              </dl>
            </div>

            <div
              class="ornament-divider"
              style="font-family: var(--font-display);"
            >
              ❦
            </div>

            <div class="space-y-1">
              <button
                class="w-full text-left px-3 py-2 border-l-4 border-[var(--color-vermilion)] bg-[var(--color-paper-soft)] text-sm text-[var(--color-ink)]"
                style="font-family: var(--font-serif);"
              >
                <span class="dept-label block">Folio I</span>
                Current draft
              </button>
              <button
                class="w-full text-left px-3 py-2 border-l-4 border-transparent hover:bg-[var(--color-paper-soft)] text-sm text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif);"
              >
                <span class="dept-label block">Folio II</span>
                Research notes
              </button>
              <button
                class="w-full text-left px-3 py-2 border-l-4 border-transparent hover:bg-[var(--color-paper-soft)] text-sm text-[var(--color-ink-light)]"
                style="font-family: var(--font-serif);"
              >
                <span class="dept-label block">Folio III</span>
                Chapter outlines
              </button>
            </div>
          </div>
        </aside>

        {/* Editor Canvas */}
        <div class="flex-1 bg-[var(--color-editor-bg)] overflow-auto twyne-editor">
          <div class="max-w-[680px] mx-auto px-6 py-8 md:px-10 md:py-12">
            <div class="ProseMirror">
              <h1>The City Receives You</h1>

              <p>
                <span class="float-left text-[4.2em] leading-[0.85] mr-3 mt-[0.08em] font-display font-bold text-[var(--color-vermilion)]">
                  T
                </span>
                he city receives you before you arrive. You feel it in the tilt
                of the light, the way shopkeepers arrange their windows, the
                particular silence of a side street at dusk. Every neighbourhood
                is a paragraph; every boulevard a long sentence winding toward
                some punctuation you cannot yet see.
              </p>

              <p>
                To write about a place is to argue with it. The buildings resist
                metaphor. The traffic ignores your symbolism. And yet—if you sit
                still long enough—the city begins to dictate its own grammar.
                You become less an author than a stenographer, recording what
                was already there.
              </p>

              <h2>The Margin as Method</h2>

              <p>
                The best drafts are not composed in isolation. They are written
                in the margins of other books, in the pauses between
                conversations, in the white space that surrounds another
                person's argument. Twyne keeps that margin visible: the brief,
                the cast, the apparatus, the citation desk—all arranged around
                the manuscript like editors leaning over a light table.
              </p>

              <blockquote>
                <p>
                  A blank page is not freedom. It is the absence of context.
                </p>
              </blockquote>

              <p>
                This is why we begin with a dossier. Before the first sentence,
                the room knows what the piece is for, who it must convince, and
                what standard it will be held to. Every paragraph that follows
                has somewhere to point. The page is never empty; it is simply
                waiting for the right words.
              </p>
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <aside class="hidden md:flex flex-shrink-0 w-72 lg:w-80 border-l-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper-2)] flex-col">
          <div class="border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
            <div class="flex">
              {panelTabs.map((tab) => {
                const active = tab.id === "personas";
                return (
                  <div
                    key={tab.id}
                    class="flex-1 px-1.5 py-2.5 text-center"
                    style={{
                      borderBottom: active
                        ? `3px solid ${tab.accent}`
                        : "3px solid transparent",
                      background: active ? "var(--color-paper)" : "transparent",
                    }}
                  >
                    <span
                      class="block text-[13px] leading-tight"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: active ? 600 : 500,
                        color: active
                          ? "var(--color-ink)"
                          : "var(--color-ink-light)",
                      }}
                    >
                      {tab.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            <div class="space-y-3">
              {demoPersonas.map((p) => (
                <div
                  key={p.id}
                  class="flex items-center gap-3 p-3 border border-[var(--color-paper-3)] bg-[var(--color-paper)] hover:shadow-[0_6px_14px_-10px_rgba(31,27,22,0.3)] hover:-translate-y-px transition-all cursor-pointer"
                  style={{ borderRadius: "2px" }}
                >
                  <span
                    class="flex h-7 w-7 items-center justify-center rounded-full text-xs shrink-0"
                    style={{
                      color: p.color,
                      background: "var(--color-paper-soft)",
                      border: `1px solid ${p.color}`,
                    }}
                  >
                    {p.icon}
                  </span>
                  <div class="min-w-0">
                    <p
                      class="text-sm text-[var(--color-ink)]"
                      style={{
                        fontFamily: "var(--font-display)",
                        fontWeight: 600,
                      }}
                    >
                      {p.name}
                    </p>
                    <p class="text-[11px] text-[var(--color-ink-muted)] mt-0.5">
                      {p.role}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div class="mt-5 p-3 border border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
              <p class="dept-label" style="color: var(--color-vermilion);">
                The Skeptic, on ¶2
              </p>
              <p
                class="mt-2 text-xs leading-5 text-[var(--color-ink-light)]"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}
              >
                "You claim the city dictates its own grammar. Where on the page
                is the evidence? Give me one street, one hour, one overheard
                sentence."
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
});
