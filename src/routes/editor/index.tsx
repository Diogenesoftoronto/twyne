import { component$, $, useStore, useVisibleTask$ } from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { Link, useNavigate } from "@builder.io/qwik-city";
import { ProjectBriefCard } from "../../components/brief/project-brief-card";
import { AuthPanel } from "../../components/auth/auth-panel";
import { FolioMenu } from "../../components/folio/folio-menu";
import type { ProjectBrief, Folio } from "../../types";
import {
  loadDraftHtml,
  loadProjectBrief,
  saveDraftHtml,
} from "../../utils/anti-tabula-rasa";
import {
  clearIdbStore,
  loadFoliosFromIdb,
  loadActiveFolioIdFromIdb,
  loadFolioContentFromIdb,
  saveFoliosToIdb,
  saveActiveFolioIdToIdb,
  saveFolioContentToIdb,
  loadMetaFromIdb,
  saveMetaToIdb,
} from "../../utils/idb";
import { useAuth } from "../../utils/auth-context";
import { clearUserComments } from "../../utils/user-comments";
import { TwyneEditor } from "../../components/editor/twyne-editor";
import { ShareDialog } from "../../components/collaboration/share-dialog";
import { PersonasPanel } from "../../components/personas/personas-panel";
import { RubricPanel } from "../../components/rubric/rubric-panel";
import { CommentsPanel } from "../../components/comments/comments-panel";
import { CitationsPanel } from "../../components/citations/citations-panel";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import { markDirty } from "../../utils/convex-sync";
import {
  startBackgroundResearch,
  stopBackgroundResearch,
  kickBackgroundResearch,
  onDraftChanged,
} from "../../utils/background-research";

type RightPanel = "personas" | "rubric" | "comments" | "citations";

interface PanelTab {
  id: RightPanel;
  /** Section number on the masthead, e.g. "I" */
  numeral: string;
  /** Departmental name */
  label: string;
  /** Sub-line under the label */
  kicker: string;
  /** CSS color variable for the tab's accent */
  accent: string;
}

interface LayoutStore {
  rightPanel: RightPanel;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  hydrated: boolean;
  brief: ProjectBrief | null;
  editorSeed: string;
  authOpen: boolean;
  folios: Folio[];
  activeFolioId: string | null;
  folioKey: number;
  rightPanelWidth: number;
  // Inline form states (replace native prompts/confirms)
  newFolioFormOpen: boolean;
  confirmNukeOpen: boolean;
  /** Whether the "you're working locally" sign-in nudge has been dismissed. */
  signInToastDismissed: boolean;
  /** When set, the editor joins a multiplayer session. */
  sharedLixId: string | null;
  /** True while joining a shared document is in progress. */
  joiningShared: boolean;
  /** Error message if joining failed. */
  joinError: string | null;
}

/* ────────────────────────────────────────────────────────────────
 *  Editorial dateline — formatted like a print magazine masthead.
 *  e.g. "Vol. I · No. 117 · Sunday, the 26th of April, 2026"
 * ──────────────────────────────────────────────────────────────── */
function editorialDateline(now = new Date()): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const day = now.getDate();
  const ordinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = (now.getTime() - start.getTime()) / 86400000;
  const dayOfYear = Math.floor(diff);
  return `Vol. I · No. ${dayOfYear} · ${days[now.getDay()]}, the ${ordinal(day)} of ${months[now.getMonth()]}, ${now.getFullYear()}`;
}

/**
 * The writer's room — the full editorial desk: the Drawer of folios on
 * the left, the manuscript in the centre, and the Editorial Board (Cast,
 * Rubric, Marginalia, Apparatus) on the right. The Apparatus runs research
 * agents in the background, debounced on the draft.
 *
 * First-run onboarding lives at /onboarding; dossier refinement at
 * /refining. This route owns the workspace and migrates the legacy
 * single-draft key into Folio I on first load.
 */
