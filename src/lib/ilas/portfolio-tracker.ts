// src/lib/ilas/portfolio-tracker.ts — ILAS Portfolio tracking with T+1 settlement
// Settlement model: Submit T → Sell T+1 NAV (forward pricing, same-day settlement)
// Dual portfolio: accumulation (growth) + distribution (income) tracked independently
// Unit-based NAV tracking — no scale factors, no rounding drift

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getExactNav as sharedGetExactNav,
  getClosestNav as sharedGetClosestNav,
} from "@/lib/portfolio/nav-lookup";
import { sendDiscordAlert, COLORS, sanitizeError } from "@/lib/discord";
import {
  loadHKHolidays,
  isWorkingDay,
  addWorkingDays,
} from "@/lib/portfolio/business-days";
import { getEffectiveDecisionDate } from "@/lib/mpf/portfolio-tracker";
import { formatIlasAllocation } from "./constants";
import type { FundAllocation } from "./types";

// ===== ILAS-specific constants =====

const ILAS_SETTLEMENT_DAYS = 1;
const ILAS_COOLDOWN_DAYS = 7;
const ILAS_BASE_NAV = 100.0000;
const ILAS_LONG_WEEKEND_THRESHOLD_DAYS = 4;
const ILAS_CUTOFF_HOUR_HKT = 15.5; // 3:30pm HKT

// ===== Types =====

export type IlasPortfolioType = "accumulation" | "distribution";

interface FundHolding {
  code: string;
  units: number;
  weight: number;
}

interface SwitchGateResult {
  allowed: boolean;
  reason: string;
  pendingOrder?: any;
  canOverride?: boolean;
  lastSettlement?: string;
}

interface PendingOrder {
  id: string;
  status: string;
  settlement_date: string | null;
  expires_at: string | null;
}

// ===== Helper =====

/** Count calendar days between two date strings */
function calendarDaysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() -
      new Date(a + "T00:00:00Z").getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

/** Check if two allocations are identical */
export function isSameAllocation(
  proposed: FundAllocation[],
  current: FundAllocation[]
): boolean {
  const normalize = (alloc: FundAllocation[]) =>
    alloc
      .filter((a) => a.weight > 0)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => `${a.code}:${a.weight}`)
      .join("|");
  return normalize(proposed) === normalize(current);
}

// ===== NAV Helpers =====

// Thin wrappers — delegate to shared module, bind product = 'ilas'
const getExactNav = (fundCode: string, dateStr: string) =>
  sharedGetExactNav("ilas", fundCode, dateStr);
const getClosestNav = (fundCode: string, dateStr: string) =>
  sharedGetClosestNav("ilas", fundCode, dateStr);

// ===== 1. Switch Gate =====

export async function canSubmitIlasSwitch(
  portfolioType: IlasPortfolioType
): Promise<SwitchGateResult> {
  const supabase = createAdminClient();

  // Rule 1: No switch while one is active for this portfolio type
  const { data: active, error: activeError } = await supabase
    .from("ilas_portfolio_orders")
    .select("*")
    .eq("portfolio_type", portfolioType)
    .in("status", ["pending", "awaiting_approval", "executed"])
    .limit(1)
    .single();
  if (activeError) console.error("[ilas-tracker] canSubmitIlasSwitch active orders query:", activeError);

  if (active) {
    const statusMsg = active.status === "executed"
      ? "executed, awaiting NAV reconciliation (~4-6 biz days)"
      : active.status === "pending" ? `settles ${active.settlement_date}` : `awaiting approval, expires ${active.expires_at}`;
    return {
      allowed: false,
      reason: `Switch ${active.status}: ${statusMsg}`,
      pendingOrder: active as PendingOrder,
    };
  }

  // Rule 2: 7-day cooldown after last settled order
  const { data: lastSettled, error: lastError } = await supabase
    .from("ilas_portfolio_orders")
    .select("settled_at, settlement_date")
    .eq("portfolio_type", portfolioType)
    .eq("status", "settled")
    .order("settled_at", { ascending: false })
    .limit(1)
    .single();
  if (lastError && lastError.code !== "PGRST116") console.error("[ilas-tracker] canSubmitIlasSwitch lastSettled query:", lastError);

  if (lastSettled?.settlement_date) {
    const today = new Date().toISOString().split("T")[0];
    const daysSince = calendarDaysBetween(lastSettled.settlement_date, today);
    if (daysSince < ILAS_COOLDOWN_DAYS) {
      return {
        allowed: false,
        reason: `Cooldown: last settlement ${daysSince} days ago (need ${ILAS_COOLDOWN_DAYS})`,
        canOverride: true,
        lastSettlement: lastSettled.settlement_date,
      };
    }
  }

  return { allowed: true, reason: "OK" };
}

