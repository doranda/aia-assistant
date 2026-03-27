# MPF Care: Quant Metrics Engine + Dual-Agent Debate Rebalancer

**Date:** 2026-03-25
**Status:** Design approved, pending implementation
**Author:** Jonathan Lee + Claude
**Branch:** feat/mpf-care

---

## Overview

Add quantitative fund analysis and a dual-agent debate rebalancer to MPF Care. The quant engine computes risk-adjusted metrics from 135K+ daily NAV records. The debate rebalancer replaces the current single-AI rebalancer with a 4-call pipeline where a Quant Agent and News Agent independently propose allocations, debate each other's positions, and a Mediator produces the final consensus portfolio with full reasoning.

**Target user:** AIA team (Jonathan, Duo, Josephine, Yuji) — internal decision-support tool for client MPF conversations.

**Investment profile:** 28 years old. Equity allocation uncapped (100% equity is valid). Priority: capital preservation first, long-term compounding second, never chase short-term returns.

---

## 1. Data Layer

### New Table: `mpf_fund_metrics`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | uuid | PK, default gen_random_uuid() | Row ID |
| fund_id | uuid | FK → mpf_funds.id, NOT NULL | Fund reference |
| fund_code | text | NOT NULL | AIA-AEF, etc. |
| period | text | NOT NULL, CHECK IN ('1y','3y','5y','since_launch') | Calculation window |
| sharpe_ratio | numeric | nullable | (Return - Rf) / StdDev |
| sortino_ratio | numeric | nullable | (Return - Rf) / DownsideStdDev |
| max_drawdown_pct | numeric | nullable | Worst peak-to-trough % |
| annualized_return_pct | numeric | nullable | CAGR |
| annualized_volatility_pct | numeric | nullable | StdDev of daily returns × √252 |
| expense_ratio_pct | numeric | nullable | FER from MPFA data |
| momentum_score | numeric | nullable | 3-month trailing return |
| computed_at | timestamptz | NOT NULL, default now() | Last computation time |

**Unique constraint:** `(fund_id, period)` — one row per fund per period.

**Risk-free rate:** 4% (HIBOR approximate), stored as `RISK_FREE_RATE = 0.04` in `src/lib/mpf/constants.ts`.

**Data coverage:**
- 15 funds with full daily NAV data → real metrics computed
- 5 funds (HEF, JEF, FCS, FGR, FSG) → null values until Brave Search backfill pipeline provides data (just make sure all data are filled before agents runs debates)

### Debate Output Storage

No new table. Debate logs stored in existing `mpf_insights` table:
- `type: 'rebalance_debate'` (new value added to InsightType)
- `content_en` / `content_zh`: full debate log + verdict
- `fund_categories`: affected fund categories from final allocation

### Type & Migration Changes Required

**InsightType** (types.ts line 17): Add `"rebalance_debate"` to the union:
```
export type InsightType = "weekly" | "alert" | "on_demand" | "rebalance_debate";
```

**PriceSource** (types.ts line 19): Add `"brave_search"` to the union:
```
export type PriceSource = "mpfa" | "aastocks" | "manual" | "aia_api" | "brave_search";
```

**Database migration:** If CHECK constraints exist on `mpf_insights.type` or `mpf_prices.source`, ALTER to include the new values.

**Rate-limit query update:** The current rebalancer queries `type: 'alert'` with `trigger: 'portfolio_rebalance'` for rate limiting. The new debate rebalancer must query `type: 'rebalance_debate'` instead. Both old `alert` records and new `rebalance_debate` records should be checked to prevent double-rebalancing during the transition.

---

## 2. Quant Metrics Engine

### File: `src/lib/mpf/metrics.ts`

Pure TypeScript math functions. No external dependencies. Each takes a sorted array of `{ date: string, nav: number }`.

**Functions:**

