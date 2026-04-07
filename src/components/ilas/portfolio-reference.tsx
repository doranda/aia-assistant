// src/components/ilas/portfolio-reference.tsx
// ILAS reference portfolio — accumulation or distribution allocation view
"use client";

import { cn } from "@/lib/utils";
import { useLanguage, getFundName } from "@/lib/i18n";

interface IlasPortfolioFund {
  fund_code: string;
  name_en: string;
  name_zh?: string | null;
  weight: number;
  note: string | null;
  currency: string;
  latest_nav: number | null;
  daily_change_pct: number | null;
}

interface IlasPortfolioReferenceProps {
  funds: IlasPortfolioFund[];
  portfolioType: "accumulation" | "distribution";
  priceDate: string;
  updatedAt: string;
}

function formatReturn(val: number | null): string {
  if (val === null) return "\u2014";
  return `${val > 0 ? "+" : ""}${val.toFixed(2)}%`;
}

function returnColor(val: number | null): string {
  if (val === null) return "text-zinc-400";
  if (val > 0) return "text-emerald-400";
  if (val < 0) return "text-red-400";
  return "text-zinc-300";
}

export function IlasPortfolioReference({
  funds,
  portfolioType,
  priceDate,
  updatedAt,
}: IlasPortfolioReferenceProps) {
  const { locale } = useLanguage();
  if (funds.length === 0) return null;

  const title =
    portfolioType === "accumulation"
      ? "Accumulation Portfolio"
      : "Distribution Portfolio";

  const subtitle =
    portfolioType === "accumulation"
      ? "Target allocation for accumulation funds"
      : "Target allocation for distribution funds";

  const headingId = `ilas-portfolio-${portfolioType}-heading`;

  // Weighted daily change
  const weightedDaily = funds.reduce(
    (s, f) => s + (f.daily_change_pct || 0) * (f.weight / 100),
    0,
  );

  return (
    <section aria-labelledby={headingId} className="mb-16">
      <div className="flex items-center justify-between mb-2">
        <h2
          id={headingId}
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300"
        >
          {title}
        </h2>
        <span className="text-[10px] font-mono text-zinc-400">
          Last rebalanced{" "}
          {new Date(updatedAt).toLocaleDateString("en-HK", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
      <p className="text-[11px] text-zinc-400 mb-6 font-mono">{subtitle}</p>

      {/* Portfolio weighted daily summary */}
      <div className="grid grid-cols-1 gap-4 mb-8">
        <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-lg p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
            Weighted Daily Change
          </div>
          <div
            className={cn(
              "text-lg sm:text-xl font-mono font-semibold tabular-nums",
              returnColor(weightedDaily),
            )}
          >
            {formatReturn(weightedDaily)}
          </div>
        </div>
      </div>

      {/* Fund allocation table */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="border border-zinc-800/60 rounded-lg overflow-hidden min-w-[520px]">
          {/* Header */}
          <div className="grid grid-cols-[1fr_60px_60px_80px_80px] bg-zinc-900/80 px-4 sm:px-6 py-2 border-b border-zinc-800/60">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              Fund
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">
              Ccy
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">
              Weight
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">
              NAV
            </span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 text-right">
              Daily
            </span>
          </div>

          {/* Rows */}
          {funds.map((fund) => (
            <div
              key={fund.fund_code}
              className="grid grid-cols-[1fr_60px_60px_80px_80px] px-4 sm:px-6 py-3 border-b border-zinc-800/40 last:border-b-0 items-center"
            >
              <div>
                <span className="text-[13px] text-zinc-300">
                  {getFundName(fund, locale)}
                </span>
                <span className="text-[10px] text-zinc-400 ml-2 font-mono">
                  {fund.fund_code}
                </span>
              </div>
              <span className="text-[11px] font-mono text-zinc-400 text-right">
                {fund.currency}
              </span>
              <span className="text-[13px] font-mono font-semibold text-zinc-300 text-right">
                {fund.weight}%
              </span>
              <span className="text-[12px] font-mono tabular-nums text-zinc-300 text-right">
                {fund.latest_nav !== null ? fund.latest_nav.toFixed(4) : "\u2014"}
              </span>
              <span
                className={cn(
                  "text-[12px] font-mono tabular-nums text-right",
                  returnColor(fund.daily_change_pct),
                )}
              >
                {formatReturn(fund.daily_change_pct)}
              </span>
            </div>
          ))}

          {/* Weighted total row */}
          <div className="grid grid-cols-[1fr_60px_60px_80px_80px] px-4 sm:px-6 py-3 bg-zinc-900/60 border-t border-zinc-700/60 items-center">
            <span className="text-[13px] font-semibold text-zinc-300">
              Portfolio Total
            </span>
            <span />
            <span className="text-[13px] font-mono font-semibold text-zinc-300 text-right">
              100%
            </span>
            <span />
            <span
              className={cn(
                "text-[12px] font-mono font-semibold tabular-nums text-right",
                returnColor(weightedDaily),
              )}
            >
              {formatReturn(weightedDaily)}
            </span>
          </div>
        </div>
      </div>

      {/* Rationale notes */}
      <div className="mt-4 space-y-1">
        {funds
          .filter((f) => f.note)
          .map((fund) => (
            <p
              key={fund.fund_code}
              className="text-[11px] text-zinc-400 font-mono"
            >
              <span className="text-zinc-300">{fund.fund_code}</span> &mdash;{" "}
              {fund.note}
            </p>
          ))}
      </div>

      {/* Price date footnote */}
      <p className="mt-3 text-[10px] font-mono text-zinc-500">
        NAV as at {priceDate}
      </p>
    </section>
  );
}
