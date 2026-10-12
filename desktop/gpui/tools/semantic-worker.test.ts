import { expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";
import { observeSourceSteering } from "../fixtures/steering-offline/capture-source";

// Corpus checks launch the packaged helper repeatedly. Allow its bounded
// startup cost while native compilation or other CI jobs share the host.
setDefaultTimeout(30_000);

const helper = resolve(
  import.meta.dir,
  "../target/document",
  process.platform === "win32" ? "twyne-document.exe" : "twyne-document",
);
async function request(value: unknown, environment?: Record<string, string>) {
  const child = Bun.spawn([helper], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.env.TMPDIR ?? process.env.TEMP ?? "/tmp",
    env: environment ? { ...process.env, ...environment } : process.env,
  });
  child.stdin.write(JSON.stringify(value));
  child.stdin.end();
  const output = (await new Response(child.stdout).json()) as {
    ok: boolean;
    result: any;
    error?: string;
  };
  const status = await child.exited;
  if (!output.ok || status) throw new Error(output.error ?? "Helper failed");
  return output.result;
}

async function apparatusObservations() {
  return Bun.file(
    resolve(
      import.meta.dir,
      "../fixtures/host-apparatus/browser-observations.json",
    ),
  ).json();
}

test("packaged offline steering matches unchanged Source guards and JS normalization", async () => {
  const fixture = await Bun.file(
    resolve(
      import.meta.dir,
      "../fixtures/steering-offline/source-observations.integration.json",
    ),
  ).json();
  const observed = await observeSourceSteering();
  expect(observed).toEqual(fixture);
  const generated = await Bun.file(
    resolve(import.meta.dir, "semantic-steering.generated.ts"),
  ).text();
  expect(generated).toContain(observed.source.guards);
  expect(generated).toContain(observed.source.interface);
  expect(generated).toContain(observed.source.minimumDeclaration);
  expect(generated).toContain(observed.source.normalizeText);
  for (const row of fixture.rows) {
    expect(await request(row.request)).toEqual(row.result);
    expect(row.result.ok).toBe(false);
    expect(
      row.calls.configuredAiChecks + row.calls.research + row.calls.network,
    ).toBe(0);
  }
  const row = (name: string) =>
    fixture.rows.find((item: { name: string }) => item.name === name);
  expect(row("normalization changes raw120 to119").rawUtf16Units).toBe(120);
  expect(row("normalization changes raw120 to119").normalizedUtf16Units).toBe(
    119,
  );
  expect(row("60 astral characters are 120 units").normalizedUtf16Units).toBe(
    120,
  );
  expect(row("119 ASCII UTF16 units").calls.settingsLoads).toBe(0);
  expect(row("120 ASCII UTF16 units").calls.settingsLoads).toBe(1);
  expect(row("literal text is not HTML projection").normalizedText).toStartWith(
    "<p>",
  );
  expect(row("NEL is not ECMAScript whitespace").normalizedText).toContain(
    "\u0085",
  );
});

test("offline steering rejects invalid wire inputs and ignores provider overrides", async () => {
  const valid = {
    command: "apparatusSteerOffline",
    instructions: "Primary sources",
    folioId: "draft",
    text: "x".repeat(120),
  };
  for (const invalid of [
    { ...valid, instructions: null },
    { ...valid, instructions: 1 },
    { ...valid, instructions: [] },
    { ...valid, instructions: undefined },
    { ...valid, text: null },
    { ...valid, text: {} },
    { ...valid, text: false },
    { ...valid, text: undefined },
    { ...valid, folioId: false },
    { ...valid, folioId: {} },
    { ...valid, folioId: undefined },
  ]) {
    await expect(request(invalid)).rejects.toThrow(
      "The research steering request is invalid.",
    );
  }
  expect(
    await request({
      ...valid,
      passInFlight: true,
      aiSettings: { provider: "offline-test" },
      loadAiSettingsFromIdb: "override",
      runOnce: "override",
    }),
  ).toEqual({
    ok: false,
    message:
      "Choose an AI provider in Settings before steering a draft-wide pass.",
  });
});

