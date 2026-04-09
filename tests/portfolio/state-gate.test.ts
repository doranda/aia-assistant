// tests/portfolio/state-gate.test.ts
// Unit tests for PortfolioStateGate — product-scoped settlement gate
// Schema note: mpf_pending_switches and ilas_portfolio_orders have NO user_id column.
// This is a single-tenant advisory system. userId param accepted for API compat, not used in queries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PortfolioStateGateImpl } from "@/lib/portfolio/state-gate";

// ---- Mock loadHKHolidays ----
vi.mock("@/lib/portfolio/business-days", () => ({
  loadHKHolidays: vi.fn().mockResolvedValue(new Set<string>()),
  bizDaysBetween: vi.fn((from: string, to: string, _holidays: Set<string>) => {
    // Simple biz-day counter for tests: counts Mon–Fri calendar days (no holidays)
    let count = 0;
    let cursor = from;
    while (cursor < to) {
      const d = new Date(cursor + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      cursor = d.toISOString().split("T")[0];
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) count++;
    }
    return count;
  }),
  addWorkingDays: vi.fn((start: string, days: number, _holidays: Set<string>) => {
    let current = start;
    let added = 0;
    while (added < days) {
      const d = new Date(current + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      current = d.toISOString().split("T")[0];
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) added++;
    }
    return current;
  }),
}));

// ---- Supabase admin mock ----
const mockData = vi.fn();
const mockOrder = vi.fn();
const mockIsNull = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mockFrom }),
}));

// Helper: date string N calendar days ago
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

