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
import * as aiClient from "../../../utils/ai-client";
import { EndnoteNode } from "./endnote-node";
import * as speech from "../../../utils/speech";
import {
  threadInstrumentController,
  threadInstrumentSnapshot,
} from "../../../utils/thread-instrument";

const sentence = "We made a decision to leave in order to find a quiet room.";
const content = `<p>The map remained. <strong>${sentence}</strong> We followed the river.</p>`;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
/** Spec changes after an edit reach the snapshot on a 120 ms debounce. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 160));
let judgementSpy: { mock: { calls: unknown[] } } | null = null;
const judgementCalls = () => judgementSpy?.mock.calls.length ?? 0;
async function bench(
  run: Parameters<typeof withEditor>[1],
  html = content,
  onAskRoom?: Parameters<typeof startInFlowTools>[1]["onAskRoom"],
  narration?: Pick<
    Parameters<typeof startInFlowTools>[1],
    "getClient" | "isSignedIn"
  >,
  extensions: Parameters<typeof withEditor>[0] extends infer O
    ? O extends { extensions?: infer E }
      ? E
      : never
    : never = [],
) {
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
  judgementSpy = spies.at(-1)!;
  try {
    await withEditor(
      { content: html, extensions: [InFlowAnchor, ...(extensions ?? [])] },
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
          onAskRoom,
          ...narration,
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
test("room handoff keeps the exact originating tool and refuses stale sentence requests", async () => {
  const calls: { text: string; from: number; to: number }[] = [];
  const request = {
    personaId: "editor",
    personaName: "M. Le Stylo",
    body: "Review this unapplied wording.",
  };
  await bench(
    async ({ editor }) => {
      const active = inFlowSnapshot().active!;
      expect(
        (await inFlowController()!.askRoom(request, "another-tool")).ok,
      ).toBe(false);
      expect(calls).toHaveLength(0);
      expect((await inFlowController()!.askRoom(request, active.id)).ok).toBe(
        true,
      );
      expect(calls).toEqual([
        { text: sentence, from: active.sentenceFrom!, to: active.sentenceTo! },
      ]);
      expect(editor.getHTML()).toBe(content);
      inFlowController()!.openKind("sentence-lab", sentence);
      await pause();
      const reopened = inFlowSnapshot().active!;
      editor.view.dispatch(
        editor.state.tr.insertText("new ", reopened.sentenceFrom),
      );
      expect((await inFlowController()!.askRoom(request, reopened.id)).ok).toBe(
        false,
      );
      expect(calls).toHaveLength(1);
    },
    content,
    async (_request, anchor) => {
      calls.push({ text: anchor.text, from: anchor.from, to: anchor.to });
      return { ok: true };
    },
  );
});

test("Threads room handoff validates both passages and the originating index", async () => {
  const repeated = "The ledger held every name we remembered.";
  let calls = 0;
  const request = {
    personaId: "reader",
    personaName: "Le Lecteur",
    body: "Does this recurrence help?",
  };
  await bench(
    async ({ editor }) => {
      threadInstrumentController()!.open(repeated);
      await pause();
      const current = threadInstrumentSnapshot();
      const pair = current.threads.find(
        (item) => item.hypothesis === "exact-wording",
      )!;
      expect(
        (
          await threadInstrumentController()!.askRoom(
            request,
            pair.id,
            "old-index",
          )
        ).ok,
      ).toBe(false);
      editor.view.dispatch(
        editor.state.tr.insertText("new ", pair.second.from),
      );
      expect(
        (
          await threadInstrumentController()!.askRoom(
            request,
            pair.id,
            current.index.fingerprint,
          )
        ).ok,
      ).toBe(false);
      expect(calls).toBe(0);
    },
    `<p>${repeated} This was our trace. ${repeated}</p>`,
    async () => {
      calls++;
      return { ok: true };
    },
  );
});
test("Hear passes current authentication and reads unfinished wording in its real context", async () => {
  const speak = spyOn(speech, "speak").mockResolvedValue(undefined);
  const client = {} as import("convex/browser").ConvexClient;
  let signedIn = true;
  try {
    await bench(
      () => {
        const controller = inFlowController()!;
        const id = inFlowSnapshot().active!.id;
        expect(controller.hearVariant("A quieter room")).toBe(true);
        expect(speak).toHaveBeenLastCalledWith({
          id: `sentence-bench-${id}`,
          text: "The map remained. A quieter room We followed the river.",
          label: "Sentence bench",
          client,
          signedIn: true,
        });
        signedIn = false;
        expect(controller.hearVariant(sentence)).toBe(true);
        expect(speak.mock.calls.at(-1)?.[0].signedIn).toBe(false);
        expect(controller.hearVariant(" ")).toBe(false);
        expect(speak).toHaveBeenCalledTimes(2);
      },
      content,
      undefined,
      { getClient: () => client, isSignedIn: () => signedIn },
    );
  } finally {
    speak.mockRestore();
  }
});
const lab = () => {
  const element = inFlowSnapshot().active?.spec.elements.tool;
  if (element?.type !== "SentenceLab") throw new Error("wrong tool");
  return element.props;
};
const select = (
  editor: import("@tiptap/core").Editor,
  text: string,
  occurrence = 0,
) => {
  let found: { from: number; to: number } | null = null;
  let seen = 0;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    for (
      let i = node.text!.indexOf(text);
      i >= 0;
      i = node.text!.indexOf(text, i + 1)
    )
      if (seen++ === occurrence) {
        found = { from: pos + i, to: pos + i + text.length };
        break;
      }
    return !found;
  });
  if (!found) throw new Error(`absent: ${text}`);
  editor.commands.setTextSelection(found);
};

test("opening Compare a revision makes no request and changes nothing", async () => {
  const generate = spyOn(aiClient, "runClientInFlowTool");
  try {
    await bench(async ({ editor }) => {
      const props = lab();
      expect(props).toMatchObject({ sentence, stale: false });
      expect(props.context?.before).toBe("The map remained. ");
      expect(props.refusal).toBeUndefined();
      expect(inFlowSnapshot().active?.status).toBe("ready");
      expect(editor.getHTML()).toBe(content);
      expect(generate).not.toHaveBeenCalled();
      expect(judgementCalls()).toBe(0);
    });
  } finally {
    generate.mockRestore();
  }
});

test("targets the selected duplicate sentence by position", async () => {
  const twice = "It rained.";
  const html = `<p>${twice} The roads closed. ${twice}</p>`;
  await bench(async ({ editor }) => {
    select(editor, twice, 1);
    inFlowController()!.openKind("sentence-lab", twice);
    await pause();
    const active = inFlowSnapshot().active!;
    expect(lab().refusal).toBeUndefined();
    expect(lab().context?.after).toBe("");
    expect(inFlowController()!.applyRevision("It poured.")).toEqual({
      ok: true,
    });
    expect(editor.getText()).toBe("It rained. The roads closed. It poured.");
    expect(active.sentenceFrom).toBeGreaterThan(20);
  }, html);
});

test("refuses a duplicate passage it cannot locate and a multi-sentence selection", async () => {
  const twice = "It rained.";
  const html = `<p>${twice} The roads closed. ${twice}</p><p>Elsewhere.</p>`;
  await bench(async ({ editor }) => {
    select(editor, "Elsewhere.");
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    inFlowController()!.openKind("sentence-lab", twice);
    await pause();
    expect(lab().refusal).toContain("more than once");
    expect(inFlowController()!.applyRevision("It poured.").ok).toBe(false);

    select(editor, "rained. The roads");
    inFlowController()!.openKind("sentence-lab", "rained. The roads");
    await pause();
    expect(lab().refusal).toContain("2 sentences");
    expect(editor.getHTML()).toBe(html);
  }, html);
});

test("use revision preserves marks and inline notes, applies once and undoes once", async () => {
  const html = `<p>The map remained. We <strong>made a decision</strong> to leave<sup data-type="endnote" data-endnote-text="Diary, 3 May"></sup> in order to find a quiet room. We followed the river.</p>`;
  await bench(
    async ({ editor, dom }) => {
      // Undo scrolls to the restored selection; JSDOM has no layout boxes.
      for (const type of [
        dom.window.Range,
        dom.window.Text,
        dom.window.Element,
      ]) {
        type.prototype.getClientRects ??= () => [];
        type.prototype.getBoundingClientRect ??= () => ({
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
        });
      }
      const loaded = editor.getHTML();
      select(editor, "quiet");
      inFlowController()!.openKind("sentence-lab", "quiet");
      await pause();
      const original = lab().sentence;
      expect(original).toBe(sentence);
      let steps = 0;
      const count = () => steps++;
      editor.on("transaction", count);
      expect(
        inFlowController()!.applyRevision(
          "We made a decision to leave to find a silent room. It was late",
        ),
      ).toEqual({ ok: true });
      editor.off("transaction", count);
      expect(editor.getText()).toBe(
        "The map remained. We made a decision to leave to find a silent room. It was late We followed the river.",
      );
      const out = editor.getHTML();
      expect(out).toContain("<strong>made a decision</strong>");
      expect(out).toContain('data-endnote-text="Diary, 3 May"');
      expect(inFlowSnapshot().active).toBeNull();
      expect(editor.isFocused || editor.state.selection.empty).toBe(true);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getHTML()).toBe(loaded);
      expect(editor.commands.undo()).toBe(false);
    },
    html,
    undefined,
    undefined,
    [EndnoteNode],
  );
});

test("refuses edits that would drop an inline note or split formatting", async () => {
  // The note sits inside "left", so replacing that word would delete it.
  const html = `<p>We lef<sup data-type="endnote" data-endnote-text="Diary"></sup>t at dawn and <em>walked</em> fast.</p>`;
  await bench(
    async ({ editor }) => {
      select(editor, "dawn");
      inFlowController()!.openKind("sentence-lab", "dawn");
      await pause();
      const across = inFlowController()!.applyRevision(
        "We went at dawn and walked fast.",
      );
      expect(across.ok).toBe(false);
      if (!across.ok) expect(across.message).toContain("inline element");
      const formatted = inFlowController()!.applyRevision(
        "We left at first light and strode fast.",
      );
      expect(formatted).toEqual({ ok: true });
      expect(editor.getHTML()).toContain("<em>strode</em>");
      expect(editor.getHTML()).toContain('data-endnote-text="Diary"');
    },
    html,
    undefined,
    undefined,
    [EndnoteNode],
  );
  await bench(async ({ editor }) => {
    select(editor, "decision");
    inFlowController()!.openKind("sentence-lab", "decision");
    await pause();
    // The changed run spans bold and plain text: refuse, never guess.
    const result = inFlowController()!.applyRevision(
      "We chose leave in order to find a quiet room.",
    );
    expect(result.ok).toBe(false);
    expect(editor.getHTML()).toContain("<strong>made a decision</strong>");
  }, `<p>We <strong>made a decision</strong> to leave in order to find a quiet room.</p>`);
});

test("a changed source refuses use and keeps the bench open; Keep original never edits", async () => {
  await bench(async ({ editor }) => {
    const active = inFlowSnapshot().active!;
    editor.view.dispatch(
      editor.state.tr.insertText("new ", active.sentenceFrom),
    );
    await settle();
    expect(lab().stale).toBe(true);
    const result = inFlowController()!.applyRevision(
      "We left for a quiet room.",
    );
    expect(result.ok).toBe(false);
    expect(inFlowSnapshot().active?.id).toBe(active.id);
    expect(editor.getText()).toContain(`new ${sentence}`);
    const before = editor.getHTML();
    inFlowController()!.closeRevision();
    expect(inFlowSnapshot().active).toBeNull();
    expect(editor.getHTML()).toBe(before);
  });
});

test("an edit elsewhere in the paragraph also marks the source stale", async () => {
  await bench(async ({ editor }) => {
    editor.view.dispatch(editor.state.tr.insertText("Old ", 1));
    await settle();
    expect(lab().stale).toBe(true);
    expect(inFlowController()!.applyRevision("We left.").ok).toBe(false);
  });
});

test("read the difference sends one bound request and discards stale answers", async () => {
  let release: ((text: string) => void) | undefined;
  const prompts: string[] = [];
  const generate = spyOn(aiClient, "runClientInFlowTool").mockImplementation(
    (request) => {
      prompts.push(request.prompt);
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  );
  try {
    await bench(async ({ editor }) => {
      spyOn(idb, "loadAiSettingsFromIdb").mockResolvedValue({
        advancedMode: true,
        providers: [{ id: "p", type: "openai", apiKey: "k" }],
      } as never);
      const id = inFlowSnapshot().active!.id;
      const props = lab();
      const binding = {
        original: props.sentence,
        trial: "We decided to leave for a quiet room.",
        before: props.context!.before,
        after: props.context!.after,
      };
      const reading = inFlowController()!.readRevision(id, binding);
      await pause();
      expect(prompts).toHaveLength(1);
      release!(
        JSON.stringify({
          observations: [
            {
              originalQuote: "in order to find",
              trialQuote: "for",
              reading: "The purpose becomes a destination.",
            },
          ],
        }),
      );
      expect(await reading).toMatchObject({
        ok: true,
        binding,
        observations: [
          { originalQuote: "in order to find", trialQuote: "for" },
        ],
      });

      const mismatched = await inFlowController()!.readRevision(id, {
        ...binding,
        before: "Something else. ",
      });
      expect(mismatched).toMatchObject({ ok: false, reason: "stale" });
      expect(prompts).toHaveLength(1);

      const late = inFlowController()!.readRevision(id, binding);
      await pause();
      editor.view.dispatch(editor.state.tr.insertText("Old ", 1));
      release!(JSON.stringify({ observations: [] }));
      expect(await late).toMatchObject({ ok: false, reason: "stale" });
      expect(editor.getText()).toContain(sentence);
    });
  } finally {
    generate.mockRestore();
  }
});

test("without a configured provider, reading reports it and sends nothing", async () => {
  const generate = spyOn(aiClient, "runClientInFlowTool");
  try {
    await bench(async () => {
      const props = lab();
      const result = await inFlowController()!.readRevision(
        inFlowSnapshot().active!.id,
        {
          original: props.sentence,
          trial: "We left.",
          before: props.context!.before,
          after: props.context!.after,
        },
      );
      expect(result).toMatchObject({ ok: false, reason: "no-provider" });
      expect(generate).not.toHaveBeenCalled();
    });
  } finally {
    generate.mockRestore();
  }
});

test("an edited spoken transcript becomes the trial and never an automatic edit", async () => {
  await bench(async ({ editor }) => {
    const original = editor.getHTML();
    expect(
      await inFlowController()!.acceptSpokenCandidate(
        "We chose a quiet room before leaving",
      ),
    ).toBe(true);
    expect(editor.getHTML()).toBe(original);
    expect(lab().trial).toBe("We chose a quiet room before leaving");
    expect(await inFlowController()!.acceptSpokenCandidate("  ")).toBe(false);
  });
});

test("a repeated rewrite never opens Compare a revision by itself", async () => {
  await bench(async () => {
    inFlowController()!.dismiss();
    expect(inFlowSnapshot().active).toBeNull();
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
