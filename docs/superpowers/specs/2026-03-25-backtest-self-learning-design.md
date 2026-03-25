# MPF Care: Backtester + Self-Learning Discipline

**Date:** 2026-03-25
**Status:** Design approved, pending implementation
**Author:** Jonathan Lee + Claude
**Branch:** feat/mpf-care
**Depends on:** Quant Metrics Engine + Dual-Agent Debate Rebalancer (shipped same day)

---

## Overview

Add a dual-track backtester and self-learning feedback loop to MPF Care. The backtester replays the debate rebalancer against historical data (2018-2025) in budget-limited sessions. An independent scorer agent evaluates each decision's reasoning quality — not just outcomes — and feeds learnings back into future debates. A win rate dashboard gives the team real-time confidence in the model.

**Target user:** AIA team (internal decision-support tool).

**Core principle:** Test the reasoning, not just the results. A portfolio can go up because the whole market went up — that tells you nothing about whether the debate was smart.

---

## 1. Dual-Track Backtester

### Architecture

Two parallel simulation tracks running over the same historical period:

**Track 1 — Quant Only:** For each simulated week, compute fund metrics from historical NAV data up to that date. Run only the Quant Agent (no news). Produce allocation decision + reasoning.

**Track 2 — Quant + Reconstructed News:** Same as Track 1 but add historical news fetched via Brave Search MCP for that simulated week. All results tagged `confidence: "degraded"` due to look-ahead bias (search results today are colored by hindsight).

**Why dual-track:** Comparing the two tracks reveals whether news adds signal or noise:
- If they agree most of the time → news adds noise, not signal
- If news track massively outperforms → look-ahead bias, don't trust it
- If news track slightly underperforms but avoids worst drawdowns → news is doing its real job (risk mitigation)

### Budget-Limited Chunking

Backtesting runs in sessions, not continuously. Each session spends up to **20 debate calls** (10 per track). Quiet weeks where no rebalance threshold is crossed are skipped quickly (no LLM call). Volatile weeks consume budget. Progress is tracked via a cursor.

**Why budget-based (not time-based):** Adapts to the data. Quiet markets get processed fast, volatile periods get the attention they deserve. Time-based chunking treats every quarter equally, which is lazy.

### Simulation Loop (per track, per week)

1. Slice `mpf_prices` up to simulation date (exclude future data)
2. Compute metrics for that point in time using existing `computeAllMetrics()`
3. (Track 2 only) Fetch historical news via Brave Search: `"Hong Kong stock market [month] [year]"` + regional queries
4. Run debate pipeline (full 4-call for Track 2, quant-agent-only for Track 1)
5. Record allocation decision, reasoning, and any predictions
6. Compute weekly return based on actual prices in the following week
7. Update cumulative return
8. Advance cursor by 1 week

### Rebalance Trigger Logic (same as live)

Not every simulated week triggers a rebalance. The backtester applies the same rules as live:
- Max 1 rebalance/week for normal conditions
- Rebalance only if metrics drift exceeds threshold OR (Track 2) high-impact news detected
- Skip weeks where no trigger fires (free — no LLM call)

### Data Preparation

The backtester **pre-loads all `mpf_prices` into memory once at session start** — a single query sorted by fund_id and date. This avoids hundreds of per-week per-fund Supabase queries. The in-memory dataset is sliced per-fund per-week using array indexing. With ~140K price records, this fits comfortably in a serverless function's memory (~20MB).

`computeAllMetrics()` is called on the fly with the pre-sliced data for each simulated week. The stored `mpf_fund_metrics` table is NOT used — it contains metrics as of today, not as of the simulation date.

### Quant-Only Extraction

The implementation must refactor `rebalancer.ts` to export a `runQuantAgentOnly(metricsText, currentPortfolio, profile)` function. This function runs only Step 1a (Quant Agent call) and returns a `PortfolioProposal`. Both the backtester (Track 1) and the full debate pipeline reuse this function. No code duplication.

