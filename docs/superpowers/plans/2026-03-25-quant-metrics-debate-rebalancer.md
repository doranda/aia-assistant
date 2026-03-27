# Quant Metrics Engine + Dual-Agent Debate Rebalancer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add quantitative fund analysis (Sharpe, Sortino, drawdown, FER, momentum) and replace the single-AI rebalancer with a 4-call dual-agent debate pipeline that produces transparent reasoning.

**Architecture:** Pure TypeScript math engine computes metrics from 135K+ NAV records, stored in `mpf_fund_metrics` table. Debate rebalancer runs 4 LLM calls (2 parallel proposals → debate → mediator) via OpenRouter with `anthropic/claude-sonnet-4-6`. New Fund Screener page + risk metric cards on fund detail page. Brave Search backfills NAV data for 5 missing funds.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres), OpenRouter (Claude Sonnet 4.6), Brave Search API, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-quant-metrics-debate-rebalancer-design.md`

---

## Task 1: Database Migration + Type Updates

**Files:**
- Modify: `src/lib/mpf/types.ts:17-19`

- [ ] **Step 1: Update InsightType union**

In `src/lib/mpf/types.ts` line 17, change:
```typescript
export type InsightType = "weekly" | "alert" | "on_demand" | "rebalance_debate";
```

- [ ] **Step 2: Update PriceSource union**

In `src/lib/mpf/types.ts` line 19, change:
```typescript
export type PriceSource = "mpfa" | "aastocks" | "manual" | "aia_api" | "brave_search";
```

- [ ] **Step 3: Add FundMetrics type**

Add to `src/lib/mpf/types.ts` after `ScraperRun` interface (~line 88):
```typescript
export type MetricPeriod = "1y" | "3y" | "5y" | "since_launch";

export interface FundMetrics {
  id: string;
  fund_id: string;
  fund_code: string;
  period: MetricPeriod;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  expense_ratio_pct: number | null;
  momentum_score: number | null;
  computed_at: string;
}
```

- [ ] **Step 4: Create mpf_fund_metrics table in Supabase**

Run via `supabase db query --linked`:
```sql
CREATE TABLE IF NOT EXISTS mpf_fund_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id uuid NOT NULL REFERENCES mpf_funds(id),
  fund_code text NOT NULL,
  period text NOT NULL CHECK (period IN ('1y', '3y', '5y', 'since_launch')),
  sharpe_ratio numeric,
  sortino_ratio numeric,
  max_drawdown_pct numeric,
  annualized_return_pct numeric,
  annualized_volatility_pct numeric,
  expense_ratio_pct numeric,
  momentum_score numeric,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fund_id, period)
);

CREATE INDEX idx_fund_metrics_code ON mpf_fund_metrics (fund_code);

-- Update CHECK constraints on existing tables to allow new values
ALTER TABLE mpf_insights DROP CONSTRAINT IF EXISTS mpf_insights_type_check;
ALTER TABLE mpf_insights ADD CONSTRAINT mpf_insights_type_check
  CHECK (type IN ('weekly', 'alert', 'on_demand', 'rebalance_debate'));

ALTER TABLE mpf_prices DROP CONSTRAINT IF EXISTS mpf_prices_source_check;
ALTER TABLE mpf_prices ADD CONSTRAINT mpf_prices_source_check
  CHECK (source IN ('mpfa', 'aastocks', 'manual', 'aia_api', 'brave_search'));
```

Note: If the constraints have different names, run `SELECT conname FROM pg_constraint WHERE conrelid = 'mpf_insights'::regclass;` first to find the actual names.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mpf/types.ts
git commit -m "feat(mpf-care): add FundMetrics type, rebalance_debate insight type, brave_search source"
```

---

## Task 2: Constants — Risk-Free Rate, Profile, FER Lookup

**Files:**
- Modify: `src/lib/mpf/constants.ts`

- [ ] **Step 1: Add quant constants**

Add to the end of `src/lib/mpf/constants.ts` (after `INSIGHT_DISCLAIMER`):
```typescript
// Risk-free rate for Sharpe/Sortino (HIBOR approximate, annual)
export const RISK_FREE_RATE = 0.04;

// Investment profile — fixed 28yo long-term growth
export const INVESTMENT_PROFILE = {
  age: 28,
  equity_pct: 82, // 110 - age
  bond_pct: 18,
  label: "28yo Long-Term Growth",
} as const;

// Fund Expense Ratios (FER %) — Source: MPFA published data 2025
// These are annual percentages. Lower is better.
export const FUND_EXPENSE_RATIOS: Record<string, number> = {
  "AIA-AEF": 1.73, "AIA-EEF": 1.76, "AIA-GCF": 1.74,
  "AIA-HEF": 1.61, "AIA-JEF": 1.75, "AIA-NAF": 1.71,
  "AIA-GRF": 1.59, "AIA-AMI": 0.97, "AIA-EAI": 0.99,
  "AIA-HCI": 0.86, "AIA-WIF": 0.99, "AIA-GRW": 1.69,
  "AIA-BAL": 1.67, "AIA-CST": 1.55, "AIA-CHD": 1.93,
  "AIA-MCF": 1.82, "AIA-FGR": 1.72, "AIA-FSG": 1.62,
  "AIA-FCS": 1.50, "AIA-ABF": 1.26, "AIA-GBF": 1.29,
  "AIA-CON": 0.39, "AIA-GPF": 1.88, "AIA-CAF": 0.81,
  "AIA-65P": 0.76,
};

// Screener category groupings
export const SCREENER_CATEGORIES = {
  All: null,
  Equity: ["equity", "index", "dynamic"] as FundCategory[],
  Bond: ["bond", "conservative", "guaranteed"] as FundCategory[],
  Mixed: ["mixed", "fidelity", "dis"] as FundCategory[],
} as const;

// Missing funds — not on AIA getFundDetails API, need Brave Search backfill
export const MISSING_DAILY_DATA_FUNDS = ["AIA-HEF", "AIA-JEF", "AIA-FCS", "AIA-FGR", "AIA-FSG"];
```

- [ ] **Step 2: Add FundCategory import at top if not already imported**

