// tests/integration/reconcile-prices.test.ts
// Integration tests for the reconcile-prices cron route.
// These require a live Supabase instance with seeded data.
// Run with: npx vitest run tests/integration/

import { describe, it } from "vitest";

describe.skip("reconcile-prices cron", () => {
  // TODO: Seed mpf_pending_switches with status='executed', reconciled_at=NULL
  //       and matching price rows in mpf_prices for the sell_date and settlement_date.
  it("should reconcile an executed MPF switch when NAVs are available", () => {
    // TODO: Insert executed row with old_allocation=[{code:'FUND_A', weight:100}],
    //       new_allocation=[{code:'FUND_B', weight:100}], sell_date, settlement_date.
    //       Insert matching mpf_prices rows.
    //       Call GET /api/cron/reconcile-prices with Bearer CRON_SECRET.
    //       Assert row status='settled', reconciled_at set, state_transitions row exists.
  });

  it("should skip an executed row when sell NAV is missing", () => {
    // TODO: Insert executed row but NO mpf_prices row for sell_date.
    //       Call the cron. Assert row stays status='executed', reconciled_at=NULL.
  });

  it("should skip an executed row when buy NAV is missing", () => {
    // TODO: Insert executed row with sell_date prices but NO settlement_date prices.
    //       Call the cron. Assert row stays status='executed'.
  });

  it("should reconcile an executed ILAS order when NAVs are available", () => {
    // TODO: Same as MPF test but for ilas_portfolio_orders with portfolio_type='accumulation'.
  });

  it("should write a state_transitions audit row on successful reconciliation", () => {
    // TODO: After reconciliation, query state_transitions for the row_id.
    //       Assert from_status='executed', to_status='settled', actor='cron/reconcile-prices'.
  });

  it("should promote agent signals after reconciliation", () => {
    // TODO: Insert agent_signals with status='pending', high confidence, recent emitted_at.
    //       Reconcile a row. Assert signal status changed to 'promoted'.
  });

  it("should return 401 without CRON_SECRET", () => {
    // TODO: Call GET without authorization header. Assert 401.
  });

  it("should handle multiple executed rows in one run", () => {
    // TODO: Insert 3 executed rows (2 with available NAVs, 1 without).
    //       Assert 2 reconciled, 1 skipped.
  });
});
