import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { LOCAL_WRITING_PACKS } from "../src/utils/local-writing-manifest";

const FIRST =
  "At dawn, Mara stood beside the window. The lamp flickered as Jules opened the door. A clock ticked in the quiet room.";
const SECOND =
  "Across the bridge, Mara carried the ledger. Jules waited below the arch and called her name.";
const HTML = `<h2>The waiting room</h2><p>${FIRST}</p><h2>Across the bridge</h2><p>${SECOND}</p>`;
const IDEA = "A brass lamp casts a narrow circle across the unopened ledger.";
const manuscript = (page: Page) => page.locator(".ProseMirror").first();
const dock = (page: Page) =>
  page.getByRole("dialog", { name: "Writing instruments", exact: true });
const scene = (page: Page) => dock(page).locator(".scene-bench");

async function seed(page: Page) {
  await page.route(/\/api\/auth\//, (route) =>
    route.fulfill({ contentType: "application/json", body: "null" }),
  );
  await page.route("**/__instrument-dock-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Fictional dock manuscript</title>",
    }),
  );
  await page.goto("/__instrument-dock-seed");
  await page.evaluate(async (html) => {
    const path = "/src/utils/idb.ts";
    const db = await import(/* @vite-ignore */ path);
    const now = Date.now(),
      id = "offline-instrument-dock-fixture";
    await db.saveFoliosToIdb([
      {
        id,
        name: "The waiting room",
        type: "draft",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.saveFolioContentToIdb(id, html);
    await db.saveActiveFolioIdToIdb(id);
    await db.saveMetaToIdb("live-review-enabled", false);
    await db.saveMetaToIdb("signin-toast-dismissed", true);
    localStorage.setItem("living-desk-open", "false");
    localStorage.setItem(
      "twyne:editor:view:v1",
      JSON.stringify({ zenMode: false, compositorOpen: false }),
    );
  }, HTML);
  await page.goto("/editor/");
  await expect(manuscript(page)).toContainText(FIRST);
  await page.evaluate(() => document.fonts.ready);
}

/** Native selection is setup; all instrument interactions use visible controls. */
async function selectPassage(page: Page, text = FIRST) {
  await manuscript(page).evaluate((root, text) => {
    (root as HTMLElement).focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
      nodes: Text[] = [];
    let plain = "",
      node: Node | null;
    while ((node = walker.nextNode())) {
      nodes.push(node as Text);
      plain += node.textContent ?? "";
    }
    const start = plain.indexOf(text);
    if (start < 0) throw new Error("Fixture passage is absent");
    const range = document.createRange();
    let offset = 0,
      began = false;
    for (const node of nodes) {
      const end = offset + node.length;
      if (!began && start >= offset && start < end) {
        range.setStart(node, start - offset);
        began = true;
      }
      if (began && start + text.length <= end) {
        range.setEnd(node, start + text.length - offset);
        break;
      }
      offset = end;
    }
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, text);
  await expect(
    page.getByRole("toolbar", { name: /^Actions for/ }),
  ).toBeVisible();
}
async function openScene(page: Page, text = FIRST) {
  await selectPassage(page, text);
  await page
    .getByRole("toolbar", { name: /^Actions for/ })
    .getByRole("button", { name: "Scene bench", exact: true })
    .click();
  await expect(dock(page)).toBeVisible();
  await expect(
    scene(page).getByRole("heading", { name: "Scene bench", exact: true }),
  ).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
async function close(page: Page) {
  await dock(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(dock(page)).not.toBeVisible();
}

// No model answers or provider responses are fabricated in these fixtures.
test("Scene selection inventories exact local source and jumps to that source", async ({
  page,
}, info) => {
  await seed(page);
  const original = await manuscript(page).innerHTML();
  await openScene(page);
  await scene(page)
    .getByText("Selected passage · 3 sentences", { exact: true })
    .click();
  await expect(
    scene(page).locator(".scene-bench__source blockquote"),
  ).toHaveText(FIRST);
  await expect(scene(page)).toContainText("Local English cue scan");
  const light = scene(page).locator('[data-scene-dimension="light"]');
  const evidence = light.locator("blockquote").first();
  await expect(evidence).toContainText("lamp flickered");
  const exact = await evidence.innerText();
  await capture(page, info, "01-scene-local-inventory");
  await scene(page)
    .getByText("Ask for a model reading", { exact: true })
    .click();
  await expect(
    scene(page).getByRole("button", {
      name: "Read the scene with a model",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(scene(page).locator(".scene-bench__reading")).toHaveCount(0);
  await light
    .getByRole("button", { name: "Find in passage", exact: true })
    .first()
    .click();
  await expect(dock(page)).not.toBeVisible();
  await info.attach("Focus after Escape", {
    body: JSON.stringify(
      await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        text: document.activeElement?.textContent?.slice(0, 100),
        className: document.activeElement?.className,
      })),
    ),
    contentType: "application/json",
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(exact);
  expect(await manuscript(page).innerHTML()).toBe(original);
});

test("saved scene ideas and media briefs remain proposals with no provider request", async ({
  page,
}, info) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      /typesafe|openai\.com|api\.anthropic|huggingface\.co|cdn\.jsdelivr/.test(
        request.url(),
      )
    )
      requests.push(request.url());
  });
  await seed(page);
  const original = await manuscript(page).innerHTML();
  await openScene(page);
  await scene(page).getByLabel("An idea to try", { exact: true }).fill(IDEA);
  await scene(page)
    .getByRole("button", { name: "Save this idea", exact: true })
    .click();
  await expect(scene(page).locator(".scene-bench__ideas")).toContainText(IDEA);
  await expect(scene(page)).toContainText("Your proposed addition");
  await expect(scene(page)).toContainText(
    "Idea saved on this device. The manuscript is unchanged.",
  );
  await scene(page)
    .getByRole("button", { name: "Prepare image brief", exact: true })
    .click();
  const brief = scene(page).getByLabel("Image brief", { exact: true });
  await expect(brief).toHaveValue(new RegExp("Source excerpt \\(verbatim"));
  expect(await brief.inputValue()).toContain(FIRST);
  expect(await brief.inputValue()).toContain(
    "Writer-proposed additions (not facts from the manuscript):",
  );
  expect(await brief.inputValue()).toContain(IDEA);
  await expect(scene(page)).toContainText(
    "Media generation is not connected to this instrument.",
  );
  await capture(page, info, "02-scene-proposal-and-local-brief");
  await close(page);
  await openScene(page);
  await expect(scene(page).locator(".scene-bench__ideas")).toContainText(IDEA);
  await scene(page)
    .getByRole("button", { name: "Remove idea 1", exact: true })
    .click();
  await expect(scene(page).locator(".scene-bench__ideas")).toHaveCount(0);
  await scene(page)
    .getByRole("button", { name: "Undo removal", exact: true })
    .click();
  await expect(scene(page).locator(".scene-bench__ideas")).toContainText(IDEA);
  expect(await manuscript(page).innerHTML()).toBe(original);
  expect(requests).toEqual([]);
});

test("Entities shows code presence and jumps to an exact manuscript passage", async ({
  page,
}, info) => {
  await seed(page);
  const original = await manuscript(page).innerHTML();
  await openScene(page);
  await dock(page)
    .getByRole("button", { name: "Entities", exact: true })
    .click();
  const entity = dock(page).getByRole("region", {
    name: "Entity instrument",
    exact: true,
  });
  await expect(
    entity.getByRole("heading", { name: "Presence · code", exact: true }),
  ).toBeVisible();
  await entity
    .getByRole("combobox", { name: "Entity candidate", exact: true })
    .selectOption({ label: "Mara · 2 mentions" });
  await expect(entity.locator(".entity-presence")).toContainText(
    "The waiting room",
  );
  await expect(entity.locator(".entity-presence")).toContainText(
    "Across the bridge",
  );
  expect(
    await entity.locator(".entity-presence strong").allTextContents(),
  ).toEqual(["1", "1"]);
  await entity.getByText("Inspect source passages", { exact: true }).click();
  const source = entity.locator(".entity-source").first();
  await expect(source.locator("blockquote")).toHaveText(FIRST);
  await expect(entity.locator(".entity-reading")).toHaveCount(0);
  await capture(page, info, "03-entity-presence-and-exact-source");
  await source.getByRole("button", { name: /jump to exact source/ }).click();
  await expect(dock(page)).not.toBeVisible();
  await info.attach("Focus after Escape", {
    body: JSON.stringify(
      await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        text: document.activeElement?.textContent?.slice(0, 100),
        className: document.activeElement?.className,
      })),
    ),
    contentType: "application/json",
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe(FIRST);
  expect(await manuscript(page).innerHTML()).toBe(original);
});

test("signed-out Task desk retains the selected passage and disables queue and account resources", async ({
  page,
}, info) => {
  await seed(page);
  await selectPassage(page);
  await page
    .getByRole("toolbar", { name: /^Actions for/ })
    .getByRole("button", { name: "Task desk", exact: true })
    .click();
  const tasks = dock(page).getByRole("region", {
    name: "Task desk",
    exact: true,
  });
  await expect(tasks).toBeVisible();
  await expect(
    tasks.getByLabel("Reference passage", { exact: true }),
  ).toHaveValue(FIRST);
  await expect(tasks).toContainText(
    "Sign in with Not Organic and sync this folio to queue durable tasks.",
  );
  await expect(
    tasks.getByRole("button", { name: "Queue task", exact: true }),
  ).toBeDisabled();
  await expect(
    tasks.getByRole("button", { name: "Refresh account sources", exact: true }),
  ).toBeDisabled();
  await expect(
    tasks.getByRole("button", { name: "List resources", exact: true }),
  ).toBeDisabled();
  await tasks
    .getByRole("combobox", { name: "Task", exact: true })
    .selectOption("source-research");
  await expect(
    tasks.getByRole("button", { name: "Queue task", exact: true }),
  ).toBeDisabled();
  await expect(tasks.locator(".task-card")).toHaveCount(0);
  await capture(page, info, "04-signed-out-task-desk");
});

test("On-device pack sizes and explicit controls do not start any download on opening", async ({
  page,
}, info) => {
  const requests: string[] = [];
  await page.route(/https:\/\/huggingface\.co\//, (route) => {
    requests.push(route.request().url());
    return route.abort("failed");
  });
  page.on("request", (request) => {
    if (/cdn\.jsdelivr/.test(request.url())) requests.push(request.url());
  });
  await seed(page);
  await openScene(page);
  await dock(page)
    .getByRole("button", { name: "On-device tools", exact: true })
    .click();
  const local = dock(page).getByRole("region", {
    name: "On-device writing tools",
    exact: true,
  });
  await expect(local).toBeVisible();
  for (const pack of Object.values(LOCAL_WRITING_PACKS)) {
    const section = local.locator(".pack").filter({
      has: page.getByRole("heading", { name: pack.label, exact: true }),
    });
    const mb = (
      pack.files.reduce((sum, file) => sum + file.size, 0) / 1_000_000
    ).toFixed(1);
    await expect(section).toContainText(`${mb} MB model pack`);
    await expect(section).toContainText("Not fully downloaded");
    await expect(
      section.getByRole("button", { name: "Download & load", exact: true }),
    ).toBeEnabled();
  }
  await expect(
    local.getByRole("button", { name: "Compare on this device", exact: true }),
  ).toBeDisabled();
  await expect(
    local.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeDisabled();
  await capture(page, info, "05-explicit-local-pack-inventory");
  expect(requests).toEqual([]);
  const embeddings = local.locator(".pack").filter({
    has: page.getByRole("heading", {
      name: "Passage connections",
      exact: true,
    }),
  });
  await embeddings
    .getByRole("button", { name: "Download & load", exact: true })
    .click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(
    local.getByRole("button", { name: "Download & load", exact: true }).first(),
  ).toBeEnabled();
  await expect(embeddings).toContainText("Not fully downloaded");
  await expect(
    local.getByRole("button", { name: "Compare on this device", exact: true }),
  ).toBeDisabled();
});

test("390px dock stays centered and contained, retains focus and closes back to its opener", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openScene(page);
  for (const tab of [
    "Scene bench",
    "Entities",
    "Task desk",
    "On-device tools",
  ]) {
    await dock(page).getByRole("button", { name: tab, exact: true }).click();
    const box = await dock(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(15);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(845);
    expect(Math.abs(box!.x + box!.width / 2 - 195)).toBeLessThanOrEqual(2);
    expect(Math.abs(box!.y + box!.height / 2 - 422)).toBeLessThanOrEqual(2);
  }
  await capture(page, info, "06-narrow-centered-local-tools");
  await dock(page).getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest("dialog[open]"),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dock(page)).not.toBeVisible();
  await info.attach("Focus after Escape", {
    body: JSON.stringify(
      await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        text: document.activeElement?.textContent?.slice(0, 100),
        className: document.activeElement?.className,
      })),
    ),
    contentType: "application/json",
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return (
          !!active &&
          (active.matches(".ProseMirror") ||
            (active instanceof HTMLButtonElement &&
              active.textContent?.trim() === "Scene bench"))
        );
      }),
    )
    .toBe(true);
  await openScene(page);
  await close(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        return (
          !!active &&
          (active.matches(".ProseMirror") ||
            (active instanceof HTMLButtonElement &&
              active.textContent?.trim() === "Scene bench"))
        );
      }),
    )
    .toBe(true);
});
