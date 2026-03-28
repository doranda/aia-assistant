// src/app/(app)/ilas-track/screener/page.tsx
// ILAS Fund Screener — sortable table with category tabs, fund house filter, distribution toggle
// All server-rendered via searchParams

import { createAdminClient } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";
import {
  ILAS_CATEGORY_LABELS,
  ILAS_SCREENER_CATEGORIES,
  ILAS_FUND_HOUSE_LIST,
  ILAS_INSIGHT_DISCLAIMER,
} from "@/lib/ilas/constants";
import type {
  IlasFund,
  IlasFundCategory,
  IlasFundWithLatestPrice,
  IlasFundMetrics,
} from "@/lib/ilas/types";
import { ArrowLeft, Filter, ArrowUpDown } from "lucide-react";
import Link from "next/link";

// ---------- Types ----------

type SortKey = "name" | "code" | "category" | "currency" | "risk" | "nav" | "change" | "sharpe" | "sortino" | "drawdown";
type SortDir = "asc" | "desc";
type DistFilter = "all" | "acc" | "dis";

const SCREENER_CATEGORY_KEYS = Object.keys(ILAS_SCREENER_CATEGORIES) as (keyof typeof ILAS_SCREENER_CATEGORIES)[];

// ---------- Data fetching ----------

async function getScreenerData() {
  const supabase = createAdminClient();

  // 1. All active funds
  const { data: funds, error: fundsError } = await supabase
    .from("ilas_funds")
    .select("*")
    .eq("is_active", true)
    .order("fund_code");

  if (fundsError) console.error("[ilas-screener] funds query failed:", fundsError.code, fundsError.message);

  // 2. Latest price date
  const { data: latestDateRow, error: dateError } = await supabase
    .from("ilas_prices")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (dateError) console.error("[ilas-screener] latest date query failed:", dateError.code, dateError.message);

  const latestDate = latestDateRow?.date || new Date().toISOString().split("T")[0];

  // 3. All prices for latest date
  const { data: prices, error: pricesError } = await supabase
    .from("ilas_prices")
    .select("fund_id, nav, daily_change_pct, date")
    .eq("date", latestDate);

  if (pricesError) console.error("[ilas-screener] prices query failed:", pricesError.code, pricesError.message);

  // 4. Fund metrics (1y period)
  const { data: metrics, error: metricsError } = await supabase
    .from("ilas_fund_metrics")
    .select("fund_id, fund_code, sharpe_ratio, sortino_ratio, max_drawdown_pct, annualized_return_pct")
    .eq("period", "1y");

  if (metricsError) console.error("[ilas-screener] metrics query failed:", metricsError.code, metricsError.message);

  // 5. Build maps
  const priceMap = new Map((prices || []).map((p) => [p.fund_id, p]));
  const metricsMap = new Map((metrics || []).map((m) => [m.fund_id, m]));

  // 6. Merge
  const fundsWithPrices: (IlasFundWithLatestPrice & {
    sharpe_ratio: number | null;
    sortino_ratio: number | null;
    max_drawdown_pct: number | null;
    annualized_return_pct: number | null;
  })[] = (funds || []).map((f) => {
    const price = priceMap.get(f.id);
    const metric = metricsMap.get(f.id);
    return {
      ...f,
      latest_nav: price?.nav ?? null,
      daily_change_pct: price?.daily_change_pct ?? null,
      price_date: price?.date || null,
      sharpe_ratio: metric?.sharpe_ratio ?? null,
      sortino_ratio: metric?.sortino_ratio ?? null,
      max_drawdown_pct: metric?.max_drawdown_pct ?? null,
      annualized_return_pct: metric?.annualized_return_pct ?? null,
    };
  });

  const hasMetrics = (metrics || []).length > 0;

  return { fundsWithPrices, latestDate, hasMetrics };
}

// ---------- Helpers ----------

function getRiskBadgeColor(risk: string) {
  switch (risk) {
    case "Low": return "text-emerald-400 bg-emerald-950/40 border-emerald-800/30";
    case "Medium": return "text-amber-400 bg-amber-950/40 border-amber-800/30";
    case "High": return "text-red-400 bg-red-950/40 border-red-800/30";
    default: return "text-zinc-400 bg-zinc-900/40 border-zinc-800/30";
  }
}

