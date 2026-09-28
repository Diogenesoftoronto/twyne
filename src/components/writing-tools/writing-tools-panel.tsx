import {
  component$,
  useSignal,
  useVisibleTask$,
  type NoSerialize,
} from "@qwik.dev/core";
import type { Editor } from "@tiptap/core";
import { Link } from "@qwik.dev/router";
import { GrammarPanel } from "../editor/grammar-panel";
import { Icon } from "../ui/icon";
import { ReviewControls } from "./review-controls";
import { WritingTools } from "./writing-tools";

export const WritingToolsPanel = component$<{
  editor: NoSerialize<Editor> | null;
  readOnly?: boolean;
  active: boolean;
}>((props) => {
  const section = useSignal<"writing" | "grammar">("writing");
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(
    ({ cleanup }) => {
      const openGrammar = () => {
        section.value = "grammar";
      };
      window.addEventListener("twyne:open-grammar", openGrammar);
      cleanup(() =>
        window.removeEventListener("twyne:open-grammar", openGrammar),
      );
    },
    { strategy: "document-ready" },
  );
  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--color-paper-2)]">
      <div class="flex justify-end px-4 pt-2">
        <Link href="/help/review/" class="review-guide-link focus-ring">
          <Icon name="page" /> Review guide
        </Link>
      </div>
      <ReviewControls />
      <nav
        class="flex shrink-0 border-b border-[var(--color-paper-3)]"
        aria-label="Writing tools"
      >
        {(["writing", "grammar"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            class="writing-tools-tab focus-ring flex flex-1 items-center justify-center gap-2 px-3 py-3 text-sm"
            aria-pressed={section.value === tab}
            onClick$={() => {
              section.value = tab;
            }}
          >
            <Icon name={tab === "writing" ? "checklist" : "file-check"} />
            {tab === "writing" ? "Writing checks" : "Grammar"}
          </button>
        ))}
      </nav>
      <div
        class={
          section.value === "writing"
            ? "min-h-0 flex-1 overflow-y-auto"
            : "hidden"
        }
      >
        <WritingTools embedded />
      </div>
      {section.value === "grammar" && props.active && (
        <div class="min-h-0 flex-1">
          <GrammarPanel
            editor={props.editor}
            readOnly={props.readOnly}
            embedded
          />
        </div>
      )}
    </div>
  );
});
