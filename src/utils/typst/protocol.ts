export interface TypstCompileRequest {
  source: string;
  assets: { path: string; bytes: Uint8Array }[];
  /** Prefetched Typst Universe archives, keyed `name:version`. */
  packages?: [string, Uint8Array][];
}

/** A compiler error. `range` is `line:column-line:column`, zero-based, in `path`. */
export interface TypstDiagnostic {
  package: string;
  path: string;
  range: string;
  message: string;
}

export type TypstCompileResponse =
  | { type: "progress"; message: string }
  | {
      type: "pdf";
      bytes: Uint8Array;
      svg?: string;
      pageSizes?: { width: number; height: number }[];
    }
  | { type: "error"; message: string; diagnostics?: TypstDiagnostic[] };
