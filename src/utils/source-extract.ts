import type { ConvexClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { AiSettings, CanvasNode, SourceCanvas } from "../types";
import type { BibEntry } from "./bibliography";
import { runClientSourceExtract } from "./ai-client";
import { createOpenUiStream } from "../components/canvas/openui/stream";
import { createParser } from "@openuidev/lang-core";
import { canvasSchema } from "../components/canvas/openui/library";
import { layoutCanvas, reserveSlot } from "./canvas-layout";
import { readFileAsJson, writeFileAsJson } from "./lix";

const MAX_EXTRACT_PER_PASS = 2;
const cachePath = (sourceId: string) => `/source-text/${sourceId}.json`;

export interface ExtractionProgress {
  sourceId: string;
  phase: "fetching" | "composing" | "complete" | "error";
  message?: string;
}

async function sourceText(entry: BibEntry, client: ConvexClient): Promise<string> {
  const cached = await readFileAsJson<{ markdown?: string }>(cachePath(entry.id));
  if (cached?.markdown) return cached.markdown;
  const fetched = await client.action(api.research.fetchSource, { url: entry.url }) as { markdown?: string; provider?: string };
  if (!fetched.markdown?.trim()) throw new Error("The source provider returned no readable text.");
  await writeFileAsJson(cachePath(entry.id), { markdown: fetched.markdown, provider: fetched.provider, fetchedAt: Date.now() });
  return fetched.markdown;
}

function titleFromProgram(program: string): string {
  const root = createParser(canvasSchema(), "Cards").parse(program).root;
  const cards = root?.props.cards;
  const card = Array.isArray(cards) ? cards[0] as { props?: Record<string, unknown> } | undefined : undefined;
  return typeof card?.props?.title === "string" ? card.props.title : "Extracted section";
}

function withPrograms(canvas: SourceCanvas, entry: BibEntry, programs: string[], streaming: boolean): SourceCanvas {
  const sourceNodeId = `src:${entry.id}`;
  const kept = canvas.nodes.filter((node) => !(node.kind === "excerpt" && node.sourceId === entry.id));
  const excerpts: CanvasNode[] = programs.map((program, order) => ({
    id: `excerpt:${entry.id}:${order}`,
    folioId: canvas.folioId,
    kind: "excerpt",
    sourceId: entry.id,
    parentId: sourceNodeId,
    title: titleFromProgram(program),
    ouiLang: program,
    order,
    x: 0, y: 0,
    ...reserveSlot({ kind: "excerpt" }),
    streaming,
    createdAt: Date.now() + order,
  }));
  const nodes = layoutCanvas([...kept, ...excerpts], canvas.clusters);
  return { ...canvas, nodes };
}

export async function extractSourceIntoCanvas(args: {
  entry: BibEntry;
  canvas: SourceCanvas;
  client: ConvexClient;
  settings: AiSettings;
  onCanvas: (canvas: SourceCanvas) => void;
  onProgress?: (progress: ExtractionProgress) => void;
}): Promise<SourceCanvas> {
  const { entry, client, settings, onCanvas, onProgress } = args;
  try {
    onProgress?.({ sourceId: entry.id, phase: "fetching" });
    const markdown = await sourceText(entry, client);
    onProgress?.({ sourceId: entry.id, phase: "composing" });
    const stream = createOpenUiStream();
    let working = args.canvas;
    const output = await runClientSourceExtract(
      { title: entry.title, author: entry.author, url: entry.url, markdown },
      settings,
      (snapshot) => {
        const parsed = stream.set(snapshot.text);
        if (!parsed.completedPrograms.length) return;
        working = withPrograms(working, entry, parsed.completedPrograms, true);
        onCanvas(working);
      },
    );
    if (!output) throw new Error("Source extraction needs a configured text model.");
    const final = createOpenUiStream().set(output);
    if (!final.completedPrograms.length) throw new Error("The model did not return any complete source cards.");
    working = withPrograms(working, entry, final.completedPrograms, false);
    onCanvas(working);
    onProgress?.({ sourceId: entry.id, phase: "complete" });
    return working;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source extraction failed.";
    onProgress?.({ sourceId: entry.id, phase: "error", message });
    throw error;
  }
}

export async function extractPendingSources(args: {
  entries: BibEntry[];
  canvas: SourceCanvas;
  client: ConvexClient;
  settings: AiSettings;
  onCanvas: (canvas: SourceCanvas) => void;
  onProgress?: (progress: ExtractionProgress) => void;
}): Promise<SourceCanvas> {
  const extracted = new Set(args.canvas.nodes.filter((node) => node.kind === "excerpt").map((node) => node.sourceId));
  const pending = args.entries.filter((entry) => !extracted.has(entry.id)).slice(0, MAX_EXTRACT_PER_PASS);
  let canvas = args.canvas;
  for (const entry of pending) {
    canvas = await extractSourceIntoCanvas({ ...args, entry, canvas });
  }
  return canvas;
}

