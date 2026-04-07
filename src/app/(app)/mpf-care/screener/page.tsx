// src/app/(app)/mpf-care/screener/page.tsx
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SCREENER_CATEGORIES,
  FUND_EXPENSE_RATIOS,
} from "@/lib/mpf/constants";
import type { FundCategory, MetricPeriod } from "@/lib/mpf/types";
import { ScreenerView } from "./screener-view";

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

/* ------------------------------------------------------------------ */
/*  Data fetching                                                      */
/* ------------------------------------------------------------------ */

interface ScreenerRow {
  fund_code: string;
  name_en: string;
  name_zh: string | null;
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
    .select("id, fund_code, name_en, name_zh, category, risk_rating")
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
      name_zh: fund.name_zh ?? null,
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

  return (
    <ScreenerView
      rows={rows}
      period={period}
      categoryFilter={categoryFilter}
      sort={sort}
      ascending={ascending}
    />
  );
}
