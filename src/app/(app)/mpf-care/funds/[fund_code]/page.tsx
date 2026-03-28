import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { FundChart } from "@/components/mpf/fund-chart";
import { RiskMetrics } from "@/components/mpf/risk-metrics";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import type { MpfFund, MpfPrice, MpfNews, FundMetrics, MetricPeriod } from "@/lib/mpf/types";
import { FUND_CATEGORY_LABELS, AIA_API_CODE_MAP } from "@/lib/mpf/constants";
import type { FundCategory } from "@/lib/mpf/types";

export default async function FundExplorerPage({
  params,
}: {
  params: Promise<{ fund_code: string }>;
}) {
  const { fund_code } = await params;
  const supabase = createAdminClient();

  // Get fund
  const { data: fund, error: fundError } = await supabase
    .from("mpf_funds")
    .select("*")
    .eq("fund_code", fund_code)
    .single();

  if (fundError) console.error("[fund-detail] fund query error:", fundError);
  if (!fund) notFound();

  // Get all prices for chart
  const { data: prices, error: pricesError } = await supabase
    .from("mpf_prices")
    .select("date, nav, daily_change_pct, source")
    .eq("fund_id", fund.id)
    .order("date", { ascending: true });

  if (pricesError) console.error("[fund-detail] prices query error:", pricesError);

  // Get correlated news
  const { data: correlatedNews, error: newsError } = await supabase
    .from("mpf_fund_news")
    .select("impact_note, mpf_news(headline, summary, source, published_at, sentiment, url)")
    .eq("fund_id", fund.id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (newsError) console.error("[fund-detail] correlated news query error:", newsError);

  // Get risk metrics for all periods
  const { data: allMetrics, error: metricsError } = await supabase
    .from("mpf_fund_metrics")
    .select("*")
    .eq("fund_id", fund.id);

  if (metricsError) console.error("[fund-detail] metrics query error:", metricsError);

  const metricsMap: Record<MetricPeriod, FundMetrics | null> = {
    "1y": null, "3y": null, "5y": null, "since_launch": null,
  };
  for (const m of allMetrics || []) {
    metricsMap[m.period as MetricPeriod] = m as FundMetrics;
  }

  // Calculate returns
  const priceList = prices || [];
  const latest = priceList[priceList.length - 1];
  const calcReturn = (daysAgo: number) => {
    if (!latest) return null;
    const targetDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const past = priceList.findLast((p) => p.date <= targetDate);
    if (!past) return null;
    return ((latest.nav - past.nav) / past.nav * 100);
  };

  const returns = {
    "1D": latest?.daily_change_pct || null,
    "1W": calcReturn(7),
    "1M": calcReturn(30),
    "3M": calcReturn(90),
    "1Y": calcReturn(365),
    "5Y": calcReturn(1825),
  };

  const riskStars = "★".repeat(fund.risk_rating) + "☆".repeat(5 - fund.risk_rating);

  return (
    <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-8 lg:py-16 xl:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <a href="/mpf-care" className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors">
            ← MPF Care
          </a>
        </div>
        <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          {fund.name_en}
        </h1>
        <div className="flex items-center gap-4 mt-2">
          <span className="text-[12px] font-mono text-zinc-300">{fund.fund_code}</span>
          <span className="text-[12px] text-zinc-300">{FUND_CATEGORY_LABELS[fund.category as FundCategory]}</span>
          <span className="text-[12px] text-amber-500" aria-label={`Risk rating ${fund.risk_rating} of 5`}>{riskStars}</span>
          {(() => {
            const aiaCode = Object.entries(AIA_API_CODE_MAP).find(([, code]) => code === fund.fund_code)?.[0];
            return aiaCode ? (
              <a
                href={`https://www.aia.com.hk/en/products/mpf/list/fund?id=${aiaCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono text-[#D71920] hover:text-red-400 transition-colors"
              >
                View on AIA ↗
              </a>
            ) : null;
          })()}
        </div>
        {latest && (
          <div className="mt-4">
            <span className="text-[clamp(1.5rem,2.5vw,2rem)] font-semibold font-mono text-zinc-50 tabular-nums">
              ${latest.nav.toFixed(4)}
            </span>
            <span className="text-[12px] font-mono text-zinc-400 ml-2">NAV as of {latest.date}</span>
          </div>
        )}
      </header>

      {/* Price Chart */}
      <section aria-label="Price chart" className="mb-16">
        <FundChart prices={priceList.map((p) => ({ date: p.date, nav: p.nav }))} />
      </section>

      {/* Risk Metrics */}
      <div className="mb-16">
        <RiskMetrics metrics={metricsMap} />
      </div>

      {/* Returns Table */}
      <section aria-labelledby="returns-heading" className="mb-16">
        <h2 id="returns-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-4">
          Performance
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
          {Object.entries(returns).map(([period, value]) => (
            <div key={period}>
              <div className="text-[11px] font-mono text-zinc-400">{period}</div>
              <div className={`text-[16px] font-mono font-semibold tabular-nums ${
                value === null ? "text-zinc-400" :
                value > 0 ? "text-emerald-400" : "text-red-400"
              }`}>
                {value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Correlated News */}
      <section aria-labelledby="correlated-news-heading" className="mb-12">
        <h2 id="correlated-news-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-4">
          Correlated News
        </h2>
        {(!correlatedNews || correlatedNews.length === 0) ? (
          <p className="text-sm text-zinc-300">No correlated news events yet.</p>
        ) : (
          <ol className="space-y-0 divide-y divide-zinc-800/60">
            {correlatedNews.map((item, i) => {
              const news = item.mpf_news as unknown as MpfNews;
              return (
                <li key={i} className="py-3 first:pt-0">
                  <a
                    href={news?.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    {news?.headline}
                  </a>
                  {item.impact_note && (
                    <p className="text-[12px] text-zinc-300 mt-1">{item.impact_note}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <DisclaimerBanner />
    </main>
  );
}
