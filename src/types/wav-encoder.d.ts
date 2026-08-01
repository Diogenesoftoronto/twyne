declare module "wav-encoder" {
  interface AudioData {
    sampleRate: number;
    channelData: Float32Array[];
  }

  export function encode(data: AudioData): Promise<ArrayBuffer>;
}
