// src/app/(app)/mpf-care/page.tsx
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortfolioReference } from "@/components/mpf/portfolio-reference";
import { PortfolioTrackRecord } from "@/components/mpf/portfolio-track-record";
import { DebateLog } from "@/components/mpf/debate-log";
import { FundHeatmap } from "@/components/mpf/fund-heatmap";
import { TopMovers } from "@/components/mpf/top-movers";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import { ModelPerformance } from "@/components/mpf/model-performance";
import type { FundWithLatestPrice, MpfNews, MpfInsight, RebalanceScore } from "@/lib/mpf/types";
import { TrendingUp, Newspaper, Brain, Activity, BarChart3 } from "lucide-react";

async function getOverviewData() {
  const supabase = await createClient();

  // Get all funds with latest price
  const { data: funds, error: fundsError } = await supabase
    .from("mpf_funds")
    .select("*")
    .eq("is_active", true)
    .order("fund_code");

  if (fundsError) console.error("[mpf-care] funds query failed:", fundsError.code, fundsError.message);

  // Get ALL prices for backtest calculations
  const { data: allPrices, error: pricesError } = await supabase
    .from("mpf_prices")
    .select("fund_id, nav, daily_change_pct, date")
    .order("date", { ascending: false });

  if (pricesError) console.error("[mpf-care] prices query failed:", pricesError.code, pricesError.message);

  // Latest price per fund
  const seen = new Set<string>();
  const latestPrices = (allPrices || []).filter((p) => {
    if (seen.has(p.fund_id)) return false;
    seen.add(p.fund_id);
    return true;
  });
  const priceDate = latestPrices?.[0]?.date || new Date().toISOString().split("T")[0];

  const priceMap = new Map(latestPrices.map((p) => [p.fund_id, p]));

  const fundsWithPrices: FundWithLatestPrice[] = (funds || []).map((f) => {
    const price = priceMap.get(f.id);
    return {
      ...f,
      latest_nav: price?.nav || null,
      daily_change_pct: price?.daily_change_pct || null,
      price_date: price?.date || null,
    };
  });

  // Build price history per fund for backtest
  const priceHistory = new Map<string, { date: string; nav: number }[]>();
  for (const p of allPrices || []) {
    if (!priceHistory.has(p.fund_id)) priceHistory.set(p.fund_id, []);
    priceHistory.get(p.fund_id)!.push({ date: p.date, nav: p.nav });
  }
  // Sort each fund's prices chronologically
  for (const [, pp] of priceHistory) {
    pp.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Get reference portfolio
  const { data: refPortfolio, error: refError } = await supabase
    .from("mpf_reference_portfolio")
    .select("fund_id, weight, note, updated_at");

  if (refError) console.error("[mpf-care] refPortfolio query failed:", refError.code, refError.message);

  // Build reference portfolio with returns
  const fundIdToCode = new Map((funds || []).map((f) => [f.id, f]));
  const now = new Date();
  const ytdStart = `${now.getFullYear()}-01-01`;

  const portfolioFunds: { fund_code: string; name_en: string; weight: number; note: string | null; latest_nav: number | null; daily_change_pct: number | null; returns: { mtd: number | null; ytd: number | null; y1: number | null } }[] = (refPortfolio || []).map((rp) => {
    const fund = fundIdToCode.get(rp.fund_id);
    if (!fund) return null;
    const latestPrice = priceMap.get(rp.fund_id);
    const history = priceHistory.get(rp.fund_id) || [];

    // Calculate returns
    const latestNav = latestPrice?.nav || null;
    const firstNav = history.length > 0 ? history[0].nav : null;

    // MTD: latest vs previous month
    const prevMonth = history.length >= 2 ? history[history.length - 2].nav : null;
    const mtd = latestNav && prevMonth ? ((latestNav - prevMonth) / prevMonth) * 100 : null;

    // YTD: latest vs closest to Jan 1
    const ytdPrice = history.find((p) => p.date >= ytdStart) || history[0];
    const ytd = latestNav && ytdPrice ? ((latestNav - ytdPrice.nav) / ytdPrice.nav) * 100 : null;

    // 1Y: latest vs first (our data spans ~11 months)
    const y1 = latestNav && firstNav ? ((latestNav - firstNav) / firstNav) * 100 : null;

    return {
      fund_code: fund.fund_code,
      name_en: fund.name_en,
      weight: rp.weight,
      note: rp.note,
      latest_nav: latestNav,
      daily_change_pct: latestPrice?.daily_change_pct || null,
      returns: { mtd, ytd, y1 },
    };
  }).filter((f): f is NonNullable<typeof f> => f !== null);

  const refUpdatedAt = refPortfolio?.[0]?.updated_at || now.toISOString();

  // Get latest news (5 items)
  const { data: news } = await supabase
    .from("mpf_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(5);

  // Get latest completed insight
  const { data: latestInsight } = await supabase
    .from("mpf_insights")
    .select("*")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Get latest debate log
  const { data: latestDebate } = await supabase
    .from("mpf_insights")
    .select("content_en, content_zh, created_at")
    .eq("type", "rebalance_debate")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Recent rebalance scores (admin client bypasses RLS)
  const adminClient = createAdminClient();
  const { data: recentScores } = await adminClient
    .from("mpf_rebalance_scores")
    .select("*")
    .not("insight_id", "is", null)
    .order("scored_at", { ascending: false })
    .limit(20);

  // Portfolio NAV history (tracked performance) — use admin client to bypass RLS
  const { data: portfolioNav, error: navError } = await adminClient
    .from("mpf_portfolio_nav")
    .select("date, nav, daily_return_pct, is_cash")
    .order("date", { ascending: true });

  if (navError) {
    console.error("[mpf-care] portfolioNav query failed:", navError.code, navError.message);
  }

  // Last scraper run
  const { data: lastRun } = await supabase
    .from("scraper_runs")
    .select("run_at, status, scraper_name")
    .eq("status", "success")
    .order("run_at", { ascending: false })
    .limit(1)
    .single();

  return {
    fundsWithPrices,
    portfolioFunds,
    refUpdatedAt,
    news: (news || []) as MpfNews[],
    latestInsight: latestInsight as MpfInsight | null,
    latestDebate: latestDebate as { content_en: string | null; content_zh: string | null; created_at: string } | null,
    recentScores: (recentScores || []) as RebalanceScore[],
    lastRun,
    priceDate,
    portfolioNav: (portfolioNav || []) as { date: string; nav: number; daily_return_pct: number | null; is_cash: boolean }[],
  };
}

export default async function MpfCarePage() {
  const { fundsWithPrices, portfolioFunds, refUpdatedAt, news, latestInsight, latestDebate, recentScores, lastRun, priceDate, portfolioNav } = await getOverviewData();

  return (
    <main className="max-w-[980px] mx-auto px-6 py-8 lg:py-16 xl:py-24">
      <header className="mb-8 lg:mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          MPF Care
        </h1>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          AIA MPF Care Profile — Fund performance & insights
          {lastRun && (
            <span className="ml-3 text-zinc-400">
              Last updated: {new Date(lastRun.run_at).toLocaleDateString("en-HK")}
            </span>
          )}
        </p>
      </header>

      <DisclaimerBanner />

      {/* Sub-navigation */}
      <nav aria-label="MPF Care sections" className="mt-8 flex items-center gap-2 sm:gap-4 flex-wrap">
        <a
          href="/mpf-care/news"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Newspaper className="w-3.5 h-3.5" />
          News
        </a>
        <a
          href="/mpf-care/insights"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Brain className="w-3.5 h-3.5" />
          Insights
        </a>
        <a
          href="/mpf-care/health"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Activity className="w-3.5 h-3.5" />
          Health
        </a>
        <a
          href="/mpf-care/screener"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Screener
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
            Top Movers — {priceDate}
          </h2>
        </div>
        <TopMovers funds={fundsWithPrices} />
      </section>

      {/* Fund Heatmap */}
      <section aria-labelledby="heatmap-heading" className="mb-16">
        <h2 id="heatmap-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-6">
          All Funds
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
                Latest News
              </h2>
            </div>
            <a href="/mpf-care/news" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
              View all
            </a>
          </div>
          {news.length === 0 ? (
            <p className="text-sm text-zinc-300">No news collected yet.</p>
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
                Latest Profile
              </h2>
            </div>
            <a href="/mpf-care/insights" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
              View all
            </a>
          </div>
          {latestInsight ? (
            <div className="text-[13px] text-zinc-400 leading-relaxed whitespace-pre-wrap line-clamp-[12]">
              {latestInsight.content_en}
            </div>
          ) : (
            <p className="text-sm text-zinc-300">No insights generated yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
