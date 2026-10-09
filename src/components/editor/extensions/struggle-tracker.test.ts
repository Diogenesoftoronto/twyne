import { expect, spyOn, test } from "bun:test";
import { withEditor } from "../test-harness";
import {
  InFlowAnchor,
  inFlowController,
  inFlowSnapshot,
  startInFlowTools,
} from "./struggle-tracker";
import * as grammar from "../../../utils/grammar";
import * as idb from "../../../utils/idb";
import * as context from "../../../utils/model-context";
import * as judgement from "../../../utils/judgement-client";
import * as localModels from "../../../utils/local-writing-models";
import {
  threadInstrumentController,
  threadInstrumentSnapshot,
} from "../../../utils/thread-instrument";

const sentence = "We made a decision to leave in order to find a quiet room.";
const content = `<p>The map remained. <strong>${sentence}</strong> We followed the river.</p>`;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
async function bench(run: Parameters<typeof withEditor>[1], html = content) {
  const spies = [
    spyOn(grammar, "checkGrammar").mockResolvedValue([]),
    spyOn(idb, "loadAiSettingsFromIdb").mockResolvedValue(null),
    spyOn(idb, "loadMetaFromIdb").mockResolvedValue(false),
    spyOn(context, "loadModelBriefForFolio").mockResolvedValue(null),
    spyOn(judgement, "askJudgement").mockResolvedValue({
      ok: false,
      transport: "none",
    }),
  ];
  try {
    await withEditor(
      { content: html, extensions: [InFlowAnchor] },
      async (harness) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          globalThis,
          "CustomEvent",
        );
        Object.defineProperty(globalThis, "CustomEvent", {
          configurable: true,
          value: harness.dom.window.CustomEvent,
        });
        const stop = startInFlowTools(harness.editor, {
          folioId: "sentence-fixture",
          brief: null,
          getClient: () => null,
        });
        try {
          await pause();
          inFlowController()!.openKind("sentence-lab", sentence);
          await pause();
          await run?.(harness);
        } finally {
          stop();
          await pause();
          if (descriptor)
            Object.defineProperty(globalThis, "CustomEvent", descriptor);
          else Reflect.deleteProperty(globalThis, "CustomEvent");
        }
      },
    );
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
}
test("complete offline candidates, in-manuscript ghost, checked rewrite and undo", async () => {
  await bench(async ({ editor }) => {
    const active = inFlowSnapshot().active!;
    expect(active.spec.elements.tool.type).toBe("SentenceLab");
    if (active.spec.elements.tool.type !== "SentenceLab")
      throw new Error("wrong tool");
    const candidate = active.spec.elements.tool.props.candidates!.find(
      (c) => c.operation === "Use a verb",
    )!;
    expect(candidate.grammar).toBe("checked");
    inFlowController()!.previewVariant(candidate.text);
    await pause();
    expect(
      editor.view.dom.querySelector(".sentence-bench-ghost")?.textContent,
    ).toBe(` ${candidate.text}`);
    expect(await inFlowController()!.applyVariant(candidate.text)).toBe(true);
    expect(editor.getText()).toContain("We decided to leave");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toContain(sentence);
  });
});
test("placement preserves inline marks and is a single undo transaction", async () => {
  await bench(({ editor }) => {
    const element = inFlowSnapshot().active!.spec.elements.tool;
    if (element.type !== "SentenceLab") throw new Error("wrong tool");
    const slot = element.props.placements!.find((s) => !s.before)!;
    expect(inFlowController()!.moveSentence(slot.id)).toBe(true);
    expect(editor.getText()).toBe(
      `${sentence} The map remained. We followed the river.`,
    );
    expect(editor.getHTML()).toContain(`<strong>${sentence}</strong>`);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getHTML()).toBe(content);
  });
});
test("changed source refuses both wording and placement instead of matching another copy", async () => {
  await bench(async ({ editor }) => {
    const active = inFlowSnapshot().active!;
    const element = active.spec.elements.tool;
    if (element.type !== "SentenceLab") throw new Error("wrong tool");
    const slot = element.props.placements![0];
    editor.view.dispatch(
      editor.state.tr.insertText("new ", active.sentenceFrom),
    );
    expect(
      await inFlowController()!.applyVariant(
        "We decided to leave for a quiet room.",
      ),
    ).toBe(false);
    expect(inFlowController()!.moveSentence(slot.id)).toBe(false);
    expect(editor.getText()).toContain(`new ${sentence}`);
  });
});
test("source edits during an asynchronous grammar check invalidate the pending apply", async () => {
  await bench(async ({ editor }) => {
    const active = inFlowSnapshot().active!;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lint = spyOn(grammar, "checkGrammar").mockImplementation(async () => {
      await pending;
      return [];
    });
    try {
      const apply = inFlowController()!.applyVariant(
        "We decided to leave for a quiet room.",
      );
      editor.view.dispatch(
        editor.state.tr.insertText("new ", active.sentenceFrom),
      );
      release!();
      expect(await apply).toBe(false);
      expect(editor.getText()).toContain(`new ${sentence}`);
    } finally {
      lint.mockRestore();
    }
  });
});

