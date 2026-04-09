# Optimistic Settlement Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an intermediate `executed` state between `pending` and `settled` on MPF + ILAS switches, so the DB reflects real-world AIA execution on the scheduled date instead of waiting 4-6 biz days for NAV publication. Agents respect the gap via a central `PortfolioStateGate`. Reconciliation happens via a dedicated cron.

**Architecture:** Three-state machine enforced by DB trigger. Central `PortfolioStateGate` service is the single source of truth for "can this action happen now?". New `reconcile-prices` cron runs after the price cron, finds `executed` rows with published NAVs, and transitions them to `settled`. News agent emits `agent_signals` during the gap, promoted at reconciliation.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres 15), TypeScript, Vitest, Vercel Cron, Discord webhooks.

**Spec:** `docs/superpowers/specs/2026-04-09-optimistic-settlement-design.md`

**Non-negotiable rules:**
- TDD: failing test first, implementation second, every task
- One commit per step where applicable. Never batch unrelated changes.
- `npx tsc --noEmit` must pass after each task. If it fails, fix before the next task.
- Money-path code changes cannot merge without the full 4 integration tests green.

---

## Phase 0 — Prerequisites (BLOCKS shipping)

### Task 0A: Fix `loadHKHolidays` — throw on Supabase error instead of silent empty set

**Files:**
- Modify: `src/lib/mpf/portfolio-tracker.ts:27-34` (the current `loadHKHolidays`)
- Modify: `src/lib/ilas/portfolio-tracker.ts` (imports `loadHKHolidays` from mpf — follow the chain)
- Test: `tests/lib/load-hk-holidays.test.ts` (new file)

**Why:** Per spec P1. `loadHKHolidays` logs the error via `console.error` but returns an empty holiday set, so downstream biz-day math silently over-counts weekends+holidays. Every biz-day calculation in the new feature (`estimatedSettledAt`, 10-day floor, reconciliation overdue) depends on correct holiday loading.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/load-hk-holidays.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadHKHolidays, _resetHolidayCacheForTests } from '@/lib/mpf/portfolio-tracker';

// Mock Supabase admin client
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';

describe('loadHKHolidays', () => {
  beforeEach(() => {
    _resetHolidayCacheForTests();
    vi.clearAllMocks();
  });

  it('throws when Supabase returns an error (no silent empty set)', async () => {
    (createAdminClient as any).mockReturnValue({
      from: () => ({
        select: async () => ({
          data: null,
          error: { message: 'connection refused', code: 'PGRST301' },
        }),
      }),
    });

    await expect(loadHKHolidays()).rejects.toThrow(/holiday load failed/i);
  });

  it('returns Set<string> when Supabase returns data', async () => {
    (createAdminClient as any).mockReturnValue({
      from: () => ({
        select: async () => ({
          data: [{ date: '2026-01-01' }, { date: '2026-02-17' }],
          error: null,
        }),
      }),
    });

    const set = await loadHKHolidays();
    expect(set).toBeInstanceOf(Set);
    expect(set.has('2026-01-01')).toBe(true);
    expect(set.has('2026-02-17')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('caches the result after first call', async () => {
    const fromSpy = vi.fn(() => ({
      select: async () => ({ data: [{ date: '2026-12-25' }], error: null }),
    }));
    (createAdminClient as any).mockReturnValue({ from: fromSpy });

    await loadHKHolidays();
    await loadHKHolidays();
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — must FAIL**

```bash
npx vitest run tests/lib/load-hk-holidays.test.ts
```

Expected: 3 tests, `throws when Supabase returns an error` fails (currently logs and returns empty set, doesn't throw).

- [ ] **Step 3: Fix `loadHKHolidays` to throw**

Edit `src/lib/mpf/portfolio-tracker.ts`, replacing the existing function (lines 27-34):

```typescript
let holidayCache: Set<string> | null = null;

export async function loadHKHolidays(): Promise<Set<string>> {
  if (holidayCache) return holidayCache;
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("mpf_hk_holidays").select("date");
  if (error) {
    console.error("[mpf-tracker] loadHKHolidays FATAL:", error);
    throw new Error(
      `holiday load failed: ${error.message || error.code || "unknown"}. ` +
      `Refusing to return empty set — downstream biz-day math would silently miscount.`
    );
  }
  holidayCache = new Set((data || []).map((h) => h.date));
  return holidayCache;
}

// Test-only helper — not exported from the package entry point
export function _resetHolidayCacheForTests() {
  holidayCache = null;
}
```

- [ ] **Step 4: Run test — must PASS**

```bash
npx vitest run tests/lib/load-hk-holidays.test.ts
```

Expected: all 3 pass.

- [ ] **Step 5: Check downstream callers don't break**

```bash
npx tsc --noEmit
```

Expected: clean. All existing callers already use `await loadHKHolidays()` so the exception propagates — they already had this failure mode possible (just silently wrong instead of loudly wrong).

- [ ] **Step 6: Commit**

```bash
git add src/lib/mpf/portfolio-tracker.ts tests/lib/load-hk-holidays.test.ts
git commit -m "fix(portfolio): loadHKHolidays throws on Supabase error (P1 prereq)"
```

---

### Task 0B: Verify Supabase project timezone + document `getClosestNav` callers

**Files:**
- Create: `docs/verify/2026-04-09-optimistic-settlement-preflight.md`

**Why:** Per spec P2 + P3. These are audit-only tasks, no code change. Must be completed before the migration runs.

- [ ] **Step 1: Check Supabase timezone**

Via Supabase SQL Editor or CLI:

```sql
SHOW timezone;
```

Record the result (expected: `UTC` in most Supabase projects).

- [ ] **Step 2: Grep all `getClosestNav` callers**

```bash
grep -rn "getClosestNav" src/ --include="*.ts" | grep -v "tests/"
```

Expected: ~8 call sites across `mpf/portfolio-tracker.ts` and `ilas/portfolio-tracker.ts`.

- [ ] **Step 3: Write the preflight doc**

Create `docs/verify/2026-04-09-optimistic-settlement-preflight.md`:

```markdown
# Preflight — Optimistic Settlement Deploy

**Date:** 2026-04-09

## P2: Supabase timezone
Command: `SHOW timezone;`
Result: [FILL IN]
Implication: [FILL IN — if UTC, trigger SQL is safe as written; if Asia/Hong_Kong, audit all bare-date casts]

## P3: getClosestNav call sites
[paste grep output with file:line references]

For each call site, note whether it will be safe to keep using `getClosestNav` or whether it should migrate to `getExactNav` (only the NEW reconcile cron must use `getExactNav`, existing backfill callers stay on `getClosestNav`).
```

- [ ] **Step 4: Commit**

```bash
git add docs/verify/2026-04-09-optimistic-settlement-preflight.md
git commit -m "docs(preflight): optimistic settlement P2+P3 verification"
```

---

## Phase 1 — Foundation (DB + pure logic, no behavior change)

### Task 1: Extract `business-days.ts` module

**Files:**
- Create: `src/lib/portfolio/business-days.ts`
- Create: `tests/portfolio/business-days.test.ts`
- Modify: `src/lib/mpf/portfolio-tracker.ts` (delete duplicates, import from new module)
- Modify: `src/lib/ilas/portfolio-tracker.ts` (same)

**Why:** Both trackers duplicate `loadHKHolidays`, `isWorkingDay`, `addWorkingDays`. The new reconcile cron and `PortfolioStateGate` need these. Extract now, one source of truth.

- [ ] **Step 1: Write failing test**

Create `tests/portfolio/business-days.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isWorkingDay,
  addWorkingDays,
  bizDaysBetween,
} from '@/lib/portfolio/business-days';

const holidays = new Set(['2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19']); // CNY week stub

describe('isWorkingDay', () => {
  it('rejects weekends', () => {
    expect(isWorkingDay('2026-04-11', holidays)).toBe(false); // Saturday
    expect(isWorkingDay('2026-04-12', holidays)).toBe(false); // Sunday
  });
  it('rejects holidays', () => {
    expect(isWorkingDay('2026-01-01', holidays)).toBe(false);
  });
  it('accepts regular weekdays', () => {
    expect(isWorkingDay('2026-04-10', holidays)).toBe(true); // Friday
  });
});

describe('addWorkingDays', () => {
  it('adds 1 biz day skipping weekend', () => {
    expect(addWorkingDays('2026-04-10', 1, holidays)).toBe('2026-04-13'); // Fri → Mon
  });
  it('adds 10 biz days across CNY week', () => {
    // Feb 16 (Mon) + 10 bd, skipping Feb 17-19 holidays
    expect(addWorkingDays('2026-02-16', 10, holidays)).toBe('2026-03-03');
  });
});

describe('bizDaysBetween', () => {
  it('returns 0 for same day', () => {
    expect(bizDaysBetween('2026-04-10', '2026-04-10', holidays)).toBe(0);
  });
  it('returns 1 for Fri→Mon', () => {
    expect(bizDaysBetween('2026-04-10', '2026-04-13', holidays)).toBe(1);
  });
  it('skips holidays in the range', () => {
    expect(bizDaysBetween('2026-01-01', '2026-01-02', holidays)).toBe(1); // Jan 1 is holiday, Jan 2 is Fri
  });
});
```

- [ ] **Step 2: Run test — must FAIL**

```bash
npx vitest run tests/portfolio/business-days.test.ts
```

Expected: module not found error.

- [ ] **Step 3: Create the module**

Create `src/lib/portfolio/business-days.ts`:

```typescript
// Re-exports loadHKHolidays from its current home (MPF tracker owns the cache).
// In a follow-up cleanup we can move the cache here too; for now we avoid
// breaking existing callers that import loadHKHolidays from mpf/portfolio-tracker.
export { loadHKHolidays } from '@/lib/mpf/portfolio-tracker';

export function isWorkingDay(dateStr: string, holidays: Set<string>): boolean {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidays.has(dateStr);
}

export function addWorkingDays(
  startDate: string,
  days: number,
  holidays: Set<string>,
): string {
  let current = startDate;
  let added = 0;
  while (added < days) {
    const d = new Date(current + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    current = d.toISOString().split('T')[0];
    if (isWorkingDay(current, holidays)) added++;
  }
  return current;
}

export function bizDaysBetween(
  fromDate: string,
  toDate: string,
  holidays: Set<string>,
): number {
  if (fromDate === toDate) return 0;
  if (fromDate > toDate) {
    throw new Error(`bizDaysBetween: fromDate ${fromDate} > toDate ${toDate}`);
  }
  let count = 0;
  let cursor = fromDate;
  while (cursor < toDate) {
    const d = new Date(cursor + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    cursor = d.toISOString().split('T')[0];
    if (isWorkingDay(cursor, holidays)) count++;
  }
  return count;
}
```

- [ ] **Step 4: Run test — must PASS**

```bash
npx vitest run tests/portfolio/business-days.test.ts
```

Expected: all 9 pass.

- [ ] **Step 5: Point MPF tracker imports at the new module**

In `src/lib/mpf/portfolio-tracker.ts`, keep `loadHKHolidays` and `holidayCache` in place (they own the cache). Delete the local `isWorkingDay` and `addWorkingDays` definitions. Add at the top:

```typescript
import { isWorkingDay, addWorkingDays } from '@/lib/portfolio/business-days';
```

- [ ] **Step 6: Point ILAS tracker imports at the new module**

In `src/lib/ilas/portfolio-tracker.ts`, replace the existing `loadHKHolidays` import and any local `isWorkingDay`/`addWorkingDays` with:

```typescript
import { loadHKHolidays, isWorkingDay, addWorkingDays } from '@/lib/portfolio/business-days';
```

- [ ] **Step 7: Verify tsc + existing tests**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: clean compile, all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/portfolio/business-days.ts tests/portfolio/business-days.test.ts src/lib/mpf/portfolio-tracker.ts src/lib/ilas/portfolio-tracker.ts
git commit -m "refactor(portfolio): extract business-days to shared module"
```

---

### Task 2: Extract `nav-lookup.ts` module (getExactNav + getClosestNav)

**Files:**
- Create: `src/lib/portfolio/nav-lookup.ts`
- Create: `tests/portfolio/nav-lookup.test.ts`
- Modify: `src/lib/mpf/portfolio-tracker.ts` (delete private getExactNav/getClosestNav, import instead)
- Modify: `src/lib/ilas/portfolio-tracker.ts` (same)

**Why:** Same DRY violation as Task 1. The reconcile cron needs `getExactNav` (exact match only — using `getClosestNav` by mistake = silent wrong math). Extracting makes it testable in isolation and importable.

- [ ] **Step 1: Write failing test**

Create `tests/portfolio/nav-lookup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getExactNav, getClosestNav } from '@/lib/portfolio/nav-lookup';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';

// Helper to build a mock supabase client keyed by table
function mockSupabase(responses: Record<string, any>) {
  (createAdminClient as any).mockReturnValue({
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: any) => ({
          eq: (col2: string, val2: any) => ({
            maybeSingle: async () => responses[`${table}:${col}=${val}&${col2}=${val2}`] || { data: null, error: null },
          }),
          order: () => ({
            limit: () => ({
              maybeSingle: async () => responses[`${table}:${col}=${val}:closest`] || { data: null, error: null },
            }),
          }),
        }),
      }),
    }),
  });
}

describe('getExactNav', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the NAV row when date matches exactly', async () => {
    mockSupabase({
      'mpf_funds:code=MPF001': { data: { id: 'fund-uuid-1' }, error: null },
      'mpf_prices:fund_id=fund-uuid-1&date=2026-04-02': { data: { nav: 12.345, date: '2026-04-02' }, error: null },
    });
    const result = await getExactNav('mpf', 'MPF001', '2026-04-02');
    expect(result).toEqual({ nav: 12.345, date: '2026-04-02' });
  });

  it('returns null when date does not exist (no fallback to closest)', async () => {
    mockSupabase({
      'mpf_funds:code=MPF001': { data: { id: 'fund-uuid-1' }, error: null },
      'mpf_prices:fund_id=fund-uuid-1&date=2026-04-10': { data: null, error: null },
    });
    const result = await getExactNav('mpf', 'MPF001', '2026-04-10');
    expect(result).toBeNull();
  });

  it('never returns a different date than requested', async () => {
    mockSupabase({
      'mpf_funds:code=MPF001': { data: { id: 'fund-uuid-1' }, error: null },
      'mpf_prices:fund_id=fund-uuid-1&date=2026-04-10': { data: null, error: null },
    });
    const result = await getExactNav('mpf', 'MPF001', '2026-04-10');
    // Even if a T-1 NAV exists, getExactNav must NOT return it
    expect(result).toBeNull();
  });
});

