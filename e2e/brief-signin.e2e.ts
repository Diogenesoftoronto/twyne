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
  const appOrigin = new URL(
    `http://127.0.0.1:${process.env.TWYNE_DEV_PORT ?? "5173"}`,
  ).origin;
  const blockedExternalRequests: string[] = [];
  // The strength hook can call a Convex action or a saved direct endpoint.
  // Block inference paths even on the app origin, then deny all other external
  // requests so the test cannot reach an inference server.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith("/v1/systemone") ||
      url.pathname.endsWith("/api/action")
    ) {
      blockedExternalRequests.push(`${url.origin}${url.pathname}`);
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Inference disabled by the onboarding e2e test",
      });
    }
    if (url.origin === appOrigin) return route.continue();
    blockedExternalRequests.push(`${url.origin}${url.pathname}`);
    return route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "External network disabled by the onboarding e2e test",
    });
  });
  await mockAuth(page);
  await page.goto("/dossier/create/");
  await expect(page.locator('[aria-labelledby="atr-question"]')).toBeVisible();
  // Prove the catch-all route is active with a synthetic endpoint that cannot
  // resolve publicly. It is never sent to an inference service.
  await page.evaluate(async () => {
    await fetch("https://blocked-inference.invalid/v1/systemone", {
      method: "POST",
      body: "{}",
    });
  });
  expect(blockedExternalRequests).toContain(
    "https://blocked-inference.invalid/v1/systemone",
  );
  return blockedExternalRequests;
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