// ===== 2. Switch Submission =====

export async function submitIlasSwitch(params: {
  portfolioType: IlasPortfolioType;
  decisionDate: string;
  oldAllocation: FundAllocation[];
  newAllocation: FundAllocation[];
  insightId: string | null;
  isEmergency?: boolean;
}): Promise<{ orderId: string; sellDate: string; settlementDate: string }> {
  const holidays = await loadHKHolidays();
  const supabase = createAdminClient();

  const sellDate = addWorkingDays(params.decisionDate, 1, holidays);
  const settlementDate = addWorkingDays(
    params.decisionDate,
    ILAS_SETTLEMENT_DAYS,
    holidays
  );

  // Check long weekend: if settlement is >LONG_WEEKEND_THRESHOLD_DAYS calendar days away, log warning
  const calDays = calendarDaysBetween(params.decisionDate, settlementDate);
  if (calDays > ILAS_LONG_WEEKEND_THRESHOLD_DAYS) {
    await sendDiscordAlert({
      title: "⚠️ ILAS Track — Long Settlement Window",
      description: `[${params.portfolioType}] Settlement date ${settlementDate} is **${calDays} calendar days** from decision ${params.decisionDate} (holidays/weekend in between).\nPortfolio will be in cash for extended period.`,
      color: COLORS.yellow,
    });
  }

  // Insert pending order
  const { data: orderRow, error } = await supabase
    .from("ilas_portfolio_orders")
    .insert({
      portfolio_type: params.portfolioType,
      decision_date: params.decisionDate,
      sell_date: sellDate,
      settlement_date: settlementDate,
      status: "pending",
      old_allocation: params.oldAllocation,
      new_allocation: params.newAllocation,
      insight_id: params.insightId,
      is_emergency: params.isEmergency || false,
    })
    .select("id")
    .single();

  if (error) {
    // Unique constraint violation = another order was submitted concurrently (race condition)
    if (error.code === "23505") {
      await sendDiscordAlert(
        {
          title: "🔴 ILAS Order Race Condition (23505)",
          description: `Concurrent ${params.portfolioType} order submission rejected by unique guard.\nDecision date: ${params.decisionDate}\n_Two callers fired at the same time — debate may have run twice._`,
          color: COLORS.red,
        },
        { urgent: true }
      );
      throw new Error(`ILAS order rejected: another pending ${params.portfolioType} order already exists (concurrent submission)`);
    }
    throw new Error(`Failed to insert ILAS order: ${error.message}`);
  }

  // Insert sell transaction legs (units filled later when T+1 NAV available)
  for (const fund of params.oldAllocation) {
    if (fund.weight <= 0) continue;
    const { error: txnError } = await supabase.from("ilas_portfolio_transactions").insert({
      order_id: orderRow.id,
      side: "sell",
      fund_code: fund.code,
      weight: fund.weight,
      units: null, // filled on sell date when NAV available
      nav_at_execution: null,
    });
    if (txnError) throw new Error(`[ilas-tracker] transaction insert failed: ${txnError.message}`);
  }

  return {
    orderId: orderRow.id,
    sellDate,
    settlementDate,
  };
}

