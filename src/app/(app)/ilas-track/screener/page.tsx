// src/app/(app)/ilas-track/screener/page.tsx
// ILAS Fund Screener — sortable table with category tabs, fund house filter, distribution toggle
// All server-rendered via searchParams

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ILAS_SCREENER_CATEGORIES,
} from "@/lib/ilas/constants";
import type {
  IlasFundCategory,
  IlasFundWithLatestPrice,
  IlasFundMetrics,
} from "@/lib/ilas/types";
import { IlasScreenerView } from "./screener-view";

// ---------- Types ----------

type SortKey = "name" | "code" | "category" | "currency" | "risk" | "nav" | "change" | "sharpe" | "sortino" | "drawdown";
type SortDir = "asc" | "desc";
type DistFilter = "all" | "acc" | "dis";

const SCREENER_CATEGORY_KEYS = Object.keys(ILAS_SCREENER_CATEGORIES) as (keyof typeof ILAS_SCREENER_CATEGORIES)[];

// ---------- Data fetching ----------

async function getScreenerData() {
  const supabase = createAdminClient();

  // 1. All active USD funds (non-USD funds excluded per system scope)
  const { data: funds, error: fundsError } = await supabase
    .from("ilas_funds")
    .select("*")
    .eq("is_active", true)
    .eq("currency", "USD")
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
        cmp = (riskOrder[a.risk_rating as keyof typeof riskOrder] || 0) - (riskOrder[b.risk_rating as keyof typeof riskOrder] || 0);
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

  // Unique fund houses
  const fundHouses = [...new Set(fundsWithPrices.map((f) => f.fund_house))].sort();

  return (
    <IlasScreenerView
      sorted={sorted}
      fundsTotal={fundsWithPrices.length}
      latestDate={latestDate}
      hasMetrics={hasMetrics}
      activeCat={activeCat}
      activeHouse={activeHouse}
      activeDist={activeDist}
      sortKey={sortKey}
      sortDir={sortDir}
      fundHouses={fundHouses}
    />
  );
}
