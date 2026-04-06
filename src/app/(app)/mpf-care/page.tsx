// src/app/(app)/mpf-care/page.tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { MpfCareView } from "./mpf-care-view";
import type { FundWithLatestPrice, MpfNews, MpfInsight, RebalanceScore } from "@/lib/mpf/types";

async function getOverviewData() {
  const adminClient = createAdminClient();

  // Get all funds with latest price
  const { data: funds, error: fundsError } = await adminClient
    .from("mpf_funds")
    .select("*")
    .eq("is_active", true)
    .order("fund_code");

  if (fundsError) console.error("[mpf-care] funds query failed:", fundsError.code, fundsError.message);

  // Get ALL prices for backtest calculations
  const { data: allPrices, error: pricesError } = await adminClient
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

  // Get reference portfolio — use admin client (RLS blocks user session on this table)
  const { data: refPortfolio, error: refError } = await adminClient
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
  const { data: news, error: newsErr } = await adminClient
    .from("mpf_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(5);
  if (newsErr) console.error("[mpf-care] news query failed:", newsErr.code, newsErr.message);

  // Get latest completed insight
  const { data: latestInsight, error: insightErr } = await adminClient
    .from("mpf_insights")
    .select("*")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (insightErr && insightErr.code !== "PGRST116") console.error("[mpf-care] insight query failed:", insightErr.code, insightErr.message);

  // Get latest debate log
  const { data: latestDebate, error: debateErr } = await adminClient
    .from("mpf_insights")
    .select("content_en, content_zh, created_at")
    .eq("type", "rebalance_debate")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (debateErr && debateErr.code !== "PGRST116") console.error("[mpf-care] debate query failed:", debateErr.code, debateErr.message);

  // Recent rebalance scores (admin client bypasses RLS)
  const { data: recentScores, error: scoresErr } = await adminClient
    .from("mpf_rebalance_scores")
    .select("*")
    .not("insight_id", "is", null)
    .order("scored_at", { ascending: false })
    .limit(20);
  if (scoresErr) console.error("[mpf-care] rebalance scores query failed:", scoresErr.code, scoresErr.message);

  // Portfolio NAV history (tracked performance) — use admin client to bypass RLS
  const { data: portfolioNav, error: navError } = await adminClient
    .from("mpf_portfolio_nav")
    .select("date, nav, daily_return_pct, is_cash")
    .order("date", { ascending: true });

  if (navError) {
    console.error("[mpf-care] portfolioNav query failed:", navError.code, navError.message);
  }

  // Last scraper run
  const { data: lastRun, error: lastRunErr } = await adminClient
    .from("scraper_runs")
    .select("run_at, status, scraper_name")
    .eq("status", "success")
    .order("run_at", { ascending: false })
    .limit(1)
    .single();
  if (lastRunErr && lastRunErr.code !== "PGRST116") console.error("[mpf-care] lastRun query failed:", lastRunErr.code, lastRunErr.message);

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
  const data = await getOverviewData();

  return <MpfCareView {...data} />;
}
