---
title: ILAS 1-Year Price Backfill Plan
status: draft
date: 2026-04-17
owner: jonathan
related:
  - /api/ilas/backfill  (existing — 10-day SYNTHETIC bootstrap, source='backfill_synthetic')
  - /api/ilas/cron/prices (live — current NAV only, no history)
  - src/lib/ilas/scrapers/aia-ilas-scraper.ts (FundInfo2 endpoint, current NAV only)
---

# ILAS 1-Year Price Backfill Plan

## Problem

Health scan (2026-04-17) showed:

- 142 ILAS funds × ~19 price rows each = 2,699 total rows
- Earliest date: **2026-03-16** (1 month of real scraping)
- **~50% of every fund's series is `source='backfill_synthetic'`** — random-walk fakes from the 10-day bootstrap script

Every ILAS metric (Sharpe, Sortino, max drawdown, CAGR, momentum) computed on top of that data is **half-noise**. Rebalancer recommendations, screener rankings, heatmap coloring — all unreliable until real history lands.

## Non-goal

Not planning to backfill **to inception** of every fund. Goal is **1 year of real daily NAVs** per USD fund. That is enough for stable 1Y metrics + defensible rebalancer output.

## Constraints

- AIA CorpWS `FundInfo2` returns **current NAV only** — no history param discovered.
- ILAS funds live on two fund-house systems (AIA + underlying manager). ILAS NAV ≠ underlying fund NAV because of insurer spread + account-value charges.
- ~142 ILAS funds × 252 biz days = ~36K rows. Not a storage problem, a **sourcing** problem.
- Must be **idempotent** — re-runnable without double-inserts. Upsert on `(fund_id, date)`.
- Must preserve **source provenance** — never overwrite real rows with synthetic; overwrite synthetic with real when real arrives.

## Sourcing options (ranked)

### Option 1 — Reverse-engineer AIA historical endpoint  (preferred, 1-day spike)

**Theory:** AIA has an internal Fund Price History page on the policyholder portal. Playwright-inspect the network tab, look for a JSON endpoint with a `date` or `dateFrom/dateTo` param.

