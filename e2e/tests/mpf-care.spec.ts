import { test, expect } from "@playwright/test";

test.describe("MPF Care", () => {
  test("main page loads with fund data", async ({ page }) => {
    await page.goto("/mpf-care");
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Should have navigation tabs
    const nav = page.locator("nav, [role='tablist']").first();
    await expect(nav).toBeVisible({ timeout: 10_000 });
  });

  test("screener loads with fund table", async ({ page }) => {
    await page.goto("/mpf-care/screener");
    await page.waitForLoadState("networkidle");

    // Table should have fund rows
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 10_000 });

    const rows = table.locator("tbody tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("fund detail page loads", async ({ page }) => {
    // Navigate to screener first, then click a fund
    await page.goto("/mpf-care/screener");
    await page.waitForLoadState("networkidle");

    const firstFundLink = page.locator("table tbody tr a, table tbody tr [role='link']").first();
    if (await firstFundLink.isVisible().catch(() => false)) {
      await firstFundLink.click();
      await page.waitForLoadState("networkidle");
      // Fund detail should show fund name and chart area
      await expect(page.locator("h1")).toBeVisible();
    }
  });

  test("health dashboard loads", async ({ page }) => {
    await page.goto("/mpf-care/health");
    await expect(page.locator("h1")).toContainText(/health|pipeline/i);
    await page.waitForLoadState("networkidle");

    // Should have status cards
    const sections = page.locator("section");
    await expect(sections.first()).toBeVisible({ timeout: 10_000 });
  });

  test("insights page loads", async ({ page }) => {
    await page.goto("/mpf-care/insights");
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Should show insights or empty state
    const content = page.locator("main");
    await expect(content).toBeVisible();
  });

  test("news page loads", async ({ page }) => {
    await page.goto("/mpf-care/news");
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForLoadState("networkidle");
  });
});
