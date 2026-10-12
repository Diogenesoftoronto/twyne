/** Local document semantics shared with the web editor. No hosted UI or server. */
// @ts-expect-error jsdom is intentionally untyped in the source project.
import { JSDOM } from "jsdom";
import {
  htmlToTypst,
  typstToHtml,
  reconcileTypstSource,
} from "../../../src/utils/typst/document";
import { applyTypstPageSetup } from "../../../src/utils/typst/client";
import { typstDecorations } from "../../../src/utils/typst/decorative-assets";
import type { ExportPayload } from "../../../src/utils/exchange";
import {
  buildStarterDocument,
  buildImportedMaterialDocument,
  htmlToPlainText,
} from "./semantic-starter.generated";
import { rubricDraftFingerprint } from "./semantic-rubric.generated";
import { detectCitations } from "../../../src/utils/citations";
import { findTextRange } from "./semantic-citation-anchor.generated";
import { apparatusSteerOffline } from "./semantic-steering.generated";
import {
  buildBibEntryFromFormattedCitation,
  findBibliographyEntryByUrl,
  formatCitation,
  footnoteCite,
  normalizeUrl,
} from "./semantic-apparatus.generated";
import type { BibEntry, CitationStyle } from "../../../src/utils/bibliography";
import {
  draftReadiness,
  MIN_RUBRIC_WORDS,
} from "../../../src/utils/draft-thresholds";
import {
  scoreStaticFeatures,
  combineJudgesAndStatic,
  UNJUDGED_TARGET_FIT,
  type JudgeResult,
  type StaticScore,
} from "../../../src/utils/rubric";
import type {
  DetectedCitation,
  ProjectInterviewAnswers,
} from "../../../src/types";
import { marked } from "marked";
import { prepareTypstAssets } from "../../../src/utils/typst/render-assets";
import { typstString } from "../../../src/utils/typst/string";

const dom = new JSDOM("", { url: "https://twyne.invalid/" });
Object.defineProperty(globalThis, "DOMParser", { value: dom.window.DOMParser });
const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

type Request =
  | { command: "renderInline"; kind: "latex"; source: string; block: boolean }
  | { command: "fromMarkdown"; markdown: string }
  | {
      command: "starter";
      answers: ProjectInterviewAnswers;
      material?: string;
      filename?: string;
    }
  | { command: "project"; source: string }
  | { command: "fromHtml"; html: string }
  | { command: "reconcile"; source: string; html: string }
  | { command: "orderFolioNames"; folios: { folioId: string; name: string }[] }
  | { command: "libraryCardText"; html: string }
  | { command: "localTimestamp"; timestamp: number }
  | { command: "rubricDraftContext"; html: string }
  | { command: "apparatusDetect"; text: string; baseOffset?: number }
  | {
      command: "apparatusSteerOffline";
      instructions: string;
      folioId: string | null;
      text: string;
    }
  | { command: "apparatusScanHtml"; html: string; surface: "board" | "page" }
  | { command: "apparatusFormat"; entries: unknown[]; style: CitationStyle }
  | {
      command: "citationFindRange";
      quote: string;
      blocks: {
        position: number;
        children: { offset: number; text: string }[];
      }[];
    }
  | {
      command: "apparatusBuildDetected";
      citation: DetectedCitation;
      folioId: string;
      now: number;
      bibliography: unknown[];
    }
  | {
      command: "rubricRoomParts";
      judges: JudgeResult[];
      staticScore: StaticScore;
      brief: { answers: { audience: string; goal: string } } | null;
      targetFit?: number | null;
    }
  | { command: "prepareProof"; source: string; payload: ExportPayload };

