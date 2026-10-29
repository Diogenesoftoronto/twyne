import { describe, expect, test } from "bun:test";
import {
  echoData,
  echoReading,
} from "../components/editor/extensions/flow-conductor";
import { connectionPlaces, connectionReason } from "./passage-gather";

const SHARED = ["salt", "caravan", "coast"];
const PASSAGE = "By the fourth day the road forgot the sea entirely.";

/** What the conductor records when Jev named a relation. */
const semantic = {
  kind: "echo",
  data: echoData(SHARED, echoReading("Unpaid promise", SHARED), PASSAGE),
};
/** What it records when nobody read the passages for meaning. */
const lexical = {
  kind: "echo",
  data: echoData(SHARED, echoReading(undefined, SHARED), PASSAGE),
};

describe("a connection's recorded reason", () => {
  test("a reading keeps its relation and is labelled as a reading", () => {
    expect(connectionReason(semantic)).toEqual({
      relation: "Unpaid promise",
      explanation:
        "One passage sets something up that the other could pay off, and it may not have been paid off yet. Both mention salt, caravan, coast.",
      provenance: "reading",
    });
  });

  test("a word match says only that, and never claims a meaning", () => {
    const reason = connectionReason(lexical)!;
    expect(reason.provenance).toBe("shared-words");
    expect(reason.relation).toBe("Shared words");
    expect(reason.explanation).toContain("nobody has read them for meaning");
  });

  test("the two fixtures stay distinct", () => {
    expect(connectionReason(semantic)!.explanation).not.toBe(
      connectionReason(lexical)!.explanation,
    );
  });

  test("an echo stored before provenance existed is still told apart", () => {
    const withoutProvenance = (data: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(data).filter(([key]) => key !== "provenance"),
      );
    const oldSemantic = withoutProvenance(semantic.data);
    const oldLexical = withoutProvenance(lexical.data);
    expect(
      connectionReason({ kind: "echo", data: oldSemantic })!.provenance,
    ).toBe("reading");
    expect(
      connectionReason({ kind: "echo", data: oldLexical })!.provenance,
    ).toBe("shared-words");
  });

  test("a missing reason is reported missing, not invented", () => {
    const stored: Array<Record<string, string> | undefined> = [
      undefined,
      {},
      { relation: "Tension" },
    ];
    for (const data of stored)
      expect(connectionReason({ kind: "echo", data })).toEqual({
        relation: data?.relation ?? "Connection",
        explanation:
          "Twyne found these passages together but did not record why.",
        provenance: "unrecorded",
      });
  });

  test("only echoes carry a connection reason", () => {
    expect(connectionReason({ kind: "comment", data: semantic.data })).toBe(
      null,
    );
  });
});

describe("which passages a connection joins", () => {
  test("names both numbered passages when both are gathered", () => {
    expect(connectionPlaces({ expected: 2 }, [3, 1])).toEqual({
      between: "Passages 1 and 3",
      stale: false,
    });
  });

  test("a passage that has changed since is flagged, not dropped", () => {
    expect(connectionPlaces({ expected: 2 }, [2])).toEqual({
      between: "Passage 2",
      stale: true,
    });
  });

  test("a passage in another folio is named, and is not stale", () => {
    expect(
      connectionPlaces({ expected: 1, elsewhere: "Salt Roads II" }, [1]),
    ).toEqual({
      between: "Passage 1 and one in Salt Roads II",
      stale: false,
    });
  });

  test("merged twins count once", () => {
    expect(connectionPlaces({ expected: 2 }, [2, 2])).toEqual({
      between: "Passage 2",
      stale: true,
    });
  });

  test("nothing left to show is no connection", () => {
    expect(connectionPlaces({ expected: 2 }, [])).toBe(null);
  });
});
