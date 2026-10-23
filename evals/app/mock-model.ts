/**
 * A scripted, OpenAI-compatible chat endpoint for the in-process app.
 *
 * The point is not to imitate a good editor. It is to answer each kind of
 * request the app sends in the shape the app expects, so a smoke run exercises
 * the real plumbing: prompt assembly, the `quote_passage` tool loop, JSON
 * parsing, rubric combination, interview protocol tags. A persona request is
 * answered with a tool call first and a note second; a judge gets a
 * `{score, rationale}` object; a rewrite gets `{replacement, rationale}`.
 *
 * Every response is deterministic for a given request, so tests can assert on
 * it, and every request is recorded by kind.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

export type MockRequestKind =
  | "persona-tool-call"
  | "persona-note"
  | "judge"
  | "rewrite"
  | "dossier-check"
  | "interview"
  | "prose"
  | "research-extract"
  | "research-search"
  | "system-one";

export interface MockModelServer {
  /** Base URL without `/v1`, as the app's RIVET_ENDPOINT expects. */
  url: string;
  calls: Array<{ kind: MockRequestKind; model: string }>;
  close(): Promise<void>;
}

interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
}

interface ChatBody {
  model?: string;
  stream?: boolean;
  messages?: ChatMessage[];
  tools?: Array<{ function?: { name?: string } }>;
}

type Reply =
  | { kind: MockRequestKind; text: string }
  | {
      kind: "persona-tool-call";
      toolCall: { name: string; args: Record<string, unknown> };
    };

const FILLER =
  /\b(in today's world|it is important|many experts|studies show|research suggests|at the end of the day|in order to|needless to say|a wide range of|plays a vital role)\b/gi;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .join("");
  return "";
}

/** The manuscript as the persona prompt frames it: `DRAFT (...)\n"""\n…\n"""`. */
function draftFrom(prompt: string): string {
  const fenced = prompt.match(/DRAFT \([^)]*\)\s*\n"""\n([\s\S]*?)\n"""/);
  if (fenced) return fenced[1];
  const tagged = prompt.match(/<draft>([\s\S]*?)<\/draft>/i);
  return tagged ? tagged[1] : prompt;
}

function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 6 && !s.includes("[…"));
}

function personaName(system: string): string {
  return system.match(/You are ([^,.\n]+?),/)?.[1]?.trim() ?? "the editor";
}

/** Higher for specific prose, lower for filler; a plausible, stable 2-9. */
function judgeScore(draft: string): number {
  const words = draft.split(/\s+/).filter(Boolean);
  const unique = new Set(words.map((w) => w.toLowerCase())).size;
  const diversity = words.length ? unique / words.length : 0;
  const filler = (draft.match(FILLER) ?? []).length;
  const raw = 3 + Math.round(diversity * 8) - Math.min(4, filler);
  return Math.max(2, Math.min(9, raw));
}

function interviewReply(messages: ChatMessage[]): string {
  const writerTurns = messages.filter((m) => m.role === "user").length;
  const brief = {
    workingTitle: "Salt Roads",
    format: "travel essay",
    audience: "readers of a literary travel quarterly",
    goal: "make the old salt road feel walked, not described",
    tone: "plain, observant, wry",
    constraints: "under 3,000 words",
    successSignal: "an editor asks to see the next draft",
  };
  if (writerTurns >= 4) {
    return `That gives me enough to work from.\n\nSYNTHESIZE: ${JSON.stringify({
      brief,
      confidence: { workingTitle: "high", audience: "medium", goal: "medium" },
    })}`;
  }
  return `Who do you most want to finish this piece?\n\nDOSSIER: ${JSON.stringify(
    {
      brief: { workingTitle: brief.workingTitle },
      confidence: { workingTitle: "medium" },
    },
  )}`;
}

/** A small, always-different edit: hedges out, then a clause, then a contraction. */
function tighten(original: string): string {
  const steps: Array<(text: string) => string> = [
    (text) =>
      text
        .replace(
          /\b(really|very|quite|actually|just|simply|basically|clearly|obviously|certainly|perhaps|somewhat|rather)\s+/gi,
          "",
        )
        .replace(/\bin order to\b/gi, "to")
        .replace(/\bdue to the fact that\b/gi, "because")
        .replace(/\bit is important to note that\s*/gi, ""),
    (text) => text.replace(/,[^,]{3,80},/, ","),
    (text) =>
      text
        .replace(/\bis not\b/, "isn't")
        .replace(/\bdoes not\b/, "doesn't")
        .replace(/\bit is\b/i, (m) => (m[0] === "I" ? "It's" : "it's")),
  ];
  let text = original;
  for (const step of steps) {
    const next = step(text)
      .replace(/\s{2,}/g, " ")
      .trim();
    if (next && next !== original.trim()) return next;
    text = next || text;
  }
  return text;
}

