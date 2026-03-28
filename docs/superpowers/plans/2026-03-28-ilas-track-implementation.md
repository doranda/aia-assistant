# ILAS Track — Implementation Plan

## Context

AIA Knowledge Hub already has MPF Care tracking 20 MPF funds with a dual-agent debate rebalancer, quant metrics, T+2 settlement simulation, and Discord reporting. Jonathan wants the same system for AIA's Investment-Linked Assurance Scheme (ILAS) funds — a completely different product from MPF.

**Confirmed fund universe (scraped 2026-03-28):**
- **142 funds** across TMP2 and U-Select (identical fund menu — zero difference)
  - **106 accumulation funds** — standard NAV growth, reinvest dividends
  - **36 distribution funds** (Z-code) — pay cash dividends, NAV reduced on ex-div dates
- **16 asset classes** (Equity: Asia Pacific 23, Sector 15, China/HK 13, Global 11, EM 8, US 5, Europe 3 | Fixed Income: Global 17, Asia Pacific 9, US 7, EM 6, China/HK 3 | Multi-Assets: US 8, Global 6, Asia Pacific 5 | Money Market 3)
- **29 fund houses** (top: BlackRock 12, Franklin Templeton 11, Allianz 10, JPMorgan 20, PineBridge 12, Schroders 9, Fidelity 8)
- **Currencies:** 121 USD, 14 RMB, 4 EUR, 3 HKD
- **Risk:** 86 High, 25 Medium, 31 Low
- **Single portfolio per type** — no scheme split needed. Two dashboard tabs: Accumulation (106 funds) + Distribution (36 funds)
- **Distribution funds need dividend tracking** — total return = NAV change + dividends received. Separate `ilas_dividends` table.

**Architecture: Hybrid sharing.** News, holidays, and scraper audit logs are shared. Fund-specific tables, scrapers, rebalancer prompts, and settlement logic are separate under `ilas_*` prefix.

**Data source:** AIA website scraping via Playwright (ILAP API returns 400). Fund data saved to `docs/specs/ilas-funds-all.json`.

**Naming convention:**
- Product name: **ILAS Track** (displayed in UI)
- DB prefix: `ilas_*`
- Code prefix: `src/lib/ilas/`, `src/app/api/ilas/`, `src/app/(app)/ilas-track/`
- Route: `/ilas-track`

---

## Phase 1: Foundation (Database + Types + Constants)

### Task 1: Database Migration — `010_ilas_track.sql`
**File:** `supabase/migrations/010_ilas_track.sql`

Tables to create:

```
ilas_funds
  id UUID PK, fund_code TEXT UNIQUE, aia_fund_code TEXT,
  name_en TEXT, name_zh TEXT, category TEXT (see below),
  risk_rating INT (1-5), currency TEXT DEFAULT 'HKD',
  settlement_days INT DEFAULT 3, launch_date DATE,
  is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ

ilas_prices
  id UUID PK, fund_id UUID FK→ilas_funds, date DATE, nav DECIMAL(12,4),
  daily_change_pct DECIMAL(8,4), source TEXT ('aia_api'),
  created_at TIMESTAMPTZ
  UNIQUE(fund_id, date)

ilas_fund_returns
  id UUID PK, fund_id UUID FK→ilas_funds, as_at_date DATE,
  return_1m/3m/1y/3y/5y/10y/ytd/since_launch DECIMAL,
  calendar_year_returns JSONB, source TEXT DEFAULT 'aia_api',
  created_at TIMESTAMPTZ
  UNIQUE(fund_id, as_at_date)

ilas_fund_news
  id UUID PK, fund_id UUID FK→ilas_funds, news_id UUID FK→mpf_news (shared!),
  impact_note TEXT, created_at TIMESTAMPTZ

ilas_fund_metrics
  id UUID PK, fund_id UUID FK→ilas_funds, fund_code TEXT,
  period TEXT CHECK ('1y','3y','5y','since_launch'),
  sharpe_ratio, sortino_ratio, max_drawdown_pct,
  annualized_return_pct, annualized_volatility_pct,
  expense_ratio_pct, momentum_score DOUBLE PRECISION,
  computed_at TIMESTAMPTZ
  UNIQUE(fund_id, period)

ilas_insights
  id UUID PK, type TEXT, trigger TEXT, content_en TEXT, content_zh TEXT,
  fund_categories TEXT[], status TEXT, model TEXT, created_at TIMESTAMPTZ

ilas_reference_portfolio
  id UUID PK, fund_id UUID FK→ilas_funds, weight INT,
  note TEXT, updated_by TEXT, updated_at TIMESTAMPTZ

ilas_portfolio_orders (simpler than MPF — no single-switch guard, no emergency flow)
  id UUID PK, submitted_at TIMESTAMPTZ, decision_date DATE,
  execution_date DATE, status TEXT ('pending','executed','cancelled'),
  old_allocation JSONB, new_allocation JSONB,
  insight_id UUID FK→ilas_insights, created_at TIMESTAMPTZ
  -- Single portfolio, no scheme split needed

ilas_portfolio_nav
  date DATE PK, nav DECIMAL(18,8), daily_return_pct DECIMAL(8,4),
  holdings JSONB, is_cash BOOLEAN DEFAULT false, created_at TIMESTAMPTZ

ilas_rebalance_scores
  id UUID PK, insight_id UUID FK→ilas_insights,
  score_period TEXT ('7d','30d','90d'), claims JSONB,
  win_rate DOUBLE PRECISION, reasoning_quality TEXT,
  lessons TEXT[], actual_return_pct, baseline_return_pct DOUBLE PRECISION,
  scored_at TIMESTAMPTZ
```

