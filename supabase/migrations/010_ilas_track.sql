-- 010_ilas_track.sql
-- ILAS Track — Investment-Linked Assurance Scheme fund tracking
-- 142 funds (106 accumulation + 36 distribution), 16 asset classes, 29 fund houses

-- ===== TABLE 1: Fund registry =====
CREATE TABLE IF NOT EXISTS ilas_funds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_code TEXT NOT NULL UNIQUE,
  aia_fund_code TEXT,
  name_en TEXT NOT NULL,
  name_zh TEXT,
  category TEXT NOT NULL CHECK (category IN (
    'equity_asia_pacific', 'equity_china_hk', 'equity_emerging_markets',
    'equity_europe', 'equity_global', 'equity_sector', 'equity_us',
    'fixed_income_asia_pacific', 'fixed_income_china_hk', 'fixed_income_emerging_markets',
    'fixed_income_global', 'fixed_income_us',
    'liquidity_money_market',
    'multi_assets_asia_pacific', 'multi_assets_global', 'multi_assets_us'
  )),
  risk_rating TEXT NOT NULL DEFAULT 'Medium' CHECK (risk_rating IN ('Low', 'Medium', 'High')),
  currency TEXT NOT NULL DEFAULT 'US$',
  settlement_days INT NOT NULL DEFAULT 3,
  fund_house TEXT,
  fund_size TEXT,
  is_distribution BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  launch_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_funds_category ON ilas_funds(category);
CREATE INDEX IF NOT EXISTS idx_ilas_funds_distribution ON ilas_funds(is_distribution);
CREATE INDEX IF NOT EXISTS idx_ilas_funds_active ON ilas_funds(is_active);


-- ===== TABLE 2: Daily NAV prices =====
CREATE TABLE IF NOT EXISTS ilas_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES ilas_funds(id),
  date DATE NOT NULL,
  nav DECIMAL(12,4) NOT NULL,
  daily_change_pct DECIMAL(8,4),
  source TEXT NOT NULL DEFAULT 'aia_website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(fund_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ilas_prices_fund ON ilas_prices(fund_id);
CREATE INDEX IF NOT EXISTS idx_ilas_prices_date ON ilas_prices(date DESC);


-- ===== TABLE 3: Multi-period returns from AIA =====
CREATE TABLE IF NOT EXISTS ilas_fund_returns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES ilas_funds(id),
  as_at_date DATE NOT NULL,
  return_1m DECIMAL(8,4),
  return_3m DECIMAL(8,4),
  return_1y DECIMAL(8,4),
  return_3y DECIMAL(8,4),
  return_5y DECIMAL(8,4),
  return_10y DECIMAL(8,4),
  return_ytd DECIMAL(8,4),
  return_since_launch DECIMAL(8,4),
  calendar_year_returns JSONB,
  source TEXT NOT NULL DEFAULT 'aia_website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(fund_id, as_at_date)
);

CREATE INDEX IF NOT EXISTS idx_ilas_returns_fund ON ilas_fund_returns(fund_id);


-- ===== TABLE 4: Fund-news correlation (shares mpf_news) =====
CREATE TABLE IF NOT EXISTS ilas_fund_news (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES ilas_funds(id),
  news_id UUID NOT NULL REFERENCES mpf_news(id),
  impact_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_fund_news_fund ON ilas_fund_news(fund_id);
CREATE INDEX IF NOT EXISTS idx_ilas_fund_news_news ON ilas_fund_news(news_id);


-- ===== TABLE 5: Quant metrics =====
CREATE TABLE IF NOT EXISTS ilas_fund_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES ilas_funds(id),
  fund_code TEXT NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('1y', '3y', '5y', 'since_launch')),
  sharpe_ratio DOUBLE PRECISION,
  sortino_ratio DOUBLE PRECISION,
  max_drawdown_pct DOUBLE PRECISION,
  annualized_return_pct DOUBLE PRECISION,
  annualized_volatility_pct DOUBLE PRECISION,
  expense_ratio_pct DOUBLE PRECISION,
  momentum_score DOUBLE PRECISION,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fund_id, period)
);

CREATE INDEX IF NOT EXISTS idx_ilas_metrics_fund ON ilas_fund_metrics(fund_id);
CREATE INDEX IF NOT EXISTS idx_ilas_metrics_code ON ilas_fund_metrics(fund_code);


-- ===== TABLE 6: AI insights =====
CREATE TABLE IF NOT EXISTS ilas_insights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'weekly'
    CHECK (type IN ('weekly', 'alert', 'on_demand', 'rebalance_debate')),
  trigger TEXT,
  content_en TEXT,
  content_zh TEXT,
  fund_categories TEXT[],
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_insights_status ON ilas_insights(status);


