-- 009_fix_table_grants.sql
-- Fix missing GRANT statements for tables created in migrations 007 and 008.
-- Supabase RLS requires GRANT + POLICY to work. Without GRANT, even service_role is denied.

-- Migration 007 tables
GRANT ALL ON mpf_pending_switches TO authenticated, service_role;
GRANT ALL ON mpf_portfolio_transactions TO authenticated, service_role;
GRANT ALL ON mpf_portfolio_nav TO authenticated, service_role;
GRANT ALL ON mpf_hk_holidays TO authenticated, service_role;

-- Migration 008 tables
GRANT ALL ON mpf_fund_metrics TO authenticated, service_role;
GRANT ALL ON mpf_backtest_runs TO authenticated, service_role;
GRANT ALL ON mpf_backtest_results TO authenticated, service_role;
GRANT ALL ON mpf_rebalance_scores TO authenticated, service_role;

-- Also grant to anon for read-only access (matches Supabase convention)
GRANT SELECT ON mpf_pending_switches TO anon;
GRANT SELECT ON mpf_portfolio_transactions TO anon;
GRANT SELECT ON mpf_portfolio_nav TO anon;
GRANT SELECT ON mpf_hk_holidays TO anon;
GRANT SELECT ON mpf_fund_metrics TO anon;
GRANT SELECT ON mpf_backtest_runs TO anon;
GRANT SELECT ON mpf_backtest_results TO anon;
GRANT SELECT ON mpf_rebalance_scores TO anon;
