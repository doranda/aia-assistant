# ILAS Dual-Agent Debate Rebalancer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two independent AI-driven portfolio rebalancers for ILAS — one for accumulation funds (106), one for distribution funds (36) — using the same Quant+News dual-agent debate architecture as MPF.

**Architecture:** Clone MPF's 4-call AI pipeline (Quant → News → Debate → Mediator) into `src/lib/ilas/rebalancer.ts`, parameterized by `portfolioType`. A weekly cron runs both debates sequentially. Each debate outputs a reference portfolio allocation that feeds into the existing ILAS portfolio tracking system (T+2 settlement, NAV tracking).

**Tech Stack:** Vercel AI Gateway (Claude Sonnet 4.6), Supabase Postgres, Next.js API routes

---

## File Structure

| File | Responsibility | New/Modify |
|------|---------------|------------|
| `src/lib/ilas/rebalancer.ts` | Core rebalancer: 4-call AI pipeline, danger detection, validation, parameterized by portfolioType | **Create** |
| `src/lib/ilas/constants.ts` | Add ILAS_FUND_CODE_TO_NAME, defensive fund lists, investment profiles, danger thresholds | **Modify** |
| `src/app/api/ilas/cron/weekly/route.ts` | Weekly cron: runs both acc + dis debates sequentially | **Create** |
| `vercel.json` | Add weekly cron schedule | **Modify** |

**Already built (no changes needed):**
- `src/lib/ilas/portfolio-tracker.ts` — T+2 settlement, submitIlasSwitch()
- `src/lib/ilas/types.ts` — IlasInsight, IlasRebalanceScore types
- `ilas_insights`, `ilas_rebalance_scores`, `ilas_portfolio_orders` tables (migration 010)
- `ilas_reference_portfolio` with portfolio_type column (migrations 010+013)
- `ilas_fund_metrics` table + metrics cron

