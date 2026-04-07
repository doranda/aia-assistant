"use client";

import { useLanguage, getFundName } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ILAS_CATEGORY_LABELS, ILAS_INSIGHT_DISCLAIMER } from "@/lib/ilas/constants";
import type { IlasFundCategory, IlasFundWithLatestPrice } from "@/lib/ilas/types";
import { IlasPortfolioReference } from "@/components/ilas/portfolio-reference";
import { IlasPortfolioTrackRecord } from "@/components/ilas/portfolio-track-record";
import { DebateLog } from "@/components/mpf/debate-log";
import { PriceFreshnessBanner } from "@/components/price-freshness-banner";
import { TrendingUp, BarChart3, Newspaper, Filter, PieChart } from "lucide-react";
import Link from "next/link";

interface PortfolioFund {
  fund_code: string;
  name_en: string;
  name_zh?: string | null;
  weight: number;
  note: string | null;
  currency: string;
  latest_nav: number | null;
  daily_change_pct: number | null;
}

interface IlasTrackViewProps {
  fundsWithPrices: IlasFundWithLatestPrice[];
  latestDate: string;
  accCount: number;
  disCount: number;
  portfolioFunds: PortfolioFund[];
  portfolioNav: { date: string; nav: number; daily_return_pct: number | null; is_cash: boolean }[] | null;
  portfolioType: "accumulation" | "distribution";
  portfolioUpdatedAt: string;
  latestDebate: { content_en: string | null; content_zh: string | null; created_at: string } | null;
  isDistribution: boolean;
}

function IlasTopMovers({ funds }: { funds: IlasFundWithLatestPrice[] }) {
  const { t, locale } = useLanguage();
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
    return <p className="text-sm text-zinc-300">{t("ilas.noPriceMovements")}</p>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
      {/* Gainers */}
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-emerald-500/70 mb-4">
          {t("ilas.topGainers")}
        </h3>
        <ol className="space-y-0 divide-y divide-zinc-800/60">
          {gainers.map((fund) => (
            <li key={fund.id} className="py-3 first:pt-0">
              <Link
                href={`/ilas-track/funds/${fund.fund_code}`}
                className="flex items-center justify-between hover:bg-zinc-800/20 -mx-2 px-2 rounded transition-colors"
              >
                <div className="min-w-0 mr-3">
                  <span className="text-[13px] text-zinc-300 line-clamp-1">{getFundName(fund, locale)}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-zinc-400 font-mono">{fund.fund_code}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">{fund.currency}</span>
                  </div>
                </div>
                <span className="text-[13px] font-mono font-semibold tabular-nums text-emerald-400 shrink-0">
                  +{fund.daily_change_pct?.toFixed(2)}%
                </span>
              </Link>
            </li>
          ))}
          {gainers.length === 0 && (
            <li className="py-3 text-[13px] text-zinc-400">{t("ilas.noGainers")}</li>
          )}
        </ol>
      </div>

      {/* Losers */}
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-red-500/70 mb-4">
          {t("ilas.topLosers")}
        </h3>
        <ol className="space-y-0 divide-y divide-zinc-800/60">
          {losers.map((fund) => (
            <li key={fund.id} className="py-3 first:pt-0">
              <Link
                href={`/ilas-track/funds/${fund.fund_code}`}
                className="flex items-center justify-between hover:bg-zinc-800/20 -mx-2 px-2 rounded transition-colors"
              >
                <div className="min-w-0 mr-3">
                  <span className="text-[13px] text-zinc-300 line-clamp-1">{getFundName(fund, locale)}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-zinc-400 font-mono">{fund.fund_code}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">{fund.currency}</span>
                  </div>
                </div>
                <span className="text-[13px] font-mono font-semibold tabular-nums text-red-400 shrink-0">
                  {fund.daily_change_pct?.toFixed(2)}%
                </span>
              </Link>
            </li>
          ))}
          {losers.length === 0 && (
            <li className="py-3 text-[13px] text-zinc-400">{t("ilas.noLosers")}</li>
          )}
        </ol>
      </div>
    </div>
  );
}