### Invocation

**NOT a cron.** Manual trigger via API route. Called when Jonathan says "continue backtest" or at session start. Returns progress summary:
```json
{
  "track1_cursor": "2023-06-15",
  "track2_cursor": "2023-06-15",
  "weeks_processed_this_session": 14,
  "budget_remaining": 6,
  "track1_cumulative_return": 12.3,
  "track2_cumulative_return": 11.8
}
```

---

## 2. Independent Scorer Agent

### Purpose

Evaluate each rebalance decision's reasoning quality — not just whether the portfolio went up. An up portfolio could be lucky. A down portfolio could have been the right conservative call.

### Why independent

The scorer is a **separate LLM call** from the debate agents. If the debate agent knew its predictions would be scored, it might hedge to protect its win rate instead of making bold correct calls. The independent scorer has no incentive to be generous.

### Scorer inputs

For each unscored rebalance decision:
1. The original debate log (verbatim — the full reasoning from all 4 calls)
2. Actual market data for the period since the decision (fund returns, index movements)
3. The portfolio's actual return vs "do nothing" baseline (held previous allocation)

### Scorer process

1. **Extract testable claims** — read the debate log and identify specific predictions the agents made (implicit or explicit). Examples: "implied HK equity would underperform," "justified bond allocation due to rate concerns," "dismissed geopolitical risk as noise"
2. **Score each claim** — compare against actual data. Correct / Incorrect / Inconclusive
3. **Assess reasoning quality** — was the decision right for the right reasons?
   - `"sound"` — correct decision, correct reasoning
   - `"lucky"` — correct decision, wrong reasoning (went up for different reasons)
   - `"wrong"` — incorrect decision
4. **Extract lessons** — what should the model learn from this outcome?
5. **Output structured scorecard**

### Scorer output schema

```json
{
  "claims": [
    {
      "claim": "HK equity will underperform due to rate sensitivity",
      "outcome": "correct",
      "evidence": "AIA-HEF returned -3.2% over 30d while AIA-AMI returned +1.8%"
    }
  ],
  "win_rate": 0.67,
  "reasoning_quality": "sound",
  "actual_return_pct": 1.2,
  "baseline_return_pct": 0.8,
  "lessons": [
    "Rate sensitivity prediction was accurate — model correctly weighted this signal"
  ]
}
```

### Scoring periods

Each decision gets scored at three intervals:
- **7 days** — immediate reaction, was the short-term call right?
- **30 days** — medium-term, did the thesis play out?
- **90 days** — was the strategic allocation correct?

All three are stored as separate rows in `mpf_rebalance_scores`.

### Model

`anthropic/claude-sonnet-4.6` via AI Gateway — same as the debate pipeline. Independent call, separate system prompt emphasizing objectivity.

---

## 3. Self-Learning Feedback Loop

### How it works

Before each live debate rebalance, the rebalancer queries the last 5 scored decisions from `mpf_rebalance_scores` and injects them into the **Debate agent (Step 2) and Mediator (Step 3) prompts only**.

**The Quant Agent and News Agent do NOT receive track record data.** They must remain "pure" — the Quant Agent sees only metrics, the News Agent sees only news. Contaminating their inputs with past performance feedback would break the separation of concerns that makes the debate architecture work. The Debate and Mediator agents are the ones that synthesize and judge — they benefit from knowing what worked before.

Example injection (appended to Debate and Mediator system prompts):

```
TRACK RECORD (last 5 scored decisions):
- 2026-03-18: SOUND (predicted HK underperform, it did. +2.1% vs baseline)
  Lesson: "Rate sensitivity signal was correctly weighted"
- 2026-03-11: WRONG (held equity through selloff, should have rotated to bonds. -1.4% vs baseline)
  Lesson: "Model underweights sudden geopolitical risk — tends to dismiss single-day events that persist"
- 2026-03-04: LUCKY (portfolio up, but for wrong reasons — predicted tech rally, actual gain from bond reversion)
  Lesson: "Sector rotation predictions unreliable at current data granularity"

Overall win rate: 60% (3/5 sound or lucky, 2/5 wrong)
```

