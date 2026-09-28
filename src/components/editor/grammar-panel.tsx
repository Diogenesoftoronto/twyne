import {
  $,
  component$,
  useStore,
  useVisibleTask$,
  type NoSerialize,
  type PropFunction,
} from "@qwik.dev/core";
import { Icon } from "../ui/icon";
import type { Editor } from "@tiptap/core";
import {
  checkGrammar,
  getGrammarChoices,
  rememberGrammarChoice,
  forgetGrammarChoice,
  isEnglishLanguage,
  scalarOffsetToCodeUnit,
  type GrammarIssue,
  type GrammarChoice,
} from "../../utils/grammar";

interface GrammarPanelProps {
  editor: NoSerialize<Editor> | null;
  readOnly?: boolean;
  embedded?: boolean;
  onClose$?: PropFunction<() => void>;
}

interface LocatedGrammarIssue extends GrammarIssue {
  from: number;
  to: number;
}

interface GrammarPanelStore {
  status: "loading" | "ready" | "error";
  issues: LocatedGrammarIssue[];
  error: string;
  scan: number;
  unsupportedLanguage: boolean;
  choices: GrammarChoice[];
  notice: string;
}

interface TextBlock {
  text: string;
  docStart: number;
}

function collectTextBlocks(editor: Editor): TextBlock[] {
  const blocks: TextBlock[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (node.textContent.trim()) {
      blocks.push({ text: node.textContent, docStart: pos + 1 });
    }
    return false;
  });
  return blocks;
}

