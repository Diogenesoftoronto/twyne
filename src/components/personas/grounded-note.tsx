import {
  component$,
  useSignal,
  useVisibleTask$,
  type PropFunction,
} from "@qwik.dev/core";
import type { JSX } from "@qwik.dev/core";
import { renderMarkdown } from "../../utils/markdown";
import { useConvexClient } from "../../utils/convex-context";
import {
  currentManuscript,
  groundQuotations,
  linkQuotations,
  renderGroundedMarkdown,
  revealQuoteFromEvent,
} from "../../utils/quote-grounding";

interface GroundedNoteProps {
  text: string;
  "data-speech-id"?: string;
  manuscript?: string;
  class?: string;
  style?: JSX.IntrinsicElements["div"]["style"];
  title?: string;
  onClick$?: PropFunction<(event: Event) => void>;
}

/** Literal links render immediately; bounded assistance runs when the note is visible. */
export const GroundedNote = component$<GroundedNoteProps>((props) => {
  const client = useConvexClient();
  const observedDraft = useSignal<string>();
  const assisted = useSignal<{
    text: string;
    draft: string;
    html: string;
  } | null>(null);
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const text = track(() => props.text);
    const suppliedDraft = track(() => props.manuscript);
    const activeClient = track(() => client.value);
    let disposed = false;
    let generation = 0;
    let lastDraft = suppliedDraft ?? currentManuscript();
    observedDraft.value = lastDraft;
    const refresh = async () => {
      const current = ++generation;
      const draft = lastDraft;
      if (
        !draft ||
        groundQuotations(text, draft).every(
          (q) => q.resolution.status === "resolved",
        )
      )
        return;
      const { clientPersonaResearch } = await import(
        "../../utils/persona-research-client"
      );
      const { loadAiSettingsFromIdb } = await import("../../utils/idb");
      const research = await clientPersonaResearch(
        activeClient,
        (await loadAiSettingsFromIdb())?.judgement,
      );
      if (!research.extract && !research.judge) return;
      const { assistGroundedNote } = await import(
        "../../utils/quote-grounding-assist"
      );
      if (disposed || current !== generation) return;
      const grounded = await assistGroundedNote(text, draft, research);
      if (!disposed && current === generation)
        assisted.value = {
          text,
          draft,
          html: linkQuotations(renderMarkdown(text), grounded, draft),
        };
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (event?: Event) => {
      if (event) {
        const detail = (event as CustomEvent<string | { text?: string }>)
          .detail;
        const next = typeof detail === "string" ? detail : detail?.text;
        if (typeof next !== "string") return;
        if (next === lastDraft) return;
        lastDraft = next;
        observedDraft.value = next;
        generation++;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh().catch(() => {});
      }, 1200);
    };
    schedule();
    window.addEventListener("twyne:draft-text", schedule);
    window.addEventListener("twyne:content", schedule);
    cleanup(() => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("twyne:draft-text", schedule);
      window.removeEventListener("twyne:content", schedule);
    });
  });
  const draft = observedDraft.value ?? props.manuscript ?? currentManuscript();
  const html =
    assisted.value?.text === props.text && assisted.value.draft === draft
      ? assisted.value.html
      : renderGroundedMarkdown(props.text, draft);
  return (
    <div
      data-speech-id={props["data-speech-id"]}
      class={props.class}
      style={props.style}
      title={props.title}
      onClick$={async (event: Event) => {
        if (!revealQuoteFromEvent(event)) await props.onClick$?.(event);
      }}
      onKeyDown$={(event: Event) => revealQuoteFromEvent(event)}
      dangerouslySetInnerHTML={html}
    />
  );
});