```
calcAnnualizedReturn(prices[]) → number | null
  CAGR = (endNAV / startNAV) ^ (252 / tradingDays) - 1

calcAnnualizedVolatility(prices[]) → number | null
  dailyReturns = prices.map(consecutive % change)
  vol = stdDev(dailyReturns) × √252

calcSharpeRatio(prices[], riskFreeRate) → number | null
  (CAGR - Rf) / annualizedVol

calcSortinoRatio(prices[], riskFreeRate) → number | null
  target = riskFreeRate / 252  // daily target return
  squaredDownside = dailyReturns.map(r => Math.min(r - target, 0) ** 2)
  downsideDev = sqrt(mean(squaredDownside)) × √252  // full-sample downside deviation
  (CAGR - Rf) / downsideDev

calcMaxDrawdown(prices[]) → number | null
  track running peak, find largest % drop from peak

calcMomentumScore(prices[]) → number | null
  (latestNAV / nav3MonthsAgo) - 1
```

**Minimum data requirements:**
- Sharpe/Sortino: at least 60 daily prices (≈3 months)
- Max drawdown: at least 20 daily prices
- Momentum: at least 63 trading days (3 months)
- If insufficient data, return null

**CAGR edge cases:**
- `tradingDays` = actual count of data points in the price array, not calendar days
- If `tradingDays < 252` for a requested period (e.g., fund launched mid-year for "1y" period): return raw cumulative return instead of annualized. Mark with `is_annualized: false` flag (or just skip that period and return null — simpler)
- For "since_launch" with 10+ years: annualization is standard, no special handling needed

### Cron: `src/app/api/mpf/cron/metrics/route.ts`

- **Schedule:** Daily, runs after price cron completes
- **Logic:**
  1. Fetch all funds from `mpf_funds`
  2. For each fund, fetch all prices sorted by date
  3. Compute metrics for each period (1y, 3y, 5y, since_launch) by slicing the price array
  4. Upsert into `mpf_fund_metrics` (on conflict fund_id + period → update)
  5. Log run to `scraper_runs` with duration and record count
- **CRON_SECRET** verification (same pattern as existing crons)

### Constants Addition: `src/lib/mpf/constants.ts`

```
RISK_FREE_RATE = 0.04
INVESTMENT_PROFILE = { age: 28, label: '28yo Long-Term Growth' }
```

Expense ratios (FER) added as a lookup map per fund code. Source: MPFA published data.

---

## 3. Fund Screener Page

### Route: `/mpf-care/screener`

**Server component.** Fetches all fund metrics from `mpf_fund_metrics` (period: 3y as default) joined with `mpf_funds` for metadata.

**UI:**

1. **Category filter tabs:** All | Equity (equity + index + dynamic) | Bond (bond + conservative + guaranteed) | Mixed (mixed + fidelity + dis)
2. **Sortable table:**

| Fund | Category | FER % | Sortino (3Y) | Max Drawdown | CAGR (3Y) | Momentum (3M) | Risk |
|------|----------|-------|--------------|--------------|-----------|---------------|------|

3. **Default sort:** Sortino descending (best risk-adjusted downside protection first)
4. **Color coding:** Green/red relative to column median
5. **Insufficient data:** Show "—" with tooltip "Pending data backfill"
6. **Row click:** Navigate to `/mpf-care/funds/[fund_code]`

**Component:** `src/app/(app)/mpf-care/screener/page.tsx`

**Nav update:** Add "Screener" to MPF Care sub-navigation: News → Screener → Insights → Health

---

## 4. Fund Detail Page Enhancements

### Route: `/mpf-care/funds/[fund_code]` (existing)

**New section below price chart: "Risk Metrics"**

- 5 metric cards in a row: Sortino | Sharpe | Max Drawdown | Volatility | FER
- Period toggle: 1Y / 3Y / 5Y / Since Launch (fetches from `mpf_fund_metrics` by period)
- Color-coded: Sortino/Sharpe green if > 1, red if < 0. Drawdown always red-scaled.
- Null values show "Insufficient data" state

**Component:** `src/components/mpf/risk-metrics.tsx`

---

## 5. Dual-Agent Debate Rebalancer

### Replaces: Current `evaluateAndRebalance()` in `src/lib/mpf/rebalancer.ts`

### Model: `anthropic/claude-sonnet-4.6` via Vercel AI Gateway for all 4 calls

**Note:** The codebase uses raw `fetch` calls to `https://ai-gateway.vercel.sh/v1/chat/completions` with `AI_GATEWAY_API_KEY`. The debate rebalancer follows the same pattern — no AI SDK dependency introduced. AI Gateway supports Anthropic models natively via the `anthropic/claude-sonnet-4.6` model string.

