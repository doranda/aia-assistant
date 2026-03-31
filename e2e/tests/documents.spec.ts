import { test, expect } from "@playwright/test";

test.describe("Documents", () => {
  test("page loads with document table", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.locator("h1")).toContainText("Documents");

    // Table with documents should be visible
    const table = page.locator("table");
    await expect(table).toBeVisible({ timeout: 10_000 });

    const rows = table.locator("tbody tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test("upload zone is visible", async ({ page }) => {
    await page.goto("/documents");
    await page.waitForLoadState("domcontentloaded");

    // Upload is a clickable element with "Upload PDF" text
    const upload = page.getByText("Upload PDF");
    await expect(upload).toBeVisible({ timeout: 10_000 });
  });

  test("category filters present", async ({ page }) => {
    await page.goto("/documents");

    // Wait for table to load first, then check filters
    await expect(page.locator("table")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "All", exact: true })).toBeVisible();
  });
});
