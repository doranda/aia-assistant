import { test, expect } from "@playwright/test";

test.describe("Team Management", () => {
  test("page loads with team list", async ({ page }) => {
    await page.goto("/team");
    await expect(page.locator("h1")).toContainText("Team");
    await page.waitForLoadState("domcontentloaded");
  });

  test("team members render", async ({ page }) => {
    await page.goto("/team");
    await page.waitForLoadState("domcontentloaded");

    // Team members show up with their names — look for known member or the test user
    const member = page.getByText("E2E Test Admin");
    await expect(member).toBeVisible({ timeout: 10_000 });
  });

  test("add member button visible for admin", async ({ page }) => {
    await page.goto("/team");
    await page.waitForLoadState("domcontentloaded");

    // Admin sees "Add Member" button
    const addButton = page.getByRole("button", { name: /add member/i });
    await expect(addButton).toBeVisible({ timeout: 5_000 });
  });
});
