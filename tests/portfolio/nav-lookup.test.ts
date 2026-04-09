import { describe, it, expect, vi, beforeEach } from "vitest";
import { getExactNav, getClosestNav } from "@/lib/portfolio/nav-lookup";

// ---- Supabase admin mock ----
const mockSingle = vi.fn();
const mockLimit = vi.fn(() => ({ single: mockSingle }));
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
const mockLte = vi.fn(() => ({ order: mockOrder }));
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

beforeEach(() => {
  vi.clearAllMocks();

  // Default chain: from → select → eq (chainable) → single
  // We override per test below
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  // mockEq is used for both fund lookup and price lookup — see per-test setup
});

// ---------------------------------------------------------------------------
// Helpers to wire up the two-step Supabase chain for a given product
// ---------------------------------------------------------------------------

function setupFundFound(id = "fund-uuid-1") {
  // First call to .eq(...) returns { single } for fund lookup
  // Second call chains into eq for price lookup
  const fundChain = {
    single: mockSingle,
    eq: vi.fn().mockReturnValue({ single: mockSingle }),
  };
  mockEq.mockReturnValueOnce(fundChain); // fund_code eq
  // For exact nav: second eq call comes from fund_id + date eq
  const priceChain = {
    single: mockSingle,
  };
  mockEq.mockReturnValueOnce({ eq: vi.fn().mockReturnValue(priceChain) }); // fund_id eq (chains to date eq)

  // Separate select calls: fund select returns eq-chain; price select returns eq-chain
  mockSelect
    .mockReturnValueOnce({ eq: mockEq }) // fund select → eq
    .mockReturnValueOnce({ eq: mockEq }); // price select → eq

  mockSingle.mockResolvedValueOnce({ data: { id }, error: null }); // fund result
}

function setupFundNotFound() {
  mockSingle.mockResolvedValueOnce({ data: null, error: { message: "not found" } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getExactNav", () => {
  it("returns the NAV when an exact date match exists", async () => {
    // Fund lookup
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValueOnce({ data: { id: "f1" }, error: null }) }),
      })
      // Price lookup
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValueOnce({ data: { nav: "12.3456" }, error: null }) }),
        }),
      });

    const result = await getExactNav("mpf", "FUND_A", "2024-03-01");
    expect(result).toBe(12.3456);
  });

  it("returns null when exact date does NOT exist (no fallback)", async () => {
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValueOnce({ data: { id: "f1" }, error: null }) }),
      })
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } }),
          }),
        }),
      });

    const result = await getExactNav("mpf", "FUND_A", "2024-03-01");
    expect(result).toBeNull();
  });

  it("returns null when fund is not found", async () => {
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValueOnce({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValueOnce({ data: null, error: { message: "not found" } }),
      }),
    });

    const result = await getExactNav("ilas", "UNKNOWN_FUND", "2024-03-01");
    expect(result).toBeNull();
  });
});

describe("getClosestNav", () => {
  it("returns the nearest earlier NAV when an exact date is not available", async () => {
    // Fund lookup
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValueOnce({ data: { id: "f2" }, error: null }),
        }),
      })
      // Price lookup uses lte/order/limit/single chain
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValueOnce({ data: { nav: "11.1111" }, error: null }),
              }),
            }),
          }),
        }),
      });

    const result = await getClosestNav("mpf", "FUND_A", "2024-03-05");
    expect(result).toBe(11.1111);
  });

  it("returns null when no prices exist at or before the date", async () => {
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValueOnce({ data: { id: "f2" }, error: null }),
        }),
      })
      .mockReturnValueOnce({
        eq: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValueOnce({ data: null, error: { code: "PGRST116" } }),
              }),
            }),
          }),
        }),
      });

    const result = await getClosestNav("ilas", "FUND_B", "2020-01-01");
    expect(result).toBeNull();
  });
});
