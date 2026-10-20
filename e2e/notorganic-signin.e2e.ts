import { expect, test, type Page } from "@playwright/test";

test("signed-out desk offers sign-in from both charge views and preserves the return destination", async ({
  page,
}) => {
  await page.route(/\/api\/auth\/get-session/, (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": route.request().headers().origin ?? "*",
        "access-control-allow-credentials": "true",
      },
      body: "null",
    }),
  );
  await page.route("https://id.notorganic.info/authorize**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Not Organic sign-in fixture</title>",
    }),
  );

  await page.goto("/desk/");
  const signIn = page.getByRole("link", { name: "Sign in to view charges" });
  await expect(signIn).toHaveCount(2);
  await expect(page.getByText("Checking hosted charges…")).toHaveCount(0);
  await signIn.last().click();
  await expect(page).toHaveURL(/\/signin\/\?returnTo=%2Fdesk%2F$/);
  await page.getByRole("button", { name: "Continue with Not Organic" }).click();
  await expect(page).toHaveURL(/https:\/\/id\.notorganic\.info\/authorize\?/);

  // Return to the app origin to inspect only the destination saved by the real PKCE flow.
  await page.goto("/signin/");
  const returnTo = await page.evaluate(() => {
    const saved = sessionStorage.getItem("twyne:notorganic-sign-in");
    return saved ? JSON.parse(saved).returnTo : undefined;
  });
  expect(returnTo).toBe("/desk/");
});

/** Exercise the real callback page and Better Auth client with synthetic responses. */
async function signInCallback(page: Page, confirmSession: boolean) {
  let redeemed = false;
  const requests: { origin: string; verifierLength: number }[] = [];
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
    const user = {
      id: "synthetic-morgan-vale",
      name: "Morgan Vale",
      email: "morgan.private@example.test",
      image: "/assets/avatars/engraved-2026-09/owl.webp",
      emailVerified: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let body: unknown = null;
    if (path.endsWith("/sign-in/notorganic")) {
      const input = request.postDataJSON();
      requests.push({
        origin: input.origin,
        verifierLength: input.verifier.length,
      });
      redeemed = true;
      body = { user: { id: user.id, name: user.name, image: user.image } };
    } else if (path.endsWith("/get-session") && redeemed && confirmSession) {
      body = {
        user,
        session: {
          id: "synthetic-session",
          userId: user.id,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    } else if (path.endsWith("/convex/token")) {
      body = { token: null };
    }
    return route.fulfill({
      contentType: "application/json",
      headers,
      body: JSON.stringify(body),
    });
  });
  await page.route("**/__signin-seed", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Sign-in seed</title>",
    }),
  );
  await page.goto("/__signin-seed");
  await page.evaluate(() => {
    sessionStorage.setItem(
      "twyne:notorganic-sign-in",
      JSON.stringify({
        state: "synthetic-state",
        verifier: "a".repeat(43),
        origin: location.origin,
        returnTo: "/library/",
        expiresAt: Date.now() + 60000,
      }),
    );
  });
  await page.goto(
    "/auth/notorganic/?code=synthetic-one-time&state=synthetic-state",
  );
  return requests;
}

test("Not Organic callback returns to the library only after confirming the matching session", async ({
  page,
}) => {
  const requests = await signInCallback(page, true);
  await expect(page).toHaveURL(/\/library\/$/);
  expect(requests).toEqual([
    { origin: new URL(page.url()).origin, verifierLength: 43 },
  ]);
  expect(await page.locator("body").innerText()).not.toContain(
    "morgan.private@example.test",
  );
});

test("Not Organic callback stays on a recoverable error when the session cannot be confirmed", async ({
  page,
}) => {
  const requests = await signInCallback(page, false);
  await expect(page.getByRole("alert")).toHaveText(
    "Twyne could not confirm your session. Please sign in again.",
  );
  await expect(
    page.getByRole("link", { name: "Return to sign in" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/notorganic\/$/);
  expect(requests).toHaveLength(1);
  expect(await page.locator("body").innerText()).not.toContain(
    "morgan.private@example.test",
  );
});