The file already imports `FundCategory` on line 3. No change needed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/mpf/constants.ts
git commit -m "feat(mpf-care): add risk-free rate, investment profile, FER lookup, screener categories"
```

---

## Task 3: Quant Metrics Engine

**Files:**
- Create: `src/lib/mpf/metrics.ts`

- [ ] **Step 1: Create metrics.ts with all calculation functions**

Create `src/lib/mpf/metrics.ts`:
```typescript
// src/lib/mpf/metrics.ts — Pure TypeScript quant metric calculations
// No external dependencies. Each function takes sorted {date, nav}[] arrays.

import { RISK_FREE_RATE, FUND_EXPENSE_RATIOS } from "./constants";

interface PricePoint {
  date: string;
  nav: number;
}

/**
 * Daily returns as decimal fractions (0.01 = 1%)
 */
function dailyReturns(prices: PricePoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i].nav - prices[i - 1].nav) / prices[i - 1].nav);
  }
  return returns;
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Annualized return (CAGR).
 * Returns null if fewer than 20 trading days.
 * Returns raw cumulative return if fewer than 252 days (< 1 year).
 */
export function calcAnnualizedReturn(prices: PricePoint[]): number | null {
  if (prices.length < 20) return null;
  const startNav = prices[0].nav;
  const endNav = prices[prices.length - 1].nav;
  if (startNav <= 0) return null;
  const tradingDays = prices.length;
  if (tradingDays < 252) {
    // Raw cumulative return for short periods
    return (endNav / startNav) - 1;
  }
  return Math.pow(endNav / startNav, 252 / tradingDays) - 1;
}

/**
 * Annualized volatility = StdDev(daily returns) × √252
 * Returns null if fewer than 60 daily prices.
 */
export function calcAnnualizedVolatility(prices: PricePoint[]): number | null {
  if (prices.length < 60) return null;
  const returns = dailyReturns(prices);
  if (returns.length < 2) return null;
  return stdDev(returns) * Math.sqrt(252);
}

/**
 * Sharpe Ratio = (CAGR - Rf) / Annualized Volatility
 * Returns null if insufficient data for either component.
 */
export function calcSharpeRatio(
  prices: PricePoint[],
  riskFreeRate: number = RISK_FREE_RATE
): number | null {
  const cagr = calcAnnualizedReturn(prices);
  const vol = calcAnnualizedVolatility(prices);
  if (cagr === null || vol === null || vol === 0) return null;
  return (cagr - riskFreeRate) / vol;
}

/**
 * Sortino Ratio = (CAGR - Rf) / Downside Deviation
 * Uses full-sample downside deviation (all observations, not just negative).
 * Returns null if fewer than 60 daily prices.
 */
export function calcSortinoRatio(
  prices: PricePoint[],
  riskFreeRate: number = RISK_FREE_RATE
): number | null {
  if (prices.length < 60) return null;
  const cagr = calcAnnualizedReturn(prices);
  if (cagr === null) return null;

  const returns = dailyReturns(prices);
  const dailyTarget = riskFreeRate / 252;

  // Full-sample downside deviation
  const squaredDownside = returns.map(r => Math.min(r - dailyTarget, 0) ** 2);
  const downsideDev = Math.sqrt(mean(squaredDownside)) * Math.sqrt(252);

  if (downsideDev === 0) return null;
  return (cagr - riskFreeRate) / downsideDev;
}

/**
 * Maximum drawdown — worst peak-to-trough decline as a negative percentage.
 * Returns null if fewer than 20 daily prices.
 */