export async function requestEmergencyIlasSwitch(params: {
  portfolioType: IlasPortfolioType;
  decisionDate: string;
  oldAllocation: FundAllocation[];
  newAllocation: FundAllocation[];
  insightId: string | null;
  debateSummary: string;
  dangerSignals: string;
  topNews: string[];
}): Promise<{ orderId: string }> {
  const supabase = createAdminClient();

  // Generate one-time confirmation token
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  // Count switches this month for this portfolio type
  const monthStart = new Date().toISOString().slice(0, 7) + "-01";
  const { data: monthSwitches, error: monthError } = await supabase
    .from("ilas_portfolio_orders")
    .select("id")
    .eq("portfolio_type", params.portfolioType)
    .in("status", ["pending", "executed"])
    .gte("created_at", monthStart);
  if (monthError) console.error("[ilas-tracker] requestEmergencyIlasSwitch monthSwitches query:", monthError);
  const monthCount = monthSwitches?.length || 0;

  // Get last switch slippage
  const { data: lastSwitch, error: lastSwitchError } = await supabase
    .from("ilas_portfolio_orders")
    .select(
      "settlement_date, sell_nav_total, buy_nav_total, old_allocation, new_allocation"
    )
    .eq("portfolio_type", params.portfolioType)
    .eq("status", "executed")
    .order("settled_at", { ascending: false })
    .limit(1)
    .single();
  if (lastSwitchError) console.error("[ilas-tracker] requestEmergencyIlasSwitch lastSwitch query:", lastSwitchError);

  const lastSwitchInfo = lastSwitch
    ? `Last switch settled ${lastSwitch.settlement_date}. Slippage: ${lastSwitch.sell_nav_total && lastSwitch.buy_nav_total ? (((lastSwitch.buy_nav_total - lastSwitch.sell_nav_total) / lastSwitch.sell_nav_total) * 100).toFixed(2) + "%" : "N/A"}`
    : "No prior switches";

  const { data: orderRow, error } = await supabase
    .from("ilas_portfolio_orders")
    .insert({
      portfolio_type: params.portfolioType,
      decision_date: params.decisionDate,
      sell_date: params.decisionDate, // placeholder, recalculated on approval
      settlement_date: null,
      status: "awaiting_approval",
      old_allocation: params.oldAllocation,
      new_allocation: params.newAllocation,
      insight_id: params.insightId,
      is_emergency: true,
      expires_at: expiresAt,
      confirmation_token: token,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // CRITICAL: Emergency override does NOT bypass one-active-switch guard.
      // If this portfolio_type already has a pending order, the emergency dies silently.
      // This is the hidden bug from the audit — surface it loudly.
      await sendDiscordAlert(
        {
          title: "🔴 ILAS Emergency Switch BLOCKED (23505)",
          description: [
            `Debate proposed an EMERGENCY override for ILAS **${params.portfolioType}** but a pending/awaiting order already exists.`,
            `Decision date: ${params.decisionDate}`,
            ``,
            `**The emergency move did NOT happen.** Either:`,
            `1. Wait for the existing pending order to settle, OR`,
            `2. Manually clear it in Supabase \`ilas_portfolio_orders\` if you trust the new debate more.`,
          ].join("\n"),
          color: COLORS.red,
        },
        { urgent: true }
      );
      throw new Error(`Emergency ILAS order rejected: another pending/awaiting ${params.portfolioType} order already exists (concurrent submission)`);
    }
    throw new Error(`Failed to insert emergency ILAS order: ${error.message}`);
  }

  // Discord alert with full context (truncate to fit 2000-char embed limit)
  const oldStr = formatIlasAllocation(params.oldAllocation);
  const newStr = formatIlasAllocation(params.newAllocation);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://aia-assistant.vercel.app";
  await sendDiscordAlert(
    {
      title: "🚨 ILAS Emergency Switch — Approval Required",
      description: [
        `**Portfolio:** ${params.portfolioType}`,
        `**Within 7-day cooldown.** ${lastSwitchInfo}`,
        "",
        `**Current:** ${oldStr}`,
        `**Proposed:** ${newStr}`,
        "",
        `**Why:** ${params.debateSummary.slice(0, 300)}`,
        params.dangerSignals
          ? `**Danger signals:** ${params.dangerSignals.slice(0, 200)}`
          : "",
        params.topNews.length > 0
          ? `**Key news:** ${params.topNews.slice(0, 3).join(" | ").slice(0, 200)}`
          : "",
        "",
        `**Cash drag:** Switch #${monthCount + 1} this month. 2 more working days in cash.`,
        "",
        `👉 **Approve here:** ${appUrl}/approvals`,
        `_Or do nothing — expires in 48h. Not switching is valid if current allocation already reflects the risk._`,
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 1900),
      color: COLORS.red,
    },
    { urgent: true }
  );

  return { orderId: orderRow.id };
}

// ===== 3. Approval =====