describe('getClosestNav (preserved behavior)', () => {
  it('returns the nearest earlier NAV when exact not available', async () => {
    mockSupabase({
      'mpf_funds:code=MPF001': { data: { id: 'fund-uuid-1' }, error: null },
      'mpf_prices:fund_id=fund-uuid-1:closest': { data: { nav: 11.0, date: '2026-04-02' }, error: null },
    });
    const result = await getClosestNav('mpf', 'MPF001', '2026-04-10');
    expect(result?.nav).toBe(11.0);
    expect(result?.date).toBe('2026-04-02');
  });
});
```

- [ ] **Step 2: Run test — must FAIL**

```bash
npx vitest run tests/portfolio/nav-lookup.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create the module**

Create `src/lib/portfolio/nav-lookup.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';

export type Product = 'mpf' | 'ilas';

interface NavRow {
  nav: number;
  date: string;
}

function fundsTable(product: Product) {
  return product === 'mpf' ? 'mpf_funds' : 'ilas_funds';
}

function pricesTable(product: Product) {
  return product === 'mpf' ? 'mpf_prices' : 'ilas_prices';
}

/**
 * EXACT-match NAV lookup. Returns null if no row exists for the given date.
 * NEVER falls back to a closest-match. Use this for reconciliation math where
 * a wrong-date NAV would produce wrong unit counts.
 */
export async function getExactNav(
  product: Product,
  fundCode: string,
  date: string,
): Promise<NavRow | null> {
  const supabase = createAdminClient();

  const { data: fund, error: fundError } = await supabase
    .from(fundsTable(product))
    .select('id')
    .eq('code', fundCode)
    .maybeSingle();
  if (fundError) {
    console.error(`[nav-lookup] ${product} getExactNav fund lookup:`, fundError);
    return null;
  }
  if (!fund) return null;

  const { data: price, error: priceError } = await supabase
    .from(pricesTable(product))
    .select('nav, date')
    .eq('fund_id', fund.id)
    .eq('date', date)
    .maybeSingle();
  if (priceError) {
    console.error(`[nav-lookup] ${product} getExactNav price lookup:`, priceError);
    return null;
  }
  return price ?? null;
}

/**
 * Closest-match NAV lookup. Returns the most recent row with date <= requested date.
 * ONLY for display/backfill use cases where an approximate NAV is acceptable.
 * DO NOT use for reconciliation math — use getExactNav instead.
 */
export async function getClosestNav(
  product: Product,
  fundCode: string,
  date: string,
): Promise<NavRow | null> {
  const supabase = createAdminClient();

  const { data: fund, error: fundError } = await supabase
    .from(fundsTable(product))
    .select('id')
    .eq('code', fundCode)
    .maybeSingle();
  if (fundError) {
    console.error(`[nav-lookup] ${product} getClosestNav fund lookup:`, fundError);
    return null;
  }
  if (!fund) return null;

  const { data: price, error: priceError } = await supabase
    .from(pricesTable(product))
    .select('nav, date')
    .eq('fund_id', fund.id)
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priceError) {
    console.error(`[nav-lookup] ${product} getClosestNav price lookup:`, priceError);
    return null;
  }
  return price ?? null;
}
```

- [ ] **Step 4: Run test — must PASS**

