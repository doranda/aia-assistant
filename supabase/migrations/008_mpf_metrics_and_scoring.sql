-- 008_mpf_metrics_and_scoring.sql
-- Fund metrics, backtest engine, and rebalance scoring tables
-- These tables are referenced by: metrics cron, screener, rebalancer, backtester, scorer

-- ===== TABLE 1: Fund metrics (quant engine output) =====
CREATE TABLE IF NOT EXISTS mpf_fund_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fund_id UUID NOT NULL REFERENCES mpf_funds(id),
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

CREATE INDEX IF NOT EXISTS idx_metrics_fund ON mpf_fund_metrics(fund_id);
CREATE INDEX IF NOT EXISTS idx_metrics_period ON mpf_fund_metrics(period);
CREATE INDEX IF NOT EXISTS idx_metrics_fund_code ON mpf_fund_metrics(fund_code);


-- ===== TABLE 2: Backtest runs (cursor-based, one per track) =====
CREATE TABLE IF NOT EXISTS mpf_backtest_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  track TEXT NOT NULL CHECK (track IN ('quant_only', 'quant_news')),
  cursor_date DATE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'paused')),
  total_weeks_processed INT NOT NULL DEFAULT 0,
  budget_limit INT NOT NULL DEFAULT 20,
  budget_used_this_session INT NOT NULL DEFAULT 0,
  cumulative_return_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_status ON mpf_backtest_runs(status);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_track ON mpf_backtest_runs(track);


-- ===== TABLE 3: Backtest results (one per simulated week) =====
CREATE TABLE IF NOT EXISTS mpf_backtest_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES mpf_backtest_runs(id) ON DELETE CASCADE,
  sim_date DATE NOT NULL,
  allocation JSONB NOT NULL,                -- [{code, weight}]
  debate_log TEXT,
  confidence TEXT NOT NULL CHECK (confidence IN ('full', 'degraded')),
  weekly_return_pct DOUBLE PRECISION,
  cumulative_return_pct DOUBLE PRECISION,
  rebalance_triggered BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backtest_results_run ON mpf_backtest_results(run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_results_sim_date ON mpf_backtest_results(sim_date);
CREATE INDEX IF NOT EXISTS idx_backtest_results_rebalance ON mpf_backtest_results(run_id)
  WHERE rebalance_triggered = TRUE;


-- ===== TABLE 4: Rebalance scores (live + backtest) =====
CREATE TABLE IF NOT EXISTS mpf_rebalance_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  insight_id UUID REFERENCES mpf_insights(id),
  backtest_result_id UUID REFERENCES mpf_backtest_results(id),
  score_period TEXT NOT NULL CHECK (score_period IN ('7d', '30d', '90d')),
  claims JSONB NOT NULL,                    -- [{claim, outcome, evidence}]
  win_rate DOUBLE PRECISION,
  reasoning_quality TEXT NOT NULL
    CHECK (reasoning_quality IN ('sound', 'lucky', 'wrong', 'inconclusive')),
  lessons TEXT[] NOT NULL,                  -- array of lesson strings
  actual_return_pct DOUBLE PRECISION,
  baseline_return_pct DOUBLE PRECISION,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- At least one FK must be set
  CHECK (insight_id IS NOT NULL OR backtest_result_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_scores_insight ON mpf_rebalance_scores(insight_id)
  WHERE insight_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scores_backtest ON mpf_rebalance_scores(backtest_result_id)
  WHERE backtest_result_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scores_scored_at ON mpf_rebalance_scores(scored_at DESC);


-- ===== RLS =====
ALTER TABLE mpf_fund_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_rebalance_scores ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated read metrics') THEN
    CREATE POLICY "Authenticated read metrics"
      ON mpf_fund_metrics FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated read backtest runs') THEN
    CREATE POLICY "Authenticated read backtest runs"
      ON mpf_backtest_runs FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated read backtest results') THEN
    CREATE POLICY "Authenticated read backtest results"
      ON mpf_backtest_results FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated read scores') THEN
    CREATE POLICY "Authenticated read scores"
      ON mpf_rebalance_scores FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
