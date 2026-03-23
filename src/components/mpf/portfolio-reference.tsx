// src/components/mpf/portfolio-reference.tsx
"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { FundWithLatestPrice } from "@/lib/mpf/types";
import { FUND_CATEGORY_LABELS } from "@/lib/mpf/constants";
import type { FundCategory } from "@/lib/mpf/types";

interface PortfolioAllocation {
  fund_code: string;
  weight: number; // 10-100 in 10% increments
}

const WEIGHT_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const MAX_FUNDS = 5;
const STORAGE_KEY = "mpf-reference-portfolio";

function loadSavedPortfolio(): PortfolioAllocation[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function savePortfolio(portfolio: PortfolioAllocation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
}

interface PortfolioReferenceProps {
  funds: FundWithLatestPrice[];
  priceDate: string;
}

export function PortfolioReference({ funds, priceDate }: PortfolioReferenceProps) {
  const [portfolio, setPortfolio] = useState<PortfolioAllocation[]>(loadSavedPortfolio);
  const [isEditing, setIsEditing] = useState(portfolio.length === 0);

  const fundsWithPrices = funds.filter((f) => f.latest_nav !== null);
  const fundMap = new Map(funds.map((f) => [f.fund_code, f]));

  const totalWeight = portfolio.reduce((sum, p) => sum + p.weight, 0);
  const isValid = portfolio.length >= 1 && portfolio.length <= MAX_FUNDS && totalWeight === 100;

  // Weighted portfolio return
  const weightedReturn = portfolio.reduce((sum, p) => {
    const fund = fundMap.get(p.fund_code);
    return sum + (fund?.daily_change_pct || 0) * (p.weight / 100);
  }, 0);

  const updatePortfolio = useCallback((newPortfolio: PortfolioAllocation[]) => {
    setPortfolio(newPortfolio);
    savePortfolio(newPortfolio);
  }, []);

  const addFund = useCallback(() => {
    if (portfolio.length >= MAX_FUNDS) return;
    // Find first fund not already in portfolio
    const used = new Set(portfolio.map((p) => p.fund_code));
    const available = fundsWithPrices.find((f) => !used.has(f.fund_code));
    if (!available) return;
    updatePortfolio([...portfolio, { fund_code: available.fund_code, weight: 10 }]);
  }, [portfolio, fundsWithPrices, updatePortfolio]);

  const removeFund = useCallback((index: number) => {
    const updated = portfolio.filter((_, i) => i !== index);
    updatePortfolio(updated);
  }, [portfolio, updatePortfolio]);

  const changeFund = useCallback((index: number, fund_code: string) => {
    const updated = [...portfolio];
    updated[index] = { ...updated[index], fund_code };
    updatePortfolio(updated);
  }, [portfolio, updatePortfolio]);

  const changeWeight = useCallback((index: number, weight: number) => {
    const updated = [...portfolio];
    updated[index] = { ...updated[index], weight };
    updatePortfolio(updated);
  }, [portfolio, updatePortfolio]);

  // Funds available for selection (not already in portfolio, except current row)
  const getAvailableFunds = (currentCode: string) => {
    const used = new Set(portfolio.map((p) => p.fund_code));
    return fundsWithPrices.filter((f) => f.fund_code === currentCode || !used.has(f.fund_code));
  };

  // Remaining weight available
  const getRemainingWeight = (excludeIndex: number) => {
    return 100 - portfolio.reduce((sum, p, i) => i === excludeIndex ? sum : sum + p.weight, 0);
  };

  return (
    <section aria-labelledby="portfolio-ref-heading" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <h2
          id="portfolio-ref-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500"
        >
          Reference Portfolio — {priceDate}
        </h2>
        {portfolio.length > 0 && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors cursor-pointer"
          >
            {isEditing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {/* Portfolio summary cards — only show when portfolio is set */}
      {isValid && !isEditing && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Weighted Return</div>
            <div className={cn(
              "text-xl font-mono font-semibold tabular-nums",
              weightedReturn > 0 ? "text-emerald-400" : weightedReturn < 0 ? "text-red-400" : "text-zinc-400"
            )}>
              {weightedReturn > 0 ? "+" : ""}{weightedReturn.toFixed(2)}%
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Funds</div>
            <div className="text-xl font-mono font-semibold text-zinc-300">{portfolio.length}</div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4 col-span-2 lg:col-span-1">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Allocation</div>
            <div className="text-xl font-mono font-semibold text-zinc-300">{totalWeight}%</div>
          </div>
        </div>
      )}

      {/* Portfolio holdings */}
      {isEditing ? (
        /* Edit mode */
        <div className="space-y-3">
          {portfolio.map((alloc, index) => {
            const fund = fundMap.get(alloc.fund_code);
            const available = getAvailableFunds(alloc.fund_code);
            const maxWeight = getRemainingWeight(index);

            return (
              <div key={index} className="flex items-center gap-3 bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-3">
                {/* Fund selector */}
                <select
                  value={alloc.fund_code}
                  onChange={(e) => changeFund(index, e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-[13px] text-zinc-300 font-mono cursor-pointer focus:outline-none focus:border-zinc-500"
                >
                  {available.map((f) => (
                    <option key={f.fund_code} value={f.fund_code}>
                      {f.fund_code} — {f.name_en}
                    </option>
                  ))}
                </select>

                {/* Weight selector */}
                <select
                  value={alloc.weight}
                  onChange={(e) => changeWeight(index, Number(e.target.value))}
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-[13px] text-zinc-300 font-mono text-center cursor-pointer focus:outline-none focus:border-zinc-500"
                >
                  {WEIGHT_OPTIONS.filter((w) => w <= maxWeight || w === alloc.weight).map((w) => (
                    <option key={w} value={w}>{w}%</option>
                  ))}
                </select>

                {/* Remove button */}
                <button
                  onClick={() => removeFund(index)}
                  className="text-zinc-600 hover:text-red-400 transition-colors text-lg leading-none cursor-pointer"
                  aria-label={`Remove ${fund?.name_en}`}
                >
                  ×
                </button>
              </div>
            );
          })}

          {/* Add fund / status */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-4">
              {portfolio.length < MAX_FUNDS && totalWeight < 100 && (
                <button
                  onClick={addFund}
                  className="text-[12px] font-medium text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                >
                  + Add fund
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className={cn(
                "text-[11px] font-mono tabular-nums",
                totalWeight === 100 ? "text-emerald-500" : totalWeight > 100 ? "text-red-500" : "text-zinc-500"
              )}>
                {totalWeight}% / 100%
              </span>
              {isValid && (
                <button
                  onClick={() => setIsEditing(false)}
                  className="text-[12px] font-semibold text-emerald-500 hover:text-emerald-400 transition-colors cursor-pointer"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          {portfolio.length === 0 && (
            <div className="text-center py-8">
              <p className="text-[13px] text-zinc-500 mb-3">Build your reference portfolio</p>
              <p className="text-[11px] text-zinc-600 mb-4">Select 1-5 funds with weights in 10% increments totaling 100%</p>
              <button
                onClick={addFund}
                className="text-[12px] font-medium text-[#D71920] hover:text-red-400 transition-colors cursor-pointer"
              >
                + Add first fund
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Display mode */
        <div className="space-y-0 divide-y divide-zinc-800/60">
          {portfolio.map((alloc) => {
            const fund = fundMap.get(alloc.fund_code);
            if (!fund) return null;
            const change = fund.daily_change_pct || 0;
            const contribution = change * (alloc.weight / 100);

            return (
              <div key={alloc.fund_code} className="flex items-center justify-between py-3 first:pt-0">
                <div className="flex items-center gap-3">
                  {/* Weight bar */}
                  <div className="w-10 text-right">
                    <span className="text-[13px] font-mono font-semibold text-zinc-400">{alloc.weight}%</span>
                  </div>
                  <div className="w-[3px] h-6 rounded-full bg-zinc-700 overflow-hidden">
                    <div
                      className={cn(
                        "w-full rounded-full transition-all",
                        change > 0 ? "bg-emerald-500" : change < 0 ? "bg-red-500" : "bg-zinc-600"
                      )}
                      style={{ height: `${alloc.weight}%` }}
                    />
                  </div>
                  <div>
                    <span className="text-[13px] text-zinc-300">{fund.name_en}</span>
                    <span className="text-[11px] text-zinc-600 ml-2 font-mono">{fund.fund_code}</span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={cn(
                    "text-[12px] font-mono tabular-nums text-zinc-500",
                  )}>
                    {contribution > 0 ? "+" : ""}{contribution.toFixed(2)}%
                  </span>
                  <span className={cn(
                    "text-[13px] font-mono font-semibold tabular-nums",
                    change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-zinc-500"
                  )}>
                    {change > 0 ? "+" : ""}{change.toFixed(2)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
