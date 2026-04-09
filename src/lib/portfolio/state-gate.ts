// src/lib/portfolio/state-gate.ts
// PortfolioStateGate — central source of truth for "can this action happen now?"
//
// Product-scoped: MPF gap does NOT block ILAS and vice versa.
//
// Schema notes:
//   - mpf_pending_switches: no user_id column (single-tenant system)
//   - ilas_portfolio_orders: no user_id column
//   - Fund codes live in old_allocation / new_allocation JSONB as [{code, weight}]
//   - Settled transaction legs live in mpf_portfolio_transactions.fund_code
//   - Both tables gained executed_at + reconciled_at in migration 018

import {
  loadHKHolidays,
  bizDaysBetween,
  addWorkingDays,
} from "@/lib/portfolio/business-days";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProductType = "mpf" | "ilas";

export type BlockReason =
  | {
      type: "awaiting_reconciliation";
      productType: ProductType;
      executedFunds: string[];
      estReady: Date;
    }
  | {
      type: "reconciliation_overdue";
      productType: ProductType;
      executedFunds: string[];
      daysOverdue: number;
    }
  | { type: "frequency_floor"; fundId: string; nextEligible: Date }
  | { type: "legacy_in_flight"; productType: ProductType; switchIds: string[] };

export interface PortfolioStateGate {
  canAct(
    userId: string,
    productType: ProductType,
  ): Promise<{ allowed: boolean; reason?: BlockReason }>;

  currentState(
    userId: string,
    productType: ProductType,
  ): Promise<{
    hasExecutedRows: boolean;
    executedFunds: string[];
    oldestExecutedAt: Date | null;
    estimatedSettledAt: Date | null;
    reconciliationOverdue: boolean;
  }>;

  frequencyCheck(
    fundCode: string,
    userId: string,
  ): Promise<{ allowed: boolean; nextEligibleDate?: Date }>;

