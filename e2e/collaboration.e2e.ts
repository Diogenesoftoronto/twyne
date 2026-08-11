import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const INITIAL_FIRST = "The shared opening belongs to both writers.";
const INITIAL_SECOND = "The second paragraph leaves room for another hand.";

test("share, invite, join, concurrent edits, and cursor presence", async ({
  browser,
}) => {
  test.skip(
    process.env.COLLABORATION_E2E !== "true",
    "Requires the test deployment's OTP and signed-webhook environment",
  );

  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const ownerEmail = `collab-owner-${runId}@twyne.love`;
  const inviteeEmail = `collab-invitee-${runId}@twyne.love`;
  const ownerContext = await collaborationContext(browser);
  const inviteeContext = await collaborationContext(browser);
  const owner = await ownerContext.newPage();
  const invitee = await inviteeContext.newPage();

  try {
    // The invite lookup resolves registered users by email, so establish two
    // independent accounts before the owner sends it.
    await Promise.all([
      signUpWithOtp(owner, ownerEmail),
      signUpWithOtp(invitee, inviteeEmail),
    ]);
    await grantProEntitlement(owner, ownerEmail);

    const folioId = `e2e-collaboration-${Date.now()}`;
    await seedFolio(
      owner,
      folioId,
      `<p>${INITIAL_FIRST}</p><p>${INITIAL_SECOND}</p>`,
    );
    await owner.goto("/editor/");
    await expect(owner.locator(".ProseMirror")).toContainText(INITIAL_FIRST, {
      timeout: 20_000,
    });

    await test.step("share the exact live manuscript and invite a second writer", async () => {
      await owner.getByRole("button", { name: "Share", exact: true }).click();
      await owner
        .getByRole("button", { name: "Share this folio", exact: true })
        .click();
      await expect(
        owner.getByRole("button", { name: "Copy invite link" }),
      ).toBeVisible({ timeout: 30_000 });

      await owner.getByPlaceholder("email@example.com").fill(inviteeEmail);
      await owner.getByRole("button", { name: "Invite", exact: true }).click();
      await expect(owner.getByText(new RegExp(inviteeEmail, "i"))).toBeVisible({
        timeout: 20_000,
      });

      await owner.getByRole("button", { name: "Copy invite link" }).click();
      const inviteUrl = await owner.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(inviteUrl).toMatch(/\/editor\?shared=/);
      await invitee.goto(inviteUrl);
    });

    await test.step("join into the shared singleton with the seeded manuscript", async () => {
      const manuscript = invitee.locator(".ProseMirror");
      await expect(manuscript).toContainText(INITIAL_FIRST, {
        timeout: 30_000,
      });
      await expect(manuscript).toContainText(INITIAL_SECOND);
    });

    await test.step("merge concurrent edits made in separate blocks", async () => {
      const ownerAddition = " Owner adds a northbound note.";
      const inviteeAddition = " Invitee adds a southbound note.";
      await Promise.all([
        appendToParagraph(owner, 0, ownerAddition),
        appendToParagraph(invitee, 1, inviteeAddition),
      ]);

      for (const page of [owner, invitee]) {
        await expect(page.locator(".ProseMirror")).toContainText(
          ownerAddition,
          {
            timeout: 30_000,
          },
        );
        await expect(page.locator(".ProseMirror")).toContainText(
          inviteeAddition,
          { timeout: 30_000 },
        );
      }
    });

    await test.step("show the invitee cursor in the owner's editor", async () => {
      const inviteeParagraph = invitee.locator(".ProseMirror > p").nth(1);
      await inviteeParagraph.click();
      await invitee.keyboard.press("End");
      await invitee.keyboard.press("Shift+ArrowLeft");

      await expect(
        owner.locator(
          `.remote-cursor[data-collaborator="${cssEscape(inviteeEmail)}"]`,
        ),
      ).toBeVisible({ timeout: 20_000 });
    });
  } finally {
    await Promise.all([ownerContext.close(), inviteeContext.close()]);
  }
});

async function collaborationContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
}

