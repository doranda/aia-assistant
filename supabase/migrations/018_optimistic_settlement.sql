-- 018_optimistic_settlement.sql
-- Optimistic settlement architecture:
--   pending → executed (price locked, awaiting NAV reconciliation)
--             → settled (reconciled, final)
--             → cancelled
-- Agent signals and state_transitions audit tables added.
-- Legacy escape hatch: rows created before 2026-04-10 HKT may go pending→settled directly.

-- ===========================================================================
-- SECTION 1: Add 'executed' and 'cancelled' to status CHECK constraints
-- ===========================================================================

-- MPF: currently ('awaiting_approval', 'pending', 'settled', 'expired')
-- New: add 'executed' and 'cancelled'
ALTER TABLE mpf_pending_switches DROP CONSTRAINT IF EXISTS mpf_pending_switches_status_check;
ALTER TABLE mpf_pending_switches ADD CONSTRAINT mpf_pending_switches_status_check
  CHECK (status IN ('awaiting_approval', 'pending', 'executed', 'settled', 'cancelled', 'expired'));

-- ILAS: currently ('awaiting_approval', 'pending', 'executed', 'cancelled', 'expired')
-- New: add 'settled'
ALTER TABLE ilas_portfolio_orders DROP CONSTRAINT IF EXISTS ilas_portfolio_orders_status_check;
ALTER TABLE ilas_portfolio_orders ADD CONSTRAINT ilas_portfolio_orders_status_check
  CHECK (status IN ('awaiting_approval', 'pending', 'executed', 'settled', 'cancelled', 'expired'));


-- ===========================================================================
-- SECTION 2: New timestamp columns
-- ===========================================================================

ALTER TABLE mpf_pending_switches
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

ALTER TABLE ilas_portfolio_orders
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

-- Partial indexes for the reconciliation cron: find executed-but-not-yet-reconciled rows fast
CREATE INDEX IF NOT EXISTS idx_mpf_switches_executed_unreconciled
  ON mpf_pending_switches (executed_at)
  WHERE status = 'executed' AND reconciled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ilas_orders_executed_unreconciled
  ON ilas_portfolio_orders (executed_at)
  WHERE status = 'executed' AND reconciled_at IS NULL;


-- ===========================================================================
-- SECTION 3: Replace state transition triggers with unified function
-- ===========================================================================

-- Drop the old per-table trigger functions and triggers first
DROP TRIGGER IF EXISTS trg_switch_transition ON mpf_pending_switches;
DROP TRIGGER IF EXISTS enforce_mpf_status_transition ON mpf_pending_switches;
DROP FUNCTION IF EXISTS enforce_switch_transition();

DROP TRIGGER IF EXISTS trg_ilas_switch_transition ON ilas_portfolio_orders;
DROP TRIGGER IF EXISTS enforce_ilas_status_transition ON ilas_portfolio_orders;
DROP FUNCTION IF EXISTS enforce_ilas_switch_transition();