// Helper: date string N biz days ago (approx — Mon-Fri only, ignores holidays)
function bizDaysAgo(n: number): string {
  let remaining = n;
  const d = new Date();
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d.toISOString().split("T")[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Chain builder helpers ----

// Builds a mock chain: from(table).select(cols).eq(col,val).is(col,null).order(col)
// Returns { data, error } at the end.
function buildExecutedRowsChain(rows: object[]) {
  const dataResult = { data: rows, error: null };
  const orderMock = vi.fn().mockResolvedValue(dataResult);
  const isMock = vi.fn().mockReturnValue({ order: orderMock });
  const eqMock = vi.fn().mockReturnValue({ is: isMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { selectMock, eqMock, isMock, orderMock };
}

// Builds a chain for frequencyCheck: from(table).select(cols).eq(status,settled).order().limit()
// Implementation now fetches up to 10 rows (not .single()), so limit() resolves the chain.
function buildFreqChain(row: object | null) {
  const rows = row ? [row] : [];
  const dataResult = { data: rows, error: null };
  const limitMock = vi.fn().mockResolvedValue(dataResult);
  const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
  const eqMock = vi.fn().mockReturnValue({ order: orderMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
  return { selectMock, eqMock, orderMock, limitMock };
}

// ============================================================
// TEST SUITE
// ============================================================

describe("PortfolioStateGate", () => {
  const gate = new PortfolioStateGateImpl();
  const userId = "user-test-uuid";

  // ----------------------------------------------------------
  // Test 1: Allows MPF action when no executed rows
  // ----------------------------------------------------------
  it("allows MPF action when no executed rows exist", async () => {
    const chain = buildExecutedRowsChain([]);
    mockFrom.mockReturnValue({ select: chain.selectMock });

    const result = await gate.canAct(userId, "mpf");

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // ----------------------------------------------------------
  // Test 2: Blocks MPF action when MPF has executed rows (recent — awaiting_reconciliation)
  // ----------------------------------------------------------
  it("blocks MPF action when executed rows exist (awaiting_reconciliation)", async () => {
    const executedAt = new Date(daysAgo(3) + "T10:00:00Z").toISOString();
    const chain = buildExecutedRowsChain([
      { id: "row-1", executed_at: executedAt, old_allocation: [{ code: "MPF001", weight: 100 }], new_allocation: [{ code: "MPF002", weight: 100 }] },
    ]);
    mockFrom.mockReturnValue({ select: chain.selectMock });

    const result = await gate.canAct(userId, "mpf");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason!.type).toBe("awaiting_reconciliation");
    if (result.reason!.type === "awaiting_reconciliation") {
      expect(result.reason!.productType).toBe("mpf");
      expect(result.reason!.executedFunds.length).toBeGreaterThan(0);
      expect(result.reason!.estReady).toBeInstanceOf(Date);
    }
  });

  // ----------------------------------------------------------
  // Test 3: ILAS gap does NOT block MPF (product-scoped)
  // ----------------------------------------------------------
  it("ILAS executed rows do NOT block MPF canAct", async () => {
    // MPF: no executed rows
    const mpfChain = buildExecutedRowsChain([]);
    mockFrom.mockReturnValue({ select: mpfChain.selectMock });

    // Even though ILAS would have executed rows, we only query MPF for MPF check
    const result = await gate.canAct(userId, "mpf");

    expect(result.allowed).toBe(true);
    // Verify only mpf table was queried
    expect(mockFrom).toHaveBeenCalledWith("mpf_pending_switches");
    expect(mockFrom).not.toHaveBeenCalledWith("ilas_portfolio_orders");
  });

  // ----------------------------------------------------------
  // Test 4: Returns reconciliation_overdue when 10+ biz days elapsed
  // ----------------------------------------------------------
  it("returns reconciliation_overdue when executed_at is 10+ biz days ago", async () => {
    // Use 14 calendar days ago — conservatively over 10 biz days
    const executedAt = new Date(daysAgo(14) + "T10:00:00Z").toISOString();
    const chain = buildExecutedRowsChain([
      { id: "row-1", executed_at: executedAt, old_allocation: [{ code: "MPF001", weight: 100 }], new_allocation: [{ code: "MPF002", weight: 100 }] },
    ]);
    mockFrom.mockReturnValue({ select: chain.selectMock });

    const result = await gate.canAct(userId, "mpf");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason!.type).toBe("reconciliation_overdue");
    if (result.reason!.type === "reconciliation_overdue") {
      expect(result.reason!.productType).toBe("mpf");
      expect(result.reason!.daysOverdue).toBeGreaterThan(0);
    }
  });

  // ----------------------------------------------------------
  // Test 5: frequencyCheck blocks within 10 biz day floor
  // ----------------------------------------------------------
  it("frequencyCheck blocks within 10 biz day floor", async () => {
    // Most recent settled row is only 3 biz days ago
    const settledAt = new Date(bizDaysAgo(3) + "T10:00:00Z").toISOString();

    // MPF row includes allocation data so fund code "MPF001" is found
    const chain1 = buildFreqChain({
      settled_at: settledAt,
      old_allocation: [{ code: "MPF001", weight: 100 }],
      new_allocation: [{ code: "MPF002", weight: 100 }],
    });
    const chain2 = buildFreqChain(null); // ILAS returns nothing

    mockFrom
      .mockReturnValueOnce({ select: chain1.selectMock })  // mpf
      .mockReturnValueOnce({ select: chain2.selectMock }); // ilas

    const result = await gate.frequencyCheck("MPF001", userId);

    expect(result.allowed).toBe(false);
    expect(result.nextEligibleDate).toBeInstanceOf(Date);
    // nextEligibleDate should be in the future
    expect(result.nextEligibleDate!.getTime()).toBeGreaterThan(Date.now());
  });

  // ----------------------------------------------------------
  // Test 6: frequencyCheck allows after 10 biz days
  // ----------------------------------------------------------
  it("frequencyCheck allows after 10 biz day floor", async () => {
    // Most recent settled row is 12 biz days ago (> 10 bd floor)
    const settledAt = new Date(bizDaysAgo(12) + "T10:00:00Z").toISOString();

    const chain1 = buildFreqChain({
      settled_at: settledAt,
      old_allocation: [{ code: "MPF001", weight: 100 }],
      new_allocation: [{ code: "MPF002", weight: 100 }],
    });
    const chain2 = buildFreqChain(null);

    mockFrom
      .mockReturnValueOnce({ select: chain1.selectMock })
      .mockReturnValueOnce({ select: chain2.selectMock });

    const result = await gate.frequencyCheck("MPF001", userId);

    expect(result.allowed).toBe(true);
    expect(result.nextEligibleDate).toBeUndefined();
  });

  // ----------------------------------------------------------
  // currentState snapshot test
  // ----------------------------------------------------------
  it("currentState returns correct snapshot with executed rows", async () => {
    const executedAt = new Date(daysAgo(3) + "T10:00:00Z").toISOString();
    const chain = buildExecutedRowsChain([
      { id: "row-1", executed_at: executedAt, old_allocation: [{ code: "MPF001", weight: 100 }], new_allocation: [{ code: "MPF002", weight: 100 }] },
    ]);
    mockFrom.mockReturnValue({ select: chain.selectMock });

    const state = await gate.currentState(userId, "mpf");

    expect(state.hasExecutedRows).toBe(true);
    expect(state.executedFunds.length).toBeGreaterThan(0);
    expect(state.oldestExecutedAt).toBeInstanceOf(Date);
    expect(state.estimatedSettledAt).toBeInstanceOf(Date);
    expect(state.reconciliationOverdue).toBe(false);
  });

  // ----------------------------------------------------------
  // currentState returns clean state when no executed rows
  // ----------------------------------------------------------
  it("currentState returns clean snapshot when no executed rows", async () => {
    const chain = buildExecutedRowsChain([]);
    mockFrom.mockReturnValue({ select: chain.selectMock });

    const state = await gate.currentState(userId, "mpf");

    expect(state.hasExecutedRows).toBe(false);
    expect(state.executedFunds).toHaveLength(0);
    expect(state.oldestExecutedAt).toBeNull();
    expect(state.estimatedSettledAt).toBeNull();
    expect(state.reconciliationOverdue).toBe(false);
  });

  // ----------------------------------------------------------
  // reasonIfBlocked returns null when no block
  // ----------------------------------------------------------
  it("reasonIfBlocked returns null when action is allowed", async () => {
    const chain = buildExecutedRowsChain([]);
    mockFrom.mockReturnValue({ select: chain.selectMock });

    const reason = await gate.reasonIfBlocked(userId, "mpf");
    expect(reason).toBeNull();
  });

  // ----------------------------------------------------------
  // reasonIfBlocked returns reason when blocked
  // ----------------------------------------------------------
  it("reasonIfBlocked returns awaiting_reconciliation reason when blocked", async () => {
    const executedAt = new Date(daysAgo(3) + "T10:00:00Z").toISOString();
    const chain = buildExecutedRowsChain([
      { id: "row-1", executed_at: executedAt, old_allocation: [{ code: "MPF001", weight: 100 }], new_allocation: [{ code: "MPF002", weight: 100 }] },
    ]);
    mockFrom.mockReturnValue({ select: chain.selectMock });

    const reason = await gate.reasonIfBlocked(userId, "mpf");
    expect(reason).not.toBeNull();
    expect(reason!.type).toBe("awaiting_reconciliation");
  });
});
