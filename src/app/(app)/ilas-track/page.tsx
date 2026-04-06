// src/app/(app)/ilas-track/page.tsx
// ILAS Track — Investment-Linked Assurance Scheme fund dashboard
// Two tabs: Accumulation (106 funds) | Distribution (36 funds)
// Top Movers + Fund Heatmap per tab

import { createAdminClient } from "@/lib/supabase/admin";
import type { IlasFund, IlasFundWithLatestPrice } from "@/lib/ilas/types";
import { IlasTrackView } from "./ilas-track-view";

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
      latest_nav: price?.nav ?? null,
      daily_change_pct: price?.daily_change_pct ?? null,
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

  // 7. Get reference portfolio for the current tab
  const portfolioType = isDistribution ? "distribution" : "accumulation";
  const { data: portfolioRows, error: portfolioError } = await supabase
    .from("ilas_reference_portfolio")
    .select("fund_id, weight, note, updated_at")
    .eq("portfolio_type", portfolioType);

  if (portfolioError) console.error("[ilas-track] portfolio query failed:", portfolioError.code, portfolioError.message);

  // 8. Get portfolio NAV history for current tab
  const { data: portfolioNav, error: navError } = await supabase
    .from("ilas_portfolio_nav")
    .select("date, nav, daily_return_pct, is_cash")
    .eq("portfolio_type", portfolioType)
    .order("date", { ascending: true });

  if (navError) console.error("[ilas-track] portfolio nav query failed:", navError.code, navError.message);

  // Build portfolio funds with joined data
  const portfolioFunds = (portfolioRows || [])
    .map((row) => {
      const fund = (funds || []).find((f) => f.id === row.fund_id);
      if (!fund) return null;
      const price = priceMap.get(fund.id);
      return {
        fund_code: fund.fund_code,
        name_en: fund.name_en,
        weight: row.weight,
        note: row.note,
        currency: fund.currency,
        latest_nav: price?.nav ? Number(price.nav) : null,
        daily_change_pct: price?.daily_change_pct ? Number(price.daily_change_pct) : null,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => b.weight - a.weight);

  const portfolioUpdatedAt = (portfolioRows || []).reduce(
    (latest, r) => (r.updated_at > latest ? r.updated_at : latest),
    "",
  );

  // 9. Get latest debate log for this portfolio type
  const { data: latestDebate, error: debateErr } = await supabase
    .from("ilas_insights")
    .select("content_en, content_zh, created_at")
    .eq("type", "rebalance_debate")
    .eq("status", "completed")
    .eq("trigger", `debate_rebalance_${portfolioType}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (debateErr && debateErr.code !== "PGRST116") console.error("[ilas-track] debate query failed:", debateErr.code, debateErr.message);

  return {
    fundsWithPrices,
    latestDate,
    accCount: accCount || 0,
    disCount: disCount || 0,
    portfolioFunds,
    portfolioNav,
    portfolioType: portfolioType as "accumulation" | "distribution",
    portfolioUpdatedAt,
    latestDebate: latestDebate as { content_en: string | null; content_zh: string | null; created_at: string } | null,
  };
}

// ---------- Page ----------

export default async function IlasTrackPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const isDistribution = params.tab === "distribution";
  const data = await getIlasData(isDistribution);

  return <IlasTrackView {...data} isDistribution={isDistribution} />;
}
