/**
 * The forecast line in the status bar, beside the word count.
 *
 *   on pace for ~900 today (700–1,100) · done ~Nov 14 (Nov 8 – 25)
 *
 * It also keeps the pace ledger: every saved draft's word count is folded
 * into `writing-pace-ledger`, so the history exists whether or not the line
 * is showing. The line itself steps aside in Zen and whenever the flow
 * reading says a run is building — a pace figure is the last thing a writer
 * in flow needs to see — and comes back at the next pause.
 */
import { component$, useStore, useVisibleTask$ } from "@qwik.dev/core";
import { Link } from "@qwik.dev/router";
import type { DraftContentDetail } from "../../types";
import {
  FLOW_EVENT,
  flowSnapshot,
  type FlowSnapshot,
} from "./extensions/flow-conductor";
import {
  hasAuthenticatedConvexIdentity,
  useAuth,
} from "../../utils/auth-context";
import { useConvexClient } from "../../utils/convex-context";
import { dailyCreditRunway } from "../../utils/credit-runway";
import { loadBriefFromIdb } from "../../utils/idb";
import {
  briefWordTarget,
  clientAsk,
  creditNeedsNotice,
  FORECAST_PREVIEW_EVENT,
  finishForecast,
  formatDay,
  formatDayRange,
  formatWordRange,
  formatWords,
  paceForecast,
  type CreditForecast,
  type FinishForecast,
  type PaceForecast,
} from "../../utils/writing-forecasts";
import {
  loadPaceLedger,
  recordWordCount,
} from "../../utils/writing-pace-ledger";


const REFRESH_MS = 5 * 60_000;
const RECORD_MS = 20_000;

interface LineState {
  pace: PaceForecast | null;
  finish: FinishForecast | null;
  credit: CreditForecast | null;
  quiet: boolean;
}

export const ForecastLine = component$<{
  folioId: string | null;
  wordCount: number;
  zen: boolean;
}>((props) => {
  const auth = useAuth();
  const clientSignal = useConvexClient();
  const state = useStore<LineState>({
    pace: null,
    finish: null,
    credit: null,
    quiet: false,
  });

  // Mobile hides this span; "document-ready" so the ledger still records.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ track, cleanup }) => {
      const folioId = track(() => props.folioId);
      track(() => auth.value.user?.analyticsId);
      const client = track(() => clientSignal.value);
      let disposed = false;
      let preview = false;
      let pending: { folioId: string; words: number } | null = null;
      let lastRecord = 0;

      const refresh = async () => {
        if (disposed || preview) return;
        const now = Date.now();
        const ledger = await loadPaceLedger();
        const ask = clientAsk(client);
        const [pace, finish] = await Promise.all([
          paceForecast(ledger, now, { ask }).catch(() => null),
          folioId
            ? loadBriefFromIdb(folioId)
                .then((brief) =>
                  finishForecast({
                    ledger,
                    folioId,
                    currentWords: props.wordCount,
                    target: briefWordTarget(brief),
                    now,
                    options: { ask },
                  }),
                )
                .catch(() => null)
            : null,
        ]);
        if (disposed || preview) return;
        state.pace = pace;
        state.finish = finish;
      };

      const loadCredit = async () => {
        const accountId = auth.value.user?.analyticsId;
        if (!client || !accountId || !hasAuthenticatedConvexIdentity(auth.value))
          return;
        const credit = await dailyCreditRunway(client, accountId).catch(
          () => null,
        );
        if (!disposed && !preview) state.credit = credit;
      };

      const onContent = (event: Event) => {
        const detail = (event as CustomEvent<DraftContentDetail>).detail;
        if (!folioId || typeof detail?.wordCount !== "number") return;
        pending = { folioId, words: detail.wordCount };
      };
      // Count only what reached the disk, for the draft that was saved.
      const onSaved = (event: Event) => {
        const saved = (event as CustomEvent<{ folioId?: string }>).detail
          ?.folioId;
        if (!pending || pending.folioId !== saved) return;
        const now = Date.now();
        if (now - lastRecord < RECORD_MS) return;
        lastRecord = now;
        const { folioId: id, words } = pending;
        pending = null;
        void recordWordCount(id, words, now)
          .then(refresh)
          .catch(() => undefined);
      };
      const onFlow = (snap: FlowSnapshot) => {
        state.quiet =
          snap.enabled && (snap.mode === "flow" || snap.mode === "settling");
      };
      const onFlowEvent = (event: Event) =>
        onFlow((event as CustomEvent<FlowSnapshot>).detail);
      const onPreview = (event: Event) => {
        const detail = (event as CustomEvent<Partial<LineState>>).detail ?? {};
        preview = true;
        state.pace = detail.pace ?? null;
        state.finish = detail.finish ?? null;
        state.credit = detail.credit ?? null;
      };

      onFlow(flowSnapshot());
      window.addEventListener("twyne:content", onContent);
      window.addEventListener("twyne:draft-saved", onSaved);
      window.addEventListener(FLOW_EVENT, onFlowEvent);
      if (import.meta.env.DEV)
        window.addEventListener(FORECAST_PREVIEW_EVENT, onPreview);
      void refresh();
      void loadCredit();
      const timer = window.setInterval(() => void refresh(), REFRESH_MS);
      cleanup(() => {
        disposed = true;
        window.clearInterval(timer);
        window.removeEventListener("twyne:content", onContent);
        window.removeEventListener("twyne:draft-saved", onSaved);
        window.removeEventListener(FLOW_EVENT, onFlowEvent);
        window.removeEventListener(FORECAST_PREVIEW_EVENT, onPreview);
      });
    },
    { strategy: "document-ready" },
  );

  const credit = creditNeedsNotice(state.credit, Date.now())
    ? state.credit
    : null;
  // One stable root: swapping it would restart the task above.
  const hidden =
    props.zen || state.quiet || (!state.pace && !state.finish && !credit);

  const paceText = state.pace
    ? `On pace for ~${formatWords(state.pace.median)} words today (${formatWordRange(state.pace)}); ${formatWords(state.pace.wordsSoFar)} so far.`
    : "";
  const finishText = state.finish
    ? `Draft reaches ${formatWords(state.finish.target)} words around ${formatDay(state.finish.median)} (${formatDayRange(state.finish.early, state.finish.late)}).`
    : "";

  return (
    <span class="editor-forecast" data-testid="forecast-line" hidden={hidden}>
      {!hidden && state.pace && (
        <span class="editor-forecast__item" title={paceText}>
          on pace for ~{formatWords(state.pace.median)} today
          {formatWordRange(state.pace).includes("–") && (
            <span class="editor-forecast__range">
              {" "}({formatWordRange(state.pace)})
            </span>
          )}
        </span>
      )}
      {!hidden && state.finish && (
        <span class="editor-forecast__item" title={finishText}>
          done ~{formatDay(state.finish.median)}
          {state.finish.early !== state.finish.late && (
            <span class="editor-forecast__range">
              {" "}({formatDayRange(state.finish.early, state.finish.late)})
            </span>
          )}
        </span>
      )}
      {!hidden && credit?.runsOut && (
        <Link
          href="/desk/"
          class="editor-forecast__item editor-forecast__credit"
          title={`Hosted credit runs out around ${formatDay(credit.runsOut.median)} (${formatDayRange(credit.runsOut.early, credit.runsOut.late)}) at your recent pace. Open the desk.`}
        >
          credit to ~{formatDay(credit.runsOut.median)}
        </Link>
      )}
    </span>
  );
});