-- ===== TABLE 7: Reference portfolio =====
CREATE TABLE IF NOT EXISTS ilas_reference_portfolio (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES ilas_funds(id),
  weight INT NOT NULL CHECK (weight >= 0 AND weight <= 100),
  note TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_ref_portfolio_fund ON ilas_reference_portfolio(fund_id);


-- ===== TABLE 8: Portfolio orders (simpler than MPF switches) =====
CREATE TABLE IF NOT EXISTS ilas_portfolio_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision_date DATE NOT NULL,
  execution_date DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executed', 'cancelled')),
  old_allocation JSONB NOT NULL,
  new_allocation JSONB NOT NULL,
  insight_id UUID REFERENCES ilas_insights(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_orders_status ON ilas_portfolio_orders(status);


-- ===== TABLE 9: Daily portfolio NAV =====
CREATE TABLE IF NOT EXISTS ilas_portfolio_nav (
  date DATE PRIMARY KEY,
  nav DECIMAL(18,8) NOT NULL,
  daily_return_pct DECIMAL(8,4),
  holdings JSONB NOT NULL,
  is_cash BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_nav_date ON ilas_portfolio_nav(date DESC);


-- ===== TABLE 10: Rebalance scoring =====
CREATE TABLE IF NOT EXISTS ilas_rebalance_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  insight_id UUID REFERENCES ilas_insights(id),
  score_period TEXT NOT NULL CHECK (score_period IN ('7d', '30d', '90d')),
  claims JSONB NOT NULL,
  win_rate DOUBLE PRECISION,
  reasoning_quality TEXT NOT NULL
    CHECK (reasoning_quality IN ('sound', 'lucky', 'wrong', 'inconclusive')),
  lessons TEXT[] NOT NULL,
  actual_return_pct DOUBLE PRECISION,
  baseline_return_pct DOUBLE PRECISION,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_scores_insight ON ilas_rebalance_scores(insight_id)
  WHERE insight_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ilas_scores_scored ON ilas_rebalance_scores(scored_at DESC);


-- ===== TABLE 11: Distribution fund dividends =====
CREATE TABLE IF NOT EXISTS ilas_dividends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES ilas_funds(id),
  ex_date DATE NOT NULL,
  pay_date DATE,
  amount_per_unit DECIMAL(12,6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'US$',
  source TEXT NOT NULL DEFAULT 'aia_website',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(fund_id, ex_date)
);

CREATE INDEX IF NOT EXISTS idx_ilas_dividends_fund ON ilas_dividends(fund_id);
CREATE INDEX IF NOT EXISTS idx_ilas_dividends_date ON ilas_dividends(ex_date DESC);


-- ===== RLS =====
ALTER TABLE ilas_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_fund_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_fund_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_fund_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_reference_portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_portfolio_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_portfolio_nav ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_rebalance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilas_dividends ENABLE ROW LEVEL SECURITY;

-- ===== RLS Policies =====
DO $$ BEGIN
  CREATE POLICY "Authenticated read ilas_funds" ON ilas_funds FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_prices" ON ilas_prices FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_fund_returns" ON ilas_fund_returns FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_fund_news" ON ilas_fund_news FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_fund_metrics" ON ilas_fund_metrics FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_insights" ON ilas_insights FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_reference_portfolio" ON ilas_reference_portfolio FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_portfolio_orders" ON ilas_portfolio_orders FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_portfolio_nav" ON ilas_portfolio_nav FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_rebalance_scores" ON ilas_rebalance_scores FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Authenticated read ilas_dividends" ON ilas_dividends FOR SELECT TO authenticated USING (true);
END $$;

-- ===== GRANTs (learned from migration 009 — MUST include) =====
GRANT ALL ON ilas_funds TO authenticated, service_role;
GRANT ALL ON ilas_prices TO authenticated, service_role;
GRANT ALL ON ilas_fund_returns TO authenticated, service_role;
GRANT ALL ON ilas_fund_news TO authenticated, service_role;
GRANT ALL ON ilas_fund_metrics TO authenticated, service_role;
GRANT ALL ON ilas_insights TO authenticated, service_role;
GRANT ALL ON ilas_reference_portfolio TO authenticated, service_role;
GRANT ALL ON ilas_portfolio_orders TO authenticated, service_role;
GRANT ALL ON ilas_portfolio_nav TO authenticated, service_role;
GRANT ALL ON ilas_rebalance_scores TO authenticated, service_role;
GRANT ALL ON ilas_dividends TO authenticated, service_role;

GRANT SELECT ON ilas_funds TO anon;
GRANT SELECT ON ilas_prices TO anon;
GRANT SELECT ON ilas_fund_returns TO anon;
GRANT SELECT ON ilas_fund_news TO anon;
GRANT SELECT ON ilas_fund_metrics TO anon;
GRANT SELECT ON ilas_insights TO anon;
GRANT SELECT ON ilas_reference_portfolio TO anon;
GRANT SELECT ON ilas_portfolio_orders TO anon;
GRANT SELECT ON ilas_portfolio_nav TO anon;
GRANT SELECT ON ilas_rebalance_scores TO anon;
GRANT SELECT ON ilas_dividends TO anon;