export default component$(() => {
  const nav = useNavigate();
  const clientSig = useConvexClient();
  const auth = useAuth();
  const store = useStore<LayoutStore>({
    rightPanel: "personas",
    leftSidebarOpen: false,
    rightPanelOpen: true,
    hydrated: false,
    brief: null,
    editorSeed: "",
    authOpen: false,
    folios: [],
    activeFolioId: null,
    folioKey: 0,
    rightPanelWidth: 340,
    newFolioFormOpen: false,
    confirmNukeOpen: false,
    // Default true to avoid a flash before the meta flag loads.
    signInToastDismissed: true,
    sharedLixId: null,
    joiningShared: false,
    joinError: null,
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    (async () => {
      const brief = loadProjectBrief();
      const folios = await loadFoliosFromIdb();
      const activeFolioId = await loadActiveFolioIdFromIdb();

      // No dossier yet → the writer belongs in onboarding first.
      if (!brief && folios.length === 0) {
        void nav("/onboarding/");
        return;
      }

      // Migration: old storage had a single draft. If we have a brief but no
      // folios, create a Folio I from the legacy draft key.
      if (brief && folios.length === 0) {
        const legacyDraft = loadDraftHtml();
        const draftFolio: Folio = {
          id: crypto.randomUUID(),
          name: brief.answers.workingTitle || "Current draft",
          type: "draft",
          createdAt: brief.completedAt,
          updatedAt: Date.now(),
        };
        await saveFoliosToIdb([draftFolio]);
        await saveFolioContentToIdb(draftFolio.id, legacyDraft);
        await saveActiveFolioIdToIdb(draftFolio.id);
        saveDraftHtml(legacyDraft);
        store.folios = [draftFolio];
        store.activeFolioId = draftFolio.id;
        store.editorSeed = legacyDraft;
        markDirty();
      } else if (folios.length > 0) {
        store.folios = folios;
        store.activeFolioId = activeFolioId ?? folios[0].id;
        store.editorSeed = await loadFolioContentFromIdb(store.activeFolioId);
        saveDraftHtml(store.editorSeed);
      }

      store.brief = brief;
      store.hydrated = true;

      // Surface the local-only sign-in nudge unless it was dismissed before.
      const dismissed = await loadMetaFromIdb<boolean>(
        "signin-toast-dismissed",
      );
      store.signInToastDismissed = dismissed === true;

      // Arriving from the landing "Sign in" link → open the auth panel.
      if (new URLSearchParams(window.location.search).get("auth") === "1") {
        store.authOpen = true;
      }

      // Arriving via a shared-document invite link (?shared=<lixId>).
      const sharedId = new URLSearchParams(window.location.search).get(
        "shared",
      );
      if (sharedId && clientSig.value && auth.value.user) {
        store.joiningShared = true;
        store.joinError = null;
        try {
          const client = clientSig.value;
          // Accept pending invitation for this lixId (no-op if none).
          try {
            await client.mutation(api.collaboration.acceptInvitation, {
              lixId: sharedId,
            });
          } catch {
            // May have already accepted, or no pending invite — that's fine.
          }
          const meta = await client.query(api.collaboration.getSharedLixMeta, {
            lixId: sharedId,
          });
          if (meta) {
            const { joinSharedLix } = await import("../../utils/collaboration");
            await joinSharedLix(client, sharedId);
            store.sharedLixId = sharedId;
            store.activeFolioId = meta.folioId;
            store.editorSeed = "";
          } else {
            store.joinError = "You don't have access to this document.";
          }
        } catch (e: any) {
          store.joinError = e?.message ?? "Could not join the shared document.";
        } finally {
          store.joiningShared = false;
        }
      }
    })();

    // ── Save editor content to the active folio ──
    const contentHandler = (e: Event) => {
      const html = (e as CustomEvent).detail as string;
      saveDraftHtml(html);
      if (store.activeFolioId) {
        void saveFolioContentToIdb(store.activeFolioId, html);
        const idx = store.folios.findIndex((f) => f.id === store.activeFolioId);
        if (idx >= 0) {
          store.folios[idx].updatedAt = Date.now();
          void saveFoliosToIdb(store.folios);
        }
        markDirty();
      }
    };
    window.addEventListener("twyne:content", contentHandler);
    cleanup(() => window.removeEventListener("twyne:content", contentHandler));

    // ── Persist layout (width, margin, running header, page numbers) ──
    const layoutHandler = (e: Event) => {
      const next = (e as CustomEvent).detail;
      if (!next || !store.activeFolioId) return;
      const idx = store.folios.findIndex((f) => f.id === store.activeFolioId);
      if (idx < 0) return;
      store.folios[idx] = {
        ...store.folios[idx],
        layout: next,
        updatedAt: Date.now(),
      };
      void saveFoliosToIdb(store.folios);
      markDirty();
    };
    window.addEventListener("twyne:layout", layoutHandler);
    cleanup(() => window.removeEventListener("twyne:layout", layoutHandler));

    // ── Persist editable running header / footer text ──
    const headerHandler = (e: Event) => {
      const text = (e as CustomEvent).detail as string;
      if (!store.activeFolioId) return;
      const idx = store.folios.findIndex((f) => f.id === store.activeFolioId);
      if (idx < 0) return;
      store.folios[idx] = {
        ...store.folios[idx],
        header: text,
        updatedAt: Date.now(),
      };
      void saveFoliosToIdb(store.folios);
      markDirty();
    };
    const footerHandler = (e: Event) => {
      const text = (e as CustomEvent).detail as string;
      if (!store.activeFolioId) return;
      const idx = store.folios.findIndex((f) => f.id === store.activeFolioId);
      if (idx < 0) return;
      store.folios[idx] = {
        ...store.folios[idx],
        footer: text,
        updatedAt: Date.now(),
      };
      void saveFoliosToIdb(store.folios);
      markDirty();
    };
    window.addEventListener("twyne:header", headerHandler);
    window.addEventListener("twyne:footer", footerHandler);
    cleanup(() => window.removeEventListener("twyne:header", headerHandler));
    cleanup(() => window.removeEventListener("twyne:footer", footerHandler));

    // ── Background research: Apparatus agents run on the writer's
    //    behalf, debounced, watching the draft. ──
    const client = clientSig.value;
    if (client && store.activeFolioId) {
      startBackgroundResearch({
        client,
        brief: store.brief,
        folioId: store.activeFolioId,
      });
      // Kick an initial pass with the current draft (if any) so the
      // writer lands on a populated bibliography, not an empty one.
      void (async () => {
        const seed = await loadFolioContentFromIdb(store.activeFolioId!);
        const plain = (seed ?? "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (plain.length > 40) {
          kickBackgroundResearch(plain);
        }
      })();
    }
    const onDraftContent = (e: Event) => {
      const html = (e as CustomEvent).detail as string;
      const plain = html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      onDraftChanged(plain);
    };
    window.addEventListener("twyne:content", onDraftContent);

    // When the writer replies to an editor's note from the inline modal, the
    // Cast panel handles the thread. Reveal it so they see the reply land.
    const onPersonaReply = () => {
      store.rightPanel = "personas";
      store.rightPanelOpen = true;
    };
    window.addEventListener("twyne:persona-reply", onPersonaReply);

    cleanup(() => {
      stopBackgroundResearch();
      window.removeEventListener("twyne:content", onDraftContent);
      window.removeEventListener("twyne:persona-reply", onPersonaReply);
    });
  });

  const panelTabs: PanelTab[] = [
    {
      id: "personas",
      numeral: "I",
      label: "Cast",
      kicker: "Editors in residence",
      accent: "var(--color-vermilion)",
    },
    {
      id: "rubric",
      numeral: "II",
      label: "Rubric",
      kicker: "Dept. of Rigor",
      accent: "var(--color-cobalt)",
    },
    {
      id: "comments",
      numeral: "III",
      label: "Marginalia",
      kicker: "Notes in the margin",
      accent: "var(--color-mustard)",
    },
    {
      id: "citations",
      numeral: "IV",
      label: "Apparatus",
      kicker: "Sources & sourcerers",
      accent: "var(--color-periwinkle)",
    },
  ];
  const accountDisplay = auth.value.user
    ? auth.value.provider === "atproto"
      ? auth.value.user.email
      : auth.value.user.email || auth.value.user.name || "Signed in"
    : null;
  const accountTitle = accountDisplay
    ? `Signed in as ${accountDisplay}`
    : "Editor's office";

  if (!store.hydrated) {
    return (
      <div class="flex h-screen items-center justify-center bg-[var(--color-paper)] text-[var(--color-ink-muted)]">
        <div class="folio px-6 py-5 text-center">
          <p class="dept-label">Press Room</p>
          <p
            class="mt-2 font-display text-lg italic text-[var(--color-ink-light)]"
            style="font-family: var(--font-display);"
          >
            Setting the type…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div class="min-h-screen relative">
      {/* ── Local-only nudge: prompt sign-in so work follows across devices ── */}
      {!store.signInToastDismissed &&
        !auth.value.loading &&
        !auth.value.user && (
          <div
            role="status"
            class="fixed bottom-4 left-1/2 z-[60] w-[min(92vw,30rem)] -translate-x-1/2 border-2 border-[var(--color-ink)] bg-[var(--color-paper)] px-4 py-3 shadow-[0_14px_36px_rgba(0,0,0,0.28)]"
            style="border-radius: 4px;"
          >
            <div class="flex items-start gap-3">
              <span
                class="mt-0.5 text-lg leading-none text-[var(--color-vermilion)]"
                style="font-family: var(--font-display);"
                aria-hidden="true"
              >
                ❦
              </span>
              <div class="flex-1 min-w-0">
                <p
                  class="text-[13px] leading-5 text-[var(--color-ink)]"
                  style="font-family: var(--font-serif);"
                >
                  You're writing locally. This draft won't be available on your
                  other devices until you sign in.
                </p>
                <div class="mt-2 flex items-center gap-3">
                  <button
                    onClick$={$(() => {
                      store.authOpen = true;
                      store.signInToastDismissed = true;
                      void saveMetaToIdb("signin-toast-dismissed", true);
                    })}
                    class="btn-press"
                  >
                    Sign in
                  </button>
                  <button
                    onClick$={$(() => {
                      store.signInToastDismissed = true;
                      void saveMetaToIdb("signin-toast-dismissed", true);
                    })}
                    class="text-[11px] tracking-[0.16em] uppercase text-[var(--color-ink-light)] hover:text-[var(--color-ink)] focus-ring"
                    style="font-family: var(--font-typewriter);"
                  >
                    Not now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      <div class="flex h-screen bg-[var(--color-paper)] overflow-hidden">
        {/* ── The Drawer (left sidebar) ──────────────────────── */}
        <aside
          class={`sidebar-transition flex-shrink-0 border-r-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper-2)] ${
            store.leftSidebarOpen ? "w-72" : "w-0"
          } overflow-hidden`}
        >
          <div class="w-72 h-full flex flex-col">
            <div class="px-5 py-4 border-b border-[var(--color-paper-3)]">
              <p class="dept-label">Drawer No. III</p>
              <h2
                class="mt-1 text-2xl text-[var(--color-ink)]"
                style="font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em;"
              >
                Pieces in Progress
              </h2>
            </div>

            <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <ProjectBriefCard
                brief={store.brief}
                onStartInterview$={$(() => {
                  void nav("/refining/");
                })}
              />

              <div
                class="ornament-divider"
                style="font-family: var(--font-display);"
              >
                ❦
              </div>

              <div class="space-y-1">
                {store.folios.map((folio, idx) => {
                  const active = store.activeFolioId === folio.id;
                  return (
                    <button
                      key={folio.id}
                      class={`w-full text-left px-3 py-2.5 text-sm focus-ring ${
                        active
                          ? "border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] font-medium text-[var(--color-ink)]"
                          : "border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)]"
                      }`}
                      style="font-family: var(--font-serif); border-radius: 2px;"
                      onClick$={$(async () => {
                        if (active) return;
                        const content = await loadFolioContentFromIdb(folio.id);
                        store.activeFolioId = folio.id;
                        store.editorSeed = content;
                        store.folioKey += 1;
                        saveDraftHtml(content);
                        void saveActiveFolioIdToIdb(folio.id);
                        window.dispatchEvent(
                          new CustomEvent("twyne:load-folio", {
                            detail: content,
                          }),
                        );
                      })}
                    >
                      <span class="dept-label block">
                        Folio{" "}
                        {[
                          "I",
                          "II",
                          "III",
                          "IV",
                          "V",
                          "VI",
                          "VII",
                          "VIII",
                          "IX",
                          "X",
                        ][idx] ?? idx + 1}
                      </span>
                      {folio.name}
                    </button>
                  );
                })}
                {store.newFolioFormOpen ? (
                  <div class="space-y-2">
                    <input
                      id="new-folio-name"
                      autoFocus
                      placeholder="Folio name"
                      class="w-full border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-vermilion)] focus:outline-none"
                      style="font-family: var(--font-display); border-radius: 2px;"
                      onKeyDown$={(e) => {
                        if (e.key === "Enter") {
                          const input = e.target as HTMLInputElement;
                          const name = input.value.trim() || "Untitled folio";
                          const newFolio: Folio = {
                            id: crypto.randomUUID(),
                            name,
                            type: "notes",
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                          };
                          store.folios = [...store.folios, newFolio];
                          store.activeFolioId = newFolio.id;
                          store.editorSeed = "";
                          store.folioKey += 1;
                          saveDraftHtml("");
                          store.newFolioFormOpen = false;
                          void saveFoliosToIdb(store.folios);
                          void saveFolioContentToIdb(newFolio.id, "");
                          void saveActiveFolioIdToIdb(newFolio.id);
                          markDirty();
                        }
                        if (e.key === "Escape") {
                          store.newFolioFormOpen = false;
                        }
                      }}
                    />
                    <div class="flex gap-2">
                      <button
                        onClick$={$(() => {
                          const input = document.getElementById(
                            "new-folio-name",
                          ) as HTMLInputElement | null;
                          const name = input?.value.trim() || "Untitled folio";
                          const newFolio: Folio = {
                            id: crypto.randomUUID(),
                            name,
                            type: "notes",
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                          };
                          store.folios = [...store.folios, newFolio];
                          store.activeFolioId = newFolio.id;
                          store.editorSeed = "";
                          store.folioKey += 1;
                          saveDraftHtml("");
                          store.newFolioFormOpen = false;
                          void saveFoliosToIdb(store.folios);
                          void saveFolioContentToIdb(newFolio.id, "");
                          void saveActiveFolioIdToIdb(newFolio.id);
                          markDirty();
                        })}
                        class="btn-press flex-1 text-xs"
                      >
                        Create
                      </button>
                      <button
                        onClick$={$(() => {
                          store.newFolioFormOpen = false;
                        })}
                        class="btn-paper flex-1 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    class="w-full text-left px-3 py-2 border border-dashed border-[var(--color-paper-3)] text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-paper-soft)] focus-ring"
                    style="font-family: var(--font-serif); border-radius: 2px;"
                    onClick$={$(() => {
                      store.newFolioFormOpen = true;
                    })}
                  >
                    <span class="dept-label block">+</span>
                    New folio
                  </button>
                )}
              </div>

              <div
                class="ornament-divider"
                style="font-family: var(--font-display);"
              >
                ❦
              </div>

              <Link
                href="/personas/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">Room of Editors</span>
                Manage editorial staff
              </Link>

              <Link
                href="/library/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">The Library</span>
                All documents
              </Link>

              <Link
                href="/rubric/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">Galley Proof</span>
                Full rubric report
              </Link>

              <Link
                href="/apparatus/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">The Apparatus</span>
                Research + bibliography
              </Link>

              <Link
                href="/pricing/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">Subscription</span>
                Pricing + Pro checkout
              </Link>

              <div
                class="ornament-divider"
                style="font-family: var(--font-display);"
              >
                ❦
              </div>

              {store.confirmNukeOpen ? (
                <div class="index-card p-3 space-y-2">
                  <p
                    class="text-xs text-[var(--color-ink-light)]"
                    style="font-family: var(--font-serif);"
                  >
                    Start a brand new piece? Your current draft, dossier, and
                    any pending margin notes will all be cleared.
                  </p>
                  <div class="flex gap-2">
                    <button
                      onClick$={$(async () => {
                        // Sweep the writer's comment threads out of the
                        // Lix store so they don't silently orphan
                        // against the new piece. Without this the
                        // Marginalia panel of the next project would
                        // light up with ghost notes the writer
                        // never asked for.
                        await clearUserComments();
                        await clearIdbStore();
                        store.brief = null;
                        store.folios = [];
                        store.activeFolioId = null;
                        store.editorSeed = "";
                        store.confirmNukeOpen = false;
                        void nav("/onboarding/");
                      })}
                      class="btn-press flex-1 text-xs"
                    >
                      Replace
                    </button>
                    <button
                      onClick$={$(() => {
                        store.confirmNukeOpen = false;
                      })}
                      class="btn-paper flex-1 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick$={$(() => {
                    store.confirmNukeOpen = true;
                  })}
                  class="btn-press w-full"
                >
                  + File a new piece
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* ── Main area ─────────────────────────────────────── */}
        <div class="flex-1 flex flex-col min-w-0">
          {/* Masthead */}
          <header class="border-b-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper)]">
            <div class="flex items-center px-5 pt-3 pb-1.5 gap-4">
              <button
                onClick$={() => {
                  store.leftSidebarOpen = !store.leftSidebarOpen;
                }}
                class="icon-btn p-1.5 text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                title="Open the drawer"
                aria-label="Toggle the drawer sidebar"
                aria-expanded={store.leftSidebarOpen}
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
                <a
                  href="/"
                  class="press leading-none mt-0.5 ink-bleed"
                  style="font-family: var(--font-display); font-weight: 700; font-size: 2rem; letter-spacing: 0.06em; color: var(--color-ink); text-decoration: none;"
                >
                  TWYNE
                </a>
                <p
                  class="mt-1 text-[10px] text-[var(--color-ink-muted)] tracking-wider"
                  style="font-family: var(--font-typewriter);"
                >
                  {editorialDateline()}
                </p>
              </div>

              <div class="flex items-center gap-2">
                <button
                  onClick$={$(() => {
                    void nav("/refining/");
                  })}
                  class="btn-paper hidden sm:inline-flex"
                  title="Refine the dossier"
                >
                  Refine the dossier
                </button>
                <FolioMenu
                  brief={store.brief}
                  activeFolioId={store.activeFolioId}
                  activeFolioName={
                    store.folios.find((f) => f.id === store.activeFolioId)
                      ?.name ?? "Untitled"
                  }
                  authorName={store.brief?.answers.workingTitle}
                  layout={
                    store.folios.find((f) => f.id === store.activeFolioId)
                      ?.layout
                  }
                  header={
                    store.folios.find((f) => f.id === store.activeFolioId)
                      ?.header
                  }
                  footer={
                    store.folios.find((f) => f.id === store.activeFolioId)
                      ?.footer
                  }
                />
                {store.activeFolioId && auth.value.user && (
                  <ShareDialog
                    folioId={store.activeFolioId}
                    folioName={
                      store.folios.find((f) => f.id === store.activeFolioId)
                        ?.name ?? "Untitled"
                    }
                    onShared$={$((lixId: string) => {
                      store.sharedLixId = lixId;
                    })}
                  />
                )}
                <div class="relative">
                  <button
                    onClick$={() => {
                      store.authOpen = !store.authOpen;
                    }}
                    class={`icon-btn ${
                      accountDisplay
                        ? "gap-1.5 border border-[var(--color-sage)] bg-[var(--color-paper-soft)] px-2 py-1.5 text-[var(--color-ink)] hover:text-[var(--color-vermilion)]"
                        : "p-1.5 text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                    }`}
                    title={accountTitle}
                    aria-label={
                      accountDisplay
                        ? `Open account menu. Signed in as ${accountDisplay}`
                        : "Open the editor's office (account)"
                    }
                    aria-expanded={store.authOpen}
                  >
                    {accountDisplay && (
                      <span
                        class="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--color-sage)]"
                        aria-hidden="true"
                      />
                    )}
                    <svg
                      class="flex-shrink-0"
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
                    {accountDisplay && (
                      <span
                        class="hidden max-w-[8.5rem] truncate text-[11px] font-semibold lg:inline"
                        style={{ fontFamily: "var(--font-sans)" }}
                      >
                        {accountDisplay}
                      </span>
                    )}
                  </button>
                  {store.authOpen && (
                    <div
                      class="absolute right-0 top-full mt-2 w-72 folio p-3 space-y-2"
                      style="z-index: var(--z-dropdown);"
                    >
                      <div class="flex flex-col gap-1 pb-2 border-b border-[var(--color-paper-3)]">
                        <button
                          type="button"
                          class="w-full text-left text-sm text-[var(--color-ink)] hover:text-[var(--color-vermilion)] py-1.5 px-2 focus-ring"
                          style={{ fontFamily: "var(--font-display)" }}
                          onClick$={() => {
                            store.authOpen = false;
                            void nav("/settings/");
                          }}
                        >
                          ⚙ Preferences
                        </button>
                        <button
                          type="button"
                          class="w-full text-left text-sm text-[var(--color-ink)] hover:text-[var(--color-vermilion)] py-1.5 px-2 focus-ring"
                          style={{ fontFamily: "var(--font-display)" }}
                          onClick$={() => {
                            store.authOpen = false;
                            void nav("/docs/");
                          }}
                        >
                          ❦ The Manual
                        </button>
                      </div>
                      <AuthPanel />
                    </div>
                  )}
                </div>
                <button
                  onClick$={() => {
                    store.rightPanelOpen = !store.rightPanelOpen;
                  }}
                  class="icon-btn p-1.5 text-[var(--color-ink-light)] hover:text-[var(--color-vermilion)]"
                  title="Toggle the editorial board"
                  aria-label="Toggle the editorial board panel"
                  aria-expanded={store.rightPanelOpen}
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

          {/* Editor + Editorial board */}
          <div class="flex-1 flex min-h-0">
            {/* Editor */}
            <div class="flex-1 min-w-0 overflow-auto bg-[var(--color-paper-soft)]">
              <TwyneEditor
                initialContent={store.editorSeed}
                activeFolioId={store.activeFolioId ?? undefined}
                sharedLixId={store.sharedLixId ?? undefined}
              />
            </div>

            {/* ── Editorial Board (right panel) ──────────── */}
            {store.rightPanelOpen && (
              <>
                <div
                  class="w-1.5 flex-shrink-0 cursor-col-resize hover:bg-[var(--color-accent)] transition-colors relative z-10"
                  style={{ background: "var(--color-paper-3)" }}
                  onMouseDown$={$((e: MouseEvent) => {
                    const startX = e.clientX;
                    const startWidth = store.rightPanelWidth;
                    const onMove = (ev: MouseEvent) => {
                      const delta = startX - ev.clientX;
                      store.rightPanelWidth = Math.max(
                        260,
                        Math.min(560, startWidth + delta),
                      );
                    };
                    const onUp = () => {
                      document.removeEventListener("mousemove", onMove);
                      document.removeEventListener("mouseup", onUp);
                      document.body.style.cursor = "";
                      document.body.style.userSelect = "";
                    };
                    document.addEventListener("mousemove", onMove);
                    document.addEventListener("mouseup", onUp);
                    document.body.style.cursor = "col-resize";
                    document.body.style.userSelect = "none";
                  })}
                  title="Drag to resize"
                />
                <aside
                  class="sidebar-transition flex-shrink-0 border-l-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper-2)] overflow-hidden"
                  style={{ width: store.rightPanelWidth }}
                >
                  <div
                    class="h-full flex flex-col"
                    style={{ width: store.rightPanelWidth }}
                  >
                    {/* Departmental tabs */}
                    <div class="border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]">
                      <p class="dept-label px-4 pt-3">The Editorial Board</p>
                      <div class="flex">
                        {panelTabs.map((tab) => {
                          const active =
                            store.rightPanel === tab.id && store.rightPanelOpen;
                          return (
                            <button
                              key={tab.id}
                              onClick$={() => {
                                store.rightPanel = tab.id;
                                store.rightPanelOpen = true;
                              }}
                              class="flex-1 px-2 py-2.5 transition-colors group relative focus-ring"
                              aria-pressed={active}
                              style={{
                                borderBottom: active
                                  ? `3px solid ${tab.accent}`
                                  : "3px solid transparent",
                                background: active
                                  ? "var(--color-paper)"
                                  : "transparent",
                              }}
                            >
                              <span
                                class="block text-[10px] tracking-[0.2em]"
                                style={{
                                  fontFamily: "var(--font-typewriter)",
                                  color: active
                                    ? tab.accent
                                    : "var(--color-ink-muted)",
                                }}
                              >
                                {tab.numeral}
                              </span>
                              <span
                                class="block mt-0.5 text-sm"
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
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Panel content — all panels stay mounted so their
                        event listeners (e.g. replying to an inline note from
                        the editor modal) and in-progress state survive tab
                        switches. Inactive panels are hidden, not unmounted. */}
                    <div class="flex-1 min-h-0 overflow-hidden">
                      <div
                        class={
                          store.rightPanel === "personas" ? "h-full" : "hidden"
                        }
                      >
                        <PersonasPanel brief={store.brief} />
                      </div>
                      <div
                        class={
                          store.rightPanel === "rubric" ? "h-full" : "hidden"
                        }
                      >
                        <RubricPanel brief={store.brief} />
                      </div>
                      <div
                        class={
                          store.rightPanel === "comments" ? "h-full" : "hidden"
                        }
                      >
                        <CommentsPanel
                          brief={store.brief}
                          activeFolioId={store.activeFolioId}
                        />
                      </div>
                      <div
                        class={
                          store.rightPanel === "citations" ? "h-full" : "hidden"
                        }
                      >
                        <CitationsPanel />
                      </div>
                    </div>
                  </div>
                </aside>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export const head: DocumentHead = {
  title: "The Writer's Room · Twyne",
  meta: [
    {
      name: "description",
      content:
        "Twyne's writing workspace: the dossier beside you, a room of editors in residence, and a galley proof that grades the draft as you write.",
    },
  ],
};