test("offline steering generated adapter has no provider imports or live research entrypoint", async () => {
  const text = await Bun.file(
    resolve(import.meta.dir, "semantic-steering.generated.ts"),
  ).text();
  const ast = ts.createSourceFile(
    "semantic-steering.generated.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  expect(
    ast.statements.some(
      (node) =>
        ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node),
    ),
  ).toBe(false);
  const callees: string[] = [];
  const constructors: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) callees.push(node.expression.getText(ast));
    if (ts.isNewExpression(node))
      constructors.push(node.expression.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(callees.sort()).toEqual(
    [
      "hasConfiguredAiProvider",
      "instructions.trim",
      "lastDraftText.trim",
      "loadAiSettingsFromIdb",
      "text.replace",
      'text.replace(/\\s+/g, " ").trim',
    ].sort(),
  );
  expect(constructors).toEqual(["Error", "Error"]);
  expect(text).toContain("const passInFlight = false;");
  const loader = ast.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "loadAiSettingsFromIdb",
  );
  expect(loader?.body?.statements.length).toBe(1);
  const returned = loader?.body?.statements[0];
  expect(
    returned &&
      ts.isReturnStatement(returned) &&
      returned.expression?.kind === ts.SyntaxKind.NullKeyword,
  ).toBe(true);
  const adapter = ast.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "apparatusSteerOffline",
  );
  expect(adapter?.body?.statements.at(-1)?.kind).toBe(
    ts.SyntaxKind.ThrowStatement,
  );
});

test("packaged citation finder matches original Chrome whitespace, atom gaps and UTF16 ranges", async () => {
  const fixture = await Bun.file(
    resolve(
      import.meta.dir,
      "../fixtures/host-apparatus/browser-anchor-observations.json",
    ),
  ).json();
  for (const row of fixture.rows)
    expect(
      await request({
        command: "citationFindRange",
        quote: row.quote,
        blocks: row.blocks,
      }),
    ).toEqual(row.expected);
  expect(fixture.documentHtmlUnchanged).toBe(true);
  // This pure-function capture used a fresh blank Chrome page. The actual
  // editor command and native commit have their own independent gates.
  expect(fixture.originalEditorPresent).toBe(false);
  expect(
    fixture.rows.find((row: { name: string }) =>
      row.name.startsWith("atom gap"),
    ).expected.range,
  ).toEqual({ from: 0, to: 10 });
  expect(
    fixture.rows.find((row: { name: string }) => row.name.startsWith("emoji"))
      .expected.range,
  ).toEqual({ from: 3, to: 15 });
  await expect(
    request({
      command: "citationFindRange",
      quote: "text",
      blocks: [{ position: -2, children: [] }],
    }),
  ).rejects.toThrow("The citation passage projection is invalid.");
  await expect(
    request({ command: "citationFindRange", quote: null, blocks: [] }),
  ).rejects.toThrow("The citation passage projection is invalid.");
  await expect(
    request({
      command: "citationFindRange",
      quote: "text",
      blocks: [{ position: 0, children: [{ offset: -1, text: "text" }] }],
    }),
  ).rejects.toThrow("The citation passage projection is invalid.");
});