This gives the agents awareness of their own track record without hardcoding rules. The model self-corrects based on observed patterns.

### What this does NOT do

- Does not change the model's weights or parameters
- Does not override the model's judgment
- Does not auto-adjust allocation rules
- Only provides context — the model decides how to use it

---

## 4. Data Model

### New table: `mpf_backtest_runs`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | uuid | PK | |
| track | text | NOT NULL, CHECK IN ('quant_only', 'quant_news') | Which track |
| cursor_date | date | NOT NULL | Last simulated week processed |
| start_date | date | NOT NULL | First simulation date |
| end_date | date | NOT NULL | Target end date |
| status | text | NOT NULL, CHECK IN ('in_progress', 'completed', 'paused') | |
| total_weeks_processed | int | NOT NULL DEFAULT 0 | Progress counter |
| budget_limit | int | NOT NULL DEFAULT 20 | Max debate calls per session (configurable) |
| budget_used_this_session | int | NOT NULL DEFAULT 0 | Calls spent this session |
| cumulative_return_pct | numeric | DEFAULT 0 | Running total return |
| created_at | timestamptz | NOT NULL DEFAULT now() | |
| updated_at | timestamptz | NOT NULL DEFAULT now() | |

### New table: `mpf_backtest_results`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | uuid | PK | |
| run_id | uuid | FK → mpf_backtest_runs.id, NOT NULL | Track is determined by run_id FK |
| sim_date | date | NOT NULL | The week being simulated |
| allocation | jsonb | NOT NULL | `[{code, weight}]` |
| debate_log | text | | Full reasoning |
| confidence | text | NOT NULL DEFAULT 'full' | "full" or "degraded" |
| weekly_return_pct | numeric | | That week's actual return |
| cumulative_return_pct | numeric | | Running total from start |
| rebalance_triggered | boolean | NOT NULL DEFAULT false | Did this week trigger a rebalance? |
| created_at | timestamptz | NOT NULL DEFAULT now() | |

**Unique constraint:** `(run_id, sim_date)`

### New table: `mpf_rebalance_scores`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | uuid | PK | |
| insight_id | uuid | FK → mpf_insights.id, nullable | For live decisions |
| backtest_result_id | uuid | FK → mpf_backtest_results.id, nullable | For backtest decisions |
| score_period | text | NOT NULL, CHECK IN ('7d', '30d', '90d') | |
| claims | jsonb | | Array of extracted claims with outcomes |
| win_rate | numeric | | Claims correct / total |
| reasoning_quality | text | CHECK IN ('sound', 'lucky', 'wrong', 'inconclusive') | |
| lessons | text[] | | Scorer's takeaways |
| actual_return_pct | numeric | | Portfolio return over period |
| baseline_return_pct | numeric | | "Do nothing" return over period |
| scored_at | timestamptz | NOT NULL DEFAULT now() | |

**Check constraint:** Exactly one of `insight_id` or `backtest_result_id` must be non-null.

**Index:** `CREATE INDEX idx_rebalance_scores_feedback ON mpf_rebalance_scores (insight_id, scored_at DESC)` — supports the feedback injection query (last 5 scored live decisions).

### RLS Policy

All three new tables: **admin-only, no client access.** Data is read/written exclusively via `createAdminClient()` which bypasses RLS. No client-side Supabase queries hit these tables.

### No changes to existing tables

The backtest and scoring systems are purely additive.

---

## 5. Win Rate Dashboard

### Location: MPF Care main page (`/mpf-care/page.tsx`)

New section below the Debate Log, above Top Movers.

### "Model Performance" card

- **Win Rate** — big number, rolling last 20 scored decisions. Green if >60%, amber 40-60%, red <40%.
- **Since** — date of first scored decision (implementation date)
- **Decisions scored** — total count
- **Streak** — current consecutive correct/incorrect run

