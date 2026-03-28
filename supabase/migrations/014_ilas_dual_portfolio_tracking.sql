-- 014_ilas_dual_portfolio_tracking.sql
-- Dual portfolio tracking for ILAS: accumulation + distribution
-- Each portfolio type is fully independent with its own switch state machine,
-- transaction legs, NAV track, and settlement function.

-- 1. Add portfolio_type + settlement columns to ilas_portfolio_orders
ALTER TABLE ilas_portfolio_orders
ADD COLUMN IF NOT EXISTS portfolio_type TEXT NOT NULL DEFAULT 'accumulation'
CHECK (portfolio_type IN ('accumulation', 'distribution'));

ALTER TABLE ilas_portfolio_orders
ADD COLUMN IF NOT EXISTS sell_date DATE,
ADD COLUMN IF NOT EXISTS settlement_date DATE,
ADD COLUMN IF NOT EXISTS sell_nav_total DECIMAL(18,8),
ADD COLUMN IF NOT EXISTS buy_nav_total DECIMAL(18,8),
ADD COLUMN IF NOT EXISTS cash_drag_days INT,
ADD COLUMN IF NOT EXISTS is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS confirmation_token TEXT,
ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

-- One active switch per portfolio type (not global)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ilas_one_active_switch_acc
  ON ilas_portfolio_orders ((TRUE))
  WHERE status IN ('pending', 'awaiting_approval') AND portfolio_type = 'accumulation';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ilas_one_active_switch_dis
  ON ilas_portfolio_orders ((TRUE))
  WHERE status IN ('pending', 'awaiting_approval') AND portfolio_type = 'distribution';

-- Update status CHECK to match MPF state machine
ALTER TABLE ilas_portfolio_orders DROP CONSTRAINT IF EXISTS ilas_portfolio_orders_status_check;
ALTER TABLE ilas_portfolio_orders ADD CONSTRAINT ilas_portfolio_orders_status_check
  CHECK (status IN ('awaiting_approval', 'pending', 'executed', 'cancelled', 'expired'));

