// src/app/(app)/ilas-track/funds/[fund_code]/page.tsx
// ILAS Track — Individual fund detail page

import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { ILAS_CATEGORY_LABELS } from "@/lib/ilas/constants";
import type {
  IlasFund,
  IlasFundCategory,
  IlasFundMetrics,
  IlasPrice,
  MetricPeriod,
} from "@/lib/ilas/types";
import type { Metadata } from "next";
import { IlasFundChart } from "./ilas-fund-chart";
import { IlasRiskMetrics } from "./ilas-risk-metrics";

// ---------- Metadata ----------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund_code: string }>;
}): Promise<Metadata> {
  const { fund_code } = await params;
  const supabase = createAdminClient();

  const { data: fund } = await supabase
    .from("ilas_funds")
    .select("name_en, fund_code")
    .eq("fund_code", fund_code)
    .single();

  if (!fund) return { title: "Fund Not Found" };

  return {
    title: `${fund.name_en} (${fund.fund_code}) — ILAS Track`,
    description: `Live NAV, price history, and risk metrics for ${fund.name_en}.`,
  };
}

// ---------- Helpers ----------

function riskBadgeColor(level: string): string {
  switch (level) {
    case "Low":
      return "text-emerald-400 border-emerald-400/30";
    case "Medium":
      return "text-amber-400 border-amber-400/30";
    case "High":
      return "text-red-400 border-red-400/30";
    default:
      return "text-zinc-400 border-zinc-400/30";
  }
}

function changeColor(val: number | null): string {
  if (val === null) return "text-zinc-500";
  if (val > 0) return "text-emerald-400";
  if (val < 0) return "text-red-400";
  return "text-zinc-300";
}

// ---------- Page ----------

