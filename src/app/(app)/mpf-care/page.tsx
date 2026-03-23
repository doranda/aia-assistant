// src/app/(app)/mpf-care/page.tsx
import { createClient } from "@/lib/supabase/server";
import { PortfolioReference } from "@/components/mpf/portfolio-reference";
import { FundHeatmap } from "@/components/mpf/fund-heatmap";
import { TopMovers } from "@/components/mpf/top-movers";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import type { FundWithLatestPrice, MpfNews, MpfInsight } from "@/lib/mpf/types";
import { TrendingUp, Newspaper, Brain } from "lucide-react";

async function getOverviewData() {
  const supabase = await createClient();

  // Get all funds with latest price
  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("*")
    .eq("is_active", true)
    .order("fund_code");

  // Get today's prices
  const today = new Date().toISOString().split("T")[0];
  const { data: todayPrices } = await supabase
    .from("mpf_prices")
    .select("fund_id, nav, daily_change_pct, date")
    .eq("date", today);

  // If no today prices, get latest price per fund
  let prices = todayPrices;
  let priceDate = today;
  if (!prices?.length) {
    // Fetch enough rows to cover all 25 funds even with sparse data
    const { data: latestPrices } = await supabase
      .from("mpf_prices")
      .select("fund_id, nav, daily_change_pct, date")
      .order("date", { ascending: false })
      .limit(200);
    // Deduplicate: keep only the latest price per fund_id
    const seen = new Set<string>();
    prices = (latestPrices || []).filter((p) => {
      if (seen.has(p.fund_id)) return false;
      seen.add(p.fund_id);
      return true;
    });
    priceDate = prices?.[0]?.date || today;
  }

  const priceMap = new Map(prices?.map((p) => [p.fund_id, p]) || []);

  const fundsWithPrices: FundWithLatestPrice[] = (funds || []).map((f) => {
    const price = priceMap.get(f.id);
    return {
      ...f,
      latest_nav: price?.nav || null,
      daily_change_pct: price?.daily_change_pct || null,
      price_date: price?.date || null,
    };
  });

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

  // Last scraper run
  const { data: lastRun } = await supabase
    .from("scraper_runs")
    .select("run_at, status, scraper_name")
    .eq("status", "success")
    .order("run_at", { ascending: false })
    .limit(1)
    .single();

  return { fundsWithPrices, news: (news || []) as MpfNews[], latestInsight: latestInsight as MpfInsight | null, lastRun, priceDate };
}

export default async function MpfCarePage() {
  const { fundsWithPrices, news, latestInsight, lastRun, priceDate } = await getOverviewData();

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          MPF Care
        </h1>
        <p className="text-sm text-zinc-500 mt-2 font-mono">
          AIA MPF Care Profile — Fund performance & insights
          {lastRun && (
            <span className="ml-3 text-zinc-600">
              Last updated: {new Date(lastRun.run_at).toLocaleDateString("en-HK")}
            </span>
          )}
        </p>
      </header>

      <DisclaimerBanner />

      {/* Portfolio Reference — first thing users see */}
      <div className="mt-12">
        <PortfolioReference funds={fundsWithPrices} priceDate={priceDate} />
      </div>

      {/* Top Movers — split into Gainers and Losers */}
      <section aria-labelledby="top-movers-heading" className="mb-16">
        <div className="flex items-center gap-2 mb-6">
          <TrendingUp className="w-4 h-4 text-zinc-600" />
          <h2 id="top-movers-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            Top Movers — {priceDate}
          </h2>
        </div>
        <TopMovers funds={fundsWithPrices} />
      </section>

      {/* Fund Heatmap */}
      <section aria-labelledby="heatmap-heading" className="mb-16">
        <h2 id="heatmap-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 mb-6">
          All Funds
        </h2>
        <FundHeatmap funds={fundsWithPrices} />
      </section>

      {/* Two columns: News + Latest Insight */}
      <div className="grid lg:grid-cols-2 gap-16">
        {/* Latest News */}
        <section aria-labelledby="news-heading">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-zinc-600" />
              <h2 id="news-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                Latest News
              </h2>
            </div>
            <a href="/mpf-care/news" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
              View all
            </a>
          </div>
          {news.length === 0 ? (
            <p className="text-sm text-zinc-500">No news collected yet.</p>
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
                    <span className="text-[10px] font-mono text-zinc-600">{n.source}</span>
                    <span className={`text-[10px] font-mono ${
                      n.sentiment === "positive" ? "text-emerald-500" :
                      n.sentiment === "negative" ? "text-red-500" : "text-zinc-600"
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
              <Brain className="w-4 h-4 text-zinc-600" />
              <h2 id="insight-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
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
            <p className="text-sm text-zinc-500">No insights generated yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
