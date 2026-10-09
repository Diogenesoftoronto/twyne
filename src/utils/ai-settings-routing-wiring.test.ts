import { describe, expect, test } from "bun:test";
import ts from "typescript";

/** Qwik handlers resume long after their component's hydration snapshot. */
async function actionSource(path: string, action: string): Promise<string> {
  const text = await Bun.file(path).text();
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let source: string | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === action
    ) {
      source = node.initializer?.getText(file);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!source) throw new Error(`Missing action ${action} in ${path}`);
  return source;
}

const roomPath = "src/components/personas/personas-panel.tsx";
const apparatusPath = "src/routes/apparatus/index.tsx";
const citationsPath = "src/components/citations/citations-panel.tsx";

function expectFreshRouting(source: string): void {
  const loadAt = source.indexOf("await loadAiSettingsFromIdb()");
  const gateAt = source.indexOf("hasConfiguredAiProvider(");
  const clientAt = source.indexOf("await runClient");
  expect(loadAt).toBeGreaterThan(-1);
  expect(gateAt).toBeGreaterThan(loadAt);
  expect(clientAt).toBeGreaterThan(gateAt);
  expect(source).not.toMatch(/const settings\d? = store\.aiSettings/);
  expect(source).toMatch(/store\.aiSettings = settings\d?;/);
}

describe("fresh AI settings at action boundaries", () => {
  for (const action of [
    "requestFeedback",
    "expandAnalysis",
    "submitReply",
    "proposeFix",
  ]) {
    test(`Room ${action} rereads persisted BYOK before choosing a route`, async () => {
      const source = await actionSource(roomPath, action);
      expectFreshRouting(source);
      expect(source).toMatch(
        /const settings\d? = normalizeAiSettings\(\s*await loadAiSettingsFromIdb\(\),?\s*\);/,
      );
    });
  }

  test("rubric rereads settings for both room and specialist judges", async () => {
    const source = await actionSource(
      "src/components/rubric/rubric-panel.tsx",
      "runAnalysis",
    );
    expectFreshRouting(source);
    expect(source.match(/await loadAiSettingsFromIdb\(\)/g)).toHaveLength(2);
    expect(source).toContain("store.aiSettings = settings2;");
  });

  for (const action of ["autoFormatIfEnabled", "addToBibliography"]) {
    test(`citations ${action} does not reuse hydrated provider settings`, async () => {
      expectFreshRouting(await actionSource(citationsPath, action));
    });
  }

  for (const action of [
    "addToBibliography",
    "summarizeSourceAi",
    "detectMissingSourcesAi",
  ]) {
    test(`apparatus ${action} does not reuse a captured BYOK gate`, async () => {
      const source = await actionSource(apparatusPath, action);
      expectFreshRouting(source);
      expect(source).not.toMatch(/if \(!?(?:hasAi|canFlagMissingSources)\b/);
      expect(source).not.toMatch(/,\s*store\.aiSettings\s*,?\s*\)/);
    });
  }

  test("startup citation formatting refreshes after awaited setup and between requests", async () => {
    const source = await Bun.file(apparatusPath).text();
    expect(source).toMatch(
      /for \(const citation of store\.citations\) \{\s*const settings = await loadAiSettingsFromIdb\(\);\s*store\.aiSettings = settings;\s*if \(!settings \|\| !hasConfiguredAiProvider\(settings\)\) break;/,
    );
  });
});
