import { expect, test, type Page } from "@playwright/test";

/**
 * The dossier used to "file" and then vanish: the brief carried Qwik store
 * Proxies into IndexedDB, structured clone rejected them, and the IDB helper
 * swallowed the DataCloneError. This walks a guest through filing and then
 * refining a dossier and reads the stored record back each time.
 */

const ANSWERS = [
  "Libraries as Civic Infrastructure",
  "Essay",
  "Municipal leaders deciding next year's library budget",
  "Show that library funding is practical civic infrastructure",
  "Calm, evidence-led, and direct",
  "Avoid nostalgia and tie every claim to observable public value",
  "A reader can name three measurable outcomes worth funding",
];

async function storedWorkingTitles(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("twyne");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result
            .transaction("brief")
            .objectStore("brief")
            .getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () =>
            resolve(
              (
                req.result as Array<{
                  brief: { answers: { workingTitle: string } };
                }>
              ).map((record) => record.brief.answers.workingTitle),
            );
        };
      }),
  );
}

/** Step past the optional folios (probes, material, references) and file. */
async function sendToPress(page: Page): Promise<void> {
  const press = page.getByRole("button", { name: /send to press/i });
  const next = page.getByRole("button", { name: "Next", exact: true });
  await expect(async () => {
    if (await next.isVisible()) await next.click();
    await expect(press).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await press.click();
}

test("a filed and refined dossier survives into the editor", async ({
  page,
}) => {
  await page.goto("/onboarding/");
  await page
    .getByRole("button", { name: /just check things out/i })
    .first()
    .click();
  await page.getByRole("button", { name: "Begin" }).click();
  await expect(page).toHaveURL(/\/dossier\/create\//);

  for (const answer of ANSWERS) {
    await page
      .locator('input:not([type="file"]), textarea')
      .filter({ visible: true })
      .first()
      .fill(answer);
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await sendToPress(page);
  await expect(page.getByText("The dossier is filed")).toBeVisible();
  await expect.poll(() => storedWorkingTitles(page)).toEqual([ANSWERS[0]]);

  await page.getByRole("button", { name: /continue to the editor/i }).click();
  await expect(page).toHaveURL(/\/editor\//);
  const refine = page.getByRole("button", { name: "Refine the dossier" });
  await expect(refine).toBeVisible();

  await refine.click();
  await expect(page).toHaveURL(/\/dossier\/refine\//);
  const title = page
    .locator('input:not([type="file"]), textarea')
    .filter({ visible: true })
    .first();
  await expect(title).toHaveValue(ANSWERS[0]);
  await title.fill("Libraries, Refined");
  await sendToPress(page);

  await expect(page).toHaveURL(/\/editor\//);
  await expect
    .poll(() => storedWorkingTitles(page))
    .toEqual(["Libraries, Refined"]);
  await expect(
    page.getByRole("button", { name: "Refine the dossier" }),
  ).toBeVisible();
});

test("a new folio's name becomes its dossier's working title", async ({
  page,
}) => {
  await page.goto("/onboarding/");
  await page
    .getByRole("button", { name: /just check things out/i })
    .first()
    .click();
  await page.getByRole("button", { name: "Begin" }).click();
  for (const answer of ANSWERS) {
    await page
      .locator('input:not([type="file"]), textarea')
      .filter({ visible: true })
      .first()
      .fill(answer);
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await sendToPress(page);
  await page.getByRole("button", { name: /continue to the editor/i }).click();
  await expect(page).toHaveURL(/\/editor\//);

  await page.getByRole("button", { name: "Toggle the drawer sidebar" }).click();
  await page.getByRole("button", { name: /new folio/i }).click();
  await page.getByPlaceholder("Folio name").fill("Harbour Notes");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page).toHaveURL(/\/dossier\/create\/\?folio=/);
  const title = page
    .locator('input:not([type="file"]), textarea')
    .filter({ visible: true })
    .first();
  await expect(title).toHaveValue("Harbour Notes");
  await sendToPress(page);

  await expect
    .poll(async () => (await storedWorkingTitles(page)).sort())
    .toEqual([ANSWERS[0], "Harbour Notes"].sort());
});
