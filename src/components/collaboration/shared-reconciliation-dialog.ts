import styles from "./shared-reconciliation.css?inline";
import {
  compareSharedPassages,
  resolveSharedPassages,
  type SharedDraftCopy,
  type SharedRecovery,
} from "../../utils/shared-reconciliation";
import { loadSharedRecoveryFromIdb } from "../../utils/idb";

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** Display a restricted rich-text view without executing document HTML. */
function manuscript(html: string): HTMLElement {
  const root = element("div", undefined, "shared-review-manuscript");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set([
    "P",
    "DIV",
    "SPAN",
    "STRONG",
    "B",
    "EM",
    "I",
    "U",
    "S",
    "DEL",
    "INS",
    "SUP",
    "SUB",
    "BR",
    "HR",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
    "PRE",
    "CODE",
    "UL",
    "OL",
    "LI",
    "TABLE",
    "THEAD",
    "TBODY",
    "TR",
    "TH",
    "TD",
  ]);
  const omitted = new Set([
    "SCRIPT",
    "STYLE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "SVG",
    "MATH",
    "TEMPLATE",
  ]);
  const copy = (node: Node, target: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (!(node instanceof Element) || omitted.has(node.tagName)) return;
    if (node.tagName === "IMG") {
      target.appendChild(
        element(
          "span",
          `[Image: ${node.getAttribute("alt") || "no description"}]`,
        ),
      );
      return;
    }
    const next = allowed.has(node.tagName)
      ? document.createElement(node.tagName.toLowerCase())
      : element("span");
    for (const child of Array.from(node.childNodes)) copy(child, next);
    if (node.tagName === "A" && node.getAttribute("href")) {
      next.append(element("small", ` [Link: ${node.getAttribute("href")}]`));
    }
    if (
      node instanceof HTMLElement &&
      ["left", "center", "right", "justify"].includes(node.style.textAlign)
    ) {
      next.style.textAlign = node.style.textAlign;
    }
    target.appendChild(next);
  };
  for (const node of Array.from(doc.body.childNodes)) copy(node, root);
  if (!root.textContent && !root.children.length)
    root.append(element("p", "Empty passage", "shared-review-empty"));
  return root;
}

function download(copy: SharedDraftCopy, label: string, nativeSource = false) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Twyne recovery copy</title></head><body>${copy.html}</body></html>`;
  const url = URL.createObjectURL(
    new Blob([nativeSource ? (copy.typstSource ?? "") : html], {
      type: nativeSource
        ? "text/plain;charset=utf-8"
        : "text/html;charset=utf-8",
    }),
  );
  const anchor = element("a");
  anchor.href = url;
  anchor.download = `twyne-${label}-recovery.${nativeSource ? "typ" : "html"}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface SharedReviewRequest {
  local: SharedDraftCopy;
  shared: SharedDraftCopy | null;
  role: "owner" | "editor" | "commenter";
  isCurrent: () => boolean;
  changedSinceReview?: boolean;
  recoveryOnly?: boolean;
  /** Keep the manuscript inert until the reviewed snapshot has been committed. */
  settled?: Promise<void>;
}

/** A native modal keeps the manuscript stable while its choices are reviewed.
 * Review later leaves the request pending and the editor usable, with sync off.
 * No functions or manuscript content are serialized into the Qwik page. */