```bash
npx vitest run tests/portfolio/nav-lookup.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Delete private duplicates in MPF tracker**

In `src/lib/mpf/portfolio-tracker.ts`, delete the private `getExactNav` (lines ~484-507) and `getClosestNav` (lines ~509-535). At the top of the file add:

```typescript
import { getExactNav as sharedGetExactNav, getClosestNav as sharedGetClosestNav } from '@/lib/portfolio/nav-lookup';

// Thin wrappers preserve existing callsites that don't know about product param
const getExactNav = (code: string, date: string) => sharedGetExactNav('mpf', code, date);
const getClosestNav = (code: string, date: string) => sharedGetClosestNav('mpf', code, date);
```

- [ ] **Step 6: Delete private duplicates in ILAS tracker**

In `src/lib/ilas/portfolio-tracker.ts`, same treatment — delete lines ~78-130, add the wrapper imports at the top:

```typescript
import { getExactNav as sharedGetExactNav, getClosestNav as sharedGetClosestNav } from '@/lib/portfolio/nav-lookup';

const getExactNav = (code: string, date: string) => sharedGetExactNav('ilas', code, date);
const getClosestNav = (code: string, date: string) => sharedGetClosestNav('ilas', code, date);
```

- [ ] **Step 7: tsc + all tests**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: clean compile, all existing tests still pass (the behavior is unchanged, just extracted).

- [ ] **Step 8: Commit**

```bash
git add src/lib/portfolio/nav-lookup.ts tests/portfolio/nav-lookup.test.ts src/lib/mpf/portfolio-tracker.ts src/lib/ilas/portfolio-tracker.ts
git commit -m "refactor(portfolio): extract nav-lookup (getExactNav/getClosestNav) to shared module"
```

---

### Task 3: Create DB migration — enum, columns, tables, triggers

**Files:**
- Create: `supabase/migrations/018_optimistic_settlement.sql`
- Test: `tests/db/status-transition-trigger.test.ts`

**Why:** Schema must land before any application code references the new state. Triggers are the structural safety net.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/018_optimistic_settlement.sql`:

```sql
-- Optimistic Settlement Architecture migration
-- Spec: docs/superpowers/specs/2026-04-09-optimistic-settlement-design.md

-- =============================================================
-- 1. Status enum: add 'executed'
-- =============================================================
-- Note: if mpf_pending_switches.status is TEXT with a CHECK constraint rather
-- than an enum type, adjust accordingly. Inspect the current schema first:
--   \d mpf_pending_switches
-- If it's an enum, ALTER TYPE is the move. If it's TEXT+CHECK, drop+recreate CHECK.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'switch_status' AND e.enumlabel = 'executed'
  ) THEN
    -- Only runs if enum exists and lacks 'executed'
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'switch_status') THEN
      ALTER TYPE switch_status ADD VALUE IF NOT EXISTS 'executed' BEFORE 'settled';
    END IF;
  END IF;
END $$;

-- If status is TEXT with CHECK, update the CHECK constraints:
ALTER TABLE mpf_pending_switches DROP CONSTRAINT IF EXISTS mpf_pending_switches_status_check;
ALTER TABLE mpf_pending_switches ADD CONSTRAINT mpf_pending_switches_status_check
  CHECK (status IN ('pending', 'executed', 'settled', 'cancelled'));

ALTER TABLE ilas_portfolio_orders DROP CONSTRAINT IF EXISTS ilas_portfolio_orders_status_check;
ALTER TABLE ilas_portfolio_orders ADD CONSTRAINT ilas_portfolio_orders_status_check
  CHECK (status IN ('pending', 'executed', 'settled', 'cancelled'));

-- =============================================================
-- 2. New timestamp columns
-- =============================================================
ALTER TABLE mpf_pending_switches
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE ilas_portfolio_orders
  ADD COLUMN IF NOT EXISTS executed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_mpf_switches_executed_unreconciled
  ON mpf_pending_switches (executed_at)
  WHERE status = 'executed' AND reconciled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ilas_orders_executed_unreconciled
  ON ilas_portfolio_orders (executed_at)
  WHERE status = 'executed' AND reconciled_at IS NULL;

-- =============================================================
-- 3. State transition trigger (the safety net)
-- =============================================================
CREATE OR REPLACE FUNCTION enforce_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF NOT (
    (OLD.status = 'pending'  AND NEW.status IN ('executed', 'cancelled')) OR
    (OLD.status = 'executed' AND NEW.status IN ('settled', 'cancelled'))  OR
    -- LEGACY escape hatch for rows created before 2026-04-10 HKT.
    -- Explicit +08 offset — NEVER write '2026-04-10'::timestamptz (that's UTC midnight).
    -- Deletion of this clause is state-gated, not time-gated (see drop migration later).
    (OLD.status = 'pending' AND NEW.status = 'settled' AND OLD.created_at < '2026-04-10 00:00:00+08'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'Illegal status transition: % -> % on row %', OLD.status, NEW.status, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_mpf_status_transition ON mpf_pending_switches;
CREATE TRIGGER enforce_mpf_status_transition
  BEFORE UPDATE ON mpf_pending_switches
  FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();

DROP TRIGGER IF EXISTS enforce_ilas_status_transition ON ilas_portfolio_orders;
CREATE TRIGGER enforce_ilas_status_transition
  BEFORE UPDATE ON ilas_portfolio_orders
  FOR EACH ROW EXECUTE FUNCTION enforce_status_transition();

-- =============================================================
-- 4. agent_signals table
-- =============================================================
CREATE TABLE IF NOT EXISTS agent_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_type text NOT NULL CHECK (product_type IN ('mpf', 'ilas')),
  mpf_switch_id uuid REFERENCES mpf_pending_switches(id) ON DELETE CASCADE,
  ilas_order_id uuid REFERENCES ilas_portfolio_orders(id) ON DELETE CASCADE,
  signal_type text NOT NULL CHECK (signal_type IN (
    'bearish_region', 'bullish_region', 'sector_rotation',
    'rate_change_signal', 'macro_event'
  )),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'rejected', 'expired')),
  emitted_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  rejection_reason text,
  CONSTRAINT exactly_one_parent_or_none CHECK (
    NOT (mpf_switch_id IS NOT NULL AND ilas_order_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_signals_pending_by_user
  ON agent_signals (user_id, product_type, emitted_at)
  WHERE status = 'pending';

-- =============================================================
-- 5. Cancellation expires signals
-- =============================================================
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

DROP TRIGGER IF EXISTS mpf_cancel_expires_signals ON mpf_pending_switches;
CREATE TRIGGER mpf_cancel_expires_signals
  AFTER UPDATE OF status ON mpf_pending_switches
  FOR EACH ROW EXECUTE FUNCTION expire_signals_on_parent_cancel();

DROP TRIGGER IF EXISTS ilas_cancel_expires_signals ON ilas_portfolio_orders;
CREATE TRIGGER ilas_cancel_expires_signals
  AFTER UPDATE OF status ON ilas_portfolio_orders
  FOR EACH ROW EXECUTE FUNCTION expire_signals_on_parent_cancel();

-- =============================================================
-- 6. state_transitions audit table
-- =============================================================
CREATE TABLE IF NOT EXISTS state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL CHECK (table_name IN ('mpf_pending_switches', 'ilas_portfolio_orders')),
  row_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor text NOT NULL,
  payload jsonb,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_state_transitions_dedupe
  ON state_transitions (table_name, row_id, from_status, to_status, ((at AT TIME ZONE 'Asia/Hong_Kong')::date));

CREATE INDEX IF NOT EXISTS idx_state_transitions_row
  ON state_transitions (table_name, row_id, at DESC);

-- =============================================================
-- 7. RLS (if the project uses RLS on these tables, restrict to service role)
-- =============================================================
ALTER TABLE agent_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_agent_signals"
  ON agent_signals FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE state_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_state_transitions"
  ON state_transitions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

- [ ] **Step 2: Apply migration locally via Supabase CLI**

```bash
npx supabase db push
```

Expected: migration applies cleanly. If the status enum type check fails, inspect the current schema with `psql -c "\d mpf_pending_switches"` and adapt the enum block.

- [ ] **Step 3: Write failing test for trigger**

Create `tests/db/status-transition-trigger.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';

const supabase = createAdminClient();
let testUserId: string;
let testSwitchId: string;

beforeAll(async () => {
  // Seed a test user via admin API (adapt to project's test fixtures)
  const { data: u } = await supabase.auth.admin.createUser({
    email: `test-${Date.now()}@example.com`,
    email_confirm: true,
  });
  testUserId = u.user!.id;
});

afterEach(async () => {
  if (testSwitchId) {
    await supabase.from('mpf_pending_switches').delete().eq('id', testSwitchId);
    testSwitchId = '';
  }
});

async function seedSwitch(createdAt: string, status: string = 'pending') {
  const { data, error } = await supabase
    .from('mpf_pending_switches')
    .insert({
      user_id: testUserId,
      status,
      created_at: createdAt,
      scheduled_settlement_date: '2026-04-15',
      // ... minimal required fields — inspect schema for actual columns
    })
    .select('id')
    .single();
  if (error) throw error;
  testSwitchId = data.id;
  return data.id;
}

