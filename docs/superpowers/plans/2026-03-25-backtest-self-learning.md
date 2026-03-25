# Backtester + Self-Learning Discipline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dual-track backtesting and self-learning feedback loop so the debate rebalancer can be validated against history and improve from its own track record.

**Architecture:** Budget-limited backtester replays the debate pipeline against 2018-2025 data in 20-call sessions. Independent scorer agent evaluates reasoning quality (not just outcomes) at 7/30/90d intervals. Scorecards feed back into the Debate + Mediator prompts. Win rate dashboard on MPF Care page.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres), AI Gateway (Claude Sonnet 4.6), Brave Search MCP (for Track 2 historical news), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-25-backtest-self-learning-design.md`

---

## Task 1: Database Migration + Types

**Files:**
- Modify: `src/lib/mpf/types.ts`

- [ ] **Step 1: Add new types to types.ts**

Add after the `FundMetrics` interface in `src/lib/mpf/types.ts`:

```typescript
export type BacktestTrack = "quant_only" | "quant_news";
export type BacktestStatus = "in_progress" | "completed" | "paused";
export type ReasoningQuality = "sound" | "lucky" | "wrong" | "inconclusive";
export type ScorePeriod = "7d" | "30d" | "90d";

export interface BacktestRun {
  id: string;
  track: BacktestTrack;
  cursor_date: string;
  start_date: string;
  end_date: string;
  status: BacktestStatus;
  total_weeks_processed: number;
  budget_limit: number;
  budget_used_this_session: number;
  cumulative_return_pct: number;
  created_at: string;
  updated_at: string;
}

export interface BacktestResult {
  id: string;
  run_id: string;
  sim_date: string;
  allocation: { code: string; weight: number }[];
  debate_log: string | null;
  confidence: "full" | "degraded";
  weekly_return_pct: number | null;
  cumulative_return_pct: number | null;
  rebalance_triggered: boolean;
  created_at: string;
}

export interface RebalanceScore {
  id: string;
  insight_id: string | null;
  backtest_result_id: string | null;
  score_period: ScorePeriod;
  claims: { claim: string; outcome: "correct" | "incorrect" | "inconclusive"; evidence: string }[];
  win_rate: number | null;
  reasoning_quality: ReasoningQuality;
  lessons: string[];
  actual_return_pct: number | null;
  baseline_return_pct: number | null;
  scored_at: string;
}
```

- [ ] **Step 2: Create database tables**

Run via `supabase db query --linked`:

```sql
-- Backtest run tracking (one per track)
CREATE TABLE IF NOT EXISTS mpf_backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track text NOT NULL CHECK (track IN ('quant_only', 'quant_news')),
  cursor_date date NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'paused')),
  total_weeks_processed int NOT NULL DEFAULT 0,
  budget_limit int NOT NULL DEFAULT 20,
  budget_used_this_session int NOT NULL DEFAULT 0,
  cumulative_return_pct numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backtest results (one per simulated week per run)
CREATE TABLE IF NOT EXISTS mpf_backtest_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES mpf_backtest_runs(id),
  sim_date date NOT NULL,
  allocation jsonb NOT NULL,
  debate_log text,
  confidence text NOT NULL DEFAULT 'full',
  weekly_return_pct numeric,
  cumulative_return_pct numeric,
  rebalance_triggered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sim_date)
);

-- Rebalance scores (live + backtest)
CREATE TABLE IF NOT EXISTS mpf_rebalance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id uuid REFERENCES mpf_insights(id),
  backtest_result_id uuid REFERENCES mpf_backtest_results(id),
  score_period text NOT NULL CHECK (score_period IN ('7d', '30d', '90d')),
  claims jsonb,
  win_rate numeric,
  reasoning_quality text CHECK (reasoning_quality IN ('sound', 'lucky', 'wrong', 'inconclusive')),
  lessons text[],
  actual_return_pct numeric,
  baseline_return_pct numeric,
  scored_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (insight_id IS NOT NULL AND backtest_result_id IS NULL) OR
    (insight_id IS NULL AND backtest_result_id IS NOT NULL)
  )
);

CREATE INDEX idx_rebalance_scores_feedback ON mpf_rebalance_scores (insight_id, scored_at DESC);
CREATE INDEX idx_backtest_results_run ON mpf_backtest_results (run_id, sim_date);

