import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PERSONAS } from "../../src/utils/personas";
import {
  buildInstrumentRoomRequest,
  readInstrumentRoomChoice,
} from "../../src/utils/instrument-room";
import { roomRoutingCases } from "./room-routing-corpus";
import {
  parseRoomRoutingOptions,
  roomRoutingFailureFlags,
  runRoomRouting,
  validateRoomRoutingCorpus,
} from "./room-routing";

test("authored routing corpus spans all instruments and includes multiple acceptable choices and a required decline", () => {
  const requests = validateRoomRoutingCorpus();
  expect(requests.length).toBe(10);
  expect(
    new Set(roomRoutingCases.map((fixture) => fixture.context.instrument)),
  ).toEqual(new Set(["sentence", "threads", "scene"]));
  expect(
    roomRoutingCases.some((fixture) => fixture.acceptableEditorIds.length > 1),
  ).toBe(true);
  expect(
    roomRoutingCases.some(
      (fixture) => JSON.stringify(fixture.acceptableEditorIds) === '["none"]',
    ),
  ).toBe(true);
  expect(() =>
    validateRoomRoutingCorpus([
      {
        ...roomRoutingCases[0],
        acceptableEditorIds: ["not-in-canonical-cast"],
      },
    ]),
  ).toThrow("Invalid authored");
});

test("runner requires explicit model execution and rejects unknown cases or credential CLI flags", () => {
  const offline = parseRoomRoutingOptions([], {
    TWYNE_ROOM_ROUTING_ENDPOINT: "http://127.0.0.1:8009",
  });
  expect(offline.runModel).toBe(false);
  expect(offline.endpoint).toBe("http://127.0.0.1:8009");
  expect(() => parseRoomRoutingOptions(["--run-model"], {})).toThrow(
    "requires",
  );
  expect(() => parseRoomRoutingOptions(["--case", "unknown"], {})).toThrow(
    "Unknown",
  );
  expect(() =>
    parseRoomRoutingOptions(["--api-key", "fictional-only"], {}),
  ).toThrow("environment");
  expect(() =>
    parseRoomRoutingOptions(
      ["--endpoint", "https://user:password@example.invalid"],
      {},
    ),
  ).toThrow("must not contain credentials");
});

test("authored reference scoring flags incorrect model choices and required none independently of transport validation", () => {
  const fixture = roomRoutingCases.find(
    (fixture) => fixture.acceptableEditorIds[0] === "none",
  )!;
  const request = buildInstrumentRoomRequest(fixture.context, PERSONAS);
  const distribution = Object.fromEntries(
    request.choices.map((option) => [option, option === "editor-3" ? 1 : 0]),
  );
  const selection = readInstrumentRoomChoice(request, {
    ok: true,
    answers: {
      editor: {
        type: "choice",
        choice: "editor-3",
        confidence: 1,
        probabilities: distribution,
      },
    },
  });
  expect(selection.status).toBe("selected");
  expect(roomRoutingFailureFlags(fixture, selection)).toEqual([
    `${fixture.id}:outside-authored-acceptable-set`,
    `${fixture.id}:none-required`,
  ]);
  expect(
    roomRoutingFailureFlags(fixture, { status: "malformed", key: request.key }),
  ).toEqual([`${fixture.id}:malformed`]);
});

test("offline runner writes not-run quality evidence and makes no requests even when an endpoint is configured", async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      requests++;
      return new Response("No model should be called");
    },
  });
  const output = mkdtempSync(join(tmpdir(), "twyne-room-corpus-test-"));
  try {
    const options = parseRoomRoutingOptions(
      ["--endpoint", server.url.toString(), "--output", output],
      {},
    );
    const report = await runRoomRouting(options);
    expect(requests).toBe(0);
    expect(report.modelQuality).toBe("not-run");
    expect(report.mode).toBe("offline-corpus-validation");
    expect(report.results.every((row) => row.modelRun === null)).toBe(true);
    expect(report.corpusSha256).toHaveLength(64);
    expect(report.revision).not.toBeNull();
    expect(readFileSync(join(output, "report.md"), "utf8")).toContain(
      "semantic quality, model distributions and latency were not measured",
    );
    const saved = JSON.parse(readFileSync(join(output, "report.json"), "utf8"));
    expect(saved.requestedModel).toBeNull();
    expect(saved.results[0].input.questions.editor.criteria).toHaveLength(
      PERSONAS.length + 1,
    );
  } finally {
    server.stop(true);
    rmSync(output, { recursive: true });
  }
});
