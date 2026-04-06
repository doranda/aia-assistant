import { createAdminClient } from "@/lib/supabase/admin";
import { DashboardView } from "./dashboard-view";

async function getStats() {
  const supabase = createAdminClient();

  const [docs, conversations, messages, faqs, popularQueries, mpfTopMovers, mpfLatestInsight] = await Promise.all([
    supabase.from("documents").select("id, status, created_at", { count: "exact" }).eq("is_deleted", false),
    supabase.from("conversations").select("id", { count: "exact" }),
    supabase.from("messages").select("id", { count: "exact" }),
    supabase.from("faqs").select("id, question, use_count").order("use_count", { ascending: false }).limit(5),
    supabase.from("popular_queries").select("query_text, count").order("count", { ascending: false }).limit(8),
    supabase
      .from("mpf_prices")
      .select("daily_change_pct, date, mpf_funds(fund_code, name_en)")
      .not("daily_change_pct", "is", null)
      .order("date", { ascending: false })
      .limit(100),
    supabase
      .from("mpf_insights")
      .select("content_en, type, created_at")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  if (docs.error) console.error("[dashboard] docs query error:", docs.error);
  if (conversations.error) console.error("[dashboard] conversations query error:", conversations.error);
  if (messages.error) console.error("[dashboard] messages query error:", messages.error);
  if (faqs.error) console.error("[dashboard] faqs query error:", faqs.error);
  if (popularQueries.error) console.error("[dashboard] popularQueries query error:", popularQueries.error);
  if (mpfTopMovers.error) console.error("[dashboard] mpfTopMovers query error:", mpfTopMovers.error);
  if (mpfLatestInsight.error && mpfLatestInsight.error.code !== "PGRST116") console.error("[dashboard] mpfLatestInsight query error:", mpfLatestInsight.error);

  const indexedDocs = docs.data?.filter((d) => d.status === "indexed").length || 0;

  // Deduplicate movers: keep latest per fund, sort by absolute change, take top 3
  const moversRaw = mpfTopMovers.data || [];
  const seenFunds = new Set<string>();
  const uniqueMovers = moversRaw.filter((m) => {
    const code = (m.mpf_funds as any)?.fund_code;
    if (!code || seenFunds.has(code)) return false;
    seenFunds.add(code);
    return true;
  });
  const top3Movers = uniqueMovers
    .sort((a, b) => Math.abs(b.daily_change_pct || 0) - Math.abs(a.daily_change_pct || 0))
    .slice(0, 3);
  const latestInsight = mpfLatestInsight.data;

  return {
    totalDocs: docs.count || 0,
    indexedDocs,
    totalConversations: conversations.count || 0,
    totalMessages: messages.count || 0,
    topFAQs: (faqs.data || []) as { id: string; question: string; use_count: number }[],
    popularQueries: (popularQueries.data || []) as { query_text: string; count: number }[],
    top3Movers: top3Movers as unknown as { daily_change_pct: number | null; date: string; mpf_funds: { fund_code: string; name_en: string } | null }[],
    latestInsight: latestInsight as { content_en: string; type: string; created_at: string } | null,
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  return <DashboardView {...stats} />;
}
