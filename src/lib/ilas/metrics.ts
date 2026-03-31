// src/lib/ilas/metrics.ts
// Thin wrapper around MPF's pure math metrics engine.
// ILAS uses the same Sharpe/Sortino/drawdown formulas — only the expense ratios differ.
// During bootstrap (< 20 data points), falls back to simplified inline calculations.

import {
  calcAnnualizedReturn,
  calcAnnualizedVolatility,
  calcSharpeRatio,
  calcSortinoRatio,
  calcMaxDrawdown,
  calcMomentumScore,
  slicePricesForPeriod,
} from "@/lib/mpf/metrics";
import { ILAS_RISK_FREE_RATE } from "./constants";
import type { MetricPeriod } from "./types";

// ILAS expense ratios are not publicly available per fund.
// Use 1.5% as default estimate (typical for ILAS underlying funds).
const DEFAULT_EXPENSE_RATIO = 1.5;

interface PricePoint {
  date: string;
  nav: number;
}

export interface IlasMetricsResult {
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  expense_ratio_pct: number | null;
  momentum_score: number | null;
}

/** Simple cumulative return for short series */
function simpleReturn(prices: PricePoint[]): number | null {
  if (prices.length < 2) return null;
  const start = prices[0].nav;
  const end = prices[prices.length - 1].nav;
  if (start <= 0) return null;
  return (end / start) - 1;
}

/** Simple max drawdown for any length >= 2 */
function simpleMaxDrawdown(prices: PricePoint[]): number | null {
  if (prices.length < 2) return null;
  let peak = prices[0].nav;
  let maxDd = 0;
  for (const p of prices) {
    if (p.nav > peak) peak = p.nav;
    const dd = (p.nav - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

/** Simple volatility for short series (annualized from daily) */
function simpleVolatility(prices: PricePoint[]): number | null {
  if (prices.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i].nav - prices[i - 1].nav) / prices[i - 1].nav);
  }
  const m = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - m) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Compute all quant metrics for an ILAS fund over a given period.
 * With >= 20 data points, delegates to the MPF metrics engine.
 * With 3-19 data points (bootstrap), uses simplified inline calcs.
 */
export function computeIlasMetrics(
  prices: PricePoint[],
  period: MetricPeriod,
  expenseRatio?: number
): IlasMetricsResult {
  const sliced = slicePricesForPeriod(prices, period);

  if (!sliced || sliced.length < 3) {
    return {
      sharpe_ratio: null,
      sortino_ratio: null,
      max_drawdown_pct: null,
      annualized_return_pct: null,
      annualized_volatility_pct: null,
      expense_ratio_pct: expenseRatio ?? DEFAULT_EXPENSE_RATIO,
      momentum_score: null,
    };
  }

  // Bootstrap mode: < 20 data points — use simplified calculations
  if (sliced.length < 20) {
    const ret = simpleReturn(sliced);
    const vol = simpleVolatility(sliced);
    const sharpe = ret !== null && vol !== null && vol > 0
      ? (ret - ILAS_RISK_FREE_RATE) / vol
      : null;

    return {
      sharpe_ratio: sharpe,
      sortino_ratio: null, // needs more data for meaningful downside deviation
      max_drawdown_pct: simpleMaxDrawdown(sliced),
      annualized_return_pct: ret,
      annualized_volatility_pct: vol,
      expense_ratio_pct: expenseRatio ?? DEFAULT_EXPENSE_RATIO,
      momentum_score: null, // needs 63 days
    };
  }

  // Full mode: >= 20 data points — use MPF metrics engine
  return {
    sharpe_ratio: calcSharpeRatio(sliced, ILAS_RISK_FREE_RATE),
    sortino_ratio: calcSortinoRatio(sliced, ILAS_RISK_FREE_RATE),
    max_drawdown_pct: calcMaxDrawdown(sliced),
    annualized_return_pct: calcAnnualizedReturn(sliced),
    annualized_volatility_pct: calcAnnualizedVolatility(sliced),
    expense_ratio_pct: expenseRatio ?? DEFAULT_EXPENSE_RATIO,
    momentum_score: calcMomentumScore(sliced),
  };
}