export function requestSharedReview(
  options: SharedReviewRequest,
): Promise<SharedDraftCopy | "retry" | null> {
  if (!options.isCurrent()) return Promise.resolve(null);
  if (!document.getElementById("shared-review-styles")) {
    const style = element("style", styles);
    style.id = "shared-review-styles";
    document.head.append(style);
  }
  return new Promise((resolve) => {
    const banner = element("aside", undefined, "shared-review-banner");
    banner.setAttribute("aria-label", "Sharing paused");
    banner.append(
      element(
        "span",
        options.shared
          ? "Sharing paused. Your choices are waiting."
          : "Sharing paused. This device’s edits are saved locally.",
      ),
    );
    const dialog = element("dialog", undefined, "shared-review-dialog");
    const titleId = `shared-review-${crypto.randomUUID()}`;
    dialog.setAttribute("aria-labelledby", titleId);
    const body = element("div", undefined, "shared-review-body");
    body.append(
      element(
        "h2",
        options.recoveryOnly ? "Recovery copies" : "Review shared changes",
      ),
    );
    body.firstElementChild!.id = titleId;
    body.append(
      element(
        "p",
        options.recoveryOnly
          ? "These are the two copies saved before your latest review. Download either copy to keep it."
          : "This device and the shared copy differ. Choose which passages to keep before sharing resumes. Both originals are saved on this device.",
        "shared-review-intro",
      ),
    );
    if (options.changedSinceReview)
      body.append(
        element(
          "p",
          "A copy changed while you were reviewing. Check the updated comparison before applying your choices.",
          "shared-review-warning",
        ),
      );
    const exports = element("div", undefined, "shared-review-actions");
    const button = (
      label: string,
      action: () => void,
      parent: HTMLElement = exports,
    ) => {
      const node = element("button", label, "btn-paper");
      node.type = "button";
      node.addEventListener("click", action);
      parent.append(node);
      return node;
    };
    button("Download this device’s copy", () =>
      download(options.local, "device"),
    );
    if (options.shared)
      button("Download shared copy", () => download(options.shared!, "shared"));
    if (options.local.typstSource !== undefined)
      button("Download this device’s native source", () =>
        download(options.local, "device", true),
      );
    if (options.shared?.typstSource !== undefined)
      button("Download shared native source", () =>
        download(options.shared!, "shared", true),
      );
    const downloads = element("details", undefined, "shared-review-downloads");
    downloads.open = options.recoveryOnly === true;
    downloads.append(
      element("summary", "Download original copies"),
      element(
        "p",
        "Keep a readable HTML copy or the exact native source. The originals also remain saved on this device.",
      ),
      exports,
    );
    body.append(downloads);
    dialog.append(body);
    document.body.append(banner, dialog);
    const finish = (result: SharedDraftCopy | "retry" | null) => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      if (dialog.open) dialog.close();
      dialog.remove();
      banner.remove();
      resolve(result);
    };
    const onOnline = () => {
      if (!options.shared && options.isCurrent()) finish("retry");
    };
    const timer = setInterval(() => {
      if (!options.isCurrent()) finish(null);
    }, 250);
    window.addEventListener("online", onOnline);
    const open = () => {
      banner.hidden = true;
      if (!dialog.open) dialog.showModal();
    };
    let applying = false;
    const later = () => {
      if (applying) return;
      dialog.close();
      banner.hidden = false;
    };
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (applying) return;
      if (options.recoveryOnly) finish(null);
      else later();
    });
    if (!options.shared) {
      // A failed fetch must never turn on the SDK's automatic pull/push loop.
      button("Check shared copy", () => finish("retry"), banner);
      button(
        "Download local copy",
        () => download(options.local, "device"),
        banner,
      );
      return;
    }
    const shared = options.shared;
    const canWrite = options.role !== "commenter" && !options.recoveryOnly;
    if (options.role === "commenter")
      body.append(
        element(
          "p",
          "You have comment access. The shared manuscript will open unchanged; your device copy stays recoverable.",
        ),
      );
    const passages = compareSharedPassages(options.local.html, shared.html);
    const choices = passages.map(() =>
      canWrite ? ("local" as const) : ("shared" as const),
    );
    let sourceChoice: "local" | "shared" = canWrite ? "local" : "shared";
    const preview = element("section", undefined, "shared-review-preview");
    preview.setAttribute("aria-label", "Preview of your choices");
    const previewHeading = element("h3", "Preview of your choices");
    const previewContent = element("div");
    const previewSource = element("details");
    previewSource.append(element("summary", "Native source in this preview"));
    const sourceText = element("pre");
    previewSource.append(sourceText);
    preview.append(
      previewHeading,
      element(
        "p",
        "This is the manuscript that will open. Passages kept from this device will be sent to collaborators when sharing resumes.",
      ),
      previewContent,
      previewSource,
    );
    const result = () =>
      resolveSharedPassages(
        passages,
        choices,
        sourceChoice === "local" ? options.local : shared,
      );
    const update = () => {
      const next = result();
      previewContent.replaceChildren(manuscript(next.html));
      previewSource.hidden = next.typstSource === undefined;
      sourceText.textContent = next.typstSource ?? "";
    };
    const radios: HTMLInputElement[][] = [];
    const chooseAll = (side: "local" | "shared") => {
      choices.fill(side);
      sourceChoice = side;
      radios.forEach((pair) =>
        pair.forEach((radio) => {
          radio.checked = radio.value === side;
        }),
      );
      update();
    };
    if (canWrite) {
      const all = element("div", undefined, "shared-review-actions");
      button("Keep this device throughout", () => chooseAll("local"), all);
      button("Use shared throughout", () => chooseAll("shared"), all);
      body.append(all);
    }
    let changeIndex = 0;
    passages.forEach((part, index) => {
      if (!part.changed) return;
      changeIndex++;
      const group = element("fieldset", undefined, "shared-review-passage");
      group.append(element("legend", `Changed passage ${changeIndex}`));
      const columns = element("div", undefined, "shared-review-columns");
      const pair: HTMLInputElement[] = [];
      for (const side of ["local", "shared"] as const) {
        const label = element("label");
        const radio = element("input");
        radio.type = "radio";
        radio.name = `shared-passage-${index}`;
        radio.value = side;
        radio.checked = choices[index] === side;
        radio.setAttribute(
          "aria-label",
          side === "local"
            ? "Keep this device’s passage"
            : "Keep shared passage",
        );
        radio.disabled = !canWrite;
        radio.addEventListener("change", () => {
          choices[index] = side;
          update();
        });
        pair.push(radio);
        const heading = element(
          "span",
          side === "local"
            ? "Keep this device’s passage"
            : "Keep shared passage",
        );
        label.append(radio, heading, manuscript(part[side]));
        columns.append(label);
      }
      radios.push(pair);
      group.append(columns);
      body.append(group);
    });
    if (options.local.typstSource !== shared.typstSource) {
      const group = element("fieldset", undefined, "shared-review-passage");
      group.append(element("legend", "Native source and formatting"));
      group.append(
        element(
          "p",
          "Choose the source to preserve. The preview updates its manuscript passages to match your choices above.",
        ),
      );
      const pair: HTMLInputElement[] = [];
      for (const side of ["local", "shared"] as const) {
        const label = element("label");
        const input = element("input");
        input.type = "radio";
        input.name = "shared-source";
        input.value = side;
        input.checked = sourceChoice === side;
        input.disabled = !canWrite;
        input.addEventListener("change", () => {
          sourceChoice = side;
          update();
        });
        pair.push(input);
        label.append(
          input,
          element(
            "span",
            side === "local"
              ? "Keep this device’s source"
              : "Keep shared source",
          ),
        );
        const details = element("details");
        details.append(
          element("summary", "View original source"),
          element(
            "pre",
            (side === "local" ? options.local : shared).typstSource ??
              "No native source",
          ),
        );
        label.append(details);
        group.append(label);
      }
      radios.push(pair);
      body.append(group);
    }
    body.append(preview);
    const footer = element("footer", undefined, "shared-review-actions");
    button(
      options.recoveryOnly ? "Close recovery copies" : "Review later",
      () => (options.recoveryOnly ? finish(null) : later()),
      footer,
    );
    if (!options.recoveryOnly)
      button(
        canWrite ? "Apply choices and resume sharing" : "Open shared copy",
        () => {
          const chosen = canWrite ? result() : shared;
          if (!options.settled) {
            finish(chosen);
            return;
          }
          applying = true;
          dialog.querySelectorAll("button, input").forEach((node) => {
            (node as HTMLButtonElement).disabled = true;
          });
          const status = element(
            "p",
            "Checking the latest shared copy and saving your choices…",
          );
          status.setAttribute("role", "status");
          footer.append(status);
          resolve(chosen);
          void options.settled.then(() => finish(null));
        },
        footer,
      );
    body.append(footer);
    button("Review saved changes", open, banner);
    update();
    open();
  });
}

export async function showSharedRecovery(lixId: string): Promise<void> {
  const recovery: SharedRecovery | null =
    await loadSharedRecoveryFromIdb(lixId);
  if (!recovery) {
    const dialog = element("dialog", undefined, "shared-review-dialog");
    dialog.setAttribute("aria-label", "Recovery copies");
    const style = element("style", styles);
    const body = element("div", undefined, "shared-review-body");
    body.append(
      element("h2", "No recovery copies yet"),
      element(
        "p",
        "When this device and a shared copy differ, both originals are saved here before you apply your choices.",
      ),
    );
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    const button = element("button", "Close recovery copies", "btn-paper");
    button.addEventListener("click", close);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    body.append(button);
    dialog.append(style, body);
    document.body.append(dialog);
    dialog.showModal();
    return;
  }
  await requestSharedReview({
    ...recovery,
    role: "commenter",
    isCurrent: () => true,
    recoveryOnly: true,
  });
}