export function scriptedReply(body: ChatBody): Reply {
  const messages = body.messages ?? [];
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => textOf(m.content))
    .join("\n");
  const user = messages
    .filter((m) => m.role === "user")
    .map((m) => textOf(m.content))
    .join("\n");
  const all = `${system}\n${user}`;
  const hasQuoteTool = (body.tools ?? []).some(
    (t) => t.function?.name === "quote_passage",
  );
  const toolResults = messages.filter((m) => m.role === "tool");

  if (/\bDOSSIER:|\bSYNTHESIZE:/.test(system)) {
    return { kind: "interview", text: interviewReply(messages) };
  }
  if (/proactive research librarian/.test(system)) {
    // Flag the sentences that carry a figure, a year or a quotation; the
    // shape is what the app's parseResearchTargets reads.
    const draft = user.match(/Draft:\n"""\n([\s\S]*?)\n"""/)?.[1] ?? user;
    const flagged = sentences(draft)
      .filter((s) => /\d|["“]/.test(s))
      .slice(0, 6);
    return {
      kind: "research-extract",
      text: JSON.stringify({
        targets: flagged.map((anchor, i) => ({
          kind: /["“]/.test(anchor)
            ? "quote"
            : /\b1[5-9]\d\d|20\d\d\b/.test(anchor)
              ? "event"
              : "statistic",
          anchor: anchor.slice(0, 180),
          reason: "States something a reader may check.",
          query: anchor
            .replace(/["“”]/g, "")
            .split(/\s+/)
            .slice(0, 9)
            .join(" "),
          importance: Math.max(1, 5 - i),
        })),
      }),
    };
  }
  if (/"replacement"/.test(all)) {
    const original = user.match(/PASSAGE:\n"([\s\S]*)"\s*$/)?.[1] ?? "";
    const replacement = tighten(original);
    return {
      kind: "rewrite",
      text: JSON.stringify({
        replacement,
        rationale: "Cut the hedges so the claim stands on its own.",
      }),
    };
  }
  if (/\bobservations\b/.test(system) && /dossier/i.test(system)) {
    return {
      kind: "dossier-check",
      text: JSON.stringify({ observations: [] }),
    };
  }
  if (/"score"\s*:/.test(all)) {
    const draft = draftFrom(user);
    const first = sentences(draft)[0] ?? "the opening";
    return {
      kind: "judge",
      text: JSON.stringify({
        score: judgeScore(draft),
        rationale: `The draft is judged on "${first.slice(0, 80)}".`,
      }),
    };
  }
  if (hasQuoteTool) {
    const draft = draftFrom(user);
    const pool = sentences(draft);
    if (toolResults.length === 0 && pool.length > 0) {
      return {
        kind: "persona-tool-call",
        toolCall: {
          name: "quote_passage",
          args: { query: pool[hash(system) % pool.length] },
        },
      };
    }
    const quoted =
      toolResults
        .map((m) => textOf(m.content))
        .join("\n")
        .match(/"passage"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ??
      pool[0] ??
      "";
    return {
      kind: "persona-note",
      text:
        `"${quoted.replace(/\\"/g, '"')}" carries more weight than the paragraph around it gives it. ` +
        `As ${personaName(system)}, I would make the next sentence earn it with one concrete detail. ` +
        `Next move: name the detail.`,
    };
  }
  return {
    kind: "prose",
    text: "The draft has a clear spine. Revise the middle so each paragraph advances the claim, then cut the closing summary.",
  };
}

function completion(model: string, reply: Reply) {
  const message =
    "toolCall" in reply
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `call_${hash(JSON.stringify(reply.toolCall.args)).toString(16)}`,
              type: "function",
              function: {
                name: reply.toolCall.name,
                arguments: JSON.stringify(reply.toolCall.args),
              },
            },
          ],
        }
      : { role: "assistant", content: reply.text };
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: 1_790_000_000,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: "toolCall" in reply ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
  };
}

function streamChunks(model: string, reply: Reply): string {
  const base = {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1_790_000_000,
    model,
  };
  const delta =
    "toolCall" in reply
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_mock",
              type: "function",
              function: {
                name: reply.toolCall.name,
                arguments: JSON.stringify(reply.toolCall.args),
              },
            },
          ],
        }
      : { role: "assistant", content: reply.text };
  const events = [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "toolCall" in reply ? "tool_calls" : "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    },
  ];
  return (
    events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
    "data: [DONE]\n\n"
  );
}

