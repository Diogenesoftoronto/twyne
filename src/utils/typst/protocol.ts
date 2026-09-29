export interface TypstCompileRequest {
  source: string;
  assets: { path: string; bytes: Uint8Array }[];
}

export type TypstCompileResponse =
  | { type: "progress"; message: string }
  | {
      type: "pdf";
      bytes: Uint8Array;
      svg?: string;
      pageSizes?: { width: number; height: number }[];
    }
  | { type: "error"; message: string };
