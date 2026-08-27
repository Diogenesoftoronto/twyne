import {
  component$,
  $,
  useSignal,
  useStore,
  useVisibleTask$,
} from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { Link, useLocation, useNavigate } from "@builder.io/qwik-city";
import { ProjectBriefCard } from "../../components/brief/project-brief-card";
import { AccountMenu } from "../../components/auth/account-menu";
import { FolioMenu } from "../../components/folio/folio-menu";
import type { ProjectBrief, Folio, DraftContentDetail } from "../../types";
import {
  clearCrashMirror,
  loadLegacyDraftHtml,
  loadProjectBrief,
  loadProjectBriefForFolio,
  readCrashMirror,
  saveProjectBriefForFolio,
  writeCrashMirror,
} from "../../utils/anti-tabula-rasa";
import {
  loadFoliosFromIdb,
  loadActiveFolioIdFromIdb,
  loadAllBriefsFromIdb,
  loadFolioContentFromIdb,
  saveFoliosToIdb,
  saveActiveFolioIdToIdb,
  saveFolioContentToIdb,
  loadMetaFromIdb,
  saveMetaToIdb,
  loadPersonasFromIdb,
} from "../../utils/idb";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { TwyneEditor } from "../../components/editor/twyne-editor";
import { ShareDialog } from "../../components/collaboration/share-dialog";
import { PersonasPanel } from "../../components/personas/personas-panel";
import { RubricPanel } from "../../components/rubric/rubric-panel";
import { CommentsPanel } from "../../components/comments/comments-panel";
import { CitationsPanel } from "../../components/citations/citations-panel";
import {
  EditorialBoardOverlay,
  type EditorialBoardTab,
} from "../../components/editorial-board/editorial-board-overlay";
import { useConvexClient } from "../../utils/convex-context";
import { api } from "../../../convex/_generated/api";
import { markDirty, loadRoomSettingsLocally } from "../../utils/convex-sync";
import {
  startBackgroundResearch,
  stopBackgroundResearch,
  kickBackgroundResearch,
  onDraftChanged,
} from "../../utils/background-research";
import {
  startBackgroundRoom,
  stopBackgroundRoom,
  onDraftChanged as onDraftChangedForRoom,
} from "../../utils/background-room";
import { paragraphTextFromHtml } from "../../utils/draft-trajectory";
import {
  panelActivity,
  setVisiblePanel,
  startPanelActivity,
  type ActivityCounts,
  type PanelId,
} from "../../utils/panel-activity";
import { PERSONAS as DEFAULT_PERSONAS } from "../../utils/personas";
import type { AppError } from "../../types/application-errors";
import { ApplicationNotice } from "../../components/ui/application-notice";
import { VersionHistoryPanel } from "../../components/revisions/version-history-panel";
import {
  createAppError,
  normalizeApplicationError,
} from "../../utils/application-errors";
import { reportApplicationDiagnostic } from "../../utils/application-diagnostics";
import {
  canClaimLegacyEditorialArtifacts,
  migrateLegacyEditorialArtifacts,
} from "../../utils/folio-workspace";
import { createRevisionSnapshot } from "../../utils/revision-history";
import { getDraftBlocks } from "../../utils/lix";
import {
  captureProductEvent,
  countDraftWords,
  crossedDraftMilestones,
  wordCountBucket,
} from "../../utils/product-analytics";
import { usageLedger } from "../../utils/usage-ledger";

type RightPanel = PanelId;

/** Widest the right panel may be while keeping the manuscript usable. */
const MIN_EDITOR_WIDTH = 360;
const LEFT_SIDEBAR_WIDTH = 288;

/**
 * Below this the rails stop being furniture and start being the whole screen,
 * so they are undocked rather than squeezed. Matches Tailwind's `sm`, which is
 * where the toolbar also switches to a single scrolling row.
 */
const NARROW_VIEWPORT = 640;

function maxRightPanelWidth(leftSidebarOpen: boolean): number {
  const reserved =
    (leftSidebarOpen ? LEFT_SIDEBAR_WIDTH : 0) + MIN_EDITOR_WIDTH;
  // The 260px floor is a minimum *useful* panel, not a promise there is room
  // for one: on a 390px phone it left the manuscript 122px wide. Callers must
  // check `fitsDockedPanel` before docking rather than trusting this number.
  return Math.max(260, Math.min(560, window.innerWidth - reserved));
}

/** Is there room to dock a rail without crushing the manuscript? */
function fitsDockedPanel(leftSidebarOpen: boolean): boolean {
  if (window.innerWidth < NARROW_VIEWPORT) return false;
  const reserved =
    (leftSidebarOpen ? LEFT_SIDEBAR_WIDTH : 0) + MIN_EDITOR_WIDTH;
  return window.innerWidth - reserved >= 260;
}

