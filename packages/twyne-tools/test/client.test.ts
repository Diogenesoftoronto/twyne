import { describe, expect, test } from "bun:test";
import { TwyneApiError, TwyneClient } from "../src/client.js";
import { brief, grade, interview, note, rewrite } from "./room-fixtures.js";
import { sources, targets } from "./research-fixtures.js";

describe("TwyneClient", () => {
  test("sends research operations and bodies with AbortSignal and returns raw data", async () => {
    const signal = new AbortController().signal;
    const requests: unknown[] = [];
    const responses = [targets, sources];
    const client = new TwyneClient({
      apiUrl: "http://localhost:8788",
      accessToken: "twyne_pat_test",
      fetch: (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        expect(init?.signal).toBe(signal);
        return Response.json({
          ok: true,
          data: responses[requests.length - 1],
        });
      }) as typeof fetch,
    });
    expect(
      await client.findResearchTargets(
        {
          draftText: "Everyone agrees.",
          folioId: undefined,
          brief: null,
          strategy: "model",
          maxTargets: 3,
          existingSources: ["Title A", "Title B"],
        },
        signal,
      ),
    ).toEqual(targets);
    expect(
      await client.searchResearchSources(
        {
          target: {
            kind: "claim",
            anchor: "Everyone agrees.",
            query: "survey consensus",
            reason: undefined,
          },
          maxResults: 2,
        },
        signal,
      ),
    ).toEqual(sources);
    expect(requests).toEqual([
      {
        operation: "research.targets",
        draftText: "Everyone agrees.",
        brief: null,
        strategy: "model",
        maxTargets: 3,
        existingSources: ["Title A", "Title B"],
      },
      {
        operation: "research.sources",
        target: {
          kind: "claim",
          anchor: "Everyone agrees.",
          query: "survey consensus",
        },
        maxResults: 2,
      },
    ]);
  });

  test("research methods omit undefined fields before calling request", async () => {
    const client = new TwyneClient({
      apiUrl: "https://twyne.example",
      accessToken: "test",
    });
    const requests: unknown[] = [];
    client.request = async <T>(request: unknown) => {
      requests.push(request);
      return {} as T;
    };
    await client.findResearchTargets({
      folioId: "folio-1",
      draftText: undefined,
      strategy: undefined,
      maxTargets: undefined,
      brief: null,
      existingSources: undefined,
    });
    const target = {
      kind: "claim" as const,
      anchor: "Everyone agrees.",
      query: "survey consensus",
      reason: "Check the consensus.",
    };
    await client.searchResearchSources({ target, maxResults: undefined });
    expect(requests).toStrictEqual([
      { operation: "research.targets", folioId: "folio-1", brief: null },
      { operation: "research.sources", target },
    ]);
  });

  test("sends every room operation, defined fields, and AbortSignal unchanged", async () => {
    const signal = new AbortController().signal;
    const responses = [
      [
        {
          id: "devil",
          name: note.personaName,
          role: "The Devil's Advocate",
          description: "Sceptic",
          focus: "Argument",
        },
      ],
      { notes: [note] },
      { note },
      rewrite,
      grade,
      { observations: [{ text: "Define the audience." }], provider: "mock" },
      interview,
    ];
    const requests: unknown[] = [];
    const client = new TwyneClient({
      apiUrl: "http://localhost:8788",
      accessToken: "twyne_pat_test",
      fetch: (async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        expect(init?.signal).toBe(signal);
        return Response.json({
          ok: true,
          data: responses[requests.length - 1],
        });
      }) as typeof fetch,
    });
    const roomInput = {
      draftText: "Everyone agrees.",
      brief: null,
      personaIds: ["devil", "angel"] as const,
      writerProfile: { goals: ["Clarity"] },
      responseLocale: "fr" as const,
      newMaterial: "No one objects.",
      trajectory: { direction: "Tighten" },
    };
    const askInput = {
      folioId: "folio-1",
      personaId: "devil" as const,
      brief,
      instruction: "elaborate" as const,
      userMessage: "Why?",
      anchor: "Everyone agrees.",
      priorMessages: [{ author: "writer", text: "Explain." }],
      writerProfile: {},
      responseLocale: "en" as const,
    };
    const rewriteInput = {
      draftText: "Everyone agrees.",
      personaId: "editor" as const,
      original: "Everyone agrees.",
      level: "sentence" as const,
      brief,
      writerProfile: {},
      responseLocale: "en" as const,
    };
    const gradeInput = {
      folioId: "folio-1",
      brief,
      criteria: [{ label: "Clarity", description: "Readable" }],
      responseLocale: "es" as const,
    };
    const checkInput = {
      draftText: "Everyone agrees.",
      brief,
      responseLocale: "ja" as const,
    };
    const interviewInput = {
      messages: [{ author: "writer" as const, text: "An essay" }],
      mode: "refine" as const,
      currentBrief: brief,
      startingMaterial: "Opening.",
      responseLocale: "en" as const,
    };
    expect(await client.listEditors(signal)).toEqual(responses[0]);
    expect(
      await client.conveneRoom(
        {
          ...roomInput,
          personaIds: [...roomInput.personaIds],
          folioId: undefined,
        },
        signal,
      ),
    ).toEqual(responses[1]);
    expect(
      await client.askEditor({ ...askInput, draftText: undefined }, signal),
    ).toEqual(responses[2]);
    expect(await client.suggestRewrite(rewriteInput, signal)).toEqual(
      responses[3],
    );
    expect(await client.gradeDraft(gradeInput, signal)).toEqual(responses[4]);
    expect(await client.checkDossier(checkInput, signal)).toEqual(responses[5]);
    expect(await client.interviewTurn(interviewInput, signal)).toEqual(
      responses[6],
    );
    expect(requests).toEqual([
      { operation: "editors.list" },
      { operation: "room.convene", ...roomInput },
      { operation: "editor.ask", ...askInput },
      { operation: "rewrite.suggest", ...rewriteInput },
      { operation: "rubric.grade", ...gradeInput },
      { operation: "dossier.check", ...checkInput },
      { operation: "interview.turn", ...interviewInput },
    ]);
  });

  test("omits undefined fields before calling request and preserves explicit null", async () => {
    const client = new TwyneClient({
      apiUrl: "https://twyne.example",
      accessToken: "test",
    });
    const requests: unknown[] = [];
    client.request = async <T>(request: unknown) => {
      requests.push(request);
      return { notes: [] } as T;
    };
    await client.conveneRoom({
      draftText: "Draft",
      folioId: undefined,
      brief: null,
      responseLocale: undefined,
    });
    expect(requests).toEqual([
      { operation: "room.convene", draftText: "Draft", brief: null },
    ]);
    expect(Object.keys(requests[0] as object).sort()).toEqual([
      "brief",
      "draftText",
      "operation",
    ]);
  });
  test("posts authenticated operations to the integration endpoint", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = new TwyneClient({
      apiUrl: "https://twyne.example/",
      accessToken: "twyne_pat_secret",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Response.json({
          ok: true,
          data: [{ id: "folio-1", name: "Draft" }],
        });
      }) as typeof fetch,
    });

    expect(await client.listFolios()).toEqual([
      { id: "folio-1", name: "Draft" },
    ]);
    expect(requests[0]?.url).toBe("https://twyne.example/api/integrations/v1");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer twyne_pat_secret",
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      operation: "folios.list",
    });
  });

  test("surfaces API errors with operation and status", async () => {
    const client = new TwyneClient({
      apiUrl: "https://twyne.example/api/integrations/v1",
      accessToken: "twyne_pat_secret",
      fetch: (async () =>
        Response.json(
          { ok: false, error: "Token revoked" },
          { status: 401 },
        )) as typeof fetch,
    });
    try {
      await client.getFeedback("folio-1");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TwyneApiError);
      expect(error).toMatchObject({
        status: 401,
        operation: "feedback.get",
        message: "Token revoked",
      });
    }
  });
});
