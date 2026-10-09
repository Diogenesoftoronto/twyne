import { describe, expect, test } from "bun:test";
import type { Persona } from "../types";
import type { JudgementResult } from "./judgement-client";
import {
  INSTRUMENT_ROOM_LIMITS,
  buildInstrumentRoomRequest,
  instrumentRoomCast,
  instrumentRoomComment,
  instrumentRoomContextKey,
  readInstrumentRoomChoice,
  requestInstrumentRoomComment,
  selectInstrumentRoomEditor,
  type InstrumentRoomContext,
  type InstrumentRoomRequest,
} from "./instrument-room";

const cast: Persona[] = [
  {
    id: "sound-reader",
    name: "Nadia",
    role: "Rhythm editor",
    focus: "Cadence and sounds",
    description: "Listens for a sentence's breath.",
    criticalMethod: "Read a sentence aloud beside its neighbours.",
    color: "blue",
    icon: "N",
  },
  {
    id: "source-checker",
    name: "Emil",
    role: "Evidence editor",
    focus: "Source provenance",
    description: "Separates observation from inference.",
    color: "red",
    icon: "E",
  },
];
const context: InstrumentRoomContext = {
  instrument: "sentence",
  key: "sentence:one",
  source: "The lamp flickered as Mara opened the ledger.",
  proposal: "As Mara opened the ledger, the lamp flickered.",
  question: "How does this wording's rhythm read aloud beside its neighbours?",
  detail: "Before: Jules waited below the arch.\nActive pane: hear",
};
const prepared = () => buildInstrumentRoomRequest(context, cast);
function response(
  choice = "editor-0",
  probabilities: Record<string, number> = {
    "editor-0": 0.85,
    "editor-1": 0.1,
    none: 0.05,
  },
  confidence = 0.7,
): JudgementResult {
  return {
    ok: true,
    model: "jev-test-fixture",
    answers: { editor: { type: "choice", choice, probabilities, confidence } },
  };
}

describe("instrument room bounded current-cast contract", () => {
  test("one closed Choice describes every actual custom editor plus none", () => {
    const request = prepared();
    expect(Object.keys(request.input.questions)).toEqual(["editor"]);
    expect(request.input.questions.editor.type).toBe("choice");
    expect(request.input.questions.editor).toMatchObject({
      criteria: ["editor-0", "editor-1", "none"],
    });
    expect(JSON.parse(request.input.state.editors)).toEqual(
      request.cast.map((editor, i) => ({ choice: `editor-${i}`, ...editor })),
    );
    expect(request.input.state.source).toBe(context.source);
    expect(request.input.state.unappliedProposal).toBe(context.proposal!);
    expect(request.input.questions.editor.instructions).toContain(
      "Select only",
    );
    expect(request.input.questions.editor.instructions).toContain(
      "No editorial scope setting excludes comments-level editors",
    );
    // A custom ID "none" is an editor, distinct from the decline option.
    const custom = buildInstrumentRoomRequest(context, [
      { ...cast[0], id: "none" },
    ]);
    const selected = readInstrumentRoomChoice(
      custom,
      response("editor-0", { "editor-0": 0.85, none: 0.15 } as any),
    );
    expect(selected.status).toBe("selected");
    expect(selected.personaId).toBe("none");
  });
  test("invalid or too-large casts and passages fail explicitly without silently excluding editors or truncating source", () => {
    expect(() => instrumentRoomCast([])).toThrow("no editors");
    expect(() => instrumentRoomCast([cast[0], cast[0]])).toThrow("duplicate");
    expect(() =>
      instrumentRoomCast(
        Array.from({ length: 17 }, (_, i) => ({
          ...cast[0],
          id: `custom-${i}`,
        })),
      ),
    ).toThrow("up to 16");
    expect(() =>
      buildInstrumentRoomRequest(
        { ...context, source: "x".repeat(INSTRUMENT_ROOM_LIMITS.source + 1) },
        cast,
      ),
    ).toThrow("too long");
    expect(() =>
      buildInstrumentRoomRequest({ ...context, question: " " }, cast),
    ).toThrow("missing");
    expect(() =>
      buildInstrumentRoomRequest(
        {
          ...context,
          proposal: "x".repeat(INSTRUMENT_ROOM_LIMITS.proposal + 1),
        },
        cast,
      ),
    ).toThrow("too long");
  });
  test("context and cast identity includes changed proposals, questions and methods", () => {
    expect(instrumentRoomContextKey(context)).not.toBe(
      instrumentRoomContextKey({ ...context, proposal: context.source }),
    );
    expect(prepared().key).not.toBe(
      buildInstrumentRoomRequest(
        { ...context, question: "What would you protect?" },
        cast,
      ).key,
    );
    expect(prepared().key).not.toBe(
      buildInstrumentRoomRequest(context, [
        { ...cast[0], criticalMethod: "Changed doctrine" },
        cast[1],
      ]).key,
    );
  });
});

