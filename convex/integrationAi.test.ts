// @vitest-environment node
/// <reference types="vite/client" />

/**
 * The AI operations of the integration API, end to end: a personal access
 * token in, a note out, through the real `http.ts` route, the real cores in
 * `agents.ts`, and one stub server standing in for both hosted models: the
 * editors' model on the legacy OpenAI-compatible route (`RIVET_ENDPOINT`) and
 * System One on the direct TypeSafe route (`TYPESAFE_BASE_URL`).
 */

import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { convexTest, type TestConvex } from "convex-test";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { ResearchTarget } from "../src/types";
import type { Source } from "./research";
import {
  claimCandidates,
  candidateRequest,
} from "../src/utils/research-candidates";
import {
  buildDossierResearchInstructions,
  buildResearchExtractSystemPrompt,
  buildResearchExtractUserPrompt,
  buildResearchSearchContext,
  parseResearchTargets,
  rankSourcesForTarget,
} from "../src/utils/research-targets";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

const ISSUER = "https://twyne.test";
const SUBJECT = "w1";
const OWNER = `${ISSUER}|${SUBJECT}`;

/* ── A hosted model made of string matching ─────────────────────── */

interface SeenRequest {
  path: string;
  system: string;
  user: string;
  /** Function tools offered to the model, by name. */
  tools: string[];
}

/** One System One request as `askDirect` sent it. */
interface SeenJudgement {
  state: Record<string, string>;
  questions: Record<string, { type: string; criteria?: unknown }>;
}

const seen: SeenRequest[] = [];
const judgements: SeenJudgement[] = [];
let server: Server;
let stubEndpoint: string;
let searchStatus = 200;
let systemOneStatus = 200;
let researchReply: string | undefined;
const searches: Array<{
  query: string;
  context?: string;
  max_results: number;
  headers: Record<string, unknown>;
}> = [];
const assertions: Array<Record<string, unknown>> = [];
const SEARCH_HITS = [
  {
    title: "An unsourced mention",
    url: "https://example.test/mention",
    snippet: "Short.",
  },
  {
    title: "Original survey",
    url: "https://example.test/study",
    snippet:
      "The original survey reports the figure, its sample and the year it was measured.",
    author: "Survey team",
    publisher: "Research Institute",
    date: "2024",
  },
  {
    title: "Context",
    url: "https://example.test/context",
    snippet: "A later account.",
  },
];
let searchHits: unknown[] = SEARCH_HITS;
const RESEARCH_DRAFT =
  "In 2024 the harbour lost 40 percent of its fishing boats.\n\nResearchers found that salt damages the ledgers faster.\n\nThe sea was a sheet of beaten tin.";
const MODEL_TARGETS = {
  targets: [
    {
      kind: "statistic",
      anchor: "the harbour lost 40 percent of its fishing boats",
      query: "harbour fishing boats 2024 loss survey",
      reason: "Check the fleet survey.",
      importance: 5,
    },
    {
      kind: "claim",
      anchor: "salt damages the ledgers faster",
      query: "salt damage paper ledgers study",
      reason: "Find the original study.",
      importance: 3,
    },
  ],
};

/**
 * Requests the stub answers the way a reasoning model does when it spends its
 * whole budget thinking: HTTP 200, `finish_reason: "length"`, no content.
 * Each entry exhausts the first `remaining` requests it matches, so a test can
 * script "empty once, then a real score" or "empty every time".
 */
const exhausted: Array<{
  matches: (request: SeenRequest) => boolean;
  remaining: number;
}> = [];

function exhaustFirst(
  remaining: number,
  matches: (request: SeenRequest) => boolean,
) {
  exhausted.push({ matches, remaining });
}

/** A persona judge asked under this editor's name. */
function judgeOf(personaName: string) {
  return (request: SeenRequest) =>
    /JUDGE TASK/.test(request.user) && request.system.includes(personaName);
}

/**
 * A draft carrying this sentence is reviewed harshly on its first candidate:
 * `helpful` lands on the lowest level, which fails the quality bar and asks
 * for a substance rewrite. The revision, which the chat stub marks, passes.
 */
const HARSH_REVIEW_MARKER = "The reviewer will not like the first draft.";
const REVISED_MARKER = "Revised, as directed.";
/** With this in the draft, every note by Mlle. Sceptique fails grounding. */
const VETO_SCEPTIC_MARKER = "The sceptic's notes will all be vetoed.";

function judgementAnswers(request: SeenJudgement) {
  const harsh =
    (request.state.draft ?? "").includes(HARSH_REVIEW_MARKER) &&
    !(request.state.note ?? "").includes(REVISED_MARKER);
  return Object.fromEntries(
    Object.entries(request.questions).map(([id, question]) => {
      if (question.type === "noul") {
        const vetoed =
          id === "draft_claim_unanchored" &&
          (request.state.draft ?? request.state.policyDraft ?? "").includes(
            VETO_SCEPTIC_MARKER,
          ) &&
          (request.state.advisor ?? request.state.policyPersona ?? "").includes(
            "Sceptique",
          );
        return [
          id,
          { type: "noul", noul: vetoed ? 0.95 : id === "claim0" ? 0.9 : 0.05 },
        ];
      }
      if (question.type === "choice") {
        const options = Object.keys(question.criteria as Record<string, null>);
        return [
          id,
          {
            type: "choice",
            choice: options[0],
            probabilities: { [options[0]]: 1 },
            confidence: 0.9,
          },
        ];
      }
      const levels = question.criteria as string[];
      const level = harsh && id === "helpful" ? 0 : levels.length - 1;
      return [
        id,
        {
          type: "score",
          score: level,
          legend: Object.fromEntries(
            levels.map((text, i) => [String(i), text]),
          ),
          probabilities: { [String(level)]: 1 },
          confidence: 0.9,
        },
      ];
    }),
  );
}