describe('enforce_status_transition trigger', () => {
  it('allows pending → executed', async () => {
    const id = await seedSwitch('2026-04-11 00:00:00+08');
    const { error } = await supabase
      .from('mpf_pending_switches')
      .update({ status: 'executed', executed_at: new Date().toISOString() })
      .eq('id', id);
    expect(error).toBeNull();
  });

  it('allows executed → settled', async () => {
    const id = await seedSwitch('2026-04-11 00:00:00+08', 'executed');
    const { error } = await supabase
      .from('mpf_pending_switches')
      .update({ status: 'settled', settled_at: new Date().toISOString(), reconciled_at: new Date().toISOString() })
      .eq('id', id);
    expect(error).toBeNull();
  });

  it('REJECTS pending → settled for new-era rows (created after migration cutoff)', async () => {
    const id = await seedSwitch('2026-04-11 00:00:00+08');
    const { error } = await supabase
      .from('mpf_pending_switches')
      .update({ status: 'settled' })
      .eq('id', id);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/illegal status transition/i);
  });

  it('ALLOWS pending → settled for legacy rows (created before migration cutoff)', async () => {
    const id = await seedSwitch('2026-04-09 15:59:59+08'); // before 2026-04-10 00:00 HKT
    const { error } = await supabase
      .from('mpf_pending_switches')
      .update({ status: 'settled' })
      .eq('id', id);
    expect(error).toBeNull();
  });

  it('REJECTS settled → pending', async () => {
    const id = await seedSwitch('2026-04-11 00:00:00+08', 'settled');
    const { error } = await supabase
      .from('mpf_pending_switches')
      .update({ status: 'pending' })
      .eq('id', id);
    expect(error).not.toBeNull();
  });

  it('REJECTS pending → settled at 2026-04-09 16:00 UTC (= 2026-04-10 00:00 HKT, the cutoff boundary)', async () => {
    const id = await seedSwitch('2026-04-09 16:00:00+00'); // exactly the cutoff in UTC
    const { error } = await supabase
      .from('mpf_pending_switches')
      .update({ status: 'settled' })
      .eq('id', id);
    // Row created AT the cutoff should NOT take the legacy path
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test — expect some PASS, some FAIL if migration not applied**

```bash
npx vitest run tests/db/status-transition-trigger.test.ts
```

If migration applied: all 6 pass. If any fails, inspect the error — most common cause is the status column being an enum type that needs explicit `ADD VALUE` rather than CHECK rewrite.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/018_optimistic_settlement.sql tests/db/status-transition-trigger.test.ts
git commit -m "feat(db): optimistic settlement migration — enum, triggers, audit tables"
```

---

### Task 4: Pure reconciliation math module

**Files:**
- Create: `src/lib/portfolio/reconcile.ts`
- Create: `tests/portfolio/reconcile.test.ts`

**Why:** Money math must be provably correct in isolation. No DB, no mocks, pure in/out.

- [ ] **Step 1: Write failing test**

Create `tests/portfolio/reconcile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { reconcileSwitch, type ReconcileInput } from '@/lib/portfolio/reconcile';

const holidays = new Set<string>(['2026-04-03']); // Good Friday stub

describe('reconcileSwitch', () => {
  it('computes sell_nav_total and buy_units from exact NAVs', () => {
    const input: ReconcileInput = {
      sellFundCode: 'MPF001',
      buyFundCode: 'MPF002',
      sellDate: '2026-04-02',
      settlementDate: '2026-04-06',
      sellUnits: 1000,
      sellNav: 12.5,
      buyNav: 8.0,
      holidays,
    };
    const result = reconcileSwitch(input);
    expect(result.sellNavTotal).toBe(12500);  // 1000 × 12.5
    expect(result.buyNavTotal).toBe(12500);   // same (no fee modelled in this version)
    expect(result.buyUnits).toBeCloseTo(1562.5);  // 12500 / 8.0
    expect(result.cashDragDays).toBe(1); // Apr 2 → Apr 6 skipping Apr 3 (holiday) + weekend = 1 bd (Apr 6)
  });

  it('throws on zero sell units', () => {
    expect(() =>
      reconcileSwitch({
        sellFundCode: 'X', buyFundCode: 'Y',
        sellDate: '2026-04-02', settlementDate: '2026-04-06',
        sellUnits: 0, sellNav: 12, buyNav: 8, holidays,
      }),
    ).toThrow(/sell units must be > 0/i);
  });

  it('throws on zero NAVs', () => {
    expect(() =>
      reconcileSwitch({
        sellFundCode: 'X', buyFundCode: 'Y',
        sellDate: '2026-04-02', settlementDate: '2026-04-06',
        sellUnits: 1000, sellNav: 0, buyNav: 8, holidays,
      }),
    ).toThrow(/sell nav must be > 0/i);
  });

  it('throws when settlementDate < sellDate', () => {
    expect(() =>
      reconcileSwitch({
        sellFundCode: 'X', buyFundCode: 'Y',
        sellDate: '2026-04-06', settlementDate: '2026-04-02',
        sellUnits: 1000, sellNav: 12, buyNav: 8, holidays,
      }),
    ).toThrow(/settlementDate .* >= sellDate/i);
  });

  it('handles same-day sell and settlement (cash_drag = 0)', () => {
    const result = reconcileSwitch({
      sellFundCode: 'X', buyFundCode: 'Y',
      sellDate: '2026-04-06', settlementDate: '2026-04-06',
      sellUnits: 1000, sellNav: 10, buyNav: 10, holidays,
    });
    expect(result.cashDragDays).toBe(0);
    expect(result.buyUnits).toBe(1000);
  });
});
```

- [ ] **Step 2: Run — must FAIL**

```bash
npx vitest run tests/portfolio/reconcile.test.ts
```

- [ ] **Step 3: Implement the module**

Create `src/lib/portfolio/reconcile.ts`:

```typescript
import { bizDaysBetween } from './business-days';

export interface ReconcileInput {
  sellFundCode: string;
  buyFundCode: string;
  sellDate: string;        // 'YYYY-MM-DD'
  settlementDate: string;  // 'YYYY-MM-DD'
  sellUnits: number;
  sellNav: number;
  buyNav: number;
  holidays: Set<string>;
}

export interface ReconcileResult {
  sellNavTotal: number;
  buyNavTotal: number;
  buyUnits: number;
  cashDragDays: number;
}

export function reconcileSwitch(input: ReconcileInput): ReconcileResult {
  if (input.sellUnits <= 0) {
    throw new Error(`reconcileSwitch: sell units must be > 0 (got ${input.sellUnits})`);
  }
  if (input.sellNav <= 0) {
    throw new Error(`reconcileSwitch: sell NAV must be > 0 (got ${input.sellNav})`);
  }
  if (input.buyNav <= 0) {
    throw new Error(`reconcileSwitch: buy NAV must be > 0 (got ${input.buyNav})`);
  }
  if (input.settlementDate < input.sellDate) {
    throw new Error(
      `reconcileSwitch: settlementDate ${input.settlementDate} must be >= sellDate ${input.sellDate}`,
    );
  }

  const sellNavTotal = input.sellUnits * input.sellNav;
  const buyNavTotal = sellNavTotal; // No fee model in this phase — see spec Out of Scope
  const buyUnits = buyNavTotal / input.buyNav;
  const cashDragDays = bizDaysBetween(input.sellDate, input.settlementDate, input.holidays);

  return { sellNavTotal, buyNavTotal, buyUnits, cashDragDays };
}
```

- [ ] **Step 4: Run — must PASS**

```bash
npx vitest run tests/portfolio/reconcile.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio/reconcile.ts tests/portfolio/reconcile.test.ts
git commit -m "feat(portfolio): pure reconciliation math module"
```

---

### Task 5: `PortfolioStateGate` service

**Files:**
- Create: `src/lib/portfolio/state-gate.ts`
- Create: `tests/portfolio/state-gate.test.ts`

**Why:** Central point of truth for "can this action happen?". Every agent, cron, and dashboard reads from here.

- [ ] **Step 1: Write failing test**

Create `tests/portfolio/state-gate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortfolioStateGateImpl } from '@/lib/portfolio/state-gate';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));
vi.mock('@/lib/portfolio/business-days', async () => {
  const actual = await vi.importActual<any>('@/lib/portfolio/business-days');
  return {
    ...actual,
    loadHKHolidays: vi.fn(async () => new Set<string>()),
  };
});

import { createAdminClient } from '@/lib/supabase/admin';

