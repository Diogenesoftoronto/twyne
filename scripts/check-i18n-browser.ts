import { chromium, expect } from "@playwright/test";

// Run against a local frontend with no persistent browser profile.
const baseURL = process.env.I18N_TEST_URL ?? "http://127.0.0.1:5187";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: "fr-CA" });
  const page = await context.newPage();
  const firstResponse = await page.goto(`${baseURL}/settings/`);
  expect(firstResponse?.status()).toBe(200);
  expect(await firstResponse!.text()).toContain("Le bureau de la rédaction");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(
    page.getByRole("heading", { name: "Langue", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Langue", exact: true }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Language", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The Editor’s Desk", exact: true }),
  ).toBeVisible();
  const englishResponse = await page.reload();
  expect(await englishResponse!.text()).toContain("The Editor’s Desk");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "Automatic", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Langue", exact: true }),
  ).toBeVisible();
  const englishContext = await browser.newContext({ locale: "en-US" });
  const englishPage = await englishContext.newPage();
  await englishPage.goto(`${baseURL}/settings/`);
  await expect(
    englishPage.getByRole("heading", { name: "Language", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(englishPage.locator("html")).toHaveAttribute("lang", "en");
  for (const [regional, locale, label, heading, title] of [
    ["es-MX", "es", "Español", "Idioma", "El escritorio editorial"],
    ["zh-CN", "zh", "简体中文", "语言", "编辑工作台"],
    ["hi-IN", "hi", "हिन्दी", "भाषा", "संपादक की मेज़"],
    ["ja-JP", "ja", "日本語", "言語", "編集デスク"],
  ]) {
    const localized = await browser.newContext({ locale: regional });
    const localizedPage = await localized.newPage();
    const response = await localizedPage.goto(`${baseURL}/settings/`);
    expect(response?.status()).toBe(200);
    expect(await response!.text()).toContain(title);
    await expect(
      localizedPage.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(localizedPage.locator("html")).toHaveAttribute("lang", locale);
    await localized.close();

    await englishPage
      .getByRole("button", { name: "Language", exact: true })
      .click();
    await englishPage.getByRole("option", { name: label, exact: true }).click();
    await expect(
      englishPage.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(englishPage.locator("html")).toHaveAttribute("lang", locale);
    const persisted = await englishPage.reload();
    expect(await persisted!.text()).toContain(title);
    await expect(
      englishPage.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await englishPage
      .getByRole("button", { name: heading, exact: true })
      .click();
    await englishPage
      .getByRole("option", { name: "English", exact: true })
      .click();
    await expect(
      englishPage.getByRole("heading", { name: "Language", exact: true }),
    ).toBeVisible();
  }
  console.log(
    "PASS: Six languages, regional browser detection, translated SSR, live Settings switching, persisted overrides, Automatic restore, isolated contexts.",
  );
} finally {
  await browser.close();
}