export default async function IlasFundDetailPage({
  params,
}: {
  params: Promise<{ fund_code: string }>;
}) {
  const { fund_code } = await params;
  const supabase = createAdminClient();

  // --- Fund ---
  const { data: fund, error: fundErr } = await supabase
    .from("ilas_funds")
    .select("*")
    .eq("fund_code", fund_code)
    .single();

  if (fundErr) console.error("[ilas-fund-detail] fund query error:", fundErr);
  if (!fund) notFound();

  const f = fund as IlasFund;

  // --- Prices (last 365 days for chart) ---
  const cutoffDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data: prices, error: pricesErr } = await supabase
    .from("ilas_prices")
    .select("date, nav, daily_change_pct")
    .eq("fund_id", f.id)
    .gte("date", cutoffDate)
    .order("date", { ascending: true });

  if (pricesErr) console.error("[ilas-fund-detail] prices query error:", pricesErr);

  const priceList = (prices || []) as Pick<IlasPrice, "date" | "nav" | "daily_change_pct">[];

  // --- Latest price ---
  const latest = priceList.length > 0 ? priceList[priceList.length - 1] : null;

  // --- Risk metrics ---
  const { data: allMetrics, error: metricsErr } = await supabase
    .from("ilas_fund_metrics")
    .select("*")
    .eq("fund_id", f.id);

  if (metricsErr) console.error("[ilas-fund-detail] metrics query error:", metricsErr);

  const metricsMap: Record<MetricPeriod, IlasFundMetrics | null> = {
    "1y": null,
    "3y": null,
    "5y": null,
    since_launch: null,
  };
  for (const m of (allMetrics || []) as IlasFundMetrics[]) {
    metricsMap[m.period] = m;
  }

  const hasMetrics = Object.values(metricsMap).some((m) => m !== null);

  // --- Computed returns from price data ---
  const calcReturn = (daysAgo: number) => {
    if (!latest) return null;
    const targetDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    // Find the closest price on or before the target date
    const past = [...priceList].reverse().find((p) => p.date <= targetDate);
    if (!past) return null;
    return ((latest.nav - past.nav) / past.nav) * 100;
  };

  const returns = {
    "1D": latest?.daily_change_pct ?? null,
    "1W": calcReturn(7),
    "1M": calcReturn(30),
    "3M": calcReturn(90),
    YTD: (() => {
      if (!latest) return null;
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const past = priceList.find((p) => p.date >= yearStart);
      if (!past) return null;
      return ((latest.nav - past.nav) / past.nav) * 100;
    })(),
    "1Y": calcReturn(365),
  };

  const categoryLabel =
    ILAS_CATEGORY_LABELS[f.category as IlasFundCategory] || f.category;

  return (
    <main className="max-w-[980px] mx-auto px-4 sm:px-6 py-8 lg:py-16 xl:py-24">
      {/* Back link */}
      <nav className="mb-6">
        <Link
          href="/ilas-track"
          className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 transition-colors py-2 inline-block"
        >
          ← ILAS Track
        </Link>
      </nav>

      {/* ---------- Header ---------- */}
      <header className="mb-10 lg:mb-12">
        <h1 className="text-[clamp(1.25rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.15]">
          {f.name_en}
        </h1>

        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[11px] font-mono text-zinc-300 bg-zinc-800/60 border border-zinc-700/40 rounded px-2 py-1">
            {f.fund_code}
          </span>
          <span className="text-[11px] font-mono text-zinc-300 bg-zinc-800/60 border border-zinc-700/40 rounded px-2 py-1">
            {categoryLabel}
          </span>
          <span
            className={`text-[11px] font-mono border rounded px-2 py-1 ${riskBadgeColor(f.risk_rating)}`}
          >
            {f.risk_rating} Risk
          </span>
          <span className="text-[11px] font-mono text-zinc-300 bg-zinc-800/60 border border-zinc-700/40 rounded px-2 py-1">
            {f.currency}
          </span>
          {f.is_distribution && (
            <span className="text-[11px] font-mono text-amber-400 border border-amber-400/30 rounded px-2 py-1">
              Distribution
            </span>
          )}
        </div>
      </header>

      {/* ---------- Fund Info ---------- */}
      <section
        aria-labelledby="fund-info-heading"
        className="border border-zinc-800/60 rounded-lg p-4 sm:p-6 mb-8"
      >
        <h2
          id="fund-info-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-4"
        >
          Fund Information
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Fund House
            </div>
            <div className="text-[13px] text-zinc-200 leading-snug">
              {f.fund_house}
            </div>
          </div>
          {f.fund_size && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Fund Size
              </div>
              <div className="text-[13px] font-mono text-zinc-200 tabular-nums">
                {f.fund_size}M
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
              Settlement
            </div>
            <div className="text-[13px] font-mono text-zinc-200 tabular-nums">
              T+{f.settlement_days}
            </div>
          </div>
          {f.launch_date && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Launch Date
              </div>
              <div className="text-[13px] font-mono text-zinc-200 tabular-nums">
                {f.launch_date}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- Latest Price Card ---------- */}
      {latest && (
        <section
          aria-labelledby="latest-price-heading"
          className="border border-zinc-800/60 rounded-lg p-4 sm:p-6 mb-8"
        >
          <h2
            id="latest-price-heading"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-4"
          >
            Latest Price
          </h2>
          <div className="flex flex-wrap items-baseline gap-4">
            <span className="text-[clamp(1.5rem,2.5vw,2rem)] font-semibold font-mono text-zinc-50 tabular-nums">
              {f.currency === "HKD" ? "HK$" : "$"}
              {latest.nav.toFixed(4)}
            </span>
            <span
              className={`text-lg sm:text-xl font-mono font-semibold tabular-nums ${changeColor(latest.daily_change_pct ?? null)}`}
            >
              {latest.daily_change_pct !== null && latest.daily_change_pct !== undefined
                ? `${latest.daily_change_pct > 0 ? "+" : ""}${latest.daily_change_pct.toFixed(2)}%`
                : "—"}
            </span>
            <span className="text-[12px] font-mono text-zinc-400">
              as of {latest.date}
            </span>
          </div>
        </section>
      )}

      {/* ---------- Price Chart ---------- */}
      {priceList.length > 1 && (
        <section aria-label="Price history chart" className="mb-12 lg:mb-16">
          <IlasFundChart
            prices={priceList.map((p) => ({ date: p.date, nav: p.nav }))}
          />
        </section>
      )}

      {/* ---------- Performance Returns ---------- */}
      <section aria-labelledby="returns-heading" className="mb-12 lg:mb-16">
        <h2
          id="returns-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-300 mb-4"
        >
          Performance
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
          {Object.entries(returns).map(([period, value]) => (
            <div key={period}>
              <div className="text-[11px] font-mono text-zinc-400">
                {period}
              </div>
              <div
                className={`text-[16px] font-mono font-semibold tabular-nums ${changeColor(value)}`}
              >
                {value === null
                  ? "—"
                  : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Risk Metrics ---------- */}
      {hasMetrics && (
        <div className="mb-12 lg:mb-16">
          <IlasRiskMetrics metrics={metricsMap} />
        </div>
      )}

      {/* ---------- Disclaimer ---------- */}
      <footer className="border-t border-zinc-800/60 pt-6 mt-8">
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          Data sourced from AIA ILAS fund prices. NAV and returns are indicative
          and may differ from official statements. Past performance is not
          indicative of future results. This is not investment advice.
        </p>
      </footer>
    </main>
  );
}