async function signUpWithOtp(page: Page, email: string): Promise<void> {
  await page.goto("/signin/");
  await page.getByRole("button", { name: "Create an account" }).click();
  const requestedAfter = Date.now();
  await page.getByLabel(/Email address/).fill(email);
  await page.getByRole("button", { name: "Create account →" }).click();
  const otp = await pollOtp(email, requestedAfter);
  await page.getByLabel("Verification code").fill(otp);
  await page.getByRole("button", { name: "Verify & sign in" }).click();
  await expect(page.getByText("You're in")).toBeVisible({ timeout: 30_000 });
}

async function grantProEntitlement(page: Page, email: string): Promise<void> {
  const siteUrl = convexSiteUrl();
  const token = await page.evaluate(async (baseUrl) => {
    const stored = JSON.parse(
      localStorage.getItem("better-auth_cookie") ?? "{}",
    ) as Record<string, { value: string; expires: string | null }>;
    const now = Date.now();
    const cookie = Object.entries(stored)
      .filter(([, value]) => !value.expires || Date.parse(value.expires) >= now)
      .map(([key, value]) => `${key}=${value.value}`)
      .join("; ");
    const response = await fetch(`${baseUrl}/api/auth/convex/token`, {
      credentials: "omit",
      headers: { "Better-Auth-Cookie": cookie },
    });
    if (!response.ok) {
      throw new Error(`Convex token request failed: ${response.status}`);
    }
    const body = (await response.json()) as { token?: string };
    if (!body.token) throw new Error("Convex token response was empty");
    return body.token;
  }, siteUrl);
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) throw new Error("Convex token was not a JWT");
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as { iss?: string; sub?: string };
  if (!payload.iss || !payload.sub) {
    throw new Error("Convex token did not identify its issuer and subject");
  }
  const userId = `${payload.iss}|${payload.sub}`;
  const body = JSON.stringify({
    id: `evt_collaboration_${crypto.randomUUID()}`,
    eventType: "subscription.active",
    created_at: Date.now(),
    object: {
      status: "active",
      metadata: { userId, email },
      product: { id: requiredEnv("PUBLIC_CREEM_PRODUCT_PRO") },
      customer: { email },
      subscription: {
        id: `sub_collaboration_${crypto.randomUUID()}`,
        status: "active",
        current_period_end_date: new Date(
          Date.now() + 30 * 86_400_000,
        ).toISOString(),
      },
    },
  });
  const signature = createHmac("sha256", requiredEnv("CREEM_WEBHOOK_SECRET"))
    .update(body)
    .digest("hex");
  const response = await fetch(`${siteUrl}/creem/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "creem-signature": signature,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(
      `Failed to grant the E2E owner Pro (${response.status}): ${await response.text()}`,
    );
  }
}

async function seedFolio(
  page: Page,
  folioId: string,
  html: string,
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    async ({ folioId, html }) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open("twyne", 3);
        req.onupgradeneeded = () => {
          const opened = req.result;
          for (const [name, keyPath] of [
            ["folios", "id"],
            ["folio-content", "folioId"],
            ["brief", "folioId"],
            ["comments", "id"],
            ["personas", "id"],
            ["meta", "key"],
            ["ai-settings", "key"],
            ["lix-blob", "key"],
            ["voice-notes", "id"],
            ["models", "id"],
          ] as const) {
            if (!opened.objectStoreNames.contains(name)) {
              opened.createObjectStore(name, { keyPath });
            }
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const now = Date.now();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(
          ["folios", "folio-content", "meta"],
          "readwrite",
        );
        transaction.objectStore("folios").put({
          id: folioId,
          name: "Two-browser collaboration fixture",
          type: "draft",
          createdAt: now,
          updatedAt: now,
          layout: { pagination: "continuous" },
        });
        transaction.objectStore("folio-content").put({
          folioId,
          html,
          updatedAt: now,
        });
        transaction.objectStore("meta").put({
          key: "active-folio-id",
          value: folioId,
          updatedAt: now,
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
    },
    { folioId, html },
  );
}

async function appendToParagraph(
  page: Page,
  paragraphIndex: number,
  text: string,
): Promise<void> {
  const paragraph = page.locator(".ProseMirror > p").nth(paragraphIndex);
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
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

function cssEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
