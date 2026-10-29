import type { TwyneClient } from "../../../packages/twyne-tools/src/client";
import type { Connection, McpDriver } from "../drivers";
import type { ClairicAsk, Judge, JevAsk } from "../judges";
import type { Score } from "../scoring";

export interface EditorNote {
  personaId: string;
  personaName?: string;
  text: string;
  type?: string;
  provider?: string;
  anchor?: string;
  anchors?: string[];
  traceId?: string;
}

export interface ProjectBrief {
  answers: Record<string, string>;
  attachments: unknown[];
  completedAt: number;
  updatedAt: number;
}

export interface RunContext {
  /** MCP connection for this case's writer. */
  mcp: McpDriver;
  /** The same writer, for the CLI driver. */
  connection: Connection;
  /**
   * The same writer through `@twyne/tools`' client, for integration
   * operations that are CLI-only (the MCP surface is capped at 15 tools).
   */
  client: TwyneClient;
}

export interface ScoreContext {
  judge: Judge | null;
  /** Jev through the app's System One path, when `--jev` is on. */
  jev: JevAsk | null;
  /** Clairic through the app's extraction path, when `--jev` is on. */
  extract: ClairicAsk | null;
}

export interface CaseRun {
  /** The structured result the app returned. */
  raw: unknown;
  /** A readable rendering, uploaded to Arize as the run output. */
  output: string;
}

export interface ScoredCase<C> {
  case: C;
  raw: unknown;
  scores: Record<string, Score>;
}

export interface Suite<C extends { case_id: string }> {
  name: string;
  /** The surface the suite exercises, for the report. */
  surface: string;
  /** Metric semantics and declared gold manifest identity, persisted with results. */
  evaluatorVersions?: Record<string, string>;
  load(): C[];
  run(ctx: RunContext, testCase: C): Promise<CaseRun>;
  score(
    ctx: ScoreContext,
    testCase: C,
    raw: unknown,
  ): Promise<Record<string, Score>>;
  /** Scores that need more than one case, such as strong/weak ordering. */
  scoreAll?(results: Array<ScoredCase<C>>): void;
  /** The dataset row uploaded to Arize. Flat values only. */
  example(testCase: C): Record<string, string | number | boolean>;
}