-- New unified transition function shared by both tables
CREATE OR REPLACE FUNCTION enforce_status_transition() RETURNS trigger AS $$
BEGIN
  -- Same-status updates are safe (idempotent retry logic)
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF NOT (
    -- Standard 3-tier state machine
    (OLD.status = 'awaiting_approval' AND NEW.status IN ('pending', 'expired', 'cancelled')) OR
    (OLD.status = 'pending'           AND NEW.status IN ('executed', 'cancelled'))        OR
    (OLD.status = 'executed'          AND NEW.status IN ('settled', 'cancelled'))         OR
    -- LEGACY escape hatch: rows created before 2026-04-10 HKT (i.e. before the optimistic
    -- settlement system went live) may go pending→settled directly.
    -- Explicit +08 offset is INTENTIONAL — bare '2026-04-10'::timestamptz would be UTC midnight,
    -- which is 08:00 HKT and would incorrectly block early-morning HKT rows.
    (OLD.status = 'pending' AND NEW.status = 'settled'
      AND OLD.created_at < '2026-04-10 00:00:00+08'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'Illegal status transition: % -> % on row %', OLD.status, NEW.status, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Wire the trigger onto both tables
DROP TRIGGER IF EXISTS enforce_mpf_status_transition ON mpf_pending_switches;
CREATE TRIGGER enforce_mpf_status_transition
  BEFORE UPDATE ON mpf_pending_switches
  FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();

DROP TRIGGER IF EXISTS enforce_ilas_status_transition ON ilas_portfolio_orders;
CREATE TRIGGER enforce_ilas_status_transition
  BEFORE UPDATE ON ilas_portfolio_orders
  FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();


-- ===========================================================================
-- SECTION 4: agent_signals table
-- ===========================================================================

CREATE TABLE IF NOT EXISTS agent_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_type    TEXT NOT NULL CHECK (product_type IN ('mpf', 'ilas')),
  mpf_switch_id   UUID REFERENCES mpf_pending_switches(id) ON DELETE CASCADE,
  ilas_order_id   UUID REFERENCES ilas_portfolio_orders(id) ON DELETE CASCADE,
  signal_type     TEXT NOT NULL CHECK (signal_type IN (
                    'bearish_region', 'bullish_region', 'sector_rotation',
                    'rate_change_signal', 'macro_event'
                  )),
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'promoted', 'rejected', 'expired')),
  emitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  -- A signal may be linked to at most one parent row (or none, for standalone signals)
  CONSTRAINT exactly_one_parent_or_none CHECK (
    NOT (mpf_switch_id IS NOT NULL AND ilas_order_id IS NOT NULL)
  )
);

-- Fast lookup: pending signals for a user/product, ordered chronologically
CREATE INDEX IF NOT EXISTS idx_agent_signals_pending_by_user
  ON agent_signals (user_id, product_type, emitted_at)
  WHERE status = 'pending';


-- ===========================================================================
-- SECTION 5: Cancellation expires linked agent_signals
-- ===========================================================================

CREATE OR REPLACE FUNCTION expire_signals_on_parent_cancel() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    UPDATE agent_signals
      SET status          = 'expired',
          consumed_at     = now(),
          rejection_reason = 'parent_cancelled'
      WHERE (
        (TG_TABLE_NAME = 'mpf_pending_switches' AND mpf_switch_id = NEW.id) OR
        (TG_TABLE_NAME = 'ilas_portfolio_orders' AND ilas_order_id = NEW.id)
      ) AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mpf_cancel_expires_signals ON mpf_pending_switches;
CREATE TRIGGER mpf_cancel_expires_signals
  AFTER UPDATE OF status ON mpf_pending_switches
  FOR EACH ROW EXECUTE FUNCTION expire_signals_on_parent_cancel();

DROP TRIGGER IF EXISTS ilas_cancel_expires_signals ON ilas_portfolio_orders;
CREATE TRIGGER ilas_cancel_expires_signals
  AFTER UPDATE OF status ON ilas_portfolio_orders
  FOR EACH ROW EXECUTE FUNCTION expire_signals_on_parent_cancel();


-- ===========================================================================
-- SECTION 6: state_transitions audit table
-- ===========================================================================

CREATE TABLE IF NOT EXISTS state_transitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  TEXT NOT NULL CHECK (table_name IN ('mpf_pending_switches', 'ilas_portfolio_orders')),
  row_id      UUID NOT NULL,
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  payload     JSONB,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deduplicate: one audit row per (table, row, transition) per calendar day in HKT
CREATE UNIQUE INDEX IF NOT EXISTS idx_state_transitions_dedupe
  ON state_transitions (table_name, row_id, from_status, to_status,
    ((at AT TIME ZONE 'Asia/Hong_Kong')::date));

-- Fast lookup for a row's full transition history, newest first
CREATE INDEX IF NOT EXISTS idx_state_transitions_row
  ON state_transitions (table_name, row_id, at DESC);


-- ===========================================================================
-- SECTION 7: Row-level security
-- ===========================================================================

ALTER TABLE agent_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_full_access_agent_signals" ON agent_signals;
CREATE POLICY "service_role_full_access_agent_signals"
  ON agent_signals FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON agent_signals TO authenticated, service_role;
GRANT SELECT ON agent_signals TO anon;

ALTER TABLE state_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_full_access_state_transitions" ON state_transitions;
CREATE POLICY "service_role_full_access_state_transitions"
  ON state_transitions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT ALL ON state_transitions TO authenticated, service_role;
GRANT SELECT ON state_transitions TO anon;
