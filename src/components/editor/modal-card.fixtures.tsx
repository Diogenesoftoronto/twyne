import {
  component$,
  Slot,
  useContextProvider,
  useSignal,
  type PropFunction,
} from "@qwik.dev/core";
import { AuthContext, type AuthState } from "../../utils/auth-context";
import { ConvexProvider } from "../../utils/convex-context";
import { QwikRouterMockProvider } from "@qwik.dev/router";
import type {
  NotePopover,
  SuggestionPopover,
  UserCommentPopover,
} from "./editor-state";

/** Fictional manuscript and conversation fixtures, never persisted or generated. */
export const passage =
  "The library was the only room in the city where nobody had to buy anything to stay.";
export const fixtureTime = Date.UTC(2026, 10, 3, 14);
const position = { x: 24, top: 112, bottom: null, maxH: 640 };

export const personaNote: NotePopover = {
  ...position,
  id: "story-persona-note",
  author: "M. Le Stylo",
  color: "var(--color-persona-editor)",
  label: "on clarity",
  note: "The claim in **‘nobody had to buy anything’** is strong. Show us the room before you explain its public purpose. Who is sitting there, and what are they doing?",
  quote: passage,
  briefTitle: "The public room",
  placement: "below",
  draft: "",
  dismissed: false,
  pinned: true,
  thread: [],
  replying: false,
  streamingReply: "",
  error: null,
};

export const proposedEdit: SuggestionPopover = {
  ...position,
  id: "story-proposed-edit",
  versionId: "story-version",
  author: "M. Le Stylo",
  color: "var(--color-persona-editor)",
  original:
    "It could be said that the library was, in a very real sense, a place that was available to everyone.",
  replacement: passage,
  rationale:
    "Cut the qualifications and name the practical difference: **you can stay without spending money**.",
  busy: false,
};

export const writerComment: UserCommentPopover = {
  ...position,
  mode: "thread",
  visible: true,
  id: "story-writer-note",
  author: "You",
  text: "Return to this claim after the interview. Does **every branch** offer the same access?",
  quote: passage,
  createdAt: fixtureTime,
  from: 1,
  to: passage.length + 1,
  resolved: false,
  replies: [],
  draft: "",
};

/** Qwik props may be proxies; copy plain fixture data without structuredClone. */
export function copyFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const ModalCardStage = component$<{
  status: string;
  onReset$: PropFunction<() => void>;
}>((props) => {
  useContextProvider(
    AuthContext,
    useSignal<AuthState>({ user: null, loading: false }),
  );
  return (
    <QwikRouterMockProvider>
      <ConvexProvider>
        <section style="min-height: 100dvh; padding: 1rem 1.5rem; background: var(--color-paper-soft);">
          <div class="flex items-center gap-3">
            <button class="btn-paper text-xs" onClick$={props.onReset$}>
              Reset preview
            </button>
            <p role="status" class="text-xs text-[var(--color-ink-light)]">
              {props.status}
            </p>
          </div>
          <Slot />
        </section>
      </ConvexProvider>
    </QwikRouterMockProvider>
  );
});