test("Apparatus Board and full-page scans retain their distinct original HTML projections", async () => {
  const fixture = await Bun.file(
    resolve(
      import.meta.dir,
      "../fixtures/host-apparatus/browser-scan-observations.json",
    ),
  ).json();
  for (const row of fixture.rows)
    expect(
      await request({
        command: "apparatusScanHtml",
        html: row.html,
        surface: row.surface,
      }),
    ).toEqual(row.expected);
  const joined = fixture.rows.filter((row: { name: string }) =>
    row.name.startsWith("paragraphs"),
  );
  expect(joined[0].expected.text).toBe("See https://example.com/onenext [3]");
  expect(joined[1].expected.text).toBe(
    " See https://example.com/one  next [3] ",
  );
  await expect(
    request({
      command: "apparatusScanHtml",
      html: "<p>keep</p>",
      surface: "unknown",
    }),
  ).rejects.toThrow("The manuscript citation scan is invalid.");
  await expect(
    request({ command: "apparatusScanHtml", html: null, surface: "board" }),
  ).rejects.toThrow("The manuscript citation scan is invalid.");
});

test("packaged Apparatus detection matches original Chrome UTF16 offsets and regex priority", async () => {
  const fixture = await apparatusObservations();
  for (const row of fixture.detection) {
    expect(
      await request({
        command: "apparatusDetect",
        text: row.text,
        baseOffset: row.baseOffset,
      }),
    ).toEqual(row.expected);
  }
  const unicode = fixture.detection.find(
    (row: { name: string }) => row.name === "UTF16 and base offset",
  );
  expect(unicode.expected.citations[0].from).toBe(
    11 + unicode.text.indexOf("https://"),
  );
  expect(unicode.expected.citations[0].from).toBe(19);
  expect(fixture.originalEditorHtmlUnchanged).toBe(true);
  await expect(
    request({ command: "apparatusDetect", text: null }),
  ).rejects.toThrow("The citation scan is invalid.");
  await expect(
    request({ command: "apparatusDetect", text: "[3]", baseOffset: -1 }),
  ).rejects.toThrow("The citation scan is invalid.");
});

test("packaged Apparatus citations and footnotes match all original styles and local dates", async () => {
  const fixture = await apparatusObservations();
  const locale = fixture.locale.locale.replaceAll("-", "_") + ".UTF-8";
  const environment = {
    TZ: fixture.locale.timeZone,
    LANG: locale,
    LC_ALL: locale,
  };
  for (const row of fixture.formatting) {
    const actual = await request(
      {
        command: "apparatusFormat",
        entries: [row.entry],
        style: row.style,
      },
      environment,
    );
    expect(actual).toEqual({
      rows: [row.expected],
      issues: [],
      copyText: row.expected.citation,
    });
  }
  const apa = fixture.formatting.filter(
    (row: { style: string }) => row.style === "apa",
  );
  expect(
    (
      await request(
        {
          command: "apparatusFormat",
          entries: apa.map((row: { entry: unknown }) => row.entry),
          style: "apa",
        },
        environment,
      )
    ).copyText,
  ).toBe(
    apa
      .map((row: { expected: { citation: string } }) => row.expected.citation)
      .join("\n\n"),
  );
  const provider = fixture.formatting.filter(
    (row: { name: string }) =>
      row.name === "cached provider text only matching style",
  );
  expect(
    provider.find((row: { style: string }) => row.style === "apa").expected
      .citation,
  ).toBe("Provider text\nkept exactly.");
  expect(
    provider.find((row: { style: string }) => row.style === "mla").expected
      .citation,
  ).not.toBe("Provider text\nkept exactly.");
});

test("packaged Apparatus raw source candidates match original scoped merging and undefined clearing", async () => {
  const fixture = await apparatusObservations();
  for (const row of fixture.build) {
    expect(
      await request({
        command: "apparatusBuildDetected",
        citation: row.citation,
        folioId: row.folioId,
        now: row.now,
        bibliography: row.bibliography,
      }),
    ).toEqual(row.expected);
  }
  const merged = fixture.build[0].expected;
  expect(merged.mergeTarget.index).toBe(1);
  expect(merged.entry.id).toBe("keep-original-id");
  expect(merged.entry.note).toBe("writer note");
  expect(merged.entry.citationKey).toBe("stable-key");
  expect(merged.entry.citationInsertedAt).toBe(3);
  for (const field of [
    "author",
    "publisher",
    "date",
    "year",
    "doi",
    "style",
    "formattedCitation",
  ])
    expect(merged.entry).not.toHaveProperty(field);
  expect(fixture.build[1].expected.mergeTarget).toBeNull();
  expect(fixture.build[2].expected.mergeTarget).toBeNull();
  expect(fixture.build[3].expected.mergeTarget).toBeNull();
});

