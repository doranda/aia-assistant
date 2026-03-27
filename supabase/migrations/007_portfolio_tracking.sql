-- 007_portfolio_tracking.sql
-- Portfolio tracking with T+2 settlement simulation
-- Settlement model: Submit T → Sell T+1 NAV → Cash → Buy T+2 NAV

-- ===== TABLE 1: Switch state machine =====
CREATE TABLE IF NOT EXISTS mpf_pending_switches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision_date DATE NOT NULL,
  sell_date DATE NOT NULL,
  settlement_date DATE,                    -- null if awaiting_approval
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('awaiting_approval', 'pending', 'settled', 'expired')),
  old_allocation JSONB NOT NULL,           -- [{code, weight}]
  new_allocation JSONB NOT NULL,           -- [{code, weight}]
  sell_nav_total DECIMAL(18,8),            -- Σ(fund_nav_T1 × old_weight) — filled on sell
  buy_nav_total DECIMAL(18,8),             -- Σ(fund_nav_T2 × new_weight) — filled on settle
  cash_drag_days INT,                      -- working days in cash
  insight_id UUID REFERENCES mpf_insights(id),
  is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ,                  -- for awaiting_approval: 48h after creation
  confirmation_token TEXT,                 -- one-time token for approve endpoint
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CRITICAL: prevent two active switches at once
CREATE UNIQUE INDEX idx_one_active_switch
  ON mpf_pending_switches ((TRUE))
  WHERE status IN ('pending', 'awaiting_approval');

CREATE INDEX idx_switches_status ON mpf_pending_switches(status);
CREATE INDEX idx_switches_settlement ON mpf_pending_switches(settlement_date)
  WHERE status = 'pending';

-- State transition trigger — prevent invalid status changes
CREATE OR REPLACE FUNCTION enforce_switch_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- No-op same-status updates are safe (retry logic)
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  -- Terminal states cannot change
  IF OLD.status IN ('settled', 'expired') THEN
    RAISE EXCEPTION 'Cannot transition from terminal state %', OLD.status;
  END IF;
  -- awaiting_approval can only go to pending or expired
  IF OLD.status = 'awaiting_approval' AND NEW.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'Invalid transition: awaiting_approval → %', NEW.status;
  END IF;
  -- pending can only go to settled (no cancel — matches real AIA behavior)
  IF OLD.status = 'pending' AND NEW.status NOT IN ('settled') THEN
    RAISE EXCEPTION 'Invalid transition: pending → % (once submitted, no cancel)', NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_switch_transition
  BEFORE UPDATE OF status ON mpf_pending_switches
  FOR EACH ROW
  EXECUTE FUNCTION enforce_switch_transition();


-- ===== TABLE 2: Buy/sell transaction legs =====
CREATE TABLE IF NOT EXISTS mpf_portfolio_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  switch_id UUID NOT NULL REFERENCES mpf_pending_switches(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('sell', 'buy')),
  fund_code TEXT NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  units DECIMAL(18,8),                     -- units sold or bought
  nav_at_execution DECIMAL(12,4),          -- NAV on execution date
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_txn_switch ON mpf_portfolio_transactions(switch_id);
CREATE INDEX idx_txn_fund ON mpf_portfolio_transactions(fund_code);


