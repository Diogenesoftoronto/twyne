/** Pinned model revisions and byte counts verified against Hugging Face's API. */
export type LocalWritingPack = "embeddings" | "words" | "speech";
const manifest = (
  repo: string,
  revision: string,
  files: Array<[string, number]>,
) =>
  files.map(([file, size]) => ({
    url: `https://huggingface.co/${repo}/resolve/${revision}/${file}`,
    size,
  }));
const embeddingRepo = "Xenova/all-MiniLM-L6-v2",
  embeddingRevision = "751bff37182d3f1213fa05d7196b954e230abad9";
const wordRepo = "Xenova/distilbert-base-uncased",
  wordRevision = "5d73105e39e322b779ff7a8fcd11530fa579165b";
const speechRepo = "onnx-community/whisper-tiny.en",
  speechRevision = "2575352d61be1bf7225cf8f8b268a4678025fc58";
export const LOCAL_WRITING_PACKS = {
  embeddings: {
    label: "Passage connections",
    repo: embeddingRepo,
    revision: embeddingRevision,
    description:
      "Compare nearby passages for similarity and gaps. Similarity is an observation, not proof that two sentences mean the same thing.",
    files: manifest(embeddingRepo, embeddingRevision, [
      ["config.json", 650],
      ["onnx/model_quantized.onnx", 22972370],
      ["special_tokens_map.json", 125],
      ["tokenizer.json", 711661],
      ["tokenizer_config.json", 366],
    ]),
  },
  words: {
    label: "Words in context",
    repo: wordRepo,
    revision: wordRevision,
    description:
      "Predict alternatives for one word in an English sentence. Read every choice in context; probable words can still be wrong.",
    files: manifest(wordRepo, wordRevision, [
      ["config.json", 529],
      ["onnx/model_quantized.onnx", 67710626],
      ["special_tokens_map.json", 125],
      ["tokenizer.json", 711396],
      ["tokenizer_config.json", 320],
    ]),
  },
  speech: {
    label: "Say it",
    repo: speechRepo,
    revision: speechRevision,
    description:
      "Transcribe an English recording on this device, then revise it as your own candidate wording.",
    files: manifest(speechRepo, speechRevision, [
      ["config.json", 2197],
      ["generation_config.json", 1646],
      ["preprocessor_config.json", 339],
      ["special_tokens_map.json", 2173],
      ["tokenizer.json", 2405679],
      ["tokenizer_config.json", 282662],
      ["onnx/encoder_model_quantized.onnx", 10124993],
      ["onnx/decoder_model_merged_quantized.onnx", 30718858],
    ]),
  },
} as const;
export const localPackId = (pack: LocalWritingPack) => `writing-${pack}-v1`;
/** Transformers.js 4 preflights config at `main` even when pipeline revision is
 * pinned. Resolve that probe only to the exact downloaded manifest; never fetch
 * an unpinned file or accept arbitrary repositories, paths or query strings. */
export function pinnedLocalWritingUrl(input: string): string | null {
  for (const pack of Object.values(LOCAL_WRITING_PACKS)) {
    for (const file of pack.files) {
      if (
        input === file.url ||
        input ===
          file.url.replace(`/resolve/${pack.revision}/`, "/resolve/main/")
      )
        return file.url;
    }
  }
  return null;
}
export function cosineSimilarity(left: number[], right: number[]): number {
  if (
    !left.length ||
    left.length !== right.length ||
    [...left, ...right].some((n) => !Number.isFinite(n))
  )
    throw new Error("Invalid passage vectors.");
  const dot = left.reduce((n, x, i) => n + x * right[i], 0);
  const length = Math.hypot(...left) * Math.hypot(...right);
  return length ? Math.max(-1, Math.min(1, dot / length)) : 0;
}
export function localWordInput(
  sentence: string,
  from: number,
  to: number,
): string {
  if (
    sentence.length > 2000 ||
    from < 0 ||
    to <= from ||
    to > sentence.length ||
    !/^\p{L}+$/u.test(sentence.slice(from, to)) ||
    /\p{L}/u.test(sentence[from - 1] ?? "") ||
    /\p{L}/u.test(sentence[to] ?? "") ||
    sentence.includes("[MASK]")
  )
    throw new Error(
      "Select one complete word in a sentence of at most 2,000 characters.",
    );
  return sentence.slice(0, from) + "[MASK]" + sentence.slice(to);
}