test("Apparatus projection isolates malformed retained rows without treating them as a formatted source", async () => {
  const fixture = await apparatusObservations();
  const row = fixture.build[0];
  const bibliography = [
    null,
    {
      folioId: row.folioId,
      id: "broken",
      title: false,
      url: row.citation.lookupUrl,
    },
    ...row.bibliography,
  ];
  const before = JSON.stringify(bibliography);
  const built = await request({
    command: "apparatusBuildDetected",
    citation: row.citation,
    folioId: row.folioId,
    now: row.now,
    bibliography,
  });
  expect(built.entry).toEqual(row.expected.entry);
  expect(built.mergeTarget).toEqual({
    index: 3,
    expectedRawRow: row.bibliography[1],
  });
  expect(JSON.stringify(bibliography)).toBe(before);
  const formatted = await request({
    command: "apparatusFormat",
    entries: [null, bibliography[1]],
    style: "mla",
  });
  expect(formatted.rows).toEqual([]);
  expect(formatted.copyText).toBe("");
  expect(
    formatted.issues.map((issue: { index: number }) => issue.index),
  ).toEqual([0, 1]);
  await expect(
    request({ command: "apparatusFormat", entries: [], style: "unknown" }),
  ).rejects.toThrow("The bibliography formatting request is invalid.");
  await expect(
    request({
      command: "apparatusBuildDetected",
      citation: row.citation,
      folioId: "",
      now: row.now,
      bibliography: [],
    }),
  ).rejects.toThrow("The detected source candidate is invalid.");
});

test("packaged Rubric context matches original Chrome projection, digest, readiness and static measurements", async () => {
  const fixture = await Bun.file(
    resolve(
      import.meta.dir,
      "../fixtures/host-rubric/browser-draft-context.json",
    ),
  ).json();
  for (const row of fixture.rows) {
    const observed = await request({
      command: "rubricDraftContext",
      html: row.html,
    });
    expect(observed).toEqual(row.expected);
  }
  const [plain, marked] = fixture.rows.filter((row: { name: string }) =>
    row.name.endsWith("formatting"),
  );
  expect(plain.expected.fingerprint).toBe(marked.expected.fingerprint);
  expect(
    fixture.rows.find((row: { name: string }) => row.name === "499 words")
      .expected.ready,
  ).toBe(false);
  expect(
    fixture.rows.find((row: { name: string }) => row.name === "500 words")
      .expected.ready,
  ).toBe(true);
  await expect(
    request({ command: "rubricDraftContext", html: null }),
  ).rejects.toThrow("The rubric draft is invalid.");
});

test("retained Rubric explanation matches Chrome penalties and relevance caps without returning a new grade", async () => {
  const fixture = await Bun.file(
    resolve(import.meta.dir, "../fixtures/host-rubric/browser-room-parts.json"),
  ).json();
  for (const row of fixture.rows) {
    const parts = await request({
      command: "rubricRoomParts",
      judges: row.judges,
      staticScore: row.staticScore,
      brief: row.brief,
      targetFit: row.targetFit,
    });
    expect(parts).toEqual(row.expected);
    expect(parts).not.toHaveProperty("grade");
    expect(parts).not.toHaveProperty("combined");
    expect(parts).not.toHaveProperty("summary");
  }
  expect(fixture.rows[1].expected.effectiveStatic).toBeLessThan(
    fixture.rows[1].expected.staticTotal,
  );
  await expect(
    request({
      command: "rubricRoomParts",
      judges: null,
      staticScore: {},
      brief: null,
    }),
  ).rejects.toThrow("The retained scoring explanation is invalid.");
});