test("offline Threads mark indexed spans, remove a literal repeat and undo once", async () => {
  const repeated = "The ledger held every name we remembered.";
  const html = `<p><strong>${repeated}</strong> This was our only trace. ${repeated}</p>`;
  await bench(async ({ editor }) => {
    threadInstrumentController()!.open(repeated);
    await pause();
    const snapshot = threadInstrumentSnapshot();
    const thread = snapshot.threads.find(
      (t) => t.hypothesis === "exact-wording",
    )!;
    expect(thread.source).toBe("rule");
    expect(thread.relation).toBeUndefined();
    threadInstrumentController()!.preview(thread.id);
    await pause();
    expect(editor.view.dom.querySelectorAll(".twyne-thread-span")).toHaveLength(
      2,
    );
    expect(
      threadInstrumentController()!.removeRepeated(thread.id, thread.secondId),
    ).toBe(true);
    expect(editor.getHTML()).toBe(
      `<p><strong>${repeated}</strong> This was our only trace.</p>`,
    );
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getHTML()).toBe(html);
  }, html);
});

test("Threads refuses removal after any indexed span changes", async () => {
  const repeated = "The ledger held every name we remembered.";
  await bench(async ({ editor }) => {
    threadInstrumentController()!.open(repeated);
    await pause();
    const thread = threadInstrumentSnapshot().threads.find(
      (t) => t.hypothesis === "exact-wording",
    )!;
    editor.view.dispatch(
      editor.state.tr.insertText("new ", thread.second.from),
    );
    expect(threadInstrumentSnapshot().stale).toBe(true);
    expect(
      threadInstrumentController()!.removeRepeated(thread.id, thread.secondId),
    ).toBe(false);
    expect(editor.getText()).toContain(`new ${repeated}`);
  }, `<p>${repeated} This was our only trace. ${repeated}</p>`);
});

test("an edited spoken transcript is a checked candidate and never an automatic edit", async () => {
  await bench(async ({ editor }) => {
    const original = editor.getHTML();
    expect(
      await inFlowController()!.acceptSpokenCandidate(
        "We chose a quiet room before leaving.",
      ),
    ).toBe(true);
    expect(editor.getHTML()).toBe(original);
    const element = inFlowSnapshot().active!.spec.elements.tool;
    if (element.type !== "SentenceLab") throw new Error("wrong tool");
    expect(element.props.candidates![0]).toMatchObject({
      source: "spoken",
      grammar: "checked",
      text: "We chose a quiet room before leaving.",
    });
    expect(
      await inFlowController()!.acceptSpokenCandidate("We chose a qui"),
    ).toBe(false);
    expect(
      await inFlowController()!.applyVariant(element.props.candidates![0].text),
    ).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getHTML()).toBe(original);
  });
});

test("on-device word likelihood is kept distinct from meaning and carries apply provenance", async () => {
  await bench(async ({ editor }) => {
    const fake = spyOn(localModels, "localWritingWords").mockResolvedValue([
      {
        text: sentence.replace("quiet", "silent"),
        word: "silent",
        probability: 0.41,
        model: "test-fill-mask",
      },
    ]);
    try {
      const from = sentence.indexOf("quiet");
      const candidates = await inFlowController()!.wordVariants(
        from,
        from + "quiet".length,
      );
      expect(candidates[0]).toMatchObject({
        source: "on-device",
        grammar: "checked",
        likelihood: { probability: 0.41, model: "test-fill-mask" },
      });
      expect(candidates[0].meaning).toBeUndefined();
      let source: unknown;
      const transaction = ({
        transaction: tr,
      }: {
        transaction: import("@tiptap/pm/state").Transaction;
      }) => {
        if (tr.getMeta("twyne:sentence-instrument"))
          source = tr.getMeta("twyne:sentence-instrument").source;
      };
      editor.on("transaction", transaction);
      expect(await inFlowController()!.applyVariant(candidates[0].text)).toBe(
        true,
      );
      editor.off("transaction", transaction);
      expect(source).toBe("on-device");
    } finally {
      fake.mockRestore();
    }
  });
});

test("on-device thread proposals are explicit, bounded, observed and stale-safe", async () => {
  const status = spyOn(localModels, "localWritingStatus").mockResolvedValue({
    phase: "ready",
  } as Awaited<ReturnType<typeof localModels.localWritingStatus>>);
  const embedded: string[][] = [];
  const vectors = spyOn(localModels, "embedWritingPassages").mockImplementation(
    async (texts) => {
      embedded.push(texts);
      return texts.map((_, i) => (i === 0 ? [1, 0] : [0.8, 0.6]));
    },
  );
  try {
    await bench(async ({ editor }) => {
      const controller = threadInstrumentController()!;
      controller.open(sentence);
      await pause();
      expect(embedded).toHaveLength(0);
      expect(await controller.suggestWithEmbeddings()).toBe(true);
      expect(embedded[0].length).toBeLessThanOrEqual(32);
      expect(embedded[0].every((t) => t.length <= 2000)).toBe(true);
      const neighbours = threadInstrumentSnapshot().threads.filter(
        (t) => t.source === "on-device",
      );
      expect(neighbours.length).toBeGreaterThan(0);
      expect(neighbours[0].embedding?.cosine).toBeCloseTo(0.8);
      expect(neighbours[0].relation).toBeUndefined();
      editor.view.dispatch(editor.state.tr.insertText("changed ", 1));
      expect(await controller.suggestWithEmbeddings()).toBe(false);
      expect(embedded).toHaveLength(1);
    });
  } finally {
    status.mockRestore();
    vectors.mockRestore();
  }
});
