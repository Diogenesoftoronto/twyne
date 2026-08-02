import { describe, expect, test } from "bun:test";
import type { ResearchTarget } from "../types";
import {
  parseResearchTargets,
  rankSourcesForTarget,
  selectFreshTargets,
} from "./research-targets";

describe("parseResearchTargets", () => {
  test("parses a plain JSON object and normalizes fields", () => {
    const targets = parseResearchTargets(
      JSON.stringify({
        targets: [
          {
            kind: "quote",
            anchor: '"Fear is the mind-killer."',
            reason: "Quoted without attribution.",
            query: "who said fear is the mind killer Dune",
            importance: 5,
          },
          {
            kind: "unknown-thing",
            anchor: "A survey found 62% of writers.",
            reason: "Statistic has no source.",
            query: "survey conducted writers 62%",
            importance: 9,
          },
        ],
      }),
    );
    expect(targets).toHaveLength(2);
    expect(targets[0].kind).toBe("quote");
    expect(targets[0].importance).toBe(5);
    expect(targets[0].id).toBeTruthy();
    // Unknown kind is normalised to claim; importance is clamped to 5.
    expect(targets[1].kind).toBe("claim");
    expect(targets[1].importance).toBe(5);
    // Sorted by importance, so the clamped one now leads.
    expect(targets[0].importance).toBeGreaterThanOrEqual(targets[1].importance);
  });

  test("strips markdown fences and reasoning tags", () => {
    const targets = parseResearchTargets(
      'thinking hidden response</thinking>\n```json\n{"items":[{"kind":"statistic","anchor":"cities emit 70% of carbon","query":"cities 70 percent carbon emissions source","reason":"figure needs a basis","importance":4}]}\n```',
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].kind).toBe("statistic");
    expect(targets[0].query).toContain("carbon");
  });

  test("contract fixture: chatty model reply with reasoning prose and fences", () => {
    const reply = `I looked through the draft and flagged a few passages.

<thinking_pulse>
The Des Moines quote needs attribution; the 1984 film and the NOAA stat are checkable; "this project" is the author's own point, skip it.
</thinking_pulse>

Here is the intake JSON, formatted for readability:

\`\`\`json
{
  "targets": [
    {
      "kind": "quote",
      "anchor": "\\"The only way to do great work is to love what you do.\\"",
      "query": "who said only way to do great work is to love what you do",
      "reason": "Attribution quote.",
      "importance": 5
    },
    {
      "kind": "work",
      "anchor": "Barton Fink (1991)",
      "query": "Barton Fink 1991 Coen brothers film",
      "reason": "Named film.",
      "importance": 3
    }
  ]
}
\`\`\`

That should be all that needs a source. Let me know if you want more.
`;
    const targets = parseResearchTargets(reply);
    expect(targets).toHaveLength(2);
    expect(targets[0].kind).toBe("quote");
    expect(targets[0].anchor).toContain("great work");
    expect(targets[0].importance).toBe(5);
    expect(targets[1].kind).toBe("work");
    expect(targets[1].query).toContain("Barton Fink");
  });

  test("contract fixture: one-element reply wrapped in stray prose and escape chars", () => {
    const reply = `Understood. I've filed the findings — here is the chronogram.

{"targets":[{"kind":"statistic","anchor":"Literacy rose 21.5% in the decade.","query":"literacy rate rise 21.5 percent decade research","reason":"needs a basis","importance":4}]}

— yours truly, the librarian`;
    const parsed = parseResearchTargets(reply);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe("statistic");
  });

  test("accepts a bare array", () => {
    const targets = parseResearchTargets(
      '[{"kind":"person","anchor":"Chopin composed nocturnes","query":"Chopin nocturnes composer biography","importance":3}]',
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].kind).toBe("person");
  });

  test("drops entries without a usable anchor or query", () => {
    const targets = parseResearchTargets(
      JSON.stringify({
        targets: [
          { anchor: "", query: "x", kind: "claim", importance: 1 },
          { anchor: "a", query: "", kind: "claim", importance: 1 },
          {
            anchor: "the draft's own point",
            query: "the draft's own point",
            kind: "claim",
            importance: 3,
          },
        ],
      }),
    );
    expect(targets).toHaveLength(1);
  });

  test("dedupes repeated anchors and queries", () => {
    const targets = parseResearchTargets(
      JSON.stringify({
        targets: [
          {
            anchor: "Same quote",
            query: "same query",
            kind: "quote",
            importance: 5,
          },
          {
            anchor: "same quote",
            query: "same query",
            kind: "quote",
            importance: 1,
          },
        ],
      }),
    );
    expect(targets).toHaveLength(1);
  });

  test("injects a default reason and safeguards query length", () => {
    const targets = parseResearchTargets(
      JSON.stringify({
        targets: [
          {
            anchor:
              "A broadly stated claim with no reason given and a query longer than a hundred and sixty characters should never reach the provider",
            kind: "claim",
            importance: 2,
          },
        ],
      }),
    );
    expect(targets[0].reason).toBeTruthy();
    expect(targets[0].query.length).toBeLessThanOrEqual(160);
  });
});

describe("selectFreshTargets", () => {
  const targets: ResearchTarget[] = [
    {
      id: "1",
      kind: "quote",
      anchor: "First Rule of Fight Club",
      reason: "attribution",
      query: "who says first rule of fight club",
      importance: 5,
    },
    {
      id: "2",
      kind: "work",
      anchor: "Paris Texas 1984",
      reason: "film",
      query: "Paris Texas 1984 Wim Wenders film",
      importance: 4,
    },
    {
      id: "3",
      kind: "statistic",
      anchor: "90% of people",
      reason: "data",
      query: "study 90 percent statistics",
      importance: 3,
    },
  ];

  test("filters covered and recent keys, then caps by budget", () => {
    const selected = selectFreshTargets(targets, {
      budget: 2,
      coveredKeys: new Set(["quote|first rule of fight club"]),
    });
    expect(selected.map((t) => t.id)).toEqual(["2", "3"]);

    const recent = selectFreshTargets(targets, {
      budget: 3,
      recentKeys: new Set(["statistic|90% of people"]),
    });
    expect(recent.some((t) => t.id === "3")).toBe(false);
  });

  test("respects a zero budget", () => {
    expect(selectFreshTargets(targets, { budget: 0 })).toHaveLength(0);
  });
});

describe("rankSourcesForTarget", () => {
  const mine = {
    url: "https://bad.example/1",
    snippet: "short",
  };
  const best = {
    url: "https://good.example/2",
    title: "The real source",
    snippet: "A fully substantive snippet that says something useful.",
    author: "Someone Known",
    publisher: "A Press",
  };
  const middle = {
    url: "https://mid.example/3",
    title: "Mid source",
    snippet: "A fully substantive snippet that says something useful.",
  };

  test("prefers a source with snippet plus author/publisher", () => {
    const ranked = rankSourcesForTarget([mine, best, middle]);
    expect(ranked[0].url).toBe(best.url);
    expect(ranked[ranked.length - 1].url).toBe(mine.url);
  });

  test("keeps a stable total order even when inputs tie", () => {
    const results = rankSourcesForTarget([middle, best]);
    expect(results[0].url).toBe(best.url);
  });
});
