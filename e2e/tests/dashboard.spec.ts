import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("page loads with stats", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");

    // Dashboard has "Key metrics" region with stat items
    const metrics = page.locator("section[aria-label='Key metrics'], [aria-label='Key metrics']");
    await expect(metrics).toBeVisible({ timeout: 10_000 });
  });

  test("navigation tabs work", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Nav uses tabs, not links
    await page.getByRole("tab", { name: /documents/i }).click();
    await page.waitForURL("**/documents");
    await expect(page.locator("h1")).toContainText("Documents");
  });

  test("no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("favicon")) {
        errors.push(msg.text());
      }
    });

    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    expect(errors).toEqual([]);
  });
});
