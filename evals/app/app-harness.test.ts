/**
 * The app harness end to end, against the scripted model: the in-process
 * Convex app, the integration route, the `twyne-mcp` tools and the `twyne`
 * CLI. No network and no credentials; this is what keeps the eval plumbing
 * honest between real-model runs.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectMcp, runCliJson } from "./drivers";
import { startLocalApp, type LocalApp } from "./local-app";
import { runAppEvals } from "./run";

const PARAGRAPHS = [
  "The salt road leaves the coast at Marsh End and climbs for eleven miles before anyone builds a wall beside it. For most of that distance it is not a road at all but a habit, a line of flattened grass that the carters kept open because the alternative was the bog.",
  "I walked it in October with a borrowed map and a pair of boots that had been resoled twice. The map showed the road as a confident red line. The ground showed something more hesitant: a path that split around every boulder and rejoined itself as if embarrassed by the detour.",
  "Salt was the reason for all of it. A cart of it was worth more than the cart, the horse and the man together, and the road was laid out by people who expected to be robbed. That is why it keeps to the high ground and why every bend gives a long view behind.",
  "Halfway up there is a stone trough that the guidebooks call Roman. It is not Roman. The farmer who owns the field told me his grandfather cut it in 1931 to water sheep, and he showed me the receipt for the chisel, which he keeps in a biscuit tin.",
  "The best hour of the walk is the last one, when the road drops into the valley and the first smoke from the village rises straight up in the still air. You can smell the bakery before you can see it. I understood then why the carters sang on this stretch.",
  "What the road teaches is patience with detours. Every place it bends, it bends for a reason that someone once paid for in time or money or fear, and the walker inherits all of those reasons without having to know them.",
];
const DRAFT = Array.from({ length: 2 }, () => PARAGRAPHS.join("\n\n")).join(
  "\n\n",
);

describe("the in-process app over MCP and the CLI", () => {
  let app: LocalApp;
  beforeAll(async () => {
    app = await startLocalApp({ model: "mock" });
  });
  afterAll(async () => {
    await app.close();
  });

  test("convenes the room with notes pinned to the draft", async () => {
    const writer = await app.newWriter();
    const mcp = await connectMcp({
      apiUrl: app.url,
      token: writer.token,
      fetch: app.fetch,
    });
    try {
      expect(await mcp.tools()).toContain("twyne_convene_room");
      const result = (await mcp.call("twyne_convene_room", {
        draftText: DRAFT,
      })) as {
        notes: Array<{
          personaId: string;
          text: string;
          provider: string;
          anchor?: string;
        }>;
      };
      expect(result.notes.map((note) => note.personaId).sort()).toEqual([
        "angel",
        "devil",
        "editor",
        "reader",
        "scholar",
      ]);
      for (const note of result.notes) {
        expect(note.provider).toBe("rivet");
        expect(note.anchor).toBeTruthy();
        expect(DRAFT).toContain(note.anchor as string);
      }
      const kinds = new Set(app.mock?.calls.map((call) => call.kind));
      expect(kinds.has("persona-tool-call")).toBe(true);
      expect(kinds.has("persona-note")).toBe(true);
      // Each note passes the System One editorial review, as in the browser.
      expect(kinds.has("system-one")).toBe(true);
    } finally {
      await mcp.close();
    }
  }, 60_000);

  test("grades a draft through the CLI", async () => {
    const writer = await app.newWriter();
    const grade = (await runCliJson(
      { apiUrl: app.url, token: writer.token },
      ["grade", "--file", "{draft.md}"],
      { "draft.md": DRAFT },
    )) as { grade: string; judges: Array<{ score: number; provider: string }> };
    expect(grade.grade).toMatch(/^[A-F]/);
    expect(grade.judges).toHaveLength(5);
    for (const judge of grade.judges) {
      expect(judge.provider).toBe("rivet");
      expect(judge.score).toBeGreaterThanOrEqual(1);
      expect(judge.score).toBeLessThanOrEqual(10);
    }
  }, 60_000);
});

test("the eval runner scores a suite end to end", async () => {
  const [report] = await runAppEvals({
    suites: ["interview"],
    target: "local",
    model: "mock",
    driver: "mcp",
    judge: "none",
    limit: 2,
    concurrency: 1,
    arize: false,
    trace: false,
    project: "twyne-app-evals",
    env: {},
    log: () => {},
  });
  expect(report.errors).toBe(0);
  expect(report.cases).toHaveLength(2);
  for (const result of report.cases) {
    expect(result.scores.harness.score).toBe(1);
    expect(result.scores.protocol.score).not.toBeNull();
  }
}, 60_000);

test("auto-research runs both strategies and the search through the app", async () => {
  const [targets, sources] = await runAppEvals({
    suites: ["research-targets", "research-sources"],
    target: "local",
    model: "mock",
    driver: "mcp",
    judge: "none",
    limit: 2,
    concurrency: 1,
    arize: false,
    trace: false,
    project: "twyne-app-evals",
    env: {},
    log: () => {},
  });
  expect(targets.errors).toBe(0);
  // The first draft, once per strategy.
  expect(targets.cases.map((c) => c.case_id.split(":")[1]).sort()).toEqual([
    "hosted",
    "model",
  ]);
  for (const result of targets.cases) {
    const raw = result.raw as { targets: Array<{ anchor: string }> };
    expect(raw.targets.length).toBeGreaterThan(0);
    expect(result.scores.anchors_verbatim.score).toBe(1);
  }
  expect(sources.errors).toBe(0);
  expect(sources.evaluatorVersions?.clairic_value_support_v2).toMatch(
    /^research-value-support-v2:[a-f0-9]{64}$/,
  );
  for (const result of sources.cases) {
    expect(result.scores.found.score).toBe(1);
    expect(result.scores.live.score).toBe(1);
  }
}, 60_000);
