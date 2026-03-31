import { test, expect } from "@playwright/test";

test.describe("FAQs", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/faqs");
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForLoadState("domcontentloaded");
  });

  test("FAQ content renders", async ({ page }) => {
    await page.goto("/faqs");
    await page.waitForLoadState("domcontentloaded");

    // Should have FAQ sections or empty state
    const main = page.locator("main");
    await expect(main).toBeVisible();

    // Check for either FAQ items or section headings
    const sections = page.locator("section, h2");
    await expect(sections.first()).toBeVisible({ timeout: 10_000 });
  });
});
