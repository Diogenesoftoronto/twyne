declare module "mammoth/mammoth.browser" {
  export interface ConversionResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }

  export function convertToHtml(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<ConversionResult>;
}
