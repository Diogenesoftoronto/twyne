/**
 * Browser-only grammar checking through Harper's WebAssembly worker.
 *
 * Both imports stay behind the async boundary so SSR never instantiates a
 * Worker and the 16 MB dictionary is fetched only when the writer opens the
 * grammar desk for the first time.
 */

export interface GrammarIssue {
  id: string;
  start: number;
  end: number;
  problem: string;
  message: string;
  kind: string;
  suggestions: string[];
}

type HarperLinter = import("harper.js").Linter;

let linterPromise: Promise<HarperLinter> | null = null;

async function getLinter(): Promise<HarperLinter> {
  if (!linterPromise) {
    linterPromise = import("harper.js").then(async (harper) => {
      // Harper's packaged `binary` URL points beside its pre-bundled module,
      // which Vite does not copy in development. Resolve the WASM as a Vite
      // asset, then give both the main thread and worker the stable URL.
      const wasmUrl = new URL(
        "../../node_modules/harper.js/dist/harper_wasm_bg.wasm",
        import.meta.url,
      ).href;
      const binary = harper.createBinaryModuleFromUrl(wasmUrl, "full");
      const linter = new harper.WorkerLinter({ binary });
      await linter.setup();
      return linter;
    });
  }
  try {
    return await linterPromise;
  } catch (error) {
    linterPromise = null;
    throw error;
  }
}

export function isEnglishLanguage(
  language: string | null | undefined,
): boolean {
  return /^en(?:[-_]|$)/i.test(language?.trim() ?? "");
}

/** Run Harper locally only for English text and return serializable UI data. */
export async function checkGrammar(
  text: string,
  language: string,
): Promise<GrammarIssue[]> {
  if (!isEnglishLanguage(language) || !text.trim()) return [];
  const linter = await getLinter();
  const lints = await linter.lint(text, {
    language: "plaintext",
    isolateEnglish: true,
    dedup: true,
  });
  return lints.map((lint, index) => {
    const span = lint.span();
    const suggestions = lint
      .suggestions()
      .map((suggestion) => suggestion.get_replacement_text());
    return {
      id: `${span.start}:${span.end}:${lint.lint_kind()}:${index}`,
      start: span.start,
      end: span.end,
      problem: lint.get_problem_text(),
      message: lint.message(),
      kind: lint.lint_kind_pretty(),
      suggestions: Array.from(new Set(suggestions)),
    };
  });
}

/** Harper spans count Unicode scalar values; JavaScript strings count UTF-16. */
export function scalarOffsetToCodeUnit(text: string, offset: number): number {
  if (offset <= 0) return 0;
  let scalars = 0;
  let units = 0;
  for (const character of text) {
    if (scalars >= offset) break;
    units += character.length;
    scalars += 1;
  }
  return units;
}
