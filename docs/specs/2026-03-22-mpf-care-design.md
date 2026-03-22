# MPF Care Project — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Author:** Claude + Jonathan

## Overview

MPF Care is a new feature for the AIA Knowledge Hub that tracks AIA MPF fund performance, correlates it with world/Asia/HK news, generates AI-powered rebalancing insights, and stores historical data for pattern recognition. It serves AIA agents as an internal reference tool — framed as "AIA MPF Care Profile," not financial advice.

## Goals

1. **Track** — Automated daily collection of all 25 AIA MPF fund prices (Prime Value Choice scheme)
2. **Correlate** — Cross-check fund movements with global, Asia, and HK news to surface why funds moved
3. **Predict** — AI-generated rebalancing considerations based on trends + news context
4. **Store** — Build a growing database of fund prices + news events + their correlations
5. **Backfill** — Retrieve 5 years of historical data for pattern analysis

## Users

AIA agents (admin, manager, agent, member roles). All users get read access. Admins/managers can trigger manual refreshes and upload gap data.

## Architecture

See diagrams:
- `docs/diagrams/mpf-care-architecture.mmd` (.png rendered) — System architecture
- `docs/diagrams/mpf-care-data-flow.mmd` (.png rendered) — Sequence diagram

## Data Model

### `mpf_funds` — Fund Registry

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| fund_code | text | AIA fund identifier |
| name_en | text | e.g. "Asian Equity Fund" |
| name_zh | text | Chinese name |
| category | text | equity / bond / mixed / guaranteed / index / dis |
| risk_rating | int | 1-5 |
| scheme | text | "Prime Value Choice" |
| is_active | boolean | |
| created_at | timestamptz | |

### `mpf_prices` — Daily NAV Data

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| fund_id | uuid | FK → mpf_funds |
| date | date | Valuation date |
| nav | decimal | Net asset value per unit |
| daily_change_pct | decimal | Calculated |
| source | text | aastocks / mpfa / manual |
| created_at | timestamptz | |

Unique constraint: `(fund_id, date)` — prevents duplicates.

### `mpf_news` — Correlated News Events

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| headline | text | |
| summary | text | AI-generated summary |
| source | text | SCMP, Bloomberg, Reuters, etc. |
| url | text | Original article |
| published_at | timestamptz | |
| region | text | global / asia / hk / china |
| category | text | markets / geopolitical / policy / macro |
| impact_tags | text[] | e.g. ["hk_equity", "bond", "fx"] |
| sentiment | text | positive / negative / neutral |
| is_high_impact | boolean | True when: sentiment=negative + impact_tags count >= 3, OR category=policy + region=hk/china, OR manual flag |
| created_at | timestamptz | |

### `mpf_fund_news` — Fund-News Correlation

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| fund_id | uuid | FK → mpf_funds |
| news_id | uuid | FK → mpf_news |
| impact_note | text | AI-generated explanation of how this news affects this fund |
| created_at | timestamptz | |

### `mpf_insights` — AI-Generated Profiles

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| type | text | weekly / alert / on_demand |
| trigger | text | What triggered this insight (cron / outlier / high_impact_news) |
| content_en | text | Full insight in English |
| content_zh | text | Full insight in Traditional Chinese |
| fund_categories | text[] | Which categories this covers |
| fund_ids | uuid[] | Specific funds this insight relates to (for Fund Explorer filtering) |
| status | text | pending / generating / completed / failed |
| model | text | deepseek-v3 |
| created_at | timestamptz | |

## Data Collection Pipeline

### Scrapers

| Scraper | Source | Schedule | Data |
|---------|--------|----------|------|
| Fund Prices | MPFA Fund Platform Excel (primary), AAStocks (secondary) | Daily 7pm HKT (11:00 UTC) | NAV, returns for all 25 AIA funds |
| News Collector | NewsAPI.org (primary — indexes Reuters, Bloomberg, SCMP), MPFA blog (scraped) | Every 6 hours (0 */6 * * *) | Headlines, article summaries |
| MPFA Official | data.gov.hk API + MPFA Fund Platform Excel | Weekly Sunday (0 15 * * 0 UTC = 11pm HKT) | Cross-validation data, aggregate stats |