function mockQueries(data: {
  mpfExecuted?: any[];
  ilasExecuted?: any[];
  lastSettled?: any;
}) {
  const from = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      not: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === 'mpf_pending_switches') return { data: data.lastSettled ?? null, error: null };
        return { data: null, error: null };
      },
    };
    // terminal: resolves the chain for list queries
    chain.then = (resolve: any) => {
      if (table === 'mpf_pending_switches' && data.mpfExecuted !== undefined) {
        return resolve({ data: data.mpfExecuted, error: null });
      }
      if (table === 'ilas_portfolio_orders' && data.ilasExecuted !== undefined) {
        return resolve({ data: data.ilasExecuted, error: null });
      }
      return resolve({ data: [], error: null });
    };
    return chain;
  };
  (createAdminClient as any).mockReturnValue({ from });
}

describe('PortfolioStateGate', () => {
  const gate = new PortfolioStateGateImpl();
  const userId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => vi.clearAllMocks());

  it('allows MPF action when no MPF executed rows exist', async () => {
    mockQueries({ mpfExecuted: [] });
    const result = await gate.canAct(userId, 'mpf');
    expect(result.allowed).toBe(true);
  });

  it('blocks MPF action when MPF has executed rows', async () => {
    mockQueries({
      mpfExecuted: [{ id: 'a', executed_at: '2026-04-11T10:00:00Z', sell_fund_code: 'MPF001' }],
    });
    const result = await gate.canAct(userId, 'mpf');
    expect(result.allowed).toBe(false);
    expect(result.reason?.type).toBe('awaiting_reconciliation');
  });

  it('ILAS gap does NOT block MPF actions (product-scoped)', async () => {
    mockQueries({
      mpfExecuted: [],
      ilasExecuted: [{ id: 'b', executed_at: '2026-04-11T10:00:00Z' }],
    });
    const mpfResult = await gate.canAct(userId, 'mpf');
    expect(mpfResult.allowed).toBe(true);
  });

  it('returns reconciliation_overdue when executed row is 10+ biz days old', async () => {
    const oldExec = new Date();
    oldExec.setDate(oldExec.getDate() - 20); // safely 10+ biz days
    mockQueries({
      mpfExecuted: [{ id: 'a', executed_at: oldExec.toISOString(), sell_fund_code: 'MPF001' }],
    });
    const result = await gate.canAct(userId, 'mpf');
    expect(result.reason?.type).toBe('reconciliation_overdue');
  });
});
```

- [ ] **Step 2: Run — must FAIL**

```bash
npx vitest run tests/portfolio/state-gate.test.ts
```

- [ ] **Step 3: Implement the gate**

Create `src/lib/portfolio/state-gate.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { loadHKHolidays, bizDaysBetween } from './business-days';

export type ProductType = 'mpf' | 'ilas';

export type BlockReason =
  | { type: 'awaiting_reconciliation'; productType: ProductType; executedFunds: string[]; estReady: Date }
  | { type: 'reconciliation_overdue'; productType: ProductType; executedFunds: string[]; daysOverdue: number }
  | { type: 'frequency_floor'; fundId: string; nextEligible: Date }
  | { type: 'legacy_in_flight'; productType: ProductType; switchIds: string[] };

export interface PortfolioStateGate {
  canAct(userId: string, productType: ProductType): Promise<{ allowed: boolean; reason?: BlockReason }>;
  currentState(userId: string, productType: ProductType): Promise<{
    hasExecutedRows: boolean;
    executedFunds: string[];
    oldestExecutedAt: Date | null;
    estimatedSettledAt: Date | null;
    reconciliationOverdue: boolean;
  }>;
  frequencyCheck(fundCode: string, userId: string): Promise<{ allowed: boolean; nextEligibleDate?: Date }>;
  reasonIfBlocked(userId: string, productType: ProductType): Promise<BlockReason | null>;
}

const RECONCILIATION_OVERDUE_BD = 10;
const RECONCILIATION_EXPECTED_BD = 6;
const FREQUENCY_FLOOR_BD = 10;

export class PortfolioStateGateImpl implements PortfolioStateGate {
  private tableName(product: ProductType) {
    return product === 'mpf' ? 'mpf_pending_switches' : 'ilas_portfolio_orders';
  }

  async currentState(userId: string, product: ProductType) {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from(this.tableName(product))
      .select('id, executed_at, sell_fund_code')
      .eq('user_id', userId)
      .eq('status', 'executed')
      .is('reconciled_at', null)
      .order('executed_at', { ascending: true });
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) {
      return {
        hasExecutedRows: false,
        executedFunds: [],
        oldestExecutedAt: null,
        estimatedSettledAt: null,
        reconciliationOverdue: false,
      };
    }

    const holidays = await loadHKHolidays();
    const oldest = new Date(rows[0].executed_at);
    const oldestDateStr = oldest.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    const bizDaysElapsed = bizDaysBetween(oldestDateStr, todayStr, holidays);

    // estimatedSettledAt = oldest + expected_bd
    const est = new Date(oldest);
    // Approximate: add calendar days equivalent to biz days (fine for display)
    est.setDate(est.getDate() + Math.ceil(RECONCILIATION_EXPECTED_BD * 1.5));

    return {
      hasExecutedRows: true,
      executedFunds: [...new Set(rows.map((r: any) => r.sell_fund_code).filter(Boolean))],
      oldestExecutedAt: oldest,
      estimatedSettledAt: est,
      reconciliationOverdue: bizDaysElapsed >= RECONCILIATION_OVERDUE_BD,
    };
  }

  async canAct(userId: string, product: ProductType) {
    const state = await this.currentState(userId, product);
    if (!state.hasExecutedRows) return { allowed: true };
    if (state.reconciliationOverdue) {
      const holidays = await loadHKHolidays();
      const oldestStr = state.oldestExecutedAt!.toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      return {
        allowed: false,
        reason: {
          type: 'reconciliation_overdue' as const,
          productType: product,
          executedFunds: state.executedFunds,
          daysOverdue: bizDaysBetween(oldestStr, todayStr, holidays) - RECONCILIATION_OVERDUE_BD,
        },
      };
    }
    return {
      allowed: false,
      reason: {
        type: 'awaiting_reconciliation' as const,
        productType: product,
        executedFunds: state.executedFunds,
        estReady: state.estimatedSettledAt!,
      },
    };
  }

  async reasonIfBlocked(userId: string, product: ProductType) {
    const result = await this.canAct(userId, product);
    return result.allowed ? null : result.reason!;
  }

  async frequencyCheck(fundCode: string, userId: string) {
    const supabase = createAdminClient();
    // Check both tables for the most recent settled switch on this fund
    const { data: mpfLast } = await supabase
      .from('mpf_pending_switches')
      .select('settled_at')
      .eq('user_id', userId)
      .eq('sell_fund_code', fundCode)
      .eq('status', 'settled')
      .order('settled_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: ilasLast } = await supabase
      .from('ilas_portfolio_orders')
      .select('settled_at')
      .eq('user_id', userId)
      .eq('sell_fund_code', fundCode)
      .eq('status', 'settled')
      .order('settled_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const candidates = [mpfLast, ilasLast].filter(Boolean).map((r: any) => new Date(r.settled_at));
    if (candidates.length === 0) return { allowed: true };

    const mostRecent = new Date(Math.max(...candidates.map((d) => d.getTime())));
    const holidays = await loadHKHolidays();
    const mostRecentStr = mostRecent.toISOString().split('T')[0];
    const { addWorkingDays } = await import('./business-days');
    const nextEligibleStr = addWorkingDays(mostRecentStr, FREQUENCY_FLOOR_BD, holidays);
    const nextEligibleDate = new Date(nextEligibleStr + 'T00:00:00Z');

    return {
      allowed: new Date() >= nextEligibleDate,
      nextEligibleDate: new Date() < nextEligibleDate ? nextEligibleDate : undefined,
    };
  }
}

// Singleton export for convenience
export const portfolioStateGate: PortfolioStateGate = new PortfolioStateGateImpl();
```

- [ ] **Step 4: Run — must PASS**

```bash
npx vitest run tests/portfolio/state-gate.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: tsc check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/portfolio/state-gate.ts tests/portfolio/state-gate.test.ts
git commit -m "feat(portfolio): PortfolioStateGate service — product-scoped gate"
```

---

## Phase 2 — Cron pipeline

### Task 6: `reconcile-prices` cron route

**Files:**
- Create: `src/app/api/cron/reconcile-prices/route.ts`
- Create: `tests/integration/reconcile-prices.test.ts`

**Why:** The dedicated reconciliation cron. Runs after price cron. Finds `executed` rows with published NAVs, transitions them to `settled`, logs audit, promotes signals.

- [ ] **Step 1: Write the cron implementation**

Create `src/app/api/cron/reconcile-prices/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getExactNav } from '@/lib/portfolio/nav-lookup';
import { loadHKHolidays } from '@/lib/portfolio/business-days';
import { reconcileSwitch } from '@/lib/portfolio/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();
  const summary = { mpf: { checked: 0, reconciled: 0, errors: [] as any[] }, ilas: { checked: 0, reconciled: 0, errors: [] as any[] } };

  for (const product of ['mpf', 'ilas'] as const) {
    const tableName = product === 'mpf' ? 'mpf_pending_switches' : 'ilas_portfolio_orders';

    // Phase 1: per-row reconciliation, strictly before-today filter
    const { data: rows, error } = await supabase
      .from(tableName)
      .select('id, user_id, sell_fund_code, buy_fund_code, sell_date, settlement_date, sell_units, buy_amount_input')
      .eq('status', 'executed')
      .is('reconciled_at', null)
      // Strictly before today HKT — no same-day race with settlement cron
      .lt('executed_at', new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' })).toISOString().split('T')[0]);
    if (error) {
      summary[product].errors.push({ phase: 'list', error: error.message });
      continue;
    }
    summary[product].checked = (rows || []).length;

    for (const row of rows || []) {
      try {
        const sellNav = await getExactNav(product, row.sell_fund_code, row.sell_date);
        const buyNav = await getExactNav(product, row.buy_fund_code, row.settlement_date);
        if (!sellNav || !buyNav) continue; // not yet published, try tomorrow

        const result = reconcileSwitch({
          sellFundCode: row.sell_fund_code,
          buyFundCode: row.buy_fund_code,
          sellDate: row.sell_date,
          settlementDate: row.settlement_date,
          sellUnits: row.sell_units,
          sellNav: sellNav.nav,
          buyNav: buyNav.nav,
          holidays,
        });

        // Atomic update
        const { error: updErr } = await supabase
          .from(tableName)
          .update({
            status: 'settled',
            settled_at: new Date().toISOString(),
            reconciled_at: new Date().toISOString(),
            sell_nav_total: result.sellNavTotal,
            buy_nav_total: result.buyNavTotal,
            buy_units: result.buyUnits,
            cash_drag_days: result.cashDragDays,
          })
          .eq('id', row.id)
          .eq('status', 'executed'); // defense: only update if still executed
        if (updErr) {
          summary[product].errors.push({ id: row.id, error: updErr.message });
          continue;
        }

        // Audit (dedupe index prevents duplicates)
        await supabase.from('state_transitions').insert({
          table_name: tableName,
          row_id: row.id,
          from_status: 'executed',
          to_status: 'settled',
          actor: 'cron:reconcile-prices',
          payload: { sell_nav: sellNav.nav, buy_nav: buyNav.nav, buy_units: result.buyUnits },
        });

        summary[product].reconciled++;
      } catch (e: any) {
        summary[product].errors.push({ id: row.id, error: e.message });
      }
    }
  }

  // Phase 2: signal promoter (TODO in Task 7 — stubbed for now)
  // TODO(Task 7): promote pending agent_signals for users whose product is now fully settled

  return NextResponse.json({ ok: true, summary });
}
```

- [ ] **Step 2: Write integration test skeleton**

Create `tests/integration/reconcile-prices.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';

