import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MUST be declared before any import that uses the module.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

// Mock discord so side-effectful imports in portfolio-tracker don't blow up
vi.mock("@/lib/discord", () => ({
  sendDiscordAlert: vi.fn(),
  COLORS: {},
  sanitizeError: vi.fn((e: unknown) => String(e)),
}));

// Mock constants — only the values actually used by the file under test
vi.mock("@/lib/mpf/constants", () => ({
  SETTLEMENT_DAYS: 2,
  COOLDOWN_DAYS: 30,
  CUTOFF_HOUR_HKT: 15,
  GPF_MAX_SWITCHES_PER_YEAR: 4,
  LONG_WEEKEND_THRESHOLD_DAYS: 4,
  PORTFOLIO_BASE_NAV: 10,
  formatAllocation: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { loadHKHolidays, _resetHolidayCacheForTests } from "@/lib/mpf/portfolio-tracker";

const mockCreateAdminClient = vi.mocked(createAdminClient);

beforeEach(() => {
  _resetHolidayCacheForTests();
  vi.clearAllMocks();
});

describe("loadHKHolidays", () => {
  it("throws when Supabase returns an error (no silent empty set)", async () => {
    const fakeError = { message: "connection refused", code: "PGRST000" };
    mockCreateAdminClient.mockReturnValue({
      from: () => ({
        select: () => Promise.resolve({ data: null, error: fakeError }),
      }),
    } as any);

    await expect(loadHKHolidays()).rejects.toThrow("connection refused");
  });

  it("returns Set<string> when Supabase returns data", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: () => ({
        select: () =>
          Promise.resolve({
            data: [{ date: "2025-01-01" }, { date: "2025-04-04" }],
            error: null,
          }),
      }),
    } as any);

    const result = await loadHKHolidays();

    expect(result).toBeInstanceOf(Set);
    expect(result.has("2025-01-01")).toBe(true);
    expect(result.has("2025-04-04")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("caches the result after first call", async () => {
    const selectMock = vi.fn().mockResolvedValue({
      data: [{ date: "2025-01-01" }],
      error: null,
    });
    mockCreateAdminClient.mockReturnValue({
      from: () => ({ select: selectMock }),
    } as any);

    await loadHKHolidays();
    await loadHKHolidays();

    expect(selectMock).toHaveBeenCalledTimes(1);
  });
});
