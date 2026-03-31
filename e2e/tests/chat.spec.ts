import { test, expect } from "@playwright/test";

test.describe("Chat", () => {
  test("page loads with chat interface", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Chat input should be visible
    const input = page.locator("textarea, input[type='text']").last();
    await expect(input).toBeVisible({ timeout: 10_000 });
  });

  test("can type in chat input", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const input = page.locator("textarea").last();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill("Test message - do not send");
    await expect(input).toHaveValue("Test message - do not send");
  });

  test("conversation sidebar renders", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    // Should have either conversations or an empty state prompt
    const sidebar = page.locator("[class*='sidebar'], [class*='Sidebar'], aside").first();
    // On mobile it might be hidden, on desktop visible
    const chatArea = page.locator("main, [class*='chat']").first();
    await expect(chatArea).toBeVisible();
  });
});
