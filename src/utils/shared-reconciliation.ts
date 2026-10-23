import { reconcileTypstSource } from "./typst/document";

export interface SharedDraftCopy {
  html: string;
  typstSource?: string;
}

export interface SharedRecovery {
  lixId: string;
  folioId: string;
  createdAt: number;
  local: SharedDraftCopy;
  shared: SharedDraftCopy;
  result?: SharedDraftCopy;
}

export interface SharedPassage {
  local: string;
  shared: string;
  changed: boolean;
}

export function sameSharedDraft(
  a: SharedDraftCopy,
  b: SharedDraftCopy,
): boolean {
  return a.html === b.html && a.typstSource === b.typstSource;
}

/** Compare whole rich-text blocks. The selected HTML is never rebuilt from text. */
export function compareSharedPassages(
  local: string,
  shared: string,
): SharedPassage[] {
  const blocks = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.body.childNodes).map((node) => {
      const wrapper = doc.createElement("div");
      wrapper.append(node.cloneNode(true));
      return wrapper.innerHTML;
    });
  };
  const a = blocks(local);
  const b = blocks(shared);
  // Bound memory for book-length manuscripts. A large unresolved region stays
  // one choice rather than guessing how unrelated passages should align.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  let endA = a.length;
  let endB = b.length;
  while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const result: SharedPassage[] = a
    .slice(0, prefix)
    .map((html) => ({ local: html, shared: html, changed: false }));
  const aa = a.slice(prefix, endA);
  const bb = b.slice(prefix, endB);
  if (aa.length * bb.length > 250_000) {
    result.push({ local: aa.join(""), shared: bb.join(""), changed: true });
  } else {
    const width = bb.length + 1;
    const table = new Uint32Array((aa.length + 1) * width);
    for (let i = aa.length - 1; i >= 0; i--) {
      for (let j = bb.length - 1; j >= 0; j--) {
        table[i * width + j] =
          aa[i] === bb[j]
            ? 1 + table[(i + 1) * width + j + 1]
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    let left = "";
    let right = "";
    const flush = () => {
      if (left || right)
        result.push({ local: left, shared: right, changed: true });
      left = "";
      right = "";
    };
    while (i < aa.length || j < bb.length) {
      if (i < aa.length && j < bb.length && aa[i] === bb[j]) {
        flush();
        result.push({ local: aa[i], shared: bb[j], changed: false });
        i++;
        j++;
      } else if (
        i < aa.length &&
        (j === bb.length ||
          table[(i + 1) * width + j] >= table[i * width + j + 1])
      ) {
        left += aa[i++];
      } else {
        right += bb[j++];
      }
    }
    flush();
  }
  result.push(
    ...a
      .slice(endA)
      .map((html) => ({ local: html, shared: html, changed: false })),
  );
  return result;
}

export function resolveSharedPassages(
  passages: SharedPassage[],
  choices: Array<"local" | "shared">,
  source: SharedDraftCopy,
): SharedDraftCopy {
  const html = passages
    .map((part, index) => part[choices[index] ?? "local"])
    .join("");
  return {
    html,
    ...(source.typstSource !== undefined
      ? {
          typstSource:
            html === source.html
              ? source.typstSource
              : reconcileTypstSource(source.typstSource, html),
        }
      : {}),
  };
}
