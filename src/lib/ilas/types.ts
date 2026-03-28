// src/lib/ilas/types.ts — ILAS Track domain types

export type IlasFundCategory =
  | 'equity_asia_pacific'
  | 'equity_china_hk'
  | 'equity_emerging_markets'
  | 'equity_europe'
  | 'equity_global'
  | 'equity_sector'
  | 'equity_us'
  | 'fixed_income_asia_pacific'
  | 'fixed_income_china_hk'
  | 'fixed_income_emerging_markets'
  | 'fixed_income_global'
  | 'fixed_income_us'
  | 'liquidity_money_market'
  | 'multi_assets_asia_pacific'
  | 'multi_assets_global'
  | 'multi_assets_us';

export type IlasRiskLevel = 'Low' | 'Medium' | 'High';

export interface IlasFund {
  id: string;
  fund_code: string;
  aia_fund_code: string;
  name_en: string;
  name_zh: string | null;
  category: IlasFundCategory;
  risk_rating: IlasRiskLevel;
  currency: string;
  settlement_days: number;
  fund_house: string;
  fund_size: string | null;
  is_distribution: boolean;
  is_active: boolean;
  launch_date: string | null;
  created_at: string;
}

export interface IlasPrice {
  id: string;
  fund_id: string;
  date: string;
  nav: number;
  daily_change_pct: number | null;
  source: string;
  created_at: string;
}

export interface IlasFundReturns {
  id: string;
  fund_id: string;
  as_at_date: string;
  return_1m: number | null;
  return_3m: number | null;
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  return_10y: number | null;
  return_ytd: number | null;
  return_since_launch: number | null;
  calendar_year_returns: Record<string, number | null> | null;
  source: string;
  created_at: string;
}

export interface IlasFundMetrics {
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

export type IlasInsightType = 'weekly' | 'alert' | 'on_demand' | 'rebalance_debate';
export type IlasInsightStatus = 'pending' | 'generating' | 'completed' | 'failed';

export interface IlasInsight {
  id: string;
  type: IlasInsightType;
  trigger: string;
  content_en: string | null;
  content_zh: string | null;
  fund_categories: IlasFundCategory[];
  status: IlasInsightStatus;
  model: string;
  created_at: string;
}

export type IlasOrderStatus = 'pending' | 'executed' | 'cancelled';

export interface IlasPortfolioOrder {
  id: string;
  submitted_at: string;
  decision_date: string;
  execution_date: string | null;
  status: IlasOrderStatus;
  old_allocation: FundAllocation[];
  new_allocation: FundAllocation[];
  insight_id: string | null;
  created_at: string;
}

export interface IlasDividend {
  id: string;
  fund_id: string;
  ex_date: string;
  pay_date: string;
  amount_per_unit: number;
  currency: string;
  source: string;
  created_at: string;
}

export type ReasoningQuality = 'sound' | 'lucky' | 'wrong' | 'inconclusive';
export type ScorePeriod = '7d' | '30d' | '90d';

export interface IlasRebalanceScore {
  id: string;
  insight_id: string;
  score_period: ScorePeriod;
  claims: { claim: string; outcome: 'correct' | 'incorrect' | 'inconclusive'; evidence: string }[];
  win_rate: number | null;
  reasoning_quality: ReasoningQuality;
  lessons: string[];
  actual_return_pct: number | null;
  baseline_return_pct: number | null;
  scored_at: string;
}

// View model — fund with latest price data
export interface IlasFundWithLatestPrice extends IlasFund {
  latest_nav: number | null;
  daily_change_pct: number | null;
  price_date: string | null;
}

export type MetricPeriod = '1y' | '3y' | '5y' | 'since_launch';

export interface FundAllocation {
  code: string;
  weight: number;
}