function completion(content: string, finishReason = "stop") {
  return {
    id: "chatcmpl-stub",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "stub",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  };
}

/** Each feature's prompt has a phrase nothing else uses; answer in its shape. */
function reply(system: string, user: string): string {
  if (/proactive research librarian/.test(system)) {
    return researchReply ?? JSON.stringify(MODEL_TARGETS);
  }
  if (/Chief Critic/.test(system)) {
    return "The grade reflects a draft with a spine and thin evidence. Cut the second section and source the claim about tides.";
  }
  if (/REWRITE TASK/.test(user)) {
    return JSON.stringify({
      replacement: "The tide went out, and the harbour showed its ribs.",
      rationale: "One concrete image carries what three abstractions did.",
    });
  }
  if (/dossier that the draft has outgrown/.test(system)) {
    return JSON.stringify({
      observations: [
        {
          field: "audience",
          current: "gardeners",
          suggested: "coastal gardeners",
          reason: "Every example in the draft is about salt and wind.",
        },
      ],
    });
  }
  if (/editorial interviewer/.test(system)) {
    return 'Who is this piece for?\nDOSSIER: {"brief": {"workingTitle": "Salt Roads"}, "confidence": {"workingTitle": "high"}}';
  }
  if (/"score"/.test(user)) {
    return JSON.stringify({
      score: 7,
      rationale: "In good shape; the middle sags.",
    });
  }
  const note =
    "**Unproven.**\n« Everyone agrees » assumes a jury you have not seated. Name them.\nWho, exactly, agrees?";
  return /PRIVATE REVISION DIRECTIONS/.test(user)
    ? `${note}\n${REVISED_MARKER}`
    : note;
}

async function startStub(): Promise<string> {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/wallet") {
        res.end(JSON.stringify({ subscriptions: [] }));
        return;
      }
      if (req.url === "/search" || req.url === "/v1/web/search") {
        searches.push({ ...JSON.parse(raw), headers: req.headers });
        res.statusCode = searchStatus;
        res.end(
          JSON.stringify(
            searchStatus === 200
              ? { results: searchHits }
              : { error: "private upstream detail" },
          ),
        );
        return;
      }
      if (req.url === "/v1/auth/token/exchange") {
        const body = JSON.parse(raw) as { assertion: string };
        assertions.push(
          JSON.parse(
            Buffer.from(body.assertion.split(".")[1], "base64url").toString(),
          ),
        );
        res.end(JSON.stringify({ access_token: "search-stub-token" }));
        return;
      }
      if (req.url === "/v1/systemone") {
        const request = JSON.parse(raw) as SeenJudgement;
        judgements.push(request);
        res.statusCode = systemOneStatus;
        res.end(
          JSON.stringify({
            model: "jev-stub",
            answers: judgementAnswers(request),
            usage: { input_tokens: 900, output_tokens: 0 },
          }),
        );
        return;
      }
      if (req.url !== "/v1/chat/completions") {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Unknown stub endpoint" }));
        return;
      }
      const body = JSON.parse(raw) as {
        messages: Array<{ role: string; content: unknown }>;
        tools?: Array<{ function?: { name?: string } }>;
      };
      const text = (role: string) =>
        body.messages
          .filter((m) => m.role === role)
          .map((m) =>
            typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content),
          )
          .join("\n");
      const system = text("system");
      const user = text("user");
      const request: SeenRequest = {
        path: req.url ?? "",
        system,
        user,
        tools: (body.tools ?? [])
          .map((t) => t.function?.name)
          .filter((name): name is string => typeof name === "string"),
      };
      seen.push(request);
      const script = exhausted.find(
        (entry) => entry.remaining > 0 && entry.matches(request),
      );
      if (script) {
        script.remaining -= 1;
        res.end(JSON.stringify(completion("", "length")));
        return;
      }
      res.end(JSON.stringify(completion(reply(system, user))));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

/* ── Fixtures ───────────────────────────────────────────────────── */

const PARAGRAPH =
  "The harbour town kept its records in salt. Every ledger in the customs house had warped along the same curve, as if the sea had leaned on the shelves for a century and the paper had learned to lean back. Nobody who worked there found this strange. They found it strange that visitors remarked on it, the way a fisherman finds it strange to be asked about the smell of fish. The clerk who showed me the ledgers had a habit of running his thumb along the edge of each page before he turned it, checking, I think, that the sea had not taken anything overnight.";

function draftOf(words: number): string {
  const paragraphs: string[] = [];
  let count = 0;
  let index = 0;
  while (count < words) {
    paragraphs.push(`${PARAGRAPH} This is the ${index + 1}th visit I made.`);
    count += PARAGRAPH.split(/\s+/).length + 7;
    index += 1;
  }
  return paragraphs.join("\n\n");
}

const DRAFT = draftOf(560);

const BRIEF = {
  answers: {
    workingTitle: "Salt Roads",
    format: "Essay",
    audience: "gardeners",
    goal: "Show how a coastal town records its weather in its buildings",
    tone: "Measured",
    constraints: "No more than 2,000 words",
    successSignal: "A reader looks differently at a warped shelf",
  },
  attachments: [],
  completedAt: 1,
  updatedAt: 2,
};

interface Harness {
  t: TestConvex<typeof schema>;
  token: string;
  call: (body: unknown, token?: string | null) => Promise<Response>;
}

