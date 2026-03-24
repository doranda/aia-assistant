// src/lib/mpf/types.ts — MPF Care domain types

export type FundCategory =
  | "equity"
  | "bond"
  | "mixed"
  | "guaranteed"
  | "index"
  | "dis"
  | "conservative"
  | "fidelity"
  | "dynamic";

export type NewsRegion = "global" | "asia" | "hk" | "china";
export type NewsCategory = "markets" | "geopolitical" | "policy" | "macro";
export type Sentiment = "positive" | "negative" | "neutral";
export type InsightType = "weekly" | "alert" | "on_demand" | "rebalance_debate";
export type InsightStatus = "pending" | "generating" | "completed" | "failed";
export type PriceSource = "mpfa" | "aastocks" | "manual" | "aia_api" | "brave_search";

export interface MpfFund {
  id: string;
  fund_code: string;
  name_en: string;
  name_zh: string;
  category: FundCategory;
  risk_rating: number;
  scheme: string;
  is_active: boolean;
  created_at: string;
}

export interface MpfPrice {
  id: string;
  fund_id: string;
  date: string;
  nav: number;
  daily_change_pct: number | null;
  source: PriceSource;
  created_at: string;
}

export interface MpfNews {
  id: string;
  headline: string;
  summary: string | null;
  source: string;
  url: string | null;
  published_at: string;
  region: NewsRegion;
  category: NewsCategory;
  impact_tags: string[];
  sentiment: Sentiment;
  is_high_impact: boolean;
  created_at: string;
}

export interface MpfFundNews {
  id: string;
  fund_id: string;
  news_id: string;
  impact_note: string | null;
  created_at: string;
}

export interface MpfInsight {
  id: string;
  type: InsightType;
  trigger: string;
  content_en: string | null;
  content_zh: string | null;
  fund_categories: string[];
  fund_ids: string[];
  status: InsightStatus;
  model: string;
  created_at: string;
}

export interface ScraperRun {
  id: string;
  scraper_name: string;
  run_at: string;
  status: "running" | "success" | "failed";
  error_message: string | null;
  records_processed: number;
  duration_ms: number | null;
  created_at: string;
}

export type MetricPeriod = "1y" | "3y" | "5y" | "since_launch";

export interface FundMetrics {
  id: string;
  fund_id: string;
  fund_code: string;
  period: MetricPeriod;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  max_drawdown_pct: number | null;
  annualized_return_pct: number | null;
  annualized_volatility_pct: number | null;
  expense_ratio_pct: number | null;
  momentum_score: number | null;
  computed_at: string;
}

// View models for UI
export interface FundWithLatestPrice extends MpfFund {
  latest_nav: number | null;
  daily_change_pct: number | null;
  price_date: string | null;
}

export interface FundPerformance {
  fund_id: string;
  fund_code: string;
  name_en: string;
  name_zh: string;
  category: FundCategory;
  risk_rating: number;
  returns: {
    "1d": number | null;
    "1w": number | null;
    "1m": number | null;
    "3m": number | null;
    "1y": number | null;
    "3y": number | null;
    "5y": number | null;
    "10y": number | null;
    "ytd": number | null;
    "since_launch": number | null;
  };
  calendar_year_returns?: Record<string, number | null>;
}

export interface NewsWithFunds extends MpfNews {
  affected_funds: { fund_code: string; name_en: string; impact_note: string | null }[];
}
