/** Public manual illustrations use staged, non-personal application data. */
export interface ManualGuideStep {
  title: string;
  instruction: string;
  image: string;
  alt: string;
  width: number;
  height: number;
}

export interface ManualGuide {
  title: string;
  summary: string;
  /** A short, reader-facing boundary, e.g. a staged editorial reading. */
  note?: string;
  steps: ManualGuideStep[];
}

export type ManualGuides = Record<string, ManualGuide>;