### Timeouts & Cost Guards

- **Per-call timeout:** 30 seconds (abort controller, same pattern as current rebalancer)
- **Total pipeline timeout:** 120 seconds (steps 1a+1b parallel ≈30s, step 2 ≈30s, step 3 ≈30s, overhead)
- **Max rebalances per day:** 3 (even with high-impact news). Prevents runaway costs during volatile markets.
- **Estimated cost:** ~$0.10-0.30 per rebalance (4 × Sonnet calls with metrics/news context). At max 3/day = ~$1/day worst case.
- **Route `maxDuration`:** Set to 120 seconds on the rebalance cron route.

### Data Integrity Gate (HARD REQUIREMENT)

Before the debate pipeline runs, the rebalancer MUST verify data completeness:

1. **Price freshness check:** Query latest price date per active fund. If ANY fund's latest price is older than 5 business days, REFUSE to rebalance. Log: `"BLOCKED: stale price data for [fund_codes]. Fix data pipeline before rebalancing."`
2. **Metrics coverage check:** Query `mpf_fund_metrics` for period = '3y'. If fewer than 80% of active funds have metrics, REFUSE to rebalance. Log: `"BLOCKED: insufficient metrics coverage ([X]/[Y] funds). Run metrics cron first."`
3. **Discord alert:** Send an immediate Discord alert with the specific funds/issues so the team can fix the data pipeline.
4. **Return early** with `{ rebalanced: false, reason: "Data integrity check failed: [details]" }`

The debate agents cannot make good decisions with incomplete data. A bad rebalance is worse than no rebalance.

### Pipeline (4 LLM calls):

**Step 1a — Quant Agent (parallel):**
- **Input:** All fund metrics from `mpf_fund_metrics`, current portfolio from `mpf_reference_portfolio`, investment profile (28yo)
- **System prompt:** You are a quantitative analyst. Propose a 3-fund portfolio based purely on the metrics. Prioritize: (1) capital preservation (low max drawdown), (2) long-term compounding (high Sortino), (3) low fees. No allocation limits — 100% equity is valid if metrics support it.
- **Output schema:** `{ funds: [{ code, weight, reasoning }], summary: string }`

**Step 1b — News Agent (parallel):**
- **Input:** Last 48h classified news from `mpf_news` (high-impact flagged), sentiment distribution, current portfolio
- **System prompt:** You are a market analyst. Propose a 3-fund portfolio based on current market conditions and news sentiment. Consider geopolitical risk, sector rotation signals, and macro trends. Prioritize capital preservation over opportunity.
- **Output schema:** Same as Quant Agent

**Step 2 — Debate:**
- **Input:** Both proposals from Step 1a and 1b, verbatim
- **System prompt:** You are a senior portfolio analyst reviewing two proposals. Identify where they agree, where they conflict, and for each conflict argue which position is stronger and why. Be decisive — don't hedge. If one agent is clearly wrong, say so.
- **Output schema:** `{ agreements: string[], conflicts: [{ topic, quantPosition, newsPosition, verdict, reasoning }], recommendation: string }`

**Step 3 — Mediator:**
- **Input:** Both original proposals + debate analysis + fund metrics + news summary
- **System prompt:** You are the chief investment officer making the final call. Produce the consensus 3-fund portfolio. Constraints: weights in 10% increments, total = 100%. Write a plain-English summary explaining the decision that a non-finance person on the team can understand. Include what the agents disagreed on and why you sided with one over the other.
- **Output schema:** `{ funds: [{ code, weight }], summary_en: string, summary_zh: string, debate_log: string }`

### Validation (unchanged from current):
- Exactly 3 slots. Duplicates allowed — all 3 can be the same fund (e.g., 100% AIA-CON for full cash, or 100% AIA-AEF for full equity). Maximum flexibility.
- Truncate to top 3 if more; pad with conservative fillers if fewer
- Weights in 10% increments, total = 100%
- Auto-rescale if weights don't sum correctly

### Rate limiting (unchanged):
- Max 1 rebalance/week for normal conditions
- Unlimited if high-impact news detected

