// src/lib/mpf/portfolio-tracker.ts — Portfolio tracking with T+2 settlement
// Settlement model: Submit T → Sell T+1 NAV → Cash → Buy T+2 NAV (forward pricing)
// Unit-based NAV tracking — no scale factors, no rounding drift

import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, COLORS } from "@/lib/discord";
import {
  SETTLEMENT_DAYS,
  COOLDOWN_DAYS,
  CUTOFF_HOUR_HKT,
  GPF_MAX_SWITCHES_PER_YEAR,
  LONG_WEEKEND_THRESHOLD_DAYS,
  PORTFOLIO_BASE_NAV,
  formatAllocation,
} from "./constants";
import type {
  FundAllocation,
  FundHolding,
  SwitchGateResult,
  PendingSwitch,
} from "./types";

// ===== 1. Working Day Utilities =====

let holidayCache: Set<string> | null = null;

export async function loadHKHolidays(): Promise<Set<string>> {
  if (holidayCache) return holidayCache;
  const supabase = createAdminClient();
  const { data, error: holidayError } = await supabase.from("mpf_hk_holidays").select("date");
  if (holidayError) console.error("[mpf-tracker] loadHKHolidays holidays query:", holidayError);
  holidayCache = new Set((data || []).map((h) => h.date));
  return holidayCache;
}

export function isWorkingDay(dateStr: string, holidays: Set<string>): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false; // Sat/Sun
  return !holidays.has(dateStr);
}

export function addWorkingDays(
  startDate: string,
  days: number,
  holidays: Set<string>
): string {
  let current = startDate;
  let added = 0;
  while (added < days) {
    const d = new Date(current + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    current = d.toISOString().split("T")[0];
    if (isWorkingDay(current, holidays)) added++;
  }
  return current;
}

/** If submitted after 3:30pm HKT cutoff, T = next working day */
export function getEffectiveDecisionDate(
  submittedAt: Date,
  holidays: Set<string>
): string {
  // Convert to HKT (UTC+8)
  const hktHour =
    submittedAt.getUTCHours() + 8 + submittedAt.getUTCMinutes() / 60;
  const adjustedHour = hktHour >= 24 ? hktHour - 24 : hktHour;

  // Get the date in HKT
  const hktDate = new Date(submittedAt.getTime() + 8 * 60 * 60 * 1000);
  let dateStr = hktDate.toISOString().split("T")[0];

  // If after cutoff OR not a working day, advance to next working day
  if (adjustedHour >= CUTOFF_HOUR_HKT || !isWorkingDay(dateStr, holidays)) {
    dateStr = addWorkingDays(dateStr, 1, holidays);
  }

  return dateStr;
}

/** Count calendar days between two date strings */
function calendarDaysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() -
      new Date(a + "T00:00:00Z").getTime()) /
      (1000 * 60 * 60 * 24)
  );
}

// ===== 2. Switch Gate =====

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

export async function canSubmitSwitch(): Promise<SwitchGateResult> {
  const supabase = createAdminClient();

  // Rule 1: No switch while one is active
  const { data: active, error: activeError } = await supabase
    .from("mpf_pending_switches")
    .select("*")
    .in("status", ["pending", "awaiting_approval"])
    .limit(1)
    .single();
  if (activeError) console.error("[mpf-tracker] canSubmitSwitch active switch query:", activeError);

  if (active) {
    return {
      allowed: false,
      reason: `Switch ${active.status}: ${active.status === "pending" ? `settles ${active.settlement_date}` : `awaiting approval, expires ${active.expires_at}`}`,
      pendingSwitch: active as PendingSwitch,
    };
  }

  // Rule 2: 7-day cooldown after last settlement
  const { data: lastSettled, error: lastSettledError } = await supabase
    .from("mpf_pending_switches")
    .select("settled_at, settlement_date")
    .eq("status", "settled")
    .order("settled_at", { ascending: false })
    .limit(1)
    .single();
  if (lastSettledError) console.error("[mpf-tracker] canSubmitSwitch lastSettled query:", lastSettledError);

  if (lastSettled?.settlement_date) {
    const today = new Date().toISOString().split("T")[0];
    const daysSince = calendarDaysBetween(lastSettled.settlement_date, today);
    if (daysSince < COOLDOWN_DAYS) {
      return {
        allowed: false,
        reason: `Cooldown: last settlement ${daysSince} days ago (need ${COOLDOWN_DAYS})`,
        canOverride: true,
        lastSettlement: lastSettled.settlement_date,
      };
    }
  }

  return { allowed: true, reason: "OK" };
}

