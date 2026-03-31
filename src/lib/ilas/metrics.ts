// src/lib/ilas/metrics.ts
// Thin wrapper around MPF's pure math metrics engine.
// ILAS uses the same Sharpe/Sortino/drawdown formulas — only the expense ratios differ.

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

/**
 * Compute all quant metrics for an ILAS fund over a given period.
 * Delegates to the MPF metrics engine (pure math, no MPF coupling).
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