describe("closed routing responses never become invented explanations", () => {
  test("valid complete distribution selects exact current ID and retains probabilities/model", () => {
    expect(readInstrumentRoomChoice(prepared(), response())).toMatchObject({
      status: "selected",
      personaId: "sound-reader",
      confidence: 0.7,
      model: "jev-test-fixture",
      probabilities: { "editor-0": 0.85, "editor-1": 0.1, none: 0.05 },
    });
    expect(readInstrumentRoomChoice(prepared(), response())).not.toHaveProperty(
      "rationale",
    );
    // A low concentration still makes an inspectable harmless preference; no arbitrary threshold.
    expect(
      readInstrumentRoomChoice(
        prepared(),
        response(
          "editor-0",
          { "editor-0": 0.34, "editor-1": 0.33, none: 0.33 },
          0.0001,
        ),
      ).status,
    ).toBe("selected");
  });
  const malformed: Array<[string, Record<string, unknown>]> = [
    ["partial", { probabilities: { "editor-0": 1 } }],
    [
      "extra editor",
      {
        probabilities: {
          "editor-0": 0.8,
          "editor-1": 0.1,
          none: 0.05,
          invented: 0.05,
        },
      },
    ],
    [
      "negative",
      { probabilities: { "editor-0": 1, "editor-1": 0.1, none: -0.1 } },
    ],
    [
      "over one",
      { probabilities: { "editor-0": 1.1, "editor-1": 0, none: 0 } },
    ],
    [
      "wrong sum",
      { probabilities: { "editor-0": 0.8, "editor-1": 0.05, none: 0.01 } },
    ],
    [
      "non-finite",
      { probabilities: { "editor-0": Infinity, "editor-1": 0, none: 0 } },
    ],
    ["NaN", { probabilities: { "editor-0": NaN, "editor-1": 0, none: 0 } }],
    [
      "string probability",
      { probabilities: { "editor-0": ".85", "editor-1": 0.1, none: 0.05 } },
    ],
    ["not maximum", { choice: "editor-1" }],
    ["invented ID", { choice: "sound-reader" }],
    ["bad confidence", { confidence: Infinity }],
    ["negative confidence", { confidence: -0.1 }],
    ["missing confidence", { confidence: undefined }],
    ["wrong primitive", { type: "noul", noul: 0.9 }],
  ];
  for (const [name, patch] of malformed)
    test(`rejects ${name} at room boundary`, () => {
      const valid = response();
      const bad = {
        ...valid,
        answers: { editor: { ...(valid.answers!.editor as object), ...patch } },
      };
      expect(readInstrumentRoomChoice(prepared(), bad).status).toBe(
        "malformed",
      );
      expect(
        readInstrumentRoomChoice(prepared(), bad).personaId,
      ).toBeUndefined();
    });
  test("none does not request a comment or generation", async () => {
    let calls = 0,
      comments = 0;
    const result = await selectInstrumentRoomEditor(
      prepared(),
      async (input) => {
        calls++;
        expect(Object.keys(input.questions)).toEqual(["editor"]);
        return response("none", {
          "editor-0": 0.05,
          "editor-1": 0.1,
          none: 0.85,
        });
      },
    );
    expect(result.status).toBe("none");
    expect(result.personaId).toBeUndefined();
    const sent = await requestInstrumentRoomComment(
      prepared(),
      result.personaId,
      () => {
        comments++;
        return { ok: true };
      },
    );
    expect(sent.ok).toBe(false);
    expect(calls).toBe(1);
    expect(comments).toBe(0);
  });
  test("unavailable and thrown transports stay unavailable and never substitute a default editor", async () => {
    for (const ask of [
      async () => ({ ok: false }),
      async (): Promise<JudgementResult> => {
        throw new Error("offline");
      },
    ]) {
      const result = await selectInstrumentRoomEditor(prepared(), ask);
      expect(result.status).toBe("unavailable");
      expect(result.personaId).toBeUndefined();
    }
  });
});

