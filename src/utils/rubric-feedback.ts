export type RubricGradeTier = "a" | "b" | "c" | "revise";

export interface RubricSoundProfile {
  toneHz: number;
  toneDuration: number;
  impactGain: number;
}

const SOUND_PROFILES: Record<string, RubricSoundProfile> = {
  "A+": { toneHz: 784, toneDuration: 0.17, impactGain: 0.03 },
  A: { toneHz: 740, toneDuration: 0.16, impactGain: 0.031 },
  "A-": { toneHz: 698, toneDuration: 0.15, impactGain: 0.032 },
  "B+": { toneHz: 622, toneDuration: 0.15, impactGain: 0.033 },
  B: { toneHz: 587, toneDuration: 0.14, impactGain: 0.034 },
  "B-": { toneHz: 554, toneDuration: 0.14, impactGain: 0.035 },
  "C+": { toneHz: 494, toneDuration: 0.13, impactGain: 0.036 },
  C: { toneHz: 466, toneDuration: 0.12, impactGain: 0.037 },
  "C-": { toneHz: 440, toneDuration: 0.12, impactGain: 0.038 },
  "D+": { toneHz: 392, toneDuration: 0.11, impactGain: 0.039 },
  D: { toneHz: 370, toneDuration: 0.11, impactGain: 0.04 },
  "D-": { toneHz: 349, toneDuration: 0.1, impactGain: 0.041 },
  F: { toneHz: 294, toneDuration: 0.1, impactGain: 0.042 },
};

const GRADE_STAMP_ASSETS: Record<string, string> = {
  "A+": "/assets/rubric-stamps/a-plus.svg",
  A: "/assets/rubric-stamps/a.svg",
  "A-": "/assets/rubric-stamps/a-minus.svg",
  "B+": "/assets/rubric-stamps/b-plus.svg",
  B: "/assets/rubric-stamps/b.svg",
  "B-": "/assets/rubric-stamps/b-minus.svg",
  "C+": "/assets/rubric-stamps/c-plus.svg",
  C: "/assets/rubric-stamps/c.svg",
  "C-": "/assets/rubric-stamps/c-minus.svg",
  "D+": "/assets/rubric-stamps/d-plus.svg",
  D: "/assets/rubric-stamps/d.svg",
  "D-": "/assets/rubric-stamps/d-minus.svg",
  F: "/assets/rubric-stamps/f.svg",
};

let rubricAudioContext: AudioContext | null = null;

export function rubricGradeTier(grade: string): RubricGradeTier {
  const letter = grade.trim().toUpperCase().charAt(0);
  if (letter === "A") return "a";
  if (letter === "B") return "b";
  if (letter === "C") return "c";
  return "revise";
}

export function rubricSoundProfile(grade: string): RubricSoundProfile {
  return SOUND_PROFILES[grade.trim().toUpperCase()] ?? SOUND_PROFILES.F;
}

/** Each possible result has its own complete, transparent ink impression. */
export function rubricGradeStampAsset(grade: string): string {
  return GRADE_STAMP_ASSETS[grade.trim().toUpperCase()] ?? GRADE_STAMP_ASSETS.F;
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext ??
    null
  );
}

/** Prime audio while the Run rubric click still owns a user gesture. */
export async function primeRubricFeedback(): Promise<boolean> {
  try {
    const AudioContextClass = audioContextConstructor();
    if (!AudioContextClass) return false;
    if (!rubricAudioContext || rubricAudioContext.state === "closed") {
      rubricAudioContext = new AudioContextClass();
    }
    if (rubricAudioContext.state === "suspended") {
      await rubricAudioContext.resume();
    }
    return rubricAudioContext.state === "running";
  } catch {
    rubricAudioContext = null;
    return false;
  }
}

function noiseBuffer(context: AudioContext, duration: number): AudioBuffer {
  const frames = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** A tiny high-frequency shuffle, used as immediate feedback for sending. */
export function playRubricPaperCue(): void {
  try {
    const context = rubricAudioContext;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer(context, 0.11);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1750, now);
    filter.Q.setValueAtTime(0.7, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.018, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now);
    source.stop(now + 0.12);
  } catch {
    // Optional feedback must never interrupt rubric analysis.
  }
}

/** A soft stamp impact plus a short pitch keyed to the resulting grade tier. */
export function playRubricGradeCue(grade: string): void {
  try {
    const context = rubricAudioContext;
    if (!context || context.state !== "running") return;

    const profile = rubricSoundProfile(grade);
    const now = context.currentTime;

    const impact = context.createBufferSource();
    const impactFilter = context.createBiquadFilter();
    const impactGain = context.createGain();
    impact.buffer = noiseBuffer(context, 0.075);
    impactFilter.type = "lowpass";
    impactFilter.frequency.setValueAtTime(620, now);
    impactGain.gain.setValueAtTime(profile.impactGain, now);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    impact
      .connect(impactFilter)
      .connect(impactGain)
      .connect(context.destination);
    impact.start(now);
    impact.stop(now + 0.08);

    const tone = context.createOscillator();
    const toneGain = context.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(profile.toneHz, now + 0.025);
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.linearRampToValueAtTime(0.018, now + 0.035);
    toneGain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + profile.toneDuration,
    );
    tone.connect(toneGain).connect(context.destination);
    tone.start(now + 0.02);
    tone.stop(now + profile.toneDuration + 0.02);
  } catch {
    // Optional feedback must never interrupt a completed grade.
  }
}