### Expandable details

- Last 10 scored decisions as a timeline: date, allocation summary, outcome (sound/lucky/wrong/inconclusive), return delta vs baseline
- "Lessons learned" — last 3 scorer lessons, most recent first
- Backtest comparison: Track 1 vs Track 2 cumulative return mini-chart (appears once backtest has enough data)

### Component

`src/components/mpf/model-performance.tsx` — server component querying `mpf_rebalance_scores`

---

## 6. Crons & Routes

### Scoring cron: `src/app/api/mpf/cron/scoring/route.ts`

- **Schedule:** Weekly, Sunday 16:00 UTC (a quiet time slot — no dependency on other crons)
- **Logic:**
  1. Find all unscored live rebalance decisions (`mpf_insights` where type = `rebalance_debate`, no matching `mpf_rebalance_scores` row for the eligible period)
  2. Also find unscored backtest results (`mpf_backtest_results` with no matching score)
  3. For each, check if enough time has passed (7d minimum for live; backtest results are immediately eligible since all data is historical)
  4. **Process max 10 unscored decisions per run** to stay within 120s maxDuration
  5. Prioritize live decisions over backtest results
  6. Run independent scorer agent (Claude Sonnet 4.6 via AI Gateway)
  7. Insert scorecard into `mpf_rebalance_scores`
  8. Score 7d first; 30d and 90d scored when eligible on subsequent runs
- **CRON_SECRET verification**
- **Discord notification** with score summary
- **Backtest scoring happens here, NOT during backtest sessions** — keeps the backtest budget clean (20 calls = debate only)

### Backtest route: `src/app/api/mpf/backtest/route.ts`

- **NOT a cron** — manual trigger only
- **maxDuration:** 120 seconds
- **Logic:**
  1. Read cursor from `mpf_backtest_runs` (create if first run)
  2. Process up to 20 debate calls across both tracks (interleaved)
  3. For each simulated week: slice data, compute metrics, optionally fetch news, run debate
  4. Record results in `mpf_backtest_results`
  5. Update cursor and budget counter
  6. Return progress summary
- **CRON_SECRET verification**

### Feedback injection in rebalancer

Modify `src/lib/mpf/rebalancer.ts` — before building the debate prompts, query last 5 scored decisions and append track record context to the **Debate (Step 2) and Mediator (Step 3) system prompts only**. The Quant Agent and News Agent prompts remain unchanged — they must stay "pure" to preserve separation of concerns.

---

## 7. Files Created / Modified

### New Files

| File | Purpose |
|------|---------|
| `src/app/api/mpf/cron/scoring/route.ts` | Weekly scoring cron |
| `src/app/api/mpf/backtest/route.ts` | Budget-limited backtest trigger |
| `src/lib/mpf/scorer.ts` | Independent scorer agent logic |
| `src/lib/mpf/backtester.ts` | Backtest simulation engine |
| `src/components/mpf/model-performance.tsx` | Win rate dashboard component |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/mpf/rebalancer.ts` | Inject last 5 scorecards into debate prompts |
| `src/lib/mpf/types.ts` | Add BacktestRun, BacktestResult, RebalanceScore types |
| `src/app/(app)/mpf-care/page.tsx` | Add ModelPerformance component to dashboard |
| `vercel.json` | Add scoring cron schedule |

### Database Migration

- Create `mpf_backtest_runs` table
- Create `mpf_backtest_results` table
- Create `mpf_rebalance_scores` table

---

## 8. Non-Goals (Out of Scope)

- Automated strategy adjustment (model learns context, doesn't auto-change rules)
- Real-time scoring (weekly cron is sufficient)
- Backtest with actual historical news archives (we use reconstructed search, flagged as degraded)
- Multiple investment profiles in backtest (28yo fixed profile only)
- Client-facing win rate display (internal team tool only)
- Backtest periods before 2018 (insufficient data for 5 funds)
