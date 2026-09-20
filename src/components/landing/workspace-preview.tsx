import { $, component$, useSignal, type PropFunction } from "@qwik.dev/core";
import { BOARD_TABS } from "../editorial-board/board-tabs";
import { PERSONAS } from "../../utils/personas";
import { editorialDateline, folioNumeral } from "../../utils/editorial-format";
import { SPINE_CRITERIA } from "../../types";
import type { PanelId } from "../../utils/panel-activity";
import type { ProjectBrief } from "../../types";
import { ProjectBriefCard } from "../brief/project-brief-card";

export interface WorkspacePreviewProps {
  /** Which board tab the right rail opens on. Defaults to "personas". */
  initialTab?: PanelId;
  /** Which folio the manuscript opens on. Defaults to the first folio. */
  initialFolioId?: string;
  /** Whether the left drawer starts open. Defaults to true. */
  drawerOpen?: boolean;
  /** Whether the right board starts open. Defaults to true. */
  panelOpen?: boolean;
  /**
   * Controlled board tab. When given, the preview follows it and reports
   * tab clicks through `onTabChange$` instead of switching itself — which
   * is what lets the landing tour keep its reader card in step.
   */
  tab?: PanelId;
  /** Controlled folio. See `tab`. */
  folioId?: string;
  /** Controlled drawer. See `tab`. */
  drawer?: boolean;
  /** Controlled board panel. See `tab`. */
  panel?: boolean;
  onTabChange$?: PropFunction<(tab: PanelId) => void>;
  onFolioChange$?: PropFunction<(folioId: string) => void>;
  onDrawerChange$?: PropFunction<(open: boolean) => void>;
  onPanelChange$?: PropFunction<(open: boolean) => void>;
}

const noopInterview = $(() => {});

/**
 * The filed dossier the drawer shows. Rendered through the real
 * `ProjectBriefCard`, so the preview's brief can never drift from the
 * editor's — a field added to the card shows up here for free.
 */
const PREVIEW_BRIEF: ProjectBrief = {
  answers: {
    workingTitle: "The City is a Sentence",
    format: "Essay",
    audience: "Curious urbanists",
    goal: "Show how a city teaches its own grammar to anyone who stays still long enough to listen.",
    tone: "Unhurried, concrete, quietly insistent",
    constraints: "Name real streets; no invented statistics.",
    successSignal:
      "A reader walks a familiar block and hears the sentence in it.",
  },
  attachments: [
    {
      id: "preview-ref-1",
      kind: "link",
      title: "Urban Libraries Council data",
      url: "https://example.com/library-data",
      why: "The national usage baseline.",
      addedAt: Date.UTC(2026, 3, 20, 14, 0),
    },
  ],
  probes: [
    {
      id: "preview-probe-1",
      kind: "choice",
      prompt: "Which street carries the opening?",
      options: ["Queen Street", "The side streets", "The boulevard"],
      answer: "Queen Street",
      relatesTo: "goal",
    },
    {
      id: "preview-probe-2",
      kind: "scale",
      prompt: "How prescriptive should the close be?",
      min: 1,
      max: 5,
      minLabel: "Suggestive",
      maxLabel: "Prescriptive",
      answer: 4,
      relatesTo: "tone",
    },
  ],
  completedAt: Date.UTC(2026, 3, 20, 13, 0),
  updatedAt: Date.UTC(2026, 3, 26, 9, 41),
};

/** Persona notes for the Cast tab, in each editor's own manner. */
const PREVIEW_PERSONA_NOTES: Record<string, { anchor: string; note: string }> =
  {
    devil: {
      anchor: "on ¶2",
      note: "\u201CThe city dictates its own grammar.\u201D This sentence assumes the reader already agrees. They do not. One street, one hour, one overheard sentence \u2014 or strike it.",
    },
    angel: {
      anchor: "on ¶4",
      note: "Here \u2014 the sleeping man, his coat folded into a pillow. This is the passage with a pulse. Open the chapter here, and let everything else be jealous of it.",
    },
    scholar: {
      anchor: "on the epigraph",
      note: "\u201CThe only room left\u201D is asserted, not demonstrated. The community centres are still open. A qualifier, a denominator, and a date are owed.",
    },
    editor: {
      anchor: "on ¶3",
      note: "\u201CIn order to\u201D \u2192 \u201Cto\u201D. Paragraph two echoes paragraph one. Pick the stronger and cut the other.",
    },
    reader: {
      anchor: "on ¶1",
      note: "I followed you for two paragraphs, then the margin passage lost me. Tell me earlier what the dossier is for and I will stay with you.",
    },
  };

