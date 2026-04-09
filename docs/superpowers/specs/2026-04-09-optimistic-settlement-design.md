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
| `src/app/dashboard/total-value.tsx` | `Total: $X + N reconciling` sub-label |
| `src/lib/alerts/settlement-stuck.ts` | Threshold `>= 1` biz day → `>= 10` biz days |
| `vercel.json` | Add `/api/cron/reconcile-prices` entry, runs daily 09:55 HKT (10 min after price cron) |

### Deleted (follow-up commit after ~Apr 17)

Legacy `pending → settled` direct code path in both portfolio-nav crons, once the 2 legacy switches from before the migration cutoff have fully drained.

### Interface contract

```typescript
// src/lib/portfolio/state-gate.ts

interface PortfolioStateGate {
  canAct(userId: string): Promise<{ allowed: boolean; reason?: BlockReason }>;

  currentState(userId: string): Promise<{
    hasExecutedRows: boolean;
    executedFunds: string[];
    oldestExecutedAt: Date | null;
    estimatedSettledAt: Date | null; // oldest + 6 biz days
  }>;

  frequencyCheck(fundId: string, userId: string): Promise<{
    allowed: boolean;
    nextEligibleDate?: Date;
  }>;

  reasonIfBlocked(userId: string): Promise<BlockReason | null>;
}

type BlockReason =
  | { type: 'awaiting_reconciliation'; executedFunds: string[]; estReady: Date }
  | { type: 'frequency_floor'; fundId: string; nextEligible: Date }
  | { type: 'legacy_in_flight'; switchIds: string[] };
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

T+7  reconcile-prices cron
     → getExactNav succeeds for both dates
     → Compute: sell_units × sell_nav = sell_total; buy_total / buy_nav = buy_units
     → cash_drag_days = bizDaysBetween(sell_date, settlement_date)
     → UPDATE status='settled', settled_at=now(), reconciled_at=now(), sell_nav_total, buy_nav_total, buy_units, cash_drag_days
     → Correct historical mpf_portfolio_nav rows between [sell_date, today]
     → If user's LAST executed row: signal-promoter runs
          → SELECT agent_signals WHERE user_id=X AND status='pending'
          → Hand to quant agent for evaluation
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
    (OLD.status = 'pending'  AND NEW.status = 'settled' AND OLD.created_at < '2026-04-10'::timestamptz)
    -- last clause = LEGACY escape hatch. Delete after ~Apr 17 when legacy rows drained.
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
| Migration boundary race | Legacy path runs for row created 23:59:59.999 Apr 9 | Hard cutoff `created_at < '2026-04-10 00:00:00+08'::timestamptz` |

### Rollback plan

1. Disable reconcile-prices cron (remove `vercel.json` entry, redeploy ~90s)
2. Revert settlement crons to old path (single commit revert)
3. Leave `executed` rows in place — manual SQL to fix to `settled` with hand-computed NAVs
4. Keep DB migration — additive, safe to leave
5. Re-deploy ~5 min total

**Data at risk during rollback window:** switches that transitioned to `executed` between deploy and rollback. Expected 0-2/day. Each recoverable via SQL.

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
| `frequency-floor-e2e.test.ts` | Settle switch → try again 5 bd later (blocked) → wait 10 bd (allowed) |

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

## Success Criteria

1. **No "pending" lag lie** — users see `executed` pill on settlement date, not 5 days later
2. **Zero illegal transitions** — DB trigger catches all bad state writes in production
3. **Zero estimated-units proposals** — quant agent proposals always based on reconciled data
4. **News-agent signals flow** — signals emitted during gap get promoted or rejected with audit trail
5. **10-biz-day frequency floor enforced** — no fund switched twice inside 10 biz days
6. **`verify-aia` green post-deploy** — all smoke tests pass
7. **Zero CRITICAL findings** in adversarial stress test before deploy