### Processing

- **HTML parsing:** Cheerio
- **Excel parsing:** xlsx library
- **Dedup:** Upsert by `(fund_id, date)` for prices, `(headline, published_at)` for news
- **AI classification (news):** minimax-m2.5 via Ollama Cloud — assigns sentiment, impact_tags, region, category

### Backfill

Batched cron job — processes 1 month per invocation. Progress tracked in `mpf_backfill_progress` table with `(year, month, status)`. Each cron trigger picks the next unbatched month. Runs daily until 5 years complete (~60 invocations over 2 months). Sources: MPFA Excel downloads (primary), AAStocks (secondary for missing data).

### Error Handling & Reliability

- **`scraper_runs` audit table:** `(id, scraper_name, run_at, status, error_message, records_processed, duration_ms)`
- **Retry policy:** 3 retries with exponential backoff (1s, 5s, 30s)
- **Stale data indicator:** UI shows "Last updated: X ago" on all data views. Warning badge if data is >24hrs stale
- **Admin notification:** After 2 consecutive failures, flag in dashboard + optional email alert
- **ToS compliance:** Verify AAStocks scraping terms before launch. MPFA official data is primary — AAStocks is secondary/fallback only

### Manual Gap-Fill

Admin page with CSV/Excel upload. Parsed and inserted into `mpf_prices` with `source: 'manual'`. Uses existing Documents upload pattern.

## AI Processing

### News Classification — minimax-m2.5 (Ollama Cloud)

- Runs after each news scrape
- Classifies: sentiment (positive/negative/neutral), impact_tags (which fund categories affected), region (global/asia/hk/china), category (markets/geopolitical/policy/macro)
- Fast (~1s per article)

### Insight Generation — DeepSeek V3 (Ollama Cloud)

- **Weekly profile (Sunday):** Comprehensive analysis of all fund movements + news correlation + rebalancing considerations. Generated in EN + Traditional Chinese.
- **Alert-triggered:** When fund moves >2% or high-impact news detected, generates focused insight for affected categories.
- **On-demand:** "Generate fresh insight" button triggers async job. Returns job ID immediately, UI polls `mpf_insights.status` via Supabase Realtime until `status = completed`. Shows loading spinner during generation.
- **~40s response time** — acceptable for background generation. Vercel function timeout set to 120s in vercel.json for insight routes.

### Prompt Framing

Every insight prefixed: *"Internal reference material for AIA team discussion. Not financial advice. Generated by AIA MPF Care Profile."*

## Alert System

| Trigger | Condition | Action |
|---------|-----------|--------|
| Price outlier | Any fund daily change > 2% | Auto-trigger DeepSeek V3 insight for affected fund categories |
| High-impact news | AI classifies news as high impact | Auto-trigger full portfolio insight refresh |
| Weekly baseline | Sunday night HKT | Full comprehensive DeepSeek V3 analysis regardless |

All alerts show as badge/dot on MPF Care nav item + toast notification. Delivered via Supabase Realtime subscription on `mpf_insights` table (postgres_changes).

### Impact Tag → Fund Category Mapping

News `impact_tags` map to fund categories via static config:

| Impact Tag | Fund Categories |
|-----------|----------------|
| hk_equity | equity (HK, Greater China) |
| asia_equity | equity (Asian, Japan) |
| us_equity | equity (North American), index (American) |
| eu_equity | equity (European), index (Eurasia) |
| global_equity | index (World), mixed (all) |
| bond | fixed income (Asian Bond, Global Bond) |
| fx | all (currency exposure affects everything) |
| rates | fixed income, guaranteed, conservative |
| china | equity (Greater China), dynamic (China HK) |
| green_esg | equity (Green Fund) |

## UI Pages

All under `/mpf-care` — new top-level nav item.

### 1. Overview (default: `/mpf-care`)

- Fund performance heatmap: green/red grid of all 25 funds (1D/1W/1M/3M)
- Top movers: biggest gains/losses today
- Latest correlated news: 3-5 headlines with impact tags
- Summary card from latest AIA MPF Care Profile

