import { createClient } from "@/lib/supabase/server";
import { FileText, MessageSquare, MessagesSquare, BookOpen } from "lucide-react";

async function getStats() {
  const supabase = await createClient();

  const [docs, conversations, messages, faqs, popularQueries] = await Promise.all([
    supabase.from("documents").select("id, status, created_at", { count: "exact" }).eq("is_deleted", false),
    supabase.from("conversations").select("id", { count: "exact" }),
    supabase.from("messages").select("id", { count: "exact" }),
    supabase.from("faqs").select("id, question, use_count").order("use_count", { ascending: false }).limit(5),
    supabase.from("popular_queries").select("query_text, count").order("count", { ascending: false }).limit(8),
  ]);

  const indexedDocs = docs.data?.filter((d) => d.status === "indexed").length || 0;

  return {
    totalDocs: docs.count || 0,
    indexedDocs,
    totalConversations: conversations.count || 0,
    totalMessages: messages.count || 0,
    topFAQs: (faqs.data || []) as { id: string; question: string; use_count: number }[],
    popularQueries: (popularQueries.data || []) as { query_text: string; count: number }[],
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
