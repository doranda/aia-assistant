// src/app/api/cron/reconcile-prices/route.ts
// Reconciliation cron: finds executed switches where NAVs have been published,
// computes final settlement math, and transitions them to settled.
//
// Schedule: daily, after price scrapers have run.
// Auth: Bearer CRON_SECRET

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getExactNav, getClosestNav, type Product } from "@/lib/portfolio/nav-lookup";
import { reconcileSwitch } from "@/lib/portfolio/reconcile";
import { loadHKHolidays } from "@/lib/portfolio/business-days";
import type { ProductType } from "@/lib/portfolio/state-gate";
import { promoteSignals } from "@/lib/agents/signal-promoter";

export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FundAllocation {
  code: string;
  weight: number;
}

interface ExecutedRow {
  id: string;
  status: string;
  old_allocation: FundAllocation[];
  new_allocation: FundAllocation[];
  sell_date: string;
  settlement_date: string;
  executed_at: string;
  sell_nav_total: number | null;
  portfolio_type?: string; // ILAS only
}

interface ReconcileOutcome {
  rowId: string;
  product: ProductType;
  sellTotal: number;
  buyTotal: number;
  cashDragDays: number;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (
    !cronSecret ||
    req.headers.get("authorization") !== `Bearer ${cronSecret}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t0 = Date.now();
  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();
  const holidaySet = new Set(
    Array.from(holidays).map((d) =>
      typeof d === "string" ? d : (d as Date).toISOString().split("T")[0],
    ),
  );

  const reconciled: ReconcileOutcome[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  // -------------------------------------------------------------------------
  // Process both MPF and ILAS
  // -------------------------------------------------------------------------
  for (const product of ["mpf", "ilas"] as const) {
    const table =
      product === "mpf" ? "mpf_pending_switches" : "ilas_portfolio_orders";

    const { data: rows, error: fetchErr } = await supabase
      .from(table)
      .select("*")
      .eq("status", "executed")
      .is("reconciled_at", null)
      .order("executed_at", { ascending: true });

    if (fetchErr) {
      errors.push(`${product}: fetch error: ${fetchErr.message}`);
      continue;
    }

    if (!rows || rows.length === 0) continue;

    for (const row of rows as ExecutedRow[]) {
      try {
        const outcome = await reconcileRow(
          row,
          product,
          table,
          holidaySet,
          supabase,
        );
        if (outcome) {
          reconciled.push(outcome);
        } else {
          skipped.push(`${row.id}: NAVs not yet available`);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown reconcile error";
        errors.push(`${row.id}: ${msg}`);
        console.error(`[reconcile-prices] Error on ${row.id}:`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Promote agent signals for reconciled users
  // -------------------------------------------------------------------------
  // Switch tables are single-tenant (no user_id column). Agent signals have
  // user_id, so we promote for ALL users with pending signals after any
  // reconciliation happens. This is safe because promoteSignals only touches
  // signals that pass freshness + confidence gates.
  if (reconciled.length > 0) {
    for (const product of ["mpf", "ilas"] as const) {
      const hadReconciled = reconciled.some((r) => r.product === product);
      if (!hadReconciled) continue;

      // Fetch distinct user_ids with pending signals for this product
      const { data: signalUsers } = await supabase
        .from("agent_signals")
        .select("user_id")
        .eq("product_type", product)
        .eq("status", "pending");

      const uniqueUserIds = [
        ...new Set((signalUsers ?? []).map((s) => s.user_id as string)),
      ];

      for (const userId of uniqueUserIds) {
        try {
          await promoteSignals(userId, product);
        } catch (err) {
          console.error(
            `[reconcile-prices] Signal promotion failed for ${userId}/${product}:`,
            err,
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Log heartbeat
  // -------------------------------------------------------------------------
  const { error: runLogErr } = await supabase.from("scraper_runs").insert({
    scraper_name: "reconcile_prices",
    status: errors.length > 0 ? "partial" : "success",
    records_processed: reconciled.length,
    duration_ms: Date.now() - t0,
    error_message:
      errors.length > 0 ? errors.slice(0, 5).join("; ") : undefined,
  });
  if (runLogErr)
    console.error("[reconcile-prices] Failed to log run:", runLogErr);

  return NextResponse.json({
    ok: true,
    reconciled: reconciled.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { reconciled, skipped, errors: errors.slice(0, 10) },
    ms: Date.now() - t0,
  });
}

// ---------------------------------------------------------------------------
// reconcileRow — reconcile a single executed switch/order
// ---------------------------------------------------------------------------

async function reconcileRow(
  row: ExecutedRow,
  product: Product,
  table: string,
  holidays: Set<string>,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<ReconcileOutcome | null> {
  const oldAlloc = row.old_allocation ?? [];
  const newAlloc = row.new_allocation ?? [];

  // Step 1: Check if ALL NAVs are available
  // Sell funds need NAV on sell_date, buy funds need NAV on settlement_date
  const sellNavs: Map<string, number> = new Map();
  for (const fund of oldAlloc) {
    if (fund.weight <= 0) continue;
    const nav = await getExactNav(product, fund.code, row.sell_date);
    if (nav === null) return null; // NAV not yet published
    sellNavs.set(fund.code, nav);
  }

  const buyNavs: Map<string, number> = new Map();
  for (const fund of newAlloc) {
    if (fund.weight <= 0) continue;
    const nav = await getExactNav(product, fund.code, row.settlement_date);
    if (nav === null) return null; // NAV not yet published
    buyNavs.set(fund.code, nav);
  }

  // Step 2: Compute sell total
  // Legacy rows have sell_nav_total pre-computed by the old settlement path.
  // New-era optimistic rows do NOT — we must compute from portfolio holdings.
  let sellTotal = 0;

  if (row.sell_nav_total != null && row.sell_nav_total > 0) {
    // Legacy path: pre-computed sell total available
    sellTotal = row.sell_nav_total;
  } else {
    // New-era path: compute sell total from portfolio NAV holdings × sell NAVs.
    // This mirrors the legacy processSettlements logic that reads from
    // mpf_portfolio_nav.holdings (or ilas_portfolio_nav.holdings).
    const navTable = product === "mpf" ? "mpf_portfolio_nav" : "ilas_portfolio_nav";
    // ILAS NAV table is keyed by (date, portfolio_type) — must scope to avoid wrong sleeve
    let navQuery = supabase
      .from(navTable)
      .select("nav, holdings, is_cash")
      .eq("date", row.sell_date);
    if (product === "ilas" && row.portfolio_type) {
      navQuery = navQuery.eq("portfolio_type", row.portfolio_type);
    }
    const { data: navRow } = await navQuery.limit(1).maybeSingle();

    if (!navRow) {
      // Try fallback: most recent row before sell date
      let fallbackQuery = supabase
        .from(navTable)
        .select("nav, holdings, is_cash")
        .lte("date", row.sell_date);
      if (product === "ilas" && row.portfolio_type) {
        fallbackQuery = fallbackQuery.eq("portfolio_type", row.portfolio_type);
      }
      const { data: fallback } = await fallbackQuery
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fallback) {
        console.warn(`[reconcile-prices] Row ${row.id}: no portfolio NAV data for sell_date ${row.sell_date}, skipping`);
        return null;
      }

      if (fallback.is_cash || !fallback.holdings || (fallback.holdings as any[]).length === 0) {
        sellTotal = Number(fallback.nav) || 0;
      } else {
        for (const h of fallback.holdings as Array<{ code: string; units: number }>) {
          const nav = await getExactNav(product, h.code, row.sell_date);
          const fallbackNav = nav ?? await getClosestNav(product, h.code, row.sell_date);
          sellTotal += h.units * (fallbackNav || 0);
        }
      }
    } else if (navRow.is_cash || !navRow.holdings || (navRow.holdings as any[]).length === 0) {
      sellTotal = Number(navRow.nav) || 0;
    } else {
      for (const h of navRow.holdings as Array<{ code: string; units: number }>) {
        const nav = await getExactNav(product, h.code, row.sell_date);
        const fallbackNav = nav ?? await getClosestNav(product, h.code, row.sell_date);
        sellTotal += h.units * (fallbackNav || 0);
      }
    }

    if (sellTotal <= 0) {
      console.warn(`[reconcile-prices] Row ${row.id}: computed sell_nav_total is ${sellTotal}, skipping`);
      return null;
    }
  }

  // Step 3: Run reconcileSwitch for each sell→buy pair
  // We pair the first sell fund with each buy fund weighted by allocation.
  // This matches the existing settlement pattern.
  const sellFundCode = oldAlloc.find((f) => f.weight > 0)?.code ?? "CASH";
  let totalBuyNavTotal = 0;
  let totalCashDragDays = 0;

  for (const buyFund of newAlloc) {
    if (buyFund.weight <= 0) continue;
    const buyNav = buyNavs.get(buyFund.code);
    const sellNav = sellNavs.values().next().value;
    if (!buyNav || !sellNav) continue;

    // Allocate proportional sell units
    const fundCashAlloc = sellTotal * (buyFund.weight / 100);
    const sellUnitsForLeg = fundCashAlloc / sellNav;

    const result = reconcileSwitch({
      sellFundCode,
      buyFundCode: buyFund.code,
      sellDate: row.sell_date,
      settlementDate: row.settlement_date,
      sellUnits: sellUnitsForLeg,
      sellNav,
      buyNav,
      holidays,
    });

    totalBuyNavTotal += result.buyNavTotal;
    totalCashDragDays = result.cashDragDays; // same for all legs
  }

  // Step 4: Update row → settled (with optimistic lock on status)
  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from(table)
    .update({
      status: "settled",
      settled_at: now,
      reconciled_at: now,
      sell_nav_total: sellTotal,
      buy_nav_total: totalBuyNavTotal,
    })
    .eq("id", row.id)
    .eq("status", "executed")  // defense: prevents double-settle on concurrent cron
    .select("id");

  if (updateErr) {
    throw new Error(
      `Failed to settle row ${row.id}: ${updateErr.message}`,
    );
  }

  if (!updated || updated.length === 0) {
    // Another invocation already settled this row — skip audit + return
    console.log(`[reconcile-prices] Row ${row.id} already settled by another invocation, skipping`);
    return null;
  }

  // Step 5: Write state_transitions audit row
  const { error: auditErr } = await supabase
    .from("state_transitions")
    .insert({
      table_name: table,
      row_id: row.id,
      from_status: "executed",
      to_status: "settled",
      actor: "cron/reconcile-prices",
      payload: {
        sell_total: sellTotal,
        buy_total: totalBuyNavTotal,
        cash_drag_days: totalCashDragDays,
        sell_navs: Object.fromEntries(sellNavs),
        buy_navs: Object.fromEntries(buyNavs),
      },
    });

  if (auditErr) {
    // Non-fatal: log but don't fail the reconciliation
    console.error(
      `[reconcile-prices] Audit insert failed for ${row.id}:`,
      auditErr,
    );
  }

  return {
    rowId: row.id,
    product,
    sellTotal,
    buyTotal: totalBuyNavTotal,
    cashDragDays: totalCashDragDays,
  };
}