-- RLS: admin-only, deny all client access (createAdminClient bypasses RLS)
ALTER TABLE mpf_backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_backtest_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpf_rebalance_scores ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/mpf/types.ts
git commit -m "feat(mpf-care): add backtest + scoring types and database tables"
```

---

## Task 2: Independent Scorer Agent

**Files:**
- Create: `src/lib/mpf/scorer.ts`

- [ ] **Step 1: Create scorer.ts**

Create `src/lib/mpf/scorer.ts`:

```typescript
// src/lib/mpf/scorer.ts — Independent scorer agent
// Evaluates reasoning quality of rebalance decisions, not just outcomes.
// Called by the scoring cron, NOT by the debate pipeline.

import { createAdminClient } from "@/lib/supabase/admin";

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MODEL = "anthropic/claude-sonnet-4.6";

interface ScoreInput {
  debateLog: string;
  allocation: { code: string; weight: number }[];
  actualReturns: Record<string, number>; // fund_code → return % over period
  portfolioReturn: number; // weighted portfolio return %
  baselineReturn: number; // "do nothing" return %
  period: string; // "7d" | "30d" | "90d"
}

interface ScorerOutput {
  claims: { claim: string; outcome: "correct" | "incorrect" | "inconclusive"; evidence: string }[];
  win_rate: number;
  reasoning_quality: "sound" | "lucky" | "wrong" | "inconclusive";
  lessons: string[];
}

/**
 * Run the independent scorer agent on a rebalance decision.
 * Extracts testable claims from the debate log, scores them against actual data.
 */
export async function scoreDecision(input: ScoreInput): Promise<ScorerOutput | null> {
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return null;

  const returnsText = Object.entries(input.actualReturns)
    .sort((a, b) => b[1] - a[1])
    .map(([code, ret]) => `${code}: ${ret > 0 ? "+" : ""}${ret.toFixed(2)}%`)
    .join("\n");

  const allocationText = input.allocation
    .map(a => `${a.code}: ${a.weight}%`)
    .join(", ");

  const delta = input.portfolioReturn - input.baselineReturn;
  const deltaText = `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%`;

  const systemPrompt = `You are an independent auditor scoring a pension fund's AI rebalancing decision. You must be OBJECTIVE — not generous, not harsh. You are evaluating the REASONING, not just the outcome.

A portfolio can go up because the whole market went up — that's LUCKY, not SOUND.
A portfolio can go down because of an unpredictable event — that might still be SOUND reasoning.

Score each identifiable claim in the debate log against actual data.

Return ONLY valid JSON:
{
  "claims": [
    { "claim": "what the debate implied would happen", "outcome": "correct|incorrect|inconclusive", "evidence": "actual data that supports/refutes the claim" }
  ],
  "win_rate": 0.67,
  "reasoning_quality": "sound|lucky|wrong|inconclusive",
  "lessons": ["what the model should learn from this outcome"]
}`;

  const userContent = `PERIOD: ${input.period} after the rebalance decision

DEBATE LOG (the reasoning behind the decision):
${input.debateLog}

ALLOCATION CHOSEN: ${allocationText}

ACTUAL FUND RETURNS (${input.period} after decision):
${returnsText}

PORTFOLIO RETURN: ${input.portfolioReturn > 0 ? "+" : ""}${input.portfolioReturn.toFixed(2)}%
BASELINE (hold previous): ${input.baselineReturn > 0 ? "+" : ""}${input.baselineReturn.toFixed(2)}%
DELTA vs BASELINE: ${deltaText}

Analyze the debate reasoning against what actually happened. Extract every testable claim, score it, then assess overall reasoning quality.`;

  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    return JSON.parse(match[0]) as ScorerOutput;
  } catch {
    return null;
  }
}

/**
 * Compute portfolio return over a period given allocation and fund prices.
 * Returns weighted return percentage.
 */
export function computePortfolioReturn(
  allocation: { code: string; weight: number }[],
  fundReturns: Record<string, number>
): number {
  let totalReturn = 0;
  for (const a of allocation) {
    const fundReturn = fundReturns[a.code] || 0;
    totalReturn += fundReturn * (a.weight / 100);
  }
  return totalReturn;
}

/**
 * Get fund returns over a period from price data.
 * Returns map of fund_code → return percentage.
 */