interface LayoutStore {
  rightPanel: RightPanel;
  leftSidebarOpen: boolean;
  rightPanelOpen: boolean;
  /** Panel state to restore when zen mode is turned back off. Null when not in zen mode. */
  panelsBeforeZen: { left: boolean; right: boolean } | null;
  /** True while zen mode is active — drives masthead/toolbar hiding. */
  zenActive: boolean;
  hydrated: boolean;
  brief: ProjectBrief | null;
  editorSeed: string;
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
  /** Server-authoritative role for the active shared document. */
  sharedRole: "owner" | "editor" | "commenter" | null;
  /** True while joining a shared document is in progress. */
  joiningShared: boolean;
  /** Structured error if joining failed. */
  joinError: AppError | null;
  /** Structured error if the local workspace could not be opened. */
  workspaceError: AppError | null;
  /** Unread counts per board tab, so passive work is never silent. */
  activity: ActivityCounts;
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
 * Rubric, Marginalia, Apparatus, Versions) on the right. The Apparatus runs research
 * agents in the background, debounced on the draft.
 *
 * First-run onboarding lives at /dossier/create; dossier refinement at
 * /dossier/refine. This route owns the workspace and migrates the legacy
 * single-draft key into Folio I on first load.
 */
export default component$(() => {
  const nav = useNavigate();
  const location = useLocation();
  const clientSig = useConvexClient();
  const auth = useAuth();
  // Controls the shared AccountMenu (Editor's Office); external triggers such
  // as the ?auth=1 deep link and the local-only nudge flip this open.
  const accountOpen = useSignal(false);
  const opensVersionHistory =
    location.url.searchParams.get("panel") === "history";
  const store = useStore<LayoutStore>({
    rightPanel: opensVersionHistory ? "history" : "personas",
    leftSidebarOpen: false,
    // Begin with the manuscript, not the entire editorial apparatus. The
    // board remains one click away and retains its unread badges.
    rightPanelOpen: opensVersionHistory,
    panelsBeforeZen: null,
    zenActive: false,
    hydrated: false,
    brief: null,
    editorSeed: "",
    folios: [],
    activeFolioId: null,
    folioKey: 0,
    rightPanelWidth: 340,
    newFolioFormOpen: false,
    confirmNukeOpen: false,
    // Default true to avoid a flash before the meta flag loads.
    signInToastDismissed: true,
    sharedLixId: null,
    sharedRole: null,
    joiningShared: false,
    joinError: null,
    workspaceError: null,
    activity: panelActivity(),
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const lastWordCounts = new Map<string, number>();
    const editedFolios = new Set<string>();

    (async () => {
      try {
        const legacyBrief = loadProjectBrief();
        const folios = await loadFoliosFromIdb();
        const activeFolioId = await loadActiveFolioIdFromIdb();
        const requestedSharedId = new URLSearchParams(
          window.location.search,
        ).get("shared");

        // No dossier yet → the writer belongs in onboarding first.
        if (!legacyBrief && folios.length === 0 && !requestedSharedId) {
          void nav("/dossier/create/");
          return;
        }

        // Migration: old storage had a single draft. If we have a brief but no
        // folios, create a Folio I from the legacy draft key.
        if (legacyBrief && folios.length === 0) {
          const legacyDraft = loadLegacyDraftHtml();
          const draftFolio: Folio = {
            id: crypto.randomUUID(),
            name: legacyBrief.answers.workingTitle || "Current draft",
            type: "draft",
            createdAt: legacyBrief.completedAt,
            updatedAt: Date.now(),
          };
          await saveFoliosToIdb([draftFolio]);
          await saveFolioContentToIdb(draftFolio.id, legacyDraft);
          await saveActiveFolioIdToIdb(draftFolio.id);
          store.folios = [draftFolio];
          store.activeFolioId = draftFolio.id;
          store.editorSeed = legacyDraft;
          await saveProjectBriefForFolio(draftFolio.id, legacyBrief);
          markDirty();
        } else if (folios.length > 0) {
          store.folios = folios;
          store.activeFolioId = activeFolioId ?? folios[0].id;
          const stored = await loadFolioContentFromIdb(store.activeFolioId);
          // If the tab went away before the last IndexedDB write committed,
          // the crash mirror holds the newer copy. When the write did land the
          // two are identical, so preferring the mirror is always safe.
          const rescued = readCrashMirror(store.activeFolioId);
          store.editorSeed = rescued ?? stored;
          if (rescued && rescued !== stored) {
            await saveFolioContentToIdb(store.activeFolioId, rescued);
          }
          clearCrashMirror();
        }

        store.brief = await loadProjectBriefForFolio(store.activeFolioId);
        if (store.activeFolioId) {
          await migrateLegacyEditorialArtifacts(
            store.activeFolioId,
            canClaimLegacyEditorialArtifacts(
              store.folios.map((folio) => folio.id),
              store.activeFolioId,
            ),
          );
        }
        const folioDossiers = await loadAllBriefsFromIdb();
        if (
          !store.brief &&
          folioDossiers.length === 0 &&
          legacyBrief &&
          store.activeFolioId
        ) {
          await saveProjectBriefForFolio(store.activeFolioId, legacyBrief);
          store.brief = legacyBrief;
        }
        store.hydrated = true;

        const openedFolio = store.folios.find(
          (folio) => folio.id === store.activeFolioId,
        );
        if (openedFolio) {
          lastWordCounts.set(openedFolio.id, countDraftWords(store.editorSeed));
          void captureProductEvent("folio_opened", {
            source: "editor",
            folio_type: openedFolio.type,
          });
        }

        // Surface the local-only sign-in nudge unless it was dismissed before.
        const dismissed = await loadMetaFromIdb<boolean>(
          "signin-toast-dismissed",
        );
        store.signInToastDismissed = dismissed === true;

        // Arriving from the landing "Sign in" link → open the auth panel.
        if (new URLSearchParams(window.location.search).get("auth") === "1") {
          accountOpen.value = true;
        }
      } catch (err) {
        reportApplicationDiagnostic("twyne:editor:open-workspace", err, {
          operation: "open-workspace",
        });
        store.workspaceError = normalizeApplicationError(err, {
          source: "application",
          metadata: { operation: "open-workspace" },
        });
        store.hydrated = true;
      }
    })();

    // ── Coalesced local persistence ────────────────────────────────────
    // `twyne:content` already arrives coalesced from the editor, so this only
    // needs to absorb bursts from non-typing sources (folio metadata edits)
    // and to force a flush when the tab is hidden so a quick close never
    // drops the tail.
    //
    // Nothing here writes localStorage. That write was synchronous, carried
    // the entire manuscript, and — being a single global key rather than a
    // folio-scoped one — was clobbered by whichever folio saved last.
    // Folio-scoped IndexedDB is the store of record.
    const LOCAL_PERSIST_DEBOUNCE_MS = 400;
    let localPersistTimer: number | null = null;
    let pendingDraftHtml: string | null = null;
    let pendingDraftFolioId: string | null = null;
    let folioArrayDirty = false;

    const flushLocalPersist = (leaving = false) => {
      localPersistTimer = null;
      if (pendingDraftHtml !== null && pendingDraftFolioId !== null) {
        const [html, folioId] = [pendingDraftHtml, pendingDraftFolioId];
        pendingDraftHtml = null;
        pendingDraftFolioId = null;
        // On the way out the IndexedDB write may not get to commit, so leave a
        // synchronous copy behind first. During normal typing this is skipped.
        if (leaving) writeCrashMirror(folioId, html);
        void saveFolioContentToIdb(folioId, html).then(() => {
          clearCrashMirror();
          void usageLedger
            .recordWritingActivity({ folioId })
            .catch(() => undefined);
          void createRevisionSnapshot({
            folioId,
            html,
            source: "automatic",
          });
          // "Saved Xs ago" means on disk, so stamp it only once IDB commits.
          window.dispatchEvent(new CustomEvent("twyne:draft-saved"));
        });
      }
      if (folioArrayDirty) {
        folioArrayDirty = false;
        void saveFoliosToIdb(store.folios);
      }
    };

    const scheduleLocalPersist = () => {
      if (localPersistTimer !== null) return;
      localPersistTimer = window.setTimeout(
        flushLocalPersist,
        LOCAL_PERSIST_DEBOUNCE_MS,
      );
    };

    const flushLocalPersistNow = (leaving = false) => {
      if (localPersistTimer !== null) {
        window.clearTimeout(localPersistTimer);
        localPersistTimer = null;
      }
      flushLocalPersist(leaving);
    };

    const onLocalPersistPageHide = () => {
      // The editor flushes its own derive on the same event, which re-enters
      // `contentHandler` synchronously; that handler flushes directly when the
      // page is hidden, so this does not depend on listener ordering.
      flushLocalPersistNow(true);
    };

    // ── Save editor content to the active folio ──
    const contentHandler = (e: Event) => {
      const { html, wordCount: currentWordCount } = (
        e as CustomEvent<DraftContentDetail>
      ).detail;
      if (store.activeFolioId) {
        const folioId = store.activeFolioId;
        const previousWordCount =
          lastWordCounts.get(folioId) ?? currentWordCount;

        if (!editedFolios.has(folioId)) {
          editedFolios.add(folioId);
          void captureProductEvent("draft_milestone_reached", {
            milestone: "first_edit",
            word_count_bucket: wordCountBucket(currentWordCount),
          });
        }
        for (const milestone of crossedDraftMilestones(
          previousWordCount,
          currentWordCount,
        )) {
          if (milestone === "first_edit") continue;
          void captureProductEvent("draft_milestone_reached", {
            milestone,
            word_count_bucket: wordCountBucket(currentWordCount),
          });
        }
        lastWordCounts.set(folioId, currentWordCount);

        const idx = store.folios.findIndex((f) => f.id === folioId);
        if (idx >= 0) {
          store.folios[idx].updatedAt = Date.now();
          folioArrayDirty = true;
        }
        pendingDraftHtml = html;
        pendingDraftFolioId = folioId;
        // When the editor flushes its derive because the page is going away,
        // there is no later tick to coalesce into — write it out now.
        if (document.visibilityState === "hidden") {
          flushLocalPersistNow(true);
        } else {
          scheduleLocalPersist();
        }
        markDirty(["folioContent", "folios"], folioId);
      }
    };
    window.addEventListener("twyne:content", contentHandler);
    cleanup(() => window.removeEventListener("twyne:content", contentHandler));

    // A hidden tab is a reliable cue that the writer is leaving — flush the
    // pending draft synchronously instead of waiting on the coalesce window.
    window.addEventListener("pagehide", onLocalPersistPageHide);
    cleanup(() => {
      window.removeEventListener("pagehide", onLocalPersistPageHide);
      if (localPersistTimer !== null) {
        window.clearTimeout(localPersistTimer);
        localPersistTimer = null;
      }
    });

    const loadFolioHandler = (e: Event) => {
      if (!store.activeFolioId) return;
      const html = (e as CustomEvent).detail as string;
      lastWordCounts.set(store.activeFolioId, countDraftWords(html));
    };
    window.addEventListener("twyne:load-folio", loadFolioHandler);
    cleanup(() =>
      window.removeEventListener("twyne:load-folio", loadFolioHandler),
    );

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
      folioArrayDirty = true;
      scheduleLocalPersist();
      markDirty(["folios"]);
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
      folioArrayDirty = true;
      scheduleLocalPersist();
      markDirty(["folios"]);
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
      folioArrayDirty = true;
      scheduleLocalPersist();
      markDirty(["folios"]);
    };
    window.addEventListener("twyne:header", headerHandler);
    window.addEventListener("twyne:footer", footerHandler);
    cleanup(() => window.removeEventListener("twyne:header", headerHandler));
    cleanup(() => window.removeEventListener("twyne:footer", footerHandler));

    // Zen mode: collapse both side panels to give the manuscript the full
    // width, and put them back the way they were on exit.
    const zenModeHandler = (e: Event) => {
      const on = !!(e as CustomEvent).detail?.on;
      store.zenActive = on;
      if (on) {
        if (store.panelsBeforeZen) return;
        store.panelsBeforeZen = {
          left: store.leftSidebarOpen,
          right: store.rightPanelOpen,
        };
        store.leftSidebarOpen = false;
        store.rightPanelOpen = false;
      } else if (store.panelsBeforeZen) {
        store.leftSidebarOpen = store.panelsBeforeZen.left;
        store.rightPanelOpen = store.panelsBeforeZen.right;
        store.panelsBeforeZen = null;
      }
    };
    window.addEventListener("twyne:zen-mode", zenModeHandler);
    cleanup(() => window.removeEventListener("twyne:zen-mode", zenModeHandler));

    // The Drawer still undocks when the viewport is narrow. The Editorial
    // Board is now an overlay with its own mobile layout, so it no longer
    // needs to be closed just to preserve the manuscript measure.
    const onWindowResize = () => {
      const max = maxRightPanelWidth(store.leftSidebarOpen);
      if (store.rightPanelWidth > max) store.rightPanelWidth = max;

      // On a phone there is no room to dock anything: both rails together
      // reserved 548px of a 390px screen, leaving the manuscript 122px. Undock
      // them instead of rendering a column too narrow to write in. This runs
      // on mount too, so the editor opens usable rather than opening wrong and
      // waiting for a resize that never comes.
      if (!fitsDockedPanel(store.leftSidebarOpen)) {
        if (store.leftSidebarOpen) store.leftSidebarOpen = false;
      }
    };
    window.addEventListener("resize", onWindowResize);
    onWindowResize();
    cleanup(() => window.removeEventListener("resize", onWindowResize));

    const onDraftContent = (e: Event) => {
      // `text` arrives with blocks already separated by a blank line, which is
      // exactly what the room's paragraph splitter wants. Research wants it
      // flattened. Both used to be reconstructed from `html` by ~15 chained
      // regexes, each allocating another copy of the whole manuscript.
      const { text } = (e as CustomEvent<DraftContentDetail>).detail;
      onDraftChanged(text.replace(/\s+/g, " ").trim());
      onDraftChangedForRoom(text);
    };
    window.addEventListener("twyne:content", onDraftContent);

    // When the writer replies to an editor's note from the inline modal, the
    // Cast panel handles the thread. Reveal it so they see the reply land.
    const onPersonaReply = () => {
      store.rightPanel = "personas";
      store.rightPanelOpen = true;
      setVisiblePanel("personas");
    };
    window.addEventListener("twyne:persona-reply", onPersonaReply);

    // ── Unread counts on the board tabs ──
    const stopActivity = startPanelActivity();
    setVisiblePanel(store.rightPanelOpen ? store.rightPanel : null);
    const onActivity = (e: Event) => {
      store.activity = (e as CustomEvent).detail as ActivityCounts;
    };
    window.addEventListener("twyne:panel-activity", onActivity);

    const onRemoteSync = async () => {
      const folios = await loadFoliosFromIdb();
      const storedActive = await loadActiveFolioIdFromIdb();
      const activeFolioId = folios.some(
        (folio) => folio.id === store.activeFolioId,
      )
        ? store.activeFolioId
        : storedActive && folios.some((folio) => folio.id === storedActive)
          ? storedActive
          : (folios[0]?.id ?? null);
      const [content, brief] = activeFolioId
        ? await Promise.all([
            loadFolioContentFromIdb(activeFolioId),
            loadProjectBriefForFolio(activeFolioId),
          ])
        : ["", null];
      store.folios = folios;
      store.activeFolioId = activeFolioId;
      store.editorSeed = content;
      store.brief = brief;
      store.folioKey += 1;
      store.activity = panelActivity();
      window.dispatchEvent(
        new CustomEvent("twyne:load-folio", { detail: content }),
      );
    };
    window.addEventListener("twyne:remote-sync", onRemoteSync);

    cleanup(() => {
      stopActivity();
      window.removeEventListener("twyne:panel-activity", onActivity);
      window.removeEventListener("twyne:content", onDraftContent);
      window.removeEventListener("twyne:persona-reply", onPersonaReply);
      window.removeEventListener("twyne:remote-sync", onRemoteSync);
    });
  });

  // A shared link must survive both first-use onboarding and the asynchronous
  // auth bootstrap. Tracking the signed-in user resumes the join as soon as
  // authentication completes instead of requiring a reload.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track }) => {
    const authenticated = track(() =>
      hasAuthenticatedConvexIdentity(auth.value),
    );
    const client = track(() => clientSig.value);
    const sharedId = new URLSearchParams(window.location.search).get("shared");
    if (!sharedId || store.sharedLixId === sharedId || store.joiningShared) {
      return;
    }
    if (!authenticated || !client) {
      accountOpen.value = true;
      return;
    }

    store.joiningShared = true;
    store.joinError = null;
    try {
      try {
        await client.mutation(api.collaboration.acceptInvitation, {
          lixId: sharedId,
        });
      } catch {
        // Reopening an already-accepted link is valid. The role lookup below
        // distinguishes that case from an invitation the writer cannot use.
      }
      const meta = await client.query(api.collaboration.getSharedLixMeta, {
        lixId: sharedId,
      });
      if (!meta) {
        store.joinError = createAppError("PERMISSION_DENIED", {
          source: "convex",
          metadata: { operation: "join-shared-document" },
        });
        return;
      }
      const { joinSharedLix } = await import("../../utils/collaboration");
      await joinSharedLix(client, sharedId);
      const sharedBlocks = await getDraftBlocks(meta.folioId);
      store.sharedLixId = sharedId;
      store.sharedRole = meta.role;
      store.activeFolioId = meta.folioId;
      store.editorSeed = sharedBlocks.map((block) => block.html).join("");
    } catch (err) {
      reportApplicationDiagnostic("twyne:editor:join-shared-document", err, {
        operation: "join-shared-document",
      });
      store.joinError = normalizeApplicationError(err, {
        source: "convex",
        metadata: { operation: "join-shared-document" },
      });
    } finally {
      store.joiningShared = false;
    }
  });

  // Each folio owns its own research and editorial-room process. Tracking the
  // active id stops the previous room before opening the next one, including
  // ordinary drawer switches that do not navigate away from /editor.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const hydrated = track(() => store.hydrated);
    const folioId = track(() => store.activeFolioId);
    const brief = track(() => store.brief);
    if (!hydrated || !folioId) return;

    let cancelled = false;
    cleanup(() => {
      cancelled = true;
      stopBackgroundResearch();
      stopBackgroundRoom();
    });

    const client = clientSig.value;
    const [custom, roomSettings, seed] = await Promise.all([
      loadPersonasFromIdb(),
      loadRoomSettingsLocally(),
      loadFolioContentFromIdb(folioId),
    ]);
    if (cancelled || store.activeFolioId !== folioId) return;

    // Direct BYOK, model-search, and MCP research do not require a hosted
    // Convex client. The watcher is therefore scoped for every folio; only
    // the hosted provider itself depends on `client`.
    startBackgroundResearch({ client: client ?? null, brief, folioId });
    const plain = (seed ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (plain.length > 40) kickBackgroundResearch(plain);
    startBackgroundRoom({
      client,
      brief,
      folioId,
      personas: custom && custom.length > 0 ? custom : DEFAULT_PERSONAS,
      enabled: roomSettings.backgroundRoom !== false,
      baselineText: paragraphTextFromHtml(seed ?? ""),
    });
  });

  /**
   * Activate one existing folio as a complete workspace boundary.
   *
   * Load the dossier and manuscript before publishing the new active id so
   * tracked background services can never observe "new folio + old dossier."
   * The keyed right-rail panels remount when the id changes.
   */
  const activateFolio = $(async (folio: Folio) => {
    if (store.activeFolioId === folio.id) return;
    stopBackgroundResearch();
    stopBackgroundRoom();
    const [content, brief] = await Promise.all([
      loadFolioContentFromIdb(folio.id),
      loadProjectBriefForFolio(folio.id),
    ]);
    store.brief = brief;
    store.editorSeed = content;
    store.sharedLixId = null;
    store.sharedRole = null;
    store.activeFolioId = folio.id;
    store.folioKey += 1;
    store.activity = panelActivity();
    await saveActiveFolioIdToIdb(folio.id);
    void captureProductEvent("folio_opened", {
      source: "editor",
      folio_type: folio.type,
    });
    window.dispatchEvent(
      new CustomEvent("twyne:load-folio", { detail: content }),
    );
  });

  /**
   * Create a blank folio and immediately open its own dossier.
   *
   * This is the only creation path used by the drawer, Enter-to-save, and
   * "File a new piece", keeping their persistence and room reset semantics
   * identical.
   */
  const createFolio = $(async (requestedName: string) => {
    stopBackgroundResearch();
    stopBackgroundRoom();
    const now = Date.now();
    const newFolio: Folio = {
      id: crypto.randomUUID(),
      name: requestedName.trim() || "Untitled folio",
      type: "draft",
      createdAt: now,
      updatedAt: now,
    };
    const nextFolios = [...store.folios, newFolio];

    // Publish a complete blank workspace atomically to reactive consumers.
    store.folios = nextFolios;
    store.brief = null;
    store.editorSeed = "";
    store.sharedLixId = null;
    store.sharedRole = null;
    store.activeFolioId = newFolio.id;
    store.folioKey += 1;
    store.activity = panelActivity();
    store.newFolioFormOpen = false;
    store.confirmNukeOpen = false;

    await Promise.all([
      saveFoliosToIdb(nextFolios),
      saveFolioContentToIdb(newFolio.id, ""),
      saveActiveFolioIdToIdb(newFolio.id),
    ]);
    void captureProductEvent("folio_created", {
      source: "editor",
      folio_type: newFolio.type,
    });
    markDirty();
    await nav(`/dossier/create/?folio=${encodeURIComponent(newFolio.id)}`);
  });

  const panelTabs: EditorialBoardTab[] = [
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
    {
      id: "history",
      numeral: "V",
      label: "Versions",
      kicker: "Version history",
      accent: "var(--color-sage)",
    },
  ];
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
                      accountOpen.value = true;
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
      <div class="editor-workspace-shell flex h-screen bg-[var(--color-paper)] overflow-hidden">
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
                  if (!store.activeFolioId) return;
                  void nav(
                    store.brief
                      ? `/dossier/refine/?folio=${encodeURIComponent(store.activeFolioId)}`
                      : `/dossier/create/?folio=${encodeURIComponent(store.activeFolioId)}`,
                  );
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
                        await activateFolio(folio);
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
                      onKeyDown$={async (e) => {
                        if (e.key === "Enter") {
                          const input = e.target as HTMLInputElement;
                          await createFolio(input.value);
                        }
                        if (e.key === "Escape") {
                          store.newFolioFormOpen = false;
                        }
                      }}
                    />
                    <div class="flex gap-2">
                      <button
                        onClick$={$(async () => {
                          const input = document.getElementById(
                            "new-folio-name",
                          ) as HTMLInputElement | null;
                          await createFolio(input?.value ?? "");
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
                href="/analysis/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">The Full Analysis</span>
                Cast analysis report
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

              <Link
                href="/desk/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">My Desk</span>
                Writing activity + AI usage
              </Link>

              <Link
                href="/settings/"
                class="w-full text-left px-3 py-2.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring block"
                style="font-family: var(--font-display); border-radius: 2px;"
              >
                <span class="dept-label block">The Composing Room</span>
                Preferences + models
              </Link>

              <div
                class="ornament-divider"
                style="font-family: var(--font-display);"
              >
                ❦
              </div>

              {/* The rest of the paper. Without these the editor is a
                  dead end: every other page was reachable only from the
                  landing footer. */}
              <p class="dept-label px-3">Elsewhere in the paper</p>
              <div class="space-y-1">
                {[
                  { href: "/blog/", label: "The Column" },
                  { href: "/docs/", label: "The Manual" },
                  { href: "/faq/", label: "Queries Answered" },
                  { href: "/downloads/", label: "The Press Room" },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    class="block px-3 py-1.5 text-sm border border-transparent text-[var(--color-ink-light)] hover:bg-[var(--color-paper-soft)] hover:text-[var(--color-ink)] focus-ring"
                    style="font-family: var(--font-serif); border-radius: 2px;"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>

              <div
                class="flex items-center gap-3 px-3 pt-1 text-[10px] tracking-wider text-[var(--color-ink-muted)]"
                style="font-family: var(--font-typewriter);"
              >
                <Link href="/terms/" class="hover:text-[var(--color-ink)]">
                  Terms
                </Link>
                <span aria-hidden="true">·</span>
                <Link href="/privacy/" class="hover:text-[var(--color-ink)]">
                  Privacy
                </Link>
              </div>

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
                    File a separate piece? Your current folio stays in the
                    drawer. The new folio starts with its own dossier.
                  </p>
                  <div class="flex gap-2">
                    <button
                      onClick$={$(async () => {
                        await createFolio("Untitled folio");
                      })}
                      class="btn-press flex-1 text-xs"
                    >
                      Create piece
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
        <div class="editor-workspace-main flex-1 flex flex-col min-w-0">
          {/* Masthead */}
          <header
            class={`border-b-2 border-double border-[var(--color-paper-3)] bg-[var(--color-paper)]${store.zenActive ? " zen-masthead" : ""}`}
          >
            <div class="flex items-center px-5 pt-3 pb-1.5 gap-4">
              <button
                onClick$={() => {
                  store.leftSidebarOpen = !store.leftSidebarOpen;
                  const max = maxRightPanelWidth(store.leftSidebarOpen);
                  if (store.rightPanelWidth > max) store.rightPanelWidth = max;
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
                    if (!store.activeFolioId) return;
                    void nav(
                      store.brief
                        ? `/dossier/refine/?folio=${encodeURIComponent(store.activeFolioId)}`
                        : `/dossier/create/?folio=${encodeURIComponent(store.activeFolioId)}`,
                    );
                  })}
                  class="btn-paper hidden sm:inline-flex"
                  title="Refine the dossier"
                >
                  {store.brief ? "Refine the dossier" : "File a dossier"}
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
                  onImported$={$(async () => {
                    // FolioMenu has already written the imported piece to
                    // IndexedDB and may have created a folio for it. Without
                    // this the dialog just closed: the editor kept showing the
                    // old manuscript, and its next autosave wrote that back
                    // over the import — so importing appeared to do nothing.
                    stopBackgroundResearch();
                    stopBackgroundRoom();
                    const [folios, activeId] = await Promise.all([
                      loadFoliosFromIdb(),
                      loadActiveFolioIdFromIdb(),
                    ]);
                    const folioId = activeId ?? folios[0]?.id ?? null;
                    if (!folioId) return;
                    const [content, brief] = await Promise.all([
                      loadFolioContentFromIdb(folioId),
                      loadProjectBriefForFolio(folioId),
                    ]);
                    store.folios = folios;
                    store.brief = brief;
                    store.editorSeed = content;
                    store.sharedLixId = null;
                    store.sharedRole = null;
                    store.activeFolioId = folioId;
                    // Remount the editor so Tiptap re-seeds from the import
                    // rather than diffing against the document it replaced.
                    store.folioKey += 1;
                    store.activity = panelActivity();
                    markDirty();
                    window.dispatchEvent(
                      new CustomEvent("twyne:load-folio", { detail: content }),
                    );
                  })}
                />
                {store.activeFolioId &&
                  hasAuthenticatedConvexIdentity(auth.value) && (
                    <ShareDialog
                      folioId={store.activeFolioId}
                      folioName={
                        store.folios.find((f) => f.id === store.activeFolioId)
                          ?.name ?? "Untitled"
                      }
                      onShared$={$((lixId: string, draftHtml?: string) => {
                        if (draftHtml !== undefined) {
                          store.editorSeed = draftHtml;
                        }
                        store.sharedLixId = lixId;
                        store.sharedRole = "owner";
                      })}
                    />
                  )}
                <AccountMenu open={accountOpen} />
                <button
                  onClick$={() => {
                    store.rightPanelOpen = !store.rightPanelOpen;
                    setVisiblePanel(
                      store.rightPanelOpen ? store.rightPanel : null,
                    );
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

          {(store.workspaceError || store.joinError) && (
            <div class="border-b border-[var(--color-paper-3)] bg-[var(--color-paper)] px-5 py-3">
              <ApplicationNotice
                error={store.workspaceError ?? store.joinError!}
                recoveryLabel={
                  store.joinError?.code === "AUTHENTICATION_REQUIRED"
                    ? "Sign in"
                    : undefined
                }
                recoveryHref={
                  store.joinError?.code === "AUTHENTICATION_REQUIRED"
                    ? "/signin/"
                    : undefined
                }
                onDismiss$={$(() => {
                  store.workspaceError = null;
                  store.joinError = null;
                })}
              />
            </div>
          )}

          {/* The manuscript owns the remaining height beneath the masthead. */}
          <div class="relative flex flex-1 min-h-0 overflow-hidden">
            {/* Editor */}
            <div class="h-full min-w-0 flex-1 overflow-auto bg-[var(--color-paper-soft)]">
              <TwyneEditor
                key={`editor-${store.activeFolioId ?? "none"}-${store.sharedLixId ?? "solo"}-${store.folioKey}`}
                initialContent={store.editorSeed}
                activeFolioId={store.activeFolioId ?? undefined}
                activeFolio={
                  store.folios.find(
                    (folio) => folio.id === store.activeFolioId,
                  ) ?? null
                }
                brief={store.brief}
                sharedLixId={store.sharedLixId ?? undefined}
                readOnly={store.sharedRole === "commenter"}
                onEditorialContext$={(panel) => {
                  store.rightPanel = panel;
                  store.rightPanelOpen = true;
                  setVisiblePanel(panel);
                  if (panel === "history") {
                    window.dispatchEvent(
                      new CustomEvent("twyne:version-history-opened"),
                    );
                  }
                }}
                onManuscriptFocus$={() => {
                  store.rightPanelOpen = false;
                  setVisiblePanel(null);
                }}
              />
            </div>
          </div>
        </div>

        {/* The Board is a viewport-height sibling of the main column, matching
            the drawer rather than inheriting the shorter manuscript row. */}
        <EditorialBoardOverlay
          open={store.rightPanelOpen}
          activeContext={store.rightPanel}
          activity={store.activity}
          tabs={panelTabs}
          onClose$={() => {
            store.rightPanelOpen = false;
            setVisiblePanel(null);
          }}
          onContext$={(panel) => {
            store.rightPanel = panel;
            store.rightPanelOpen = true;
            setVisiblePanel(panel);
            if (panel === "history") {
              window.dispatchEvent(
                new CustomEvent("twyne:version-history-opened"),
              );
            }
          }}
        >
          {/* All panels stay mounted so their event listeners and in-progress
              state survive tab switches and closure. */}
          <div class={store.rightPanel === "personas" ? "h-full" : "hidden"}>
            {store.activeFolioId && (
              <PersonasPanel
                key={`personas-${store.activeFolioId}`}
                brief={store.brief}
                activeFolioId={store.activeFolioId}
              />
            )}
          </div>
          <div class={store.rightPanel === "rubric" ? "h-full" : "hidden"}>
            {store.activeFolioId && (
              <RubricPanel
                key={`rubric-${store.activeFolioId}`}
                brief={store.brief}
                activeFolioId={store.activeFolioId}
              />
            )}
          </div>
          <div class={store.rightPanel === "comments" ? "h-full" : "hidden"}>
            <CommentsPanel
              key={`comments-${store.activeFolioId ?? "none"}`}
              brief={store.brief}
              activeFolioId={store.activeFolioId}
            />
          </div>
          <div class={store.rightPanel === "citations" ? "h-full" : "hidden"}>
            <CitationsPanel
              key={`citations-${store.activeFolioId ?? "none"}`}
              activeFolio={
                store.folios.find(
                  (folio) => folio.id === store.activeFolioId,
                ) ?? null
              }
            />
          </div>
          <div class={store.rightPanel === "history" ? "h-full" : "hidden"}>
            {store.activeFolioId && (
              <VersionHistoryPanel
                key={`history-${store.activeFolioId}`}
                activeFolioId={store.activeFolioId}
                folioName={
                  store.folios.find((folio) => folio.id === store.activeFolioId)
                    ?.name ?? "Untitled folio"
                }
              />
            )}
          </div>
        </EditorialBoardOverlay>
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
