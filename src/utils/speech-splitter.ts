/**
 * Sentence splitter for reading text aloud.
 *
 * A faithful port of the splitter the reference Supertonic WebGPU space uses,
 * because sentence boundaries drive TTS chunking: oversplitting breaks prosody
 * ("Dr. Smith", "$9.99", middle initials) and undersplitting blows the model's
 * context window. The heuristics below exist so the voice reads the way a
 * reader would, not the way a regex would.
 */

function isSentenceTerminator(c: string): boolean {
  return ".!?…。？！".includes(c) || c === "\n";
}

function isTrailingChar(c: string): boolean {
  return "\"')]}」』".includes(c);
}

function getTokenFromBuffer(buffer: string, start: number): string {
  let end = start;
  while (end < buffer.length && !/\s/.test(buffer[end])) {
    ++end;
  }
  return buffer.substring(start, end);
}

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "sr",
  "jr",
  "sgt",
  "col",
  "gen",
  "rep",
  "sen",
  "gov",
  "lt",
  "maj",
  "capt",
  "st",
  "mt",
  "etc",
  "co",
  "inc",
  "ltd",
  "dept",
  "vs",
  "p",
  "pg",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "sun",
  "mon",
  "tue",
  "tues",
  "wed",
  "th",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
]);

function isAbbreviation(token: string): boolean {
  token = token.replace(/['’]s$/i, "").replace(/\.+$/, "");
  return ABBREVIATIONS.has(token.toLowerCase());
}

const MATCHING = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
  ["》", "《"],
  ["〉", "〈"],
  ["›", "‹"],
  ["»", "«"],
  ["」", "「"],
  ["』", "『"],
  ["〕", "〔"],
  ["】", "【"],
]);
const OPENING = new Set(MATCHING.values());

function updateStack(
  c: string,
  stack: string[],
  i: number,
  buffer: string,
): void {
  if (c === '"' || c === "'") {
    // An apostrophe between letters is a contraction, not an opening quote.
    if (
      c === "'" &&
      i > 0 &&
      i < buffer.length - 1 &&
      /[A-Za-z]/.test(buffer[i - 1]) &&
      /[A-Za-z]/.test(buffer[i + 1])
    ) {
      return;
    }
    // A possessive apostrophe at the end of a word ("wives'") is not a quote.
    if (
      c === "'" &&
      i > 0 &&
      /[A-Za-z]/.test(buffer[i - 1]) &&
      stack.at(-1) !== "'"
    ) {
      return;
    }
    const stackIndex = stack.lastIndexOf(c);
    if (stackIndex !== -1) {
      stack.splice(stackIndex);
    } else {
      stack.push(c);
    }
    return;
  }
  if (OPENING.has(c)) {
    stack.push(c);
    return;
  }
  const expectedOpening = MATCHING.get(c);
  if (expectedOpening && stack.length && stack.at(-1) === expectedOpening) {
    stack.pop();
  }
}

/**
 * Split text into standalone sentences. Reuses the space's exact algorithm:
 * a single pass with a nesting stack, abbreviation and URL protection, and a
 * lookahead that keeps decimals and initials with their sentence.
 */
export function split(text: string): string[] {
  const sentences: string[] = [];
  const bufferLen = text.length;
  let sentenceStart = 0;
  let i = 0;
  const stack: string[] = [];

  const scanBoundary = (idx: number) => {
    let end = idx;
    while (
      end + 1 < bufferLen &&
      isSentenceTerminator(text[end + 1]) &&
      text[end + 1] !== "\n"
    ) {
      ++end;
    }
    while (end + 1 < bufferLen && isTrailingChar(text[end + 1])) {
      ++end;
    }
    let nextNonSpace = end + 1;
    while (nextNonSpace < bufferLen && /\s/.test(text[nextNonSpace])) {
      ++nextNonSpace;
    }
    return { end, nextNonSpace };
  };

  while (i < bufferLen) {
    const c = text[i];
    updateStack(c, stack, i, text);

    if (stack.length === 0 && isSentenceTerminator(c)) {
      const currentSegment = text.slice(sentenceStart, i);
      // Don't split in the middle of a numbered list ("1.").
      if (/(^|\n)\d+$/.test(currentSegment)) {
        ++i;
        continue;
      }

      const { end: boundaryEnd, nextNonSpace } = scanBoundary(i);

      // No whitespace follows the terminator: mid-token, e.g. "$9.99".
      if (i === nextNonSpace - 1 && c !== "\n") {
        ++i;
        continue;
      }

      // Nothing after yet — wait for more text before committing.
      if (nextNonSpace === bufferLen) {
        break;
      }

      let tokenStart = i - 1;
      while (tokenStart >= 0 && /\S/.test(text[tokenStart])) {
        tokenStart--;
      }
      tokenStart = Math.max(sentenceStart, tokenStart + 1);
      const token = getTokenFromBuffer(text, tokenStart);
      if (!token) {
        ++i;
        continue;
      }

      // URLs and emails keep their punctuation.
      if (
        (/https?[,:]\/\//.test(token) || token.includes("@")) &&
        token.at(-1) &&
        !isSentenceTerminator(token.at(-1)!)
      ) {
        i = tokenStart + token.length;
        continue;
      }

      if (isAbbreviation(token)) {
        ++i;
        continue;
      }

      // Middle initials followed by a capitalised word are part of a name.
      if (
        /^([A-Za-z]\.)+$/.test(token) &&
        nextNonSpace < bufferLen &&
        /[A-Z]/.test(text[nextNonSpace])
      ) {
        ++i;
        continue;
      }

      // A period followed by lowercase joins, not ends ("e.g. that").
      if (c === "." && nextNonSpace < bufferLen && /[a-z]/.test(text[nextNonSpace])) {
        ++i;
        continue;
      }

      const sentence = text.substring(sentenceStart, boundaryEnd + 1).trim();
      if (sentence === "..." || sentence === "…") {
        ++i;
        continue;
      }

      if (sentence) {
        sentences.push(sentence);
      }
      i = sentenceStart = boundaryEnd + 1;
      continue;
    }
    ++i;
  }

  const remainder = text.substring(sentenceStart).trim();
  if (remainder) {
    sentences.push(remainder);
  }
  return sentences;
}