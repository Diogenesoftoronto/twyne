import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brief, grade, interview, note, rewrite } from "./room-fixtures.js";
import { sources, target, targets } from "./research-fixtures.js";

const originalFetch = globalThis.fetch;
const directories: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

const credentials = {
  TWYNE_API_URL: "http://localhost:8788",
  TWYNE_ACCESS_TOKEN: "twyne_pat_test",
};

async function file(name: string, content: string) {
  const directory = await mkdtemp(join(import.meta.dir, ".cli-test-"));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, content);
  return path;
}

function fakeResponse(data: unknown) {
  const requests: unknown[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, data });
  }) as typeof fetch;
  return requests;
}

describe("research CLI commands", () => {
  test("targets --file --strategy model --json round-trips with brief and existing sources", async () => {
    const draftPath = await file(
      "draft.html",
      "<p>A &amp; B.</p><p>Everyone agrees.</p>",
    );
    const briefPath = await file("brief.json", JSON.stringify(brief));
    const requests = fakeResponse(targets);
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "research",
          "targets",
          "--file",
          draftPath,
          "--strategy",
          "model",
          "--brief",
          briefPath,
          "--max",
          "3",
          "--existing",
          "Title A",
          "--existing",
          "Title B",
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual(targets);
    expect(captured.stderr()).toBe("");
    expect(requests).toEqual([
      {
        operation: "research.targets",
        draftText: "A & B.\nEveryone agrees.",
        strategy: "model",
        brief,
        maxTargets: 3,
        existingSources: ["Title A", "Title B"],
      },
    ]);
  });

  test("targets uses stdin verbatim and renders human targets and anchors", async () => {
    const requests = fakeResponse(targets);
    const captured = captureIo(credentials);
    expect(
      await runCli(["research", "targets", "--stdin"], {
        ...captured.io,
        readStdin: async () => "  Everyone agrees.\n",
      }),
    ).toBe(0);
    expect(requests).toEqual([
      { operation: "research.targets", draftText: "  Everyone agrees.\n" },
    ]);
    expect(captured.stdout()).toBe(
      "[claim] 4 → survey consensus\n> Everyone agrees.\n",
    );
  });

  test("targets passes the folio and explicit hosted strategy", async () => {
    const requests = fakeResponse({ ...targets, strategy: "hosted" });
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "research",
          "targets",
          "--folio",
          "folio-1",
          "--strategy",
          "hosted",
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(requests).toEqual([
      { operation: "research.targets", folioId: "folio-1", strategy: "hosted" },
    ]);
  });

  test("sources from flags preserves the anchor and prints exactly the operation data", async () => {
    const requests = fakeResponse(sources);
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "research",
          "sources",
          "--kind",
          "claim",
          "--anchor",
          " Everyone agrees. ",
          "--query",
          target.query,
          "--reason",
          target.reason,
          "--max",
          "2",
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual(sources);
    expect(captured.stderr()).toBe("");
    expect(requests).toEqual([
      {
        operation: "research.sources",
        target: {
          kind: "claim",
          anchor: " Everyone agrees. ",
          query: target.query,
          reason: target.reason,
        },
        maxResults: 2,
      },
    ]);
  });

  test("sources reads a JSON ResearchTarget and prints ranked sources with optional metadata", async () => {
    const path = await file("target.json", JSON.stringify(target));
    const requests = fakeResponse(sources);
    const captured = captureIo(credentials);
    expect(
      await runCli(["research", "sources", "--target", path], captured.io),
    ).toBe(0);
    expect(requests).toEqual([
      {
        operation: "research.sources",
        target: {
          kind: target.kind,
          anchor: target.anchor,
          query: target.query,
          reason: target.reason,
        },
      },
    ]);
    expect(captured.stdout()).toBe(
      "Survey — https://example.com/survey (Research Institute · 2026-10-23)\nDiscussion — https://example.com/discussion\n",
    );
  });

  test("sources accepts flags without an optional reason", async () => {
    const requests = fakeResponse(sources);
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "research",
          "sources",
          "--kind",
          "claim",
          "--anchor",
          target.anchor,
          "--query",
          target.query,
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(requests).toEqual([
      {
        operation: "research.sources",
        target: {
          kind: target.kind,
          anchor: target.anchor,
          query: target.query,
        },
      },
    ]);
  });

  for (const missing of ["anchor", "query"]) {
    test(`sources missing --${missing} fails with exit 1 before fetching`, async () => {
      const requests = fakeResponse(sources);
      const captured = captureIo(credentials);
      expect(
        await runCli(
          [
            "research",
            "sources",
            "--kind",
            "claim",
            ...(missing === "anchor"
              ? ["--query", target.query]
              : ["--anchor", target.anchor]),
          ],
          captured.io,
        ),
      ).toBe(1);
      expect(captured.stderr()).toBe(`Error: --${missing} is required\n`);
      expect(captured.stdout()).toBe("");
      expect(requests).toEqual([]);
    });
  }

  test("invalid targets, mixed inputs, strategies, and limits fail without fetching", async () => {
    const path = await file(
      "target.json",
      JSON.stringify({ kind: "claim", anchor: "Passage" }),
    );
    const malformed = await file("broken.json", "{");
    const requests = fakeResponse({});
    for (const args of [
      ["targets"],
      ["targets", "--folio", "folio-1", "--stdin"],
      ["targets", "--folio", "folio-1", "--strategy", "unknown"],
      ...["0", "13", "1.5", "NaN"].map((max) => [
        "targets",
        "--folio",
        "folio-1",
        "--max",
        max,
      ]),
      ["sources", "--target", path],
      ["sources", "--target", malformed],
      ["sources", "--target", path, "--kind", "claim"],
      [
        "sources",
        "--kind",
        "unknown",
        "--anchor",
        "Passage",
        "--query",
        "query",
      ],
      ["sources", "--kind", "claim", "--anchor", "  ", "--query", "query"],
      ...["0", "11", "1.5"].map((max) => [
        "sources",
        "--kind",
        "claim",
        "--anchor",
        "Passage",
        "--query",
        "query",
        "--max",
        max,
      ]),
    ]) {
      const captured = captureIo(credentials);
      expect(await runCli(["research", ...args], captured.io)).toBe(1);
      expect(captured.stdout()).toBe("");
      expect(captured.stderr()).toStartWith("Error: ");
    }
    expect(requests).toEqual([]);
  });
});

