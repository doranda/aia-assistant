import { test, expect } from "@playwright/test";

// API auth tests run WITHOUT stored auth state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("API Auth Gates", () => {
  test("health endpoint is public", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBeDefined();
  });

  test("cron endpoint rejects without secret", async ({ request }) => {
    const res = await request.get("/api/mpf/cron/prices");
    expect(res.status()).toBe(401);
  });

  test("cron endpoint rejects invalid secret", async ({ request }) => {
    const res = await request.get("/api/mpf/cron/prices", {
      headers: { Authorization: "Bearer invalid-token-xyz" },
    });
    expect(res.status()).toBe(401);
  });

  test("team endpoint requires auth", async ({ request }) => {
    const res = await request.post("/api/team", {
      data: { email: "test@test.com", role: "agent" },
    });
    // Should be 401 or redirect
    expect([401, 307, 302]).toContain(res.status());
  });

  test("FAQ endpoint requires auth", async ({ request }) => {
    const res = await request.get("/api/faq");
    expect([401, 307, 302]).toContain(res.status());
  });

  test("document endpoint requires auth", async ({ request }) => {
    const res = await request.delete("/api/documents", {
      data: { id: "nonexistent" },
    });
    expect([401, 307, 302]).toContain(res.status());
  });
});
