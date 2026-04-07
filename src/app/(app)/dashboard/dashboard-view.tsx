"use client";

import { FileText, MessageSquare, MessagesSquare, BookOpen } from "lucide-react";
import { useLanguage, getFundName } from "@/lib/i18n";

type TopFAQ = { id: string; question: string; use_count: number };
type PopularQuery = { query_text: string; count: number };
type TopMover = {
  daily_change_pct: number | null;
  date: string;
  mpf_funds: { fund_code: string; name_en: string; name_zh: string | null } | null;
};
type LatestInsight = { content_en: string; type: string; created_at: string } | null;

interface DashboardViewProps {
  totalDocs: number;
  indexedDocs: number;
  totalConversations: number;
  totalMessages: number;
  topFAQs: TopFAQ[];
  popularQueries: PopularQuery[];
  top3Movers: TopMover[];
  latestInsight: LatestInsight;
}

export function DashboardView({
  totalDocs,
  indexedDocs,
  totalConversations,
  totalMessages,
  topFAQs,
  popularQueries,
  top3Movers,
  latestInsight,
}: DashboardViewProps) {
  const { t, locale } = useLanguage();

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      {/* Page header — editorial, typography-driven */}
      <header className="mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          {t("dashboard.heading")}
        </h1>
        <p className="text-sm text-zinc-500 mt-2 font-mono">{t("dashboard.subtitle")}</p>
      </header>

      {/* Metrics — typography only, no bordered cards */}
      <section aria-label={t("dashboard.keyMetrics")} className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10 mb-20">
        <Metric
          icon={<FileText className="w-4 h-4" />}
          label={t("dashboard.documents")}
          value={totalDocs}
          sub={`${indexedDocs} indexed`}
        />
        <Metric
          icon={<MessageSquare className="w-4 h-4" />}
          label={t("dashboard.conversations")}
          value={totalConversations}
        />
        <Metric
          icon={<MessagesSquare className="w-4 h-4" />}
          label={t("dashboard.messages")}
          value={totalMessages}
        />
        <Metric
          icon={<BookOpen className="w-4 h-4" />}
          label={t("dashboard.savedFaqs")}
          value={topFAQs.length}
          sub={`${topFAQs.reduce((a, f) => a + f.use_count, 0)} uses`}
        />
      </section>

      {/* Two-column content */}
      <div className="grid lg:grid-cols-2 gap-16">
        {/* Top FAQs */}
        <section aria-labelledby="top-faqs-heading">
          <div className="flex items-center justify-between mb-6">
            <h2 id="top-faqs-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
              {t("dashboard.topFaqs")}
            </h2>
            <a
              href="/faqs"
              className="text-[11px] font-medium text-ruby-11 hover:text-ruby-9 transition-colors"
            >
              {t("dashboard.manage")}
            </a>
          </div>
          {topFAQs.length === 0 ? (
            <EmptyState message={t("dashboard.noFaqs")} action={t("dashboard.noFaqsAction")} />
          ) : (
            <ol className="space-y-0 divide-y divide-zinc-800/60">
              {topFAQs.map((faq) => (
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
            {t("dashboard.mostAsked")}
          </h2>
          {popularQueries.length === 0 ? (
            <EmptyState message={t("dashboard.noQueries")} action={t("dashboard.noQueriesAction")} />
          ) : (
            <ol className="space-y-0 divide-y divide-zinc-800/60">
              {popularQueries.map((q, i) => (
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
            {t("dashboard.mpfCare")}
          </h2>
          <a href="/mpf-care" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
            {t("dashboard.viewAll")}
          </a>
        </div>
        {top3Movers.length > 0 ? (
          <div className="space-y-0 divide-y divide-zinc-800/60 mb-6">
            {top3Movers.map((m, i) => {
              const fund = m.mpf_funds;
              const pct = m.daily_change_pct || 0;
              return (
                <div key={i} className="flex items-center justify-between py-3 first:pt-0">
                  <div>
                    <span className="text-[13px] text-zinc-300">{fund ? getFundName(fund, locale) : ""}</span>
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
          <p className="text-sm text-zinc-500 mb-6">{t("dashboard.noFundData")}</p>
        )}
        {latestInsight?.content_en && (
          <p className="text-[12px] text-zinc-500 leading-relaxed line-clamp-3">
            {latestInsight.content_en.slice(0, 200)}…
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
