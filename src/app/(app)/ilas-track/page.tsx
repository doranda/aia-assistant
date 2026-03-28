// src/app/(app)/ilas-track/page.tsx
// ILAS Track — Investment-Linked Assurance Scheme fund dashboard
// Two tabs: Accumulation (106 funds) | Distribution (36 funds)
// Top Movers + Fund Heatmap per tab

import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import { ILAS_CATEGORY_LABELS, ILAS_INSIGHT_DISCLAIMER } from "@/lib/ilas/constants";
import type { IlasFund, IlasFundCategory, IlasFundWithLatestPrice } from "@/lib/ilas/types";
import { TrendingUp, BarChart3, Newspaper, Filter } from "lucide-react";
import Link from "next/link";

// ---------- Data fetching ----------

async function getIlasData(isDistribution: boolean) {
  const supabase = createAdminClient();

  // 1. Get funds filtered by share class
  const { data: funds, error: fundsError } = await supabase
    .from("ilas_funds")
    .select("*")
    .eq("is_active", true)
    .eq("is_distribution", isDistribution)
    .order("fund_code");

  if (fundsError) console.error("[ilas-track] funds query failed:", fundsError.code, fundsError.message);

  // 2. Get latest price date
  const { data: latestDateRow, error: dateError } = await supabase
    .from("ilas_prices")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (dateError) console.error("[ilas-track] latest date query failed:", dateError.code, dateError.message);

  const latestDate = latestDateRow?.date || new Date().toISOString().split("T")[0];

  // 3. Get all prices for the latest date
  const { data: prices, error: pricesError } = await supabase
    .from("ilas_prices")
    .select("fund_id, nav, daily_change_pct, date")
    .eq("date", latestDate);

  if (pricesError) console.error("[ilas-track] prices query failed:", pricesError.code, pricesError.message);

  // 4. Build price map
  const priceMap = new Map((prices || []).map((p) => [p.fund_id, p]));

  // 5. Merge funds with prices
  const fundsWithPrices: IlasFundWithLatestPrice[] = (funds || []).map((f) => {
    const price = priceMap.get(f.id);
    return {
      ...f,
      latest_nav: price?.nav || null,
      daily_change_pct: price?.daily_change_pct || null,
      price_date: price?.date || null,
    };
  });

  // 6. Get fund counts for both tabs
  const { count: accCount } = await supabase
    .from("ilas_funds")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("is_distribution", false);

  const { count: disCount } = await supabase
    .from("ilas_funds")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true)
    .eq("is_distribution", true);

  return {
    fundsWithPrices,
    latestDate,
    accCount: accCount || 0,
    disCount: disCount || 0,
  };
}

// ---------- Sub-components (inline, server-rendered) ----------

function IlasTopMovers({ funds }: { funds: IlasFundWithLatestPrice[] }) {
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
    <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
      {/* Gainers */}
      <div>
        <h3 className="text-[10px] font-mono uppercase tracking-wider text-emerald-500/70 mb-4">
          Top Gainers
        </h3>
        <ol className="space-y-0 divide-y divide-zinc-800/60">
          {gainers.map((fund) => (
            <li key={fund.id} className="py-3 first:pt-0">
              <Link
                href={`/ilas-track/funds/${fund.fund_code}`}
                className="flex items-center justify-between hover:bg-zinc-800/20 -mx-2 px-2 rounded transition-colors"
              >
                <div className="min-w-0 mr-3">
                  <span className="text-[13px] text-zinc-300 line-clamp-1">{fund.name_en}</span>
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
            <li key={fund.id} className="py-3 first:pt-0">
              <Link
                href={`/ilas-track/funds/${fund.fund_code}`}
                className="flex items-center justify-between hover:bg-zinc-800/20 -mx-2 px-2 rounded transition-colors"
              >
                <div className="min-w-0 mr-3">
                  <span className="text-[13px] text-zinc-300 line-clamp-1">{fund.name_en}</span>
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
            <li className="py-3 text-[13px] text-zinc-400">No losers</li>
          )}
        </ol>
      </div>
    </div>
  );
}

function IlasHeatmap({ funds }: { funds: IlasFundWithLatestPrice[] }) {
  // Group by category
  const grouped = funds.reduce(
    (acc, fund) => {
      const cat = fund.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(fund);
      return acc;
    },
    {} as Record<string, IlasFundWithLatestPrice[]>
  );

  // Sort categories alphabetically by label
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
                    {fund.name_en}
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

// ---------- Page ----------

export default async function IlasTrackPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const isDistribution = params.tab === "distribution";
  const { fundsWithPrices, latestDate, accCount, disCount } = await getIlasData(isDistribution);

  return (
    <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-8 lg:py-16 xl:py-24">
      {/* Header */}
      <header className="mb-8 lg:mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          ILAS Track
        </h1>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          AIA Investment-Linked Assurance Scheme — Fund performance & insights
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

      {/* Sub-navigation */}
      <nav aria-label="ILAS Track sections" className="mt-8 flex items-center gap-2 sm:gap-4 flex-wrap">
        <Link
          href="/ilas-track/screener"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Filter className="w-3.5 h-3.5" />
          Screener
        </Link>
        <Link
          href="/ilas-track/news"
          className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-300 hover:text-zinc-100 px-3 py-2.5 rounded-md transition-colors"
        >
          <Newspaper className="w-3.5 h-3.5" />
          News
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
          Accumulation
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
          Distribution
          <span className="ml-2 text-[11px] font-mono text-zinc-500">{disCount}</span>
        </Link>
      </div>

      {/* Top Movers */}
      <section aria-labelledby="top-movers-heading" className="mt-10 sm:mt-12 mb-12 sm:mb-16">
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
            {isDistribution ? "Distribution Funds" : "Accumulation Funds"} — By Category
          </h2>
        </div>
        <IlasHeatmap funds={fundsWithPrices} />
      </section>

      {/* Status Bar */}
      <footer className="border-t border-zinc-800/40 pt-4 mt-8">
        <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] font-mono text-zinc-500">
          <span>
            Showing {fundsWithPrices.length} {isDistribution ? "distribution" : "accumulation"} funds
          </span>
          <span>
            Last price date: {latestDate}
          </span>
        </div>
      </footer>
    </main>
  );
}
