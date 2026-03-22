import { createClient } from "@/lib/supabase/server";
import { FileText, MessageSquare, MessagesSquare, BookOpen } from "lucide-react";

async function getStats() {
  const supabase = await createClient();

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
    top3Movers: top3Movers as { daily_change_pct: number | null; date: string; mpf_funds: { fund_code: string; name_en: string } | null }[],
    latestInsight: latestInsight as { content_en: string; type: string; created_at: string } | null,
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      {/* Page header — editorial, typography-driven */}
      <header className="mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          Dashboard
        </h1>
        <p className="text-sm text-zinc-500 mt-2 font-mono">Knowledge Hub overview</p>
      </header>

      {/* Metrics — typography only, no bordered cards */}
      <section aria-label="Key metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10 mb-20">
        <Metric
          icon={<FileText className="w-4 h-4" />}
          label="Documents"
          value={stats.totalDocs}
          sub={`${stats.indexedDocs} indexed`}
        />
        <Metric
          icon={<MessageSquare className="w-4 h-4" />}
          label="Conversations"
          value={stats.totalConversations}
        />
        <Metric
          icon={<MessagesSquare className="w-4 h-4" />}
          label="Messages"
          value={stats.totalMessages}
        />
        <Metric
          icon={<BookOpen className="w-4 h-4" />}
          label="Saved FAQs"
          value={stats.topFAQs.length}
          sub={`${stats.topFAQs.reduce((a, f) => a + f.use_count, 0)} uses`}
        />
      </section>

      {/* Two-column content */}
      <div className="grid lg:grid-cols-2 gap-16">
        {/* Top FAQs */}
        <section aria-labelledby="top-faqs-heading">
          <div className="flex items-center justify-between mb-6">
            <h2 id="top-faqs-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
              Top FAQs
            </h2>
            <a
              href="/faqs"
              className="text-[11px] font-medium text-ruby-11 hover:text-ruby-9 transition-colors"
            >
              Manage
            </a>
          </div>
          {stats.topFAQs.length === 0 ? (
            <EmptyState message="No FAQs saved yet." action="Like a chat response to create one." />
          ) : (
            <ol className="space-y-0 divide-y divide-zinc-800/60">
              {stats.topFAQs.map((faq) => (
                <li key={faq.id} className="flex items-start justify-between gap-6 py-4 first:pt-0">
                  <span className="text-[14px] text-zinc-300 leading-relaxed">{faq.question}</span>
                  <span className="text-[11px] font-mono text-emerald-400 whitespace-nowrap tabular-nums">
                    {faq.use_count}×
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Popular queries */}
        <section aria-labelledby="popular-queries-heading">
          <h2 id="popular-queries-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 mb-6">
            Most Asked
          </h2>
          {stats.popularQueries.length === 0 ? (
            <EmptyState message="No queries tracked yet." action="Start chatting to see trends." />
          ) : (
            <ol className="space-y-0 divide-y divide-zinc-800/60">
              {stats.popularQueries.map((q, i) => (
                <li key={i} className="flex items-start justify-between gap-6 py-4 first:pt-0">
                  <span className="text-[14px] text-zinc-300 leading-relaxed">{q.query_text}</span>
                  <span className="text-[11px] font-mono text-zinc-600 whitespace-nowrap tabular-nums">
                    {q.count}×
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* MPF Care Summary */}
      <section aria-labelledby="mpf-summary-heading" className="mt-20">
        <div className="flex items-center justify-between mb-6">
          <h2 id="mpf-summary-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            MPF Care
          </h2>
          <a href="/mpf-care" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
            View all
          </a>
        </div>
        {stats.top3Movers.length > 0 ? (
          <div className="space-y-0 divide-y divide-zinc-800/60 mb-6">
            {stats.top3Movers.map((m, i) => {
              const fund = m.mpf_funds;
              const pct = m.daily_change_pct || 0;
              return (
                <div key={i} className="flex items-center justify-between py-3 first:pt-0">
                  <div>
                    <span className="text-[13px] text-zinc-300">{fund?.name_en}</span>
                    <span className="text-[11px] text-zinc-600 ml-2 font-mono">{fund?.fund_code}</span>
                  </div>
                  <span className={`text-[13px] font-mono font-semibold tabular-nums ${pct > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 mb-6">No fund data yet.</p>
        )}
        {stats.latestInsight?.content_en && (
          <p className="text-[12px] text-zinc-500 leading-relaxed line-clamp-3">
            {stats.latestInsight.content_en.slice(0, 200)}…
          </p>
        )}
      </section>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-zinc-600">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
          {label}
        </span>
      </div>
      <div className="text-[clamp(2rem,3vw,2.75rem)] font-semibold tracking-[-0.04em] text-zinc-50 leading-none tabular-nums font-mono">
        {value.toLocaleString()}
      </div>
      {sub && (
        <div className="text-[12px] text-zinc-600 mt-1.5 font-mono">{sub}</div>
      )}
    </div>
  );
}

function EmptyState({ message, action }: { message: string; action: string }) {
  return (
    <div className="py-8">
      <p className="text-sm text-zinc-500">{message}</p>
      <p className="text-sm text-zinc-600 mt-1">{action}</p>
    </div>
  );
}