async function readBody(req: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw;
}

interface JudgementRequest {
  model?: string;
  state?: Record<string, string>;
  questions?: Record<string, { type?: string; criteria?: unknown }>;
}

/**
 * The research claim check: does `claimN` need a source? Sentences with a
 * figure, a year or an attributed quotation do (0.9); the rest do not (0.2),
 * so the hosted strategy's 0.6 cutoff is exercised in both directions.
 */
function claimCheckAnswer(claim: string | undefined): number {
  if (!claim) return 0.05;
  return /\d|["\u201c][^"\u201d]{8,}["\u201d]|\baccording to\b/i.test(claim)
    ? 0.9
    : 0.2;
}

/**
 * System One (TypeSafe) answers. The editorial review gate judges every note
 * fit to release, so its plumbing runs without a redraft; research claim
 * checks follow `claimCheckAnswer`.
 */
function judgementAnswers(request: JudgementRequest) {
  return Object.fromEntries(
    Object.entries(request.questions ?? {}).map(([id, question]) => {
      if (question.type === "noul")
        return [
          id,
          {
            type: "noul",
            noul: /^claim\d+$/.test(id)
              ? claimCheckAnswer(request.state?.[id])
              : 0.05,
          },
        ];
      if (question.type === "choice") {
        const options = Object.keys(
          (question.criteria ?? {}) as Record<string, unknown>,
        );
        const choice = options[0] ?? "";
        return [
          id,
          {
            type: "choice",
            choice,
            probabilities: { [choice]: 1 },
            confidence: 0.9,
          },
        ];
      }
      const levels = Array.isArray(question.criteria)
        ? question.criteria
        : ["", ""];
      const top = levels.length - 1;
      return [
        id,
        {
          type: "score",
          score: top,
          legend: Object.fromEntries(
            levels.map((text, i) => [String(i), String(text)]),
          ),
          probabilities: { [String(top)]: 1 },
          confidence: 0.9,
        },
      ];
    }),
  );
}

export async function startMockModel(): Promise<MockModelServer> {
  const calls: MockModelServer["calls"] = [];
  const server: Server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.endsWith("/v1/systemone")) {
      const request = JSON.parse(await readBody(req)) as JudgementRequest;
      calls.push({ kind: "system-one", model: request.model ?? "jev" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: "jev-mock",
          answers: judgementAnswers(request),
          usage: { input_tokens: 400, output_tokens: 0 },
        }),
      );
      return;
    }
    if (req.method === "POST" && req.url?.endsWith("/v1/search")) {
      // A research provider (RESEARCH_PROVIDER=custom): three stable hits
      // named for the query, the first two with the fields ranking rewards.
      const { query = "" } = JSON.parse(await readBody(req)) as {
        query?: string;
      };
      calls.push({ kind: "research-search", model: "search" });
      const slug = query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 48);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          results: [
            {
              title: `${query.slice(0, 60)} — encyclopedia entry`,
              url: `https://encyclopedia.example/${slug}`,
              snippet: `A reference article on ${query.slice(0, 80)}, with dates, figures and sources.`,
              author: "Reference Desk",
              publisher: "Encyclopedia Example",
            },
            {
              title: `Primary record: ${query.slice(0, 50)}`,
              url: `https://archive.example/${slug}`,
              snippet: `Archival material concerning ${query.slice(0, 80)}.`,
              publisher: "Archive Example",
            },
            {
              title: "Forum thread",
              url: `https://forum.example/${slug}`,
              snippet: "",
            },
          ],
        }),
      );
      return;
    }
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let body: ChatBody;
    try {
      body = JSON.parse(await readBody(req)) as ChatBody;
    } catch {
      res.writeHead(400).end();
      return;
    }
    const model = body.model ?? "mock";
    const reply = scriptedReply(body);
    calls.push({ kind: reply.kind, model });
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(streamChunks(model, reply));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(completion(model, reply)));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