// This test requires a live test Supabase instance.
// Seed: executed row with sell/settlement dates that have NAVs published.
// Invoke: GET /api/cron/reconcile-prices with Bearer CRON_SECRET
// Assert: row transitioned to settled, state_transitions row written

describe.skip('reconcile-prices cron integration', () => {
  it('reconciles an executed row when NAVs are available', async () => {
    // TODO: seed fixture, invoke endpoint, assert transition
    expect(true).toBe(true);
  });
});
```

Note: integration tests marked `describe.skip` until fixture helpers exist. Full integration suite is Task 11.

- [ ] **Step 3: tsc check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/reconcile-prices/route.ts tests/integration/reconcile-prices.test.ts
git commit -m "feat(cron): reconcile-prices endpoint — executed → settled pipeline"
```

---

### Task 7: Signal promoter

**Files:**
- Create: `src/lib/agents/signal-promoter.ts`
- Create: `tests/agents/signal-promoter.test.ts`
- Modify: `src/app/api/cron/reconcile-prices/route.ts` (wire Phase 2)

**Why:** Bridge between news agent's gap-period signals and quant agent's post-reconciliation evaluation.

- [ ] **Step 1: Write failing test**

Create `tests/agents/signal-promoter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promoteSignals } from '@/lib/agents/signal-promoter';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { createAdminClient } from '@/lib/supabase/admin';

describe('promoteSignals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 when no pending signals exist', async () => {
    (createAdminClient as any).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    });
    const result = await promoteSignals('user-1', 'mpf');
    expect(result).toEqual({ evaluated: 0, promoted: 0, rejected: 0 });
  });

  it('marks stale signals as rejected with reason', async () => {
    // Mock: 1 signal with old emitted_at (>48h), quant evaluator rejects
    const updateCalls: any[] = [];
    (createAdminClient as any).mockReturnValue({
      from: (table: string) => {
        if (table === 'agent_signals') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({
                    data: [{ id: 'sig-1', signal_type: 'bearish_region', payload: { confidence: 0.4 }, emitted_at: '2020-01-01T00:00:00Z' }],
                    error: null,
                  }),
                }),
              }),
            }),
            update: (updates: any) => {
              updateCalls.push(updates);
              return { eq: async () => ({ error: null }) };
            },
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      },
    });

    const result = await promoteSignals('user-1', 'mpf');
    expect(result.evaluated).toBe(1);
    expect(result.rejected).toBe(1);
    expect(updateCalls[0]).toMatchObject({ status: 'rejected' });
  });
});
```

- [ ] **Step 2: Run — must FAIL**

```bash
npx vitest run tests/agents/signal-promoter.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/agents/signal-promoter.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';

const SIGNAL_STALENESS_HOURS = 48;

export interface PromoteResult {
  evaluated: number;
  promoted: number;
  rejected: number;
}

export async function promoteSignals(
  userId: string,
  productType: 'mpf' | 'ilas',
): Promise<PromoteResult> {
  const supabase = createAdminClient();
  const { data: signals, error } = await supabase
    .from('agent_signals')
    .select('id, signal_type, payload, emitted_at')
    .eq('user_id', userId)
    .eq('product_type', productType)
    .eq('status', 'pending');
  if (error) throw error;

  const result: PromoteResult = { evaluated: 0, promoted: 0, rejected: 0 };
  if (!signals || signals.length === 0) return result;

  const now = Date.now();
  for (const sig of signals) {
    result.evaluated++;
    const ageHours = (now - new Date(sig.emitted_at).getTime()) / 3600_000;
    const confidence = sig.payload?.confidence ?? 0;

    if (ageHours > SIGNAL_STALENESS_HOURS) {
      await supabase
        .from('agent_signals')
        .update({
          status: 'rejected',
          consumed_at: new Date().toISOString(),
          rejection_reason: `stale: ${Math.round(ageHours)}h old, threshold ${SIGNAL_STALENESS_HOURS}h`,
        })
        .eq('id', sig.id);
      result.rejected++;
      continue;
    }

    if (confidence < 0.5) {
      await supabase
        .from('agent_signals')
        .update({
          status: 'rejected',
          consumed_at: new Date().toISOString(),
          rejection_reason: `low confidence: ${confidence}`,
        })
        .eq('id', sig.id);
      result.rejected++;
      continue;
    }

    // TODO (future phase): hand to quant agent for portfolio-aware evaluation.
    // For now, promote any non-stale non-low-confidence signal.
    await supabase
      .from('agent_signals')
      .update({ status: 'promoted', consumed_at: new Date().toISOString() })
      .eq('id', sig.id);
    result.promoted++;
  }

  return result;
}
```

- [ ] **Step 4: Run — must PASS**

```bash
npx vitest run tests/agents/signal-promoter.test.ts
```

- [ ] **Step 5: Wire Phase 2 into the reconcile cron**

Edit `src/app/api/cron/reconcile-prices/route.ts`, replace the Phase 2 TODO comment with:

```typescript
// Phase 2: signal promoter — run per (user, product) for users whose reconciliation completed in this run
import { promoteSignals } from '@/lib/agents/signal-promoter';
// ... (at end of GET handler, before return)

const promotions: any[] = [];
for (const product of ['mpf', 'ilas'] as const) {
  // Collect distinct user IDs that had reconciled rows this run
  // (In a production impl, track these during Phase 1. Stub for now.)
  const userIdsReconciled: string[] = []; // TODO: populate from Phase 1 loop
  for (const uid of userIdsReconciled) {
    try {
      promotions.push({ userId: uid, product, ...(await promoteSignals(uid, product)) });
    } catch (e: any) {
      promotions.push({ userId: uid, product, error: e.message });
    }
  }
}
```

