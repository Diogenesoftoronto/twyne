/**
 * The House — how Twyne names and stacks the context around a piece.
 *
 *   House        the writer: default dossier fields and the house charter
 *   Collection   a series of folios sharing a dossier layer and a charter
 *   Folio        one piece, with its own dossier (a `ProjectBrief`)
 *   Charter      standards that follow the writer from piece to piece
 *   Edition      a filed version of a dossier (see `brief-history.ts`)
 *   Amendment    a dossier change the draft itself proposed, once filed
 *   Ledger       every context change: what, when, from where, and why
 *
 * The context stack is the merge of those layers for one folio, each field
 * stamped with the layer it came from. Model consumers receive this context
 * alongside their own task-specific instructions and manuscript excerpts.
 *
 * Pure: storage lives in `house-store.ts`, sync in `house-sync.ts`.
 */
import type {
  DossierAttachment,
  ProjectBrief,
  ProjectInterviewAnswers,
} from "../types";

export type DossierField = keyof ProjectInterviewAnswers;

export const DOSSIER_FIELDS: readonly DossierField[] = [
  "workingTitle",
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
];

export const DOSSIER_FIELD_LABELS: Record<DossierField, string> = {
  workingTitle: "Working title",
  format: "Form",
  audience: "Reader",
  goal: "Aim",
  tone: "Tone",
  constraints: "Constraints",
  successSignal: "Success looks like",
};

/** Fields a House or Collection may sensibly set for every piece under it. */
export const INHERITABLE_FIELDS: readonly DossierField[] = [
  "format",
  "audience",
  "goal",
  "tone",
  "constraints",
  "successSignal",
];

export type ContextLayer = "house" | "collection" | "folio" | "amendment";

export const LAYER_LABELS: Record<ContextLayer, string> = {
  house: "The House",
  collection: "Collection",
  folio: "Folio dossier",
  amendment: "Amendment",
};

export interface House {
  /** What the house is called on its letterhead; defaults to the writer. */
  name: string;
  dossier: Partial<ProjectInterviewAnswers>;
  updatedAt: number;
}

export interface Collection {
  id: string;
  name: string;
  /** One line on what binds the series together. */
  description: string;
  folioIds: string[];
  dossier: Partial<ProjectInterviewAnswers>;
  createdAt: number;
  updatedAt: number;
}

export type CharterScope = "house" | "collection" | "folio";
export type CharterSeverity = "must" | "prefer";
export type CharterKind = "length" | "citation" | "style" | "voice" | "other";

export interface CharterItem {
  id: string;
  scope: CharterScope;
  /** "house", a collection id, or a folio id, matching `scope`. */
  ownerRef: string;
  text: string;
  severity: CharterSeverity;
  kind: CharterKind;
  order: number;
  updatedAt: number;
  /** Exact existing uses kept deliberately; never a blanket future exception. */
  occurrenceException?: {
    version: 1;
    findingId: string;
    signatures: { key: string; count: number }[];
  };
}

export type LedgerSource =
  | "interview"
  | "refine"
  | "amendment"
  | "house"
  | "collection"
  | "charter"
  | "manual"
  | "sync";

export const LEDGER_SOURCE_LABELS: Record<LedgerSource, string> = {
  interview: "Filed at the interview",
  refine: "Refined by hand",
  amendment: "Amended from the draft",
  house: "Set at the House",
  collection: "Set for the collection",
  charter: "Charter changed",
  manual: "Edited",
  sync: "Arrived from another device",
};

export interface LedgerEntry {
  id: string;
  at: number;
  layer: ContextLayer | "charter";
  /** "house", a collection id, or a folio id. */
  ownerRef: string;
  field?: string;
  from?: string;
  to?: string;
  source: LedgerSource;
  reason?: string;
}

export interface HouseState {
  house: House;
  collections: Collection[];
  charter: CharterItem[];
  /** Newest first. */
  ledger: LedgerEntry[];
}

export function emptyHouseState(now = 0): HouseState {
  return {
    house: { name: "", dossier: {}, updatedAt: now },
    collections: [],
    charter: [],
    ledger: [],
  };
}

/* ── The stack ─────────────────────────────────────────────────── */

export interface StackField {
  field: DossierField;
  value: string;
  /** Where `value` came from; null when no layer set it. */
  layer: ContextLayer | null;
  /** Lower layers this one overrides, nearest first. */
  shadowed: Array<{ layer: ContextLayer; value: string }>;
}

export interface StackCharterItem extends CharterItem {
  /** True when it comes from the House or the Collection, not this folio. */
  inherited: boolean;
}

export interface ContextStack {
  folioId: string;
  house: House;
  collection: Collection | null;
  fields: Record<DossierField, StackField>;
  charter: StackCharterItem[];
  attachments: DossierAttachment[];
  /** Filed amendments for this folio, newest first. */
  amendments: LedgerEntry[];
}

export function collectionForFolio(
  state: HouseState,
  folioId: string | null | undefined,
): Collection | null {
  if (!folioId) return null;
  return state.collections.find((c) => c.folioIds.includes(folioId)) ?? null;
}

const clean = (value: string | undefined) => (value ?? "").trim();

/**
 * Merge House → Collection → Folio. The nearest layer that says something
 * wins; the ones it overrides stay visible as `shadowed`, so the inspector
 * can show a collection's tone being overruled by one piece.
 */