**Tasks:**
- Manually log into policyholder portal (Jonathan's own account)
- Inspect network requests on any fund-price-history page
- Grep for endpoints that return >1 NAV row

**Success criterion:** Find an endpoint that returns 1Y of daily NAVs for at least one fund.

**If found:** Cheapest path. Wire it into a one-shot script (`scripts/backfill-ilas-history.mjs`) with rate limiting (5 req/sec max, jitter, exponential backoff on 429/5xx). Run once per fund. ~142 requests total.

**If not found:** Move to Option 2.

### Option 2 — AIA monthly factsheet PDFs  (fallback, 2-3 day build)

**Theory:** AIA publishes monthly PDF factsheets per ILAS fund. They contain performance tables (1M, 3M, 6M, 1Y, 3Y, 5Y, since inception) and sometimes a month-end NAV series.

**Issue:** Monthly NAV ≠ daily NAV. A month-end series gives 12 points, not 252. Metrics quality drops. But it's still honest data, and better than 9 synthetic rows.

**Tasks:**
- Discover PDF URL pattern for ILAS factsheets (likely `aia.com.hk/.../ilas/factsheets/{fund_code}_{YYYY-MM}.pdf`)
- One-shot downloader: 142 funds × 13 months = 1,846 PDFs. ~200MB total. Cache in `docs/pdfs-uploaded/ilas-factsheets/`.
- Parse PDFs with `pdfplumber` (Python) or `pdf-parse` (Node). Extract month-end NAV table.
- Write to `ilas_prices` with `source='aia_factsheet'`.

**Accept:** monthly resolution. Metrics engine already tolerates sparse series (weekly/monthly valuation is common in ILAS per ilas-research.md §10).

### Option 3 — Underlying fund manager APIs  (last resort)

**Theory:** Each ILAS fund is backed by a SFC-authorized underlying fund (BlackRock, Fidelity, Schroders, JPM, Templeton). Fund managers publish daily NAVs. The ILAS NAV = underlying NAV − insurer spread.

**Why last resort:**
- Per-manager integration work (5+ separate scrapers)
- Spread ≠ constant — can't just offset underlying NAV
- Violates "single source of truth" (if AIA publishes X tomorrow, do we trust X or the derived value?)

**Skip unless Options 1 + 2 both fail.**

## Schema changes (migration 020)

```sql
-- Already exists: ilas_prices (fund_id, date, nav, daily_change_pct, source)
-- Add explicit source enum check + index on source
ALTER TABLE ilas_prices
  ADD CONSTRAINT ilas_prices_source_chk
  CHECK (source IN ('aia_corpws', 'aia_factsheet', 'aia_historical_api',
                     'backfill_synthetic', 'manual'));

CREATE INDEX IF NOT EXISTS ilas_prices_source_idx ON ilas_prices(source);

-- Allow real-data overwrite of synthetic rows
-- (upsert handles this via ON CONFLICT; document here)
COMMENT ON TABLE ilas_prices IS
  'Upsert on (fund_id, date). Real sources (aia_*) MAY overwrite backfill_synthetic.
   Synthetic MUST NOT overwrite real — enforce in application layer.';
```

## Script + route contract

```
scripts/backfill-ilas-history.mjs
  --source {api|factsheet}   required
  --fund-code <CODE>          optional, default=all USD funds
  --from <YYYY-MM-DD>         default=365 days ago
  --to   <YYYY-MM-DD>         default=today
  --dry-run                   print what would be inserted
  --overwrite-synthetic       allow replacing source='backfill_synthetic'
```

Idempotency: upsert on `(fund_id, date)`; if existing row has `source='backfill_synthetic'` AND `--overwrite-synthetic`, replace. Otherwise skip.

## Cleanup pass (post-backfill)

```sql
-- After real data lands for dates D1..D2, purge synthetic rows that still exist in that window
DELETE FROM ilas_prices
WHERE source='backfill_synthetic'
  AND date IN (SELECT DISTINCT date FROM ilas_prices WHERE source <> 'backfill_synthetic');
```

Recompute metrics after cleanup: `POST /api/ilas/cron/metrics` with `?force=true`.

## Rollout phases

| Phase | Deliverable | Gate to next phase |
|---|---|---|
| 0 | This plan reviewed + approved | Jonathan says go |
| 1 | Spike Option 1 (AIA historical endpoint discovery) | Endpoint found → phase 2a. Not found → phase 2b. |
| 2a | `backfill-ilas-history.mjs --source=api`, rate-limited, dry-run verified | 1 fund backfills 250+ real rows |
| 2b | `backfill-ilas-history.mjs --source=factsheet`, PDF parser, cached | 1 fund backfills 12 real monthly rows |
| 3 | Run for all USD funds (currency='USD' filter per 2026-04-17 rule) | DB shows >200 real rows/fund (api) or >12 (factsheet) |
| 4 | Migration 020 applied; synthetic cleanup; metrics recompute | Screener Sharpe numbers move meaningfully |
| 5 | Delete/disable `/api/ilas/backfill` synthetic route; keep as historical reference only | Audit log entry |

## Success metrics

- Zero `source='backfill_synthetic'` rows remain for dates where real data is available
- Every USD fund has **≥ 200 daily rows** (Option 1) OR **≥ 12 monthly rows** (Option 2) within last 365 days
- ILAS fund Sharpe/Sortino differ from pre-backfill values by ≥ 10% on median fund (proves synthetic data was distorting)
- ILAS rebalancer debate log references "real NAV history" not "bootstrapped"

## Risks + stop conditions

- **AIA rate-limits the scraper** → lower to 1 req/sec, run off-hours, fall back to factsheets
- **Endpoint found but requires logged-in session** → use Playwright with headless auth; document credential handling
- **Some USD funds have <3 months of real history because fund was launched recently** → accept sparse series, tag with `source='aia_corpws'` and skip 1Y metrics for those funds
- **3 failed fix attempts** → STOP, write ESCALATE.md per workspace rule

## Out of scope for this plan

- RMB / HKD / EUR ILAS funds (USD-only filter still active per 2026-04-17 decision)
- Intraday NAV (ILAS funds value once per day)
- Historical NAV **before 2025-04-17** (1-year window only)
- MPF price backfill (already complete via MPFA Excel; separate issue: 5 discontinued funds — now tagged in UI 2026-04-17)
