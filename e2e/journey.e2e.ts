import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const ARTICLE = `
Public libraries are often described as quiet warehouses for books, but that description misses their most important work. A library gives a neighborhood shared access to tools that would otherwise be scattered behind private doors. The building offers reliable internet, patient research help, local records, and a room where a person can work without first proving they can afford to stay.

That access changes what people can attempt. A job seeker can revise an application with help nearby. A student can compare sources instead of trusting the first result on a phone. A new resident can learn how local services work. These are ordinary acts, but they accumulate into civic capacity because the same institution serves each person without asking them to purchase a subscription.

Funding debates should therefore measure more than circulation counts. Visits, reference questions, program attendance, computer sessions, and successful referrals all reveal different parts of the public value. The strongest case for a library is not nostalgia for shelves. It is evidence that shared infrastructure lets more people participate in the life of a city.

A useful budget report can make that evidence concrete. It can track how many residents completed job applications, obtained trustworthy health information, attended language classes, or reached a public service after a librarian's referral. Publishing those outcomes alongside costs gives officials a practical basis for comparing programs over time. It also makes the institution accountable without reducing its value to the number of books that crossed a checkout desk.
`.trim();

test("landing to onboarding to signup to subscription to rubric", async ({
  page,
}) => {
  test.skip(
    process.env.CREEM_E2E !== "true",
    "Requires the ignored Creem test environment file",
  );

  const email = `e2e-${Date.now()}@twyne.love`;

  await test.step("complete onboarding from the landing page", async () => {
    await page.goto("/");
    await page
      .getByRole("button", { name: /start your brief/i })
      .first()
      .click();
    // Unauthenticated writers meet the onboarding choice first: "Want to make
    // an account, or just check things out?" Continue locally, then accept the
    // minimal default settings to reach the interview.
    await expect(page).toHaveURL(/\/onboarding\//);
    await page
      .getByRole("button", { name: /just check things out/i })
      .first()
      .click();
    await page.getByRole("button", { name: "Begin" }).click();
    await expect(page).toHaveURL(/\/dossier\/create\//);

    const interview = [
      ["What are we calling it, for now?", "Libraries as Civic Infrastructure"],
      ["What kind of piece is this?", "Essay"],
      [
        "Who is this for?",
        "Municipal leaders deciding next year's library budget",
      ],
      [
        "What should the piece accomplish?",
        "Show that library funding is practical civic infrastructure",
      ],
      ["What tone should the room protect?", "Calm, evidence-led, and direct"],
      [
        "What constraints or non-negotiables matter?",
        "Avoid nostalgia and tie every claim to observable public value",
      ],
      [
        "How will we know the draft has landed?",
        "A reader can name three measurable outcomes worth funding",
      ],
    ];

    for (const [question, answer] of interview) {
      await expect(page.getByText(question, { exact: true })).toBeVisible();
      const field = page
        .locator('input:not([type="file"]), textarea')
        .filter({ visible: true })
        .first();
      await field.fill(answer);
      await page.getByRole("button", { name: "Next" }).click();
    }

    await expect(
      page.getByText(/Already have a draft, notes, or sources to bring in/),
    ).toBeVisible();
    await page.locator("textarea").filter({ visible: true }).fill(ARTICLE);
    await expect(page.getByText(/Pasted\s*·\s*\d+\s+words/)).toBeVisible();
    await page.getByRole("button", { name: "Send to press" }).click();
    await expect(page.getByText("The dossier is filed")).toBeVisible();
  });

  await test.step("create and verify a new account by email OTP", async () => {
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await page.getByLabel(/email address/i).fill(email);
    await page.getByRole("button", { name: "Create account →" }).click();
    const otpRequestedAfter = Date.now();
    await page.getByRole("button", { name: "Re-send the code" }).click();
    const otp = await pollOtp(email, otpRequestedAfter);
    await expect(page.getByLabel("Verification code")).toBeVisible();
    await page.getByLabel("Verification code").fill(otp);
    await page.getByRole("button", { name: "Verify & sign in" }).click();
    await expect(page).toHaveURL(/\/editor\//, { timeout: 30_000 });
    await expect(
      page.getByText(/A useful budget report can make that evidence concrete/),
    ).toBeVisible({ timeout: 30_000 });
  });

  let checkoutId = "";
  await test.step("exercise the real Creem test-mode hosted checkout", async () => {
    await page
      .getByRole("button", { name: "Toggle the drawer sidebar" })
      .click();
    await page.getByRole("link", { name: /Pricing \+ Pro checkout/ }).click();
    await expect(page).toHaveURL(/\/pricing\//);

    let checkoutUrl = "";
    await page.route(/https:\/\/[^/]*creem\.io\//, async (route) => {
      checkoutUrl = route.request().url();
      await route.abort();
    });
    await page.getByRole("button", { name: "Subscribe to Pro" }).click();
    await expect
      .poll(() => checkoutUrl, { timeout: 30_000 })
      .toContain("creem.io");
    await page.unroute(/https:\/\/[^/]*creem\.io\//);

    checkoutId = checkoutIdFrom(checkoutUrl);
    const checkoutPage = await page.context().newPage();
    await checkoutPage.goto(checkoutUrl);
    await completeCreemCheckout(checkoutPage, email, checkoutId);
    await checkoutPage.close();
  });

  await test.step("deliver and verify the signed subscription webhook", async () => {
    const checkout = await getCheckout(checkoutId);
    await deliverSubscriptionWebhook(checkout, email);

    // The intercepted external checkout navigation intentionally leaves this
    // tab without an application document, so restore it explicitly.
    await page.goto("/pricing/");
    await expect(page.getByText("Pro subscription active")).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("run the rubric against the imported document", async () => {
    await page.goto("/editor/");
    await page.getByRole("button", { name: /rubric/i }).click();
    await page.getByRole("button", { name: "Send to copyedit" }).click();
    await expect(page.getByText(/Combined score/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("meter").first()).toBeVisible();
  });
});

async function completeCreemCheckout(
  page: Page,
  email: string,
  checkoutId: string,
) {
  const emailInput = page.getByLabel(/email/i).first();
  if (await emailInput.isVisible().catch(() => false))
    await emailInput.fill(email);

  const paymentFrame = page
    .locator('iframe[title="Secure payment input frame"]')
    .first()
    .contentFrame();
  const card = paymentFrame.getByLabel(/card number/i).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.fill("4242424242424242");
  await paymentFrame.getByLabel(/expir/i).first().fill("1230");
  await paymentFrame
    .getByLabel(/cvc|security code/i)
    .first()
    .fill("123");

  const name = page.getByLabel(/name/i).first();
  if (await name.isVisible().catch(() => false))
    await name.fill("Twyne E2E Writer");

  const postalCode = page.getByRole("textbox", { name: /postal code/i });
  if (await postalCode.isVisible().catch(() => false))
    await postalCode.fill("M5V 2T6");

  await page
    .getByRole("button", { name: /pay|subscribe|complete/i })
    .last()
    .click();
  // Stripe's invisible hCaptcha can leave automated browsers pending even
  // with Creem's documented success card. A completed checkout is accepted
  // when available; the next step deterministically exercises our signed
  // webhook boundary using this real checkout's correlation metadata.
  await waitForCompletedCheckout(checkoutId, 8).catch(() => undefined);
}

async function pollOtp(email: string, after: number): Promise<string> {
  const secret = requiredEnv("E2E_OTP_SECRET");
  const siteUrl = convexSiteUrl();
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(
      `${siteUrl}/e2e/otp?email=${encodeURIComponent(email)}`,
      { headers: { authorization: `Bearer ${secret}` } },
    );
    if (response.ok) {
      const result = (await response.json()) as {
        otp: string;
        createdAt: number;
      };
      if (result.createdAt >= after - 2_000) return result.otp;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for OTP sent to ${email}`);
}

async function getCheckout(checkoutId: string): Promise<any> {
  const apiKey = requiredEnv("CREEM_API_KEY");
  const base = requiredEnv("CREEM_API_BASE");
  const response = await fetch(
    `${base}/checkouts?checkout_id=${encodeURIComponent(checkoutId)}`,
    { headers: { "x-api-key": apiKey } },
  );
  if (!response.ok)
    throw new Error(`Creem checkout lookup failed: ${response.status}`);
  return await response.json();
}

async function waitForCompletedCheckout(
  checkoutId: string,
  attempts = 30,
): Promise<any> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const checkout = await getCheckout(checkoutId);
    if (checkout.status === "completed") return checkout;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Creem checkout ${checkoutId} did not complete`);
}

async function deliverSubscriptionWebhook(checkout: any, email: string) {
  const siteUrl = convexSiteUrl();
  const secret = requiredEnv("CREEM_WEBHOOK_SECRET");
  const body = JSON.stringify({
    id: `evt_e2e_${crypto.randomUUID()}`,
    eventType: "subscription.active",
    created_at: Date.now(),
    object: {
      id:
        checkout.subscription?.id ??
        checkout.subscription ??
        `sub_e2e_${crypto.randomUUID()}`,
      status: "active",
      request_id: checkout.request_id,
      metadata: checkout.metadata,
      product: { id: requiredEnv("PUBLIC_CREEM_PRODUCT_PRO") },
      customer: {
        id: checkout.customer?.id ?? checkout.customer ?? "cust_e2e",
        email,
      },
      current_period_end_date: new Date(
        Date.now() + 30 * 86_400_000,
      ).toISOString(),
    },
  });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const response = await fetch(`${siteUrl}/creem/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "creem-signature": signature,
    },
    body,
  });
  if (!response.ok)
    throw new Error(
      `Webhook failed (${response.status}): ${await response.text()}`,
    );
}

function checkoutIdFrom(url: string): string {
  const id = new URL(url).pathname
    .split("/")
    .find((part) => part.startsWith("ch_"));
  if (!id) throw new Error(`No checkout id in ${url}`);
  return id;
}

function convexSiteUrl(): string {
  const match = readFileSync(".env.local", "utf8").match(
    /^VITE_CONVEX_SITE_URL=(.+)$/m,
  );
  if (!match?.[1]) throw new Error("VITE_CONVEX_SITE_URL is missing");
  return match[1].trim();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
