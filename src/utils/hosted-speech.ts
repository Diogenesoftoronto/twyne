/** Not Organic's fal-backed ElevenLabs v4 narration route. */
export const HOSTED_SPEECH_MODEL = "speech-eleven-v4";

export const HOSTED_SPEECH_VOICES = [
  "Alice",
  "Matilda",
  "Daniel",
  "George",
  "Chris",
] as const;

// Preserve saved cast choices while migrating OpenAI voice names to ElevenLabs.
// The first five entries are the five resident editors, in cast order.
const legacyVoices: Readonly<Record<string, string>> = {
  onyx: "Alice",
  shimmer: "Matilda",
  echo: "Daniel",
  ash: "George",
  alloy: "Chris",
  ballad: "Daniel",
  coral: "Matilda",
  fable: "George",
  nova: "Alice",
  sage: "Matilda",
  verse: "Chris",
  marin: "Alice",
  cedar: "Daniel",
};

/** Explicit ElevenLabs names or public voice IDs pass through unchanged. */
export function resolveHostedSpeechVoice(voice?: string): string {
  const selected = voice?.trim();
  return selected ? (legacyVoices[selected] ?? selected) : "Chris";
}