export async function execute(request: Request) {
  switch (request.command) {
    case "apparatusSteerOffline": {
      if (
        typeof request.instructions !== "string" ||
        typeof request.text !== "string" ||
        (request.folioId !== null && typeof request.folioId !== "string")
      )
        throw new Error("The research steering request is invalid.");
      return apparatusSteerOffline(
        request.instructions,
        request.folioId,
        request.text,
      );
    }
    case "renderInline": {
      if (request.kind !== "latex")
        throw new Error("This inline renderer is unavailable.");
      if (typeof request.source !== "string" || request.source.length > 100_000)
        throw new Error("The equation source is too large.");
      const prepared = await prepareTypstAssets(
        `#twyne-math(${typstString(request.source)}, block: ${request.block === true})`,
      );
      const image = /image\(bytes\(\(([\d,]+)\)\), format: "svg"/.exec(
        prepared,
      );
      if (!image) throw new Error("The equation renderer returned no image.");
      return {
        svg: new TextDecoder().decode(
          Uint8Array.from(image[1].split(",").filter(Boolean).map(Number)),
        ),
      };
    }
    case "fromMarkdown": {
      const html = marked.parse(request.markdown, {
        async: false,
        breaks: true,
        gfm: true,
      }) as string;
      const source = htmlToTypst(html);
      return { source, html: typstToHtml(source) };
    }
    case "starter": {
      const html = request.material?.trim()
        ? buildImportedMaterialDocument(
            request.answers,
            request.material,
            request.filename,
          )
        : buildStarterDocument(request.answers);
      const source = htmlToTypst(html);
      return { source, html: typstToHtml(source) };
    }
    case "project":
      return { html: typstToHtml(request.source) };
    case "fromHtml": {
      const source = htmlToTypst(request.html);
      return { source, html: typstToHtml(source) };
    }
    case "reconcile": {
      const source = reconcileTypstSource(request.source, request.html);
      return { source, html: typstToHtml(source) };
    }
    case "libraryCardText": {
      if (typeof request.html !== "string")
        throw new Error("The library preview is invalid.");
      // The Library reads DOM textContent, so headings/paragraphs have no
      // invented separators and image alt/source data do not become prose.
      const element = dom.window.document.createElement("div");
      element.innerHTML = request.html;
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        words: text ? text.split(/\s+/).length : 0,
        // A split UTF-16 surrogate is painted as a replacement glyph by the
        // browser; send that glyph rather than an invalid Rust string.
        preview: text.slice(0, 220).toWellFormed(),
      };
    }
    case "orderFolioNames": {
      if (
        !Array.isArray(request.folios) ||
        request.folios.some(
          (folio) =>
            typeof folio?.folioId !== "string" ||
            typeof folio.name !== "string",
        )
      )
        throw new Error("The library names are invalid.");
      // Match Library's stable localeCompare ordering with the helper's
      // platform Intl implementation, including accents and punctuation.
      return {
        folioIds: [...request.folios]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((folio) => folio.folioId),
      };
    }
    case "localTimestamp": {
      if (
        typeof request.timestamp !== "number" ||
        !Number.isFinite(request.timestamp)
      )
        throw new Error("The filed date is invalid.");
      // The Full Analysis uses the platform's default locale and time zone.
      return { label: new Date(request.timestamp).toLocaleString() };
    }
    case "rubricDraftContext": {
      if (typeof request.html !== "string")
        throw new Error("The rubric draft is invalid.");
      const plain = htmlToPlainText(request.html);
      const readiness = draftReadiness(plain, MIN_RUBRIC_WORDS);
      return {
        fingerprint: await rubricDraftFingerprint(plain),
        wordCount: readiness.wordCount,
        minWords: MIN_RUBRIC_WORDS,
        ready: readiness.ok,
        staticScore: scoreStaticFeatures(plain),
      };
    }
    case "apparatusDetect": {
      if (
        typeof request.text !== "string" ||
        (request.baseOffset !== undefined &&
          (!Number.isSafeInteger(request.baseOffset) || request.baseOffset < 0))
      )
        throw new Error("The citation scan is invalid.");
      // Original regex ordering and offsets are JavaScript UTF-16 units.
      // These are detected strings, never verified or enriched sources.
      return {
        citations: detectCitations(request.text, request.baseOffset ?? 0),
      };
    }
    case "apparatusScanHtml": {
      if (
        typeof request.html !== "string" ||
        !["board", "page"].includes(request.surface)
      )
        throw new Error("The manuscript citation scan is invalid.");
      let text: string;
      if (request.surface === "board") {
        // citations-panel's explicit re-scan reads the editor's textContent.
        const element = dom.window.document.createElement("div");
        element.innerHTML = request.html;
        text = element.textContent || "";
      } else {
        // The full Apparatus route scans accepted HTML with this exact Source
        // expression. Entities and paragraph separators intentionally differ.
        text = request.html.replace(/<[^>]+>/g, " ");
      }
      return { text, citations: detectCitations(text) };
    }
    case "citationFindRange": {
      if (
        typeof request.quote !== "string" ||
        !Array.isArray(request.blocks) ||
        request.blocks.some(
          (block) =>
            !Number.isSafeInteger(block?.position) ||
            block.position < -1 ||
            !Array.isArray(block.children) ||
            block.children.some(
              (child) =>
                !Number.isSafeInteger(child?.offset) ||
                child.offset < 0 ||
                typeof child.text !== "string",
            ),
        )
      )
        throw new Error("The citation passage projection is invalid.");
      // Adapt positional text runs to the original editor's traversal API.
      // The host supplies native UTF-16 positions; omitted atom/hard-break
      // payloads retain their gaps through each text run's actual offset.
      const document = {
        descendants(visit: (node: unknown, position: number) => unknown) {
          for (const block of request.blocks) {
            visit(
              {
                isTextblock: true,
                forEach(
                  childVisit: (node: unknown, offset: number) => unknown,
                ) {
                  for (const child of block.children)
                    childVisit(
                      { isText: true, text: child.text },
                      child.offset,
                    );
                },
              },
              block.position,
            );
          }
        },
      };
      return { range: findTextRange(document, request.quote) };
    }
    case "apparatusFormat": {
      if (
        !Array.isArray(request.entries) ||
        !["mla", "apa", "chicago"].includes(request.style)
      )
        throw new Error("The bibliography formatting request is invalid.");
      const rows: {
        index: number;
        id: string;
        folioId: string;
        citation: string;
        footnote: string;
        normalizedUrl: string;
      }[] = [];
      const issues: { index: number; error: string }[] = [];
      for (const [index, raw] of request.entries.entries()) {
        try {
          if (!isBibliographyEntry(raw))
            throw new Error("This retained source cannot be formatted.");
          rows.push({
            index,
            id: raw.id,
            folioId: raw.folioId,
            citation: formatCitation(raw, request.style),
            footnote: footnoteCite(raw, request.style),
            normalizedUrl: normalizeUrl(raw.url),
          });
        } catch (error) {
          issues.push({
            index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return {
        rows,
        issues,
        copyText: rows.map((row) => row.citation).join("\n\n"),
      };
    }
    case "apparatusBuildDetected": {
      if (
        !Array.isArray(request.bibliography) ||
        typeof request.folioId !== "string" ||
        !request.folioId ||
        typeof request.now !== "number" ||
        !Number.isFinite(request.now) ||
        typeof request.citation?.id !== "string" ||
        typeof request.citation?.text !== "string" ||
        (request.citation.lookupUrl !== undefined &&
          typeof request.citation.lookupUrl !== "string")
      )
        throw new Error("The detected source candidate is invalid.");
      const incoming = buildBibEntryFromFormattedCitation(
        request.citation,
        { title: request.citation.text, url: request.citation.lookupUrl },
        request.folioId,
        request.now,
      );
      // Retained malformed rows remain in the native envelope. Only qualified
      // source rows participate in the original scoped URL lookup. Return an
      // exact row guard, never a mutated bibliography or manuscript.
      const qualified = request.bibliography.filter(isBibliographyEntry);
      const existing = findBibliographyEntryByUrl(
        qualified,
        incoming.url,
        request.folioId,
      );
      if (!existing) return { entry: incoming, mergeTarget: null };
      const index = request.bibliography.indexOf(existing);
      // Spread before serialization: builder properties whose value is
      // undefined clear prior formatted/provider fields exactly as Source.
      return {
        entry: { ...existing, ...incoming, id: existing.id },
        mergeTarget: { index, expectedRawRow: existing },
      };
    }
    case "rubricRoomParts": {
      if (
        !Array.isArray(request.judges) ||
        request.judges.some(
          (judge) =>
            typeof judge?.score !== "number" || !Number.isFinite(judge.score),
        ) ||
        typeof request.staticScore?.total !== "number" ||
        !Number.isFinite(request.staticScore.total) ||
        (request.targetFit != null &&
          (typeof request.targetFit !== "number" ||
            !Number.isFinite(request.targetFit)))
      )
        throw new Error("The retained scoring explanation is invalid.");
      const parts = combineJudgesAndStatic(
        request.judges,
        request.staticScore,
        request.brief,
        request.targetFit ?? UNJUDGED_TARGET_FIT,
      );
      // Explain retained readings using the original arithmetic. Return no
      // new grade, summary or result and never write editorial artifacts.
      return {
        judgeMean: parts.judgeMean,
        minJudge: parts.minJudge,
        staticTotal: parts.staticTotal,
        effectiveStatic: parts.effectiveStatic,
        rawMean:
          request.judges.reduce((sum, judge) => sum + judge.score, 0) /
          Math.max(1, request.judges.length),
      };
    }
    case "prepareProof": {
      const styled = applyTypstPageSetup(request.source, request.payload);
      return {
        source: await prepareTypstAssets(styled),
        decorations: typstDecorations(request.payload, request.source).assets,
      };
    }
    default:
      throw new Error("Unknown document operation.");
  }
}

function isBibliographyEntry(value: unknown): value is BibEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.folioId !== "string" ||
    typeof entry.title !== "string" ||
    typeof entry.url !== "string" ||
    typeof entry.accessedAt !== "number" ||
    !Number.isFinite(entry.accessedAt)
  )
    return false;
  return [
    "author",
    "publisher",
    "date",
    "year",
    "pageHint",
    "formattedCitation",
  ].every((field) => entry[field] == null || typeof entry[field] === "string");
}

if (import.meta.main) {
  try {
    const reader = Bun.stdin.stream().getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_REQUEST_BYTES)
        throw new Error("Document request is too large.");
      chunks.push(chunk.value);
    }
    const request = JSON.parse(
      new TextDecoder().decode(Buffer.concat(chunks)),
    ) as Request;
    process.stdout.write(
      JSON.stringify({ ok: true, result: await execute(request) }),
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Document conversion failed.",
      }),
    );
    process.exitCode = 1;
  } finally {
    dom.window.close();
  }
}
