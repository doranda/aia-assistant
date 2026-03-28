// src/components/mpf/portfolio-reference.tsx
import { cn } from "@/lib/utils";

interface PortfolioFund {
  fund_code: string;
  name_en: string;
  weight: number;
  note: string | null;
  latest_nav: number | null;
  daily_change_pct: number | null;
  returns: {
    mtd: number | null;
    ytd: number | null;
    y1: number | null;
  };
}

interface PortfolioReferenceProps {
  funds: PortfolioFund[];
  priceDate: string;
  updatedAt: string;
}

function formatReturn(val: number | null): string {
  if (val === null) return "—";
  return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
}

function returnColor(val: number | null): string {
  if (val === null) return "text-zinc-400";
  if (val > 0) return "text-emerald-400";
  if (val < 0) return "text-red-400";
  return "text-zinc-300";
}

export function PortfolioReference({ funds, priceDate, updatedAt }: PortfolioReferenceProps) {
  if (funds.length === 0) return null;

  // Weighted returns
  const weightedDaily = funds.reduce((s, f) => s + (f.daily_change_pct || 0) * (f.weight / 100), 0);
  const weightedMtd = funds.reduce((s, f) => s + (f.returns.mtd || 0) * (f.weight / 100), 0);
  const weightedYtd = funds.reduce((s, f) => s + (f.returns.ytd || 0) * (f.weight / 100), 0);
  const weightedY1 = funds.every(f => f.returns.y1 !== null)
    ? funds.reduce((s, f) => s + (f.returns.y1 || 0) * (f.weight / 100), 0)
    : null;

  return (
    <section aria-labelledby="portfolio-ref-heading" className="mb-16">
      <div className="flex items-center justify-between mb-2">
        <h2
          id="portfolio-ref-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300"
        >
          Allocation Performance
        </h2>
        <span className="text-[10px] font-mono text-zinc-400">
          Last rebalanced {new Date(updatedAt).toLocaleDateString("en-HK", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      </div>
      <p className="text-[11px] text-zinc-400 mb-6 font-mono">
        Dual-agent debate consensus — Quant metrics vs market news
      </p>

      {/* Portfolio performance summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">Latest</div>
          <div className={cn("text-lg sm:text-xl font-mono font-semibold tabular-nums", returnColor(weightedDaily))}>
            {formatReturn(weightedDaily)}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">MTD</div>
          <div className={cn("text-lg sm:text-xl font-mono font-semibold tabular-nums", returnColor(weightedMtd))}>
            {formatReturn(weightedMtd)}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">YTD</div>
          <div className={cn("text-lg sm:text-xl font-mono font-semibold tabular-nums", returnColor(weightedYtd))}>
            {formatReturn(weightedYtd)}
          </div>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">1Y</div>
          <div className={cn("text-lg sm:text-xl font-mono font-semibold tabular-nums", returnColor(weightedY1))}>
            {formatReturn(weightedY1)}
          </div>
        </div>
      </div>

      {/* Fund allocation table */}
      <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
      <div className="border border-zinc-800/60 rounded-lg overflow-hidden min-w-[520px]">
        {/* Header */}
        <div className="grid grid-cols-[1fr_60px_70px_70px_70px_70px] bg-zinc-900/80 px-4 py-2 border-b border-zinc-800/60">
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Fund</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">Weight</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">Latest</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">MTD</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">YTD</span>
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">1Y</span>
        </div>

        {/* Rows */}
        {funds.map((fund) => (
          <div
            key={fund.fund_code}
            className="grid grid-cols-[1fr_60px_70px_70px_70px_70px] px-4 py-3 border-b border-zinc-800/40 last:border-b-0 items-center"
          >
            <div>
              <span className="text-[13px] text-zinc-300">{fund.name_en}</span>
              <span className="text-[10px] text-zinc-400 ml-2 font-mono">{fund.fund_code}</span>
            </div>
            <span className="text-[13px] font-mono font-semibold text-zinc-300 text-right">
              {fund.weight}%
            </span>
            <span className={cn("text-[12px] font-mono tabular-nums text-right", returnColor(fund.daily_change_pct))}>
              {formatReturn(fund.daily_change_pct)}
            </span>
            <span className={cn("text-[12px] font-mono tabular-nums text-right", returnColor(fund.returns.mtd))}>
              {formatReturn(fund.returns.mtd)}
            </span>
            <span className={cn("text-[12px] font-mono tabular-nums text-right", returnColor(fund.returns.ytd))}>
              {formatReturn(fund.returns.ytd)}
            </span>
            <span className={cn("text-[12px] font-mono tabular-nums text-right", returnColor(fund.returns.y1))}>
              {formatReturn(fund.returns.y1)}
            </span>
          </div>
        ))}

        {/* Weighted total row */}
        <div className="grid grid-cols-[1fr_60px_70px_70px_70px_70px] px-4 py-3 bg-zinc-900/60 border-t border-zinc-700/60 items-center">
          <span className="text-[13px] font-semibold text-zinc-300">Portfolio Total</span>
          <span className="text-[13px] font-mono font-semibold text-zinc-300 text-right">100%</span>
          <span className={cn("text-[12px] font-mono font-semibold tabular-nums text-right", returnColor(weightedDaily))}>
            {formatReturn(weightedDaily)}
          </span>
          <span className={cn("text-[12px] font-mono font-semibold tabular-nums text-right", returnColor(weightedMtd))}>
            {formatReturn(weightedMtd)}
          </span>
          <span className={cn("text-[12px] font-mono font-semibold tabular-nums text-right", returnColor(weightedYtd))}>
            {formatReturn(weightedYtd)}
          </span>
          <span className={cn("text-[12px] font-mono font-semibold tabular-nums text-right", returnColor(weightedY1))}>
            {formatReturn(weightedY1)}
          </span>
        </div>
      </div>
      </div>

      {/* Rationale notes */}
      <div className="mt-4 space-y-1">
        {funds.filter(f => f.note).map((fund) => (
          <p key={fund.fund_code} className="text-[11px] text-zinc-400 font-mono">
            <span className="text-zinc-300">{fund.fund_code}</span> — {fund.note}
          </p>
        ))}
      </div>
    </section>
  );
}