### 2. Fund Explorer (`/mpf-care/funds/[fund_code]`)

- Fund selector dropdown
- Price chart: line graph with 1M/3M/1Y/5Y toggle (Recharts)
- Performance table: returns across timeframes
- Correlated news timeline: news events plotted alongside price movements
- Category comparison: this fund vs category average

### 3. News & Insights (`/mpf-care/news`)

- Filterable feed by region (Global/Asia/HK/China) and category (markets/geopolitical/policy/macro)
- Each item shows: headline, summary, sentiment badge, impact tags (which funds affected)
- "Impact History": past news events + what actually happened to fund prices after

### 4. Rebalancing Insights (`/mpf-care/insights`)

- Latest AIA MPF Care Profile (full AI-generated analysis)
- Historical profiles (archive of past weekly/alert insights)
- "Generate fresh insight" button (admin/manager only)
- Language toggle: EN / 繁中
- Disclaimer banner: "Internal reference — not financial advice"

## Access Control

| Role | Access |
|------|--------|
| Admin | Full access + manage scrapers + trigger refresh + upload data |
| Manager | Full access + trigger refresh |
| Agent | Read-only (all pages) |
| Member | Read-only (all pages) |

## Navigation Changes

- New "MPF Care" nav item in sidebar (between Dashboard and Chat)
- Dashboard gets summary card: top 3 movers + latest insight snippet → links to `/mpf-care`
- Badge on nav when new alert-triggered insight is generated

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Next.js 16 (existing app) |
| Database | Supabase Postgres (5 new tables) |
| Scrapers | Vercel Cron → Serverless Functions |
| HTML parsing | Cheerio |
| Excel parsing | xlsx |
| AI — Chat | minimax-m2.5 via Ollama Cloud (unchanged) |
| AI — News classification | minimax-m2.5 via Ollama Cloud |
| AI — Insights | DeepSeek V3 via Ollama Cloud |
| Charts | Recharts |
| UI Components | shadcn/ui (existing) |

## Out of Scope

- Client-facing reports/PDFs
- Actual trade execution
- Real-time streaming prices (6hr intervals sufficient)
- Multi-scheme support (Prime Value Choice only)
- Mobile app (web-only, responsive)

## Data Sources

### Fund Prices
- **Primary:** MPFA Fund Platform Excel downloads (official, stable, sanctioned)
- **Secondary:** AAStocks MPF pages (verify ToS before use)
- **Aggregate:** data.gov.hk MPFA API datasets

### News
- **Primary:** NewsAPI.org (aggregates Reuters, Bloomberg, SCMP, and 150k+ sources — $449/mo business plan or free developer tier for prototyping)
- **Scrapable:** MPFA Blog (regulatory updates), Investing.com HK
- **Note:** Direct scraping of Bloomberg/Reuters is blocked by their anti-bot systems. NewsAPI handles this.

### No official API exists for MPF fund prices. Data via MPFA Excel downloads (primary) or scraping (secondary).

### Data Retention

- **mpf_prices:** Indefinite (core dataset, ~6k rows/year)
- **mpf_news:** 2 years active, older archived to `mpf_news_archive` table (estimated ~15k rows/year at 4 articles/scrape × 4 scrapes/day)
- **mpf_insights:** Indefinite (small volume, ~100 rows/year)

## AIA Fund Coverage

25 constituent funds across:
- Equity (Regional): Asian, European, Greater China, HK, Japan, North American
- Equity (Thematic): Green Fund
- Index-Tracking: American, Eurasia, HK & China, World
- Mixed/Lifestyle: Growth, Balanced, Capital Stable
- Dynamic: China HK Dynamic, Manager's Choice
- Fidelity: Growth, Stable Growth, Capital Stable
- Fixed Income: Asian Bond, Global Bond
- Conservative: MPF Conservative Fund
- Guaranteed: Guaranteed Portfolio
- DIS: Core Accumulation, Age 65 Plus

Risk ratings: 1 (conservative) to 5 (equity).