function buildSortUrl(
  currentSort: SortKey,
  currentDir: SortDir,
  newSort: SortKey,
  baseParams: Record<string, string>
) {
  const dir = currentSort === newSort && currentDir === "desc" ? "asc" : "desc";
  const p = new URLSearchParams(baseParams);
  p.set("sort", newSort);
  p.set("dir", dir);
  return `/ilas-track/screener?${p.toString()}`;
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  baseParams,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  baseParams: Record<string, string>;
  align?: "left" | "right";
}) {
  const isActive = currentSort === sortKey;
  return (
    <th
      className={cn(
        "px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400 whitespace-nowrap",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      <Link
        href={buildSortUrl(currentSort, currentDir, sortKey, baseParams)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-zinc-200 transition-colors",
          align === "right" && "flex-row-reverse",
          isActive && "text-zinc-200"
        )}
      >
        {label}
        {isActive && (
          <span className="text-[#D71920]">{currentDir === "desc" ? "\u2193" : "\u2191"}</span>
        )}
      </Link>
    </th>
  );
}

// ---------- Page ----------

export default async function IlasScreenerPage({
  searchParams,
}: {
  searchParams: Promise<{
    cat?: string;
    house?: string;
    dist?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const params = await searchParams;

  const activeCat = SCREENER_CATEGORY_KEYS.includes(params.cat as keyof typeof ILAS_SCREENER_CATEGORIES)
    ? (params.cat as keyof typeof ILAS_SCREENER_CATEGORIES)
    : "All";
  const activeHouse = params.house || "";
  const activeDist: DistFilter = (["all", "acc", "dis"] as DistFilter[]).includes(params.dist as DistFilter)
    ? (params.dist as DistFilter)
    : "all";
  const sortKey: SortKey = (["name", "code", "category", "currency", "risk", "nav", "change", "sharpe", "sortino", "drawdown"] as SortKey[]).includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : "code";
  const sortDir: SortDir = params.dir === "asc" ? "asc" : "desc";

  const { fundsWithPrices, latestDate, hasMetrics } = await getScreenerData();

  // ---------- Filter ----------

  const allowedCategories = activeCat === "All"
    ? null
    : ILAS_SCREENER_CATEGORIES[activeCat];

  let filtered = fundsWithPrices;

  // Category filter
  if (allowedCategories) {
    filtered = filtered.filter((f) => (allowedCategories as readonly string[]).includes(f.category));
  }

  // Fund house filter
  if (activeHouse) {
    filtered = filtered.filter((f) => f.fund_house === activeHouse);
  }

  // Distribution toggle
  if (activeDist === "acc") {
    filtered = filtered.filter((f) => !f.is_distribution);
  } else if (activeDist === "dis") {
    filtered = filtered.filter((f) => f.is_distribution);
  }

  // ---------- Sort ----------

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name": cmp = a.name_en.localeCompare(b.name_en); break;
      case "code": cmp = a.fund_code.localeCompare(b.fund_code); break;
      case "category": cmp = a.category.localeCompare(b.category); break;
      case "currency": cmp = a.currency.localeCompare(b.currency); break;
      case "risk": {
        const riskOrder = { Low: 0, Medium: 1, High: 2 };
        cmp = (riskOrder[a.risk_rating] || 0) - (riskOrder[b.risk_rating] || 0);
        break;
      }
      case "nav": cmp = (a.latest_nav || 0) - (b.latest_nav || 0); break;
      case "change": cmp = (a.daily_change_pct || 0) - (b.daily_change_pct || 0); break;
      case "sharpe": cmp = (a.sharpe_ratio || 0) - (b.sharpe_ratio || 0); break;
      case "sortino": cmp = (a.sortino_ratio || 0) - (b.sortino_ratio || 0); break;
      case "drawdown": cmp = (a.max_drawdown_pct || 0) - (b.max_drawdown_pct || 0); break;
    }
    return sortDir === "desc" ? -cmp : cmp;
  });

  // Base params for sort links (preserve filters)
  const baseParams: Record<string, string> = {};
  if (activeCat !== "All") baseParams.cat = activeCat;
  if (activeHouse) baseParams.house = activeHouse;
  if (activeDist !== "all") baseParams.dist = activeDist;

  // Build filter URL helper
  function filterUrl(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (activeCat !== "All" && !overrides.cat) p.set("cat", activeCat);
    if (activeHouse && !("house" in overrides)) p.set("house", activeHouse);
    if (activeDist !== "all" && !("dist" in overrides)) p.set("dist", activeDist);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v);
    }
    const qs = p.toString();
    return `/ilas-track/screener${qs ? `?${qs}` : ""}`;
  }

  // Unique fund houses present in the current filtered set (for dropdown)
  const fundHouses = [...new Set(fundsWithPrices.map((f) => f.fund_house))].sort();

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 lg:py-16 xl:py-24">
      {/* Back + Header */}
      <div className="mb-8 lg:mb-12">
        <Link
          href="/ilas-track"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          ILAS Track
        </Link>
        <h1 className="text-[clamp(1.75rem,3.5vw,2.5rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          ILAS Fund Screener
        </h1>
        <p className="text-sm text-zinc-300 mt-2 font-mono">
          {sorted.length} of {fundsWithPrices.length} funds — Prices as at {latestDate}
        </p>
      </div>

      {/* Disclaimer */}
      <aside
        role="note"
        aria-label="Disclaimer"
        className="text-[11px] text-zinc-400 font-mono border border-zinc-800/40 rounded-md px-4 py-2.5 mb-8"
      >
        {ILAS_INSIGHT_DISCLAIMER.en}
      </aside>

      {/* Filters */}
      <div className="space-y-4 sm:space-y-0 sm:flex sm:items-center sm:gap-4 sm:flex-wrap mb-8">
        {/* Category Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mb-1" role="tablist" aria-label="Category filter">
          {SCREENER_CATEGORY_KEYS.map((cat) => (
            <Link
              key={cat}
              href={filterUrl({ cat: cat === "All" ? "" : cat })}
              role="tab"
              aria-selected={activeCat === cat}
              className={cn(
                "px-3 py-2 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0",
                activeCat === cat
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              )}
            >
              {cat}
            </Link>
          ))}
        </div>

        {/* Fund House Dropdown — rendered as links in a details/summary */}
        <div className="relative">
          <details className="group">
            <summary className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-800/60 rounded-md cursor-pointer transition-colors list-none">
              <Filter className="w-3.5 h-3.5" />
              {activeHouse ? fundHouses.find((h) => h === activeHouse)?.split(" ").slice(0, 2).join(" ") || "Fund House" : "Fund House"}
            </summary>
            <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-800/60 rounded-md shadow-xl max-h-[300px] overflow-y-auto w-[280px] sm:w-[340px]">
              <Link
                href={filterUrl({ house: "" })}
                className={cn(
                  "block px-3 py-2 text-[12px] transition-colors",
                  !activeHouse ? "text-zinc-100 bg-zinc-800" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                )}
              >
                All Fund Houses
              </Link>
              {fundHouses.map((house) => (
                <Link
                  key={house}
                  href={filterUrl({ house })}
                  className={cn(
                    "block px-3 py-2 text-[12px] transition-colors truncate",
                    activeHouse === house ? "text-zinc-100 bg-zinc-800" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                  )}
                >
                  {house}
                </Link>
              ))}
            </div>
          </details>
        </div>

        {/* Distribution Toggle */}
        <div className="flex items-center gap-1 border border-zinc-800/60 rounded-md p-0.5">
          {([
            { key: "all" as DistFilter, label: "All" },
            { key: "acc" as DistFilter, label: "Acc" },
            { key: "dis" as DistFilter, label: "Dist" },
          ]).map(({ key, label }) => (
            <Link
              key={key}
              href={filterUrl({ dist: key === "all" ? "" : key })}
              className={cn(
                "px-3 py-1.5 text-[12px] font-medium rounded transition-colors",
                activeDist === key
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-zinc-800/60 rounded-lg">
        <table className="w-full min-w-[520px] text-left">
          <thead className="border-b border-zinc-800/60 bg-zinc-900/30">
            <tr>
              <SortHeader label="Fund Name" sortKey="name" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} />
              <SortHeader label="Code" sortKey="code" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} />
              <SortHeader label="Category" sortKey="category" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} />
              <SortHeader label="Ccy" sortKey="currency" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} />
              <SortHeader label="Risk" sortKey="risk" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} />
              <SortHeader label="NAV" sortKey="nav" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} align="right" />
              <SortHeader label="Daily" sortKey="change" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} align="right" />
              {hasMetrics && (
                <>
                  <SortHeader label="Sharpe" sortKey="sharpe" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} align="right" />
                  <SortHeader label="Sortino" sortKey="sortino" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} align="right" />
                  <SortHeader label="Max DD" sortKey="drawdown" currentSort={sortKey} currentDir={sortDir} baseParams={baseParams} align="right" />
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/40">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={hasMetrics ? 10 : 7} className="px-3 py-8 text-center text-[13px] text-zinc-400">
                  No funds match the current filters.
                </td>
              </tr>
            )}
            {sorted.map((fund) => {
              const pct = fund.daily_change_pct;
              return (
                <tr key={fund.id} className="hover:bg-zinc-800/20 transition-colors">
                  <td className="px-3 py-2.5 max-w-[260px]">
                    <Link
                      href={`/ilas-track/funds/${fund.fund_code}`}
                      className="text-[13px] text-zinc-300 hover:text-zinc-100 transition-colors line-clamp-1"
                    >
                      {fund.name_en}
                    </Link>
                    {fund.is_distribution && (
                      <span className="inline-block ml-1.5 text-[9px] font-mono text-amber-400 bg-amber-950/30 border border-amber-800/20 rounded px-1 py-0.5 align-middle">
                        DIS
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] font-mono text-zinc-400">{fund.fund_code}</td>
                  <td className="px-3 py-2.5 text-[11px] text-zinc-400 whitespace-nowrap">
                    {ILAS_CATEGORY_LABELS[fund.category as IlasFundCategory]?.replace(/^(Equity|Fixed Income|Multi-Assets|Liquidity)\s*[-/]\s*/, "") || fund.category}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] font-mono text-zinc-500">{fund.currency}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn(
                      "text-[10px] font-mono font-medium px-1.5 py-0.5 rounded border",
                      getRiskBadgeColor(fund.risk_rating)
                    )}>
                      {fund.risk_rating}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] font-mono tabular-nums text-zinc-300">
                    {fund.latest_nav !== null ? fund.latest_nav.toFixed(4) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {pct !== null ? (
                      <span className={cn(
                        "text-[13px] font-mono font-semibold tabular-nums",
                        pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-zinc-500"
                      )}>
                        {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="text-[13px] font-mono text-zinc-500">—</span>
                    )}
                  </td>
                  {hasMetrics && (
                    <>
                      <td className="px-3 py-2.5 text-right text-[12px] font-mono tabular-nums text-zinc-400">
                        {fund.sharpe_ratio !== null ? fund.sharpe_ratio.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12px] font-mono tabular-nums text-zinc-400">
                        {fund.sortino_ratio !== null ? fund.sortino_ratio.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {fund.max_drawdown_pct !== null ? (
                          <span className="text-[12px] font-mono tabular-nums text-red-400">
                            {fund.max_drawdown_pct.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[12px] font-mono text-zinc-500">—</span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Status Bar */}
      <footer className="border-t border-zinc-800/40 pt-4 mt-8">
        <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] font-mono text-zinc-500">
          <span>
            {sorted.length} fund{sorted.length !== 1 ? "s" : ""} displayed
            {activeHouse && <> — {activeHouse.split(" ").slice(0, 3).join(" ")}</>}
          </span>
          <span>
            Last price date: {latestDate}
          </span>
        </div>
      </footer>
    </main>
  );
}