export async function approveIlasSwitch(
  orderId: string,
  token: string
): Promise<{ sellDate: string; settlementDate: string }> {
  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();

  const { data: order, error: fetchErr } = await supabase
    .from("ilas_portfolio_orders")
    .select("*")
    .eq("id", orderId)
    .eq("status", "awaiting_approval")
    .single();

  if (fetchErr || !order)
    throw new Error("Order not found or not awaiting approval");
  if (order.confirmation_token !== token)
    throw new Error("Invalid confirmation token");

  // Enforce expiry at approve time — the cleanup cron runs daily, so there is
  // a gap where an expired order still has status='awaiting_approval'. Without
  // this check, a stale tab or direct API call can approve after expiry.
  if (order.expires_at && new Date(order.expires_at) < new Date()) {
    throw new Error("Order expired — cannot approve");
  }

  // Compute fresh dates from today
  const today = new Date().toISOString().split("T")[0];
  const effectiveDate = isWorkingDay(today, holidays)
    ? today
    : addWorkingDays(today, 1, holidays);
  const sellDate = addWorkingDays(effectiveDate, 1, holidays);
  const settlementDate = addWorkingDays(
    effectiveDate,
    ILAS_SETTLEMENT_DAYS,
    holidays
  );

  const { error: approveError } = await supabase
    .from("ilas_portfolio_orders")
    .update({
      status: "pending",
      decision_date: effectiveDate,
      sell_date: sellDate,
      settlement_date: settlementDate,
      confirmation_token: null, // one-time use
    })
    .eq("id", orderId);
  if (approveError) throw new Error(`[ilas-tracker] approveIlasSwitch update failed: ${approveError.message}`);

  // Insert sell legs
  const oldAlloc = order.old_allocation as FundAllocation[];
  for (const fund of oldAlloc) {
    if (fund.weight <= 0) continue;
    const { error: sellTxnError } = await supabase.from("ilas_portfolio_transactions").insert({
      order_id: orderId,
      side: "sell",
      fund_code: fund.code,
      weight: fund.weight,
      units: null,
      nav_at_execution: null,
    });
    if (sellTxnError) throw new Error(`[ilas-tracker] sell transaction insert failed: ${sellTxnError.message}`);
  }

  await sendDiscordAlert({
    title: "✅ ILAS Emergency Switch Approved",
    description: `Order ${orderId} (${order.portfolio_type}) approved. Sells ${sellDate}, settles ${settlementDate}.`,
    color: COLORS.green,
  });

  return { sellDate, settlementDate };
}

// ===== 4. Expiration =====

export async function expireStaleIlasRequests(
  portfolioType: IlasPortfolioType
): Promise<number> {
  const supabase = createAdminClient();
  const { data: expired, error: expireError } = await supabase
    .from("ilas_portfolio_orders")
    .update({ status: "expired" })
    .eq("portfolio_type", portfolioType)
    .eq("status", "awaiting_approval")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (expireError) console.error("[ilas-tracker] expireStaleRequests:", expireError);

  const count = expired?.length || 0;
  if (count > 0) {
    await sendDiscordAlert({
      title: "⏰ ILAS Emergency Switch Expired",
      description: `${count} ${portfolioType} emergency switch request(s) expired without approval.`,
      color: COLORS.yellow,
    });
  }
  return count;
}

// ===== 5. Settlement Processing =====

