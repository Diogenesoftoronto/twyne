/**
 * The source canvas — spatial state for a folio's research.
 *
 * Persisted beneath `/folios/<folioId>/source-canvas.json` inside the Lix blob.
 * The folio id in the payload is a validation aid; the path is the ownership
 * boundary. Keeping one global path used to mean that saving folio B destroyed
 * folio A's board even though both payloads claimed the correct owner.
 *
 * **The canvas is a projection, never the store of record.** `BibEntry[]` stays
 * authoritative for sources and `ProjectBrief` for the brief; a node holds only
 * layout, the model's annotation, and the composed card interior, and points at
 * its owner by id. That is what makes `seedCanvasFromFolio` safe to run on every
 * mount: it reconciles against the owners and never invents content.
 */

import { readFileAsJson, writeFileAsJson } from "./lix";
import { reserveSlot } from "./canvas-layout";
import type { BibEntry } from "./bibliography";
import type {
  CanvasEdge,
  CanvasNode,
  DossierAttachment,
  SourceCanvas,
} from "../types";

const LEGACY_CANVAS_PATH = "/source-canvas.json";

export function sourceCanvasPath(folioId: string): string {
  return `/folios/${encodeURIComponent(folioId)}/source-canvas.json`;
}

export const DEFAULT_INSPECTOR_WIDTH = 380;
const MIN_INSPECTOR_WIDTH = 260;
const MAX_INSPECTOR_WIDTH = 760;

export function emptyCanvas(folioId: string): SourceCanvas {
  return {
    version: 1,
    folioId,
    nodes: [],
    edges: [],
    clusters: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    expanded: false,
  };
}

/**
 * Read the board. Returns an empty canvas rather than null when nothing has
 * been written yet, so callers never branch on first use.
 *
 * Anything on disk is normalised on the way out: a blob written by an older
 * build, or one a sync merge left half-formed, should degrade to a usable board
 * rather than throwing inside a render.
 */
export async function loadSourceCanvas(folioId: string): Promise<SourceCanvas> {
  const path = sourceCanvasPath(folioId);
  let raw = await readFileAsJson<Partial<SourceCanvas>>(path);

  // Old builds wrote one global canvas. Its embedded owner makes migration
  // unambiguous: only that folio may claim it. A different folio must see a
  // clean board, never whichever board happened to be saved most recently.
  if (!raw) {
    const legacy = await readFileAsJson<Partial<SourceCanvas>>(
      LEGACY_CANVAS_PATH,
    );
    if (legacy?.folioId === folioId) {
      raw = legacy;
      await writeFileAsJson(path, legacy);
      await writeFileAsJson(LEGACY_CANVAS_PATH, null);
    }
  }
  if (!raw || raw.folioId !== folioId) return emptyCanvas(folioId);
  return {
    version: 1,
    folioId,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw.edges) ? raw.edges : [],
    clusters: Array.isArray(raw.clusters) ? raw.clusters : [],
    viewport: {
      x: Number(raw.viewport?.x) || 0,
      y: Number(raw.viewport?.y) || 0,
      // A zero or NaN zoom would blank the board and leave no way to recover.
      zoom: clampZoom(Number(raw.viewport?.zoom) || 1),
    },
    inspectorWidth: clampInspector(
      Number(raw.inspectorWidth) || DEFAULT_INSPECTOR_WIDTH,
    ),
    expanded: raw.expanded === true,
    lastMappedAt: raw.lastMappedAt,
  };
}

export function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, 0.15), 2);
}

export function clampInspector(width: number): number {
  return Math.min(Math.max(width, MIN_INSPECTOR_WIDTH), MAX_INSPECTOR_WIDTH);
}

/**
 * Write the board.
 *
 * Streaming nodes are stripped first. A card that is mid-compose has only a
 * partial AST; persisting it would mean a reload during extraction could strand
 * a half-parsed card on disk with nothing left running to finish it. Dropping
 * them costs nothing — the extraction pass rebuilds any card it was working on.
 */
export async function saveSourceCanvas(canvas: SourceCanvas): Promise<void> {
  const nodes = canvas.nodes.filter((n) => !n.streaming);
  const live = new Set(nodes.map((n) => n.id));
  await writeFileAsJson(sourceCanvasPath(canvas.folioId), {
    ...canvas,
    nodes,
    // An edge to a dropped node would dangle; prune with the node.
    edges: canvas.edges.filter((e) => live.has(e.from) && live.has(e.to)),
  });
}

export async function upsertNode(
  canvas: SourceCanvas,
  node: CanvasNode,
): Promise<SourceCanvas> {
  const idx = canvas.nodes.findIndex((n) => n.id === node.id);
  const nodes = [...canvas.nodes];
  if (idx >= 0) nodes[idx] = node;
  else nodes.push(node);
  const next = { ...canvas, nodes };
  await saveSourceCanvas(next);
  return next;
}

/**
 * Remove a card, everything beneath it, and every edge that touched any of
 * them. Deleting a source card takes its excerpts with it — they have no
 * meaning apart from their parent.
 */
