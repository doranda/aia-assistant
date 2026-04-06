"use client";

import { useLanguage } from "@/lib/i18n";
import { PortfolioReference } from "@/components/mpf/portfolio-reference";
import { PortfolioTrackRecord } from "@/components/mpf/portfolio-track-record";
import { DebateLog } from "@/components/mpf/debate-log";
import { FundHeatmap } from "@/components/mpf/fund-heatmap";
import { TopMovers } from "@/components/mpf/top-movers";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import { ModelPerformance } from "@/components/mpf/model-performance";
import type { FundWithLatestPrice, MpfNews, MpfInsight, RebalanceScore } from "@/lib/mpf/types";
import { PriceFreshnessBanner } from "@/components/price-freshness-banner";
import { TrendingUp, Newspaper, Brain, Activity, BarChart3 } from "lucide-react";

interface MpfCareViewProps {
  fundsWithPrices: FundWithLatestPrice[];
  portfolioFunds: {
    fund_code: string;
    name_en: string;
    weight: number;
    note: string | null;
    latest_nav: number | null;
    daily_change_pct: number | null;
    returns: { mtd: number | null; ytd: number | null; y1: number | null };
  }[];
  refUpdatedAt: string;
  news: MpfNews[];
  latestInsight: MpfInsight | null;
  latestDebate: { content_en: string | null; content_zh: string | null; created_at: string } | null;
  recentScores: RebalanceScore[];
  lastRun: { run_at: string; status: string; scraper_name: string } | null;
  priceDate: string;
  portfolioNav: { date: string; nav: number; daily_return_pct: number | null; is_cash: boolean }[];
}

export function MpfCareView({
  fundsWithPrices,
  portfolioFunds,
  refUpdatedAt,
  news,
  latestInsight,
  latestDebate,
  recentScores,
  lastRun,
  priceDate,
  portfolioNav,
}: MpfCareViewProps) {
  const { t } = useLanguage();

  return (
    <main className="max-w-[980px] mx-auto px-6 py-8 lg:py-16 xl:py-24">
      <header className="mb-8 lg:mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          {t("mpf.heading")}
        </h1>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          {t("mpf.subtitle")}
          {lastRun && (
            <span className="ml-3 text-zinc-400">
              {t("mpf.lastUpdated")} {new Date(lastRun.run_at).toLocaleDateString("en-HK")}
            </span>
          )}
        </p>
      </header>

      <DisclaimerBanner />

      <div className="mt-4">
        <PriceFreshnessBanner priceDate={priceDate} label="MPF" />
      </div>

      {/* Sub-navigation */}
      <nav aria-label="MPF Care sections" className="mt-8 flex items-center gap-2 sm:gap-4 flex-wrap">
        <a
          href="/mpf-care/news"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Newspaper className="w-3.5 h-3.5" />
          {t("mpf.news")}
        </a>
        <a
          href="/mpf-care/insights"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Brain className="w-3.5 h-3.5" />
          {t("mpf.insights")}
        </a>
        <a
          href="/mpf-care/health"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Activity className="w-3.5 h-3.5" />
          {t("mpf.health")}
        </a>
        <a
          href="/mpf-care/screener"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {t("mpf.screener")}
        </a>
      </nav>

      {/* Portfolio Track Record (top) + Allocation Performance (bottom) */}
      <div className="mt-12">
        <PortfolioTrackRecord
          navHistory={portfolioNav}
          inceptionDate={portfolioNav[0]?.date || null}
        />
        <PortfolioReference
          funds={portfolioFunds}
          priceDate={priceDate}
          updatedAt={refUpdatedAt}
        />
      </div>

      {/* Debate Log — Why this allocation */}
      {latestDebate && (
        <DebateLog
          summaryEn={latestDebate.content_en || ""}
          summaryZh={latestDebate.content_zh || ""}
          fullLog={latestDebate.content_en?.split("---").slice(1).join("---").trim() || ""}
          createdAt={latestDebate.created_at}
        />
      )}

      {/* Model Performance — win rate and track record */}
      <div className="mt-8">
        <ModelPerformance scores={recentScores} />
      </div>

      {/* Top Movers — split into Gainers and Losers */}
      <section aria-labelledby="top-movers-heading" className="mb-16">
        <div className="flex items-center gap-2 mb-6">
          <TrendingUp className="w-4 h-4 text-zinc-400" />
          <h2 id="top-movers-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
            {t("mpf.topMovers")} — {priceDate}
          </h2>
        </div>
        <TopMovers funds={fundsWithPrices} />
      </section>

      {/* Fund Heatmap */}
      <section aria-labelledby="heatmap-heading" className="mb-16">
        <h2 id="heatmap-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-6">
          {t("mpf.allFunds")}
        </h2>
        <FundHeatmap funds={fundsWithPrices} />
      </section>

      {/* Two columns: News + Latest Insight */}
      <div className="grid lg:grid-cols-2 gap-8 lg:gap-16">
        {/* Latest News */}
        <section aria-labelledby="news-heading">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-zinc-400" />
              <h2 id="news-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
                {t("mpf.latestNews")}
              </h2>
            </div>
            <a href="/mpf-care/news" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
              {t("mpf.viewAll")}
            </a>
          </div>
          {news.length === 0 ? (
            <p className="text-sm text-zinc-300">{t("mpf.noNews")}</p>
          ) : (
            <ol className="space-y-0 divide-y divide-zinc-800/60">
              {news.map((n) => (
                <li key={n.id} className="py-3 first:pt-0">
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    {n.headline}
                  </a>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-zinc-400">{n.source}</span>
                    <span className={`text-[10px] font-mono ${
                      n.sentiment === "positive" ? "text-emerald-500" :
                      n.sentiment === "negative" ? "text-red-500" : "text-zinc-400"
                    }`}>
                      {n.sentiment}
                    </span>
                    {n.is_high_impact && (
                      <span className="text-[10px] font-mono text-amber-500">HIGH IMPACT</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Latest Insight */}
        <section aria-labelledby="insight-heading">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-zinc-400" />
              <h2 id="insight-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300">
                {t("mpf.latestProfile")}
              </h2>
            </div>
            <a href="/mpf-care/insights" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
              {t("mpf.viewAll")}
            </a>
          </div>
          {latestInsight ? (
            <div className="text-[13px] text-zinc-400 leading-relaxed whitespace-pre-wrap line-clamp-[12]">
              {latestInsight.content_en}
            </div>
          ) : (
            <p className="text-sm text-zinc-300">{t("mpf.noInsights")}</p>
          )}
        </section>
      </div>
    </main>
  );
}