/** Check AIA-GPF 2 switches/year hard limit */
export async function checkGPFLimit(
  allocation: FundAllocation[]
): Promise<{ blocked: boolean; reason: string }> {
  const hasGPF = allocation.some((a) => a.code === "AIA-GPF" && a.weight > 0);
  if (!hasGPF)
    return { blocked: false, reason: "No GPF in allocation" };

  const supabase = createAdminClient();
  const yearStart = new Date().getUTCFullYear() + "-01-01";
  // Count distinct switches involving GPF (not individual transaction rows)
  const { data: gpfSwitches, error: gpfError } = await supabase
    .from("mpf_pending_switches")
    .select("id")
    .in("status", ["pending", "settled"])
    .gte("created_at", yearStart);
  if (gpfError) console.error("[mpf-tracker] checkGPFLimit gpfSwitches query:", gpfError);

  // Filter to switches where GPF appears in old or new allocation
  let gpfCount = 0;
  for (const sw of gpfSwitches || []) {
    const { data: full, error: fullError } = await supabase
      .from("mpf_pending_switches")
      .select("old_allocation, new_allocation")
      .eq("id", sw.id)
      .single();
    if (fullError) console.error("[mpf-tracker] checkGPFLimit full switch details:", fullError);
    if (!full) continue;
    const allFunds = [
      ...((full.old_allocation as FundAllocation[]) || []),
      ...((full.new_allocation as FundAllocation[]) || []),
    ];
    if (allFunds.some(a => a.code === "AIA-GPF")) gpfCount++;
  }

  if (gpfCount >= GPF_MAX_SWITCHES_PER_YEAR) {
    return {
      blocked: true,
      reason: `AIA-GPF: ${gpfCount} switches this year (max ${GPF_MAX_SWITCHES_PER_YEAR})`,
    };
  }
  return { blocked: false, reason: "GPF limit OK" };
}

// ===== 3. Switch Submission =====