  reasonIfBlocked(
    userId: string,
    productType: ProductType,
  ): Promise<BlockReason | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECONCILIATION_OVERDUE_BD = 10; // urgent tier: 10+ biz days without reconciliation
const RECONCILIATION_EXPECTED_BD = 6; // typical lag: estimated settlement in 6 biz days
const FREQUENCY_FLOOR_BD = 10; // min biz days between switches on the same fund

// ---------------------------------------------------------------------------
// Internal row types
// ---------------------------------------------------------------------------

interface ExecutedRow {
  id: string;
  executed_at: string; // ISO timestamp
  old_allocation: Array<{ code: string; weight: number }>;
  new_allocation: Array<{ code: string; weight: number }>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PortfolioStateGateImpl implements PortfolioStateGate {
  // -----------------------------------------------------------------------
  // canAct — primary gate check
  // -----------------------------------------------------------------------
  async canAct(
    _userId: string,
    productType: ProductType,
  ): Promise<{ allowed: boolean; reason?: BlockReason }> {
    const rows = await this.fetchExecutedRows(productType);

    if (rows.length === 0) {
      return { allowed: true };
    }

    const holidays = await loadHKHolidays();
    const today = new Date().toISOString().split("T")[0];

    // Find oldest executed_at
    const oldestRow = rows.reduce((oldest, row) => {
      return row.executed_at < oldest.executed_at ? row : oldest;
    }, rows[0]);

    const oldestDate = oldestRow.executed_at.split("T")[0];
    const bdElapsed = bizDaysBetween(oldestDate, today, holidays);

    const executedFunds = this.extractFundCodes(rows);

    if (bdElapsed >= RECONCILIATION_OVERDUE_BD) {
      const daysOverdue = bdElapsed - RECONCILIATION_EXPECTED_BD;
      return {
        allowed: false,
        reason: {
          type: "reconciliation_overdue",
          productType,
          executedFunds,
          daysOverdue,
        },
      };
    }

    // awaiting_reconciliation — within expected window
    const estReadyStr = addWorkingDays(
      oldestDate,
      RECONCILIATION_EXPECTED_BD,
      holidays,
    );
    const estReady = new Date(estReadyStr + "T00:00:00Z");

    return {
      allowed: false,
      reason: {
        type: "awaiting_reconciliation",
        productType,
        executedFunds,
        estReady,
      },
    };
  }

  // -----------------------------------------------------------------------
  // currentState — snapshot used by dashboard and agents
  // -----------------------------------------------------------------------
  async currentState(
    _userId: string,
    productType: ProductType,
  ): Promise<{
    hasExecutedRows: boolean;
    executedFunds: string[];
    oldestExecutedAt: Date | null;
    estimatedSettledAt: Date | null;
    reconciliationOverdue: boolean;
  }> {
    const rows = await this.fetchExecutedRows(productType);

    if (rows.length === 0) {
      return {
        hasExecutedRows: false,
        executedFunds: [],
        oldestExecutedAt: null,
        estimatedSettledAt: null,
        reconciliationOverdue: false,
      };
    }

    const holidays = await loadHKHolidays();
    const today = new Date().toISOString().split("T")[0];

    const oldestRow = rows.reduce((oldest, row) => {
      return row.executed_at < oldest.executed_at ? row : oldest;
    }, rows[0]);

    const oldestDate = oldestRow.executed_at.split("T")[0];
    const bdElapsed = bizDaysBetween(oldestDate, today, holidays);
    const estReadyStr = addWorkingDays(
      oldestDate,
      RECONCILIATION_EXPECTED_BD,
      holidays,
    );

    return {
      hasExecutedRows: true,
      executedFunds: this.extractFundCodes(rows),
      oldestExecutedAt: new Date(oldestRow.executed_at),
      estimatedSettledAt: new Date(estReadyStr + "T00:00:00Z"),
      reconciliationOverdue: bdElapsed >= RECONCILIATION_OVERDUE_BD,
    };
  }

  // -----------------------------------------------------------------------
  // frequencyCheck — min 10 biz days between switches on the same fund
  // Queries BOTH tables: takes the most recent settled row across MPF + ILAS
  // -----------------------------------------------------------------------
  async frequencyCheck(
    fundCode: string,
    _userId: string,
  ): Promise<{ allowed: boolean; nextEligibleDate?: Date }> {
    const holidays = await loadHKHolidays();
    const today = new Date().toISOString().split("T")[0];

    // Query MPF transactions for most recent settled row with this fund code
    const mpfSettled = await this.fetchMostRecentSettledMpf(fundCode);
    // Query ILAS orders for most recent settled row with this fund code
    const ilasSettled = await this.fetchMostRecentSettledIlas(fundCode);

    // Pick the more recent of the two
    const candidates = [mpfSettled, ilasSettled].filter(
      (d): d is string => d !== null,
    );

    if (candidates.length === 0) {
      // No prior switches on this fund — allowed
      return { allowed: true };
    }

    const mostRecent = candidates.reduce((a, b) => (a > b ? a : b));
    const bdSince = bizDaysBetween(mostRecent, today, holidays);

    if (bdSince >= FREQUENCY_FLOOR_BD) {
      return { allowed: true };
    }

    // Still within floor — return next eligible date
    const nextEligibleStr = addWorkingDays(
      mostRecent,
      FREQUENCY_FLOOR_BD,
      holidays,
    );
    return {
      allowed: false,
      nextEligibleDate: new Date(nextEligibleStr + "T00:00:00Z"),
    };
  }

  // -----------------------------------------------------------------------
  // reasonIfBlocked — convenience wrapper
  // -----------------------------------------------------------------------
  async reasonIfBlocked(
    userId: string,
    productType: ProductType,
  ): Promise<BlockReason | null> {
    const { allowed, reason } = await this.canAct(userId, productType);
    return allowed ? null : (reason ?? null);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private tableName(product: ProductType): string {
    return product === "mpf" ? "mpf_pending_switches" : "ilas_portfolio_orders";
  }

  private async fetchExecutedRows(
    productType: ProductType,
  ): Promise<ExecutedRow[]> {
    const db = createAdminClient();
    const table = this.tableName(productType);

    const { data, error } = await db
      .from(table)
      .select("id, executed_at, old_allocation, new_allocation")
      .eq("status", "executed")
      .is("reconciled_at", null)
      .order("executed_at", { ascending: true });

    if (error) {
      throw new Error(
        `PortfolioStateGate.fetchExecutedRows(${table}): ${error.message}`,
      );
    }

    return (data ?? []) as ExecutedRow[];
  }

  /** Extract unique fund codes from all_allocation JSONB across all rows */
  private extractFundCodes(rows: ExecutedRow[]): string[] {
    const codes = new Set<string>();
    for (const row of rows) {
      // Include both sell (old) and buy (new) fund codes
      for (const alloc of [...(row.old_allocation ?? []), ...(row.new_allocation ?? [])]) {
        if (alloc.code) codes.add(alloc.code);
      }
    }
    return Array.from(codes);
  }

  /**
   * MPF frequency check: query mpf_pending_switches for the most recent
   * settled row where old_allocation or new_allocation references this fund code.
   *
   * Fund codes are stored in JSONB columns (old_allocation / new_allocation) as [{code, weight}].
   * We fetch the most recent settled row and check in-process — avoids complex Postgrest JSONB ops.
   * Chain: from → select → eq(status, settled) → order → limit → single
   */
  private async fetchMostRecentSettledMpf(
    fundCode: string,
  ): Promise<string | null> {
    const db = createAdminClient();

    const { data, error } = await db
      .from("mpf_pending_switches")
      .select("settled_at, old_allocation, new_allocation")
      .eq("status", "settled")
      .order("settled_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;

    const row = data as {
      settled_at: string | null;
      old_allocation: Array<{ code: string; weight: number }>;
      new_allocation: Array<{ code: string; weight: number }>;
    };

    const allFunds = [
      ...(row.old_allocation ?? []),
      ...(row.new_allocation ?? []),
    ].map((a) => a.code);

    if (!allFunds.includes(fundCode)) return null;

    return row.settled_at ? row.settled_at.split("T")[0] : null;
  }

  /**
   * ILAS frequency check: query ilas_portfolio_orders for most recent settled
   * row where old_allocation or new_allocation contains this fund code.
   * Chain: from → select → eq(status, settled) → order → limit → single
   */
  private async fetchMostRecentSettledIlas(
    fundCode: string,
  ): Promise<string | null> {
    const db = createAdminClient();

    const { data, error } = await db
      .from("ilas_portfolio_orders")
      .select("reconciled_at, old_allocation, new_allocation")
      .eq("status", "settled")
      .order("reconciled_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;

    const row = data as {
      reconciled_at: string | null;
      old_allocation: Array<{ code: string; weight: number }>;
      new_allocation: Array<{ code: string; weight: number }>;
    };

    const allFunds = [
      ...(row.old_allocation ?? []),
      ...(row.new_allocation ?? []),
    ].map((a) => a.code);

    if (!allFunds.includes(fundCode)) return null;

    return row.reconciled_at ? row.reconciled_at.split("T")[0] : null;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------
export const portfolioStateGate = new PortfolioStateGateImpl();
