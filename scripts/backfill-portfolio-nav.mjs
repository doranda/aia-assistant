#!/usr/bin/env node
/**
 * Backfill portfolio NAV from Jan 1 2026 → today.
 * Replays historical rebalance decisions with T+2 settlement simulation.
 * All rows marked is_pretracking = true.
 *
 * Usage: node scripts/backfill-portfolio-nav.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
const env = {};
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (m) env[m[1]] = m[2];
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const START_DATE = "2026-01-01";
const BASE_NAV = 100.0;

// ===== HELPERS =====

async function loadHolidays() {
  const { data } = await supabase.from("mpf_hk_holidays").select("date");
  return new Set((data || []).map(h => h.date));
}

function isWorkingDay(dateStr, holidays) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays.has(dateStr);
}

function addWorkingDays(startDate, days, holidays) {
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

function nextDay(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

async function getNav(fundCode, dateStr) {
  const { data: fund } = await supabase
    .from("mpf_funds").select("id").eq("fund_code", fundCode).single();
  if (!fund) return null;
  const { data: price } = await supabase
    .from("mpf_prices").select("nav")
    .eq("fund_id", fund.id).lte("date", dateStr)
    .order("date", { ascending: false }).limit(1).single();
  return price ? Number(price.nav) : null;
}

// ===== MAIN =====

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  PORTFOLIO NAV BACKFILL (Pre-Tracking Period)");
  console.log(`  ${START_DATE} → today`);
  console.log("═══════════════════════════════════════════════════════\n");

  const holidays = await loadHolidays();
  console.log(`Loaded ${holidays.size} holidays\n`);

  // 1. Get historical rebalance decisions
  const { data: insights } = await supabase
    .from("mpf_insights")
    .select("id, created_at, content_en")
    .eq("type", "rebalance_debate")
    .gte("created_at", START_DATE)
    .order("created_at", { ascending: true });

  console.log(`Found ${insights?.length || 0} historical rebalance decisions\n`);

  // Parse allocations from insight content
  // Format: "AIA-XXX 40% / AIA-YYY 30% / AIA-ZZZ 30%"
  function parseAllocationFromContent(content) {
    if (!content) return null;
    const lines = content.split("\n");
    for (const line of lines) {
      const matches = [...line.matchAll(/AIA-[A-Z0-9]+\s+\d+%/g)];
      if (matches.length >= 2) {
        return matches.map(m => {
          const parts = m[0].split(/\s+/);
          return { code: parts[0], weight: parseInt(parts[1]) };
        });
      }
    }
    return null;
  }

  // Build switch timeline: [{date, allocation}]
  const switches = [];
  for (const insight of insights || []) {
    const alloc = parseAllocationFromContent(insight.content_en);
    if (alloc) {
      const date = insight.created_at.split("T")[0];
      switches.push({ date, allocation: alloc, insightId: insight.id });
    }
  }

  console.log(`Parsed ${switches.length} allocation changes\n`);

  // 2. Get initial allocation (first debate result or current portfolio)
  let currentAllocation;
  if (switches.length > 0) {
    currentAllocation = switches[0].allocation;
    console.log(`Initial allocation (from first debate): ${currentAllocation.map(a => `${a.code} ${a.weight}%`).join(" / ")}`);
  } else {
    // Fall back to current reference portfolio
    const { data: portfolio } = await supabase
      .from("mpf_reference_portfolio").select("fund_id, weight");
    const { data: funds } = await supabase
      .from("mpf_funds").select("id, fund_code");
    const fundMap = new Map((funds || []).map(f => [f.id, f.fund_code]));
    currentAllocation = (portfolio || []).map(p => ({
      code: fundMap.get(p.fund_id) || "?",
      weight: p.weight,
    })).filter(a => a.weight > 0);
    console.log(`Initial allocation (from current portfolio): ${currentAllocation.map(a => `${a.code} ${a.weight}%`).join(" / ")}`);
  }

  if (!currentAllocation || currentAllocation.length === 0) {
    console.error("No allocation found. Cannot backfill.");
    process.exit(1);
  }

  // 3. Bootstrap: compute initial units from BASE_NAV
  let holdings = [];
  for (const a of currentAllocation) {
    const nav = await getNav(a.code, START_DATE);
    if (!nav) { console.warn(`No NAV for ${a.code} on ${START_DATE}`); continue; }
    holdings.push({ code: a.code, units: (BASE_NAV * (a.weight / 100)) / nav, weight: a.weight });
  }

  console.log(`\nBootstrap holdings:`);
  holdings.forEach(h => console.log(`  ${h.code}: ${h.units.toFixed(6)} units (${h.weight}%)`));

  // 4. Walk every trading day
  const today = new Date().toISOString().split("T")[0];
  let currentDate = START_DATE;
  let prevNav = BASE_NAV;
  let isCash = false;
  let cashBalance = 0;
  let pendingSellDate = null;
  let pendingSettlementDate = null;
  let pendingNewAlloc = null;
  let switchIdx = 0;
  let navCount = 0;

  // Build switch date map for quick lookup
  const switchMap = new Map();
  for (const sw of switches) {
    if (!switchMap.has(sw.date)) switchMap.set(sw.date, sw);
  }

  while (currentDate <= today) {
    if (!isWorkingDay(currentDate, holidays)) {
      currentDate = nextDay(currentDate);
      continue;
    }

    let nav = 0;
    let dailyReturn = null;
    let dayHoldings = holdings;
    let dayCash = isCash;

    // Check if a switch happens today
    const switchToday = switchMap.get(currentDate);
    if (switchToday && !isCash && !pendingSellDate && switchIdx < switches.length) {
      // New switch! Compute sell date and settlement date
      pendingSellDate = addWorkingDays(currentDate, 1, holidays);
      pendingSettlementDate = addWorkingDays(currentDate, 2, holidays);
      pendingNewAlloc = switchToday.allocation;
      switchIdx++;

      // Insert historical switch record
      await supabase.from("mpf_pending_switches").insert({
        decision_date: currentDate,
        sell_date: pendingSellDate,
        settlement_date: pendingSettlementDate,
        status: "settled",
        old_allocation: currentAllocation,
        new_allocation: pendingNewAlloc,
        insight_id: switchToday.insightId,
        is_emergency: false,
        settled_at: pendingSettlementDate + "T12:00:00Z",
      });
    }

    // Determine state for today
    if (pendingSellDate && currentDate >= pendingSellDate && currentDate < pendingSettlementDate) {
      // Cash day: sell happened, waiting for buy
      if (!isCash) {
        // First cash day — compute sell value
        cashBalance = 0;
        for (const h of holdings) {
          const sellNav = await getNav(h.code, pendingSellDate);
          cashBalance += h.units * (sellNav || 0);
        }
        isCash = true;
      }
      nav = cashBalance;
      dailyReturn = 0;
      dayHoldings = [];
      dayCash = true;
    } else if (pendingSettlementDate && currentDate >= pendingSettlementDate && isCash) {
      // Settlement day: buy into new allocation
      holdings = [];
      for (const a of pendingNewAlloc) {
        const buyNav = await getNav(a.code, pendingSettlementDate);
        if (!buyNav) continue;
        const units = (cashBalance * (a.weight / 100)) / buyNav;
        holdings.push({ code: a.code, units, weight: a.weight });
      }
      currentAllocation = pendingNewAlloc;
      isCash = false;
      pendingSellDate = null;
      pendingSettlementDate = null;
      pendingNewAlloc = null;

      // Compute NAV from new holdings
      nav = 0;
      for (const h of holdings) {
        const fNav = await getNav(h.code, currentDate);
        if (fNav) nav += h.units * fNav;
      }
      dayHoldings = holdings;
      dayCash = false;
      dailyReturn = prevNav > 0 ? ((nav - prevNav) / prevNav) * 100 : 0;
    } else if (!isCash) {
      // Normal day: compute from holdings
      nav = 0;
      for (const h of holdings) {
        const fNav = await getNav(h.code, currentDate);
        if (fNav) nav += h.units * fNav;
      }
      dayHoldings = holdings;
      dayCash = false;
      dailyReturn = prevNav > 0 ? ((nav - prevNav) / prevNav) * 100 : null;
    } else {
      // Still in cash
      nav = cashBalance;
      dailyReturn = 0;
      dayHoldings = [];
      dayCash = true;
    }

    // Upsert NAV row
    await supabase.from("mpf_portfolio_nav").upsert({
      date: currentDate,
      nav,
      daily_return_pct: dailyReturn,
      holdings: dayHoldings.map(h => ({ code: h.code, units: h.units, weight: h.weight })),
      is_cash: dayCash,
      is_pretracking: true,
    }, { onConflict: "date" });

    if (navCount % 10 === 0) {
      const returnPct = ((nav / BASE_NAV - 1) * 100).toFixed(2);
      console.log(`${currentDate} | NAV: ${nav.toFixed(4)} | Return: ${returnPct}% | ${dayCash ? "CASH" : dayHoldings.map(h => h.code).join("/")}`);
    }

    prevNav = nav;
    navCount++;
    currentDate = nextDay(currentDate);
  }

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  Backfill complete: ${navCount} trading days`);
  console.log(`  Final NAV: ${prevNav.toFixed(4)} (${((prevNav / BASE_NAV - 1) * 100).toFixed(2)}%)`);
  console.log(`  All rows marked is_pretracking = true`);
  console.log(`═══════════════════════════════════════════════════════`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
