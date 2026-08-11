declare module "wav-encoder" {
  interface AudioData {
    sampleRate: number;
    channelData: Float32Array[];
  }

  interface EncodeOptions {
    /** 32-bit float PCM (format 0x0003) instead of 16-bit int (default). */
    floatingPoint?: boolean;
    bitDepth?: 8 | 16 | 24 | 32;
    /** Centre-clipped 16-bit PCM used by the Web Audio API. */
    symmetric?: boolean;
  }

  export function encode(data: AudioData, opts?: EncodeOptions): Promise<ArrayBuffer>;
}