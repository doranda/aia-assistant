// src/components/mpf/fund-heatmap.tsx
"use client";

import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { FundWithLatestPrice } from "@/lib/mpf/types";
import { FUND_CATEGORY_LABELS } from "@/lib/mpf/constants";
import type { FundCategory } from "@/lib/mpf/types";

export function FundHeatmap({ funds }: { funds: FundWithLatestPrice[] }) {
  const router = useRouter();

  // Group by category
  const grouped = funds.reduce(
    (acc, fund) => {
      const cat = fund.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(fund);
      return acc;
    },
    {} as Record<string, FundWithLatestPrice[]>
  );

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, catFunds]) => (
        <section key={category}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-3">
            {FUND_CATEGORY_LABELS[category as FundCategory] || category}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {catFunds.map((fund) => {
              const pct = fund.daily_change_pct || 0;
              return (
                <button
                  key={fund.id}
                  onClick={() => router.push(`/mpf-care/funds/${fund.fund_code}`)}
                  className={cn(
                    "p-3 rounded-md text-left transition-colors cursor-pointer border",
                    pct > 1 ? "bg-emerald-950/40 border-emerald-800/30" :
                    pct > 0 ? "bg-emerald-950/20 border-emerald-900/20" :
                    pct < -1 ? "bg-red-950/40 border-red-800/30" :
                    pct < 0 ? "bg-red-950/20 border-red-900/20" :
                    "bg-zinc-900/40 border-zinc-800/30"
                  )}
                >
                  <div className="text-[11px] font-mono text-zinc-300">{fund.fund_code}</div>
                  <div className="text-[12px] text-zinc-300 mt-0.5 truncate">{fund.name_en}</div>
                  <div
                    className={cn(
                      "text-[14px] font-mono font-semibold mt-1 tabular-nums",
                      pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-zinc-500"
                    )}
                  >
                    {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