export function calcMaxDrawdown(prices: PricePoint[]): number | null {
  if (prices.length < 20) return null;
  let peak = prices[0].nav;
  let maxDd = 0;

  for (const p of prices) {
    if (p.nav > peak) peak = p.nav;
    const dd = (p.nav - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }

  return maxDd; // Negative number, e.g., -0.15 = -15% drawdown
}

/**
 * Momentum score — 3-month (63 trading days) trailing return.
 * Returns null if fewer than 63 trading days.
 */
export function calcMomentumScore(prices: PricePoint[]): number | null {
  if (prices.length < 63) return null;
  const latest = prices[prices.length - 1].nav;
  const past = prices[prices.length - 63].nav;
  if (past <= 0) return null;
  return (latest / past) - 1;
}

/**
 * Get expense ratio for a fund code.
 */
export function getExpenseRatio(fundCode: string): number | null {
  return FUND_EXPENSE_RATIOS[fundCode] ?? null;
}

/**
 * Slice prices array for a specific period.
 * Returns the most recent N trading days of data.
 */
export function slicePricesForPeriod(
  prices: PricePoint[],
  period: "1y" | "3y" | "5y" | "since_launch"
): PricePoint[] {
  if (period === "since_launch") return prices;
  const tradingDays: Record<string, number> = {
    "1y": 252,
    "3y": 756,
    "5y": 1260,
  };
  const days = tradingDays[period];
  if (prices.length <= days) return prices;
  return prices.slice(-days);
}

/**
 * Compute all metrics for a fund over a given period.
 */
export function computeAllMetrics(
  prices: PricePoint[],
  fundCode: string,
  period: "1y" | "3y" | "5y" | "since_launch"
) {
  const sliced = slicePricesForPeriod(prices, period);
  return {
    sharpe_ratio: calcSharpeRatio(sliced),
    sortino_ratio: calcSortinoRatio(sliced),
    max_drawdown_pct: calcMaxDrawdown(sliced),
    annualized_return_pct: calcAnnualizedReturn(sliced),
    annualized_volatility_pct: calcAnnualizedVolatility(sliced),
    expense_ratio_pct: getExpenseRatio(fundCode),
    momentum_score: calcMomentumScore(sliced),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/metrics.ts
git commit -m "feat(mpf-care): add quant metrics engine — Sharpe, Sortino, drawdown, CAGR, volatility, momentum"
```

---

## Task 4: Metrics Computation Cron

**Files:**
- Create: `src/app/api/mpf/cron/metrics/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create metrics cron route**

Create `src/app/api/mpf/cron/metrics/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAllMetrics } from "@/lib/mpf/metrics";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";
import type { MetricPeriod } from "@/lib/mpf/types";

export const maxDuration = 60;

const PERIODS: MetricPeriod[] = ["1y", "3y", "5y", "since_launch"];

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();
  let totalUpserted = 0;

  try {
    // Get all active funds
    const { data: funds } = await supabase
      .from("mpf_funds")
      .select("id, fund_code")
      .eq("is_active", true);

    if (!funds?.length) {
      return NextResponse.json({ ok: true, count: 0, reason: "No active funds" });
    }

    // For each fund, get all prices and compute metrics
    for (const fund of funds) {
      const { data: prices } = await supabase
        .from("mpf_prices")
        .select("date, nav")
        .eq("fund_id", fund.id)
        .order("date", { ascending: true });

      if (!prices?.length) continue;

      for (const period of PERIODS) {
        const metrics = computeAllMetrics(prices, fund.fund_code, period);

        // Skip if all metrics are null (insufficient data)
        const hasData = Object.values(metrics).some(v => v !== null);
        if (!hasData) continue;

        await supabase
          .from("mpf_fund_metrics")
          .upsert(
            {
              fund_id: fund.id,
              fund_code: fund.fund_code,
              period,
              ...metrics,
              computed_at: new Date().toISOString(),
            },
            { onConflict: "fund_id,period" }
          );

        totalUpserted++;
      }
    }

    // Log scraper run
    await supabase.from("scraper_runs").insert({
      scraper_name: "fund_metrics",
      status: "success",
      records_processed: totalUpserted,
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      ok: true,
      count: totalUpserted,
      funds: funds.length,
      ms: Date.now() - startTime,
    });
  } catch (error) {
    await supabase.from("scraper_runs").insert({
      scraper_name: "fund_metrics",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      duration_ms: Date.now() - startTime,
    });

    await sendDiscordAlert({
      title: "❌ MPF Care — Metrics Computation Failed",
      description: `**Error:** ${sanitizeError(error)}\n**Duration:** ${Date.now() - startTime}ms`,
      color: COLORS.red,
    });

    return NextResponse.json({ error: "Metrics computation failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add metrics cron to vercel.json**

Add to the `crons` array in `vercel.json` (after the prices cron — runs 1 hour after prices at noon HKT weekdays):
```json
{
  "path": "/api/mpf/cron/metrics",
  "schedule": "0 12 * * 1-5"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mpf/cron/metrics/route.ts vercel.json
git commit -m "feat(mpf-care): add daily metrics computation cron"
```

---

## Task 5: Fund Screener Page

**Files:**
- Create: `src/app/(app)/mpf-care/screener/page.tsx`
- Modify: `src/app/(app)/mpf-care/page.tsx:159-182` (nav section)

- [ ] **Step 1: Create screener page**

Create `src/app/(app)/mpf-care/screener/page.tsx`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import { SCREENER_CATEGORIES, FUND_CATEGORY_LABELS } from "@/lib/mpf/constants";
import type { FundMetrics, FundCategory } from "@/lib/mpf/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { BarChart3 } from "lucide-react";

function formatMetric(val: number | null, decimals = 2, suffix = ""): string {
  if (val === null) return "—";
  return `${val > 0 ? "+" : ""}${val.toFixed(decimals)}${suffix}`;
}

function metricColor(val: number | null, invertForDrawdown = false): string {
  if (val === null) return "text-zinc-500";
  if (invertForDrawdown) {
    // For drawdown: closer to 0 is better (green), more negative is worse (red)
    if (val > -0.05) return "text-emerald-400";
    if (val > -0.15) return "text-amber-400";
    return "text-red-400";
  }
  if (val > 1) return "text-emerald-400";
  if (val > 0) return "text-zinc-200";
  return "text-red-400";
}

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; sort?: string; period?: string }>;
}) {
  const { category = "All", sort = "sortino_ratio", period = "3y" } = await searchParams;
  const supabase = await createClient();

  // Fetch metrics for selected period, joined with fund metadata
  const { data: metrics } = await supabase
    .from("mpf_fund_metrics")
    .select("*, mpf_funds(name_en, name_zh, category, risk_rating)")
    .eq("period", period)
    .order(sort, { ascending: false, nullsFirst: false });

  // Filter by category
  const categoryFilter = SCREENER_CATEGORIES[category as keyof typeof SCREENER_CATEGORIES];
  const filtered = categoryFilter
    ? (metrics || []).filter((m: any) => categoryFilter.includes(m.mpf_funds?.category))
    : (metrics || []);

  const columns = [
    { key: "fund_code", label: "Fund", sortable: false },
    { key: "category", label: "Category", sortable: false },
    { key: "expense_ratio_pct", label: "FER %", sortable: true },
    { key: "sortino_ratio", label: "Sortino", sortable: true },
    { key: "max_drawdown_pct", label: "Max DD", sortable: true },
    { key: "annualized_return_pct", label: "CAGR", sortable: true },
    { key: "momentum_score", label: "Mom 3M", sortable: true },
    { key: "risk_rating", label: "Risk", sortable: false },
  ];

  const periods = ["1y", "3y", "5y", "since_launch"];

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <a href="/mpf-care" className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors">
            ← MPF Care
          </a>
        </div>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-zinc-400" />
          <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
            Fund Screener
          </h1>
        </div>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          Risk-adjusted metrics for all AIA MPF funds — sorted by Sortino ratio (downside protection)
        </p>
      </header>

      <DisclaimerBanner />

      {/* Period toggle */}
      <div className="mt-8 flex items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Period:</span>
        {periods.map((p) => (
          <a
            key={p}
            href={`/mpf-care/screener?period=${p}&category=${category}&sort=${sort}`}
            className={cn(
              "text-[11px] font-mono px-2 py-1 rounded transition-colors",
              p === period
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {p === "since_launch" ? "All" : p.toUpperCase()}
          </a>
        ))}
      </div>

      {/* Category tabs */}
      <nav className="mt-4 flex items-center gap-1" aria-label="Fund categories">
        {Object.keys(SCREENER_CATEGORIES).map((cat) => (
          <a
            key={cat}
            href={`/mpf-care/screener?category=${cat}&sort=${sort}&period=${period}`}
            className={cn(
              "text-[11px] font-medium px-3 py-1.5 rounded-md transition-colors",
              cat === category
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {cat}
          </a>
        ))}
      </nav>

      {/* Table */}
      <div className="mt-8 border border-zinc-800/60 rounded-lg overflow-x-auto">
        {/* Header */}
        <div className="grid grid-cols-[1fr_100px_60px_65px_70px_65px_65px_50px] bg-zinc-900/80 px-4 py-2 border-b border-zinc-800/60 min-w-[700px]">
          {columns.map((col) => (
            <div key={col.key} className={cn("text-[10px] font-mono uppercase tracking-wider text-zinc-400", col.key !== "fund_code" && "text-right")}>
              {col.sortable ? (
                <a
                  href={`/mpf-care/screener?sort=${col.key}&category=${category}&period=${period}`}
                  className={cn("hover:text-zinc-200 transition-colors", sort === col.key && "text-zinc-100")}
                >
                  {col.label} {sort === col.key && "↓"}
                </a>
              ) : (
                col.label
              )}
            </div>
          ))}
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">
            No metrics computed yet. Run the metrics cron first.
          </div>
        ) : (
          filtered.map((m: any) => {
            const fund = m.mpf_funds;
            return (
              <Link
                key={m.fund_code}
                href={`/mpf-care/funds/${m.fund_code}`}
                className="grid grid-cols-[1fr_100px_60px_65px_70px_65px_65px_50px] px-4 py-3 border-b border-zinc-800/40 last:border-b-0 items-center hover:bg-zinc-900/40 transition-colors min-w-[700px]"
              >
                <div>
                  <span className="text-[13px] text-zinc-200">{fund?.name_en}</span>
                  <span className="text-[10px] text-zinc-400 ml-2 font-mono">{m.fund_code}</span>
                </div>
                <span className="text-[11px] text-zinc-400 text-right">
                  {FUND_CATEGORY_LABELS[fund?.category as FundCategory] || fund?.category}
                </span>
                <span className="text-[12px] font-mono tabular-nums text-right text-zinc-300">
                  {m.expense_ratio_pct !== null ? `${m.expense_ratio_pct.toFixed(2)}` : "—"}
                </span>
                <span className={cn("text-[12px] font-mono tabular-nums text-right", metricColor(m.sortino_ratio))}>
                  {formatMetric(m.sortino_ratio)}
                </span>
                <span className={cn("text-[12px] font-mono tabular-nums text-right", metricColor(m.max_drawdown_pct, true))}>
                  {m.max_drawdown_pct !== null ? `${(m.max_drawdown_pct * 100).toFixed(1)}%` : "—"}
                </span>
                <span className={cn("text-[12px] font-mono tabular-nums text-right", metricColor(m.annualized_return_pct))}>
                  {m.annualized_return_pct !== null ? `${(m.annualized_return_pct * 100).toFixed(1)}%` : "—"}
                </span>
                <span className={cn("text-[12px] font-mono tabular-nums text-right", metricColor(m.momentum_score))}>
                  {m.momentum_score !== null ? `${(m.momentum_score * 100).toFixed(1)}%` : "—"}
                </span>
                <span className="text-[12px] text-amber-500 text-right">
                  {"★".repeat(fund?.risk_rating || 0)}
                </span>
              </Link>
            );
          })
        )}
      </div>

      <div className="mt-8">
        <DisclaimerBanner />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add Screener link to MPF Care nav**

In `src/app/(app)/mpf-care/page.tsx`, add the Screener link to the nav section (after the News link, before Insights). Add `BarChart3` to the lucide import on line 8:

Import change (line 8):
```typescript
import { TrendingUp, Newspaper, Brain, Activity, BarChart3 } from "lucide-react";
```

Add after the News `<a>` tag (after line 167):
```typescript
        <a
          href="/mpf-care/screener"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-1.5 rounded-md transition-colors"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Screener
        </a>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/mpf-care/screener/page.tsx src/app/\(app\)/mpf-care/page.tsx
git commit -m "feat(mpf-care): add Fund Screener page with sortable metrics table"
```

---

## Task 6: Risk Metrics Component

**Files:**
- Create: `src/components/mpf/risk-metrics.tsx`

- [ ] **Step 1: Create risk-metrics component**

Create `src/components/mpf/risk-metrics.tsx`:
```typescript
"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import type { FundMetrics, MetricPeriod } from "@/lib/mpf/types";

interface RiskMetricsProps {
  metrics: Record<MetricPeriod, FundMetrics | null>;
}

function metricColor(val: number | null, type: "ratio" | "drawdown" | "return" | "neutral"): string {
  if (val === null) return "text-zinc-500";
  switch (type) {
    case "ratio":
      if (val > 1) return "text-emerald-400";
      if (val > 0) return "text-zinc-200";
      return "text-red-400";
    case "drawdown":
      if (val > -0.05) return "text-emerald-400";
      if (val > -0.15) return "text-amber-400";
      return "text-red-400";
    case "return":
      if (val > 0) return "text-emerald-400";
      if (val < 0) return "text-red-400";
      return "text-zinc-300";
    default:
      return "text-zinc-300";
  }
}

export function RiskMetrics({ metrics }: RiskMetricsProps) {
  const [period, setPeriod] = useState<MetricPeriod>("3y");
  const m = metrics[period];

  const periods: { key: MetricPeriod; label: string }[] = [
    { key: "1y", label: "1Y" },
    { key: "3y", label: "3Y" },
    { key: "5y", label: "5Y" },
    { key: "since_launch", label: "All" },
  ];

  const cards = [
    {
      label: "Sortino",
      value: m?.sortino_ratio,
      format: (v: number) => v.toFixed(2),
      type: "ratio" as const,
      tooltip: "Return per unit of downside risk. Higher = better downside protection.",
    },
    {
      label: "Sharpe",
      value: m?.sharpe_ratio,
      format: (v: number) => v.toFixed(2),
      type: "ratio" as const,
      tooltip: "Return per unit of total risk. >1 good, >1.5 excellent.",
    },
    {
      label: "Max Drawdown",
      value: m?.max_drawdown_pct,
      format: (v: number) => `${(v * 100).toFixed(1)}%`,
      type: "drawdown" as const,
      tooltip: "Worst peak-to-trough decline. Closer to 0% = less downside risk.",
    },
    {
      label: "Volatility",
      value: m?.annualized_volatility_pct,
      format: (v: number) => `${(v * 100).toFixed(1)}%`,
      type: "neutral" as const,
      tooltip: "Annualized standard deviation of daily returns.",
    },
    {
      label: "FER",
      value: m?.expense_ratio_pct,
      format: (v: number) => `${v.toFixed(2)}%`,
      type: "neutral" as const,
      tooltip: "Fund Expense Ratio — annual fee. Lower = better.",
    },
  ];

  return (
    <section aria-labelledby="risk-metrics-heading">
      <div className="flex items-center justify-between mb-4">
        <h2 id="risk-metrics-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
          Risk Metrics
        </h2>
        <div className="flex items-center gap-1">
          {periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                "text-[10px] font-mono px-2 py-0.5 rounded transition-colors",
                p.key === period ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!m ? (
        <p className="text-sm text-zinc-400">Insufficient data for this period.</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {cards.map((card) => (
            <div
              key={card.label}
              className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-3"
              title={card.tooltip}
            >
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
                {card.label}
              </div>
              <div className={cn("text-lg font-mono font-semibold tabular-nums", metricColor(card.value ?? null, card.type))}>
                {card.value !== null && card.value !== undefined ? card.format(card.value) : "—"}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/mpf/risk-metrics.tsx
git commit -m "feat(mpf-care): add RiskMetrics component with period toggle"
```

---

## Task 7: Fund Detail Page — Integrate Risk Metrics

**Files:**
- Modify: `src/app/(app)/mpf-care/funds/[fund_code]/page.tsx`

- [ ] **Step 1: Add risk metrics data fetching and component**

In `src/app/(app)/mpf-care/funds/[fund_code]/page.tsx`:

Add import at top (after existing imports):
```typescript
import { RiskMetrics } from "@/components/mpf/risk-metrics";
import type { FundMetrics, MetricPeriod } from "@/lib/mpf/types";
```

After the correlated news fetch (~line 39), add metrics fetch:
```typescript
  // Get risk metrics for all periods
  const { data: allMetrics } = await supabase
    .from("mpf_fund_metrics")
    .select("*")
    .eq("fund_id", fund.id);

  const metricsMap: Record<MetricPeriod, FundMetrics | null> = {
    "1y": null, "3y": null, "5y": null, "since_launch": null,
  };
  for (const m of allMetrics || []) {
    metricsMap[m.period as MetricPeriod] = m as FundMetrics;
  }
```

After the `{/* Price Chart */}` section (after line 92), add:
```typescript
      {/* Risk Metrics */}
      <div className="mb-16">
        <RiskMetrics metrics={metricsMap} />
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/mpf-care/funds/\[fund_code\]/page.tsx
git commit -m "feat(mpf-care): integrate risk metrics into fund detail page"
```

---

## Task 8: Dual-Agent Debate Rebalancer

**Prerequisite:** The metrics cron (Task 4) must run at least once before this rebalancer produces meaningful quant data. Without metrics in `mpf_fund_metrics`, the Quant Agent will receive empty data and the debate will be one-sided.

**Files:**
- Modify: `src/lib/mpf/rebalancer.ts` (full rewrite)

- [ ] **Step 1: Rewrite rebalancer.ts with 4-call debate pipeline**

Replace the entire contents of `src/lib/mpf/rebalancer.ts`:
```typescript
// src/lib/mpf/rebalancer.ts — Dual-Agent Debate Rebalancer
// 4-call pipeline: Quant (parallel) + News (parallel) → Debate → Mediator
import { createAdminClient } from "@/lib/supabase/admin";
import { INVESTMENT_PROFILE } from "./constants";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4.6";
const PER_CALL_TIMEOUT = 30000; // 30s

interface PortfolioProposal {
  funds: { code: string; weight: number; reasoning: string }[];
  summary: string;
}

interface DebateResult {
  agreements: string[];
  conflicts: { topic: string; quantPosition: string; newsPosition: string; verdict: string; reasoning: string }[];
  recommendation: string;
}

interface MediatorResult {
  funds: { code: string; weight: number }[];
  summary_en: string;
  summary_zh: string;
  debate_log: string;
}

interface RebalanceResult {
  rebalanced: boolean;
  reason: string;
  debate_log?: string;
}

async function callGateway(systemPrompt: string, userContent: string): Promise<string> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) throw new Error("No AI_GATEWAY_API_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT);

  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`AI Gateway ${res.status}`);

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

function parseJSON<T>(raw: string): T | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

/**
 * Check if portfolio needs rebalancing and execute via dual-agent debate.
 * Called after news classification to react to market events.
 *
 * Rules:
 * - Max 1 rebalance/week for normal drift
 * - Max 3 rebalances/day (absolute ceiling)
 * - NO weekly limit for high-impact news (still capped at 3/day)
 */
export async function evaluateAndRebalance(highImpactCount: number): Promise<RebalanceResult> {
  const supabase = createAdminClient();

  // Daily cap: max 3 rebalances per day
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from("mpf_insights")
    .select("id", { count: "exact", head: true })
    .in("type", ["alert", "rebalance_debate"])
    .in("trigger", ["portfolio_rebalance", "debate_rebalance"])
    .gte("created_at", todayStart.toISOString());

  if ((todayCount || 0) >= 3) {
    return { rebalanced: false, reason: "Daily rebalance cap reached (3/day)" };
  }

  // Weekly rate limit (skip if high-impact news)
  if (highImpactCount === 0) {
    const { data: lastRebalance } = await supabase
      .from("mpf_insights")
      .select("created_at")
      .in("type", ["alert", "rebalance_debate"])
      .in("trigger", ["portfolio_rebalance", "debate_rebalance"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (lastRebalance) {
      const daysSince = (Date.now() - new Date(lastRebalance.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        return { rebalanced: false, reason: `Last rebalance ${daysSince.toFixed(1)} days ago, no high-impact news` };
      }
    }
  }

  // Gather data for agents
  const { data: portfolio } = await supabase
    .from("mpf_reference_portfolio")
    .select("fund_id, weight, note");

  if (!portfolio?.length) return { rebalanced: false, reason: "No reference portfolio set" };

  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("id, fund_code, name_en, category, risk_rating");

  const fundMap = new Map((funds || []).map(f => [f.id, f]));
  const fundCodeToId = new Map((funds || []).map(f => [f.fund_code, f.id]));

  const currentHoldings = portfolio.map(p => {
    const fund = fundMap.get(p.fund_id);
    return { code: fund?.fund_code || "", name: fund?.name_en || "", weight: p.weight };
  });

  // Get fund metrics
  const { data: metrics } = await supabase
    .from("mpf_fund_metrics")
    .select("*")
    .eq("period", "3y");

  const metricsText = (metrics || []).map(m =>
    `${m.fund_code}: Sortino=${m.sortino_ratio?.toFixed(2) ?? "N/A"}, Sharpe=${m.sharpe_ratio?.toFixed(2) ?? "N/A"}, MaxDD=${m.max_drawdown_pct !== null ? (m.max_drawdown_pct * 100).toFixed(1) + "%" : "N/A"}, CAGR=${m.annualized_return_pct !== null ? (m.annualized_return_pct * 100).toFixed(1) + "%" : "N/A"}, FER=${m.expense_ratio_pct?.toFixed(2) ?? "N/A"}%, Mom3M=${m.momentum_score !== null ? (m.momentum_score * 100).toFixed(1) + "%" : "N/A"}`
  ).join("\n");

  // Get recent news
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentNews } = await supabase
    .from("mpf_news")
    .select("headline, impact_tags, sentiment, region, is_high_impact")
    .gte("published_at", twoDaysAgo)
    .order("published_at", { ascending: false })
    .limit(20);

  const newsText = (recentNews || []).map(n =>
    `[${n.sentiment}/${n.region}${n.is_high_impact ? "/HIGH-IMPACT" : ""}] ${n.headline} (tags: ${n.impact_tags?.join(", ") || "none"})`
  ).join("\n");

  const currentPortfolioText = currentHoldings.map(h => `${h.code} (${h.name}): ${h.weight}%`).join("\n");
  const profileText = `Profile: ${INVESTMENT_PROFILE.label}, equity target ${INVESTMENT_PROFILE.equity_pct}%`;

  const availableFunds = (funds || []).map(f => `${f.fund_code} (${f.name_en})`).join(", ");

  const sharedConstraints = `
STRICT RULES:
1. Output exactly 3 funds. Duplicates allowed (e.g., all 3 can be the same fund for 100% concentration).
2. Weights: 0-100% in 10% increments. Total MUST = 100%.
3. Prioritize: (1) capital preservation, (2) long-term compounding. Never chase short-term returns.
4. 100% equity is valid. 100% cash (AIA-CON) is valid. No allocation limits.
Available funds: ${availableFunds}

Return ONLY valid JSON (no markdown):
{ "funds": [{ "code": "AIA-XXX", "weight": 50, "reasoning": "why" }, ...], "summary": "1-2 sentence summary" }`;

  // ===== STEP 1: Parallel proposals =====
  const [quantRaw, newsRaw] = await Promise.all([
    callGateway(
      "You are a quantitative analyst for an MPF pension fund. Propose a 3-fund portfolio based PURELY on the metrics below. Ignore news — focus only on the numbers.",
      `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nFUND METRICS (3Y):\n${metricsText}\n\n${sharedConstraints}`
    ),
    callGateway(
      "You are a market analyst for an MPF pension fund. Propose a 3-fund portfolio based on current market conditions and recent news sentiment. Ignore quantitative metrics — focus on macro trends and risk events.",
      `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nRECENT NEWS (48h):\n${newsText || "No recent news"}\n\n${sharedConstraints}`
    ),
  ]);

  const quantProposal = parseJSON<PortfolioProposal>(quantRaw);
  const newsProposal = parseJSON<PortfolioProposal>(newsRaw);

  if (!quantProposal || !newsProposal) {
    return { rebalanced: false, reason: "Failed to parse agent proposals" };
  }

  // ===== STEP 2: Debate =====
  const debateRaw = await callGateway(
    "You are a senior portfolio analyst reviewing two independent proposals for a pension fund. Identify where they agree, where they conflict, and for each conflict argue which position is stronger and why. Be decisive — don't hedge. If one agent is clearly wrong, say so.",
    `QUANT AGENT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS AGENT PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nReturn JSON: { "agreements": ["..."], "conflicts": [{ "topic": "...", "quantPosition": "...", "newsPosition": "...", "verdict": "quant|news", "reasoning": "..." }], "recommendation": "1-2 sentence recommendation" }`
  );

  const debate = parseJSON<DebateResult>(debateRaw);
  if (!debate) {
    return { rebalanced: false, reason: "Failed to parse debate" };
  }

  // ===== STEP 3: Mediator =====
  const mediatorRaw = await callGateway(
    `You are the chief investment officer making the final portfolio allocation. Produce the consensus 3-fund portfolio based on the debate below. ${sharedConstraints}\n\nReturn JSON: { "funds": [{ "code": "AIA-XXX", "weight": 50 }, ...], "summary_en": "plain English summary for the team", "summary_zh": "中文摘要", "debate_log": "Quant said X. News said Y. They agreed on Z. Final decision: ..." }`,
    `QUANT PROPOSAL:\n${JSON.stringify(quantProposal, null, 2)}\n\nNEWS PROPOSAL:\n${JSON.stringify(newsProposal, null, 2)}\n\nDEBATE:\n${JSON.stringify(debate, null, 2)}\n\nFUND METRICS:\n${metricsText}\n\nNEWS SUMMARY:\n${newsText || "No recent news"}`
  );

  const mediator = parseJSON<MediatorResult>(mediatorRaw);
  if (!mediator) {
    return { rebalanced: false, reason: "Failed to parse mediator verdict" };
  }

  // ===== VALIDATION =====
  let newPortfolio = mediator.funds;
  if (!Array.isArray(newPortfolio) || newPortfolio.length < 1) {
    return { rebalanced: false, reason: "Mediator proposed empty portfolio" };
  }

  // Truncate to 3 if needed
  if (newPortfolio.length > 3) {
    newPortfolio = newPortfolio.sort((a, b) => b.weight - a.weight).slice(0, 3);
    const rawTotal = newPortfolio.reduce((s, p) => s + p.weight, 0);
    newPortfolio = newPortfolio.map(p => ({ ...p, weight: Math.round((p.weight / rawTotal) * 10) * 10 }));
    const scaledTotal = newPortfolio.reduce((s, p) => s + p.weight, 0);
    if (scaledTotal !== 100) newPortfolio[0].weight += 100 - scaledTotal;
  }

  // Pad to 3 if fewer
  if (newPortfolio.length < 3) {
    const usedCodes = new Set(newPortfolio.map(p => p.code));
    const fillers = ["AIA-CON", "AIA-ABF", "AIA-GBF"].filter(c => !usedCodes.has(c));
    while (newPortfolio.length < 3 && fillers.length > 0) {
      newPortfolio.push({ code: fillers.shift()!, weight: 0 });
    }
  }

  const totalWeight = newPortfolio.reduce((s, p) => s + p.weight, 0);
  if (totalWeight !== 100) {
    return { rebalanced: false, reason: `Portfolio total ${totalWeight}% (must be 100%)` };
  }

  for (const p of newPortfolio) {
    if (p.weight < 0 || p.weight > 100 || p.weight % 10 !== 0) {
      return { rebalanced: false, reason: `Invalid weight ${p.weight}% for ${p.code}` };
    }
  }

  const activePortfolio = newPortfolio.filter(p => p.weight > 0);
  if (activePortfolio.length === 0) {
    return { rebalanced: false, reason: "All funds at 0%" };
  }

  // ===== APPLY =====
  await supabase.from("mpf_reference_portfolio").delete().neq("fund_id", "00000000-0000-0000-0000-000000000000");

  for (const p of activePortfolio) {
    const fund_id = fundCodeToId.get(p.code);
    if (!fund_id) continue;
    await supabase.from("mpf_reference_portfolio").insert({
      fund_id,
      weight: p.weight,
      note: `Debate consensus`,
      updated_by: "debate-rebalancer",
    });
  }

  // Full debate log
  const fullDebateLog = [
    "## Quant Agent",
    quantProposal.summary,
    quantProposal.funds.map(f => `- ${f.code}: ${f.weight}% — ${f.reasoning}`).join("\n"),
    "",
    "## News Agent",
    newsProposal.summary,
    newsProposal.funds.map(f => `- ${f.code}: ${f.weight}% — ${f.reasoning}`).join("\n"),
    "",
    "## Debate",
    `Agreements: ${debate.agreements.join("; ")}`,
    ...debate.conflicts.map(c => `Conflict: ${c.topic} — Verdict: ${c.verdict} — ${c.reasoning}`),
    "",
    "## Final Decision",
    mediator.debate_log,
  ].join("\n");

  await supabase.from("mpf_insights").insert({
    type: "rebalance_debate",
    trigger: "debate_rebalance",
    content_en: `${mediator.summary_en}\n\n---\n\n${fullDebateLog}`,
    content_zh: mediator.summary_zh,
    fund_categories: [...new Set(activePortfolio.map(p => {
      const fund = funds?.find(f => f.fund_code === p.code);
      return fund?.category || "unknown";
    }))],
    status: "completed",
    model: MODEL,
  });

  return {
    rebalanced: true,
    reason: mediator.summary_en,
    debate_log: fullDebateLog,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/rebalancer.ts
git commit -m "feat(mpf-care): replace single-AI rebalancer with 4-call dual-agent debate pipeline"
```

---

## Task 9: Debate Log Component

**Files:**
- Create: `src/components/mpf/debate-log.tsx`

- [ ] **Step 1: Create debate-log component**

Create `src/components/mpf/debate-log.tsx`:
```typescript
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface DebateLogProps {
  summaryEn: string;
  summaryZh: string;
  fullLog: string; // The full debate log markdown
  createdAt: string;
}

export function DebateLog({ summaryEn, summaryZh, fullLog, createdAt }: DebateLogProps) {
  const [expanded, setExpanded] = useState(false);

  // Split summary from full log (summary is before the --- separator)
  const summary = summaryEn.split("---")[0].trim();
  const debateContent = fullLog || summaryEn.split("---").slice(1).join("---").trim();

  return (
    <div className="mt-4 border border-zinc-800/60 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-900/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            Why This Allocation
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {new Date(createdAt).toLocaleDateString("en-HK")}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-zinc-800/40">
          {/* Summary */}
          <p className="text-[13px] text-zinc-300 leading-relaxed mt-3 mb-4">
            {summary}
          </p>

          {/* Full debate log */}
          {debateContent && (
            <div className="bg-zinc-950/50 rounded-md p-4 text-[12px] font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
              {debateContent}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/mpf/debate-log.tsx
git commit -m "feat(mpf-care): add expandable DebateLog component"
```

---

## Task 10: Dashboard — Integrate Debate Log

**Files:**
- Modify: `src/app/(app)/mpf-care/page.tsx`

- [ ] **Step 1: Add debate log to dashboard**

In `src/app/(app)/mpf-care/page.tsx`:

Add import at top:
```typescript
import { DebateLog } from "@/components/mpf/debate-log";
```

In `getOverviewData()`, after the `latestInsight` query (~line 116), add:
```typescript
  // Get latest debate log
  const { data: latestDebate } = await supabase
    .from("mpf_insights")
    .select("content_en, content_zh, created_at")
    .eq("type", "rebalance_debate")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
```

Add `latestDebate` to the return object (~line 135).

In the JSX, after the `<PortfolioReference>` closing div (after line 191), add:
```typescript
      {/* Debate Log — Why this allocation */}
      {latestDebate && (
        <DebateLog
          summaryEn={latestDebate.content_en || ""}
          summaryZh={latestDebate.content_zh || ""}
          fullLog={latestDebate.content_en?.split("---").slice(1).join("---").trim() || ""}
          createdAt={latestDebate.created_at}
        />
      )}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/mpf-care/page.tsx
git commit -m "feat(mpf-care): integrate debate log on MPF Care dashboard"
```

---

## Task 11: Brave Search Data Backfill

**Files:**
- Create: `src/lib/mpf/scrapers/brave-search.ts`
- Modify: `src/app/api/mpf/cron/prices/route.ts`

- [ ] **Step 1: Create brave-search.ts scraper**

Create `src/lib/mpf/scrapers/brave-search.ts`:
```typescript
// src/lib/mpf/scrapers/brave-search.ts — Backfill NAV data for 5 missing funds
import { createAdminClient } from "@/lib/supabase/admin";
import { MISSING_DAILY_DATA_FUNDS, AIA_FUNDS } from "../constants";

const BRAVE_API = "https://api.search.brave.com/res/v1/web/search";

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  extra_snippets?: string[];
}

/**
 * Fetch missing fund prices via Brave Search API.
 * Queries for each missing fund's latest NAV and inserts into mpf_prices.
 * Returns count of prices inserted.
 */
export async function fetchMissingFundPrices(): Promise<number> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    console.log("[brave-search] No BRAVE_SEARCH_API_KEY, skipping");
    return 0;
  }

  const supabase = createAdminClient();
  let inserted = 0;

  for (const fundCode of MISSING_DAILY_DATA_FUNDS) {
    const fundInfo = AIA_FUNDS.find(f => f.fund_code === fundCode);
    if (!fundInfo) continue;

    const now = new Date();
    const monthYear = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const query = `AIA MPF "${fundInfo.name_en}" unit price ${monthYear}`;

    try {
      const res = await fetch(`${BRAVE_API}?q=${encodeURIComponent(query)}&count=5`, {
        headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.error(`[brave-search] API error ${res.status} for ${fundCode}`);
        continue;
      }

      const data = await res.json();
      const results: BraveSearchResult[] = data.web?.results || [];

      // Try to extract NAV from snippets
      let nav: number | null = null;
      let priceDate: string | null = null;

      for (const result of results) {
        const text = [result.description, ...(result.extra_snippets || [])].join(" ");

        // Look for patterns like "$12.3456" or "HK$12.3456" or "NAV 12.3456"
        const navMatch = text.match(/(?:NAV|price|unit\s*price)[:\s]*(?:HK?\$?)?\s*(\d+\.?\d{0,4})/i)
          || text.match(/(?:HK?\$)\s*(\d+\.?\d{0,4})/i);

        if (navMatch) {
          const parsed = parseFloat(navMatch[1]);
          // Validate: MPF NAV typically 0.5 - 500
          if (parsed >= 0.5 && parsed <= 500) {
            nav = parsed;
            // Try to extract date
            const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
            if (dateMatch) {
              const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
              priceDate = `${year}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
            }
            break;
          }
        }
      }

      if (nav === null) {
        console.log(`[brave-search] No NAV found for ${fundCode}`);
        continue;
      }

      // Use today if no date extracted
      if (!priceDate) {
        priceDate = new Date().toISOString().split("T")[0];
      }

      // Get fund_id
      const { data: fund } = await supabase
        .from("mpf_funds")
        .select("id")
        .eq("fund_code", fundCode)
        .single();

      if (!fund) continue;

      // Check if we already have this date
      const { data: existing } = await supabase
        .from("mpf_prices")
        .select("id")
        .eq("fund_id", fund.id)
        .eq("date", priceDate)
        .single();

      if (existing) {
        console.log(`[brave-search] ${fundCode} already has price for ${priceDate}`);
        continue;
      }

      // Calculate daily change from previous price
      const { data: prevPrice } = await supabase
        .from("mpf_prices")
        .select("nav")
        .eq("fund_id", fund.id)
        .lt("date", priceDate)
        .order("date", { ascending: false })
        .limit(1)
        .single();

      const dailyChange = prevPrice ? ((nav - prevPrice.nav) / prevPrice.nav) * 100 : null;

      await supabase.from("mpf_prices").insert({
        fund_id: fund.id,
        date: priceDate,
        nav,
        daily_change_pct: dailyChange,
        source: "brave_search",
      });

      inserted++;
      console.log(`[brave-search] ${fundCode}: NAV ${nav} on ${priceDate}`);
    } catch (err) {
      console.error(`[brave-search] Error for ${fundCode}:`, err);
    }
  }

  return inserted;
}
```

- [ ] **Step 2: Add Brave Search as Step 4 in prices cron**

In `src/app/api/mpf/cron/prices/route.ts`, add import at top:
```typescript
import { fetchMissingFundPrices } from "@/lib/mpf/scrapers/brave-search";
```

After STEP 3 (MPFA fallback, ~line 90), before `// Update scraper run`, add:
```typescript
    // STEP 4: Brave Search backfill for 5 missing funds
    let braveCount = 0;
    try {
      braveCount = await fetchMissingFundPrices();
      if (braveCount > 0) {
        console.log(`[prices-cron] Brave Search backfill: ${braveCount} prices inserted`);
      }
    } catch (braveErr) {
      console.error("[prices-cron] Brave Search backfill failed:", braveErr);
    }
```

Update the response on the success path to include `brave: braveCount`.

- [ ] **Step 3: Add BRAVE_SEARCH_API_KEY to Vercel**

Run: `vercel env add BRAVE_SEARCH_API_KEY` (user must provide the key after signing up at https://brave.com/search/api/)

- [ ] **Step 4: Commit**

```bash
git add src/lib/mpf/scrapers/brave-search.ts src/app/api/mpf/cron/prices/route.ts
git commit -m "feat(mpf-care): add Brave Search NAV backfill for 5 missing funds"
```

---

## Task 12: Deploy + Verify

**Files:** None (deployment + testing)

- [ ] **Step 1: Run local build to catch type errors**

```bash
cd /Users/kingyuenjonathanlee/Documents/ClaudeWorkSpace/02_Product/aia-assistant
npm run build 2>&1 | head -50
```

Expected: Build succeeds. If type errors, fix them before proceeding.

- [ ] **Step 2: Trigger metrics cron locally to populate data**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/mpf/cron/metrics
```

Expected: JSON response with `ok: true, count: 60+` (15 funds × 4 periods).

- [ ] **Step 3: Verify screener page loads**

Open `http://localhost:3000/mpf-care/screener` — should show sortable table with metrics.

- [ ] **Step 4: Verify fund detail page shows risk metrics**

Open `http://localhost:3000/mpf-care/funds/AIA-AEF` — should show Risk Metrics section below chart.

- [ ] **Step 5: Deploy to production**

```bash
vercel build --prod && vercel deploy --prebuilt --prod
```

- [ ] **Step 6: Trigger metrics cron on production**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://aia-assistant.vercel.app/api/mpf/cron/metrics
```

- [ ] **Step 7: Trigger news cron to test debate rebalancer**

Wait for next cron run or manually trigger:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://aia-assistant.vercel.app/api/mpf/cron/news
```

Check Discord for debate summary notification.

- [ ] **Step 8: Verify debate log on dashboard**

Open `https://aia-assistant.vercel.app/mpf-care` — debate log should appear below portfolio.

- [ ] **Step 9: Commit any remaining fixes**

```bash
git add -A && git commit -m "fix(mpf-care): post-deploy fixes for quant metrics + debate rebalancer"
```