describe("room CLI commands", () => {
  test("room convene --file prints exactly the API data as JSON", async () => {
    const draft = "# Essay\n\nEveryone agrees.\n";
    const draftPath = await file("draft.md", draft);
    const briefPath = await file("brief.json", JSON.stringify(brief));
    const requests = fakeResponse({ notes: [note] });
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "room",
          "convene",
          "--file",
          draftPath,
          "--editors",
          "devil,angel",
          "--brief",
          briefPath,
          "--locale",
          "fr",
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual({ notes: [note] });
    expect(captured.stderr()).toBe("");
    expect(requests).toEqual([
      {
        operation: "room.convene",
        draftText: draft,
        personaIds: ["devil", "angel"],
        brief,
        responseLocale: "fr",
      },
    ]);
  });

  test("grade --stdin preserves whitespace and prints the rubric JSON", async () => {
    const requests = fakeResponse(grade);
    const captured = captureIo(credentials);
    const criteria = [{ label: "Clarity", description: "Readable" }];
    const criteriaPath = await file("criteria.json", JSON.stringify(criteria));
    expect(
      await runCli(["grade", "--stdin", "--criteria", criteriaPath, "--json"], {
        ...captured.io,
        readStdin: async () => "  Draft\n",
      }),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual(grade);
    expect(requests).toEqual([
      { operation: "rubric.grade", draftText: "  Draft\n", criteria },
    ]);
  });

  test("editor ask maps --message to userMessage", async () => {
    const requests = fakeResponse({ note });
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "editor",
          "ask",
          "devil",
          "--folio",
          "folio-1",
          "--instruction",
          "elaborate",
          "--message",
          "Explain the objection",
          "--anchor",
          "Everyone agrees.",
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual({ note });
    expect(requests).toEqual([
      {
        operation: "editor.ask",
        personaId: "devil",
        folioId: "folio-1",
        instruction: "elaborate",
        userMessage: "Explain the objection",
        anchor: "Everyone agrees.",
      },
    ]);
  });

  for (const extension of ["html", "htm", "HTML"]) {
    test(`converts .${extension} draft files to text and decodes basic entities`, async () => {
      const path = await file(
        `draft.${extension}`,
        "<p>A &amp; B&nbsp;&lt;C&gt; &quot;yes&quot; &#39;no&#39;</p><p>Next<br>line.</p>",
      );
      const requests = fakeResponse({ notes: [] });
      const captured = captureIo(credentials);
      expect(
        await runCli(
          ["room", "convene", "--file", path, "--json"],
          captured.io,
        ),
      ).toBe(0);
      expect(requests).toEqual([
        {
          operation: "room.convene",
          draftText: "A & B <C> \"yes\" 'no'\nNext\nline.",
        },
      ]);
    });
  }

  test("leaves unknown file formats unchanged", async () => {
    const path = await file("draft.custom", " <p>Literal text</p>\n");
    const requests = fakeResponse({ notes: [] });
    const captured = captureIo(credentials);
    expect(
      await runCli(["room", "convene", "--file", path, "--json"], captured.io),
    ).toBe(0);
    expect(requests).toEqual([
      { operation: "room.convene", draftText: " <p>Literal text</p>\n" },
    ]);
  });

  test("lists editors as raw JSON", async () => {
    const data = [
      {
        id: "devil",
        name: note.personaName,
        role: "The Devil's Advocate",
        description: "Sceptic",
        focus: "Argument",
      },
    ];
    const requests = fakeResponse(data);
    const captured = captureIo(credentials);
    expect(await runCli(["editors", "list", "--json"], captured.io)).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual(data);
    expect(requests).toEqual([{ operation: "editors.list" }]);
  });

  test("rewrite preserves the original passage and defaults to sentence", async () => {
    const requests = fakeResponse(rewrite);
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "rewrite",
          "editor",
          "--folio",
          "folio-1",
          "--original",
          " Everyone agrees. ",
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual(rewrite);
    expect(requests).toEqual([
      {
        operation: "rewrite.suggest",
        folioId: "folio-1",
        personaId: "editor",
        original: " Everyone agrees. ",
        level: "sentence",
      },
    ]);
  });

  test("dossier check reads the required JSON brief", async () => {
    const path = await file("brief.json", JSON.stringify(brief));
    const data = {
      observations: [{ text: "Define the audience." }],
      provider: "mock",
    };
    const requests = fakeResponse(data);
    const captured = captureIo(credentials);
    expect(
      await runCli(
        ["dossier", "check", "--folio", "folio-1", "--brief", path, "--json"],
        captured.io,
      ),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual(data);
    expect(requests).toEqual([
      { operation: "dossier.check", folioId: "folio-1", brief },
    ]);
  });

  test("interview reads messages, current brief, and starting material", async () => {
    const messages = [{ author: "writer", text: "An essay" }];
    const messagesPath = await file("messages.json", JSON.stringify(messages));
    const briefPath = await file("brief.json", JSON.stringify(brief));
    const startingPath = await file("opening.txt", "Opening.\n");
    const requests = fakeResponse(interview);
    const captured = captureIo(credentials);
    expect(
      await runCli(
        [
          "interview",
          "turn",
          "--messages",
          messagesPath,
          "--brief",
          briefPath,
          "--starting",
          startingPath,
          "--json",
        ],
        captured.io,
      ),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual(interview);
    expect(requests).toEqual([
      {
        operation: "interview.turn",
        messages,
        currentBrief: brief,
        startingMaterial: "Opening.\n",
        mode: "first-run",
      },
    ]);
  });

  test("human summaries include notes, anchors, judge scores, and rewrite rationale", async () => {
    fakeResponse({ notes: [note] });
    const room = captureIo(credentials);
    expect(
      await runCli(["room", "convene", "--folio", "folio-1"], room.io),
    ).toBe(0);
    expect(room.stdout()).toBe(
      `[Mlle. Sceptique] (critique) What supports this claim?\n> Everyone agrees.\n> No one objects.\n`,
    );
    fakeResponse(grade);
    const rubric = captureIo(credentials);
    expect(await runCli(["grade", "--folio", "folio-1"], rubric.io)).toBe(0);
    expect(rubric.stdout()).toBe(
      "Grade: B\nJudge\tScore\tRationale\ndevil\t4\tSupported.\n",
    );
    fakeResponse(rewrite);
    const replacement = captureIo(credentials);
    expect(
      await runCli(
        [
          "rewrite",
          "editor",
          "--folio",
          "folio-1",
          "--original",
          "Everyone agrees.",
        ],
        replacement.io,
      ),
    ).toBe(0);
    expect(replacement.stdout()).toBe(
      "Some agree.\n\nRationale: Narrow the claim.\n",
    );
  });

  test("invalid draft sources and arguments fail without fetching or reading stdin", async () => {
    const requests = fakeResponse({});
    for (const args of [
      ["room", "convene"],
      ["room", "convene", "--folio", "folio-1", "--stdin"],
      ["grade", "--file", "missing.txt", "--stdin"],
      ["editor", "ask", "unknown", "--folio", "folio-1"],
      ["rewrite", "editor", "--folio", "folio-1"],
      ["dossier", "check", "--folio", "folio-1"],
      ["interview", "turn"],
    ]) {
      const captured = captureIo(credentials);
      expect(
        await runCli(args, {
          ...captured.io,
          readStdin: async () => {
            throw new Error("Must not read stdin");
          },
        }),
      ).toBe(1);
      expect(captured.stdout()).toBe("");
      expect(captured.stderr()).toStartWith("Error: ");
      expect(captured.stderr()).not.toContain("Must not read stdin");
    }
    expect(requests).toEqual([]);
  });

  test("reports malformed JSON and API failures on stderr with exit code 1", async () => {
    const path = await file("brief.json", "{");
    const requests = fakeResponse({});
    const invalid = captureIo(credentials);
    expect(
      await runCli(
        ["grade", "--folio", "folio-1", "--brief", path, "--json"],
        invalid.io,
      ),
    ).toBe(1);
    expect(invalid.stderr()).toContain("not valid JSON");
    expect(requests).toEqual([]);
    globalThis.fetch = (async () =>
      Response.json(
        { ok: false, error: "Insufficient credits" },
        { status: 402 },
      )) as typeof fetch;
    const failed = captureIo(credentials);
    expect(
      await runCli(["grade", "--folio", "folio-1", "--json"], failed.io),
    ).toBe(1);
    expect(failed.stdout()).toBe("");
    expect(failed.stderr()).toBe("Error: Insufficient credits\n");
  });
});

function captureIo(env: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      env,
      stdout: {
        write: (value: string | Uint8Array) => ((stdout += value), true),
      },
      stderr: {
        write: (value: string | Uint8Array) => ((stderr += value), true),
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

describe("Twyne CLI", () => {
  test("prints help without credentials", async () => {
    const captured = captureIo();
    expect(await runCli(["--help"], captured.io)).toBe(0);
    expect(captured.stdout()).toContain("twyne folio import");
    expect(captured.stderr()).toBe("");
  });

  test("lists folios through the shared authenticated client", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        ok: true,
        data: [{ id: "folio-1", name: "Essay", type: "draft", updatedAt: 7 }],
      });
    }) as typeof fetch;
    const captured = captureIo({
      TWYNE_API_URL: "https://twyne.example",
      TWYNE_ACCESS_TOKEN: "twyne_pat_test",
    });

    expect(await runCli(["folio", "list", "--json"], captured.io)).toBe(0);
    expect(JSON.parse(captured.stdout())).toEqual([
      { id: "folio-1", name: "Essay", type: "draft", updatedAt: 7 },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://twyne.example/api/integrations/v1");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer twyne_pat_test",
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      operation: "folios.list",
    });
  });
});
