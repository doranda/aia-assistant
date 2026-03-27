-- 005_mpf_fund_returns.sql
-- Multi-period fund returns from AIA API + rebalance history

-- Add 'aia_api' to the allowed source values in mpf_prices.
-- We use ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT because Postgres
-- does not support ALTER CHECK inline on an existing constraint.
ALTER TABLE mpf_prices DROP CONSTRAINT IF EXISTS mpf_prices_source_check;
ALTER TABLE mpf_prices ADD CONSTRAINT mpf_prices_source_check
  CHECK (source IN ('mpfa', 'aastocks', 'manual', 'aia_api'));

-- Multi-period fund returns from AIA API
CREATE TABLE IF NOT EXISTS mpf_fund_returns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES mpf_funds(id) ON DELETE CASCADE,
  as_at_date DATE NOT NULL,
  return_1m DECIMAL(8,4),
  return_3m DECIMAL(8,4),
  return_1y DECIMAL(8,4),
  return_3y DECIMAL(8,4),
  return_5y DECIMAL(8,4),
  return_10y DECIMAL(8,4),
  return_ytd DECIMAL(8,4),
  return_since_launch DECIMAL(8,4),
  calendar_year_returns JSONB DEFAULT '{}',
  source TEXT DEFAULT 'aia_api',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fund_id, as_at_date)
);

CREATE INDEX IF NOT EXISTS idx_mpf_fund_returns_date ON mpf_fund_returns(as_at_date DESC);
CREATE INDEX IF NOT EXISTS idx_mpf_fund_returns_fund ON mpf_fund_returns(fund_id, as_at_date DESC);

-- Rebalance history (snapshots of each portfolio change)
CREATE TABLE IF NOT EXISTS mpf_rebalance_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  rebalanced_at TIMESTAMPTZ DEFAULT NOW(),
  trigger TEXT NOT NULL,
  reason TEXT,
  portfolio JSONB NOT NULL,  -- [{fund_code, fund_id, weight, note}]
  insight_id UUID REFERENCES mpf_insights(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE mpf_fund_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_rebalance_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read fund returns"
  ON mpf_fund_returns FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read rebalance history"
  ON mpf_rebalance_history FOR SELECT TO authenticated USING (true);