test("packaged helper retains original Filed date formatting and rejects malformed timestamps", async () => {
  const formatted = await request(
    { command: "localTimestamp", timestamp: 1700000000000 },
    { TZ: "America/Toronto", LANG: "en_US.UTF-8" },
  );
  expect(formatted.label).toBe("11/14/2023, 5:13:20 PM");
  for (const [timestamp, label] of [
    [-1, "12/31/1969, 6:59:59 PM"],
    [1.75, "12/31/1969, 7:00:00 PM"],
  ] as const) {
    expect(
      (
        await request(
          { command: "localTimestamp", timestamp },
          { TZ: "America/Toronto", LANG: "en_US.UTF-8" },
        )
      ).label,
    ).toBe(label);
  }
  const outsideDateRange = await request({
    command: "localTimestamp",
    timestamp: 8640000000000001,
  });
  expect(outsideDateRange.label).toBe("Invalid Date");
  await expect(
    request({ command: "localTimestamp", timestamp: null }),
  ).rejects.toThrow();
});

test("packaged helper projects authored atoms and reconciles only the changed block", async () => {
  const source =
    "// Leave my source alone\n#let custom = [Hello]\n\n= Title\n\nA #custom with $x^2$.\n\nLast paragraph";
  const projected = await request({ command: "project", source });
  expect(projected.html).toContain("data-typst-source");
  const unchanged = await request({
    command: "reconcile",
    source,
    html: projected.html,
  });
  expect(unchanged.source).toBe(source);
  const edited = await request({
    command: "reconcile",
    source,
    html: projected.html.replace("Last paragraph", "Edited paragraph"),
  });
  expect(edited.source).toContain(
    "// Leave my source alone\n#let custom = [Hello]",
  );
  expect(edited.source).toContain("A #custom with $x^2$.");
  expect(edited.html).toContain("Edited paragraph");
});

test("packaged helper retains rich table, note and Unicode metadata", async () => {
  const html =
    '<h1>Å café 🧵</h1><table data-table-caption="Data"><tbody><tr><td colspan="2" data-cell-background="#ff0000"><p>A <strong>bold</strong> cell</p></td></tr></tbody></table><p>A note<sup data-type="footnote" data-endnote-text="Keep this note"></sup></p>';
  const document = await request({ command: "fromHtml", html });
  expect(document.html).toBe(html);
  const projected = await request({
    command: "project",
    source: document.source,
  });
  expect(projected.html).toBe(html);
});

test("packaged helper produces original editorial proof setup and artwork paths", async () => {
  const { source } = await request({
    command: "fromHtml",
    html: "<h1>The notebook</h1><p>The notebook was small.</p>",
  });
  const proof = await request({
    command: "prepareProof",
    source,
    payload: {
      title: "The notebook",
      html: "<p>Stale cached opening</p>",
      references: [],
      notes: [],
      comments: [],
    },
  });
  expect(proof.source).toContain('font: ("Lora", "Libertinus Serif")');
  expect(proof.source).toContain('twyne-initial-letter = "T"');
  expect(proof.decorations.length).toBeGreaterThan(0);
  expect(proof.decorations[0].url).toContain("illuminated-initials");
  expect(proof.decorations[0].path).toContain("initial-");
});

test("malformed requests fail visibly", async () => {
  await expect(request({ command: "unknown" })).rejects.toThrow(
    "Unknown document operation",
  );
});