export function assembleContextStack(
  state: HouseState,
  folioId: string,
  brief: ProjectBrief | null,
  /**
   * The interview's stand-in answers. A folio value equal to its stand-in was
   * never chosen by the writer, so it yields to the collection and the House
   * and is only used when neither says anything.
   */
  standIns: Partial<Record<DossierField, string>> = {},
): ContextStack {
  const collection = collectionForFolio(state, folioId);
  const amendments = state.ledger.filter(
    (entry) => entry.source === "amendment" && entry.ownerRef === folioId,
  );
  const latestChanges = new Map<string, LedgerEntry>();
  for (const entry of [...state.ledger].sort((a, b) => b.at - a.at)) {
    if (
      entry.ownerRef === folioId &&
      entry.field &&
      !latestChanges.has(entry.field)
    )
      latestChanges.set(entry.field, entry);
  }

  const fields = {} as Record<DossierField, StackField>;
  for (const field of DOSSIER_FIELDS) {
    const candidates: Array<{ layer: ContextLayer; value: string }> = [];
    const folioValue = clean(brief?.answers[field]);
    const standIn = folioValue !== "" && folioValue === clean(standIns[field]);
    if (folioValue && !standIn)
      candidates.push({
        layer:
          latestChanges.get(field)?.source === "amendment" &&
          clean(latestChanges.get(field)?.to) === folioValue
            ? "amendment"
            : "folio",
        value: folioValue,
      });
    if (INHERITABLE_FIELDS.includes(field)) {
      const collectionValue = clean(collection?.dossier[field]);
      if (collectionValue)
        candidates.push({ layer: "collection", value: collectionValue });
      const houseValue = clean(state.house.dossier[field]);
      if (houseValue) candidates.push({ layer: "house", value: houseValue });
    }
    if (standIn && candidates.length === 0)
      candidates.push({ layer: "folio", value: folioValue });
    const [top, ...rest] = candidates;
    fields[field] = {
      field,
      value: top?.value ?? "",
      layer: top?.layer ?? null,
      shadowed: rest,
    };
  }

  const owners = new Set([
    "house",
    folioId,
    ...(collection ? [collection.id] : []),
  ]);
  const charter = state.charter
    .filter((item) => owners.has(item.ownerRef))
    .map((item) => ({ ...item, inherited: item.ownerRef !== folioId }))
    .sort(
      (a, b) =>
        scopeRank(a.scope) - scopeRank(b.scope) ||
        severityRank(a.severity) - severityRank(b.severity) ||
        a.order - b.order,
    );

  return {
    folioId,
    house: state.house,
    collection,
    fields,
    charter,
    attachments: brief?.attachments ?? [],
    amendments,
  };
}

function scopeRank(scope: CharterScope): number {
  return scope === "house" ? 0 : scope === "collection" ? 1 : 2;
}

function severityRank(severity: CharterSeverity): number {
  return severity === "must" ? 0 : 1;
}

/**
 * The merged view as a `ProjectBrief`, for read-only consumers that already
 * take one. The house and collection charters join the constraints so every
 * existing prompt builder carries them without changing shape.
 */
export function effectiveBrief(
  stack: ContextStack,
  brief: ProjectBrief | null,
): ProjectBrief {
  const answers = Object.fromEntries(
    DOSSIER_FIELDS.map((field) => [field, stack.fields[field].value]),
  ) as unknown as ProjectInterviewAnswers;
  const standards = stack.charter.map(
    (item) => `${item.severity === "must" ? "Must" : "Prefer"}: ${item.text}`,
  );
  if (standards.length) {
    answers.constraints = [answers.constraints, ...standards]
      .filter(Boolean)
      .join("\n");
  }
  const now = Date.now();
  return {
    answers,
    attachments: stack.attachments,
    ...(brief?.probes?.length ? { probes: brief.probes } : {}),
    completedAt: brief?.completedAt ?? now,
    updatedAt: brief?.updatedAt ?? now,
  };
}

/** A rough, provider-neutral token estimate: four characters a token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface ModelContext {
  text: string;
  layers: Array<{
    layer: ContextLayer | "charter";
    chars: number;
    tokens: number;
  }>;
}

/** Inspectable context summary; prompt wrappers add task-specific context. */
export function contextForModels(stack: ContextStack): ModelContext {
  const byLayer = new Map<ContextLayer | "charter", number>();
  const lines: string[] = [];
  for (const field of DOSSIER_FIELDS) {
    const entry = stack.fields[field];
    if (!entry.value || !entry.layer) continue;
    const line = `${DOSSIER_FIELD_LABELS[field]}: ${entry.value}`;
    lines.push(line);
    byLayer.set(entry.layer, (byLayer.get(entry.layer) ?? 0) + line.length);
  }
  if (stack.charter.length) {
    lines.push("Charter:");
    for (const item of stack.charter) {
      const line = `- ${item.severity === "must" ? "Must" : "Prefer"}: ${item.text}`;
      lines.push(line);
      byLayer.set("charter", (byLayer.get("charter") ?? 0) + line.length);
    }
  }
  const text = lines.join("\n");
  return {
    text,
    layers: [...byLayer].map(([layer, chars]) => ({
      layer,
      chars,
      tokens: Math.ceil(chars / 4),
    })),
  };
}

/** Ledger entries worth one row each: what changed about a folio's context. */
export function ledgerForFolio(
  state: HouseState,
  folioId: string,
): LedgerEntry[] {
  const collection = collectionForFolio(state, folioId);
  const owners = new Set([
    "house",
    folioId,
    ...(collection ? [collection.id] : []),
  ]);
  return state.ledger.filter((entry) => owners.has(entry.ownerRef));
}