Categories (16, from AIA website — exact match):
`'equity_asia_pacific','equity_china_hk','equity_emerging_markets','equity_europe','equity_global','equity_sector','equity_us','fixed_income_asia_pacific','fixed_income_china_hk','fixed_income_emerging_markets','fixed_income_global','fixed_income_us','liquidity_money_market','multi_assets_asia_pacific','multi_assets_global','multi_assets_us'`

No scheme split needed — single portfolio tracks one allocation across the 142-fund universe. i think this need to be redone, as there are a lot more optiosn in ILAS funds do a deep seasrch on this, understand the products and funds more. These funds are also avaliable to their respective fund website. more search can be done 

All tables: RLS enabled + GRANT ALL to authenticated/service_role + GRANT SELECT to anon.

### Task 2: TypeScript Types — `src/lib/ilas/types.ts`
**New file.** Fork from `src/lib/mpf/types.ts`, change:
- `IlasFund` with `currency`, `settlement_days` fields yes there are diffferent types of currency with each fund, but at the end we should choose one as base to view for easy we just need to note the exchange rate if it is not a Native USD fund
- `IlasFundCategory` union type for new categories
- `IlasPortfolioOrder` instead of `PendingSwitch`
- Remove MPF-specific types (BacktestRun, BacktestResult for now) needs to find each back test for each individual fund

### Task 3: Constants — `src/lib/ilas/constants.ts`
**New file.** Contains:
- `AIA_ILAS_FUNDS[]` — full fund universe from AIA ILAP API (discover on first seed)
- `AIA_ILAS_API_CODE_MAP` — AIA code → internal code
- `ILAS_FUND_CODE_TO_NAME` + `formatIlasAllocation()`
- `ILAS_FUND_EXPENSE_RATIOS` (if available from AIA)
- `ILAS_RISK_FREE_RATE` = 0.04 (same HIBOR)
- `ILAS_SCREENER_CATEGORIES`
- `ILAS_PORTFOLIO_BASE_NAV` = 100
- `ILAS_INSIGHT_DISCLAIMER` (bilingual)
- Default settlement days per category (equity: T+3, bond: T+2, money market: T+1)

### Task 4: Seed Route — `src/app/api/ilas/seed/route.ts`
**New file.** Hits AIA ILAP performance API, parses all funds, upserts into `ilas_funds`. Admin-only, one-time.

---

## Phase 2: Data Pipeline (Scrapers + Metrics)

### Task 5: AIA ILAS Scraper — `src/lib/ilas/scrapers/aia-ilas-api.ts`
**New file.** Fork from `src/lib/mpf/scrapers/aia-api.ts`, change:
- URL: `getFundPerformance/ILAP/` and `getFundPriceList/ilap` dig for other sources, each fund should have their fund house source a well a lot easier to dig but a more data
- Code map: `AIA_ILAS_API_CODE_MAP`
- Same `parsePct()`, `parseDate()` helpers (import from shared util or copy)
- Exports: `scrapeILASPerformance()`, `scrapeILASDailyPrices()`, `upsertIlasFundReturns()`, `upsertIlasDailyPrices()`