### Execution:
1. Delete old `mpf_reference_portfolio` rows
2. Insert new 3-fund holdings
3. Insert `mpf_insights` row with type `rebalance_debate`, content = full debate log + verdict (EN/ZH)
4. Discord notification with summary (existing pattern)

---

## 6. Dashboard Debate Log

### Location: MPF Care main page (`/mpf-care/page.tsx`)

**Below the existing Reference Portfolio card:**

New expandable section: **"Why This Allocation"**
- Collapsed by default (just shows "View reasoning →" link)
- Expanded: shows the mediator's summary — what Quant said, what News said, what they agreed/disagreed on, final verdict
- Pulled from latest `mpf_insights` where type = `rebalance_debate`
- Bilingual: respects the page's language toggle (EN/ZH)

**Component:** `src/components/mpf/debate-log.tsx`

---

## 7. Brave Search Data Backfill

### File: `src/lib/mpf/scrapers/brave-search.ts`

**Purpose:** Fill daily NAV gaps for 5 funds not on AIA's getFundDetails API.

**Function:** `fetchMissingFundPrices(): Promise<number>`

**Logic:**
1. Query Brave Search API for each missing fund: `"AIA MPF [fund name] unit price [current month year]"`
2. Parse top results for MPFA pages, aastocks.com, or fund house pages
3. Extract latest NAV + date from structured snippets or page content
4. Validate: NAV must be between 0.5 and 500 (same range as existing price validation)
5. Insert into `mpf_prices` with `source: 'brave_search'`
6. Return count of prices inserted

**Missing funds:** AIA-HEF, AIA-JEF, AIA-FCS, AIA-FGR, AIA-FSG

### Cron Integration

Added as Step 4 in `src/app/api/mpf/cron/prices/route.ts`:
1. AIA daily NAV API (15 funds) ← existing
2. AIA monthly returns API (fallback) ← existing
3. MPFA Excel (fallback) ← existing
4. **Brave Search (5 missing funds)** ← new

### Config
- `BRAVE_SEARCH_API_KEY` env var via Vercel
- Free tier: 2,000 queries/month
- Usage: 5 funds × 1 query × ~4 runs/day = ~600 queries/month (within limits)

---

## 8. Files Created / Modified

### New Files:
| File | Purpose |
|------|---------|
| `src/lib/mpf/metrics.ts` | Quant metric calculation functions |
| `src/app/api/mpf/cron/metrics/route.ts` | Daily metrics computation cron |
| `src/app/(app)/mpf-care/screener/page.tsx` | Fund screener page |
| `src/components/mpf/risk-metrics.tsx` | Metric cards for fund detail page |
| `src/components/mpf/debate-log.tsx` | Expandable debate reasoning display |
| `src/lib/mpf/scrapers/brave-search.ts` | Brave Search NAV backfill |

### Modified Files:
| File | Change |
|------|--------|
| `src/lib/mpf/rebalancer.ts` | Replace single-AI with 4-call debate pipeline |
| `src/lib/mpf/constants.ts` | Add RISK_FREE_RATE, INVESTMENT_PROFILE, FER lookup |
| `src/lib/mpf/types.ts` | Add FundMetrics type, update InsightType enum |
| `src/app/(app)/mpf-care/page.tsx` | Add debate log section below portfolio card |
| `src/app/(app)/mpf-care/funds/[fund_code]/page.tsx` | Add risk metrics section |
| `src/app/api/mpf/cron/prices/route.ts` | Add Brave Search as Step 4 |
| `src/components/mpf/portfolio-reference.tsx` | Minor: link to debate log |

### Database Migration:
- Create `mpf_fund_metrics` table
- Add `'rebalance_debate'` to insight type check constraint (if enum-based)

---

## 9. Non-Goals (Explicitly Out of Scope)

- Client-facing UI (internal team tool only)
- Multiple user profiles / risk tolerance toggle (28yo fixed profile)
- Python backend / QuantStats integration (Phase 2)
- Correlation matrix / Monte Carlo projections (Phase 2)
- Portfolio backtesting / "what-if" simulations (Phase 2)
- Email/push notifications (pending SMTP setup)
- Any allocation limits or equity caps (100% equity is valid)