test("packaged helper retains Library locale name ordering and stable ties", async () => {
  const folios = [
    { folioId: "z", name: "Zebra" },
    { folioId: "accent", name: "Été" },
    { folioId: "lower", name: "alpha" },
    { folioId: "upper", name: "Alpha" },
    { folioId: "ring", name: "Ångström" },
    { folioId: "first", name: "Same name" },
    { folioId: "second", name: "Same name" },
    { folioId: "punctuation", name: "— Notes" },
  ];
  const ordered = await request({ command: "orderFolioNames", folios });
  expect(ordered.folioIds).toEqual(
    [...folios]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folio) => folio.folioId),
  );
  expect(ordered.folioIds.indexOf("first")).toBeLessThan(
    ordered.folioIds.indexOf("second"),
  );
  await expect(
    request({ command: "orderFolioNames", folios: [{ folioId: "invalid" }] }),
  ).rejects.toThrow("library names are invalid");
});

test("packaged Library cards use DOM text and the original UTF-16 preview length", async () => {
  const card = await request({
    command: "libraryCardText",
    html: '<h1>A</h1><p>B&amp;C<br>D <img src="data:image/png;base64,AAAA" alt="Not prose"> E&nbsp; F</p>',
  });
  expect(card).toEqual({ words: 3, preview: "AB&CD E F" });
  expect(
    await request({ command: "libraryCardText", html: "<p> </p>" }),
  ).toEqual({
    words: 0,
    preview: "",
  });
  const splitSurrogate = await request({
    command: "libraryCardText",
    html: `<p>${"x".repeat(219)}🧵 trailing prose</p>`,
  });
  expect(splitSurrogate.words).toBe(3);
  expect(splitSurrogate.preview).toBe(`${"x".repeat(219)}\ufffd`);
  await expect(
    request({ command: "libraryCardText", html: null }),
  ).rejects.toThrow("library preview is invalid");
});

test("starter uses Twyne's real Particulars and retains imported prose", async () => {
  const answers = {
    workingTitle: "The notebook",
    format: "essay",
    audience: "a careful reader",
    goal: "make a room visible",
    tone: "precise",
    constraints: "500 words",
    successSignal: "a clear opening",
  };
  const starter = await request({ command: "starter", answers });
  expect(starter.html).toContain("The notebook");
  expect(starter.html).toContain("a careful reader");
  const imported = await request({
    command: "starter",
    answers,
    material: "An existing opening.\n\nA second paragraph.",
    filename: "old.txt",
  });
  expect(imported.html).toContain("An existing opening.");
  expect(imported.html).toContain("A second paragraph.");
  expect(imported.html).not.toContain("Start writing");
});

test("Markdown conversion preserves GFM tables and hard line breaks", async () => {
  const converted = await request({
    command: "fromMarkdown",
    markdown:
      "# A heading\n\nA line\nAnother line\n\n| A | B |\n|---|---|\n| one | two |",
  });
  expect(converted.html).toContain("<h1>A heading</h1>");
  expect(converted.html).toContain("<br");
  expect(converted.html).toContain("<table");
});

test("LaTeX renders with Twyne's actual export engine and fails on bad syntax", async () => {
  const result = await request({
    command: "renderInline",
    kind: "latex",
    source: "\\frac{a}{b} + x^2",
    block: false,
  });
  expect(result.svg).toStartWith("<svg");
  expect(result.svg).toContain("<path");
  expect(result.svg).not.toContain("currentColor");
  await expect(
    request({
      command: "renderInline",
      kind: "latex",
      source: "\\frac{",
      block: true,
    }),
  ).rejects.toThrow("equation");
});

test("native proof preparation resolves actual Twyne LaTeX atoms into self-contained SVG", async () => {
  const { source } = await request({
    command: "fromHtml",
    html: '<p>A formula <span data-type="math-inline" data-latex="x^2"></span>.</p>',
  });
  const prepared = await request({
    command: "prepareProof",
    source: source + '\n#twyne-math("\\\\frac{a}{b}", block: true)',
    payload: {
      title: "Math",
      html: "",
      references: [],
      notes: [],
      comments: [],
    },
  });
  expect(prepared.source).toContain('format: "svg"');
  expect(prepared.source).not.toContain("#twyne-math(");
});
