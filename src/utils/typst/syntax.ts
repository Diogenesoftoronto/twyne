/** Find explicit helper calls without interpreting comments, strings or raw text. */
export function typstCodeMatches(
  source: string,
  pattern: RegExp,
): RegExpMatchArray[] {
  const candidates = Array.from(source.matchAll(pattern));
  const matches: RegExpMatchArray[] = [];
  let next = 0;
  for (let i = 0; i < source.length && next < candidates.length; ) {
    while (next < candidates.length && candidates[next].index! < i) next++;
    if (next === candidates.length) break;
    if (source[i] === "\\") {
      i += 2;
    } else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i + 2);
      i = end < 0 ? source.length : end + 1;
    } else if (source.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (source.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
    } else if (source[i] === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i++] === '"') break;
      }
    } else if (source[i] === "`") {
      const start = i;
      while (source[i] === "`") i++;
      const delimiter = source.slice(start, i);
      const end = source.indexOf(delimiter, i);
      i = end < 0 ? source.length : end + delimiter.length;
    } else {
      if (candidates[next].index === i) matches.push(candidates[next++]);
      i++;
    }
  }
  return matches;
}