export async function deleteNode(
  canvas: SourceCanvas,
  id: string,
): Promise<SourceCanvas> {
  const doomed = new Set<string>([id]);
  for (const n of canvas.nodes) {
    if (n.parentId && doomed.has(n.parentId)) doomed.add(n.id);
  }
  const next: SourceCanvas = {
    ...canvas,
    nodes: canvas.nodes.filter((n) => !doomed.has(n.id)),
    edges: canvas.edges.filter((e) => !doomed.has(e.from) && !doomed.has(e.to)),
  };
  await saveSourceCanvas(next);
  return next;
}

export interface SeedInput {
  folioId: string;
  bibliography: BibEntry[];
  attachments?: DossierAttachment[];
  /** Answered ProjectBrief fields, as `[field, prose]`. Blank answers are skipped. */
  briefAnswers?: [string, string][];
}

/**
 * Reconcile the board against what the folio actually holds.
 *
 * Adds a card for any source, attachment, or answered brief field that lacks
 * one; drops cards whose owner is gone; leaves every surviving card's position,
 * annotation, and content untouched. Idempotent, so it is safe on every mount —
 * which is the point, since sources arrive continuously from the background
 * research watcher.
 */
export function seedCanvasFromFolio(
  canvas: SourceCanvas,
  input: SeedInput,
  now = Date.now(),
): SourceCanvas {
  const { folioId, bibliography, attachments = [], briefAnswers = [] } = input;

  const liveSourceIds = new Set(bibliography.map((b) => b.id));
  const liveAttachmentIds = new Set(attachments.map((a) => a.id));
  const liveBriefFields = new Set(
    briefAnswers.filter(([, prose]) => prose.trim().length > 0).map(([field]) => field),
  );

  // Drop orphans first, so a re-added source gets a fresh card rather than
  // inheriting a stale one.
  const kept = canvas.nodes.filter((n) => {
    switch (n.kind) {
      case "source":
      case "excerpt":
        return !!n.sourceId && liveSourceIds.has(n.sourceId);
      case "attachment":
        return !!n.attachmentId && liveAttachmentIds.has(n.attachmentId);
      case "brief":
        return !!n.briefField && liveBriefFields.has(n.briefField);
      case "note":
        return true; // the writer's own card, owned by nobody
    }
  });

  const haveSource = new Set(
    kept.filter((n) => n.kind === "source").map((n) => n.sourceId),
  );
  const haveAttachment = new Set(kept.map((n) => n.attachmentId).filter(Boolean));
  const haveBrief = new Set(kept.map((n) => n.briefField).filter(Boolean));

  const added: CanvasNode[] = [];

  for (const [field, prose] of briefAnswers) {
    if (!prose.trim() || haveBrief.has(field)) continue;
    added.push({
      ...blank(`brief:${field}`, folioId, "brief", now),
      briefField: field,
      title: field,
    });
  }

  for (const att of attachments) {
    if (haveAttachment.has(att.id)) continue;
    added.push({
      ...blank(`att:${att.id}`, folioId, "attachment", now),
      attachmentId: att.id,
      title: att.title || att.url || "Attachment",
    });
  }

  for (const entry of bibliography) {
    if (haveSource.has(entry.id)) continue;
    added.push({
      ...blank(`src:${entry.id}`, folioId, "source", now),
      sourceId: entry.id,
      title: entry.title || entry.url || "Untitled source",
    });
  }

  if (!added.length && kept.length === canvas.nodes.length) return canvas;
  return { ...canvas, nodes: [...kept, ...added] };
}

function blank(
  id: string,
  folioId: string,
  kind: CanvasNode["kind"],
  now: number,
): CanvasNode {
  const { w, h } = reserveSlot({ kind });
  return { id, folioId, kind, x: 0, y: 0, w, h, title: "", createdAt: now };
}

/**
 * Fold a mapping pass into the board.
 *
 * Writer intent wins on every axis: a pinned card keeps its position, and an
 * edge the writer drew is never replaced by a model edge. Only model-authored
 * edges are cleared, so re-running the pass cannot quietly erase the writer's
 * own reading of how two sources relate.
 */
export function applyMapping(
  canvas: SourceCanvas,
  mapping: {
    annotations?: Record<string, CanvasNode["annotation"]>;
    /** Node id → cluster id. */
    clusterOf?: Record<string, string>;
    clusters?: SourceCanvas["clusters"];
    edges?: CanvasEdge[];
  },
  now = Date.now(),
): SourceCanvas {
  const known = new Set(canvas.nodes.map((n) => n.id));
  const writerEdges = canvas.edges.filter((e) => e.origin === "writer");
  // Drop edges to cards that no longer exist, and self-edges — both are things
  // a model will occasionally emit and neither can be drawn.
  const modelEdges = (mapping.edges ?? []).filter(
    (e) => known.has(e.from) && known.has(e.to) && e.from !== e.to,
  );

  return {
    ...canvas,
    nodes: canvas.nodes.map((n) => {
      const annotation = mapping.annotations?.[n.id] ?? n.annotation;
      // Pinning is a claim about *position*, not about which theme a card
      // belongs to, so a pinned card is still re-clustered. Layout leaves it
      // where the writer put it either way.
      const cluster = mapping.clusterOf?.[n.id] ?? n.cluster;
      if (annotation === n.annotation && cluster === n.cluster) return n;
      return { ...n, annotation, cluster };
    }),
    clusters: mapping.clusters?.length ? mapping.clusters : canvas.clusters,
    edges: [...writerEdges, ...modelEdges],
    lastMappedAt: now,
  };
}