async function harness(): Promise<Harness> {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({
    tokenIdentifier: OWNER,
    subject: SUBJECT,
    issuer: ISSUER,
  });
  const { token } = await owner.mutation(api.integrations.createToken, {
    name: "harness",
  });
  const call = (body: unknown, bearer: string | null = token) =>
    t.fetch("/api/integrations/v1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { t, token, call };
}

async function ok<T = unknown>(response: Response): Promise<T> {
  const json = (await response.json()) as {
    ok: boolean;
    data: T;
    error?: string;
  };
  expect(json.error).toBeUndefined();
  expect(response.status).toBe(200);
  expect(json.ok).toBe(true);
  return json.data;
}

async function failure(response: Response) {
  const json = (await response.json()) as { ok: boolean; error: string };
  expect(json.ok).toBe(false);
  return { status: response.status, error: json.error };
}

const env: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  env[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeAll(async () => {
  const endpoint = await startStub();
  stubEndpoint = endpoint;
  setEnv("RIVET_ENDPOINT", endpoint);
  setEnv("RIVET_MODEL", "stub/editor");
  setEnv("NOTORGANIC_ENABLED", undefined);
  // System One on the direct developer route, which only unlocks for a
  // loopback deployment, pointed at the same stub.
  setEnv("TYPESAFE_API_KEY", "typesafe-test-key");
  setEnv("TYPESAFE_BASE_URL", endpoint);
  setEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  setEnv("TWYNE_ALLOW_DIRECT_EXTRACTION", undefined);
  setEnv("POSTHOG_CAPTURE", "false");
  setEnv("RESEARCH_PROVIDER", "custom");
  setEnv("RESEARCH_SEARCH_URL", `${endpoint}/search`);
  setEnv("RESEARCH_API_KEY", undefined);
  setEnv("TINYFISH_API_KEY", undefined);
});

afterEach(() => {
  exhausted.length = 0;
  vi.unstubAllEnvs();
  searchStatus = 200;
  systemOneStatus = 200;
  researchReply = undefined;
  searchHits = SEARCH_HITS;
  searches.length = 0;
  assertions.length = 0;
});

afterAll(async () => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/* ── The operations ─────────────────────────────────────────────── */

describeConvex("integration AI operations", () => {
  test("editors.list names the built-in cast", async () => {
    const { call } = await harness();
    const data = await ok<Array<{ id: string; name: string; focus: string }>>(
      await call({ operation: "editors.list" }),
    );
    expect(data.map((e) => e.id)).toEqual([
      "devil",
      "angel",
      "scholar",
      "editor",
      "reader",
    ]);
    expect(data[0]).toMatchObject({
      name: "Mlle. Sceptique",
      role: "The Devil's Advocate",
    });
    expect(Object.keys(data[0]).sort()).toEqual(
      ["description", "focus", "id", "name", "role"].sort(),
    );
  });

  test("room.convene returns one note per requested editor", async () => {
    const { call } = await harness();
    seen.length = 0;
    const data = await ok<{
      notes: Array<{
        personaId: string;
        personaName: string;
        text: string;
        type: string;
        provider: string;
      }>;
    }>(
      await call({
        operation: "room.convene",
        draftText: DRAFT,
        brief: BRIEF,
        personaIds: ["devil", "reader"],
      }),
    );
    expect(data.notes.map((n) => n.personaId)).toEqual(["devil", "reader"]);
    expect(data.notes[0]).toMatchObject({
      personaName: "Mlle. Sceptique",
      provider: "rivet",
      type: "critique",
    });
    expect(data.notes[0].text).toContain("Unproven");
    // The stub saw the real persona system prompt on the OpenAI route.
    expect(seen.map((r) => r.path)).toContain("/v1/chat/completions");
    expect(seen.some((r) => /Mlle\. Sceptique/.test(r.system))).toBe(true);
    expect(seen.some((r) => r.user.includes("gardeners"))).toBe(true);
  });

  test("editor.ask answers as one editor, with a follow-up", async () => {
    const { call } = await harness();
    seen.length = 0;
    const data = await ok<{
      note: { personaId: string; personaName: string; provider: string };
    }>(
      await call({
        operation: "editor.ask",
        personaId: "scholar",
        draftText: DRAFT,
        instruction: "elaborate",
        userMessage: "Which claim needs a date?",
        priorMessages: [{ author: "persona", text: "N.B. the ledgers." }],
      }),
    );
    expect(data.note).toMatchObject({
      personaId: "scholar",
      personaName: "Professeur Athenæum",
      provider: "rivet",
    });
    expect(seen.some((r) => r.user.includes("Which claim needs a date?"))).toBe(
      true,
    );
  });

  test("rewrite.suggest returns a replacement and rationale", async () => {
    const { call } = await harness();
    seen.length = 0;
    const data = await ok<{
      replacement: string;
      rationale: string;
      provider: string;
    }>(
      await call({
        operation: "rewrite.suggest",
        personaId: "editor",
        draftText: DRAFT,
        original: "The tide was out and the harbour looked empty and sad.",
        level: "sentence",
      }),
    );
    expect(data).toEqual({
      replacement: "The tide went out, and the harbour showed its ribs.",
      rationale: "One concrete image carries what three abstractions did.",
      provider: "rivet",
    });
    const ask = seen.find((r) => /REWRITE TASK/.test(r.user));
    expect(ask?.user).toContain("Keep the replacement to a single sentence.");
    expect(ask?.user).toContain(
      "Keep every name, number, date, place and term of art the passage contains",
    );
    expect(ask?.user).toContain(
      "keep the term and explain it in plain words rather than replacing it",
    );
    expect(ask?.user).toContain(
      'PASSAGE:\n"The tide was out and the harbour looked empty and sad."',
    );
  });

  test("rubric.grade assembles the panel's hosted grade", async () => {
    const { call } = await harness();
    seen.length = 0;
    const data = await ok<{
      grade: string;
      combined: number;
      judgeMean: number;
      minJudge: number;
      staticTotal: number;
      staticFeedback: string[];
      judges: Array<{ personaId: string; score: number; provider: string }>;
      sufficiency: { score: number; provider: string };
      evidence: { score: number; provider: string };
      integrity: { score: number; provider: string };
      targetFit: { score: number; provider: string };
      custom: Array<{ label: string; score: number; provider: string }>;
      review: { text: string; provider: string } | null;
      unjudged: string[];
    }>(
      await call({
        operation: "rubric.grade",
        draftText: DRAFT,
        brief: BRIEF,
        criteria: [
          { label: "Stays in first person", description: "Never slips." },
        ],
      }),
    );
    expect(data.judges.map((j) => j.personaId)).toEqual([
      "devil",
      "angel",
      "scholar",
      "editor",
      "reader",
    ]);
    for (const judge of data.judges) {
      expect(judge).toMatchObject({ score: 7, provider: "rivet" });
    }
    expect(data.judgeMean).toBe(7);
    expect(data.minJudge).toBe(7);
    expect(data.sufficiency).toMatchObject({ score: 7, provider: "rivet" });
    expect(data.evidence).toMatchObject({ score: 7, provider: "rivet" });
    expect(data.integrity).toMatchObject({ score: 7, provider: "rivet" });
    expect(data.targetFit).toMatchObject({ score: 7, provider: "rivet" });
    expect(data.custom).toEqual([
      {
        label: "Stays in first person",
        score: 7,
        rationale: "In good shape; the middle sags.",
        provider: "rivet",
      },
    ]);
    expect(data.review?.provider).toBe("rivet");
    expect(data.review?.text).toContain("Cut the second section");
    expect(typeof data.staticTotal).toBe("number");
    expect(Array.isArray(data.staticFeedback)).toBe(true);
    expect(data.combined).toBeGreaterThan(0);
    expect(data.grade).toMatch(/^[A-F][+-]?$/);
    // Five judges, four dedicated judges, one custom criterion, one review.
    expect(seen.length).toBe(11);
    expect(data.unjudged).toEqual([]);
  });

  test("a judge whose first answer is empty is asked again and stays hosted", async () => {
    const { call } = await harness();
    seen.length = 0;
    exhausted.length = 0;
    exhaustFirst(1, judgeOf("Mlle. Sceptique"));
    const data = await ok<{
      judges: Array<{ personaId: string; score: number; provider: string }>;
      unjudged: string[];
    }>(
      await call({ operation: "rubric.grade", draftText: DRAFT, brief: BRIEF }),
    );
    expect(data.judges.map((j) => j.personaId)).toEqual([
      "devil",
      "angel",
      "scholar",
      "editor",
      "reader",
    ]);
    expect(data.judges[0]).toMatchObject({
      personaId: "devil",
      score: 7,
      provider: "rivet",
    });
    expect(data.unjudged).toEqual([]);
    // The devil was asked twice, with the same prompt both times.
    const devilAsks = seen.filter(judgeOf("Mlle. Sceptique"));
    expect(devilAsks.length).toBe(2);
    expect(devilAsks[1].user).toBe(devilAsks[0].user);
    expect(devilAsks[1].system).toBe(devilAsks[0].system);
  });

  test("a judge who stays silent is left out of the room, by name", async () => {
    const { call } = await harness();
    seen.length = 0;
    exhausted.length = 0;
    exhaustFirst(2, judgeOf("Mlle. Sceptique"));
    const data = await ok<{
      judges: Array<{ personaId: string; score: number; provider: string }>;
      judgeMean: number;
      minJudge: number;
      unjudged: string[];
    }>(
      await call({ operation: "rubric.grade", draftText: DRAFT, brief: BRIEF }),
    );
    expect(data.judges.map((j) => j.personaId)).toEqual([
      "angel",
      "scholar",
      "editor",
      "reader",
    ]);
    expect(data.judges.every((j) => j.provider === "rivet")).toBe(true);
    expect(data.judgeMean).toBe(7);
    expect(data.minJudge).toBe(7);
    expect(data.unjudged).toEqual(["devil"]);
    expect(seen.filter(judgeOf("Mlle. Sceptique")).length).toBe(2);
  });

  test("a room where no editor answers is a provider failure, not a grade", async () => {
    const { call } = await harness();
    seen.length = 0;
    exhausted.length = 0;
    exhaustFirst(
      Number.POSITIVE_INFINITY,
      (request) =>
        /JUDGE TASK/.test(request.user) &&
        /Mlle\. Sceptique|Sœur Encourageante|Professeur Athenæum|M\. Le Stylo|Le Lecteur/.test(
          request.system,
        ),
    );
    const response = await call({
      operation: "rubric.grade",
      draftText: DRAFT,
      brief: BRIEF,
    });
    const json = (await response.json()) as {
      ok: boolean;
      error: string;
      code?: string;
    };
    expect(response.status).toBe(503);
    expect(json.ok).toBe(false);
    expect(json.code).toBe("provider_unavailable");
    // Every editor was asked twice before the room gave up.
    expect(seen.filter((r) => /JUDGE TASK/.test(r.user)).length).toBe(10);
  });

  test("an empty evidence judgement is asked again before any fallback", async () => {
    const { call } = await harness();
    seen.length = 0;
    exhausted.length = 0;
    const evidenceAsk = (request: SeenRequest) =>
      /rigorous research editor/.test(request.system);
    exhaustFirst(1, evidenceAsk);
    const data = await ok<{
      evidence: { score: number; rationale: string; provider: string };
    }>(
      await call({ operation: "rubric.grade", draftText: DRAFT, brief: BRIEF }),
    );
    expect(data.evidence).toMatchObject({ score: 7, provider: "rivet" });
    expect(seen.filter(evidenceAsk).length).toBe(2);
  });

  test("dossier.check reports fields the draft outgrew", async () => {
    const { call } = await harness();
    const data = await ok<{
      observations: Array<{ field: string; suggested: string }>;
      provider: string;
    }>(
      await call({
        operation: "dossier.check",
        brief: BRIEF,
        draftText: DRAFT,
      }),
    );
    expect(data.provider).toBe("rivet");
    expect(data.observations).toEqual([
      {
        field: "audience",
        current: "gardeners",
        suggested: "coastal gardeners",
        reason: "Every example in the draft is about salt and wind.",
      },
    ]);
  });

  test("interview.turn returns the interviewer's next question", async () => {
    const { call } = await harness();
    const data = await ok<{
      kind: string;
      text: string;
      draft?: { brief: { workingTitle?: string } };
      provider: string;
    }>(
      await call({
        operation: "interview.turn",
        mode: "first-run",
        messages: [{ author: "writer", text: "An essay about a harbour." }],
      }),
    );
    expect(data.kind).toBe("question");
    expect(data.text).toBe("Who is this piece for?");
    expect(data.draft?.brief.workingTitle).toBe("Salt Roads");
    expect(data.provider).toBe("rivet");
  });
});

/* ── Resolving the manuscript from a folio ──────────────────────── */

describeConvex("folioId resolution", () => {
  test("loads the owner's folio as plain text and uses its filed brief", async () => {
    const { t, call } = await harness();
    const html = DRAFT.split("\n\n")
      .map((p) => `<p>${p.replace(/&/g, "&amp;")}</p>`)
      .join("");
    const folio = (await t.mutation(internal.integrations.putFolio, {
      userId: OWNER,
      folio: { name: "Salt Roads", type: "draft" },
      html: `<h1>Salt &amp; Roads</h1>${html}`,
      brief: { ...BRIEF, answers: { ...BRIEF.answers, audience: "sailors" } },
    })) as { id: string };
    seen.length = 0;
    const data = await ok<{ notes: Array<{ personaId: string }> }>(
      await call({
        operation: "room.convene",
        folioId: folio.id,
        personaIds: ["angel"],
      }),
    );
    expect(data.notes).toHaveLength(1);
    const prompt = seen.find((r) => /Sœur Encourageante/.test(r.system));
    expect(prompt).toBeDefined();
    expect(prompt!.user).toContain("Salt & Roads");
    expect(prompt!.user).toContain("kept its records in salt");
    expect(prompt!.user).not.toContain("<p>");
    // The folio's own brief fills in when the request carries none.
    expect(prompt!.user).toContain("sailors");
  });

  test("a folio belonging to someone else is not found", async () => {
    const { t, call } = await harness();
    const folio = (await t.mutation(internal.integrations.putFolio, {
      userId: "https://twyne.test|someone-else",
      folio: { name: "Theirs", type: "draft" },
      html: `<p>${DRAFT}</p>`,
    })) as { id: string };
    const { status, error } = await failure(
      await call({
        operation: "editor.ask",
        personaId: "devil",
        folioId: folio.id,
      }),
    );
    expect(status).toBe(400);
    expect(error).toBe("folioId must be one of your folios");
  });
});

/* ── Refusals ───────────────────────────────────────────────────── */

describeConvex("integration AI refusals", () => {
  test("a request without a token is a 401", async () => {
    const { call } = await harness();
    const { status } = await failure(
      await call({ operation: "editors.list" }, null),
    );
    expect(status).toBe(401);
  });

  test("missing and invalid fields are 400s with plain messages", async () => {
    const { call } = await harness();
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { operation: "room.convene", brief: BRIEF },
        "draftText or folioId is required",
      ],
      [
        { operation: "editor.ask", personaId: "muse", draftText: DRAFT },
        "personaId must be one of devil, angel, scholar, editor, reader",
      ],
      [
        { operation: "room.convene", draftText: DRAFT, personaIds: [] },
        "personaIds must be a non-empty array",
      ],
      [
        {
          operation: "rewrite.suggest",
          personaId: "editor",
          draftText: DRAFT,
          level: "sentence",
        },
        "original is required",
      ],
      [
        {
          operation: "rewrite.suggest",
          personaId: "editor",
          draftText: DRAFT,
          original: "x",
          level: "page",
        },
        "level must be one of sentence, paragraph",
      ],
      [{ operation: "dossier.check", draftText: DRAFT }, "brief is required"],
      [
        { operation: "interview.turn", mode: "first-run" },
        "messages must be an array",
      ],
      [
        { operation: "interview.turn", mode: "later", messages: [] },
        "mode must be one of first-run, refine",
      ],
      [
        { operation: "rubric.grade", draftText: DRAFT, responseLocale: "de" },
        "responseLocale must be one of en, fr, es, zh, hi, ja",
      ],
      [
        { operation: "rubric.grade", draftText: "Too short to grade." },
        "draftText must be at least 500 words before the rubric can grade it",
      ],
      [
        {
          operation: "room.convene",
          draftText: DRAFT,
          brief: { answers: { workingTitle: "only this" } },
        },
        "Request fields must be valid for room.convene",
      ],
    ];
    for (const [body, expected] of cases) {
      const { status, error } = await failure(await call(body));
      expect([body.operation, status]).toEqual([body.operation, 400]);
      expect([body.operation, error]).toEqual([body.operation, expected]);
    }
  });

  test("a short draft is refused by the room with its own message", async () => {
    const { call } = await harness();
    const response = await call({
      operation: "room.convene",
      draftText: "Only a few words here.",
    });
    const json = (await response.json()) as {
      ok: boolean;
      error: string;
      code?: string;
    };
    expect(response.status).toBe(400);
    expect(json.code).toBe("validation_failed");
    expect(json.error).toBe("Write a little more before convening the room.");
  });
});

/* ── The editorial review and research on the token path ────────── */

describeConvex("editorial review on the token path", () => {
  test("a note is reviewed by System One and redrafted when it fails", async () => {
    const { call } = await harness();
    seen.length = 0;
    judgements.length = 0;
    const data = await ok<{ note: { text: string; provider: string } }>(
      await call({
        operation: "editor.ask",
        personaId: "devil",
        draftText: `${DRAFT}\n\n${HARSH_REVIEW_MARKER}`,
        brief: BRIEF,
      }),
    );
    // Two candidates were drafted: the second carries the repair directions.
    const drafts = seen.filter((r) => /Mlle\. Sceptique/.test(r.system));
    expect(drafts).toHaveLength(2);
    expect(drafts[0].user).not.toContain("PRIVATE REVISION DIRECTIONS");
    expect(drafts[1].user).toContain("PRIVATE REVISION DIRECTIONS");
    expect(drafts[1].user).toContain("helpful");
    // Each candidate went to the reviewer with the note-gate questions.
    expect(judgements).toHaveLength(2);
    for (const judgement of judgements) {
      expect(Object.keys(judgement.questions)).toEqual(
        expect.arrayContaining([
          "helpful",
          "actionable",
          "servesGoal",
          "adherence",
          "identity_invented",
        ]),
      );
      expect(judgement.state.advisor).toContain("Mlle. Sceptique");
    }
    expect(judgements[1].state.note).toContain(REVISED_MARKER);
    // The released note is the revision.
    expect(data.note.text).toContain(REVISED_MARKER);
    expect(data.note.provider).toBe("rivet");
  });

  test("a vetoed editor drops out of the room; the others are released", async () => {
    const { call } = await harness();
    judgements.length = 0;
    const data = await ok<{
      notes: Array<{ personaId: string; text: string }>;
      withheld: string[];
    }>(
      await call({
        operation: "room.convene",
        personaIds: ["devil", "angel"],
        draftText: `${DRAFT}\n\n${VETO_SCEPTIC_MARKER}`,
        brief: BRIEF,
      }),
    );
    expect(data.notes.map((note) => note.personaId)).toEqual(["angel"]);
    expect(data.notes[0].text.trim()).not.toBe("");
    expect(data.withheld).toEqual(["devil"]);
    // The sceptic was redrafted before being withheld, not dropped at once.
    const scepticReviews = judgements.filter((j) =>
      (j.state.advisor ?? "").includes("Sceptique"),
    );
    expect(scepticReviews.length).toBeGreaterThan(1);
  });

  test("a room in which every note is vetoed is a provider failure", async () => {
    const { call } = await harness();
    const res = await call({
      operation: "room.convene",
      personaIds: ["devil"],
      draftText: `${DRAFT}\n\n${VETO_SCEPTIC_MARKER}`,
      brief: BRIEF,
    });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("provider_unavailable");
  });

  test("a note the reviewer accepts is drafted once", async () => {
    const { call } = await harness();
    seen.length = 0;
    judgements.length = 0;
    await ok(
      await call({
        operation: "room.convene",
        personaIds: ["reader"],
        draftText: DRAFT,
      }),
    );
    expect(seen.filter((r) => /Reader/.test(r.system))).toHaveLength(1);
    expect(judgements).toHaveLength(1);
  });

  test("research tools appear when extraction is reachable", async () => {
    const before = {
      NODE_ENV: process.env.NODE_ENV,
      TWYNE_ALLOW_DIRECT_EXTRACTION: process.env.TWYNE_ALLOW_DIRECT_EXTRACTION,
      CLOUDFLARE_AI_API_TOKEN: process.env.CLOUDFLARE_AI_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    };
    process.env.NODE_ENV = "development";
    process.env.TWYNE_ALLOW_DIRECT_EXTRACTION = "1";
    process.env.CLOUDFLARE_AI_API_TOKEN = "cf-test";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct-test";
    try {
      const { call } = await harness();
      seen.length = 0;
      await ok(
        await call({
          operation: "editor.ask",
          personaId: "editor",
          draftText: DRAFT,
        }),
      );
      const draft = seen.find((r) =>
        /Copy Chief|Rédacteur|editor/i.test(r.system),
      );
      expect(draft).toBeDefined();
      expect(draft!.tools).toEqual(
        expect.arrayContaining([
          "quote_passage",
          "find_passages",
          "extract",
          "judge",
        ]),
      );
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("without extraction only the quote tool and the judge are offered", async () => {
    const { call } = await harness();
    seen.length = 0;
    await ok(
      await call({
        operation: "editor.ask",
        personaId: "devil",
        draftText: DRAFT,
      }),
    );
    const draft = seen.find((r) => /Mlle\. Sceptique/.test(r.system));
    expect(draft!.tools).toEqual(["quote_passage", "judge"]);
  });
});

describeConvex("auto-research on the token path", () => {
  test("hosted targets confirm rule candidates through System One", async () => {
    const { call } = await harness();
    judgements.length = 0;
    seen.length = 0;
    const data = await ok<{
      strategy: string;
      provider: string;
      mode: string;
      targets: ResearchTarget[];
      candidates: ReturnType<typeof claimCandidates>;
    }>(
      await call({
        operation: "research.targets",
        draftText: RESEARCH_DRAFT,
        brief: BRIEF,
        maxTargets: 1,
      }),
    );
    expect(data).toMatchObject({
      strategy: "hosted",
      provider: "hosted",
      mode: "nonfiction",
    });
    expect(data.candidates).toEqual(claimCandidates(RESEARCH_DRAFT));
    expect(data.candidates).toHaveLength(2);
    expect(data.targets).toEqual([
      {
        id: "hosted-0",
        kind: "statistic",
        anchor: data.candidates[0].anchor,
        reason: data.candidates[0].reason,
        query: data.candidates[0].anchor,
        importance: 5,
      },
    ]);
    expect(judgements).toHaveLength(1);
    const request = candidateRequest(data.candidates, "nonfiction");
    expect(judgements[0].state).toEqual(request.state);
    expect(Object.keys(judgements[0].questions)).toEqual(["claim0", "claim1"]);
    expect(seen).toHaveLength(0);
  });

  test("hosted mode uses the owner's filed dossier, including fiction", async () => {
    const { t, call } = await harness();
    const folio = (await t.mutation(internal.integrations.putFolio, {
      userId: OWNER,
      folio: { name: "Salt Roads", type: "draft" },
      html: `<p>${RESEARCH_DRAFT}</p>`,
      brief: { ...BRIEF, answers: { ...BRIEF.answers, format: "Novel" } },
    })) as { id: string };
    judgements.length = 0;
    const data = await ok<{ mode: string }>(
      await call({ operation: "research.targets", folioId: folio.id }),
    );
    expect(data.mode).toBe("fiction");
    expect(judgements[0].state.mode).toContain("This is fiction");
  });

  test("no rule candidates means no judgement request", async () => {
    const { call } = await harness();
    judgements.length = 0;
    expect(
      await ok(
        await call({
          operation: "research.targets",
          draftText: "The sea was a sheet of beaten tin.",
        }),
      ),
    ).toEqual({
      strategy: "hosted",
      provider: "hosted",
      mode: "general",
      targets: [],
      candidates: [],
    });
    expect(judgements).toHaveLength(0);
  });

  test("model targets use the browser's prompts, parser and dossier directions", async () => {
    const { call } = await harness();
    seen.length = 0;
    judgements.length = 0;
    const existingSources = ["The harbour fleet register"];
    const data = await ok<{
      strategy: string;
      provider: string;
      mode: string;
      targets: ResearchTarget[];
      candidates?: unknown;
    }>(
      await call({
        operation: "research.targets",
        strategy: "model",
        draftText: RESEARCH_DRAFT,
        brief: BRIEF,
        maxTargets: 1,
        existingSources,
      }),
    );
    expect(data).toEqual({
      strategy: "model",
      provider: "rivet",
      mode: "nonfiction",
      targets: parseResearchTargets(JSON.stringify(MODEL_TARGETS)).slice(0, 1),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].system).toBe(buildResearchExtractSystemPrompt());
    expect(seen[0].user).toBe(
      buildResearchExtractUserPrompt({
        draftText: RESEARCH_DRAFT,
        existingSources,
        maxTargets: 1,
        instructions: buildDossierResearchInstructions(BRIEF),
      }),
    );
    expect(judgements).toHaveLength(0);
  });

  test("empty model output gets one second chance", async () => {
    const { call } = await harness();
    seen.length = 0;
    exhaustFirst(1, (request) =>
      /proactive research librarian/.test(request.system),
    );
    const data = await ok<{ targets: ResearchTarget[]; provider: string }>(
      await call({
        operation: "research.targets",
        strategy: "model",
        draftText: RESEARCH_DRAFT,
      }),
    );
    expect(data.provider).toBe("rivet");
    expect(data.targets).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual(seen[0]);
  });

  test("two silent model answers are a provider failure", async () => {
    const { call } = await harness();
    seen.length = 0;
    exhaustFirst(2, (request) =>
      /proactive research librarian/.test(request.system),
    );
    const response = await call({
      operation: "research.targets",
      strategy: "model",
      draftText: RESEARCH_DRAFT,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "provider_unavailable",
    });
    expect(seen).toHaveLength(2);
  });

  test("a valid empty model intake is a successful pass", async () => {
    const { call } = await harness();
    researchReply = '{"targets":[]}';
    seen.length = 0;
    const data = await ok<{ targets: ResearchTarget[] }>(
      await call({
        operation: "research.targets",
        strategy: "model",
        draftText: RESEARCH_DRAFT,
      }),
    );
    expect(data.targets).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  test("a failed System One confirmation is not an empty success", async () => {
    const { call } = await harness();
    systemOneStatus = 502;
    const response = await call({
      operation: "research.targets",
      draftText: RESEARCH_DRAFT,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "provider_unavailable",
    });
  });

  const target = {
    kind: "statistic" as const,
    anchor: "40 percent of its fishing boats",
    query: "harbour fleet survey",
    reason: "Check the original survey.",
  };

  test("sources preserve provider order and return the browser's ranking and context", async () => {
    const { call } = await harness();
    const data = await ok<{
      provider: string;
      results: Source[];
      ranked: Source[];
    }>(await call({ operation: "research.sources", target, maxResults: 2 }));
    expect(data.provider).toBe("custom");
    expect(data.results).toEqual(SEARCH_HITS.slice(0, 2));
    expect(data.ranked).toEqual(rankSourcesForTarget(data.results));
    expect(data.ranked[0].url).toBe(SEARCH_HITS[1].url);
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      query: target.query,
      max_results: 2,
      context: buildResearchSearchContext({
        ...target,
        id: "test",
        importance: 5,
      }),
    });
  });

  test("an empty live search stays empty", async () => {
    const { call } = await harness();
    searchHits = [];
    expect(
      await ok(await call({ operation: "research.sources", target })),
    ).toEqual({ provider: "custom", results: [], ranked: [] });
  });

  test("no live search configuration gives 503 configuration_required", async () => {
    const { call } = await harness();
    for (const provider of ["tinyfish", "custom", "notorganic"]) {
      vi.stubEnv("RESEARCH_PROVIDER", provider);
      vi.stubEnv("RESEARCH_SEARCH_URL", "");
      const response = await call({ operation: "research.sources", target });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        code: "configuration_required",
      });
    }
    expect(searches).toHaveLength(0);
  });

  test("upstream search failure is redacted and never replaced with local sources", async () => {
    const { call } = await harness();
    searchStatus = 502;
    const response = await call({ operation: "research.sources", target });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect(JSON.stringify(body)).not.toContain("private upstream detail");
    expect(body).not.toHaveProperty("data");
  });

  test("token and browser searches spend the same per-owner rate limit", async () => {
    const { t, call } = await harness();
    for (let i = 0; i < 5; i++)
      await ok(await call({ operation: "research.sources", target }));
    await expect(
      t
        .withIdentity({
          tokenIdentifier: OWNER,
          subject: SUBJECT,
          issuer: ISSUER,
        })
        .action(api.research.searchSources, { query: target.query }),
    ).rejects.toThrow(/rate|many|limit/i);
    expect(searches).toHaveLength(5);
  });

  test("Not Organic searches as the linked DID with DPoP and a cost ceiling, and handles 502", async () => {
    const { t, call } = await harness();
    vi.stubEnv("RESEARCH_PROVIDER", "notorganic");
    vi.stubEnv("NOTORGANIC_ENABLED", "true");
    vi.stubEnv("NOTORGANIC_ISSUER", stubEndpoint);
    vi.stubEnv(
      "NOTORGANIC_ASSERTION_PRIVATE_KEY",
      generateKeyPairSync("ed25519")
        .privateKey.export({ format: "pem", type: "pkcs8" })
        .toString(),
    );
    vi.stubEnv("NOTORGANIC_SEARCH_MAX_COST_MICROUSD", "12345");
    await t.run(async (ctx) => {
      await ctx.db.insert("providerIdentities", {
        productSubject: SUBJECT,
        did: "did:plc:research-writer",
        sessionVersion: 3,
        verificationMethod: "notorganic_pkce",
        verifiedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    searchHits = [
      {
        title: "Fleet survey",
        url: "https://www.archive.test/fleet",
        snippet: "The original fleet survey.",
        published_at: "2024-03-01",
      },
    ];
    const data = await ok<{ provider: string; results: Source[] }>(
      await call({ operation: "research.sources", target, maxResults: 2 }),
    );
    expect(data).toMatchObject({
      provider: "notorganic",
      results: [{ publisher: "archive.test", date: "2024-03-01" }],
    });
    expect(
      assertions.find((a) =>
        (a.capabilities as string[]).includes("web:search"),
      ),
    ).toMatchObject({
      sub: "did:plc:research-writer",
      capabilities: ["web:search"],
      session_version: 3,
    });
    expect(searches[0]).toMatchObject({
      query: target.query,
      max_results: 2,
      headers: {
        authorization: "DPoP search-stub-token",
        dpop: expect.any(String),
        "x-notorganic-product": "twyne",
        "x-notorganic-feature": "research",
        "x-notorganic-max-cost-microusd": "12345",
        "idempotency-key": expect.stringMatching(/^twyne_research_/),
      },
    });
    searchStatus = 502;
    const response = await call({ operation: "research.sources", target });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect(JSON.stringify(body)).not.toContain("private upstream detail");
    expect(searches).toHaveLength(2);
  });

  test("research fields are validated before any provider call", async () => {
    const { call } = await harness();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ operation: "research.targets" }, "draftText or folioId is required"],
      [
        {
          operation: "research.targets",
          draftText: RESEARCH_DRAFT,
          strategy: "other",
        },
        "strategy must be one of hosted, model",
      ],
      ...[0, 13, 1.5, "2", null].map(
        (maxTargets) =>
          [
            {
              operation: "research.targets",
              draftText: RESEARCH_DRAFT,
              maxTargets,
            },
            "maxTargets must be an integer between 1 and 12",
          ] as [Record<string, unknown>, string],
      ),
      [
        {
          operation: "research.targets",
          draftText: RESEARCH_DRAFT,
          existingSources: [7],
        },
        "existingSources must be an array of strings",
      ],
      [{ operation: "research.sources" }, "target must be an object"],
      [
        { operation: "research.sources", target: { ...target, kind: "other" } },
        "target.kind must be one of quote, work, person, statistic, claim, event",
      ],
      [
        { operation: "research.sources", target: { ...target, anchor: "" } },
        "target.anchor is required",
      ],
      [
        { operation: "research.sources", target: { ...target, query: "" } },
        "target.query is required",
      ],
      ...[0, 11, 1.5, "2", null].map(
        (maxResults) =>
          [
            { operation: "research.sources", target, maxResults },
            "maxResults must be an integer between 1 and 10",
          ] as [Record<string, unknown>, string],
      ),
    ];
    for (const [body, error] of cases) {
      expect(await failure(await call(body))).toEqual({ status: 400, error });
    }
    expect(searches).toHaveLength(0);
  });
});

/* ── The browser actions still work the same way ────────────────── */

describeConvex("public agent actions", () => {
  test("judgeDraft resolves its caller from ctx.auth as before", async () => {
    const { t } = await harness();
    const owner = t.withIdentity({
      tokenIdentifier: OWNER,
      subject: SUBJECT,
      issuer: ISSUER,
    });
    const result = (await owner.action(api.agents.judgeDraft, {
      persona: {
        id: "devil",
        name: "Mlle. Sceptique",
        role: "The Devil's Advocate",
        description: "Hunts the unstated assumption.",
        focus: "Logic",
      },
      brief: BRIEF,
      draftText: DRAFT,
    })) as { score: number; rationale: string; provider: string };
    expect(result).toEqual({
      score: 7,
      rationale: "In good shape; the middle sags.",
      provider: "rivet",
    });
    await expect(
      t.action(api.agents.judgeDraft, {
        persona: {
          id: "devil",
          name: "Mlle. Sceptique",
          role: "The Devil's Advocate",
          description: "Hunts the unstated assumption.",
          focus: "Logic",
        },
        brief: null,
        draftText: DRAFT,
      }),
    ).rejects.toThrow(/Not signed in/);
  });

  test("systemOne.ask still answers 'signed out' to an anonymous caller", async () => {
    const { t } = await harness();
    judgements.length = 0;
    await expect(
      t.action(api.systemOne.ask, {
        state: { note: "A note." },
        questions: { fine: { type: "noul", instructions: "Is it fine?" } },
      }),
    ).resolves.toEqual({ ok: false, error: "signed out" });
    expect(judgements).toHaveLength(0);
  });
});