function personaById(id: string) {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

/**
 * The Cast as the room actually staffs it — names, roles, colors, and
 * marks come straight from `PERSONAS`, so a renamed or restaffed editor
 * shows up here without anyone remembering the preview exists.
 */
export const PREVIEW_PERSONAS = PERSONAS.map((p) => ({
  id: p.id,
  name: p.name,
  role: p.role,
  color: p.color,
  icon: p.icon,
  ...PREVIEW_PERSONA_NOTES[p.id],
}));

const demoFolios = [
  {
    id: "folio-1",
    numeral: `Folio ${folioNumeral(0)}`,
    name: "Current draft",
    dossierTitle: "The City is a Sentence",
    heading: "The City Receives You",
    dropCap: "T",
    blocks: [
      {
        lead: "he city receives you before you arrive. You feel it in the tilt of the light, the way shopkeepers arrange their windows, the particular silence of a side street at dusk. Every neighbourhood is a paragraph; every boulevard a long sentence winding toward some punctuation you cannot yet see.",
      },
      {
        lead: null,
        text: "To write about a place is to argue with it. The buildings resist metaphor. The traffic ignores your symbolism. And yet\u2014if you sit still long enough\u2014the city begins to dictate its own grammar. You become less an author than a stenographer, recording what was already there.",
      },
    ],
    subheading: "The Margin as Method",
    tail: [
      "The best drafts are not composed in isolation. They are written in the margins of other books, in the pauses between conversations, in the white space that surrounds another person's argument. Twyne keeps that margin visible: the brief, the cast, the apparatus, the citation desk\u2014all arranged around the manuscript like editors leaning over a light table.",
      "A blank page is not freedom. It is the absence of context.",
      "This is why we begin with a dossier. Before the first sentence, the room knows what the piece is for, who it must convince, and what standard it will be held to. Every paragraph that follows has somewhere to point. The page is never empty; it is simply waiting for the right words.",
    ],
  },
  {
    id: "folio-2",
    numeral: `Folio ${folioNumeral(1)}`,
    name: "Research notes",
    dossierTitle: "The City is a Sentence",
    heading: "Field Notes, April",
    dropCap: "Q",
    blocks: [
      {
        lead: "ueen Street branch, 8pm: tables full of people who are not, strictly speaking, reading. Teenagers finish problem sets. A newcomer rehearses an interview script under her breath. An older man sleeps sitting up, his coat folded into a pillow.",
      },
      {
        lead: null,
        text: "None of this appears in the budget line called circulation. Ask at the desk for the door counts \u2014 the room keeps filling while the line keeps shrinking.",
      },
    ],
    subheading: "To verify",
    tail: [
      "Community-centre comparison for the \u201Conly room left\u201D claim. Door-count series, 2022\u20132026. The Smith 2019 formulation the Scholar flagged.",
    ],
  },
  {
    id: "folio-3",
    numeral: `Folio ${folioNumeral(2)}`,
    name: "Chapter outlines",
    dossierTitle: "The City is a Sentence",
    heading: "A Shape for the Piece",
    dropCap: "F",
    blocks: [
      {
        lead: "irst the arrival: light, windows, the side street at dusk. Then the argument: the buildings resist metaphor, and that resistance is the point. Close with the dossier \u2014 the page was never empty, only waiting.",
      },
      {
        lead: null,
        text: "Cut the third anecdote if the chapter runs long. The sleeping man stays; the parking dispute goes.",
      },
    ],
    subheading: "Open questions",
    tail: [
      "Where does the margin passage land \u2014 section two or three? Which street carries the evidence Sceptique asked for?",
    ],
  },
];

export const PREVIEW_FOLIO_IDS = demoFolios.map((f) => f.id);

/**
 * The Rubric tab grades four of the real spine criteria with canned marks.
 * Labels come from `SPINE_CRITERIA`, so a renamed criterion renames itself
 * here; the drift-guard test pins every id to a real spine entry.
 */
const PREVIEW_RUBRIC_MARKS: Record<
  string,
  { score: number; feedback: string }
> = {
  thesis: {
    score: 8,
    feedback: "The sentence holds; the target reader is named.",
  },
  structure: {
    score: 7,
    feedback: "The turn arrives a section early.",
  },
  evidence: {
    score: 6,
    feedback: "Thins in the final third \u2014 one street, one hour.",
  },
  sufficiency: {
    score: 6,
    feedback: "The case is started; the last corners are unserved.",
  },
};

const demoCriteria = (
  ["thesis", "structure", "evidence", "sufficiency"] as const
).map((id) => {
  const spec = SPINE_CRITERIA.find((c) => c.id === id) ?? SPINE_CRITERIA[0];
  return { id, label: spec.label, ...PREVIEW_RUBRIC_MARKS[id] };
});

export const PREVIEW_CRITERION_IDS = demoCriteria.map((c) => c.id);

const demoNotes = [
  {
    persona: personaById("devil"),
    anchor: "¶2",
    note: "\u201CThe city dictates its own grammar\u201D \u2014 have you shown a single street doing it? The claim needs a qualifier or a scene.",
  },
  {
    persona: personaById("reader"),
    anchor: "¶4",
    note: "The sleeping man stays with me. Open the chapter here, not on the budget line.",
  },
];

const demoSources = [
  {
    kind: "Web",
    accent: "var(--color-cobalt)",
    title: "Urban Libraries Council \u2014 2024 usage data",
    detail: "council.libraries.example \u00B7 captured Aug 12",
    status: "Verified",
    ok: true,
  },
  {
    kind: "DOI",
    accent: "var(--color-sage)",
    title: "10.1353/lib.2023.0041 \u2014 The library as third place",
    detail: "Journal of Civic Infrastructure \u00B7 matches citation",
    status: "Verified",
    ok: true,
  },
  {
    kind: "Footnote",
    accent: "var(--color-mustard)",
    title: "Smith 2019, p. 142 \u2014 original formulation",
    detail: "Quoted wording differs from the manuscript",
    status: "Needs review",
    ok: false,
  },
];

const demoVersions = [
  {
    rev: "Rev. 12",
    when: "Today, 9:41",
    words: "1,842 words",
    note: "Gave ¶2 its street and its hour.",
    current: true,
  },
  {
    rev: "Rev. 11",
    when: "Yesterday, 22:07",
    words: "1,796 words",
    note: "Cut the parking dispute; kept the sleeping man.",
    current: false,
  },
  {
    rev: "Rev. 10",
    when: "Tuesday, 18:52",
    words: "1,803 words",
    note: "First pass with the full cast reading along.",
    current: false,
  },
];

/**
 * A clickable mock of the writer's room: the Drawer of folios on the left,
 * the manuscript in the centre, and the Editorial Board on the right. Every
 * tab, folio, persona, and rail toggle works — all against canned data, with
 * no providers and no network.
 *
 * Drift discipline: the board tabs (`BOARD_TABS`), the cast (`PERSONAS`),
 * the dateline, the folio numerals, the dossier card (`ProjectBriefCard`),
 * and the rubric labels (`SPINE_CRITERIA`) are the same sources the live
 * editor renders. See `workspace-drift.test.ts`, which pins the rest.
 */
export const WorkspacePreview = component$<WorkspacePreviewProps>(
  ({
    initialTab,
    initialFolioId,
    drawerOpen,
    panelOpen,
    tab,
    folioId,
    drawer,
    panel,
    onTabChange$,
    onFolioChange$,
    onDrawerChange$,
    onPanelChange$,
  }) => {
    const fallbackTab = useSignal<PanelId>(initialTab ?? "personas");
    const fallbackFolioId = useSignal(initialFolioId ?? demoFolios[0].id);
    const fallbackDrawer = useSignal(drawerOpen ?? true);
    const fallbackPanel = useSignal(panelOpen ?? true);
    const selectedPersonaId = useSignal(PREVIEW_PERSONAS[0].id);

    const currentTab = tab ?? fallbackTab.value;
    const currentFolioId = folioId ?? fallbackFolioId.value;
    const drawerNow = drawer ?? fallbackDrawer.value;
    const panelNow = panel ?? fallbackPanel.value;

    const selectTab = $(async (next: PanelId) => {
      if (onTabChange$) await onTabChange$(next);
      else fallbackTab.value = next;
    });
    const selectFolio = $(async (next: string) => {
      if (onFolioChange$) await onFolioChange$(next);
      else fallbackFolioId.value = next;
    });
    const selectDrawer = $(async (next: boolean) => {
      if (onDrawerChange$) await onDrawerChange$(next);
      else fallbackDrawer.value = next;
    });
    const selectPanel = $(async (next: boolean) => {
      if (onPanelChange$) await onPanelChange$(next);
      else fallbackPanel.value = next;
    });

    const folio =
      demoFolios.find((f) => f.id === currentFolioId) ?? demoFolios[0];
    const persona =
      PREVIEW_PERSONAS.find((p) => p.id === selectedPersonaId.value) ??
      PREVIEW_PERSONAS[0];
    const activeTabMeta = BOARD_TABS.find((t) => t.id === currentTab);

    return (
      <div class="w-full h-full flex flex-col overflow-hidden rounded-[4px] border-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper)] shadow-[0_30px_80px_-40px_rgba(31,27,22,0.35)] text-left">
        {/* ── Masthead ─────────────────────────────────────── */}
        <header class="flex-shrink-0 border-b-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper)]">
          <div class="flex items-center px-4 pt-3 pb-1.5 gap-3">
            <button
              class="p-1.5 text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)] focus-ring"
              title={drawerNow ? "Close the drawer" : "Open the drawer"}
              aria-label="Toggle the drawer sidebar"
              aria-expanded={drawerNow}
              aria-pressed={drawerNow}
              onClick$={() => {
                selectDrawer(!drawerNow);
              }}
            >
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
              <p class="dept-label">An Anti-Tabula-Rasa Quarterly</p>
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
                {editorialDateline()}
              </p>
            </div>

            <div class="flex items-center gap-2">
              <span class="btn-paper hidden sm:inline-flex text-[0.65rem]">
                Refine the dossier
              </span>
              <span
                class="p-1.5 text-[var(--color-ink-light)]"
                aria-hidden="true"
              >
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
              </span>
              <button
                class="p-1.5 text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)] focus-ring"
                title={panelNow ? "Close the board" : "Open the board"}
                aria-label="Toggle the editorial board panel"
                aria-expanded={panelNow}
                aria-pressed={panelNow}
                onClick$={() => {
                  selectPanel(!panelNow);
                }}
              >
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
          {drawerNow && (
            <aside class="flex flex-shrink-0 w-64 md:w-72 border-r-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper-2)] flex-col max-md:hidden">
              <div class="px-4 py-3 border-b border-[var(--color-paper-3)]">
                <p class="dept-label">Drawer No. III</p>
                <h2
                  class="mt-1 text-xl text-[var(--color-ink)]"
                  style="font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em;"
                >
                  Pieces in Progress
                </h2>
              </div>

              <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                <ProjectBriefCard
                  brief={PREVIEW_BRIEF}
                  onStartInterview$={noopInterview}
                />

                <div
                  class="ornament-divider"
                  style="font-family: var(--font-display);"
                >
                  ❦
                </div>

                <div class="space-y-1" role="listbox" aria-label="Folios">
                  {demoFolios.map((f) => {
                    const selected = f.id === folio.id;
                    return (
                      <button
                        key={f.id}
                        role="option"
                        aria-selected={selected}
                        class={`w-full text-left px-3 py-2 border-l-4 text-sm focus-ring ${
                          selected
                            ? "border-[var(--color-vermilion)] bg-[var(--color-paper-soft)] text-[var(--color-ink)]"
                            : "border-transparent hover:bg-[var(--color-paper-soft)] text-[var(--color-ink-light)]"
                        }`}
                        style="font-family: var(--font-serif);"
                        onClick$={() => {
                          selectFolio(f.id);
                        }}
                      >
                        <span class="dept-label block">{f.numeral}</span>
                        {f.name}
                      </button>
                    );
                  })}
                </div>

                <div
                  class="ornament-divider"
                  style="font-family: var(--font-display);"
                >
                  ❦
                </div>

                <div class="space-y-1">
                  {[
                    {
                      kicker: "Room of Editors",
                      label: "Manage editorial staff",
                    },
                    { kicker: "The Library", label: "All documents" },
                    { kicker: "Galley Proof", label: "Full rubric report" },
                  ].map((row) => (
                    <div
                      key={row.kicker}
                      class="w-full text-left px-3 py-2 text-sm text-[var(--color-ink-light)]"
                      style="font-family: var(--font-serif);"
                    >
                      <span class="dept-label block">{row.kicker}</span>
                      {row.label}
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          )}

          {/* Editor Canvas */}
          <div class="flex-1 bg-[var(--color-editor-bg)] overflow-auto twyne-editor">
            <div class="max-w-[680px] mx-auto px-6 py-8 md:px-10 md:py-12">
              <div class="ProseMirror" key={folio.id}>
                <h1>{folio.heading}</h1>

                {folio.blocks.map((block, i) =>
                  block.lead !== null && block.lead !== undefined ? (
                    <p key={i}>
                      <span class="float-left text-[4.2em] leading-[0.85] mr-3 mt-[0.08em] font-display font-bold text-[var(--color-vermilion)]">
                        {folio.dropCap}
                      </span>
                      {block.lead}
                    </p>
                  ) : (
                    <p key={i}>{block.text}</p>
                  ),
                )}

                <h2>{folio.subheading}</h2>

                {folio.tail.map((paragraph, i) =>
                  i === 1 && folio.id === "folio-1" ? (
                    <blockquote key={i}>
                      <p>{paragraph}</p>
                    </blockquote>
                  ) : (
                    <p key={i}>{paragraph}</p>
                  ),
                )}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          {panelNow ? (
            <aside class="flex flex-shrink-0 w-72 lg:w-80 border-l-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper-2)] flex-col max-md:hidden">
              <div
                class="border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
                role="tablist"
                aria-label="Editorial board"
              >
                <div class="flex">
                  {BOARD_TABS.map((tab) => {
                    const selected = tab.id === currentTab;
                    return (
                      <button
                        key={tab.id}
                        role="tab"
                        aria-selected={selected}
                        title={tab.kicker}
                        class="flex-1 px-1.5 py-2.5 text-center focus-ring"
                        style={{
                          borderBottom: selected
                            ? `3px solid ${tab.accent}`
                            : "3px solid transparent",
                          background: selected
                            ? "var(--color-paper)"
                            : "transparent",
                        }}
                        onClick$={() => {
                          selectTab(tab.id);
                        }}
                      >
                        <span
                          class="block text-[13px] leading-tight"
                          style={{
                            fontFamily: "var(--font-display)",
                            fontWeight: selected ? 600 : 500,
                            color: selected
                              ? "var(--color-ink)"
                              : "var(--color-ink-light)",
                          }}
                        >
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div class="flex-1 overflow-y-auto p-4">
                {currentTab === "personas" && (
                  <div class="space-y-3">
                    {PREVIEW_PERSONAS.map((p) => {
                      const selected = p.id === persona.id;
                      return (
                        <button
                          key={p.id}
                          aria-pressed={selected}
                          class={`w-full flex items-center gap-3 p-3 border bg-[var(--color-paper)] text-left transition-all focus-ring ${
                            selected
                              ? "border-[var(--color-ink)] shadow-[0_6px_14px_-10px_rgba(31,27,22,0.3)]"
                              : "border-[var(--color-paper-3)] hover:shadow-[0_6px_14px_-10px_rgba(31,27,22,0.3)] hover:-translate-y-px"
                          }`}
                          style={{ borderRadius: "2px" }}
                          onClick$={() => {
                            selectedPersonaId.value = p.id;
                          }}
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
                          <span class="min-w-0">
                            <span
                              class="block text-sm text-[var(--color-ink)]"
                              style={{
                                fontFamily: "var(--font-display)",
                                fontWeight: 600,
                              }}
                            >
                              {p.name}
                            </span>
                            <span class="block text-[11px] text-[var(--color-ink-muted)] mt-0.5">
                              {p.role}
                            </span>
                          </span>
                        </button>
                      );
                    })}

                    <div
                      class="mt-2 p-3 border border-dashed border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
                      key={persona.id}
                    >
                      <p class="dept-label" style={`color: ${persona.color};`}>
                        {persona.name}, {persona.anchor}
                      </p>
                      <p
                        class="mt-2 text-xs leading-5 text-[var(--color-ink-light)]"
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontStyle: "italic",
                        }}
                      >
                        {persona.note}
                      </p>
                    </div>
                  </div>
                )}

                {currentTab === "rubric" && (
                  <div class="space-y-3">
                    <div class="index-card p-3 flex items-center gap-3">
                      <span
                        class="flex h-11 w-11 items-center justify-center text-lg shrink-0"
                        style="font-family: var(--font-display); font-weight: 700; color: var(--color-paper); background: var(--color-vermilion); border-radius: 2px;"
                      >
                        B+
                      </span>
                      <div class="min-w-0">
                        <p
                          class="text-sm text-[var(--color-ink)]"
                          style={{
                            fontFamily: "var(--font-display)",
                            fontWeight: 600,
                          }}
                        >
                          84 of 100
                        </p>
                        <p class="text-[11px] text-[var(--color-ink-muted)] mt-0.5">
                          Thesis holds; evidence thins in the final third.
                        </p>
                      </div>
                    </div>
                    {demoCriteria.map((criterion) => (
                      <div
                        key={criterion.id}
                        class="p-3 border border-[var(--color-paper-3)] bg-[var(--color-paper)]"
                        style={{ borderRadius: "2px" }}
                      >
                        <div class="flex items-baseline justify-between gap-2">
                          <p
                            class="text-[13px] text-[var(--color-ink)]"
                            style={{
                              fontFamily: "var(--font-display)",
                              fontWeight: 600,
                            }}
                          >
                            {criterion.label}
                          </p>
                          <p
                            class="text-[11px] text-[var(--color-ink-muted)] shrink-0"
                            style="font-family: var(--font-typewriter);"
                          >
                            {criterion.score}/10
                          </p>
                        </div>
                        <div
                          class="mt-2 h-1.5 bg-[var(--color-paper-soft)]"
                          role="img"
                          aria-label={`${criterion.label}: ${criterion.score} of 10`}
                        >
                          <div
                            class="h-full"
                            style={`width: ${criterion.score * 10}%; background: var(--color-cobalt);`}
                          />
                        </div>
                        <p
                          class="mt-2 text-[11px] leading-4 text-[var(--color-ink-light)]"
                          style="font-family: var(--font-serif);"
                        >
                          {criterion.feedback}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {currentTab === "comments" && (
                  <div class="space-y-2">
                    {demoNotes.map((entry) => (
                      <article
                        key={entry.persona.id}
                        class="border-l-2 bg-[var(--color-paper-soft)] px-3 py-2"
                        style={`border-color: ${entry.persona.color};`}
                      >
                        <p
                          class="text-[0.62rem] tracking-[0.14em] uppercase"
                          style={`font-family: var(--font-typewriter); color: ${entry.persona.color};`}
                        >
                          {entry.persona.icon} {entry.persona.name} ·{" "}
                          {entry.anchor}
                        </p>
                        <p
                          class="mt-1 text-[0.8rem] leading-[1.5] text-[var(--color-ink-light)]"
                          style="font-family: var(--font-serif);"
                        >
                          {entry.note}
                        </p>
                      </article>
                    ))}
                    <div class="mt-3 flex items-center gap-3 border-t border-dotted border-[var(--color-ink-muted)] pt-3">
                      <span
                        class="flex h-9 w-9 items-center justify-center text-sm shrink-0"
                        style="font-family: var(--font-display); font-weight: 700; color: var(--color-paper); background: var(--color-vermilion); border-radius: 2px;"
                      >
                        B+
                      </span>
                      <p
                        class="text-[0.72rem] leading-[1.5] text-[var(--color-ink-muted)]"
                        style="font-family: var(--font-serif);"
                      >
                        Thesis holds; evidence thins in the final third. 84 of
                        100.
                      </p>
                    </div>
                  </div>
                )}

                {currentTab === "citations" && (
                  <div>
                    <p class="dept-label">The Apparatus · 3 records</p>
                    <ul class="mt-3 space-y-2">
                      {demoSources.map((source) => (
                        <li
                          key={source.title}
                          class="flex items-start gap-3 border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2.5"
                        >
                          <span
                            class="mt-0.5 shrink-0 px-1.5 py-0.5 text-[0.6rem] tracking-[0.12em] uppercase text-[var(--color-paper)]"
                            style={`font-family: var(--font-typewriter); background: ${source.accent};`}
                          >
                            {source.kind}
                          </span>
                          <span class="min-w-0 flex-1">
                            <span
                              class="block truncate text-[0.82rem] font-semibold text-[var(--color-ink)]"
                              style="font-family: var(--font-display);"
                            >
                              {source.title}
                            </span>
                            <span
                              class="block truncate text-[0.72rem] text-[var(--color-ink-muted)]"
                              style="font-family: var(--font-serif);"
                            >
                              {source.detail}
                            </span>
                          </span>
                          <span
                            class="shrink-0 text-[0.7rem] font-semibold"
                            style={`font-family: var(--font-typewriter); color: ${source.ok ? "var(--color-sage)" : "var(--color-vermilion)"};`}
                          >
                            {source.ok ? "✓" : "✕"} {source.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {currentTab === "history" && (
                  <div>
                    <p class="dept-label">Version history · 3 revisions</p>
                    <ol class="mt-3 space-y-2">
                      {demoVersions.map((version) => (
                        <li
                          key={version.rev}
                          class={`p-3 border bg-[var(--color-paper)] ${
                            version.current
                              ? "border-[var(--color-ink)]"
                              : "border-[var(--color-paper-3)]"
                          }`}
                          style={{ borderRadius: "2px" }}
                        >
                          <div class="flex items-baseline justify-between gap-2">
                            <p
                              class="text-[13px] text-[var(--color-ink)]"
                              style={{
                                fontFamily: "var(--font-display)",
                                fontWeight: 600,
                              }}
                            >
                              {version.rev}
                            </p>
                            {version.current && (
                              <span class="stamp">Current</span>
                            )}
                          </div>
                          <p
                            class="mt-1 text-[11px] text-[var(--color-ink-muted)]"
                            style="font-family: var(--font-typewriter);"
                          >
                            {version.when} · {version.words}
                          </p>
                          <p
                            class="mt-1.5 text-[12px] leading-5 text-[var(--color-ink-light)]"
                            style="font-family: var(--font-serif);"
                          >
                            {version.note}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <p
                  class="mt-4 text-center text-[10px] tracking-[0.14em] uppercase text-[var(--color-ink-muted)]"
                  style="font-family: var(--font-typewriter);"
                >
                  {activeTabMeta?.numeral} · {activeTabMeta?.kicker}
                </p>
              </div>
            </aside>
          ) : (
            <div class="flex-shrink-0 w-10 border-l-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper-2)] items-stretch py-3 max-md:hidden flex">
              <button
                class="flex-1 text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)] focus-ring text-xs"
                style="writing-mode: vertical-rl; font-family: var(--font-typewriter); letter-spacing: 0.18em;"
                title="Open the board"
                aria-label="Open the editorial board panel"
                onClick$={() => {
                  selectPanel(true);
                }}
              >
                THE BOARD ✦
              </button>
            </div>
          )}
        </div>
      </div>
    );
  },
);
