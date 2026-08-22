import {
  $,
  Slot,
  component$,
  useStore,
  type PropFunction,
} from "@builder.io/qwik";
import { steerBackgroundResearch } from "../../utils/background-research";
import { ChatComposer } from "../ui/chat-composer";
import type { ActivityCounts, PanelId } from "../../utils/panel-activity";

export interface EditorialBoardTab {
  id: PanelId;
  numeral: string;
  label: string;
  kicker: string;
  accent: string;
}

interface EditorialBoardOverlayProps {
  open: boolean;
  activeContext: PanelId;
  activity: ActivityCounts;
  tabs: EditorialBoardTab[];
  onContext$: PropFunction<(panel: PanelId) => void>;
  onClose$: PropFunction<() => void>;
}

interface OverlayStore {
  steeringCollapsed: boolean;
  steeringDraft: string;
  steeringBusy: boolean;
  steeringNotice: string | null;
  steeringError: string | null;
}

/**
 * The Editorial Board as furniture on the manuscript rather than another
 * application rail. Its children remain mounted while closed so searches,
 * streams, replies, and error recovery continue without losing state.
 */
export const EditorialBoardOverlay = component$<EditorialBoardOverlayProps>(
  (props) => {
    const store = useStore<OverlayStore>({
      steeringCollapsed: false,
      steeringDraft: "",
      steeringBusy: false,
      steeringNotice: null,
      steeringError: null,
    });

    const submitSteering = $(async () => {
      const direction = store.steeringDraft.trim();
      if (!direction || store.steeringBusy) return;
      store.steeringBusy = true;
      store.steeringError = null;
      store.steeringNotice = null;
      const result = await steerBackgroundResearch(direction);
      store.steeringBusy = false;
      if (!result.ok) {
        store.steeringError =
          result.message ?? "The Apparatus could not start.";
        return;
      }
      store.steeringNotice = "Direction added to the next research pass.";
      store.steeringDraft = "";
    });

    const activeTab =
      props.tabs.find((tab) => tab.id === props.activeContext) ?? props.tabs[0];

    return (
      <aside
        class={[
          "editorial-overlay",
          {
            "editorial-overlay--apparatus": props.activeContext === "citations",
            "editorial-overlay--closed": !props.open,
          },
        ]}
        aria-label="The Editorial Board"
        aria-hidden={!props.open}
      >
        <div class="editorial-overlay__topline">
          <p class="dept-label">The Editorial Board</p>
          <button
            type="button"
            class="editorial-overlay__close focus-ring"
            onClick$={props.onClose$}
            aria-label="Close the Editorial Board"
          >
            ×
          </button>
        </div>

        <section
          class="editorial-overlay-card editorial-board-card"
          style={{ "--board-accent": activeTab.accent }}
        >
          <header class="editorial-board-card__head">
            <nav class="editorial-board-contexts" aria-label="Board context">
              {props.tabs.map((tab) => {
                const active = tab.id === props.activeContext;
                const unread = props.activity[tab.id] ?? 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    class={[
                      "editorial-board-context focus-ring",
                      { "editorial-board-context--active": active },
                    ]}
                    style={{ "--context-accent": tab.accent }}
                    onClick$={() => props.onContext$(tab.id)}
                    aria-pressed={active}
                    aria-label={
                      unread > 0 ? `${tab.label} — ${unread} new` : tab.label
                    }
                  >
                    <span aria-hidden="true">{tab.numeral}</span>
                    <strong>{tab.label}</strong>
                    {unread > 0 && !active && (
                      <small aria-hidden="true">
                        {unread > 9 ? "9+" : unread}
                      </small>
                    )}
                  </button>
                );
              })}
            </nav>
          </header>
          {props.activeContext === "citations" && (
            <section class="editorial-steering-card">
              <header class="editorial-overlay-card__head">
                <p class="dept-label">Steer search</p>
                <button
                  type="button"
                  class="apparatus-disclosure-toggle focus-ring"
                  onClick$={() => {
                    store.steeringCollapsed = !store.steeringCollapsed;
                  }}
                  aria-expanded={!store.steeringCollapsed}
                  aria-label={
                    store.steeringCollapsed
                      ? "Expand research steering"
                      : "Collapse research steering"
                  }
                >
                  {store.steeringCollapsed ? "▸" : "▾"}
                </button>
              </header>
              {!store.steeringCollapsed && (
                <div class="editorial-steering-card__body">
                  {/* The same composer the rest of the room writes into: the
                      Steer key sits under the box instead of beside it, and a
                      direction can be spoken as readily as typed. */}
                  <ChatComposer
                    value={store.steeringDraft}
                    onValueChange$={$((value: string) => {
                      store.steeringDraft = value;
                      store.steeringError = null;
                      store.steeringNotice = null;
                    })}
                    onSend$={submitSteering}
                    busy={store.steeringBusy}
                    label="Research direction"
                    sendLabel="Steer"
                    placeholder="Prefer primary sources, trace the original quotation…"
                  />
                  {(store.steeringError || store.steeringNotice) && (
                    <p
                      class={
                        store.steeringError
                          ? "editorial-steering-card__error"
                          : "editorial-steering-card__notice"
                      }
                      role="status"
                    >
                      {store.steeringError ?? store.steeringNotice}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
          <div class="board-panel editorial-board-card__body">
            <Slot />
          </div>
        </section>
      </aside>
    );
  },
);
