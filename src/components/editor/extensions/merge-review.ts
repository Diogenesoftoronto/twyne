/**
 * Merge review: the sentences a fold carried into a paragraph stay marked in
 * the manuscript until the writer keeps the change or puts it back.
 *
 * The marks are decorations, not part of the document: they follow the text
 * through later edits, vanish with the text if the fold is undone, and never
 * reach the saved draft.
 */
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export interface ReviewRange {
  from: number;
  to: number;
}

type ReviewMeta = { add: ReviewRange[] } | "clear";

export const mergeReviewKey = new PluginKey<DecorationSet>("twyneMergeReview");

const marks = (ranges: ReviewRange[]) =>
  ranges
    .filter((range) => range.to > range.from)
    .map((range) =>
      Decoration.inline(range.from, range.to, {
        class: "merge-review__carried",
      }),
    );

export function mergeReviewPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: mergeReviewKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const meta = tr.getMeta(mergeReviewKey) as ReviewMeta | undefined;
        if (meta === "clear") return DecorationSet.empty;
        const mapped = tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
        return meta ? mapped.add(tr.doc, marks(meta.add)) : mapped;
      },
    },
    props: {
      decorations: (state) => mergeReviewKey.getState(state),
    },
  });
}

/** Mark these ranges of the document `tr` produces, beside any already up. */
export const addMergeReview = (tr: Transaction, ranges: ReviewRange[]) =>
  tr.setMeta(mergeReviewKey, { add: ranges } satisfies ReviewMeta);

export function clearMergeReview(view: EditorView): void {
  if (!mergeReviewKey.getState(view.state)?.find().length) return;
  view.dispatch(
    view.state.tr
      .setMeta(mergeReviewKey, "clear" satisfies ReviewMeta)
      .setMeta("addToHistory", false),
  );
}
