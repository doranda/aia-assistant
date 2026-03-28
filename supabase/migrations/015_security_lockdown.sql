-- 015: Security lockdown — revoke anon WRITE + replace admin_all policies
-- Applied: 2026-03-28

-- Revoke unnecessary anon WRITE grants on 16 tables
REVOKE INSERT, UPDATE, DELETE ON chunks, conversations, delete_requests, documents, faqs, messages, mpf_backfill_progress, mpf_fund_news, mpf_funds, mpf_insights, mpf_news, mpf_prices, mpf_reference_portfolio, popular_queries, profiles, scraper_runs FROM anon;

-- Drop admin_all policies on 3 tables (any authenticated user can currently write anything)
DROP POLICY IF EXISTS "admin_all" ON mpf_backtest_results;
DROP POLICY IF EXISTS "admin_all" ON mpf_backtest_runs;
DROP POLICY IF EXISTS "admin_all" ON mpf_rebalance_scores;

-- Replace with proper service-role-only write policies
CREATE POLICY "Service role write backtest_results" ON mpf_backtest_results FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role write backtest_runs" ON mpf_backtest_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role write rebalance_scores" ON mpf_rebalance_scores FOR ALL TO service_role USING (true) WITH CHECK (true);
