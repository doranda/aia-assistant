// src/components/mpf/top-movers.tsx
import { cn } from "@/lib/utils";
import type { FundWithLatestPrice } from "@/lib/mpf/types";

export function TopMovers({ funds }: { funds: FundWithLatestPrice[] }) {
  // Sort by absolute daily change
  const sorted = [...funds]
    .filter((f) => f.daily_change_pct !== null)
    .sort((a, b) => Math.abs(b.daily_change_pct || 0) - Math.abs(a.daily_change_pct || 0))
    .slice(0, 5);

  if (sorted.length === 0) {
    return <p className="text-sm text-zinc-500">No price data for today yet.</p>;
  }

  return (
    <ol className="space-y-0 divide-y divide-zinc-800/60">
      {sorted.map((fund) => (
        <li key={fund.id} className="flex items-center justify-between py-3 first:pt-0">
          <div>
            <span className="text-[13px] text-zinc-300">{fund.name_en}</span>
            <span className="text-[11px] text-zinc-600 ml-2 font-mono">{fund.fund_code}</span>
          </div>
          <span
            className={cn(
              "text-[13px] font-mono font-semibold tabular-nums",
              (fund.daily_change_pct || 0) > 0 ? "text-emerald-400" : "text-red-400"
            )}
          >
            {(fund.daily_change_pct || 0) > 0 ? "+" : ""}
            {fund.daily_change_pct?.toFixed(2)}%
          </span>
        </li>
      ))}
    </ol>
  );
}