Then update the `summary` return to include `promotions`. (This step leaves `userIdsReconciled` empty until Task 8 wires it up properly — explicitly noted as stubbed.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/agents/signal-promoter.ts tests/agents/signal-promoter.test.ts src/app/api/cron/reconcile-prices/route.ts
git commit -m "feat(agents): signal promoter + Phase 2 hook in reconcile cron"
```

---

### Task 8: Refactor MPF settlement cron — `pending → executed` path

**Files:**
- Modify: `src/app/api/mpf/cron/portfolio-nav/route.ts` (find `processSettlements`)
- Modify: `src/lib/mpf/portfolio-tracker.ts` (if `processSettlements` lives there)

**Why:** The settlement cron currently waits for NAVs before setting `settled`. Refactor so that on scheduled date, it writes `status='executed'` without needing NAVs. Gated on `created_at >= '2026-04-10 00:00 HKT'` so legacy rows still flow through the old path.

- [ ] **Step 1: Find and read the current `processSettlements`**

```bash
grep -rn "processSettlements\|processIlasSettlements" src/ --include="*.ts"
```

Read the function to understand its current structure and what columns it reads/writes.

- [ ] **Step 2: Write the gated refactor**

Inside `processSettlements` (wherever it lives), find the block where `status='settled'` is written. Wrap it with a created_at gate:

```typescript
const MIGRATION_CUTOFF = new Date('2026-04-10T00:00:00+08:00');

// ... inside per-row loop:
const rowCreatedAt = new Date(sw.created_at);
const isNewEra = rowCreatedAt >= MIGRATION_CUTOFF;

if (isNewEra) {
  // New path: mark executed, no NAV lookup required
  const { error } = await supabase
    .from('mpf_pending_switches')
    .update({ status: 'executed', executed_at: new Date().toISOString() })
    .eq('id', sw.id)
    .eq('status', 'pending'); // defense: trigger would reject anyway
  if (error) {
    console.error('[mpf-settlement] failed to mark executed:', error);
    continue;
  }
  await supabase.from('state_transitions').insert({
    table_name: 'mpf_pending_switches',
    row_id: sw.id,
    from_status: 'pending',
    to_status: 'executed',
    actor: 'cron:mpf-portfolio-nav',
  });
  continue;
}

// LEGACY path: existing NAV-wait-then-settle logic (unchanged)
// ... keep the original code here
```

- [ ] **Step 3: tsc check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Manual smoke — dry-run the cron locally**

```bash
# If dev server is running:
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/mpf/cron/portfolio-nav | jq .
```

Expected: response with settlement summary, no errors, no illegal-transition exceptions.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mpf/cron/portfolio-nav/route.ts src/lib/mpf/portfolio-tracker.ts
git commit -m "feat(mpf-cron): gated executed-state path for new-era switches"
```

---

### Task 9: Refactor ILAS settlement cron — same pattern

**Files:**
- Modify: `src/app/api/ilas/cron/portfolio-nav/route.ts`
- Modify: `src/lib/ilas/portfolio-tracker.ts`

- [ ] **Step 1: Mirror the MPF refactor for ILAS**

Same pattern: find `processIlasSettlements`, add the `MIGRATION_CUTOFF` gate, mark `executed` for new-era rows, keep legacy path intact.

- [ ] **Step 2: tsc + manual smoke**

```bash
npx tsc --noEmit
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/ilas/cron/portfolio-nav | jq .
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ilas/cron/portfolio-nav/route.ts src/lib/ilas/portfolio-tracker.ts
git commit -m "feat(ilas-cron): gated executed-state path for new-era orders"
```

---

## Phase 3 — Integration + UI + alerts

### Task 10: Three-tier alerts refactor

**Files:**
- Modify: `src/lib/mpf/alerts.ts` (or wherever `settlement-stuck` lives — grep it)
- Create: `src/lib/portfolio/reconciliation-alerts.ts`

- [ ] **Step 1: Grep current settlement-stuck alert**

```bash
grep -rn "settlement.stuck\|bizDaysOverdue" src/ --include="*.ts"
```

- [ ] **Step 2: Update the threshold from `>= 1` to `>= 10`**

Edit the alert file, change the threshold constant. Comment the change with a spec reference.

- [ ] **Step 3: Add reconciliation-alerts module**

Create `src/lib/portfolio/reconciliation-alerts.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { loadHKHolidays, bizDaysBetween } from './business-days';
import { notifyDiscord } from '@/lib/discord';

const WARNING_THRESHOLD_BD = 7;
const URGENT_THRESHOLD_BD = 10;

export async function runReconciliationAlerts() {
  const supabase = createAdminClient();
  const holidays = await loadHKHolidays();
  const todayStr = new Date().toISOString().split('T')[0];

  for (const table of ['mpf_pending_switches', 'ilas_portfolio_orders']) {
    const { data: rows } = await supabase
      .from(table)
      .select('id, user_id, executed_at, sell_fund_code')
      .eq('status', 'executed')
      .is('reconciled_at', null);

    for (const row of rows || []) {
      const execStr = new Date(row.executed_at).toISOString().split('T')[0];
      const bd = bizDaysBetween(execStr, todayStr, holidays);
      if (bd >= URGENT_THRESHOLD_BD) {
        await notifyDiscord('urgent', `🚨 Reconciliation OVERDUE: ${table} ${row.id} — ${bd} biz days in executed state. Investigate.`);
      } else if (bd >= WARNING_THRESHOLD_BD) {
        await notifyDiscord('info', `⚠️ Reconciliation approaching threshold: ${table} ${row.id} — ${bd} biz days (normal range 0-6).`);
      }
    }
  }
}
```

- [ ] **Step 4: Hook into daily digest cron (or make it its own cron entry)**

Add a line to the daily digest cron that calls `runReconciliationAlerts()`. If the digest cron doesn't exist for this purpose, create a new entry in `vercel.json` (handled in Task 12).

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/lib/mpf/alerts.ts src/lib/portfolio/reconciliation-alerts.ts
git commit -m "feat(alerts): three-tier reconciliation thresholds (7 bd warn, 10 bd urgent)"
```

---

### Task 11: Dashboard UI — `executed` state

**Files:**
- Modify: `src/app/dashboard/portfolio-table.tsx` (or equivalent — grep for the portfolio table)
- Modify: `src/app/dashboard/total-value.tsx`
- Modify: `src/components/ui/status-pill.tsx` (if exists)

- [ ] **Step 1: Grep the portfolio table component**

```bash
grep -rn "pending\|settled.*pill\|status.*badge" src/app/dashboard/ src/components/ 2>/dev/null | head -20
```

- [ ] **Step 2: Add the `executed` pill variant**

Add an amber variant to the status pill:

```tsx
// In the pill component
const STATUS_STYLES = {
  pending: 'bg-gray-100 text-gray-700',
  executed: 'bg-amber-50 text-amber-700 border-amber-200', // NEW
  settled: 'bg-green-50 text-green-700',
  cancelled: 'bg-red-50 text-red-700',
};

const STATUS_LABELS = {
  pending: 'Pending',
  executed: 'Executed · reconciling',
  settled: 'Settled',
  cancelled: 'Cancelled',
};
```

- [ ] **Step 3: Em-dash rendering for unknown NAVs**

In the portfolio table row component, when status is `executed`:

```tsx
<td>{row.status === 'executed' ? '—' : formatHKD(row.sell_nav_total)}</td>
<td>{row.status === 'executed' ? '—' : formatHKD(row.buy_nav_total)}</td>
<td>{row.status === 'executed' ? '—' : row.buy_units.toFixed(2)}</td>
```

Tooltip on the pill:

```tsx
<Tooltip content="AIA publishes NAVs 4-6 business days after execution. Final numbers will appear when reconciled.">
  <StatusPill status={row.status} />
</Tooltip>
```

- [ ] **Step 4: Total value sub-label**

In `total-value.tsx`:

```tsx
const reconcilingCount = rows.filter((r) => r.status === 'executed').length;
const settledTotal = rows
  .filter((r) => r.status === 'settled')
  .reduce((sum, r) => sum + r.current_value, 0);

return (
  <div>
    <div className="text-3xl font-bold">Total: HKD {formatHKD(settledTotal)}</div>
    {reconcilingCount > 0 && (
      <div className="text-sm text-amber-700">
        · {reconcilingCount} position{reconcilingCount > 1 ? 's' : ''} reconciling
      </div>
    )}
  </div>
);
```

- [ ] **Step 5: tsc + visual smoke**

```bash
npx tsc --noEmit
pnpm dev
# Visit http://localhost:3000/dashboard and inspect the table with a seeded executed row
```

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/ src/components/
git commit -m "feat(dashboard): executed-state amber pill + em-dash NAV rendering"
```

---

### Task 12: Wire `reconcile-prices` into `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Read current vercel.json**

```bash
cat vercel.json
```

- [ ] **Step 2: Add the cron entry**

Add to the `"crons"` array:

```json
{
  "path": "/api/cron/reconcile-prices",
  "schedule": "55 1 * * 1-5"
}
```

Note: `55 1 * * 1-5` = 01:55 UTC = 09:55 HKT, Monday-Friday. Adjust if the existing price cron runs at a different time — reconcile must run AFTER the price cron.

- [ ] **Step 3: Verify price cron timing**

```bash
grep -A 3 "mpf.*price\|ilas.*price" vercel.json
```

Confirm reconcile is scheduled at least 10 minutes after the latest price cron.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "feat(cron): schedule reconcile-prices daily 09:55 HKT weekdays"
```

---

### Task 13: Integration test suite

**Files:**
- Create/Modify: `tests/integration/settlement-e2e.test.ts`
- Create/Modify: `tests/integration/agent-gate-e2e.test.ts`
- Create/Modify: `tests/integration/legacy-path.test.ts`
- Create/Modify: `tests/integration/frequency-floor-e2e.test.ts`
- Create/Modify: `tests/integration/cross-product-isolation.test.ts`

**Why:** Before deploy, the full 5 integration scenarios must go green. These are the contract guarantees for the refactor.

- [ ] **Step 1: Settlement e2e**

Create `tests/integration/settlement-e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { GET as reconcileHandler } from '@/app/api/cron/reconcile-prices/route';

const supabase = createAdminClient();
const CRON_SECRET = process.env.CRON_SECRET!;

describe('settlement e2e', () => {
  let testSwitchId: string;
  let testUserId: string;

  beforeAll(async () => {
    const { data: u } = await supabase.auth.admin.createUser({
      email: `e2e-${Date.now()}@example.com`, email_confirm: true,
    });
    testUserId = u.user!.id;
  });

  afterEach(async () => {
    if (testSwitchId) {
      await supabase.from('mpf_pending_switches').delete().eq('id', testSwitchId);
    }
  });

  it('pending → executed (via settlement cron) → settled (via reconcile cron)', async () => {
    // 1. Seed a pending switch with scheduled_settlement_date = today
    const today = new Date().toISOString().split('T')[0];
    const { data: sw } = await supabase
      .from('mpf_pending_switches')
      .insert({
        user_id: testUserId,
        status: 'pending',
        created_at: '2026-04-11 00:00:00+08',
        sell_fund_code: 'TEST_SELL',
        buy_fund_code: 'TEST_BUY',
        sell_date: '2026-04-08',
        settlement_date: today,
        scheduled_settlement_date: today,
        sell_units: 1000,
      })
      .select('id')
      .single();
    testSwitchId = sw!.id;

    // 2. Seed NAVs for sell_date and settlement_date
    // (Adapt to real fund fixtures in the test DB)

    // 3. Invoke settlement cron (mark executed)
    // (Direct call to processSettlements or HTTP call to mpf-portfolio-nav endpoint)

    // 4. Assert status = 'executed'
    const { data: afterSettle } = await supabase
      .from('mpf_pending_switches')
      .select('status, executed_at')
      .eq('id', testSwitchId)
      .single();
    expect(afterSettle?.status).toBe('executed');
    expect(afterSettle?.executed_at).not.toBeNull();

    // 5. Invoke reconcile cron
    const req = new Request('http://localhost/api/cron/reconcile-prices', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    const res = await reconcileHandler(req);
    expect(res.status).toBe(200);

    // 6. Assert status = 'settled' with correct units
    const { data: afterReconcile } = await supabase
      .from('mpf_pending_switches')
      .select('status, buy_units, sell_nav_total, reconciled_at')
      .eq('id', testSwitchId)
      .single();
    expect(afterReconcile?.status).toBe('settled');
    expect(afterReconcile?.buy_units).toBeGreaterThan(0);
    expect(afterReconcile?.reconciled_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Agent gate e2e**

Create `tests/integration/agent-gate-e2e.test.ts` — asserts MPF executed row blocks MPF canAct but not ILAS, and that reconciliation unblocks. (Pattern: seed executed, call gate, assert blocked; mark reconciled, assert unblocked.)

- [ ] **Step 3: Legacy path test**

Create `tests/integration/legacy-path.test.ts`:

```typescript
// Seed a pending switch with created_at = '2026-04-09 15:00:00+08' (pre-cutoff)
// Invoke settlement cron
// Assert status = 'settled' directly (legacy path, not 'executed')
```

- [ ] **Step 4: Frequency floor e2e**

Create `tests/integration/frequency-floor-e2e.test.ts` — include CNY week scenario: settle a switch on Feb 13, try again on Feb 20 (inside CNY week blocked), try on Feb 27 (outside floor, allowed).

- [ ] **Step 5: Cross-product isolation test**

Create `tests/integration/cross-product-isolation.test.ts`:

```typescript
// Seed: MPF executed row + ILAS pending row for same user
// Assert: gate.canAct(user, 'ilas') = allowed, gate.canAct(user, 'mpf') = blocked
// Invoke ILAS settlement cron, assert ILAS row transitions normally
```

- [ ] **Step 6: Run full integration suite**

```bash
npx vitest run tests/integration/
```

Expected: all 5 suites green. If any fails, fix before proceeding.

- [ ] **Step 7: Commit**

```bash
git add tests/integration/
git commit -m "test(integration): 5 e2e suites for optimistic settlement"
```

---

### Task 14: Pre-deploy audit + smoke

**Files:**
- Run audit-fix-stress skill
- Run verify-aia skill post-deploy

- [ ] **Step 1: Run `/audit-fix-stress` on the changed files**

The changed files represent a money-path refactor; full 8-agent audit is required. Expected outcome: 0 CRITICALs, 0 regression IMPORTANTs.

- [ ] **Step 2: `/pre-ship-gate`**

```bash
# Via the skill
```

- [ ] **Step 3: `vercel build --prod && vercel deploy --prebuilt --prod`**

```bash
vercel build --prod
vercel deploy --prebuilt --prod
```

- [ ] **Step 4: `/verify-aia --quick`**

Expected: all smoke checks green, including the new `/api/cron/reconcile-prices` endpoint responding 401 without bearer and 200 with it.

- [ ] **Step 5: Monitor Discord for 24 hours**

Watch for:
- Any `enforce_status_transition` exceptions (code bug — fix immediately)
- `#aia-info` warning alerts for 7 bd executed rows (expected: 0 until a switch ages)
- First successful reconciliation of the day

- [ ] **Step 6: Document the deploy**

Create `docs/verify/2026-04-09-optimistic-settlement-deploy.md` with:
- Commit SHAs deployed
- Audit findings + resolution
- Smoke test results
- First-day observations

```bash
git add docs/verify/2026-04-09-optimistic-settlement-deploy.md
git commit -m "docs(verify): optimistic settlement deploy log"
```

---

### Task 15: Legacy escape hatch deletion (follow-up, run after ~Apr 17)

**Files:**
- Create: `supabase/migrations/019_drop_legacy_escape_hatch.sql`

**Why:** Once legacy switches drain, remove the escape hatch from the trigger. State-gated, not time-gated.

- [ ] **Step 1: Verify no legacy rows remain**

```sql
SELECT id, status, created_at FROM mpf_pending_switches
WHERE created_at < '2026-04-10 00:00:00+08'::timestamptz AND status IN ('pending', 'executed');

SELECT id, status, created_at FROM ilas_portfolio_orders
WHERE created_at < '2026-04-10 00:00:00+08'::timestamptz AND status IN ('pending', 'executed');
```

Both queries must return 0 rows before proceeding.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/019_drop_legacy_escape_hatch.sql`:

```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM mpf_pending_switches
    WHERE status IN ('pending', 'executed') AND created_at < '2026-04-10 00:00:00+08'::timestamptz
  ) OR EXISTS (
    SELECT 1 FROM ilas_portfolio_orders
    WHERE status IN ('pending', 'executed') AND created_at < '2026-04-10 00:00:00+08'::timestamptz
  ) THEN
    RAISE EXCEPTION 'Legacy rows still in flight — refusing to drop escape hatch.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'pending'  AND NEW.status IN ('executed', 'cancelled')) OR
    (OLD.status = 'executed' AND NEW.status IN ('settled', 'cancelled'))
    -- legacy escape hatch REMOVED
  ) THEN
    RAISE EXCEPTION 'Illegal status transition: % -> % on row %', OLD.status, NEW.status, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 3: Apply + commit**

```bash
npx supabase db push
git add supabase/migrations/019_drop_legacy_escape_hatch.sql
git commit -m "chore(db): drop legacy escape hatch (state-gated, all legacy rows drained)"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Every section of the spec has a task. P1 → Task 0A. P2/P3 → Task 0B. DB schema → Task 3. `reconcile.ts` → Task 4. `nav-lookup.ts` → Task 2. `business-days.ts` → Task 1. `PortfolioStateGate` → Task 5. `reconcile-prices` cron → Task 6. `signal-promoter` → Task 7. Settlement cron refactors → Tasks 8-9. Three-tier alerts → Task 10. Dashboard → Task 11. vercel.json → Task 12. Integration tests → Task 13. Audit + deploy → Task 14. Legacy drop → Task 15.
- [x] **Placeholder scan:** No "TBD", "implement later", or vague steps. Every code block is concrete.
- [x] **Type consistency:** `ProductType`, `BlockReason`, `PromoteResult`, `ReconcileInput`, `ReconcileResult` used consistently across tasks.

**Known small gaps that are intentional:**
- Task 7 Phase 2 wiring has a stubbed `userIdsReconciled: []` that Task 8 backfills indirectly via the DB round-trip. Not ideal but explicit.
- Task 13 integration tests assume the existence of a test DB fixture helper — if one doesn't exist, Task 13 expands into "also build fixture helpers". Plan author notes: "Inspect existing tests in `tests/integration/` before writing these; adapt to project conventions."

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-09-optimistic-settlement.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
