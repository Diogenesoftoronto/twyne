export interface TypstCompileRequest {
  source: string;
  assets: { path: string; bytes: Uint8Array }[];
}

export type TypstCompileResponse =
  | { type: "progress"; message: string }
  | { type: "pdf"; bytes: Uint8Array }
  | { type: "error"; message: string };
