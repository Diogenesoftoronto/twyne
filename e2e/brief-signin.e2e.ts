import { expect, test, type Page } from "@playwright/test";
const answers = [
  "Urgent brief regression",
  "Essay",
  "Researchers who need every detail",
  "Preserve this lengthy objective through sign-in",
  "Exact and warm",
  "Keep all citations and the original argument",
  "The reader can explain the evidence",
];
async function mockAuth(page: Page) {
  let signedIn = false;
  let userId = "synthetic-brief-user";
  await page.route(/\/api\/auth\//, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": request.headers().origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type, better-auth-cookie",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    const now = new Date().toISOString();
    const user = {
      id: userId,
      name: "Brief Tester",
      email: "brief@example.test",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    };
    let body: unknown = null;
    if (path.endsWith("/sign-in/notorganic")) {
      signedIn = true;
      body = { user };
    } else if (path.endsWith("/get-session") && signedIn)
      body = {
        user,
        session: {
          id: "synthetic-brief-session",
          userId: user.id,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          createdAt: now,
          updatedAt: now,
        },
      };
    else if (path.endsWith("/convex/token")) body = { token: null };
    await route.fulfill({
      contentType: "application/json",
      headers,
      body: JSON.stringify(body),
    });
  });
  await page.route("https://id.notorganic.info/authorize?**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><p>Synthetic identity provider</p>",
    }),
  );
  return {
    switchAccount: (id: string) => {
      signedIn = true;
      userId = id;
    },
  };
}
async function openBrief(page: Page) {
  await mockAuth(page);
  await page.goto("/dossier/create/");
  await expect(page.locator('[aria-labelledby="atr-question"]')).toBeVisible();
}
async function fillBrief(page: Page) {
  for (const [index, answer] of answers.entries()) {
    await page.locator('[aria-labelledby="atr-question"]').fill(answer);
    await page.getByRole("button", { name: /^Next/ }).click();
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      String(index + 2),
    );
  }
  // Local follow-ups require no hosted model or account.
  await expect(
    page.getByText("Dept. of Particulars", { exact: true }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "9",
  );
  await page
    .locator('[aria-labelledby="atr-question"]')
    .fill("All of the writer's original starting material.");
  await page.getByRole("button", { name: /^Next/ }).click();
}
async function callback(page: Page) {
  const state = new URL(page.url()).searchParams.get("state");
  expect(state).toBeTruthy();
  await page.goto(`/auth/notorganic/?code=synthetic-one-time&state=${state}`);
}
async function briefOnDisk(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const idb = await import(/* @vite-ignore */ path);
    const folioId = await idb.loadActiveFolioIdFromIdb();
    return {
      folioId,
      brief: await idb.loadBriefFromIdb(folioId),
      material: await idb.loadFolioContentFromIdb(folioId),
    };
  });
}
test("filing a guest brief, refreshing the sign-in offer, and signing in retains the full dossier", async ({
  page,
}, testInfo) => {
  await openBrief(page);
  await fillBrief(page);
  await page
    .getByRole("button", { name: "Send to press", exact: true })
    .click();
  await expect(
    page.getByText("Keep your work across devices", { exact: true }),
  ).toBeVisible();
  const before = await briefOnDisk(page);
  expect(Object.values(before.brief.answers)).toEqual(answers);
  await page.reload();
  await expect(
    page.getByText("Keep your work across devices", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue with Not Organic", exact: true })
    .click();
  await expect(page).toHaveURL(/id\.notorganic\.info\/authorize/);
  await callback(page);
  await expect(page).toHaveURL(/\/editor\/$/);
  await expect(page.locator(".ProseMirror")).toContainText(
    "original starting material",
  );
  const after = await briefOnDisk(page);
  expect(after.brief).toEqual(before.brief);
  expect(after.folioId).toBe(before.folioId);
  await page.goto(`/dossier/refine/?folio=${after.folioId}`);
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    answers[0],
  );
  await page.screenshot({
    path: testInfo.outputPath("brief-after-signin.png"),
    fullPage: true,
  });
});
test("unfinished brief survives refresh, leaving for sign-in, cancellation and confirmed sign-in", async ({
  page,
}) => {
  await openBrief(page);
  await page.locator('[aria-labelledby="atr-question"]').fill(answers[0]);
  await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  await page.locator('[aria-labelledby="atr-question"]').fill(answers[1]);
  await page.reload();
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    answers[1],
  );
  await page.goto("/signin/");
  await page
    .getByRole("button", { name: "Continue with Not Organic", exact: true })
    .click();
  await expect(page).toHaveURL(/id\.notorganic\.info\/authorize/);
  // Cancel without redeeming the attempt; guest state remains recoverable.
  await page.goto("/dossier/create/");
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    answers[1],
  );
  await page.goto("/signin/");
  await page
    .getByRole("button", { name: "Continue with Not Organic", exact: true })
    .click();
  await expect(page).toHaveURL(/id\.notorganic\.info\/authorize/);
  await callback(page);
  await expect(page).toHaveURL(/\/signin\/$/);
  await page.goto("/dossier/create/");
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    answers[1],
  );
  await page.getByRole("button", { name: /Back$/ }).click();
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    answers[0],
  );
});

test("a failed filing retains every answer on refresh and can be retried", async ({
  page,
}) => {
  await openBrief(page);
  await fillBrief(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "brief") throw new Error("Synthetic disk failure");
      return put.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "Send to press", exact: true })
    .click();
  await expect(
    page.getByText(/The dossier could not be saved on this device/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Send to press", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Back$/ }).click();
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    "All of the writer's original starting material.",
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Send to press", exact: true })
    .click();
  await expect(
    page.getByText("Keep your work across devices", { exact: true }),
  ).toBeVisible();
  const saved = await briefOnDisk(page);
  expect(Object.values(saved.brief.answers)).toEqual(answers);
  expect(saved.material).toContain("original starting material");
});

test("switching accounts cannot restore the prior account's unfinished brief", async ({
  page,
}) => {
  const session = await mockAuth(page);
  session.switchAccount("synthetic-alice");
  await page.goto("/dossier/create/");
  await page
    .locator('[aria-labelledby="atr-question"]')
    .fill("Alice's private brief");
  await page.reload();
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    "Alice's private brief",
  );
  session.switchAccount("synthetic-bob");
  await page.reload();
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    "Untitled project",
  );
  await page
    .locator('[aria-labelledby="atr-question"]')
    .fill("Bob's separate brief");
  session.switchAccount("synthetic-alice");
  await page.reload();
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    "Alice's private brief",
  );
});
