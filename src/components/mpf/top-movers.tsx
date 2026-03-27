// src/components/mpf/top-movers.tsx
import { cn } from "@/lib/utils";
import type { FundWithLatestPrice } from "@/lib/mpf/types";

export function TopMovers({ funds }: { funds: FundWithLatestPrice[] }) {
  const withChange = funds.filter((f) => f.daily_change_pct !== null && f.daily_change_pct !== 0);

  const gainers = [...withChange]
    .filter((f) => (f.daily_change_pct || 0) > 0)
    .sort((a, b) => (b.daily_change_pct || 0) - (a.daily_change_pct || 0))
    .slice(0, 5);

  const losers = [...withChange]
    .filter((f) => (f.daily_change_pct || 0) < 0)
    .sort((a, b) => (a.daily_change_pct || 0) - (b.daily_change_pct || 0))
    .slice(0, 5);

  if (gainers.length === 0 && losers.length === 0) {
    return <p className="text-sm text-zinc-300">No price movements recorded yet.</p>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* Gainers */}
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-emerald-500/70 mb-4">
          Top Gainers
        </h3>
        <ol className="space-y-0 divide-y divide-zinc-800/60">
          {gainers.map((fund) => (
            <li key={fund.id} className="flex items-center justify-between py-3 first:pt-0">
              <div>
                <span className="text-[13px] text-zinc-300">{fund.name_en}</span>
                <span className="text-[11px] text-zinc-400 ml-2 font-mono">{fund.fund_code}</span>
              </div>
              <span className="text-[13px] font-mono font-semibold tabular-nums text-emerald-400">
                +{fund.daily_change_pct?.toFixed(2)}%
              </span>
            </li>
          ))}
          {gainers.length === 0 && (
            <li className="py-3 text-[13px] text-zinc-400">No gainers</li>
          )}
        </ol>
      </div>

      {/* Losers */}
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-red-500/70 mb-4">
          Top Losers
        </h3>
        <ol className="space-y-0 divide-y divide-zinc-800/60">
          {losers.map((fund) => (
            <li key={fund.id} className="flex items-center justify-between py-3 first:pt-0">
              <div>
                <span className="text-[13px] text-zinc-300">{fund.name_en}</span>
                <span className="text-[11px] text-zinc-400 ml-2 font-mono">{fund.fund_code}</span>
              </div>
              <span className="text-[13px] font-mono font-semibold tabular-nums text-red-400">
                {fund.daily_change_pct?.toFixed(2)}%
              </span>
            </li>
          ))}
          {losers.length === 0 && (
            <li className="py-3 text-[13px] text-zinc-400">No losers</li>
          )}
        </ol>
      </div>
    </div>
  );
}
