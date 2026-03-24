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