export async function getFundReturnsForPeriod(
  startDate: string,
  endDate: string
): Promise<Record<string, number>> {
  const supabase = createAdminClient();

  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("id, fund_code")
    .eq("is_active", true);

  const returns: Record<string, number> = {};

  for (const fund of funds || []) {
    const { data: startPrice } = await supabase
      .from("mpf_prices")
      .select("nav")
      .eq("fund_id", fund.id)
      .lte("date", startDate)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const { data: endPrice } = await supabase
      .from("mpf_prices")
      .select("nav")
      .eq("fund_id", fund.id)
      .lte("date", endDate)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (startPrice && endPrice && startPrice.nav > 0) {
      returns[fund.fund_code] = ((endPrice.nav - startPrice.nav) / startPrice.nav) * 100;
    }
  }

  return returns;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/scorer.ts
git commit -m "feat(mpf-care): add independent scorer agent — extracts claims, scores reasoning quality"
```

---

## Task 3: Refactor Rebalancer — Extract Quant Agent + Add Feedback Injection

**Files:**
- Modify: `src/lib/mpf/rebalancer.ts`

- [ ] **Step 1: Export `callGateway`, `parseJSON`, `PortfolioProposal`, and shared constraints builder**

At the top of `src/lib/mpf/rebalancer.ts`, make these exports so the backtester can reuse them:

Change `async function callGateway` to `export async function callGateway`
Change `function parseJSON` to `export function parseJSON`
Change `interface PortfolioProposal` to `export interface PortfolioProposal`

Add a new exported function after `parseJSON`:

```typescript
/**
 * Build the shared constraints text for debate prompts.
 * Exported for reuse by the backtester.
 */
export function buildSharedConstraints(availableFunds: string): string {
  return `
STRICT RULES:
1. Output exactly 3 funds. Duplicates allowed (e.g., all 3 can be the same fund for 100% concentration).
2. Weights: 0-100% in 10% increments. Total MUST = 100%.
3. Prioritize: (1) capital preservation, (2) long-term compounding. Never chase short-term returns.
4. 100% equity is valid. 100% cash (AIA-CON) is valid. No allocation limits.
Available funds: ${availableFunds}

Return ONLY valid JSON (no markdown):
{ "funds": [{ "code": "AIA-XXX", "weight": 50, "reasoning": "why" }, ...], "summary": "1-2 sentence summary" }`;
}
```

- [ ] **Step 2: Extract `runQuantAgentOnly` function**

Add a new exported function before `evaluateAndRebalance`:

```typescript
/**
 * Run only the Quant Agent — used by backtester Track 1 and the full debate pipeline.
 * Returns a PortfolioProposal based purely on metrics.
 */
export async function runQuantAgentOnly(
  metricsText: string,
  currentPortfolioText: string,
  profileText: string,
  sharedConstraints: string
): Promise<PortfolioProposal | null> {
  const raw = await callGateway(
    "You are a quantitative analyst for an MPF pension fund. Propose a 3-fund portfolio based PURELY on the metrics below. Ignore news — focus only on the numbers.",
    `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nFUND METRICS (3Y):\n${metricsText}\n\n${sharedConstraints}`
  );
  return parseJSON<PortfolioProposal>(raw);
}
```

Then update the `evaluateAndRebalance` function's Step 1 to use it:

Replace the existing `Promise.all` block (around line 250-260) — change the quant call to use `runQuantAgentOnly`:

```typescript
  // ===== STEP 1: Parallel proposals =====
  const [quantProposal, newsRaw] = await Promise.all([
    runQuantAgentOnly(metricsText, currentPortfolioText, profileText, sharedConstraints),
    callGateway(
      "You are a market analyst for an MPF pension fund. Propose a 3-fund portfolio based on current market conditions and recent news sentiment. Ignore quantitative metrics — focus on macro trends and risk events.",
      `${profileText}\n\nCURRENT PORTFOLIO:\n${currentPortfolioText}\n\nRECENT NEWS (48h):\n${newsText || "No recent news"}\n\n${sharedConstraints}`
    ),
  ]);

  const newsProposal = parseJSON<PortfolioProposal>(newsRaw);

  if (!quantProposal || !newsProposal) {
    return { rebalanced: false, reason: "Failed to parse agent proposals" };
  }
```

- [ ] **Step 3: Add feedback injection to Debate + Mediator prompts**

After the news query section and before Step 1, add:

```typescript
  // ===== FEEDBACK INJECTION — last 5 scored decisions for Debate + Mediator =====
  let trackRecordBlock = "";
  const { data: recentScores } = await supabase
    .from("mpf_rebalance_scores")
    .select("reasoning_quality, win_rate, lessons, actual_return_pct, baseline_return_pct, scored_at")
    .not("insight_id", "is", null)
    .order("scored_at", { ascending: false })
    .limit(5);

  if (recentScores && recentScores.length > 0) {
    const overallWinRate = recentScores.filter(s =>
      s.reasoning_quality === "sound" || s.reasoning_quality === "lucky"
    ).length / recentScores.length;

    trackRecordBlock = `\n\nTRACK RECORD (last ${recentScores.length} scored decisions):\n` +
      recentScores.map(s => {
        const delta = (s.actual_return_pct || 0) - (s.baseline_return_pct || 0);
        return `- ${new Date(s.scored_at).toISOString().split("T")[0]}: ${(s.reasoning_quality || "unknown").toUpperCase()} (${delta > 0 ? "+" : ""}${delta.toFixed(1)}% vs baseline)\n  Lesson: "${(s.lessons || [])[0] || "No lesson"}"`;
      }).join("\n") +
      `\n\nOverall win rate: ${(overallWinRate * 100).toFixed(0)}%`;
  }
```

Then append `trackRecordBlock` to the Debate (Step 2) and Mediator (Step 3) system prompts only. Add it at the end of each system prompt string.

For the Debate call, change the system prompt to:
```typescript
    "You are a senior portfolio analyst reviewing two independent proposals..." + trackRecordBlock,
```

For the Mediator call, change the system prompt to:
```typescript
    `You are the chief investment officer...` + trackRecordBlock,
```

Do NOT add `trackRecordBlock` to the Quant Agent or News Agent prompts.

- [ ] **Step 4: Also export the `sharedConstraints` variable builder inline**

Replace the existing `const sharedConstraints = ...` block with:
```typescript
  const sharedConstraints = buildSharedConstraints(availableFunds);
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/mpf/rebalancer.ts
git commit -m "feat(mpf-care): refactor rebalancer — export quant agent, add feedback injection to debate+mediator"
```

---

## Task 4: Backtester Engine

**Files:**
- Create: `src/lib/mpf/backtester.ts`

- [ ] **Step 1: Create backtester.ts**

Create `src/lib/mpf/backtester.ts`. This is the core simulation engine. It:
1. Pre-loads all prices into memory
2. Iterates week by week from cursor
3. Computes point-in-time metrics
4. Runs the appropriate debate pipeline (quant-only for Track 1, full for Track 2)
5. Records results and advances cursor
6. Respects budget limits

The file should:
- Import `computeAllMetrics` from `./metrics` (NOT `slicePricesForPeriod` — see note below)
- Import `runQuantAgentOnly`, `callGateway`, `parseJSON`, `buildSharedConstraints`, `PortfolioProposal` from `./rebalancer`
- Import `INVESTMENT_PROFILE`, `AIA_FUNDS` from `./constants`
- Import `createAdminClient` from `@/lib/supabase/admin`
- Import `BacktestRun`, `BacktestResult` from `./types`

**CRITICAL IMPLEMENTATION NOTES (from spec review):**

1. **Point-in-time slicing:** `slicePricesForPeriod` from metrics.ts slices by period enum (1y/3y/5y), NOT by date. The backtester needs a NEW helper `slicePricesUpToDate(allPrices, simDate)` that filters out future data first, THEN passes the result to `computeAllMetrics()` for the metric window. Add this helper to backtester.ts (not metrics.ts — it's backtest-specific).

2. **Initial allocation:** Start with equal-weight across the 3 lowest-fee equity funds as the initial portfolio. This is the "naive baseline" from the quant research.

3. **Rebalance trigger for backtest:** Do NOT check `mpf_insights` table (that's for live rate limiting). Instead, trigger rebalance every 4 simulated weeks (monthly) OR when any fund's metrics change by >10% from the previous computation. This is simpler and appropriate for historical simulation.

4. **Carry-forward:** When no rebalance fires, carry the previous week's allocation forward unchanged. Weekly return is still computed (the portfolio still has returns even without rebalancing).

5. **Cumulative returns:** Use multiplicative compounding: `cumReturn = (1 + cumReturn) * (1 + weeklyReturn) - 1`

6. **Budget interleaving strategy:** Alternate between tracks: Track 1 week, Track 2 week, Track 1 week, etc. Track 1 costs 1 call (quant only), Track 2 costs 4 calls (full debate). Total budget of 20 means roughly: 4 Track 1 weeks + 4 Track 2 weeks = 4 + 16 = 20 calls. Both tracks advance roughly in sync.

7. **Fund list for backtest:** Use `AIA_FUNDS` constant for the available funds list text (avoid querying Supabase for fund metadata that doesn't change). Price data comes from the pre-loaded in-memory array.

8. **Track 2 historical news:** Use Brave Search API directly (not MCP — serverless can't use MCP). Query format: `"Hong Kong stock market [month year]"`, `"Asia economy [month year]"`, `"Federal Reserve rates [month year]"`. Parse search result descriptions as the "news context." Tag all Track 2 results `confidence: "degraded"`.

Key functions to implement:

```typescript
// Helper: slice all prices up to a simulation date (point-in-time)
function slicePricesUpToDate(
  allPrices: Map<string, { date: string; nav: number }[]>,
  simDate: string
): Map<string, { date: string; nav: number }[]>

// Initialize or resume backtest runs
export async function initBacktestRuns(startDate: string, endDate: string): Promise<void>

// Main entry: process up to budgetLimit calls across both tracks
export async function runBacktestSession(budgetLimit?: number): Promise<BacktestSessionResult>

// Simulate one week for one track
async function simulateWeek(
  run: BacktestRun,
  allPrices: Map<string, { date: string; nav: number }[]>,
  previousAllocation: { code: string; weight: number }[],
  weeksSinceLastRebalance: number
): Promise<{ allocation: { code: string; weight: number }[]; rebalanced: boolean; debateLog: string; budgetCost: number }>

// Compute actual weekly return from price data
function computeWeeklyReturn(
  allocation: { code: string; weight: number }[],
  allPrices: Map<string, { date: string; nav: number }[]>,
  weekStart: string,
  weekEnd: string
): number

// Fetch historical news for Track 2 via Brave Search API
async function fetchHistoricalNews(simDate: string): Promise<string>
```

Return type:
```typescript
export interface BacktestSessionResult {
  track1_cursor: string;
  track2_cursor: string;
  weeks_processed: number;
  budget_used: number;
  budget_remaining: number;
  track1_cumulative_return: number;
  track2_cumulative_return: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/backtester.ts
git commit -m "feat(mpf-care): add backtester engine — dual-track simulation with budget limits"
```

---

## Task 5: Backtest API Route

**Files:**
- Create: `src/app/api/mpf/backtest/route.ts`

- [ ] **Step 1: Create backtest route**

Create `src/app/api/mpf/backtest/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { runBacktestSession, initBacktestRuns } from "@/lib/mpf/backtester";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    // Initialize runs if first time (start from 2018-01-01)
    await initBacktestRuns("2018-01-01", "2025-12-31");

    // Run session with default budget
    const result = await runBacktestSession();

    return NextResponse.json({
      ok: true,
      ...result,
      ms: Date.now() - startTime,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown",
      ms: Date.now() - startTime,
    }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/mpf/backtest/route.ts
git commit -m "feat(mpf-care): add backtest API route — manual trigger with budget limit"
```

---

## Task 6: Scoring Cron

**Files:**
- Create: `src/app/api/mpf/cron/scoring/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create scoring cron route**

Create `src/app/api/mpf/cron/scoring/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scoreDecision, getFundReturnsForPeriod, computePortfolioReturn } from "@/lib/mpf/scorer";
import { sendDiscordAlert, COLORS } from "@/lib/discord";
import type { ScorePeriod } from "@/lib/mpf/types";

export const maxDuration = 120;

const PERIOD_DAYS: Record<ScorePeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };
const MAX_SCORES_PER_RUN = 10;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();
  let scored = 0;

  try {
    // Find unscored live decisions (prioritized)
    const { data: unscoredLive } = await supabase
      .from("mpf_insights")
      .select("id, content_en, created_at, type")
      .eq("type", "rebalance_debate")
      .eq("status", "completed")
      .order("created_at", { ascending: true });

    // Find unscored backtest results
    const { data: unscoredBacktest } = await supabase
      .from("mpf_backtest_results")
      .select("id, debate_log, allocation, sim_date, rebalance_triggered")
      .eq("rebalance_triggered", true)
      .order("sim_date", { ascending: true })
      .limit(50);

    // Determine which need scoring
    const toScore: { type: "live" | "backtest"; id: string; debateLog: string; allocation: any; decisionDate: string }[] = [];

    for (const insight of unscoredLive || []) {
      // Check which periods are unscored
      for (const period of ["7d", "30d", "90d"] as ScorePeriod[]) {
        const daysSince = (Date.now() - new Date(insight.created_at).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < PERIOD_DAYS[period]) continue;

        const { data: existing } = await supabase
          .from("mpf_rebalance_scores")
          .select("id")
          .eq("insight_id", insight.id)
          .eq("score_period", period)
          .single();

        if (!existing) {
          // Extract allocation from debate log (format: "- AIA-XXX: 50% — reasoning")
          const allocMatch = insight.content_en?.match(/AIA-\w+:\s*\d+%/g);
          const allocation = allocMatch?.map(m => {
            const [code, weight] = m.split(/:\s*/);
            return { code: code.trim(), weight: parseInt(weight) };
          }) || [];

          toScore.push({
            type: "live",
            id: insight.id,
            debateLog: insight.content_en || "",
            allocation,
            decisionDate: insight.created_at,
          });
          break; // Score earliest eligible period first
        }
      }
    }

    // Add backtest results (lower priority)
    for (const result of unscoredBacktest || []) {
      if (toScore.length >= MAX_SCORES_PER_RUN) break;

      const { data: existing } = await supabase
        .from("mpf_rebalance_scores")
        .select("id")
        .eq("backtest_result_id", result.id)
        .limit(1)
        .single();

      if (!existing) {
        toScore.push({
          type: "backtest",
          id: result.id,
          debateLog: result.debate_log || "",
          allocation: result.allocation || [],
          decisionDate: result.sim_date,
        });
      }
    }

    // Score up to MAX_SCORES_PER_RUN
    for (const item of toScore.slice(0, MAX_SCORES_PER_RUN)) {
      // Determine scoring period
      const period: ScorePeriod = item.type === "backtest" ? "30d" : "7d"; // Backtest scores at 30d, live starts at 7d
      const days = PERIOD_DAYS[period];

      const decisionDate = new Date(item.decisionDate).toISOString().split("T")[0];
      const endDate = new Date(new Date(item.decisionDate).getTime() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      // Get actual fund returns for the period
      const fundReturns = await getFundReturnsForPeriod(decisionDate, endDate);
      const portfolioReturn = computePortfolioReturn(item.allocation, fundReturns);

      // Baseline: "do nothing" — get the PREVIOUS allocation before this rebalance
      let baselineReturn = 0;
      if (item.type === "live") {
        // Find the previous rebalance decision to get the old allocation
        const { data: prevInsight } = await supabase
          .from("mpf_insights")
          .select("content_en")
          .or("type.eq.alert,type.eq.rebalance_debate")
          .lt("created_at", item.decisionDate)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (prevInsight?.content_en) {
          const prevAllocMatch = prevInsight.content_en.match(/AIA-\w+:\s*\d+%/g);
          const prevAllocation = prevAllocMatch?.map(m => {
            const [code, weight] = m.split(/:\s*/);
            return { code: code.trim(), weight: parseInt(weight) };
          }) || [];
          if (prevAllocation.length > 0) {
            baselineReturn = computePortfolioReturn(prevAllocation, fundReturns);
          }
        }
      }
      // For backtest: baseline is the previous week's allocation (stored in previous result)
      if (baselineReturn === 0) {
        // Fallback: equal-weight average of all fund returns
        const vals = Object.values(fundReturns);
        baselineReturn = vals.length > 0 ? vals.reduce((s, r) => s + r, 0) / vals.length : 0;
      }

      const scoreResult = await scoreDecision({
        debateLog: item.debateLog,
        allocation: item.allocation,
        actualReturns: fundReturns,
        portfolioReturn,
        baselineReturn,
        period,
      });

      if (scoreResult) {
        await supabase.from("mpf_rebalance_scores").insert({
          insight_id: item.type === "live" ? item.id : null,
          backtest_result_id: item.type === "backtest" ? item.id : null,
          score_period: period,
          claims: scoreResult.claims,
          win_rate: scoreResult.win_rate,
          reasoning_quality: scoreResult.reasoning_quality,
          lessons: scoreResult.lessons,
          actual_return_pct: portfolioReturn,
          baseline_return_pct: baselineReturn,
        });
        scored++;
      }
    }

    // Discord summary
    if (scored > 0) {
      await sendDiscordAlert({
        title: "📊 MPF Care — Scoring Complete",
        description: `Scored **${scored}** rebalance decisions (${toScore.filter(t => t.type === "live").length} live, ${toScore.filter(t => t.type === "backtest").length} backtest)`,
        color: COLORS.blue,
      });
    }

    return NextResponse.json({ ok: true, scored, ms: Date.now() - startTime });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown", ms: Date.now() - startTime }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add scoring cron to vercel.json**

Add to the `crons` array:
```json
{
  "path": "/api/mpf/cron/scoring",
  "schedule": "0 16 * * 0"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mpf/cron/scoring/route.ts vercel.json
git commit -m "feat(mpf-care): add weekly scoring cron — scores live + backtest decisions"
```

---

## Task 7: Model Performance Dashboard Component

**Files:**
- Create: `src/components/mpf/model-performance.tsx`

- [ ] **Step 1: Create model-performance.tsx**

Server component that queries `mpf_rebalance_scores` and displays:
- Rolling win rate (last 20 scored, big number)
- Since date (first scored decision)
- Total decisions scored
- Current streak (consecutive correct/incorrect)
- Expandable: last 10 scored decisions timeline + lessons learned

Key details:
- Win rate color: green >60%, amber 40-60%, red <40%
- Each timeline entry: date, reasoning_quality badge, actual vs baseline delta
- "Lessons learned": last 3 unique lessons from scorecards
- Empty state: "No scored decisions yet. The scoring cron runs weekly."
- Use same zinc/mono dark styling as all other MPF Care components

Props: `{ scores: RebalanceScore[] }` — fetched by the parent page.

- [ ] **Step 2: Commit**

```bash
git add src/components/mpf/model-performance.tsx
git commit -m "feat(mpf-care): add model performance dashboard component — win rate, streak, lessons"
```

---

## Task 8: Dashboard Integration

**Files:**
- Modify: `src/app/(app)/mpf-care/page.tsx`

- [ ] **Step 1: Add ModelPerformance to dashboard**

In `src/app/(app)/mpf-care/page.tsx`:

1. Add import:
```typescript
import { ModelPerformance } from "@/components/mpf/model-performance";
```

2. In `getOverviewData()`, after the `latestDebate` query, add:
```typescript
  // Get recent scores for model performance — use admin client (RLS blocks regular client)
  const adminClient = createAdminClient();
  const { data: recentScores } = await adminClient
    .from("mpf_rebalance_scores")
    .select("*")
    .not("insight_id", "is", null)
    .order("scored_at", { ascending: false })
    .limit(20);
```

Also add the import at the top of the file:
```typescript
import { createAdminClient } from "@/lib/supabase/admin";
```

3. Add `recentScores` to the return object.

4. In the JSX, after the DebateLog section and before the Top Movers section, add:
```tsx
      {/* Model Performance — win rate and track record */}
      <div className="mt-8">
        <ModelPerformance scores={recentScores || []} />
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/mpf-care/page.tsx
git commit -m "feat(mpf-care): integrate model performance dashboard"
```

---

## Task 9: Deploy + First Backtest Run

**Files:** None (deployment + testing)

- [ ] **Step 1: Build and check for errors**

```bash
cd /Users/kingyuenjonathanlee/Documents/ClaudeWorkSpace/02_Product/aia-assistant
npm run build 2>&1 | head -50
```

- [ ] **Step 2: Deploy to production**

```bash
vercel build --prod && vercel deploy --prebuilt --prod
```

- [ ] **Step 3: Run first backtest session**

```bash
curl -s --max-time 180 -H "Authorization: Bearer $CRON_SECRET" https://aia-assistant.vercel.app/api/mpf/backtest
```

Expected: JSON with `track1_cursor`, `track2_cursor`, `weeks_processed`, budget info.

- [ ] **Step 4: Run scoring cron (may score first debate from earlier today)**

```bash
curl -s --max-time 180 -H "Authorization: Bearer $CRON_SECRET" https://aia-assistant.vercel.app/api/mpf/cron/scoring
```

- [ ] **Step 5: Verify dashboard shows model performance section**

Open https://aia-assistant.vercel.app/mpf-care — should show "Model Performance" card (may be empty if no scores yet).

- [ ] **Step 6: Commit any fixes**

```bash
git add -A && git commit -m "fix(mpf-care): post-deploy fixes for backtest + self-learning"
```
