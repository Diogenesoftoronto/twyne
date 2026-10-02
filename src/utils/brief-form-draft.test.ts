import { describe, expect, test } from "bun:test";
import {
  briefDraftKey,
  claimBriefDraftHandoff,
  clearBriefFormDraft,
  loadBriefFormDraft,
  moveBriefFormDraft,
  prepareBriefDraftHandoff,
  saveBriefFormDraft,
  type BriefFormDraft,
} from "./brief-form-draft";
function storage() {
  const rows = new Map<string, string>();
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}
const scope = "create:new";
const draft: BriefFormDraft = {
  answers: {
    workingTitle: "Long brief",
    format: "Essay",
    audience: "Specialists",
    goal: "A lengthy objective",
    tone: "Precise",
    constraints: "Preserve evidence",
    successSignal: "Reader understands",
  },
  attachments: [
    {
      id: "reference",
      kind: "document",
      title: "Evidence",
      text: "Full reference",
      why: "Required",
      addedAt: 1,
    },
  ],
  probes: [
    { id: "probe", kind: "blanks", prompt: "Specifics", answer: ["A", "B"] },
  ],
  existingMaterial: "Lengthy manuscript",
  importedFilename: "notes.txt",
  step: 9,
};
describe("brief form recovery", () => {
  test("retains every field and empty edits across a reload", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, null, "", draft);
    expect(loadBriefFormDraft(s, scope, null, "")).toEqual(draft);
    const newer = { ...draft, answers: { ...draft.answers, goal: "" } };
    saveBriefFormDraft(s, scope, null, "", newer);
    expect(loadBriefFormDraft(s, scope, null, "")).toEqual(newer);
  });
  test("isolates folios and accounts; signing out cannot open an account draft", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, "alice", "", draft);
    for (const owner of [null, "bob"])
      expect(loadBriefFormDraft(s, scope, owner, "")).toBeNull();
    expect(loadBriefFormDraft(s, "create:other", "alice", "")).toBeNull();
    expect(prepareBriefDraftHandoff(s)).toBeUndefined();
  });
  test("explicit handoff claims a guest draft once for the confirmed account", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, null, "", draft);
    const handoff = prepareBriefDraftHandoff(s);
    claimBriefDraftHandoff(s, handoff, "alice");
    expect(loadBriefFormDraft(s, scope, "alice", "")).toEqual(draft);
    expect(loadBriefFormDraft(s, scope, null, "")).toBeNull();
    claimBriefDraftHandoff(s, handoff, "bob");
    expect(loadBriefFormDraft(s, scope, "bob", "")).toBeNull();
  });
  test("cancellation and retries leave guest answers recoverable", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, null, "", draft);
    expect(prepareBriefDraftHandoff(s)).toEqual(prepareBriefDraftHandoff(s));
    expect(loadBriefFormDraft(s, scope, null, "")).toEqual(draft);
  });
  test("an unchanged departure flush preserves the sign-in handoff", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, null, "", draft);
    const handoff = prepareBriefDraftHandoff(s);
    saveBriefFormDraft(s, scope, null, "", draft);
    claimBriefDraftHandoff(s, handoff, "alice");
    expect(loadBriefFormDraft(s, scope, "alice", "")).toEqual(draft);
  });
  test("an old callback cannot claim edits made after sign-in began", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, null, "", draft);
    const handoff = prepareBriefDraftHandoff(s);
    saveBriefFormDraft(s, scope, null, "", {
      ...draft,
      existingMaterial: "Newer work",
    });
    claimBriefDraftHandoff(s, handoff, "alice");
    expect(loadBriefFormDraft(s, scope, "alice", "")).toBeNull();
    expect(loadBriefFormDraft(s, scope, null, "")?.existingMaterial).toBe(
      "Newer work",
    );
  });
  test("handoff cannot replace newer account edits", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, null, "", draft);
    const handoff = prepareBriefDraftHandoff(s);
    saveBriefFormDraft(s, scope, "alice", "", {
      ...draft,
      existingMaterial: "Account edits",
    });
    claimBriefDraftHandoff(s, handoff, "alice");
    expect(loadBriefFormDraft(s, scope, "alice", "")?.existingMaterial).toBe(
      "Account edits",
    );
  });
  test("a changed saved brief or Start over invalidates recovery", () => {
    const s = storage();
    saveBriefFormDraft(s, "refine:folio", "alice", "revision-1", draft);
    expect(
      loadBriefFormDraft(s, "refine:folio", "alice", "revision-2"),
    ).toBeNull();
  });
  test("expired and malformed copies cannot restore stale forms", () => {
    const s = storage();
    const key = briefDraftKey(scope, null);
    s.setItem(key, "invalid json");
    expect(loadBriefFormDraft(s, scope, null, "")).toBeNull();
    saveBriefFormDraft(s, scope, null, "", draft);
    const saved = JSON.parse(s.getItem(key)!);
    saved.updatedAt -= 25 * 60 * 60 * 1000;
    s.setItem(key, JSON.stringify(saved));
    expect(loadBriefFormDraft(s, scope, null, "")).toBeNull();
    saved.updatedAt = Date.now();
    saved.draft.step = 100;
    s.setItem(key, JSON.stringify(saved));
    expect(loadBriefFormDraft(s, scope, null, "")).toBeNull();
  });
  test("successful filing clears only the submitted scope", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, "alice", "", draft);
    saveBriefFormDraft(s, "refine:other", "alice", "", draft);
    clearBriefFormDraft(s, scope, "alice");
    expect(loadBriefFormDraft(s, scope, "alice", "")).toBeNull();
    expect(loadBriefFormDraft(s, "refine:other", "alice", "")).toEqual(draft);
  });
  test("failed first filing keeps recovery under the allocated folio", () => {
    const s = storage();
    saveBriefFormDraft(s, "create:new", null, "0", draft);
    moveBriefFormDraft(s, "create:new", "create:allocated", null);
    expect(loadBriefFormDraft(s, "create:new", null, "0")).toBeNull();
    expect(loadBriefFormDraft(s, "create:allocated", null, "0")).toEqual(draft);
    expect(prepareBriefDraftHandoff(s)?.key).toBe(
      briefDraftKey("create:allocated", null),
    );
  });
  test("quota failure is surfaced without deleting the recovery copy", () => {
    const s = storage();
    saveBriefFormDraft(s, scope, null, "", draft);
    expect(() =>
      saveBriefFormDraft(
        {
          ...s,
          setItem: () => {
            throw new Error("quota");
          },
        },
        scope,
        null,
        "",
        draft,
      ),
    ).toThrow("quota");
    expect(loadBriefFormDraft(s, scope, null, "")).toEqual(draft);
    const handoff = prepareBriefDraftHandoff(s);
    claimBriefDraftHandoff(
      {
        ...s,
        setItem: () => {
          throw new Error("quota");
        },
      },
      handoff,
      "alice",
    );
    expect(loadBriefFormDraft(s, scope, null, "")).toEqual(draft);
  });
});
