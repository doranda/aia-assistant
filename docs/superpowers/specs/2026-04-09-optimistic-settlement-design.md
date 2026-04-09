# Optimistic Settlement Architecture — Design Spec

**Date:** 2026-04-09
**Status:** Design approved, ready for implementation plan
**Scope:** AIA Knowledge Assistant — MPF + ILAS portfolio settlement pipeline
**Author:** Jonathan Lee (brainstormed with Claude)
**Migration cutoff:** `2026-04-10 00:00:00+08` HKT

---

## Problem Statement

AIA's fund price feeds (`www1.aia.com.hk/CorpWS/...` for ILAS, `www3.aia-pt.com.hk/...` for MPF) have a **structural ~5 business day publication lag**. This is NOT an outage — verified on 2026-04-09 by direct API calls, Playwright-rendered public AIA HTML pages, and DB inspection. The lag is how AIA normally publishes.

Current architecture waits for exact-date NAVs before marking a switch `settled`. Because the NAVs don't arrive for 4-6 biz days after the scheduled date, every switch sits in `pending` status for a week. This is a lie about real-world state:

- **At AIA (real world):** the sell and buy happened on T+1 (ILAS) or T+2 (MPF). The money moved, the units changed hands. Done.
- **In our DB:** still "pending" because we don't know the exact NAV numbers yet.

Consequences of the current design:
1. Users see "pending" for days after the actual transaction
2. Agents can't propose new moves until the fake pending state clears
3. Reports and analytics key off `settled_at`, missing a week of real activity
4. Alerting fires "settlement stuck" warnings on normal operation

## Solution

Introduce an intermediate `executed` state. A switch moves `pending → executed` on its scheduled settlement date (no NAV lookup required), then `executed → settled` when a new reconciliation cron successfully backfills the NAVs.

The `executed` state means: **"AIA has moved the money, we don't yet have the exact numbers."** Agents respect this state via a central gatekeeper. Dashboard shows the state honestly. News-agent signals emitted during the gap are queued and promoted at reconciliation.

## Prerequisites (must be fixed BEFORE this feature ships)

| # | Prereq | Reason | Rollup |
|---|---|---|---|
| P1 | Fix `loadHKHolidays` Supabase error swallowing | Known bug from 2026-04-09 handoff. It swallows errors → empty holiday set → biz-day counter double-counts weekend-adjacent holidays. This feature's `estimatedSettledAt`, 10-biz-day floor, and reconciliation-overdue threshold ALL depend on correct biz-day math. Shipping on broken holiday load = wrong dates shown to users + cooldowns miscalculated. | Must be a blocking commit BEFORE migration |
| P2 | Verify Supabase project timezone | Run `SHOW timezone;` in the project SQL console. Must match what the trigger SQL assumes. If it's UTC, the `'2026-04-10 00:00:00+08'::timestamptz` casts are safe. If it's `Asia/Hong_Kong`, bare date literals elsewhere in the codebase may already be HKT-local and need audit. | Pre-migration check |
| P3 | Document current `getClosestNav` callers | Grep all usages. This feature adds `getExactNav` and reconciliation must NOT use the existing closest-match fn. Catalog prevents accidental reuse. | Pre-implementation audit |

## Decisions Locked (from brainstorming session)

