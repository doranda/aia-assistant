// src/components/mpf/portfolio-reference.tsx
"use client";

import { cn } from "@/lib/utils";
import type { FundWithLatestPrice } from "@/lib/mpf/types";
import { FUND_CATEGORY_LABELS } from "@/lib/mpf/constants";
import type { FundCategory } from "@/lib/mpf/types";

interface PortfolioReferenceProps {
  funds: FundWithLatestPrice[];
  priceDate: string;
}

export function PortfolioReference({ funds, priceDate }: PortfolioReferenceProps) {
  const fundsWithPrices = funds.filter((f) => f.latest_nav !== null);

  // Category summary
  const categoryStats = new Map<string, { count: number; avgChange: number; totalNav: number }>();
  for (const fund of fundsWithPrices) {
    const cat = fund.category;
    const existing = categoryStats.get(cat) || { count: 0, avgChange: 0, totalNav: 0 };
    existing.count++;
    existing.avgChange += fund.daily_change_pct || 0;
    existing.totalNav += fund.latest_nav || 0;
    categoryStats.set(cat, existing);
  }

  // Finalize averages
  for (const [key, val] of categoryStats) {
    val.avgChange = val.count > 0 ? val.avgChange / val.count : 0;
    categoryStats.set(key, val);
  }

  // Sort categories by performance
  const sortedCategories = [...categoryStats.entries()].sort(
    (a, b) => b[1].avgChange - a[1].avgChange
  );

  // Overall scheme performance
  const avgReturn = fundsWithPrices.length > 0
    ? fundsWithPrices.reduce((sum, f) => sum + (f.daily_change_pct || 0), 0) / fundsWithPrices.length
    : 0;

  const positiveCount = fundsWithPrices.filter((f) => (f.daily_change_pct || 0) > 0).length;
  const negativeCount = fundsWithPrices.filter((f) => (f.daily_change_pct || 0) < 0).length;
  const neutralCount = fundsWithPrices.filter((f) => (f.daily_change_pct || 0) === 0).length;

  return (
    <section aria-labelledby="portfolio-ref-heading" className="mb-16">
      <h2
        id="portfolio-ref-heading"
        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 mb-6"
      >
        Scheme Overview — {priceDate}
      </h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Avg Return</div>
          <div className={cn(
            "text-xl font-mono font-semibold tabular-nums",
            avgReturn > 0 ? "text-emerald-400" : avgReturn < 0 ? "text-red-400" : "text-zinc-400"
          )}>
            {avgReturn > 0 ? "+" : ""}{avgReturn.toFixed(2)}%
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Funds Tracked</div>
          <div className="text-xl font-mono font-semibold text-zinc-300">{fundsWithPrices.length}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Gaining</div>
          <div className="text-xl font-mono font-semibold text-emerald-400">{positiveCount}</div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-600 mb-1">Declining</div>
          <div className="text-xl font-mono font-semibold text-red-400">{negativeCount}</div>
        </div>
      </div>

      {/* Category performance */}
      <div className="space-y-0 divide-y divide-zinc-800/60">
        {sortedCategories.map(([category, stats]) => (
          <div key={category} className="flex items-center justify-between py-3 first:pt-0">
            <div>
              <span className="text-[13px] text-zinc-300">
                {FUND_CATEGORY_LABELS[category as FundCategory] || category}
              </span>
              <span className="text-[10px] text-zinc-600 ml-2 font-mono">{stats.count} fund{stats.count !== 1 ? "s" : ""}</span>
            </div>
            <span
              className={cn(
                "text-[13px] font-mono font-semibold tabular-nums",
                stats.avgChange > 0 ? "text-emerald-400" : stats.avgChange < 0 ? "text-red-400" : "text-zinc-500"
              )}
            >
              {stats.avgChange > 0 ? "+" : ""}{stats.avgChange.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
