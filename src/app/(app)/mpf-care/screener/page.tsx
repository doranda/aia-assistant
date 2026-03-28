// src/app/(app)/mpf-care/screener/page.tsx
import { createAdminClient } from "@/lib/supabase/admin";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import {
  SCREENER_CATEGORIES,
  FUND_CATEGORY_LABELS,
  FUND_EXPENSE_RATIOS,
} from "@/lib/mpf/constants";
import type { FundCategory, MetricPeriod } from "@/lib/mpf/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { BarChart3 } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatMetric(
  val: number | null | undefined,
  decimals = 2,
  suffix = ""
): string {
  if (val == null) return "\u2014";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)}${suffix}`;
}

function metricColor(
  val: number | null | undefined,
  invertForDrawdown = false
): string {
  if (val == null) return "text-zinc-500";
  const v = invertForDrawdown ? -val : val;
  if (v > 0.3) return "text-emerald-400";
  if (v > 0) return "text-emerald-400/70";
  if (v > -0.3) return "text-red-400/70";
  return "text-red-400";
}

function riskLabel(rating: number): { text: string; color: string } {
  if (rating <= 1) return { text: "Low", color: "text-emerald-400" };
  if (rating <= 2) return { text: "Low-Med", color: "text-emerald-400/70" };
  if (rating <= 3) return { text: "Med", color: "text-amber-400" };
  if (rating <= 4) return { text: "Med-High", color: "text-amber-400/70" };
  return { text: "High", color: "text-red-400" };
}

/* ------------------------------------------------------------------ */
/*  Valid params                                                       */
/* ------------------------------------------------------------------ */

const VALID_PERIODS: MetricPeriod[] = ["1y", "3y", "5y", "since_launch"];
const VALID_SORTS = [
  "sortino_ratio",
  "max_drawdown_pct",
  "annualized_return_pct",
  "momentum_score",
  "expense_ratio_pct",
] as const;
type SortKey = (typeof VALID_SORTS)[number];

const COLUMN_HEADERS: Record<SortKey | "fund" | "category" | "risk", string> = {
  fund: "Fund",
  category: "Category",
  expense_ratio_pct: "FER%",
  sortino_ratio: "Sortino",
  max_drawdown_pct: "Max DD",
  annualized_return_pct: "CAGR",
  momentum_score: "Mom 3M",
  risk: "Risk",
};

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */

interface ScreenerRow {
  fund_code: string;
  name_en: string;
  category: FundCategory;
  risk_rating: number;
  sortino_ratio: number | null;
  max_drawdown_pct: number | null;
  annualized_return_pct: number | null;
  momentum_score: number | null;
  expense_ratio_pct: number | null;
}

async function getScreenerData(
  period: MetricPeriod,
  categoryFilter: keyof typeof SCREENER_CATEGORIES
): Promise<ScreenerRow[]> {
  const supabase = createAdminClient();

  const { data: metrics, error: metricsErr } = await supabase
    .from("mpf_fund_metrics")
    .select(
      "fund_id, period, sortino_ratio, max_drawdown_pct, annualized_return_pct, momentum_score, expense_ratio_pct"
    )
    .eq("period", period);

  if (metricsErr) console.error("[screener] metrics query error:", metricsErr);

  const { data: funds, error: fundsErr } = await supabase
    .from("mpf_funds")
    .select("id, fund_code, name_en, category, risk_rating")
    .eq("is_active", true);

  if (fundsErr) console.error("[screener] funds query error:", fundsErr);

  if (!metrics || !funds) return [];

  const fundMap = new Map(funds.map((f) => [f.id, f]));

  const allowedCategories = SCREENER_CATEGORIES[categoryFilter];

  const rows: ScreenerRow[] = [];
  for (const m of metrics) {
    const fund = fundMap.get(m.fund_id);
    if (!fund) continue;
    if (
      allowedCategories &&
      !allowedCategories.includes(fund.category as FundCategory)
    )
      continue;

    rows.push({
      fund_code: fund.fund_code,
      name_en: fund.name_en,
      category: fund.category as FundCategory,
      risk_rating: fund.risk_rating,
      sortino_ratio: m.sortino_ratio,
      max_drawdown_pct: m.max_drawdown_pct,
      annualized_return_pct: m.annualized_return_pct,
      momentum_score: m.momentum_score,
      expense_ratio_pct:
        m.expense_ratio_pct ??
        FUND_EXPENSE_RATIOS[fund.fund_code] ??
        null,
    });
  }

  return rows;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function ScreenerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  const categoryFilter = (
    Object.keys(SCREENER_CATEGORIES).includes(params.category as string)
      ? params.category
      : "All"
  ) as keyof typeof SCREENER_CATEGORIES;

  const sort: SortKey = VALID_SORTS.includes(params.sort as SortKey)
    ? (params.sort as SortKey)
    : "sortino_ratio";

  const period: MetricPeriod = VALID_PERIODS.includes(
    params.period as MetricPeriod
  )
    ? (params.period as MetricPeriod)
    : "3y";

  const rows = await getScreenerData(period, categoryFilter);

  // Sort rows — descending by default, ascending for drawdown & FER
  const ascending = sort === "max_drawdown_pct" || sort === "expense_ratio_pct";
  rows.sort((a, b) => {
    const aVal = a[sort] ?? (ascending ? Infinity : -Infinity);
    const bVal = b[sort] ?? (ascending ? Infinity : -Infinity);
    return ascending ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  /* ---- Build URL helpers ---- */
  function buildUrl(overrides: Record<string, string>): string {
    const p = new URLSearchParams();
    p.set("category", categoryFilter);
    p.set("sort", sort);
    p.set("period", period);
    for (const [k, v] of Object.entries(overrides)) p.set(k, v);
    return `/mpf-care/screener?${p.toString()}`;
  }

  const periodLabels: Record<string, string> = {
    "1y": "1Y",
    "3y": "3Y",
    "5y": "5Y",
    since_launch: "All",
  };

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-3">
          <BarChart3 className="w-5 h-5 text-zinc-400" />
          <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
            Fund Screener
          </h1>
        </div>
        <p className="text-sm text-zinc-300 font-mono">
          Sort &amp; filter AIA MPF funds by risk-adjusted metrics
        </p>
      </header>

      <DisclaimerBanner />

      {/* Controls: Period toggle + Category filter */}
      <div className="mt-8 flex flex-wrap items-center gap-6">
        {/* Period toggle */}
        <div className="flex items-center gap-1 bg-zinc-900/50 rounded-md p-0.5">
          {VALID_PERIODS.map((p) => (
            <a
              key={p}
              href={buildUrl({ period: p })}
              className={cn(
                "px-3 py-1 text-[12px] font-mono font-medium rounded transition-colors",
                p === period
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {periodLabels[p]}
            </a>
          ))}
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1">
          {Object.keys(SCREENER_CATEGORIES).map((cat) => (
            <a
              key={cat}
              href={buildUrl({ category: cat })}
              className={cn(
                "px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors",
                cat === categoryFilter
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {cat}
            </a>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-zinc-800/60">
              {(
                [
                  "fund",
                  "category",
                  "expense_ratio_pct",
                  "sortino_ratio",
                  "max_drawdown_pct",
                  "annualized_return_pct",
                  "momentum_score",
                  "risk",
                ] as const
              ).map((col) => {
                const isSortable = VALID_SORTS.includes(col as SortKey);
                const isActive = col === sort;
                return (
                  <th
                    key={col}
                    className={cn(
                      "text-[11px] font-semibold uppercase tracking-[0.1em] text-left py-3 pr-4 whitespace-nowrap",
                      isActive ? "text-zinc-100" : "text-zinc-400"
                    )}
                  >
                    {isSortable ? (
                      <a
                        href={buildUrl({ sort: col })}
                        className="hover:text-zinc-200 transition-colors"
                      >
                        {COLUMN_HEADERS[col]}
                        {isActive && (
                          <span className="ml-1 text-[10px]">
                            {ascending ? "\u25B2" : "\u25BC"}
                          </span>
                        )}
                      </a>
                    ) : (
                      COLUMN_HEADERS[col]
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/40">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="py-12 text-center text-sm text-zinc-400 font-mono"
                >
                  No metrics computed yet. Run the metrics cron first.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const risk = riskLabel(row.risk_rating);
                return (
                  <tr
                    key={row.fund_code}
                    className="group hover:bg-zinc-800/30 transition-colors"
                  >
                    {/* Fund */}
                    <td className="py-2.5 pr-4">
                      <Link
                        href={`/mpf-care/funds/${row.fund_code}`}
                        className="text-[13px] font-medium text-zinc-200 hover:text-zinc-50 transition-colors"
                      >
                        <span className="font-mono text-[11px] text-zinc-400 mr-2">
                          {row.fund_code}
                        </span>
                        <span className="hidden sm:inline">
                          {row.name_en}
                        </span>
                      </Link>
                    </td>

                    {/* Category */}
                    <td className="py-2.5 pr-4 text-[11px] font-mono text-zinc-400 whitespace-nowrap">
                      {FUND_CATEGORY_LABELS[row.category]?.split(" ")[0] ??
                        row.category}
                    </td>

                    {/* FER% */}
                    <td className="py-2.5 pr-4 font-mono text-[12px] text-zinc-300">
                      {row.expense_ratio_pct != null
                        ? row.expense_ratio_pct.toFixed(2)
                        : "\u2014"}
                    </td>

                    {/* Sortino */}
                    <td
                      className={cn(
                        "py-2.5 pr-4 font-mono text-[12px]",
                        metricColor(row.sortino_ratio)
                      )}
                    >
                      {formatMetric(row.sortino_ratio)}
                    </td>

                    {/* Max DD */}
                    <td
                      className={cn(
                        "py-2.5 pr-4 font-mono text-[12px]",
                        metricColor(row.max_drawdown_pct, true)
                      )}
                    >
                      {formatMetric(row.max_drawdown_pct, 1, "%")}
                    </td>

                    {/* CAGR */}
                    <td
                      className={cn(
                        "py-2.5 pr-4 font-mono text-[12px]",
                        metricColor(row.annualized_return_pct)
                      )}
                    >
                      {formatMetric(row.annualized_return_pct, 1, "%")}
                    </td>

                    {/* Momentum 3M */}
                    <td
                      className={cn(
                        "py-2.5 pr-4 font-mono text-[12px]",
                        metricColor(row.momentum_score)
                      )}
                    >
                      {formatMetric(row.momentum_score)}
                    </td>

                    {/* Risk */}
                    <td
                      className={cn(
                        "py-2.5 pr-4 text-[11px] font-medium",
                        risk.color
                      )}
                    >
                      {risk.text}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <p className="mt-8 text-[11px] text-zinc-500 font-mono">
        {rows.length} fund{rows.length !== 1 ? "s" : ""} &middot; Period:{" "}
        {periodLabels[period]} &middot; Sorted by{" "}
        {COLUMN_HEADERS[sort]}{" "}
        {ascending ? "asc" : "desc"}
      </p>
    </main>
  );
}