-- ===== TABLE 3: Daily portfolio NAV =====
CREATE TABLE IF NOT EXISTS mpf_portfolio_nav (
  date DATE PRIMARY KEY,
  nav DECIMAL(18,8) NOT NULL,              -- synthetic fund NAV
  daily_return_pct DECIMAL(8,4),           -- day-over-day % change
  holdings JSONB NOT NULL,                 -- [{code, units, weight}] or [] if cash
  is_cash BOOLEAN NOT NULL DEFAULT FALSE,  -- true during settlement
  is_pretracking BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portfolio_nav_date ON mpf_portfolio_nav(date DESC);


-- ===== TABLE 4: HK holidays + market closures =====
CREATE TABLE IF NOT EXISTS mpf_hk_holidays (
  date DATE PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'public_holiday'
    CHECK (type IN ('public_holiday', 'typhoon', 'black_rainstorm'))
);

-- Seed 2025 HK public holidays
INSERT INTO mpf_hk_holidays (date, name) VALUES
  ('2025-01-01', 'New Year''s Day'),
  ('2025-01-29', 'Lunar New Year Day 1'),
  ('2025-01-30', 'Lunar New Year Day 2'),
  ('2025-01-31', 'Lunar New Year Day 3'),
  ('2025-04-04', 'Ching Ming Festival'),
  ('2025-04-18', 'Good Friday'),
  ('2025-04-19', 'Day after Good Friday'),
  ('2025-04-21', 'Easter Monday'),
  ('2025-05-01', 'Labour Day'),
  ('2025-05-05', 'Birthday of the Buddha'),
  ('2025-05-31', 'Tuen Ng Festival'),
  ('2025-07-01', 'HKSAR Establishment Day'),
  ('2025-10-01', 'National Day'),
  ('2025-10-06', 'Chung Yeung Festival'),
  ('2025-10-07', 'Day after Chung Yeung Festival'),
  ('2025-12-25', 'Christmas Day'),
  ('2025-12-26', 'Day after Christmas')
ON CONFLICT (date) DO NOTHING;

-- Seed 2026 HK public holidays
INSERT INTO mpf_hk_holidays (date, name) VALUES
  ('2026-01-01', 'New Year''s Day'),
  ('2026-02-17', 'Lunar New Year Day 1'),
  ('2026-02-18', 'Lunar New Year Day 2'),
  ('2026-02-19', 'Lunar New Year Day 3'),
  ('2026-04-03', 'Good Friday'),
  ('2026-04-04', 'Day after Good Friday'),
  ('2026-04-05', 'Ching Ming Festival'),
  ('2026-04-06', 'Easter Monday'),
  ('2026-05-01', 'Labour Day'),
  ('2026-05-24', 'Birthday of the Buddha'),
  ('2026-06-19', 'Tuen Ng Festival'),
  ('2026-07-01', 'HKSAR Establishment Day'),
  ('2026-10-01', 'National Day'),
  ('2026-10-25', 'Chung Yeung Festival'),
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Day after Christmas')
ON CONFLICT (date) DO NOTHING;

-- Seed 2027 HK public holidays
INSERT INTO mpf_hk_holidays (date, name) VALUES
  ('2027-01-01', 'New Year''s Day'),
  ('2027-02-06', 'Lunar New Year Day 1'),
  ('2027-02-07', 'Lunar New Year Day 2'),
  ('2027-02-08', 'Lunar New Year Day 3'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-27', 'Day after Good Friday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-04-05', 'Ching Ming Festival'),
  ('2027-05-01', 'Labour Day'),
  ('2027-05-13', 'Birthday of the Buddha'),
  ('2027-06-09', 'Tuen Ng Festival'),
  ('2027-07-01', 'HKSAR Establishment Day'),
  ('2027-10-01', 'National Day'),
  ('2027-10-14', 'Chung Yeung Festival'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-27', 'Day after Christmas (substitute)')
ON CONFLICT (date) DO NOTHING;


-- ===== Atomic settlement function =====
-- Called by daily cron. Settles switch + updates portfolio in one transaction.
CREATE OR REPLACE FUNCTION settle_switch(
  p_switch_id UUID,
  p_buy_nav_total DECIMAL(18,8),
  p_cash_drag_days INT,
  p_buy_legs JSONB,  -- [{fund_code, weight, units, nav_at_execution}]
  p_nav_date DATE,
  p_nav_value DECIMAL(18,8),
  p_nav_daily_return DECIMAL(8,4),
  p_nav_holdings JSONB  -- [{code, units, weight}]
) RETURNS VOID AS $$
DECLARE
  v_switch RECORD;
  v_leg JSONB;
  v_expected_legs INT;
  v_inserted_legs INT := 0;
  v_inserted_portfolio INT := 0;
BEGIN
  -- Lock the switch row
  SELECT * INTO v_switch
    FROM mpf_pending_switches
    WHERE id = p_switch_id AND status = 'pending'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Switch % not in pending state or not found', p_switch_id;
  END IF;

  v_expected_legs := jsonb_array_length(p_buy_legs);

  -- 1. Update switch to settled
  UPDATE mpf_pending_switches SET
    status = 'settled',
    buy_nav_total = p_buy_nav_total,
    cash_drag_days = p_cash_drag_days,
    settled_at = NOW()
  WHERE id = p_switch_id;

  -- 2. Insert buy transaction legs
  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_buy_legs)
  LOOP
    INSERT INTO mpf_portfolio_transactions (switch_id, side, fund_code, weight, units, nav_at_execution)
    VALUES (
      p_switch_id,
      'buy',
      v_leg->>'fund_code',
      (v_leg->>'weight')::DECIMAL,
      (v_leg->>'units')::DECIMAL,
      (v_leg->>'nav_at_execution')::DECIMAL
    );
    v_inserted_legs := v_inserted_legs + 1;
  END LOOP;

  -- Verify all legs inserted
  IF v_inserted_legs != v_expected_legs THEN
    RAISE EXCEPTION 'Expected % buy legs, only inserted %', v_expected_legs, v_inserted_legs;
  END IF;

  -- 3. Update reference portfolio (delete old, insert new)
  DELETE FROM mpf_reference_portfolio
    WHERE fund_id != '00000000-0000-0000-0000-000000000000';

  FOR v_leg IN SELECT * FROM jsonb_array_elements(p_buy_legs)
  LOOP
    IF (v_leg->>'weight')::DECIMAL > 0 THEN
      INSERT INTO mpf_reference_portfolio (fund_id, weight, note, updated_by)
      SELECT f.id, ROUND((v_leg->>'weight')::DECIMAL)::INT, 'T+2 settlement', 'portfolio-tracker'
      FROM mpf_funds f
      WHERE f.fund_code = v_leg->>'fund_code';

      IF FOUND THEN
        v_inserted_portfolio := v_inserted_portfolio + 1;
      ELSE
        RAISE EXCEPTION 'Fund code % not found in mpf_funds', v_leg->>'fund_code';
      END IF;
    END IF;
  END LOOP;

  -- Verify portfolio was actually populated
  IF v_inserted_portfolio = 0 THEN
    RAISE EXCEPTION 'No portfolio rows inserted — all weights were 0 or fund codes invalid';
  END IF;

  -- 4. Insert portfolio NAV record (atomic with settlement)
  INSERT INTO mpf_portfolio_nav (date, nav, daily_return_pct, holdings, is_cash, is_pretracking)
  VALUES (p_nav_date, p_nav_value, p_nav_daily_return, p_nav_holdings, FALSE, FALSE)
  ON CONFLICT (date) DO UPDATE SET
    nav = EXCLUDED.nav,
    daily_return_pct = EXCLUDED.daily_return_pct,
    holdings = EXCLUDED.holdings,
    is_cash = EXCLUDED.is_cash;
END;
$$ LANGUAGE plpgsql;


-- ===== RLS =====
ALTER TABLE mpf_pending_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_portfolio_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_portfolio_nav ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_hk_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read switches"
  ON mpf_pending_switches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read transactions"
  ON mpf_portfolio_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read portfolio nav"
  ON mpf_portfolio_nav FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read holidays"
  ON mpf_hk_holidays FOR SELECT TO authenticated USING (true);
