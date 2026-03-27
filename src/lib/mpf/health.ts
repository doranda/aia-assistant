// src/lib/mpf/health.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PipelineRunStatus {
  scraper_name: string;
  date: string;
  status: "running" | "success" | "failed";
  error_message: string | null;
  records_processed: number;
  duration_ms: number | null;
}

export interface FreshnessStatus {
  label: string;
  lastUpdated: Date | null;
  hoursAgo: number | null;
  level: "green" | "yellow" | "red";
}

export interface DayCoverage {
  date: string;
  fundCount: number;
  expectedCount: number;
  isWeekend: boolean;
}

export interface OutlierFund {
  fund_code: string;
  name_en: string;
  daily_change_pct: number;
  date: string;
}

export interface NewsPipelineDay {
  date: string;
  total: number;
  classified: number;
}

export async function getPipelineStatus(
  supabase: SupabaseClient,
  days: number = 7
): Promise<PipelineRunStatus[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from("scraper_runs")
    .select("scraper_name, run_at, status, error_message, records_processed, duration_ms")
    .gte("run_at", since.toISOString())
    .order("run_at", { ascending: false });

  return (data || []).map((r) => ({
    ...r,
    date: new Date(r.run_at).toISOString().split("T")[0],
  }));
}

export async function getDataFreshness(supabase: SupabaseClient): Promise<FreshnessStatus[]> {
  const now = new Date();

  const { data: latestPrice } = await supabase
    .from("mpf_prices")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  const { data: latestNews } = await supabase
    .from("mpf_news")
    .select("published_at")
    .order("published_at", { ascending: false })
    .limit(1)
    .single();

  const { data: latestInsight } = await supabase
    .from("mpf_insights")
    .select("created_at")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  function calcFreshness(
    label: string,
    dateStr: string | null,
    greenHrs: number,
    yellowHrs: number
  ): FreshnessStatus {
    if (!dateStr) return { label, lastUpdated: null, hoursAgo: null, level: "red" };
    const d = new Date(dateStr);
    const hoursAgo = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
    const level = hoursAgo < greenHrs ? "green" : hoursAgo < yellowHrs ? "yellow" : "red";
    return { label, lastUpdated: d, hoursAgo: Math.round(hoursAgo), level };
  }

  return [
    calcFreshness("Prices", latestPrice?.date || null, 24, 48),
    calcFreshness("News", latestNews?.published_at || null, 8, 24),
    calcFreshness("Insights", latestInsight?.created_at || null, 192, 336),
  ];
}

export async function getMissingData(
  supabase: SupabaseClient,
  days: number = 30
): Promise<DayCoverage[]> {
  const { count: expectedCount } = await supabase
    .from("mpf_funds")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  const expected = expectedCount || 25;

  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from("mpf_prices")
    .select("date, fund_id")
    .gte("date", since.toISOString().split("T")[0]);

  const dateCounts = new Map<string, Set<string>>();
  for (const row of data || []) {
    if (!dateCounts.has(row.date)) dateCounts.set(row.date, new Set());
    dateCounts.get(row.date)!.add(row.fund_id);
  }

  const result: DayCoverage[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    result.push({
      date: dateStr,
      fundCount: dateCounts.get(dateStr)?.size || 0,
      expectedCount: expected,
      isWeekend,
    });
  }

  return result;
}

export async function getOutliers(supabase: SupabaseClient): Promise<OutlierFund[]> {
  const today = new Date().toISOString().split("T")[0];

  const { data } = await supabase
    .from("mpf_prices")
    .select("fund_id, daily_change_pct, date, mpf_funds!inner(fund_code, name_en)")
    .eq("date", today)
    .not("daily_change_pct", "is", null);

  return (data || [])
    .filter((p) => Math.abs(p.daily_change_pct || 0) > 3)
    .map((p) => ({
      fund_code: (p as any).mpf_funds.fund_code,
      name_en: (p as any).mpf_funds.name_en,
      daily_change_pct: p.daily_change_pct!,
      date: p.date,
    }))
    .sort((a, b) => Math.abs(b.daily_change_pct) - Math.abs(a.daily_change_pct));
}

export async function getNewsPipeline(
  supabase: SupabaseClient,
  days: number = 7
): Promise<NewsPipelineDay[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from("mpf_news")
    .select("published_at, sentiment, category")
    .gte("published_at", since.toISOString());

  const dateStats = new Map<string, { total: number; classified: number }>();
  for (const row of data || []) {
    const dateStr = new Date(row.published_at).toISOString().split("T")[0];
    if (!dateStats.has(dateStr)) dateStats.set(dateStr, { total: 0, classified: 0 });
    const stat = dateStats.get(dateStr)!;
    stat.total++;
    if (row.sentiment && row.category) stat.classified++;
  }

  return Array.from(dateStats.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getConsecutiveFailures(
  supabase: SupabaseClient,
  scraperName: string
): Promise<number> {
  const { data } = await supabase
    .from("scraper_runs")
    .select("status")
    .eq("scraper_name", scraperName)
    .order("run_at", { ascending: false })
    .limit(10);

  let count = 0;
  for (const run of data || []) {
    if (run.status === "failed") count++;
    else break;
  }
  return count;
}
