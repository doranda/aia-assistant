-- 013_ilas_portfolio_type.sql
-- Add portfolio_type column to ilas_reference_portfolio
-- Supports dual reference portfolios: one for accumulation, one for distribution

ALTER TABLE ilas_reference_portfolio
ADD COLUMN IF NOT EXISTS portfolio_type TEXT NOT NULL DEFAULT 'accumulation'
CHECK (portfolio_type IN ('accumulation', 'distribution'));

-- Index for efficient lookups by type
CREATE INDEX IF NOT EXISTS idx_ilas_ref_portfolio_type
ON ilas_reference_portfolio(portfolio_type);