export async function submitSwitch(params: {
  decisionDate: string;
  oldAllocation: FundAllocation[];
  newAllocation: FundAllocation[];
  insightId: string | null;
  isEmergency?: boolean;
}): Promise<{ switchId: string; sellDate: string; settlementDate: string }> {
  const holidays = await loadHKHolidays();
  const supabase = createAdminClient();

  const sellDate = addWorkingDays(params.decisionDate, 1, holidays);
  const settlementDate = addWorkingDays(params.decisionDate, SETTLEMENT_DAYS, holidays);

  // Check long weekend: if settlement is >LONG_WEEKEND_THRESHOLD_DAYS calendar days away, log warning
  const calDays = calendarDaysBetween(params.decisionDate, settlementDate);
  if (calDays > LONG_WEEKEND_THRESHOLD_DAYS) {
    await sendDiscordAlert({
      title: "⚠️ MPF Care — Long Settlement Window",
      description: `Settlement date ${settlementDate} is **${calDays} calendar days** from decision ${params.decisionDate} (holidays/weekend in between).\nPortfolio will be in cash for extended period.`,
      color: COLORS.yellow,
    });
  }

  // Insert pending switch
  const { data: switchRow, error } = await supabase
    .from("mpf_pending_switches")
    .insert({
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

  if (error) throw new Error(`Failed to insert switch: ${error.message}`);

  // Insert sell transaction legs (units filled later when T+1 NAV available)
  for (const fund of params.oldAllocation) {
    if (fund.weight <= 0) continue;
    const { error: txnError } = await supabase.from("mpf_portfolio_transactions").insert({
      switch_id: switchRow.id,
      side: "sell",
      fund_code: fund.code,
      weight: fund.weight,
      units: null, // filled on sell date when NAV available
      nav_at_execution: null,
    });
    if (txnError) throw new Error(`[mpf-tracker] transaction insert failed: ${txnError.message}`);
  }

  return {
    switchId: switchRow.id,
    sellDate,
    settlementDate,
  };
}

export async function requestEmergencySwitch(params: {
  decisionDate: string;
  oldAllocation: FundAllocation[];
  newAllocation: FundAllocation[];
  insightId: string | null;
  debateSummary: string;
  dangerSignals: string;
  topNews: string[];
}): Promise<{ switchId: string }> {
  const supabase = createAdminClient();

  // Generate one-time confirmation token
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  // Count switches this month
  const monthStart = new Date().toISOString().slice(0, 7) + "-01";
  const { data: monthSwitches, error: monthError } = await supabase
    .from("mpf_pending_switches")
    .select("id")
    .in("status", ["pending", "settled"])
    .gte("created_at", monthStart);
  if (monthError) console.error("[mpf-tracker] requestEmergencySwitch month count:", monthError);
  const monthCount = monthSwitches?.length || 0;

  // Get last switch slippage
  const { data: lastSwitch, error: lastSwitchError } = await supabase
    .from("mpf_pending_switches")
    .select("settlement_date, sell_nav_total, buy_nav_total, old_allocation, new_allocation")
    .eq("status", "settled")
    .order("settled_at", { ascending: false })
    .limit(1)
    .single();
  if (lastSwitchError && lastSwitchError.code !== "PGRST116") console.error("[mpf-tracker] requestEmergencySwitch last switch:", lastSwitchError);

  const lastSwitchInfo = lastSwitch
    ? `Last switch settled ${lastSwitch.settlement_date}. Slippage: ${lastSwitch.sell_nav_total && lastSwitch.buy_nav_total ? (((lastSwitch.buy_nav_total - lastSwitch.sell_nav_total) / lastSwitch.sell_nav_total) * 100).toFixed(2) + "%" : "N/A"}`
    : "No prior switches";

  const { data: switchRow, error } = await supabase
    .from("mpf_pending_switches")
    .insert({
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

  if (error) throw new Error(`Failed to insert emergency switch: ${error.message}`);

  // Discord alert with full context (truncate to fit 2000-char embed limit)
  const oldStr = formatAllocation(params.oldAllocation);
  const newStr = formatAllocation(params.newAllocation);

  await sendDiscordAlert({
    title: "🚨 Emergency Switch — Approval Required",
    description: [
      `**Within 7-day cooldown.** ${lastSwitchInfo}`,
      "",
      `**Current:** ${oldStr}`,
      `**Proposed:** ${newStr}`,
      "",
      `**Why:** ${params.debateSummary.slice(0, 300)}`,
      params.dangerSignals ? `**Danger signals:** ${params.dangerSignals.slice(0, 200)}` : "",
      params.topNews.length > 0 ? `**Key news:** ${params.topNews.slice(0, 3).join(" | ").slice(0, 200)}` : "",
      "",
      `**Cash drag:** Switch #${monthCount + 1} this month. 2 more working days in cash.`,
      "",
      `**Option A:** Approve → POST /api/mpf/approve-switch`,
      `Body: { "switch_id": "${switchRow.id}", "token": "${token}" }`,
      `**Option B:** Do nothing — expires in 48h.`,
      `_Not switching is valid if current allocation already reflects the risk._`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1900),
    color: COLORS.red,
  });

  return { switchId: switchRow.id };
}

// ===== 4. Approval =====

export async function approveSwitch(
  switchId: string,
  token: string
): Promise<{ sellDate: string; settlementDate: string }> {
  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();

  const { data: sw, error: fetchErr } = await supabase
    .from("mpf_pending_switches")
    .select("*")
    .eq("id", switchId)
    .eq("status", "awaiting_approval")
    .single();

  if (fetchErr || !sw) throw new Error("Switch not found or not awaiting approval");
  if (sw.confirmation_token !== token) throw new Error("Invalid confirmation token");

  // Compute fresh dates from today
  const today = new Date().toISOString().split("T")[0];
  const effectiveDate = isWorkingDay(today, holidays)
    ? today
    : addWorkingDays(today, 1, holidays);
  const sellDate = addWorkingDays(effectiveDate, 1, holidays);
  const settlementDate = addWorkingDays(effectiveDate, SETTLEMENT_DAYS, holidays);

  const { error: approveError } = await supabase
    .from("mpf_pending_switches")
    .update({
      status: "pending",
      decision_date: effectiveDate,
      sell_date: sellDate,
      settlement_date: settlementDate,
      confirmation_token: null, // one-time use
    })
    .eq("id", switchId);
  if (approveError) throw new Error(`[mpf-tracker] approveSwitch update failed: ${approveError.message}`);

  // Insert sell legs
  const oldAlloc = sw.old_allocation as FundAllocation[];
  for (const fund of oldAlloc) {
    if (fund.weight <= 0) continue;
    const { error: sellTxnError } = await supabase.from("mpf_portfolio_transactions").insert({
      switch_id: switchId,
      side: "sell",
      fund_code: fund.code,
      weight: fund.weight,
      units: null,
      nav_at_execution: null,
    });
    if (sellTxnError) throw new Error(`[mpf-tracker] sell transaction insert failed: ${sellTxnError.message}`);
  }

  await sendDiscordAlert({
    title: "✅ Emergency Switch Approved",
    description: `Switch ${switchId} approved. Sells ${sellDate}, settles ${settlementDate}.`,
    color: COLORS.green,
  });

  return { sellDate, settlementDate };
}

// ===== 5. Expiration =====

export async function expireStaleRequests(): Promise<number> {
  const supabase = createAdminClient();
  const { data: expired, error: expireError } = await supabase
    .from("mpf_pending_switches")
    .update({ status: "expired" })
    .eq("status", "awaiting_approval")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (expireError) console.error("[mpf-tracker] expireStaleRequests:", expireError);

  const count = expired?.length || 0;
  if (count > 0) {
    await sendDiscordAlert({
      title: "⏰ Emergency Switch Expired",
      description: `${count} emergency switch request(s) expired without approval.`,
      color: COLORS.yellow,
    });
  }
  return count;
}

// ===== 6. Settlement Processing =====

/** Find exact-date NAV. Returns null if no exact match (does NOT fall back). */
async function getExactNav(
  fundCode: string,
  dateStr: string
): Promise<number | null> {
  const supabase = createAdminClient();
  const { data: fund, error: fundError } = await supabase
    .from("mpf_funds")
    .select("id")
    .eq("fund_code", fundCode)
    .single();
  if (fundError) console.error("[mpf-tracker] getExactNav fund lookup:", fundError);
  if (!fund) return null;

  const { data: price, error: priceError } = await supabase
    .from("mpf_prices")
    .select("nav")
    .eq("fund_id", fund.id)
    .eq("date", dateStr)
    .single();
  if (priceError) console.error("[mpf-tracker] getExactNav price lookup:", priceError);

  return price ? Number(price.nav) : null;
}

/** Find closest NAV on or before date (for daily NAV computation, not settlement) */
async function getClosestNav(
  fundCode: string,
  dateStr: string
): Promise<number | null> {
  const supabase = createAdminClient();
  const { data: fund, error: fundError } = await supabase
    .from("mpf_funds")
    .select("id")
    .eq("fund_code", fundCode)
    .single();
  if (fundError) console.error("[mpf-tracker] getClosestNav fund lookup:", fundError);
  if (!fund) return null;

  const { data: price, error: priceError } = await supabase
    .from("mpf_prices")
    .select("nav")
    .eq("fund_id", fund.id)
    .lte("date", dateStr)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (priceError) console.error("[mpf-tracker] getClosestNav price lookup:", priceError);

  return price ? Number(price.nav) : null;
}

export async function processSettlements(): Promise<{
  settled: number;
  blocked: string[];
}> {
  const supabase = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  // Find switches due for settlement today or earlier
  const { data: dueSwitches, error: dueError } = await supabase
    .from("mpf_pending_switches")
    .select("*")
    .eq("status", "pending")
    .lte("settlement_date", today);
  if (dueError) throw new Error(`[mpf-tracker] processSettlements dueSwitches query: ${dueError.message}`);

  const settled: string[] = [];
  const blocked: string[] = [];

  for (const sw of dueSwitches || []) {
    const newAlloc = sw.new_allocation as FundAllocation[];

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
    const oldAlloc = sw.old_allocation as FundAllocation[];

    // Fetch the sell-date NAV row explicitly (not just "latest")
    const { data: sellDayNav, error: sellNavError } = await supabase
      .from("mpf_portfolio_nav")
      .select("nav, holdings, is_cash")
      .eq("date", sw.sell_date)
      .single();
    if (sellNavError) console.error("[mpf-tracker] processSettlements sellDayNav query:", sellNavError);

    // Fall back to most recent row before sell date if sell-day row missing
    let navRow = sellDayNav;
    if (!navRow) {
      const { data: fallbackNav, error: fallbackNavError } = await supabase
        .from("mpf_portfolio_nav")
        .select("nav, holdings, is_cash")
        .lte("date", sw.sell_date)
        .order("date", { ascending: false })
        .limit(1)
        .single();
      if (fallbackNavError) console.error("[mpf-tracker] processSettlements fallback NAV query:", fallbackNavError);
      navRow = fallbackNav;
    }

    if (!navRow) {
      // First settlement ever — use base NAV
      cashBalance = PORTFOLIO_BASE_NAV;
    } else if (navRow.holdings && (navRow.holdings as FundHolding[]).length > 0) {
      // Compute from holdings at sell NAV
      const holdings = navRow.holdings as FundHolding[];
      for (const h of holdings) {
        const sellNav = await getExactNav(h.code, sw.sell_date);
        if (sellNav === null) {
          const closestNav = await getClosestNav(h.code, sw.sell_date);
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
      const nav = await getExactNav(fund.code, sw.settlement_date);
      if (nav === null) {
        allNavsAvailable = false;
        blocked.push(
          `${sw.id}: missing NAV for ${fund.code} on ${sw.settlement_date}`
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
      // AIA publishes prices ~2 business days late — only alert after 4+ business days
      const blockedHolidays = await loadHKHolidays();
      let bizDaysOverdue = 0;
      let cursor = sw.settlement_date;
      while (cursor < today) {
        const next = new Date(cursor + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        cursor = next.toISOString().split("T")[0];
        if (isWorkingDay(cursor, blockedHolidays)) bizDaysOverdue++;
      }
      if (bizDaysOverdue >= 4) {
        await sendDiscordAlert({
          title: "🔴 Settlement Stuck — Missing NAV (" + bizDaysOverdue + " biz days)",
          description: `Switch ${sw.id} cannot settle: missing price for ${sw.settlement_date}. ${bizDaysOverdue} business days overdue — check AIA price source.`,
          color: COLORS.red,
        });
      }
      continue;
    }

    // Compute cash drag days
    const holidays = await loadHKHolidays();
    let cashDragDays = 0;
    let d = sw.sell_date;
    while (d < sw.settlement_date) {
      const next = new Date(d + "T00:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      d = next.toISOString().split("T")[0];
      if (isWorkingDay(d, holidays) && d <= sw.settlement_date) cashDragDays++;
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
    const dailyReturn =
      navRow ? ((navValue - Number(navRow.nav)) / Number(navRow.nav)) * 100 : 0;

    // Store sell_nav_total (cash proceeds from sell) for slippage tracking
    const { error: sellNavTotalError } = await supabase
      .from("mpf_pending_switches")
      .update({ sell_nav_total: cashBalance })
      .eq("id", sw.id);
    if (sellNavTotalError) console.error(`[portfolio-tracker] sell_nav_total update failed for ${sw.id}:`, sellNavTotalError.message);

    // Atomic settlement via Postgres function
    const { error: settleErr } = await supabase.rpc("settle_switch", {
      p_switch_id: sw.id,
      p_buy_nav_total: buyNavTotal,
      p_cash_drag_days: cashDragDays,
      p_buy_legs: buyLegs,
      p_nav_date: sw.settlement_date,
      p_nav_value: navValue,
      p_nav_daily_return: dailyReturn,
      p_nav_holdings: newHoldings,
    });

    if (settleErr) {
      console.error(`[portfolio-tracker] settle_switch failed for ${sw.id}:`, settleErr.message);
      blocked.push(`${sw.id}: settle_switch error: ${settleErr.message}`);
      continue;
    }

    settled.push(sw.id);

    // Backfill NAV rows from settlement_date+1 through today
    // (settlement may process days late due to AIA price publication lag)
    if (sw.settlement_date < today) {
      const backfillHolidays = await loadHKHolidays();
      let backfillDate = sw.settlement_date;
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
          const w = dayNav > 0 ? Math.round(((h.units * fNav) / dayNav) * 100) : h.weight;
          dayHoldings.push({ code: h.code, units: h.units, weight: w });
        }
        // Fix weights after full sum is known
        for (const dh of dayHoldings) {
          const fNav = await getClosestNav(dh.code, backfillDate);
          if (fNav && dayNav > 0) dh.weight = Math.round(((dh.units * fNav) / dayNav) * 100);
        }

        const dayReturn = prevNav > 0 ? ((dayNav - prevNav) / prevNav) * 100 : 0;
        await supabase.from("mpf_portfolio_nav").upsert(
          { date: backfillDate, nav: dayNav, daily_return_pct: dayReturn, holdings: dayHoldings, is_cash: false, is_pretracking: false },
          { onConflict: "date" }
        );
        prevNav = dayNav;
        prevHoldings = dayHoldings;
      }
    }

    // Update sell transaction legs with actual NAVs + units
    const sellHoldings = navRow?.holdings as FundHolding[] | undefined;
    if (sellHoldings) {
      for (const h of sellHoldings) {
        const sellNav = await getExactNav(h.code, sw.sell_date) || await getClosestNav(h.code, sw.sell_date);
        if (sellNav) {
          const { error: sellTxnUpdateError } = await supabase
            .from("mpf_portfolio_transactions")
            .update({ units: h.units, nav_at_execution: sellNav })
            .eq("switch_id", sw.id)
            .eq("side", "sell")
            .eq("fund_code", h.code);
          if (sellTxnUpdateError) console.error(`[portfolio-tracker] sell txn update failed for ${sw.id}/${h.code}:`, sellTxnUpdateError.message);
        }
      }
    }

    // Discord notification
    const oldStr = formatAllocation(oldAlloc);
    const newStr = formatAllocation(newAlloc);
    // Slippage = market movement during cash period (T+1 sell to T+2 buy)
    // Positive = market went up while we were in cash (we missed gains)
    // Negative = market went down while we were in cash (we dodged losses)
    const slippage = cashBalance > 0
      ? (((navValue - cashBalance) / cashBalance) * 100).toFixed(2)
      : "N/A";

    await sendDiscordAlert({
      title: "📊 MPF Care — Switch Settled (T+2)",
      description: [
        `**${oldStr}** → **${newStr}**`,
        `Cash drag: ${cashDragDays} working day(s)`,
        `Slippage: ${slippage}%`,
        `Portfolio NAV: ${navValue.toFixed(4)}`,
      ].join("\n"),
      color: COLORS.green,
    });
  }

  return { settled: settled.length, blocked };
}

// ===== 7. Daily NAV Computation =====

export async function computeAndStoreNav(
  targetDate: string
): Promise<{ nav: number; isCash: boolean }> {
  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();

  if (!isWorkingDay(targetDate, holidays)) {
    return { nav: 0, isCash: false }; // skip non-working days
  }

  // Skip if settle_switch already wrote an authoritative row for this date
  const { data: existingRow, error: existingError } = await supabase
    .from("mpf_portfolio_nav")
    .select("nav, is_cash, holdings")
    .eq("date", targetDate)
    .single();
  if (existingError) console.error("[mpf-tracker] computeAndStoreNav existingRow query:", existingError);

  if (existingRow && !existingRow.is_cash && existingRow.holdings && (existingRow.holdings as FundHolding[]).length > 0) {
    // Row was written by settle_switch — don't overwrite
    return { nav: Number(existingRow.nav), isCash: false };
  }

  // Check if there's a pending switch (we're in cash)
  const { data: pendingSwitch, error: pendingError } = await supabase
    .from("mpf_pending_switches")
    .select("*")
    .eq("status", "pending")
    .limit(1)
    .single();
  if (pendingError) console.error("[mpf-tracker] computeAndStoreNav pendingSwitch query:", pendingError);

  // Cash from sell date until settlement actually processes.
  // AIA publishes prices ~2 business days late, so the switch stays "pending"
  // past its nominal settlement_date — portfolio remains in cash until prices arrive
  // and processSettlements() settles it. The settle_switch RPC writes the authoritative
  // NAV row on the settlement date; the early-return check above (line ~709) prevents
  // this function from overwriting it.
  const isCashDay =
    pendingSwitch != null && targetDate >= pendingSwitch.sell_date;

  // Get previous NAV
  const { data: navRow, error: navError } = await supabase
    .from("mpf_portfolio_nav")
    .select("nav, holdings, is_cash")
    .lt("date", targetDate)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (navError) console.error("[mpf-tracker] computeAndStoreNav navRow query:", navError);

  let nav: number;
  let holdings: FundHolding[];
  let dailyReturn: number | null = null;

  if (!navRow) {
    // Bootstrap: first day ever
    nav = PORTFOLIO_BASE_NAV;
    // Get current portfolio
    const { data: portfolio, error: portfolioError } = await supabase
      .from("mpf_reference_portfolio")
      .select("fund_id, weight");
    if (portfolioError) console.error("[mpf-tracker] computeAndStoreNav portfolio query:", portfolioError);
    const { data: funds, error: fundsError } = await supabase
      .from("mpf_funds")
      .select("id, fund_code");
    if (fundsError) console.error("[mpf-tracker] computeAndStoreNav funds query:", fundsError);
    const fundMap = new Map((funds || []).map((f) => [f.id, f.fund_code]));

    holdings = [];
    for (const p of portfolio || []) {
      const code = fundMap.get(p.fund_id);
      if (!code || p.weight <= 0) continue;
      const fundNav = await getClosestNav(code, targetDate);
      if (!fundNav) continue;
      const units = (PORTFOLIO_BASE_NAV * (p.weight / 100)) / fundNav;
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
      // Coming out of cash — settlement should have handled this via settle_switch
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
        const weight = nav > 0 ? Math.round(((h.units * fNav) / nav) * 100) : 0;
        holdings.push({ code: h.code, units: h.units, weight });
      }

      dailyReturn =
        Number(navRow.nav) > 0
          ? ((nav - Number(navRow.nav)) / Number(navRow.nav)) * 100
          : null;
    }
  }

  // Upsert
  const { error: navUpsertError } = await supabase.from("mpf_portfolio_nav").upsert(
    {
      date: targetDate,
      nav,
      daily_return_pct: dailyReturn,
      holdings,
      is_cash: isCashDay || false,
      is_pretracking: false,
    },
    { onConflict: "date" }
  );
  if (navUpsertError) console.error("[mpf-tracker] NAV upsert failed:", navUpsertError);

  return { nav, isCash: isCashDay || false };
}
