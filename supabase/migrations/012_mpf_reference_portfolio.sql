-- 012_mpf_reference_portfolio.sql
-- Creates mpf_reference_portfolio table that settle_switch() depends on.
-- This table was created via dashboard but never had a migration.

CREATE TABLE IF NOT EXISTS mpf_reference_portfolio (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES mpf_funds(id) ON DELETE CASCADE,
  weight INT NOT NULL CHECK (weight >= 0 AND weight <= 100),
  note TEXT,
  updated_by TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ref_portfolio_fund ON mpf_reference_portfolio(fund_id);

-- RLS
ALTER TABLE mpf_reference_portfolio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read reference portfolio"
  ON mpf_reference_portfolio FOR SELECT TO authenticated USING (true);

-- GRANTs (inline per audit recommendation)
GRANT SELECT ON mpf_reference_portfolio TO anon;
GRANT SELECT ON mpf_reference_portfolio TO authenticated;

-- Also fix M1: mpf_backfill_progress missing anon GRANT
GRANT SELECT ON mpf_backfill_progress TO anon;
