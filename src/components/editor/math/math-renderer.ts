export type MathDisplayMode = "inline" | "block";

export interface MathRenderResult {
  html: string;
  error: string | null;
}

interface KatexPeer {
  renderToString: (
    source: string,
    options: {
      displayMode: boolean;
      output: "htmlAndMathml";
      strict: "error";
      throwOnError: true;
      trust: false;
    },
  ) => string;
}

let katexPeerPromise: Promise<KatexPeer> | null = null;

function asMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.replace(/^KaTeX parse error:\s*/i, "");
  }
  return "The LaTeX source could not be rendered.";
}

/**
 * KaTeX stays a peer of this isolated editor slice. The coordinator can add it
 * as a direct dependency without making the extension's source import fail
 * eagerly in environments that have not installed the peer yet.
 */
export function loadKatexPeer(): Promise<KatexPeer> {
  katexPeerPromise ??= import("katex")
    .then((module) => {
      const peer = ("default" in module ? module.default : module) as KatexPeer;
      if (typeof peer.renderToString !== "function") {
        throw new Error(
          "The installed KaTeX package has no renderToString API.",
        );
      }
      return peer;
    })
    .catch((error) => {
      katexPeerPromise = null;
      throw error;
    });

  return katexPeerPromise;
}

export async function renderLatex(
  source: string,
  display: MathDisplayMode,
): Promise<MathRenderResult> {
  const latex = source.trim();
  if (!latex) {
    return {
      html: "",
      error: "Enter LaTeX to render this equation.",
    };
  }

  try {
    const katex = await loadKatexPeer();
    return {
      html: katex.renderToString(latex, {
        displayMode: display === "block",
        output: "htmlAndMathml",
        strict: "error",
        throwOnError: true,
        trust: false,
      }),
      error: null,
    };
  } catch (error) {
    const missingPeer =
      error instanceof Error &&
      (error.message.includes("Cannot find package") ||
        error.message.includes("Failed to resolve module specifier") ||
        error.message.includes('Could not resolve "katex"'));
    return {
      html: "",
      error: missingPeer
        ? "KaTeX is not installed. Add katex as a direct dependency to render equations."
        : asMessage(error),
    };
  }
}