/** Compact, progressive grammar desk backed by Harper's local WASM worker. */
export const GrammarPanel = component$<GrammarPanelProps>((props) => {
  const store = useStore<GrammarPanelStore>({
    status: "loading",
    issues: [],
    error: "",
    scan: 0,
    unsupportedLanguage: false,
    choices: [],
    notice: "",
  });

  const scan = $(async () => {
    const editor = props.editor;
    if (!editor) return;
    const mine = ++store.scan;
    store.status = "loading";
    store.error = "";
    const language =
      editor.view.dom.closest("[lang]")?.getAttribute("lang") ?? "";
    store.unsupportedLanguage = !isEnglishLanguage(language);
    if (store.unsupportedLanguage) {
      store.issues = [];
      store.status = "ready";
      return;
    }
    try {
      store.choices = getGrammarChoices();
      const located: LocatedGrammarIssue[] = [];
      for (const block of collectTextBlocks(editor)) {
        // A newer edit or an unmounted panel invalidates this pass. Check on
        // both sides of the worker request so an obsolete document scan never
        // continues issuing one request per remaining block.
        if (mine !== store.scan) return;
        const issues = await checkGrammar(block.text, language);
        if (mine !== store.scan) return;
        for (const issue of issues) {
          located.push({
            ...issue,
            from:
              block.docStart + scalarOffsetToCodeUnit(block.text, issue.start),
            to: block.docStart + scalarOffsetToCodeUnit(block.text, issue.end),
          });
        }
      }
      if (mine !== store.scan) return;
      store.issues = located;
      store.status = "ready";
    } catch (error) {
      if (mine !== store.scan) return;
      store.status = "error";
      store.error =
        error instanceof Error
          ? error.message
          : "Harper could not check this draft.";
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const editor = track(() => props.editor);
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void scan(), 700);
    };
    editor.on("update", schedule);
    void scan();
    cleanup(() => {
      if (timer) clearTimeout(timer);
      editor.off("update", schedule);
      store.scan += 1;
    });
  });

  const visit = $((issue: LocatedGrammarIssue) => {
    props.editor
      ?.chain()
      .focus()
      .setTextSelection({ from: issue.from, to: issue.to })
      .run();
  });

  const apply = $((issue: LocatedGrammarIssue, replacement: string) => {
    const editor = props.editor;
    if (!editor || props.readOnly) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: issue.from, to: issue.to }, replacement)
      .run();
  });

  const remember = $(async (issue: LocatedGrammarIssue) => {
    try {
      rememberGrammarChoice(issue);
      store.notice = `“${issue.problem}” saved as intentional. Matching suggestions will be ignored in this browser.`;
      await scan();
    } catch {
      store.notice =
        "Could not save this choice. Browser storage may be unavailable.";
    }
  });

  const forget = $(async (choice: GrammarChoice) => {
    try {
      forgetGrammarChoice(choice);
      store.notice = `“${choice.problem}” removed. Suggestions are enabled again.`;
      await scan();
    } catch {
      store.notice =
        "Could not remove this choice. Browser storage may be unavailable.";
    }
  });

  return (
    <aside
      class={
        props.embedded
          ? "flex h-full min-h-0 flex-col bg-[var(--color-paper-2)]"
          : "fixed bottom-16 right-4 top-20 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border border-[var(--color-paper-3)] bg-[var(--color-paper)]"
      }
      style={
        props.embedded
          ? undefined
          : {
              zIndex: "var(--z-dropdown)",
              borderRadius: "4px",
              boxShadow:
                "0 4px 8px color-mix(in srgb, var(--shade) 20%, transparent)",
            }
      }
      aria-label="Grammar suggestions"
    >
      <div class="flex items-center justify-between gap-3 border-b border-[var(--color-paper-3)] bg-[var(--color-paper-soft)] px-4 py-2.5">
        <div>
          <p class="dept-label">Grammar desk</p>
          <p
            class="mt-0.5 text-[0.62rem] text-[var(--color-ink-muted)]"
            style={{ fontFamily: "var(--font-typewriter)" }}
          >
            Harper runs here in your browser.
          </p>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="tool-btn"
            onClick$={scan}
            disabled={store.status === "loading"}
            aria-label="Check grammar again"
            title="Check grammar again"
          >
            <Icon name="redo" />
          </button>
          {!props.embedded && (
            <button
              type="button"
              class="tool-btn"
              onClick$={props.onClose$}
              aria-label="Close grammar desk"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        {store.notice && (
          <p class="mb-3 text-xs text-[var(--color-ink-muted)]" role="status">
            {store.notice}
          </p>
        )}
        {store.choices.length > 0 && (
          <details class="mb-4 text-xs text-[var(--color-ink-muted)]">
            <summary class="cursor-pointer">
              Your dictionary · {store.choices.length} intentional choices
            </summary>
            <p class="my-2">
              Saved in this browser. Remove a choice to check it again.
            </p>
            <ul class="space-y-2">
              {store.choices.map((choice) => (
                <li
                  key={JSON.stringify(choice)}
                  class="flex items-center justify-between gap-2"
                >
                  <span>
                    “{choice.problem}” · {choice.kind}
                  </span>
                  <button
                    type="button"
                    class="card-key"
                    onClick$={() => forget(choice)}
                    aria-label={`Remove intentional choice for ${choice.problem}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {store.status === "loading" && (
          <div class="space-y-2" role="status">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                class="h-16 animate-pulse bg-[var(--color-paper-soft)]"
                style={{ borderRadius: "3px" }}
              />
            ))}
            <p class="sr-only">Checking grammar</p>
          </div>
        )}

        {store.status === "error" && (
          <div class="space-y-3" role="alert">
            <p class="text-xs leading-5 text-[var(--color-accent-red)]">
              {store.error}
            </p>
            <button type="button" class="btn-paper text-xs" onClick$={scan}>
              Try grammar check again
            </button>
          </div>
        )}

        {store.status === "ready" && store.unsupportedLanguage && (
          <div class="py-8 text-center" role="status">
            <p
              class="text-lg text-[var(--color-ink)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              English drafts only
            </p>
            <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
              Harper is paused because this document is not marked as English.
            </p>
          </div>
        )}

        {store.status === "ready" &&
          !store.unsupportedLanguage &&
          store.issues.length === 0 && (
            <div class="py-8 text-center" role="status">
              <p
                class="text-lg text-[var(--color-accent-green)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                No suggestions
              </p>
              <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
                No issues remain after your intentional choices.
              </p>
            </div>
          )}

        {store.status === "ready" &&
          !store.unsupportedLanguage &&
          store.issues.length > 0 && (
            <div class="space-y-2">
              <p
                class="mb-3 text-[0.62rem] text-[var(--color-ink-muted)]"
                style={{ fontFamily: "var(--font-typewriter)" }}
                role="status"
              >
                {store.issues.length} suggestion
                {store.issues.length === 1 ? "" : "s"}
              </p>
              {store.issues.map((issue) => (
                <article
                  key={issue.id}
                  class="desk-card border border-[var(--color-paper-3)] bg-[var(--color-paper-soft)]"
                  style={{ ["--card-accent" as never]: "var(--color-mustard)" }}
                >
                  {/* The flagged words are the headline; what kind of slip
                    it is gets stamped opposite, and Harper's explanation
                    reads as the note beneath. */}
                  <div class="desk-card__head">
                    <p class="desk-card__name desk-card__name--wrap">
                      “{issue.problem}”
                    </p>
                    <div class="flex shrink-0 items-center gap-2">
                      <span class="desk-card__stamp">{issue.kind}</span>
                      <button
                        type="button"
                        class="tool-btn"
                        onClick$={() => remember(issue)}
                        aria-label={`Keep “${issue.problem}” as intentional and remember this choice`}
                        title="Intentional — remember and ignore matching suggestions"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  </div>
                  <p class="desk-card__body">{issue.message}</p>
                  {/* The replacements are the point of the card, so they
                    take the left of the foot; jumping to the passage is
                    the secondary move and sits opposite. */}
                  <div class="desk-card__foot">
                    <div class="desk-card__foot-start">
                      {!props.readOnly &&
                        issue.suggestions.slice(0, 3).map((suggestion) => (
                          <button
                            key={suggestion || "remove"}
                            type="button"
                            class="card-key card-key--go max-w-full truncate"
                            title={
                              suggestion
                                ? `Replace with “${suggestion}”`
                                : "Remove text"
                            }
                            onClick$={() => apply(issue, suggestion)}
                          >
                            {suggestion || "Remove"}
                          </button>
                        ))}
                    </div>
                    <div class="desk-card__foot-end">
                      <button
                        type="button"
                        class="card-key"
                        onClick$={() => visit(issue)}
                        title="Select this passage in the draft"
                      >
                        <Icon name="search" /> Show passage
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
      </div>
    </aside>
  );
});