describe("freshness and existing-comment handoff", () => {
  test("stale before request spends no call; changed cast/settings/account/context during routing discards result", async () => {
    let calls = 0;
    const skipped = await selectInstrumentRoomEditor(
      prepared(),
      async () => {
        calls++;
        return response();
      },
      () => false,
    );
    expect(skipped.status).toBe("stale");
    expect(calls).toBe(0);
    for (const changed of ["cast", "settings", "account", "context"]) {
      let snapshot = "current";
      const result = await selectInstrumentRoomEditor(
        prepared(),
        async () => {
          snapshot = changed;
          return response();
        },
        async () => snapshot === "current",
      );
      expect(result.status).toBe("stale");
      expect(result.personaId).toBeUndefined();
    }
  });
  test("manual choice uses the exact supplied cast, source and unapplied proposal without authored mentions", async () => {
    const request = instrumentRoomComment(prepared(), "source-checker")!;
    expect(request.personaName).toBe("Emil");
    expect(request.body).toContain(context.source);
    expect(request.body).toContain(context.proposal!);
    expect(request.body).toContain(context.question);
    expect(request.body).toContain(
      "Unapplied proposal (comparison only; not inserted in the draft)",
    );
    expect(request.body).not.toContain("@Emil");
    const captured: { request?: InstrumentRoomRequest } = {};
    const sent = await requestInstrumentRoomComment(
      prepared(),
      "source-checker",
      (value) => {
        captured.request = value;
        return { ok: true, message: "Question saved in Marginalia." };
      },
    );
    expect(captured.request).toEqual(request);
    expect(sent.message).toBe("Question saved in Marginalia.");
    expect(sent.message).not.toContain("generated");
  });
  test("a removed editor, decline or late freshness change cannot call the contribution handler", async () => {
    let calls = 0;
    const handler = () => {
      calls++;
      return { ok: true };
    };
    expect(
      (await requestInstrumentRoomComment(prepared(), "missing", handler)).ok,
    ).toBe(false);
    expect(
      (await requestInstrumentRoomComment(prepared(), undefined, handler)).ok,
    ).toBe(false);
    expect(
      (
        await requestInstrumentRoomComment(
          prepared(),
          "sound-reader",
          handler,
          async () => false,
        )
      ).ok,
    ).toBe(false);
    expect(calls).toBe(0);
  });
  test("callback failure is honest and leaves source/proposal unmodified", async () => {
    const before = JSON.stringify(context);
    const result = await requestInstrumentRoomComment(
      prepared(),
      "sound-reader",
      async () => {
        throw new Error("provider absent");
      },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("could not be requested");
    expect(JSON.stringify(context)).toBe(before);
  });
});

test("saved model-selection record preserves the complete distribution after the instrument closes", async () => {
  const request = prepared();
  const selected = readInstrumentRoomChoice(request, response());
  let body = "";
  const result = await requestInstrumentRoomComment(
    request,
    selected.personaId,
    (comment) => {
      body = comment.body;
      return { ok: true };
    },
    () => true,
    selected,
  );
  expect(result.ok).toBe(true);
  expect(body).toContain(
    "Editor selection record (model choice, not a rationale or endorsement)",
  );
  expect(body).toContain("Model: jev-test-fixture");
  expect(body).toContain("editor-0 · Nadia: 0.85");
  expect(body).toContain("editor-1 · Emil: 0.1");
  expect(body).toContain("none · No editor: 0.05");
  expect(body).toContain("Confidence: 0.7");
  expect(instrumentRoomComment(request, "sound-reader")!.body).not.toContain(
    "Editor selection record",
  );
  let calls = 0;
  const rejected = await requestInstrumentRoomComment(
    request,
    selected.personaId,
    () => {
      calls++;
      return { ok: true };
    },
    () => true,
    { ...selected, key: "stale-source" },
  );
  expect(rejected.ok).toBe(false);
  expect(calls).toBe(0);
});

test("combined invitation exceeding the total body cap rejects before contribution dispatch", async () => {
  const many = Array.from({ length: 16 }, (_, i) => ({
    ...cast[0],
    id: `custom-${i}`,
    name: "Long editor name ".repeat(9),
  }));
  const large = buildInstrumentRoomRequest(
    {
      ...context,
      source: "S".repeat(12000),
      proposal: "P".repeat(12000),
      detail: "D".repeat(4000),
      question: "Q".repeat(600),
    },
    many,
  );
  const probabilities = Object.fromEntries(
    large.choices.map((label) => [label, label === "editor-0" ? 1 : 0]),
  );
  const selected = readInstrumentRoomChoice(
    large,
    response("editor-0", probabilities, 1),
  );
  let calls = 0;
  const result = await requestInstrumentRoomComment(
    large,
    "custom-0",
    () => {
      calls++;
      return { ok: true };
    },
    () => true,
    selected,
  );
  expect(result.ok).toBe(false);
  expect(result.message).toContain("Invitation body is too long");
  expect(calls).toBe(0);
});
