/** Incremental inverse STFT for the pinned LiquidCodec export (24 kHz). */
export class LocalLiveInverseStft {
  private readonly fft = 1280;
  private readonly hop = 320;
  private readonly bins = 641;
  private readonly padding = 480;
  private readonly window = Float64Array.from(
    { length: this.fft },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.fft),
  );
  private sums: number[] = [];
  private envelopes: number[] = [];
  private rows = 0;
  private emitted = this.padding;
  private finished = false;

  /** Append complete, stable codec STFT rows; output excludes samples needing future overlap. */
  append(features: Float32Array): Float32Array {
    if (this.finished) throw new Error("Codec stream has already finished.");
    if (features.length % (this.bins * 2) !== 0)
      throw new Error("Invalid codec feature shape.");
    for (let offset = 0; offset < features.length; offset += this.bins * 2) {
      const start = this.rows++ * this.hop;
      for (let j = 0; j < this.fft; j++) {
        let value =
          Math.exp(features[offset]) * Math.cos(features[offset + this.bins]);
        value +=
          Math.exp(features[offset + 640]) *
          Math.cos(features[offset + this.bins + 640]) *
          (j % 2 ? -1 : 1);
        for (let k = 1; k < 640; k++) {
          value +=
            2 *
            Math.exp(features[offset + k]) *
            Math.cos(
              features[offset + this.bins + k] +
                (2 * Math.PI * j * k) / this.fft,
            );
        }
        const index = start + j;
        const win = this.window[j];
        this.sums[index] = (this.sums[index] ?? 0) + (value / this.fft) * win;
        this.envelopes[index] = (this.envelopes[index] ?? 0) + win * win;
      }
    }
    return this.take(Math.max(this.padding, this.rows * this.hop));
  }

  /** Emit the remaining tail after the final codec frame. */
  finish(): Float32Array {
    if (this.finished) return new Float32Array();
    this.finished = true;
    return this.take(
      this.rows ? this.rows * this.hop + this.padding : this.padding,
    );
  }

  private take(end: number): Float32Array {
    const start = this.emitted;
    this.emitted = end;
    return Float32Array.from({ length: Math.max(0, end - start) }, (_, i) => {
      const index = start + i;
      return (
        (this.sums[index] ?? 0) / Math.max(this.envelopes[index] ?? 0, 1e-10)
      );
    });
  }
}