| ID | Decision | Rationale |
|---|---|---|
| Q1 | Three-state machine: `pending → executed → settled` | State machine, not flag bag. Each state has one meaning. Scales as new states emerge (disputed, voided, etc.) |
| Q2 | Hard block during `executed` gap, friendly banner UX | Matches real-world AIA (they block too). Protects agents from operating on estimated units |
| Q3 | Quant agent fully blocked; news agent emits *signals* not *proposals*; 10-biz-day frequency floor per fund | Quant needs real numbers (it's the entire value prop). News can queue urgency. Frequency floor prevents cash-drag over-trading |
| Q4 | Legacy switches finish on old rails via `created_at < migration_ts` gate | Never migrate in-flight money rows through a state machine transition mid-flight |
| Q5 | Single-row dashboard with amber `Executed · reconciling` pill + em-dashes | Em-dashes are honest. Greyed estimates are a lie wearing a costume |
| Arch | Approach 2 (central gate + DB trigger + dedicated cron) over Approach 1 (scattered checks) | White-label multiplier: structural protection built once scales to every future client. DB trigger catches every bug class, not just the ones we thought of. |

## Architecture

### Component map

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT PIPELINE                            │
│  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐  │
│  │ Quant Agent │     │  News Agent  │     │ Signal→Prop  │  │
│  │  (blocked   │     │ (signals OK  │     │  Promoter    │  │
│  │ if not gate │     │  during gap) │     │ (runs at     │  │
│  │  .canAct)   │     │              │     │  settled)    │  │
│  └──────┬──────┘     └──────┬───────┘     └──────┬───────┘  │
│         │                   │                    │          │
│         └─────────┬─────────┴────────────────────┘          │
│                   ▼                                          │
│         ┌──────────────────────┐                            │
│         │ PortfolioStateGate   │◄── single source of truth  │
│         │  .canAct(userId)     │                            │
│         │  .currentState()     │                            │
│         │  .frequencyCheck()   │                            │
│         └──────────┬───────────┘                            │
└────────────────────┼─────────────────────────────────────────┘
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     DATA LAYER                               │
│  ┌──────────────────────────┐    ┌─────────────────────────┐│
│  │ mpf_pending_switches     │    │ ilas_portfolio_orders   ││
│  │  status ENUM + TRIGGER   │    │  status ENUM + TRIGGER  ││
│  │  pending→executed→settled│    │  pending→executed→settled│
│  │  executed_at, settled_at │    │  executed_at, settled_at││
│  └──────────────────────────┘    └─────────────────────────┘│
│  ┌──────────────────────────┐  ┌─────────────────────────┐  │
│  │ agent_signals            │  │ state_transitions       │  │
│  │  pending→promoted|rejected│  │  audit log of every move│ │
│  └──────────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                     ▲                         ▲
                     │                         │
┌────────────────────┴────────┐  ┌────────────┴────────────┐
│  Settlement Cron (existing, │  │  Reconcile Cron (NEW)   │
│   refactored):              │  │   runs after price cron │
│   scheduled date hit →      │  │   finds executed rows   │
│   status='executed'         │  │   checks for NAV avail  │
│   executed_at=now()         │  │   computes units + cash │
│   NO NAV lookup required    │  │   drag, writes settled  │
└─────────────────────────────┘  └─────────────────────────┘
```

### Key structural moves

1. **`PortfolioStateGate` service** — every caller (agents, crons, dashboard, rebalancer) goes through one function to ask "what's allowed right now?" No scattered `status === 'settled'` checks across the codebase.
2. **DB-level state machine via trigger** — PostgreSQL refuses illegal transitions regardless of what the app tries to write. Final unforgiving truth.
3. **Reconciliation cron is a separate endpoint** — own logs, own error budget, doesn't pollute the price cron's dashboard.
4. **`agent_signals` table** — news agent's output during the gap lives here, gets promoted at `settled`.
5. **Migration gate** — `created_at > '2026-04-10 00:00 HKT'` on the new path. Legacy switches finish on old rails.

## Components & Files

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/20260410000000_optimistic_settlement.sql` | Status enum update, trigger function, `agent_signals` table, `state_transitions` audit table |
| `src/lib/portfolio/state-gate.ts` | `PortfolioStateGate` service |
| `src/app/api/cron/reconcile-prices/route.ts` | New reconciliation cron |
| `src/lib/agents/signal-promoter.ts` | Signal→proposal promotion logic |
| `src/lib/portfolio/reconcile.ts` | Pure reconciliation math (DB-free, fully testable) |
| `src/lib/portfolio/get-exact-nav.ts` | **NEW function** — `getExactNav(fundId, date)` returns the NAV row WHERE `date = $2` exactly, or `null`. Do NOT reuse `getClosestNav` (existing fn) — it returns the nearest-available NAV and will silently compute wrong units if used for reconciliation. Contract: exact match only, no fallback, no tolerance window. |
| `tests/portfolio/get-exact-nav.test.ts` | Unit tests proving exact-match semantics: returns null for T+1 if only T is published; returns row for T if T is published; never returns T-1 for a T query |
| `tests/portfolio/state-gate.test.ts` | Unit tests for gate |
| `tests/portfolio/reconcile.test.ts` | Unit tests for reconciliation math |
| `tests/portfolio/frequency-check.test.ts` | Unit tests for 10-biz-day floor |
| `tests/agents/signal-promoter.test.ts` | Unit tests for signal promotion |
| `tests/db/status-transition-trigger.test.ts` | Legal and illegal transition tests |
| `tests/integration/settlement-e2e.test.ts` | Full pending→executed→settled flow |
| `tests/integration/agent-gate-e2e.test.ts` | Quant blocked + news signals during gap |
| `tests/integration/legacy-path.test.ts` | Pre-migration rows take old path |
| `tests/integration/frequency-floor-e2e.test.ts` | Cooldown enforcement |

### Modified files

| File | Change |
|---|---|
| `src/app/api/cron/mpf-portfolio-nav/route.ts` | `processSettlements` writes `status='executed'` on scheduled date, no NAV dependency |
| `src/app/api/cron/ilas-portfolio-nav/route.ts` | Same for `processIlasSettlements` |
| `src/lib/agents/quant-agent.ts` | First line: `if (!gate.canAct(userId)) return { blocked, reason }` |
| `src/lib/agents/news-agent.ts` | During gap: emit `agent_signals` row instead of proposal |
| `src/app/dashboard/portfolio-table.tsx` | `executed` state → amber pill + em-dashes |
| `src/app/dashboard/total-value.tsx` | Sub-label shows ROW COUNT of reconciling positions, not HKD amount (HKD amount is unknown until reconciled). Format: `"Total: HKD 85,234 · 2 positions reconciling"` |
| `src/lib/alerts/settlement-stuck.ts` | Threshold `>= 1` biz day → `>= 10` biz days |
| `vercel.json` | Add `/api/cron/reconcile-prices` entry, runs daily 09:55 HKT (10 min after price cron) |

### Deleted (follow-up commit after ~Apr 17)

Legacy `pending → settled` direct code path in both portfolio-nav crons, once the 2 legacy switches from before the migration cutoff have fully drained.

### Interface contract

```typescript
// src/lib/portfolio/state-gate.ts

type ProductType = 'mpf' | 'ilas';

interface PortfolioStateGate {
  // Product-scoped: MPF gap does NOT block ILAS actions and vice versa.
  // Without productType, the gate is too broad and blocks all agent activity
  // whenever any single product is reconciling.
  canAct(userId: string, productType: ProductType): Promise<{
    allowed: boolean;
    reason?: BlockReason;
  }>;

  currentState(userId: string, productType: ProductType): Promise<{
    hasExecutedRows: boolean;
    executedFunds: string[];
    oldestExecutedAt: Date | null;
    estimatedSettledAt: Date | null; // oldest + 6 biz days (computed via HK calendar — see Prereq 1)
    reconciliationOverdue: boolean; // true if oldestExecutedAt + 10 biz days has passed
  }>;

  frequencyCheck(fundId: string, userId: string): Promise<{
    allowed: boolean;
    nextEligibleDate?: Date;
  }>;

  reasonIfBlocked(userId: string, productType: ProductType): Promise<BlockReason | null>;
}

type BlockReason =
  | { type: 'awaiting_reconciliation'; productType: ProductType; executedFunds: string[]; estReady: Date }
  | { type: 'reconciliation_overdue'; productType: ProductType; executedFunds: string[]; daysOverdue: number } // 10+ biz days stuck — escalate to human
  | { type: 'frequency_floor'; fundId: string; nextEligible: Date }
  | { type: 'legacy_in_flight'; productType: ProductType; switchIds: string[] };

type SignalType =
  | 'bearish_region'       // news agent flagged bearish on a region/market
  | 'bullish_region'       // flipside
  | 'sector_rotation'      // news suggests rotating between sectors
  | 'rate_change_signal'   // central bank rate / yield curve move
  | 'macro_event';         // uncategorized macro news warranting review
```

### Database schema (definitive)

```sql
-- Status enum additions (add 'executed' between existing 'pending' and 'settled')
ALTER TYPE switch_status ADD VALUE IF NOT EXISTS 'executed' BEFORE 'settled';

-- Add executed_at column to both switch tables
ALTER TABLE mpf_pending_switches ADD COLUMN IF NOT EXISTS executed_at timestamptz;
ALTER TABLE mpf_pending_switches ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE ilas_portfolio_orders ADD COLUMN IF NOT EXISTS executed_at timestamptz;
ALTER TABLE ilas_portfolio_orders ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

-- Agent signals queue
CREATE TABLE agent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_type text NOT NULL CHECK (product_type IN ('mpf', 'ilas')),
  -- Optional parent row — a signal may or may not be tied to a specific
  -- in-flight switch. If it IS tied, cascade with the parent.
  mpf_switch_id uuid REFERENCES mpf_pending_switches(id) ON DELETE CASCADE,
  ilas_order_id uuid REFERENCES ilas_portfolio_orders(id) ON DELETE CASCADE,
  signal_type text NOT NULL CHECK (signal_type IN (
    'bearish_region', 'bullish_region', 'sector_rotation',
    'rate_change_signal', 'macro_event'
  )),
  payload jsonb NOT NULL, -- { region?, sector?, confidence: number 0..1, source_articles: string[] }
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'rejected', 'expired')),
  emitted_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  rejection_reason text,
  CONSTRAINT exactly_one_parent_or_none CHECK (
    NOT (mpf_switch_id IS NOT NULL AND ilas_order_id IS NOT NULL)
  )
);

CREATE INDEX idx_agent_signals_pending_by_user
  ON agent_signals (user_id, product_type, emitted_at)
  WHERE status = 'pending';

-- Cancellation policy: when parent switch is CANCELLED (not deleted), the
-- signals remain but are auto-expired. Enforced via trigger.
CREATE OR REPLACE FUNCTION expire_signals_on_parent_cancel() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    UPDATE agent_signals
      SET status = 'expired', consumed_at = now(), rejection_reason = 'parent_cancelled'
      WHERE (
        (TG_TABLE_NAME = 'mpf_pending_switches' AND mpf_switch_id = NEW.id) OR
        (TG_TABLE_NAME = 'ilas_portfolio_orders' AND ilas_order_id = NEW.id)
      ) AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mpf_cancel_expires_signals
  AFTER UPDATE OF status ON mpf_pending_switches
  FOR EACH ROW EXECUTE FUNCTION expire_signals_on_parent_cancel();

CREATE TRIGGER ilas_cancel_expires_signals
  AFTER UPDATE OF status ON ilas_portfolio_orders
  FOR EACH ROW EXECUTE FUNCTION expire_signals_on_parent_cancel();

-- State transitions audit
CREATE TABLE state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK (table_name IN ('mpf_pending_switches', 'ilas_portfolio_orders')),
  row_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  -- actor format: 'cron:<endpoint-name>' | 'user:<uuid>' | 'admin:<email>' | 'system:migration'
  actor text NOT NULL,
  payload jsonb, -- optional: { before: row_snapshot, after: row_snapshot }
  at timestamptz NOT NULL DEFAULT now()
);

-- Prevent duplicate audit writes for the same transition on the same day.
-- The :date cast handles cron retries within the same day; genuine same-day
-- re-transitions (pending→executed→cancelled→pending? — illegal per trigger)
-- cannot occur.
CREATE UNIQUE INDEX idx_state_transitions_dedupe
  ON state_transitions (table_name, row_id, from_status, to_status, ((at AT TIME ZONE 'Asia/Hong_Kong')::date));

CREATE INDEX idx_state_transitions_row ON state_transitions (table_name, row_id, at DESC);
```

## Data Flow

### Flow A: Happy path — new switch from proposal to reconciled

```
T+0  User approves quant-agent proposal
     → INSERT mpf_pending_switches (status='pending', scheduled_settlement_date='T+2')

T+2  09:50 HKT mpf-portfolio-nav cron
     → Finds pending row with scheduled_date ≤ today
     → Gate check: created_at > migration_ts? ✓
     → UPDATE status='executed', executed_at=now()
     → NO NAV lookup, NO blocking
     → Dashboard: amber "Executed · reconciling" pill, em-dashes in NAV cols
     → gate.canAct(userId) → { allowed: false, reason: awaiting_reconciliation }
     → Quant agent refuses new proposals
     → News agent writes to agent_signals instead of proposing

T+3..T+6  reconcile-prices cron runs daily 09:55 HKT
     → Finds status='executed' AND reconciled_at IS NULL
     → getExactNav(fund, sell_date) + getExactNav(fund, settlement_date)
     → Both NULL → skip, try tomorrow

T+7  reconcile-prices cron (Phase 1 — per-row reconciliation)
     → For each row in SELECT ... FOR UPDATE SKIP LOCKED:
          → getExactNav succeeds for both dates
          → Compute: sell_units × sell_nav = sell_total; buy_total / buy_nav = buy_units
          → cash_drag_days = bizDaysBetween(sell_date, settlement_date)
          → UPDATE status='settled', settled_at=now(), reconciled_at=now(), sell_nav_total, buy_nav_total, buy_units, cash_drag_days
          → Upsert historical mpf_portfolio_nav rows [sell_date, today] with ON CONFLICT DO NOTHING
          → INSERT state_transitions row (dedupe index prevents duplicates)

T+7  reconcile-prices cron (Phase 2 — per-user signal promotion, AFTER Phase 1 completes)
     → SELECT DISTINCT user_id, product_type FROM rows_settled_this_run
     → For each (user_id, product_type) pair where gate.canAct(userId, productType) is NOW true:
          → SELECT agent_signals WHERE user_id=X AND product_type=Y AND status='pending' ORDER BY emitted_at
          → Hand each signal to quant agent for evaluation
          → Endorse → proposal, OR reject with reason
          → Mark consumed_at=now(), status='promoted'|'rejected'
          → User sees debate thread in UI
     → Dashboard: amber → green "Settled", real numbers replace em-dashes
     → gate.canAct(userId) → { allowed: true }
```

### Flow B: News agent signal during gap

```
T+3  News event at 08:00 HKT
     → News agent cron 08:30
     → Scores bearish CN equity +0.8
     → gate.canAct(userId) → { blocked: awaiting_reconciliation }
     → INSERT agent_signals (
         signal_type='bearish_region',
         payload={ region:'CN', confidence:0.8, sources:[...] },
         status='pending', emitted_at=now()
       )
     → Dashboard sidebar: "📰 News flagged: bearish CN (pending evaluation)"
     → No proposal, no switch

T+7  Reconciliation completes, signal-promoter runs
     → Quant agent re-evaluates signal against reconciled portfolio
     → Still valid → generate proposal
     → Stale → reject with reason
     → Full audit trail visible
```

### Flow C: Frequency floor (10-biz-day cooldown)

```
Settled China equity switch on Apr 5.
On Apr 12, agent wants to switch again.

gate.frequencyCheck('CN_EQ', userId):
  lastSwitchDate = Apr 5
  nextEligible = Apr 5 + 10 biz days = Apr 19
  Apr 12 < Apr 19 → { allowed: false, nextEligibleDate: Apr 19 }

Quant agent refuses, dashboard shows
"Fund under 10-day cooldown, next eligible Apr 19"
```

### Flow D: Error paths

| Error | Handling |
|---|---|
| reconcile-prices finds row stuck 10+ biz days without NAV | Urgent Discord alert, keep retrying, no auto-fail |
| DB trigger rejects illegal transition | Throw to caller, log row state, urgent alert — this is a code bug |
| signal-promoter crashes mid-batch | Txn rolls back current signal only, others stay, idempotent retry |
| Legacy switch (pre-migration) hits scheduled date | Old code path runs unchanged, gate shows `legacy_in_flight` block |

## Error Handling & Safety Net

### Three layers of defense

**Layer 1 — Database trigger (structural)**

```sql
CREATE OR REPLACE FUNCTION enforce_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF NOT (
    (OLD.status = 'pending'  AND NEW.status IN ('executed', 'cancelled')) OR
    (OLD.status = 'executed' AND NEW.status IN ('settled', 'cancelled'))  OR
    (OLD.status = 'pending'  AND NEW.status = 'settled' AND OLD.created_at < '2026-04-10 00:00:00+08'::timestamptz)
    -- last clause = LEGACY escape hatch. Cutoff = 2026-04-10 00:00 HKT = 2026-04-09 16:00 UTC.
    -- NEVER write this as bare '2026-04-10'::timestamptz — PostgreSQL resolves that to UTC midnight,
    -- which is 8am HKT on Apr 10, creating an 8-hour window where new-era rows incorrectly take
    -- the legacy path. Always explicit +08 offset.
    -- Deletion gated on state, not time — see "Legacy escape hatch deletion" below.
  ) THEN
    RAISE EXCEPTION 'Illegal status transition: % → % on row %', OLD.status, NEW.status, NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_mpf_status_transition
  BEFORE UPDATE ON mpf_pending_switches
  FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();

CREATE TRIGGER enforce_ilas_status_transition
  BEFORE UPDATE ON ilas_portfolio_orders
  FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();
```

**Why this is the most important piece:** no matter what bug gets introduced in the app layer, the DB refuses to move a row through an illegal path. Final unforgiving truth.

**Layer 2 — `PortfolioStateGate` at app edge**

- Every agent entry point calls `gate.canAct()` as first line
- Every cron that writes to switch tables calls `gate.currentState()` first
- Dashboard reads `gate.currentState()` for rendering
- One place to audit for "did we check state?"

**Layer 3 — Observability**

- Every state transition logs to `state_transitions` audit table: `{row_id, from_status, to_status, actor, at}`
- Reconcile cron logs summary: `{checked_count, reconciled_count, oldest_executed_bd, errors}`
- Urgent Discord alerts on:
  - Any DB trigger exception (code bug)
  - Any row `executed` > 10 biz days unreconciled (catastrophic)
  - Any reconcile cron error
- Info alerts on first successful reconciliation each day + signal promoter summary

### Money-path guarantees

| Scenario | Guarantee | Mechanism |
|---|---|---|
| App crashes mid-settlement | No partial state | Single UPDATE statement, no multi-step txn |
| Wrong NAVs used | Detectable after the fact | `state_transitions` audit has full before/after |
| Duplicate reconciliation (cron runs twice) | Idempotent, no-op | `WHERE reconciled_at IS NULL` filter |
| Clock skew, scheduled_date > today | Cannot settle future rows | `WHERE scheduled_settlement_date <= CURRENT_DATE` |
| Future-dated price row | Cannot be used | `getExactNav` filters `date <= current_business_date` |
| Migration boundary race | Legacy path runs for row created 23:59:59.999 Apr 9 HKT | Hard cutoff `created_at < '2026-04-10 00:00:00+08'::timestamptz` — explicit offset |
| Duplicate reconcile cron invocation (Vercel retry, manual trigger) | Per-row work serialized via advisory lock; second invocation finds rows locked and skips them | `SELECT ... FOR UPDATE SKIP LOCKED` on each candidate row in a single txn; historical NAV correction uses `ON CONFLICT DO NOTHING` upsert keyed on `(portfolio_date, user_id, fund_id)` to prevent compounding corrections |
| State_transitions audit duplicate writes | Unique constraint on `(table_name, row_id, from_status, to_status, at::date)` prevents two identical transition rows on the same day | Migration adds composite unique index |

### Concurrency contract for reconcile cron

```sql
-- Inside reconcile-prices cron, per-row processing pattern:
BEGIN;
  SELECT id, user_id, fund_id, sell_date, settlement_date, buy_total
  FROM mpf_pending_switches
  WHERE status = 'executed' AND reconciled_at IS NULL
  ORDER BY executed_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;
  -- ... compute NAVs via getExactNav (not getClosestNav)
  -- ... UPDATE row to settled
  -- ... INSERT state_transitions row
  -- ... upsert historical mpf_portfolio_nav rows with ON CONFLICT DO NOTHING
COMMIT;
```

**Why `SKIP LOCKED` and not `NOWAIT`:** a second concurrent invocation should silently skip locked rows and move to the next candidate, not error. Skipped rows are picked up by whichever invocation finishes first.

### Same-day execute+reconcile window

The settlement cron (09:50 HKT) and reconcile cron (09:55 HKT) run 5 minutes apart. A row with `scheduled_settlement_date = today` transitions `pending → executed` at 09:50 and is immediately eligible for reconciliation at 09:55 on the same day.

**Expected behavior:** do NOT reconcile on the same day a row was executed. Reconciliation must wait at least one calendar day. This prevents the reconcile cron from racing the settlement cron's transaction commit window, and matches AIA reality (NAVs are NEVER published on the same day as execution).

**Filter on reconcile cron:**

```sql
SELECT ... FROM mpf_pending_switches
WHERE status = 'executed'
  AND reconciled_at IS NULL
  AND executed_at < (now() AT TIME ZONE 'Asia/Hong_Kong')::date  -- strictly before today HKT
FOR UPDATE SKIP LOCKED;
```

This also means the reconcile cron can safely run at any time without overlapping the settlement cron's window.

### Legacy escape hatch deletion (state-gated, not time-gated)

The trigger's legacy clause `(OLD.status = 'pending' AND NEW.status = 'settled' AND OLD.created_at < '2026-04-10 00:00:00+08'::timestamptz)` must be removed eventually, but NOT on a date — on a state check.

**Deletion migration:**

```sql
-- supabase/migrations/YYYYMMDD_drop_legacy_escape_hatch.sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM mpf_pending_switches
    WHERE status IN ('pending', 'executed')
      AND created_at < '2026-04-10 00:00:00+08'::timestamptz
  ) OR EXISTS (
    SELECT 1 FROM ilas_portfolio_orders
    WHERE status IN ('pending', 'executed')
      AND created_at < '2026-04-10 00:00:00+08'::timestamptz
  ) THEN
    RAISE EXCEPTION 'Legacy rows still in flight — refusing to remove escape hatch. Run SELECT * FROM mpf_pending_switches WHERE created_at < ''2026-04-10 00:00:00+08''::timestamptz to inspect.';
  END IF;
END $$;

-- Only reached if no legacy rows remain in non-terminal states
CREATE OR REPLACE FUNCTION enforce_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'pending'  AND NEW.status IN ('executed', 'cancelled')) OR
    (OLD.status = 'executed' AND NEW.status IN ('settled', 'cancelled'))
    -- legacy escape hatch REMOVED
  ) THEN
    RAISE EXCEPTION 'Illegal status transition: % → % on row %', OLD.status, NEW.status, NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Run this migration any time after legacy rows drain. If it raises, wait longer. Never delete by calendar date.

### Rollback plan

**Rollback triggers on:**
- Production incident with money impact (wrong units, missing settlements, phantom rows)
- `verify-aia --quick` smoke failure in prod within 1 hour of deploy
- Any exception from `enforce_status_transition` trigger in the first 24 hours (indicates a code path is writing illegal transitions)

**Steps:**

1. **Disable reconcile-prices cron** — remove entry from `vercel.json`, redeploy (~90s)
2. **Revert settlement crons** — `git revert <commit>` on the refactor commit for `processSettlements`/`processIlasSettlements`, push, redeploy (~3 min)
3. **Fix stuck `executed` rows with the template below** — use the SQL template, don't improvise
4. **Keep DB migration in place** — the new columns, tables, and triggers are additive and safe; only the legacy escape hatch in the trigger keeps working
5. **If rollback happens AFTER legacy hatch deletion migration has been applied** — re-apply the trigger with the legacy clause restored (copy from this spec). This is the only path where the trigger needs a roll-forward fix.

**Stuck row SQL template (for step 3):**

```sql
-- Pre-condition: AIA has published NAVs for sell_date and settlement_date.
-- Look up the NAVs manually from mpf_prices / ilas_prices.
--
-- For each stuck row, run the following in a transaction.
-- Substitute the :params with actual values.

BEGIN;

-- 1. Verify the row is actually stuck and not already fixed
SELECT id, status, executed_at, sell_fund_id, buy_fund_id, sell_date, settlement_date, sell_units_input, buy_amount_input
FROM mpf_pending_switches
WHERE id = :row_id AND status = 'executed';
-- Must return 1 row. If 0 → already fixed, abort.

-- 2. Look up NAVs
SELECT fund_id, date, nav FROM mpf_prices
WHERE (fund_id = :sell_fund_id AND date = :sell_date)
   OR (fund_id = :buy_fund_id AND date = :settlement_date);
-- Must return 2 rows. If not → NAVs still not published, wait.

-- 3. Compute: sell_nav_total = sell_units_input × sell_nav
--    buy_units = buy_amount_input / buy_nav (typically = sell_nav_total / buy_nav)
--    cash_drag_days = business days between sell_date and settlement_date

-- 4. Update the row atomically
UPDATE mpf_pending_switches
SET status = 'settled',
    settled_at = now(),
    reconciled_at = now(),
    sell_nav_total = :computed_sell_total,
    buy_nav_total = :computed_buy_total,
    buy_units = :computed_buy_units,
    cash_drag_days = :computed_cash_drag
WHERE id = :row_id AND status = 'executed'; -- defense: double check status

-- 5. Audit the manual transition
INSERT INTO state_transitions (table_name, row_id, from_status, to_status, actor, payload)
VALUES (
  'mpf_pending_switches', :row_id, 'executed', 'settled',
  'admin:' || current_user,
  jsonb_build_object('reason', 'manual rollback reconciliation', 'sell_nav', :sell_nav, 'buy_nav', :buy_nav)
);

-- 6. Backfill historical portfolio NAV rows (if needed)
-- Use the existing portfolio-nav historical backfill helper, not raw SQL.
-- (Running raw UPSERTs here is error-prone; the helper has tested math.)

COMMIT;

-- Repeat for ILAS with ilas_portfolio_orders and ilas_prices.
```

**Data at risk during rollback window:** switches that transitioned to `executed` between deploy and rollback. Expected 0-2/day based on historical cadence. Each recoverable via the template above. Max realistic: ~10 rows if rollback happens after a week of silent failure.

## Testing Strategy

### Unit tests (run on every commit)

| Test file | Coverage | Why |
|---|---|---|
| `state-gate.test.ts` | Every `{state × action × expected}` combination (~20 rows table-driven) | State gate bugs bypass every other check |
| `reconcile.test.ts` | Pure math: unit calc, cash drag, edge cases (zero units, holidays, impossible inputs) | Money math must be provably correct |
| `frequency-check.test.ts` | 10-biz-day floor with HK holidays, weekends, CNY week | Cooldown rule correctness |
| `signal-promoter.test.ts` | Fresh promoted, stale rejected, mid-batch crash rollback | Bridge between news and quant |
| `status-transition-trigger.test.ts` | Every illegal + legal transition, legacy escape hatch | The trigger IS the safety net |

### Integration tests (run pre-deploy)

| Test | Scenario |
|---|---|
| `settlement-e2e.test.ts` | Seed pending → time-travel to scheduled date → run cron → assert executed → seed NAVs → run reconcile → assert settled with correct units |
| `agent-gate-e2e.test.ts` | Executed row exists → quant blocked → news writes signal → mark settled → quant unblocked → signal promoted |
| `legacy-path.test.ts` | `created_at='2026-04-09'` → old path runs, not new path |
| `frequency-floor-e2e.test.ts` | Settle switch → try again 5 bd later (blocked) → wait 10 bd (allowed). **Must include a scenario spanning CNY week** (7+ consecutive HK holidays) — this is the highest-risk biz-day miscount window |
| `cross-product-isolation.test.ts` | Seed MPF executed row + ILAS pending row for same user. Assert `gate.canAct(user, 'ilas')` = allowed, `gate.canAct(user, 'mpf')` = blocked. Assert ILAS settlement cron still runs on the ILAS row despite MPF being stuck |

### Stress tests (audit subagent post-implementation)

| Scenario | Hunting for |
|---|---|
| Empty `agent_signals` when promoter runs | Null deref, off-by-one |
| 100 executed rows in one reconcile run | Perf, txn limits |
| Corrupt row: `executed` but `executed_at IS NULL` | Crash, skip, alerting |
| Clock moves backwards 1 day | Backwards state transition (trigger must block) |
| Two settlement cron invocations same second | Idempotency |
| `getExactNav` returns stale NAV (date < sell_date) | Reconcile must reject |
| Legacy pending + new pending in flight simultaneously | Path independence |
| New agent doesn't know about state machine | Trigger propagates error cleanly |
| Unbounded signal growth | Cap, pruning, oldest-queryable |
| Reconcile fires before price cron | No-op with info log |

### Smoke tests (post-deploy)

| Check | Command |
|---|---|
| Trigger rejects illegal transition | SQL seed + bad UPDATE → expect exception |
| Reconcile cron endpoint | `curl -sI $AIA_URL/api/cron/reconcile-prices` → 200 |
| Gate blocks when executed row exists | SQL seed + API call |
| Dashboard amber pill for executed | Playwright snapshot |
| `state_transitions` writes | Seed + cron + `SELECT count(*)` |

### Coverage targets

- **Unit: 100% of `state-gate.ts`, `reconcile.ts`, `signal-promoter.ts`.** No exceptions.
- **Integration: all 4 critical flows green pre-deploy.**
- **Stress: 0 CRITICAL pre-deploy.** IMPORTANTs documented with fix plan.
- **Smoke: all green post-deploy via `verify-aia`.**

### Regression protection

- 4 integration tests added to pre-ship gate
- Supabase scheduled query alerting on `executed > 7 bd`
- `/api/cron/reconcile-prices` added to `verify-aia --quick`

## Out of Scope

- **Contacting AIA IT about publication lag** — explicitly rejected. The lag is normal.
- **Real-time NAV feed integration** — AIA doesn't offer one; not available.
- **Cancellation of in-flight `executed` switches** — AIA doesn't allow cancellation after execution; no user-facing cancel button on this state.
- **Multi-currency reconciliation** — current design is HKD-only, matching existing scope.
- **Historical migration of pre-2026 switches** — out of scope, legacy data stays as-is.
- **Signal-promoter endorsement-rate dashboard** — metric collection only (in logs). Any UI panel showing endorsement % is out of scope for this phase.
- **User-facing signal history view** — the debate trail is visible via audit logs + `state_transitions`, not a dedicated UI. Dedicated UI is deferred.
- **AIA NAV correction handling (post-publication revisions)** — if AIA publishes a NAV and later revises it, this phase assumes the first publication is final. Correction handling is a future phase.
- **Supabase PITR / time-travel restore testing** — rollback plan assumes forward-only fixes, not DB-level restore.

## Success Criteria

1. **No "pending" lag lie** — users see `executed` pill on settlement date, not 5 days later
2. **Zero illegal transitions** — DB trigger catches all bad state writes in production
3. **Zero estimated-units proposals** — quant agent proposals always based on reconciled data
4. **News-agent signals flow** — signals emitted during gap get promoted or rejected with audit trail
5. **10-biz-day frequency floor enforced** — no fund switched twice inside 10 biz days
6. **`verify-aia` green post-deploy** — all smoke tests pass
7. **Zero CRITICAL findings** in adversarial stress test before deploy
