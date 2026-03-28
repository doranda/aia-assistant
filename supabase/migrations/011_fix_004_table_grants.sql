-- 011_fix_004_table_grants.sql
-- Fix missing GRANT statements for original migration 004 tables.
-- Same issue as migration 009 — RLS enabled but no GRANT = silent permission denied.

-- Migration 004 tables (mpf_care.sql)
GRANT ALL ON mpf_funds TO authenticated, service_role;
GRANT ALL ON mpf_prices TO authenticated, service_role;
GRANT ALL ON mpf_news TO authenticated, service_role;
GRANT ALL ON mpf_fund_news TO authenticated, service_role;
GRANT ALL ON mpf_insights TO authenticated, service_role;
GRANT ALL ON scraper_runs TO authenticated, service_role;
GRANT ALL ON mpf_backfill_progress TO authenticated, service_role;
GRANT ALL ON mpf_reference_portfolio TO authenticated, service_role;

-- Migration 005 tables (mpf_fund_returns.sql)
GRANT ALL ON mpf_fund_returns TO authenticated, service_role;
GRANT ALL ON mpf_rebalance_history TO authenticated, service_role;

-- Anon read access
GRANT SELECT ON mpf_funds TO anon;
GRANT SELECT ON mpf_prices TO anon;
GRANT SELECT ON mpf_news TO anon;
GRANT SELECT ON mpf_fund_news TO anon;
GRANT SELECT ON mpf_insights TO anon;
GRANT SELECT ON scraper_runs TO anon;
GRANT SELECT ON mpf_reference_portfolio TO anon;
GRANT SELECT ON mpf_fund_returns TO anon;
GRANT SELECT ON mpf_rebalance_history TO anon;