test("typing continuously keeps the active brief field, caret, and answer through rerenders", async ({
  page,
}) => {
  const blockedExternalRequests = await openBrief(page);
  // Let Qwik finish the initial client resume before instrumenting keystrokes.
  await page.waitForTimeout(1200);
  const field = page.locator('[aria-labelledby="atr-question"]');
  await field.evaluate((element: HTMLInputElement) => {
    // Seed only the native control so this first input event starts a clean
    // regression window, before the 900 ms strength pause has elapsed.
    element.value = "draft";
    element.focus();
    element.setSelectionRange(2, 2);
    (
      window as typeof window & { regressionInput?: HTMLInputElement }
    ).regressionInput = element;
  });
  expect(
    await field.evaluate((element: HTMLInputElement) => element.selectionStart),
  ).toBe(2);

  // Insert in the middle: a controlled value write on every keystroke can
  // move the caret to the end even when the visible text remains correct.
  await page.keyboard.type("XYZ");
  await expect(field).toHaveValue("drXYZaft");
  const immediatelyAfterTyping = await field.evaluate((element) => ({
    sameNode:
      (window as typeof window & { regressionInput?: HTMLInputElement })
        .regressionInput === element,
    focused: document.activeElement === element,
    caret: element.selectionStart,
  }));
  expect(immediatelyAfterTyping).toEqual({
    sameNode: true,
    focused: true,
    caret: 5,
  });

  // Wait beyond the strength hook's 900 ms pause: async state updates must
  // preserve the native form leaf while the writer is still focused.
  await page.waitForTimeout(1100);
  const afterAsyncUpdate = await field.evaluate((element) => ({
    sameNode:
      (window as typeof window & { regressionInput?: HTMLInputElement })
        .regressionInput === element,
    focused: document.activeElement === element,
    caret: element.selectionStart,
  }));
  expect(afterAsyncUpdate).toEqual({
    sameNode: true,
    focused: true,
    caret: 5,
  });
  await expect(field).toHaveValue("drXYZaft");
  expect(
    blockedExternalRequests.filter(
      (request) =>
        request.endsWith("/v1/systemone") || request.endsWith("/api/action"),
    ),
    "the inference and Convex action paths must be intercepted before they can reach a server",
  ).toEqual(["https://blocked-inference.invalid/v1/systemone"]);

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "2",
  );
  // Question switching must restore the same literal answer.
  await page.getByRole("button", { name: /Back$/ }).click();
  await expect(page.locator('[aria-labelledby="atr-question"]')).toHaveValue(
    "drXYZaft",
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

test("a delayed strength result preserves the focused input and caret", async ({
  page,
}) => {
  await openBrief(page);
  await page.waitForTimeout(1200);
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let requested = false;
  await page.route(
    "https://brief-judgement.invalid/v1/systemone",
    async (route) => {
      requested = true;
      const { questions } = route.request().postDataJSON();
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, raw]) => {
          const q = raw as {
            type: string;
            criteria?: string[] | Record<string, null>;
          };
          if (q.type === "noul") return [id, { type: "noul", noul: 0.9 }];
          const labels = Array.isArray(q.criteria)
            ? q.criteria
            : Object.keys(q.criteria!);
          const last = labels.length - 1;
          return [
            id,
            q.type === "score"
              ? {
                  type: "score",
                  score: last,
                  confidence: 1,
                  probabilities: Object.fromEntries(
                    labels.map((_, i) => [i, i === last ? 1 : 0]),
                  ),
                  legend: Object.fromEntries(
                    labels.map((label, i) => [i, label]),
                  ),
                }
              : {
                  type: "choice",
                  choice: labels[0],
                  confidence: 1,
                  probabilities: Object.fromEntries(
                    labels.map((label, i) => [label, i === 0 ? 1 : 0]),
                  ),
                },
          ];
        }),
      );
      await responseGate;
      await route.fulfill({
        json: {
          model: "synthetic-test",
          answers,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
    },
  );
  const field = page.locator('[aria-labelledby="atr-question"]');
  await field.fill("A specific title about the harbour");
  await field.evaluate((element: HTMLInputElement) => {
    element.focus();
    element.setSelectionRange(4, 4);
    (
      window as typeof window & { regressionInput?: HTMLInputElement }
    ).regressionInput = element;
  });
  await page.evaluate(async () => {
    const path = "/src/utils/idb.ts";
    const { loadAiSettingsFromIdb, saveAiSettingsToIdb } = await import(path);
    const settings = await loadAiSettingsFromIdb();
    await saveAiSettingsToIdb(
      {
        ...settings,
        judgement: {
          source: "endpoint",
          endpointUrl: "https://brief-judgement.invalid",
        },
      },
      false,
    );
  });
  await expect.poll(() => requested).toBe(true);
  await expect(page.locator(".answer-strength--full")).toHaveAttribute(
    "data-reading",
    "true",
  );
  releaseResponse();
  await expect(
    page.locator(".answer-strength--full .answer-strength__source"),
  ).toHaveText("Jev");
  expect(
    await field.evaluate((element: HTMLInputElement) => ({
      sameNode:
        (window as typeof window & { regressionInput?: HTMLInputElement })
          .regressionInput === element,
      focused: document.activeElement === element,
      caret: element.selectionStart,
    })),
  ).toEqual({ sameNode: true, focused: true, caret: 4 });
  await page.keyboard.type("XYZ");
  await expect(field).toHaveValue("A spXYZecific title about the harbour");
});

test("all brief answer fields retain focus and selection on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBrief(page);
  await page.waitForTimeout(1200);
  for (let index = 0; index < 7; index++) {
    const field = page.locator('[aria-labelledby="atr-question"]');
    await field.fill("draft");
    await field.evaluate((element: HTMLInputElement | HTMLTextAreaElement) => {
      element.focus();
      element.setSelectionRange(2, 2);
      (
        window as typeof window & { regressionInput?: Element }
      ).regressionInput = element;
    });
    await page.keyboard.type("XYZ");
    await page.waitForTimeout(1100);
    await expect(field).toHaveValue("drXYZaft");
    expect(
      await field.evaluate(
        (element: HTMLInputElement | HTMLTextAreaElement) => ({
          sameNode:
            (window as typeof window & { regressionInput?: Element })
              .regressionInput === element,
          focused: document.activeElement === element,
          caret: element.selectionStart,
        }),
      ),
    ).toEqual({ sameNode: true, focused: true, caret: 5 });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      String(index + 2),
    );
  }
});
