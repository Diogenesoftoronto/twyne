import { describe, expect, test } from "bun:test";
import {
  candidateRequest,
  claimCandidates,
  confirmedTargets,
} from "./research-candidates";

const draft = [
  "I grew up near the harbour and the smell never left me.",
  "",
  "Studies show that coastal towns lost 40% of their fishing jobs in the 1990s. The mayor said “we will not let this harbour die” at the time.",
  "",
  "In 1987 the cannery closed for good, and nobody came to the meeting.",
].join("\n");

describe("claimCandidates", () => {
  test("finds figures, appeals to authority, quotations and dated events", () => {
    const found = claimCandidates(draft);
    expect(found.map((c) => c.kind)).toEqual(["statistic", "quote", "event"]);
    expect(found[0].anchor).toContain("40%");
  });

  test("leaves personal experience alone", () => {
    expect(
      claimCandidates(
        "I grew up near the harbour and the smell never left me.",
      ),
    ).toEqual([]);
  });
});

describe("confirmedTargets", () => {
  test("keeps only what Jev says needs a source", () => {
    const candidates = claimCandidates(draft);
    const request = candidateRequest(candidates, "nonfiction");
    expect(Object.keys(request.questions)).toHaveLength(candidates.length);
    const targets = confirmedTargets(candidates, {
      ok: true,
      answers: {
        claim0: { noul: 0.9 },
        claim1: { noul: 0.3 },
        claim2: { noul: 0.7 },
      },
    });
    expect(targets.map((t) => t.kind)).toEqual(["statistic", "event"]);
    expect(targets[0].query).not.toContain("“");
  });

  test("returns nothing when the judgement failed", () => {
    expect(
      confirmedTargets(claimCandidates(draft), { ok: false, error: "down" }),
    ).toEqual([]);
  });
});