### Task 6: Metrics Engine — `src/lib/ilas/metrics.ts`
**New file — thin wrapper.** Import `computeAllMetrics` from `src/lib/mpf/metrics.ts` (it's pure math). Add `ILAS_FUND_EXPENSE_RATIOS` lookup.

### Task 7: Price Cron — `src/app/api/ilas/cron/prices/route.ts`
**New file.** Calls `scrapeILASDailyPrices()` + `scrapeILASPerformance()`. Schedule: `0 12 * * 1-5` (weekdays noon UTC, after MPF prices at 11).

### Task 8: Metrics Cron — `src/app/api/ilas/cron/metrics/route.ts`
**New file.** Computes metrics for all active ILAS funds. Schedule: `30 12 * * 1-5` (30 min after ILAS prices).

---

## Phase 3: AI Pipeline (Rebalancer + Insights)

### Task 9: ILAS Rebalancer — `src/lib/ilas/rebalancer.ts`
**New file.** Fork from `src/lib/mpf/rebalancer.ts`. Keep:
- `callGateway()`, `parseJSON()` — import from MPF (refactor to shared util)
- 4-call debate pipeline architecture

Change:
- Prompts: ILAS fund universe, different categories, 5-8 fund output (not 3)
- Constraints: no GPF switch limit, no single-switch guard 
- Defensive funds: money market + bond funds instead of AIA-CON
- Safety guardrails: adjust equity cap thresholds

### Task 10: ILAS Insights — `src/lib/ilas/insights.ts`
**New file.** Fork from MPF. Same bilingual generation, different fund context.

### Task 11: News Cron Update — modify `src/app/api/mpf/cron/news/route.ts`
**Modify existing.** After news classification + MPF rebalance check, also run ILAS rebalance check. News is shared — just add a second `evaluateAndRebalanceIlas()` call.

### Task 12: Weekly Insight Cron — `src/app/api/ilas/cron/weekly/route.ts`
**New file.** Generates ILAS-specific weekly insight. Schedule: `30 15 * * 0` (30 min after MPF weekly).

---

## Phase 4: Portfolio Tracking

### Task 13: ILAS Portfolio Tracker — `src/lib/ilas/portfolio-tracker.ts`
**New file.** Fork from MPF. Key differences:
- `settlement_days` per fund (looked up from `ilas_funds` row) instead of global constant
- No single-order guard — allow concurrent buy/sell orders
- No emergency switch / approval flow
- `computeAndStoreIlasNav()` — same synthetic NAV logic
- Reuse `loadHKHolidays()`, `isWorkingDay()`, `addWorkingDays()` from MPF (refactor to shared util)

### Task 14: Portfolio NAV Cron — `src/app/api/ilas/cron/portfolio-nav/route.ts`
**New file.** Schedule: `0 5 * * 1-5` (weekdays 05:00 UTC, after MPF nav at 04:00).

### Task 15: Monthly Report Cron — `src/app/api/ilas/cron/monthly-report/route.ts`
**New file.** Same structure as MPF monthly report, reads from `ilas_portfolio_nav`. Schedule: `30 1 * * 1` (30 min after MPF monthly).

---

## Phase 5: UI

### Task 16: ILAS Track Dashboard — `src/app/(app)/ilas-track/page.tsx`
**New file.** Fork from MPF Care page. Shows:
- `IlasPortfolioTrackRecord` (reuse component pattern with different data)
- `IlasPortfolioReference` (allocation table — more funds, grouped by category)
- `IlasDebateLog`, `IlasModelPerformance`
- Top movers, fund heatmap (grouped by ILAS categories)
- News feed (shared `mpf_news` table)

### Task 17: ILAS Screener — `src/app/(app)/ilas-track/screener/page.tsx`
**New file.** Larger table with category tabs, search/filter. 100+ funds need pagination or virtual scroll.

### Task 18: ILAS Fund Detail — `src/app/(app)/ilas-track/funds/[fund_code]/page.tsx`
**New file.** Fork from MPF fund detail. Add currency display, settlement days info.

### Task 19: ILAS Insights + News Pages
**New files.** `ilas-track/insights/page.tsx`, `ilas-track/news/page.tsx`. Fork from MPF equivalents.

### Task 20: Navigation Update
**Modify:** `src/app/(app)/layout.tsx` — add "ILAS" nav item alongside "MPF".

---

## Phase 6: Shared Utils Refactor

### Task 21: Extract Shared Utilities
**New file:** `src/lib/shared/gateway.ts` — extract `callGateway()`, `parseJSON()` from rebalancer
**New file:** `src/lib/shared/working-days.ts` — extract `loadHKHolidays()`, `isWorkingDay()`, `addWorkingDays()` from portfolio-tracker
**Modify:** MPF modules to import from shared instead of inline

---

## Vercel Cron Summary (new entries for vercel.json)

| Path | Schedule | Description |
|---|---|---|
| `/api/ilas/cron/prices` | `0 12 * * 1-5` | ILAS daily NAV (after MPF) |
| `/api/ilas/cron/metrics` | `30 12 * * 1-5` | ILAS quant metrics |
| `/api/ilas/cron/weekly` | `30 15 * * 0` | ILAS weekly insight |
| `/api/ilas/cron/portfolio-nav` | `0 5 * * 1-5` | ILAS portfolio NAV |
| `/api/ilas/cron/monthly-report` | `30 1 * * 1` | ILAS monthly Discord report |

---

## Build Order

```
Phase 1 (foundation):  Task 1 → 2 → 3 → 4 (seed)
Phase 2 (data):        Task 5 → 7 → 6 → 8
Phase 3 (AI):          Task 21 (shared) → 9 → 10 → 11 → 12
Phase 4 (portfolio):   Task 13 → 14 → 15
Phase 5 (UI):          Task 16 → 17 → 18 → 19 → 20
```

Phases 1-2 can ship independently. Phase 3 depends on Phase 2. Phase 4 depends on Phase 1. Phase 5 depends on all prior phases.

---

## Verification

1. **Seed:** Run `/api/ilas/seed` → verify `ilas_funds` table populated with all ILAS funds
2. **Prices:** Trigger `/api/ilas/cron/prices` → verify `ilas_prices` has today's NAV for all funds
3. **Metrics:** Trigger `/api/ilas/cron/metrics` → verify `ilas_fund_metrics` populated
4. **Rebalancer:** Trigger via news cron or manual → verify `ilas_insights` row created, Discord alert sent with full fund names
5. **Portfolio NAV:** Trigger `/api/ilas/cron/portfolio-nav` → verify `ilas_portfolio_nav` has bootstrap row at 100.0000
6. **UI:** Load `/ilas-track` → verify Track Record + Allocation Performance + heatmap + screener all render
7. **Monthly report:** Trigger `/api/ilas/cron/monthly-report` → verify Discord message with YTD/MTD

---

## Files Summary

**New files (24):**
- `supabase/migrations/010_ilas_track.sql`
- `src/lib/ilas/types.ts`
- `src/lib/ilas/constants.ts`
- `src/lib/ilas/scrapers/aia-ilas-api.ts`
- `src/lib/ilas/metrics.ts`
- `src/lib/ilas/rebalancer.ts`
- `src/lib/ilas/insights.ts`
- `src/lib/ilas/portfolio-tracker.ts`
- `src/lib/shared/gateway.ts`
- `src/lib/shared/working-days.ts`
- `src/app/api/ilas/seed/route.ts`
- `src/app/api/ilas/cron/prices/route.ts`
- `src/app/api/ilas/cron/metrics/route.ts`
- `src/app/api/ilas/cron/weekly/route.ts`
- `src/app/api/ilas/cron/portfolio-nav/route.ts`
- `src/app/api/ilas/cron/monthly-report/route.ts`
- `src/app/(app)/ilas-track/page.tsx`
- `src/app/(app)/ilas-track/screener/page.tsx`
- `src/app/(app)/ilas-track/funds/[fund_code]/page.tsx`
- `src/app/(app)/ilas-track/insights/page.tsx`
- `src/app/(app)/ilas-track/news/page.tsx`
- Components: `ilas-portfolio-reference.tsx`, `ilas-fund-heatmap.tsx`, `ilas-top-movers.tsx`

**Modified files (4):**
- `vercel.json` — add 5 ILAS cron entries
- `src/app/(app)/layout.tsx` — add "ILAS" nav item alongside "MPF"
- `src/app/api/mpf/cron/news/route.ts` — add ILAS rebalance check after MPF
- `src/lib/mpf/rebalancer.ts` — extract `callGateway`/`parseJSON` to shared (or keep and re-export)
