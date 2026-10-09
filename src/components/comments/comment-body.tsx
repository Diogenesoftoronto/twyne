import { component$ } from "@qwik.dev/core";
import { parseInstrumentComment } from "../../utils/instrument-comment";
import { renderMarkdown } from "../../utils/markdown";

/** The stored/provider body remains intact; only its presentation is condensed. */
export const CommentBody = component$<{ text: string }>(({ text }) => {
  const invitation = parseInstrumentComment(text);
  if (!invitation)
    return <div dangerouslySetInnerHTML={renderMarkdown(text)} />;
  return (
    <>
      <p
        class="mb-2 text-xs text-[var(--color-ink-muted)]"
        style="font-family: var(--font-typewriter);"
      >
        {invitation.instrument} · {invitation.personaName}
      </p>
      <div dangerouslySetInnerHTML={renderMarkdown(invitation.question)} />
      <details class="mt-3 text-xs text-[var(--color-ink-muted)]">
        <summary class="cursor-pointer">Passage and invitation details</summary>
        <div
          class="mt-2 text-sm leading-6 text-[var(--color-ink-light)]"
          dangerouslySetInnerHTML={renderMarkdown(text)}
        />
      </details>
    </>
  );
});