-- State transition trigger
CREATE OR REPLACE FUNCTION enforce_ilas_switch_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF OLD.status IN ('executed', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot transition from terminal state %', OLD.status;
  END IF;
  IF OLD.status = 'awaiting_approval' AND NEW.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'Invalid transition: awaiting_approval → %', NEW.status;
  END IF;
  IF OLD.status = 'pending' AND NEW.status NOT IN ('executed') THEN
    RAISE EXCEPTION 'Invalid transition: pending → %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ilas_switch_transition ON ilas_portfolio_orders;
CREATE TRIGGER trg_ilas_switch_transition
  BEFORE UPDATE OF status ON ilas_portfolio_orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ilas_switch_transition();

-- 2. Add portfolio_type to ilas_portfolio_nav (composite PK)
ALTER TABLE ilas_portfolio_nav DROP CONSTRAINT IF EXISTS ilas_portfolio_nav_pkey;
ALTER TABLE ilas_portfolio_nav
ADD COLUMN IF NOT EXISTS portfolio_type TEXT NOT NULL DEFAULT 'accumulation'
CHECK (portfolio_type IN ('accumulation', 'distribution'));
ALTER TABLE ilas_portfolio_nav
ADD COLUMN IF NOT EXISTS is_pretracking BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ilas_portfolio_nav ADD PRIMARY KEY (date, portfolio_type);

DROP INDEX IF EXISTS idx_ilas_nav_date;
CREATE INDEX IF NOT EXISTS idx_ilas_nav_date_type ON ilas_portfolio_nav(date DESC, portfolio_type);

-- 3. Transaction legs table
CREATE TABLE IF NOT EXISTS ilas_portfolio_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES ilas_portfolio_orders(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('sell', 'buy')),
  fund_code TEXT NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  units DECIMAL(18,8),
  nav_at_execution DECIMAL(12,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ilas_txn_order ON ilas_portfolio_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_ilas_txn_fund ON ilas_portfolio_transactions(fund_code);

ALTER TABLE ilas_portfolio_transactions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ilas_portfolio_transactions' AND policyname = 'Authenticated read ilas transactions') THEN
    CREATE POLICY "Authenticated read ilas transactions"
      ON ilas_portfolio_transactions FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
GRANT ALL ON ilas_portfolio_transactions TO authenticated, service_role;
GRANT SELECT ON ilas_portfolio_transactions TO anon;

-- 4. Atomic settlement function (parameterized by portfolio_type)
CREATE OR REPLACE FUNCTION settle_ilas_switch(
  p_order_id UUID,
  p_portfolio_type TEXT,
  p_buy_nav_total DECIMAL(18,8),
  p_cash_drag_days INT,
  p_buy_legs JSONB,
  p_nav_date DATE,
  p_nav_value DECIMAL(18,8),
  p_nav_daily_return DECIMAL(8,4),
  p_nav_holdings JSONB
) RETURNS VOID AS $$
DECLARE
  v_order RECORD;
  v_leg JSONB;
  v_expected_legs INT;
  v_inserted_legs INT := 0;
  v_inserted_portfolio INT := 0;
BEGIN
  SELECT * INTO v_order
    FROM ilas_portfolio_orders
    WHERE id = p_order_id AND status = 'pending' AND portfolio_type = p_portfolio_type
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % not in pending state for portfolio type %', p_order_id, p_portfolio_type;
  END IF;

  v_expected_legs := jsonb_array_length(p_buy_legs);

  UPDATE ilas_portfolio_orders SET
    status = 'executed',
    buy_nav_total = p_buy_nav_total,
    cash_drag_days = p_cash_drag_days,
    settled_at = NOW()
  WHERE id = p_order_id;

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_buy_legs)
  LOOP
    INSERT INTO ilas_portfolio_transactions (order_id, side, fund_code, weight, units, nav_at_execution)
    VALUES (
      p_order_id,
      'buy',
      v_leg->>'fund_code',
      (v_leg->>'weight')::DECIMAL,
      (v_leg->>'units')::DECIMAL,
      (v_leg->>'nav_at_execution')::DECIMAL
    );
    v_inserted_legs := v_inserted_legs + 1;
  END LOOP;

  IF v_inserted_legs != v_expected_legs THEN
    RAISE EXCEPTION 'Expected % buy legs, only inserted %', v_expected_legs, v_inserted_legs;
  END IF;

  DELETE FROM ilas_reference_portfolio
    WHERE portfolio_type = p_portfolio_type
    AND fund_id != '00000000-0000-0000-0000-000000000000';

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_buy_legs)
  LOOP
    IF (v_leg->>'weight')::DECIMAL > 0 THEN
      INSERT INTO ilas_reference_portfolio (fund_id, weight, note, updated_by, portfolio_type)
      SELECT f.id, ROUND((v_leg->>'weight')::DECIMAL)::INT, 'T+2 settlement', 'portfolio-tracker', p_portfolio_type
      FROM ilas_funds f
      WHERE f.fund_code = v_leg->>'fund_code';

      IF FOUND THEN
        v_inserted_portfolio := v_inserted_portfolio + 1;
      ELSE
        RAISE EXCEPTION 'Fund code % not found in ilas_funds', v_leg->>'fund_code';
      END IF;
    END IF;
  END LOOP;

  IF v_inserted_portfolio = 0 THEN
    RAISE EXCEPTION 'No portfolio rows inserted';
  END IF;

  INSERT INTO ilas_portfolio_nav (date, portfolio_type, nav, daily_return_pct, holdings, is_cash, is_pretracking)
  VALUES (p_nav_date, p_portfolio_type, p_nav_value, p_nav_daily_return, p_nav_holdings, FALSE, FALSE)
  ON CONFLICT (date, portfolio_type) DO UPDATE SET
    nav = EXCLUDED.nav,
    daily_return_pct = EXCLUDED.daily_return_pct,
    holdings = EXCLUDED.holdings,
    is_cash = EXCLUDED.is_cash;
END;
$$ LANGUAGE plpgsql;