**Shared with MPF (import, don't duplicate):**
- `callGateway()` from `src/lib/mpf/rebalancer.ts` — AI Gateway caller
- `parseJSON()` from `src/lib/mpf/rebalancer.ts` — JSON extractor
- `loadHKHolidays`, `isWorkingDay`, `addWorkingDays`, `getEffectiveDecisionDate` from `src/lib/mpf/portfolio-tracker.ts`
- `sendDiscordAlert`, `COLORS`, `sanitizeError` from `src/lib/discord.ts`
- `mpf_news` table — shared news (HK/Asia financial news applies to both MPF and ILAS)

---

### Task 1: ILAS Constants — Fund Names, Defensive Funds, Profiles

**Files:**
- Modify: `src/lib/ilas/constants.ts`

- [ ] **Step 1: Read the existing ILAS constants file**

Read `src/lib/ilas/constants.ts` to understand current exports.

- [ ] **Step 2: Query the DB to build ILAS_FUND_CODE_TO_NAME mapping**

```bash
echo "SELECT fund_code, name_en, category, is_distribution FROM ilas_funds WHERE is_active = true ORDER BY fund_code;" | npx supabase db query --linked
```

- [ ] **Step 3: Add rebalancer constants to ilas/constants.ts**

Add these exports (adapt fund codes from query results):

```typescript
// Fund code → full name mapping (for Discord alerts + debate logs)
export const ILAS_FUND_CODE_TO_NAME: Record<string, string> = {
  // Built from DB query results — all 142 funds
  "B01": "AB FCP I - Short Duration Bond Portfolio",
  // ... (populate from query)
};

// Defensive fund codes per portfolio type
export const ILAS_DEFENSIVE_FUNDS: Record<string, string[]> = {
  accumulation: [], // Low-risk fixed income + money market funds (populate from DB)
  distribution: [], // Low-risk distribution funds (populate from DB)
};

// Investment profile (same concept as MPF, adapted for ILAS)
export const ILAS_INVESTMENT_PROFILE = {
  label: "Balanced Growth (ILAS)",
  description: "Long-term wealth accumulation via insurance-linked funds",
};

// Rebalancer thresholds (same as MPF defaults)
export const ILAS_REBALANCER_CONFIG = {
  DAILY_CAP: 3,
  WEEKLY_LIMIT_DAYS: 7,
  PRICE_FRESHNESS_DAYS: 7,      // calendar days (≈5 biz days)
  METRICS_COVERAGE_PCT: 0.8,    // 80% of funds must have metrics
  DANGER_SORTINO_THRESHOLD: 0,  // Sortino < 0 = danger
  DANGER_DRAWDOWN_THRESHOLD: -20, // MaxDD < -20% = danger
  DANGER_MOMENTUM_THRESHOLD: -5,  // 3M momentum < -5% = danger
  EQUITY_CEILING_ON_DANGER: 40, // Max equity % when danger signals detected
  NUM_FUNDS_IN_PORTFOLIO: 3,    // Exactly 3 funds per portfolio
  WEIGHT_INCREMENT: 10,         // Weights in 10% increments
};

// Format allocation for Discord/logs
export function formatIlasAllocation(alloc: { code: string; weight: number }[]): string {
  return alloc
    .filter(a => a.weight > 0)
    .map(a => `${ILAS_FUND_CODE_TO_NAME[a.code] || a.code} ${a.weight}%`)
    .join(" / ");
}
```

- [ ] **Step 4: Identify defensive funds from DB**

```bash
echo "SELECT fund_code, name_en, risk_rating, category, is_distribution FROM ilas_funds WHERE risk_rating = 'Low' AND is_active = true ORDER BY is_distribution, fund_code;" | npx supabase db query --linked
```

Use these to populate `ILAS_DEFENSIVE_FUNDS.accumulation` and `.distribution`.

- [ ] **Step 5: Run tsc --noEmit**
- [ ] **Step 6: Commit**

```bash
git add src/lib/ilas/constants.ts
git commit -m "feat(ilas): add rebalancer constants — fund names, defensive funds, profiles"
```

---

### Task 2: ILAS Rebalancer Module — Core 4-Call Pipeline

**Files:**
- Create: `src/lib/ilas/rebalancer.ts`
- Reference: `src/lib/mpf/rebalancer.ts` (clone and adapt)

- [ ] **Step 1: Read MPF rebalancer completely**

Read `src/lib/mpf/rebalancer.ts` — every function, every prompt, every query.

- [ ] **Step 2: Create the ILAS rebalancer**

Create `src/lib/ilas/rebalancer.ts`. This is a clone of the MPF version with these changes:

**Imports — share from MPF, don't duplicate:**
```typescript
import { callGateway, parseJSON } from "@/lib/mpf/rebalancer";
import { loadHKHolidays, isWorkingDay } from "@/lib/mpf/portfolio-tracker";
import { submitIlasSwitch, canSubmitIlasSwitch, type IlasPortfolioType } from "./portfolio-tracker";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendDiscordAlert, COLORS, sanitizeError } from "@/lib/discord";
import { ILAS_FUND_CODE_TO_NAME, ILAS_DEFENSIVE_FUNDS, ILAS_REBALANCER_CONFIG, formatIlasAllocation, ILAS_INVESTMENT_PROFILE } from "./constants";
```

**Table name changes:**
- `mpf_insights` → `ilas_insights`
- `mpf_funds` → `ilas_funds`
- `mpf_prices` → `ilas_prices`
- `mpf_fund_metrics` → `ilas_fund_metrics`
- `mpf_reference_portfolio` → `ilas_reference_portfolio`
- `mpf_rebalance_scores` → `ilas_rebalance_scores`
- `mpf_news` → **KEEP AS `mpf_news`** (shared news table, HK/Asia news applies to both)

**Every query must filter by portfolioType:**
- `ilas_reference_portfolio`: `.eq("portfolio_type", portfolioType)`
- `ilas_insights`: add portfolioType check (tag in trigger field: `"debate_rebalance_accumulation"` or `"debate_rebalance_distribution"`)
- `ilas_funds`: `.eq("is_distribution", portfolioType === "distribution")`

**Main exported function:**
```typescript
export async function evaluateAndRebalanceIlas(
  portfolioType: IlasPortfolioType,
  highImpactCount: number
): Promise<IlasRebalanceResult>
```

**Prompt adaptations:**
- Replace "MPF" with "ILAS" in all system prompts
- Replace "AIA MPF Conservative Fund" references with ILAS defensive fund names
- Available funds list filtered by portfolioType (accumulation: 106 funds, distribution: 36 funds)
- Add portfolioType context: "You are managing the {accumulation/distribution} portfolio"

**Danger signal detection — same logic, same thresholds:**
```typescript
function detectIlasDangerSignals(metricsText: string): string {
  // Same logic as MPF: check Sortino, MaxDD, momentum across equity funds
  // Use ILAS_REBALANCER_CONFIG thresholds
}
```

**Validation — same rules:**
- Exactly 3 funds
- Weights in 10% increments
- Total = 100%
- All fund codes must exist in the filtered fund universe

**Discord alerts — prefix with ILAS + portfolio type:**
- "📊 ILAS Track — Accumulation Rebalance Submitted"
- "📊 ILAS Track — Distribution Rebalance Submitted"

- [ ] **Step 3: Ensure callGateway and parseJSON are exported from MPF rebalancer**

Check `src/lib/mpf/rebalancer.ts` — if `callGateway` and `parseJSON` are not exported, add `export` to them. These are pure utility functions safe to share.

- [ ] **Step 4: Run tsc --noEmit**
- [ ] **Step 5: Commit**

```bash
git add src/lib/ilas/rebalancer.ts src/lib/mpf/rebalancer.ts
git commit -m "feat(ilas): dual-agent debate rebalancer — Quant + News → Debate → Mediator"
```

---

### Task 3: Weekly Cron Route

**Files:**
- Create: `src/app/api/ilas/cron/weekly/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Read MPF weekly cron for pattern**

Read `src/app/api/mpf/cron/weekly/route.ts`.

- [ ] **Step 2: Create ILAS weekly cron**

```typescript
// src/app/api/ilas/cron/weekly/route.ts
// ILAS weekly rebalance debate — runs both accumulation + distribution debates

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateAndRebalanceIlas } from "@/lib/ilas/rebalancer";
import { sendDiscordAlert, sanitizeError, COLORS } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes — runs 2 debates (4 AI calls each)

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  try {
    // Check for high-impact news (shared mpf_news table)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: highImpactNews } = await supabase
      .from("mpf_news")
      .select("id")
      .eq("is_high_impact", true)
      .gte("published_at", twoDaysAgo);

    const highImpactCount = highImpactNews?.length || 0;

    // Run accumulation debate
    const accResult = await evaluateAndRebalanceIlas("accumulation", highImpactCount);

    // Run distribution debate
    const disResult = await evaluateAndRebalanceIlas("distribution", highImpactCount);

    // Log scraper run
    await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_weekly_debate",
      status: "success",
      records_processed: (accResult.rebalanced ? 1 : 0) + (disResult.rebalanced ? 1 : 0),
      duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      ok: true,
      accumulation: { rebalanced: accResult.rebalanced, reason: accResult.reason },
      distribution: { rebalanced: disResult.rebalanced, reason: disResult.reason },
      highImpactNews: highImpactCount,
      ms: Date.now() - startTime,
    });
  } catch (error) {
    await supabase.from("scraper_runs").insert({
      scraper_name: "ilas_weekly_debate",
      status: "failed",
      error_message: error instanceof Error ? error.message : "Unknown error",
      duration_ms: Date.now() - startTime,
    });

    await sendDiscordAlert({
      title: "❌ ILAS Track — Weekly Debate Failed",
      description: `**Error:** ${sanitizeError(error)}\n**Duration:** ${Date.now() - startTime}ms`,
      color: COLORS.red,
    });

    return NextResponse.json({ error: "Weekly debate failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Add cron to vercel.json**

Add to crons array:
```json
{ "path": "/api/ilas/cron/weekly", "schedule": "0 14 * * 0" }
```

Schedule: Sundays at 14:00 UTC (same day as MPF weekly at 15:00 UTC, but earlier so both don't overlap on AI Gateway).

- [ ] **Step 4: Run tsc --noEmit**
- [ ] **Step 5: Commit**

```bash
git add src/app/api/ilas/cron/weekly/route.ts vercel.json
git commit -m "feat(ilas): weekly debate cron — runs accumulation + distribution debates"
```

---

### Task 4: First Run — Trigger Debates + Set Initial Allocations

- [ ] **Step 1: Deploy to production**

```bash
rm -rf .next .vercel/output && vercel build --prod && vercel deploy --prebuilt --prod
git push origin main
```

- [ ] **Step 2: Trigger the weekly debate manually**

```bash
CRON_SECRET=$(grep "^CRON_SECRET" .env.local | cut -d'"' -f2)
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://aia-assistant.vercel.app/api/ilas/cron/weekly"
```

Expected: Both debates run, each produces a 3-fund allocation, allocations are submitted as switches, reference portfolios are populated.

- [ ] **Step 3: Verify allocations were set**

```bash
echo "SELECT rp.portfolio_type, f.fund_code, f.name_en, rp.weight FROM ilas_reference_portfolio rp JOIN ilas_funds f ON f.id = rp.fund_id ORDER BY rp.portfolio_type, rp.weight DESC;" | npx supabase db query --linked
```

- [ ] **Step 4: Verify insights were created**

```bash
echo "SELECT id, type, trigger, status, created_at FROM ilas_insights ORDER BY created_at DESC LIMIT 5;" | npx supabase db query --linked
```

- [ ] **Step 5: Check Discord for alerts**

Verify Discord received the rebalance submission alerts with full allocation details.

---

### Task 5: Pre-Build Gate + Final Verification

- [ ] **Step 1: Run pre-build gate (LARGE — 10+ files)**

```
1. tsc --noEmit → MUST PASS
2. Full 7-agent app-audit (focus on new ILAS rebalancer)
3. Null/empty/error path review
4. Verify on live URL
```

- [ ] **Step 2: Verify the full chain works**

```
Debate → Allocation → Reference Portfolio → Daily NAV Cron (Monday) → Track Record Dashboard
```

Check ILAS Track page — should now show:
- Track Record section (NAV 100 base + first day)
- Reference Portfolio section (funds from debate consensus)

- [ ] **Step 3: Commit verification report**

```bash
git add docs/verify/
git commit -m "verify: ILAS dual rebalancer — first debate complete, allocations set"
```
