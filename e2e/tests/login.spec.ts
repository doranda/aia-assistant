import { test, expect } from "@playwright/test";

// Login tests run WITHOUT stored auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login Page", () => {
  test("renders login form", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login**");
    await expect(page.locator("#email")).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.locator("#email").fill("fake@nonexistent.com");
    await page.locator("#password").fill("wrongpassword123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should show an error message and stay on login page
    await expect(page.getByText(/invalid|error|incorrect/i)).toBeVisible({ timeout: 10_000 });
  });
});