function IlasHeatmap({ funds }: { funds: IlasFundWithLatestPrice[] }) {
  const { locale } = useLanguage();
  const grouped = funds.reduce(
    (acc, fund) => {
      const cat = fund.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(fund);
      return acc;
    },
    {} as Record<string, IlasFundWithLatestPrice[]>
  );

  const sortedCategories = Object.entries(grouped).sort(([a], [b]) => {
    const labelA = ILAS_CATEGORY_LABELS[a as IlasFundCategory] || a;
    const labelB = ILAS_CATEGORY_LABELS[b as IlasFundCategory] || b;
    return labelA.localeCompare(labelB);
  });

  return (
    <div className="space-y-6 sm:space-y-8">
      {sortedCategories.map(([category, catFunds]) => (
        <section key={category}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-3">
            {ILAS_CATEGORY_LABELS[category as IlasFundCategory] || category}
            <span className="text-zinc-500 ml-2 font-normal">({catFunds.length})</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {catFunds.map((fund) => {
              const pct = fund.daily_change_pct || 0;
              return (
                <Link
                  key={fund.id}
                  href={`/ilas-track/funds/${fund.fund_code}`}
                  className={cn(
                    "p-3 rounded-md text-left transition-colors border block",
                    pct > 1 ? "bg-emerald-950/40 border-emerald-800/30 hover:border-emerald-700/40" :
                    pct > 0 ? "bg-emerald-950/20 border-emerald-900/20 hover:border-emerald-800/30" :
                    pct < -1 ? "bg-red-950/40 border-red-800/30 hover:border-red-700/40" :
                    pct < 0 ? "bg-red-950/20 border-red-900/20 hover:border-red-800/30" :
                    "bg-zinc-900/40 border-zinc-800/30 hover:border-zinc-700/40"
                  )}
                >
                  <div className="text-[11px] font-mono text-zinc-400">{fund.fund_code}</div>
                  <div className="text-[12px] text-zinc-300 mt-0.5 line-clamp-2 leading-tight min-h-[2rem]">
                    {getFundName(fund, locale)}
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] font-mono text-zinc-500">{fund.currency}</span>
                    <span
                      className={cn(
                        "text-[14px] font-mono font-semibold tabular-nums",
                        pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-zinc-500"
                      )}
                    >
                      {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                    </span>
                  </div>
                  {fund.latest_nav !== null && (
                    <div className="text-[10px] font-mono text-zinc-500 mt-1">
                      NAV {fund.latest_nav.toFixed(4)}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function IlasTrackView({
  fundsWithPrices,
  latestDate,
  accCount,
  disCount,
  portfolioFunds,
  portfolioNav,
  portfolioType,
  portfolioUpdatedAt,
  latestDebate,
  isDistribution,
}: IlasTrackViewProps) {
  const { t } = useLanguage();

  return (
    <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-8 lg:py-16 xl:py-24">
      {/* Header */}
      <header className="mb-8 lg:mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          {t("ilas.heading")}
        </h1>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          {t("ilas.subtitle")}
        </p>
      </header>

      {/* Disclaimer */}
      <aside
        role="note"
        aria-label="Disclaimer"
        className="text-[11px] text-zinc-400 font-mono border border-zinc-800/40 rounded-md px-4 py-2.5"
      >
        {ILAS_INSIGHT_DISCLAIMER.en}
      </aside>

      <div className="mt-4">
        <PriceFreshnessBanner priceDate={latestDate} label="ILAS" />
      </div>

      {/* Sub-navigation */}
      <nav aria-label="ILAS Track sections" className="mt-8 flex items-center gap-2 sm:gap-4 flex-wrap">
        <Link
          href="/ilas-track/screener"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Filter className="w-3.5 h-3.5" />
          {t("ilas.screener")}
        </Link>
        <Link
          href="/ilas-track/news"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Newspaper className="w-3.5 h-3.5" />
          {t("ilas.news")}
        </Link>
      </nav>

      {/* Accumulation / Distribution Tabs */}
      <div className="mt-10 sm:mt-12 flex items-center gap-1 border-b border-zinc-800/60" role="tablist" aria-label="Fund type">
        <Link
          href="/ilas-track"
          role="tab"
          aria-selected={!isDistribution}
          className={cn(
            "px-4 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px",
            !isDistribution
              ? "text-zinc-100 border-[#D71920]"
              : "text-zinc-400 border-transparent hover:text-zinc-200"
          )}
        >
          {t("ilas.accumulation")}
          <span className="ml-2 text-[11px] font-mono text-zinc-500">{accCount}</span>
        </Link>
        <Link
          href="/ilas-track?tab=distribution"
          role="tab"
          aria-selected={isDistribution}
          className={cn(
            "px-4 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px",
            isDistribution
              ? "text-zinc-100 border-[#D71920]"
              : "text-zinc-400 border-transparent hover:text-zinc-200"
          )}
        >
          {t("ilas.distribution")}
          <span className="ml-2 text-[11px] font-mono text-zinc-500">{disCount}</span>
        </Link>
      </div>

      {/* Portfolio Track Record */}
      {portfolioNav && portfolioNav.length > 0 && (
        <div className="mt-10 sm:mt-12">
          <IlasPortfolioTrackRecord
            navHistory={portfolioNav}
            portfolioType={portfolioType}
            inceptionDate={portfolioNav[0]?.date ?? null}
          />
        </div>
      )}

      {/* Reference Portfolio */}
      {portfolioFunds.length > 0 && (
        <section aria-labelledby={`ilas-portfolio-${portfolioType}-heading`} className="mb-12 sm:mb-16">
          <div className="flex items-center gap-2 mb-6">
            <PieChart className="w-4 h-4 text-zinc-400" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
              {t("ilas.referencePortfolio")}
            </h2>
          </div>
          <IlasPortfolioReference
            funds={portfolioFunds}
            portfolioType={portfolioType}
            priceDate={latestDate}
            updatedAt={portfolioUpdatedAt}
          />
        </section>
      )}

      {/* Debate Log — Why this allocation */}
      {latestDebate && (
        <section className="mb-12 sm:mb-16">
          <DebateLog
            summaryEn={latestDebate.content_en || ""}
            summaryZh={latestDebate.content_zh || ""}
            fullLog={latestDebate.content_en?.split("---").slice(1).join("---").trim() || ""}
            createdAt={latestDebate.created_at}
          />
        </section>
      )}

      {/* Top Movers */}
      <section aria-labelledby="top-movers-heading" className="mb-12 sm:mb-16">
        <div className="flex items-center gap-2 mb-6">
          <TrendingUp className="w-4 h-4 text-zinc-400" />
          <h2 id="top-movers-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            Top Movers — {latestDate}
          </h2>
        </div>
        <IlasTopMovers funds={fundsWithPrices} />
      </section>

      {/* Fund Heatmap */}
      <section aria-labelledby="heatmap-heading" className="mb-12 sm:mb-16">
        <div className="flex items-center gap-2 mb-6">
          <BarChart3 className="w-4 h-4 text-zinc-400" />
          <h2 id="heatmap-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            {isDistribution ? t("ilas.distribution") : t("ilas.accumulation")} Funds — By Category
          </h2>
        </div>
        <IlasHeatmap funds={fundsWithPrices} />
      </section>

      {/* Status Bar */}
      <footer className="border-t border-zinc-800/40 pt-4 mt-8">
        <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] font-mono text-zinc-500">
          <span>
            Showing {fundsWithPrices.length} {isDistribution ? t("ilas.distribution").toLowerCase() : t("ilas.accumulation").toLowerCase()} funds
          </span>
          <span>
            Last price date: {latestDate}
          </span>
        </div>
      </footer>
    </main>
  );
}
