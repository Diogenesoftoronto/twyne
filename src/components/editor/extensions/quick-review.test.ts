import { expect, test } from "bun:test";
import type { ConvexClient } from "convex/browser";
import { withEditor } from "../test-harness";
import { QuickReview, startQuickReview } from "./quick-review";

const paragraph =
  "The proposal says the bridge can carry every vehicle in the region, although no source or study is given to support that assertion.";
const result = {
  ok: true,
  answers: {
    attention: {
      type: "choice",
      choice: "Check evidence",
      confidence: 0.9,
      probabilities: { "Check evidence": 0.9 },
    },
  },
};

test("quick review paints feedback without changing saved text, then removes it on editing", async () => {
  await withEditor(
    { content: `<p>${paragraph}</p>`, extensions: [QuickReview] },
    async ({ editor, dom, host, html }) => {
      Object.defineProperty(dom.window.document, "hidden", { value: false });
      const prior = globalThis.CustomEvent;
      globalThis.CustomEvent = dom.window.CustomEvent;
      const client = { action: async () => result } as unknown as ConvexClient;
      const before = html();
      const stop = startQuickReview(
        editor,
        () => client,
        "quick-feedback",
        null,
      );
      try {
        await Bun.sleep(800);
        expect(host.querySelector(".twyne-quick-review-marker")).not.toBeNull();
        expect(html()).toBe(before);
        editor.commands.insertContent("Changed. ");
        expect(host.querySelector(".twyne-quick-review-marker")).toBeNull();
      } finally {
        stop();
        globalThis.CustomEvent = prior;
      }
    },
  );
});

test("a response for an earlier paragraph cannot paint the changed draft", async () => {
  await withEditor(
    { content: `<p>${paragraph}</p>`, extensions: [QuickReview] },
    async ({ editor, dom, host }) => {
      Object.defineProperty(dom.window.document, "hidden", { value: false });
      const prior = globalThis.CustomEvent;
      globalThis.CustomEvent = dom.window.CustomEvent;
      let resolve!: (value: typeof result) => void;
      const response = new Promise<typeof result>((done) => {
        resolve = done;
      });
      const client = { action: () => response } as unknown as ConvexClient;
      const stop = startQuickReview(
        editor,
        () => client,
        "stale-feedback",
        null,
      );
      try {
        await Bun.sleep(750);
        editor.commands.insertContent("A correction. ");
        resolve(result);
        await Bun.sleep(20);
        expect(host.querySelector(".twyne-quick-review-marker")).toBeNull();
      } finally {
        stop();
        globalThis.CustomEvent = prior;
      }
    },
  );
});