export async function processIlasSettlements(
  portfolioType: IlasPortfolioType
): Promise<{
  settled: number;
  executed: number;
  blocked: string[];
}> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  // Find orders due for settlement today or earlier for this portfolio type
  const { data: dueOrders, error: dueError } = await supabase
    .from("ilas_portfolio_orders")
    .select("*")
    .eq("portfolio_type", portfolioType)
    .eq("status", "pending")
    .lte("settlement_date", today);
  if (dueError) throw new Error(`[ilas-tracker] processIlasSettlements dueOrders query: ${dueError.message}`);

  const settled: string[] = [];
  const executed: string[] = [];
  const blocked: string[] = [];

  // All orders use the optimistic pending → executed → settled flow.
  // Legacy NAV-wait path retired — AIA's structural ~5 biz day price lag
  // makes NAV-gating unreliable. Reconcile-prices cron backfills NAVs.
  const MIGRATION_CUTOFF = new Date('2000-01-01T00:00:00+08:00');

  for (const order of dueOrders || []) {
    // ── NEW-ERA: optimistic execution (no NAV needed) ──────────────
    if (new Date(order.created_at) >= MIGRATION_CUTOFF) {
      // Mark as executed — the real-world AIA transaction happens on the
      // scheduled settlement_date regardless of when prices publish.
      // A separate reconciliation cron will backfill real NAVs later.
      const { data: execUpdated, error: execErr } = await supabase
        .from("ilas_portfolio_orders")
        .update({ status: "executed", executed_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", "pending")  // defense: prevents double-execution on concurrent cron
        .select("id");

      if (execErr) {
        console.error(`[ilas-settlement] executed update failed for ${order.id}:`, execErr.message);
        blocked.push(`${order.id}: executed update error: ${execErr.message}`);
        await sendDiscordAlert(
          {
            title: "🔴 ILAS Optimistic Execution Failed",
            description: `Order ${order.id} (${portfolioType}) could not transition to executed:\n\`${sanitizeError(execErr.message)}\``,
            color: COLORS.red,
          },
          { urgent: true }
        );
        continue;
      }

      if (!execUpdated || execUpdated.length === 0) {
        console.log(`[ilas-settlement] ${order.id} already executed by another invocation, skipping`);
        continue;
      }

      // Write audit trail
      const { error: auditErr } = await supabase
        .from("state_transitions")
        .insert({
          table_name: "ilas_portfolio_orders",
          row_id: order.id,
          from_status: "pending",
          to_status: "executed",
          actor: "cron:ilas-portfolio-nav",
          payload: { settlement_date: order.settlement_date, portfolio_type: portfolioType, trigger: "optimistic" },
        });
      if (auditErr) console.error(`[ilas-settlement] state_transitions insert failed for ${order.id}:`, auditErr.message);

      executed.push(order.id);
      console.log(`[ilas-settlement] ${order.id} (${portfolioType}) → executed (optimistic, settlement_date=${order.settlement_date})`);

      await sendDiscordAlert({
        title: "⚡ ILAS Switch Executed (Optimistic)",
        description: [
          `Order \`${order.id}\` moved to **executed**.`,
          `**Portfolio:** ${portfolioType}`,
          `**Settlement date:** ${order.settlement_date}`,
          `NAV reconciliation pending — will settle when prices publish.`,
        ].join("\n"),
        color: COLORS.green,
      });

      continue; // skip legacy NAV-wait logic
    }

    // ── LEGACY: NAV-wait settlement (pending → settled) ────────────
    // Rows created before the migration cutoff keep the old behavior:
    // wait for exact NAVs, then settle atomically via settle_ilas_switch RPC.
    const newAlloc = order.new_allocation as FundAllocation[];

    // Check ALL buy NAVs are available (exact date required for settlement)
    let allNavsAvailable = true;
    const buyLegs: {
      fund_code: string;
      weight: number;
      units: number;
      nav_at_execution: number;
    }[] = [];

    // Compute cash balance from sell (T+1 NAV)
    let cashBalance = 0;
    const oldAlloc = order.old_allocation as FundAllocation[];

    // Fetch the sell-date NAV row explicitly (not just "latest")
    const { data: sellDayNav, error: sellNavError } = await supabase
      .from("ilas_portfolio_nav")
      .select("nav, holdings, is_cash")
      .eq("portfolio_type", portfolioType)
      .eq("date", order.sell_date)
      .single();
    if (sellNavError) console.error("[ilas-tracker] processIlasSettlements sellDayNav query:", sellNavError);

    // Fall back to most recent row before sell date if sell-day row missing
    let navRow = sellDayNav;
    if (!navRow) {
      const { data: fallbackNav, error: fallbackNavError } = await supabase
        .from("ilas_portfolio_nav")
        .select("nav, holdings, is_cash")
        .eq("portfolio_type", portfolioType)
        .lte("date", order.sell_date)
        .order("date", { ascending: false })
        .limit(1)
        .single();
      if (fallbackNavError) console.error("[ilas-tracker] processIlasSettlements fallback NAV query:", fallbackNavError);
      navRow = fallbackNav;
    }

    if (!navRow) {
      // First settlement ever — use base NAV
      cashBalance = ILAS_BASE_NAV;
    } else if (
      navRow.holdings &&
      (navRow.holdings as FundHolding[]).length > 0
    ) {
      // Compute from holdings at sell NAV
      const holdings = navRow.holdings as FundHolding[];
      for (const h of holdings) {
        const sellNav = await getExactNav(h.code, order.sell_date);
        if (sellNav === null) {
          const closestNav = await getClosestNav(h.code, order.sell_date);
          cashBalance += h.units * (closestNav || 0);
        } else {
          cashBalance += h.units * sellNav;
        }
      }
    } else {
      // Was already cash (sell-day row has is_cash=true or empty holdings)
      cashBalance = Number(navRow.nav);
    }

    // Now compute buy legs
    let buyNavTotal = 0;
    for (const fund of newAlloc) {
      if (fund.weight <= 0) continue;
      const nav = await getExactNav(fund.code, order.settlement_date);
      if (nav === null) {
        allNavsAvailable = false;
        blocked.push(
          `${order.id}: missing NAV for ${fund.code} on ${order.settlement_date}`
        );
        break;
      }
      const units = (cashBalance * (fund.weight / 100)) / nav;
      buyLegs.push({
        fund_code: fund.code,
        weight: fund.weight,
        units,
        nav_at_execution: nav,
      });
      buyNavTotal += nav * (fund.weight / 100);
    }

    if (!allNavsAvailable) {
      // ILAS prices publish ~1 business day late — alert after 2+ business days overdue
      const blockedHolidays = await loadHKHolidays();
      let bizDaysOverdue = 0;
      let cursor = order.settlement_date;
      while (cursor < today) {
        const next = new Date(cursor + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        cursor = next.toISOString().split("T")[0];
        if (isWorkingDay(cursor, blockedHolidays)) bizDaysOverdue++;
      }
      if (bizDaysOverdue >= 10) {
        await sendDiscordAlert(
          {
            title: "🔴 ILAS Settlement Stuck — Missing NAV (" + bizDaysOverdue + " biz days)",
            description: `Order ${order.id} (${portfolioType}) cannot settle: missing price for ${order.settlement_date}. ${bizDaysOverdue} business days overdue — check AIA CorpWS source.`,
            color: COLORS.red,
          },
          { urgent: true }
        );
      }
      continue;
    }

    // Compute cash drag days
    const holidays = await loadHKHolidays();
    let cashDragDays = 0;
    let d = order.sell_date;
    while (d < order.settlement_date) {
      const next = new Date(d + "T00:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      d = next.toISOString().split("T")[0];
      if (isWorkingDay(d, holidays) && d <= order.settlement_date)
        cashDragDays++;
    }

    // Compute NAV on settlement day
    const newHoldings: FundHolding[] = buyLegs.map((l) => ({
      code: l.fund_code,
      units: l.units,
      weight: l.weight,
    }));
    const navValue = buyLegs.reduce(
      (sum, l) => sum + l.units * l.nav_at_execution,
      0
    );
    const dailyReturn = navRow
      ? ((navValue - Number(navRow.nav)) / Number(navRow.nav)) * 100
      : 0;

    // Store sell_nav_total (cash proceeds from sell) for slippage tracking
    const { error: sellNavTotalError } = await supabase
      .from("ilas_portfolio_orders")
      .update({ sell_nav_total: cashBalance })
      .eq("id", order.id);
    if (sellNavTotalError) console.error(`[ilas-portfolio-tracker] sell_nav_total update failed for ${order.id}:`, sellNavTotalError.message);

    // Atomic settlement via Postgres function
    const { error: settleErr } = await supabase.rpc("settle_ilas_switch", {
      p_order_id: order.id,
      p_portfolio_type: portfolioType,
      p_buy_nav_total: buyNavTotal,
      p_cash_drag_days: cashDragDays,
      p_buy_legs: buyLegs,
      p_nav_date: order.settlement_date,
      p_nav_value: navValue,
      p_nav_daily_return: dailyReturn,
      p_nav_holdings: newHoldings,
    });

    if (settleErr) {
      console.error(
        `[ilas-portfolio-tracker] settle_ilas_switch failed for ${order.id}:`,
        settleErr.message
      );
      blocked.push(
        `${order.id}: settle_ilas_switch error: ${settleErr.message}`
      );
      // Settlement function crashed — urgent: shouldn't sit silent
      await sendDiscordAlert(
        {
          title: "🔴 ILAS Settlement Function Failed",
          description: `Order ${order.id} (${portfolioType}) crashed in settle_ilas_switch():\n\`${sanitizeError(settleErr.message)}\`\n\nPortfolio is stuck — investigate before next cron run.`,
          color: COLORS.red,
        },
        { urgent: true }
      );
      continue;
    }

    settled.push(order.id);

    // Settlement-success notification (info channel) — closes the visibility gap
    await sendDiscordAlert({
      title: `${order.is_emergency ? "🚨✅" : "✅"} ILAS Switch Settled${order.is_emergency ? " (Emergency)" : ""}`,
      description: [
        `Order \`${order.id}\` executed.`,
        `**Portfolio:** ${portfolioType}`,
        `**Settled:** ${order.settlement_date}`,
        `**Cash drag:** ${cashDragDays} biz day${cashDragDays === 1 ? "" : "s"}`,
        `**New NAV:** ${navValue.toFixed(4)}${dailyReturn ? ` (${dailyReturn >= 0 ? "+" : ""}${dailyReturn.toFixed(2)}%)` : ""}`,
      ].join("\n"),
      color: COLORS.green,
    });

    // Backfill NAV rows from settlement_date+1 through today
    // (settlement may process days late due to AIA price publication lag)
    if (order.settlement_date < today) {
      const backfillHolidays = await loadHKHolidays();
      let backfillDate = order.settlement_date;
      let prevNav = navValue;
      let prevHoldings = newHoldings;
      while (backfillDate < today) {
        const next = new Date(backfillDate + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        backfillDate = next.toISOString().split("T")[0];
        if (!isWorkingDay(backfillDate, backfillHolidays) || backfillDate > today) continue;

        // Compute NAV from holdings × fund NAVs on this date
        let dayNav = 0;
        const dayHoldings: FundHolding[] = [];
        for (const h of prevHoldings) {
          const fNav = await getClosestNav(h.code, backfillDate);
          if (!fNav) continue;
          dayNav += h.units * fNav;
        }
        // Compute weights after full sum is known
        for (const h of prevHoldings) {
          const fNav = await getClosestNav(h.code, backfillDate);
          if (fNav && dayNav > 0) {
            dayHoldings.push({ code: h.code, units: h.units, weight: Math.round(((h.units * fNav) / dayNav) * 100) });
          }
        }

        const dayReturn = prevNav > 0 ? ((dayNav - prevNav) / prevNav) * 100 : 0;
        const { error: backfillUpsertError } = await supabase.from("ilas_portfolio_nav").upsert(
          { portfolio_type: portfolioType, date: backfillDate, nav: dayNav, daily_return_pct: dayReturn, holdings: dayHoldings, is_cash: false, is_pretracking: false },
          { onConflict: "portfolio_type,date" }
        );
        if (backfillUpsertError) {
          console.error(`[ilas-portfolio-tracker] NAV backfill upsert failed for ${portfolioType}/${backfillDate}:`, backfillUpsertError.message);
        }
        prevNav = dayNav;
        prevHoldings = dayHoldings;
      }
    }

    // Update sell transaction legs with actual NAVs + units
    const sellHoldings = navRow?.holdings as FundHolding[] | undefined;
    if (sellHoldings) {
      for (const h of sellHoldings) {
        const sellNav =
          (await getExactNav(h.code, order.sell_date)) ||
          (await getClosestNav(h.code, order.sell_date));
        if (sellNav) {
          const { error: sellTxnUpdateError } = await supabase
            .from("ilas_portfolio_transactions")
            .update({ units: h.units, nav_at_execution: sellNav })
            .eq("order_id", order.id)
            .eq("side", "sell")
            .eq("fund_code", h.code);
          if (sellTxnUpdateError) console.error(`[ilas-portfolio-tracker] sell txn update failed for ${order.id}/${h.code}:`, sellTxnUpdateError.message);
        }
      }
    }

    // Discord notification
    const oldStr = formatIlasAllocation(oldAlloc);
    const newStr = formatIlasAllocation(newAlloc);
    // Slippage = market movement during cash period (T+1 settlement)
    // Positive = market went up while we were in cash (we missed gains)
    // Negative = market went down while we were in cash (we dodged losses)
    const slippage =
      cashBalance > 0
        ? (((navValue - cashBalance) / cashBalance) * 100).toFixed(2)
        : "N/A";

    await sendDiscordAlert({
      title: "📊 ILAS Track — Switch Settled (T+1)",
      description: [
        `**Portfolio:** ${portfolioType}`,
        `**${oldStr}** → **${newStr}**`,
        `Cash drag: ${cashDragDays} working day(s)`,
        `Slippage: ${slippage}%`,
        `Portfolio NAV: ${navValue.toFixed(4)}`,
      ].join("\n"),
      color: COLORS.green,
    });
  }

  return { settled: settled.length, executed: executed.length, blocked };
}

// ===== 6. Daily NAV Computation =====

export async function computeAndStoreIlasNav(
  targetDate: string,
  portfolioType: IlasPortfolioType
): Promise<{ nav: number; isCash: boolean }> {
  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();

  if (!isWorkingDay(targetDate, holidays)) {
    return { nav: 0, isCash: false }; // skip non-working days
  }

  // Skip if settle_ilas_switch already wrote an authoritative row for this date
  const { data: existingRow, error: existingError } = await supabase
    .from("ilas_portfolio_nav")
    .select("nav, is_cash, holdings")
    .eq("portfolio_type", portfolioType)
    .eq("date", targetDate)
    .single();
  if (existingError) console.error("[ilas-tracker] computeAndStoreIlasNav existingRow query:", existingError);

  if (
    existingRow &&
    !existingRow.is_cash &&
    existingRow.holdings &&
    (existingRow.holdings as FundHolding[]).length > 0
  ) {
    // Row was written by settle_ilas_switch — don't overwrite
    return { nav: Number(existingRow.nav), isCash: false };
  }

  // Check if there's a pending order for this portfolio type (we're in cash)
  const { data: pendingOrder, error: pendingError } = await supabase
    .from("ilas_portfolio_orders")
    .select("*")
    .eq("portfolio_type", portfolioType)
    .eq("status", "pending")
    .limit(1)
    .single();
  if (pendingError) console.error("[ilas-tracker] computeAndStoreIlasNav pendingOrder query:", pendingError);

  // Cash from sell date until settlement actually processes.
  // ILAS prices publish ~1 business day late, so the order stays "pending"
  // past its nominal settlement_date — portfolio remains in cash until prices arrive
  // and processIlasSettlements() settles it. The settle_ilas_switch RPC writes the
  // authoritative NAV row on the settlement date; the early-return check above prevents
  // this function from overwriting it.
  const isCashDay =
    pendingOrder != null && targetDate >= pendingOrder.sell_date;

  // Get previous NAV for this portfolio type
  const { data: navRow, error: navError } = await supabase
    .from("ilas_portfolio_nav")
    .select("nav, holdings, is_cash")
    .eq("portfolio_type", portfolioType)
    .lt("date", targetDate)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (navError) console.error("[ilas-tracker] computeAndStoreIlasNav navRow query:", navError);

  let nav: number;
  let holdings: FundHolding[];
  let dailyReturn: number | null = null;

  if (!navRow) {
    // Bootstrap: first day ever
    nav = ILAS_BASE_NAV;
    // Get current reference portfolio for this portfolio type
    const { data: portfolio, error: portfolioError } = await supabase
      .from("ilas_reference_portfolio")
      .select("fund_id, weight")
      .eq("portfolio_type", portfolioType);
    if (portfolioError) console.error("[ilas-tracker] computeAndStoreIlasNav portfolio query:", portfolioError);
    const { data: funds, error: fundsError } = await supabase
      .from("ilas_funds")
      .select("id, fund_code");
    if (fundsError) console.error("[ilas-tracker] computeAndStoreIlasNav funds query:", fundsError);
    const fundMap = new Map((funds || []).map((f) => [f.id, f.fund_code]));

    holdings = [];
    for (const p of portfolio || []) {
      const code = fundMap.get(p.fund_id);
      if (!code || p.weight <= 0) continue;
      const fundNav = await getClosestNav(code, targetDate);
      if (!fundNav) continue;
      const units = (ILAS_BASE_NAV * (p.weight / 100)) / fundNav;
      holdings.push({ code, units, weight: p.weight });
    }
  } else if (isCashDay) {
    // Cash day: NAV frozen at previous value
    nav = Number(navRow.nav);
    holdings = [];
    dailyReturn = 0;
  } else {
    // Normal day: compute from holdings
    const prevHoldings = navRow.holdings as FundHolding[];

    if (!prevHoldings || prevHoldings.length === 0) {
      // Coming out of cash — settlement should have handled this via settle_ilas_switch
      nav = Number(navRow.nav);
      holdings = [];
    } else {
      // Normal day: compute NAV from units × today's fund NAVs
      nav = 0;
      holdings = [];
      const fundNavs = new Map<string, number>();

      // Single pass: fetch NAVs and compute total
      for (const h of prevHoldings) {
        const todayFundNav = await getClosestNav(h.code, targetDate);
        if (!todayFundNav) continue;
        fundNavs.set(h.code, todayFundNav);
        nav += h.units * todayFundNav;
      }

      // Compute weights from value proportions
      for (const h of prevHoldings) {
        const fNav = fundNavs.get(h.code);
        if (!fNav) continue;
        const weight =
          nav > 0 ? Math.round(((h.units * fNav) / nav) * 100) : 0;
        holdings.push({ code: h.code, units: h.units, weight });
      }

      dailyReturn =
        Number(navRow.nav) > 0
          ? ((nav - Number(navRow.nav)) / Number(navRow.nav)) * 100
          : null;
    }
  }

  // Upsert with portfolio_type in the conflict
  const { error: navUpsertError } = await supabase.from("ilas_portfolio_nav").upsert(
    {
      portfolio_type: portfolioType,
      date: targetDate,
      nav,
      daily_return_pct: dailyReturn,
      holdings,
      is_cash: isCashDay || false,
      is_pretracking: false,
    },
    { onConflict: "portfolio_type,date" }
  );
  if (navUpsertError) console.error("[ilas-tracker] NAV upsert failed:", navUpsertError);

  return { nav, isCash: isCashDay || false };
}
