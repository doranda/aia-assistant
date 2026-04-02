---
id: yahoo-finance-hk-mpf-tickers
domain: data-sources
confidence: 0.8
created: 2026-03-25
confirmed: 1
---

# Yahoo Finance: HK MPF Fund Tickers

All AIA MPF Prime Value Choice funds are available on Yahoo Finance with daily NAV data.

## Ticker Patterns
- Most funds: `AIAMPFPVC*.HK` (e.g., AIAMPFPVCHON.HK for HK Equity)
- Fidelity series: `0P0000SI0*.HK` (e.g., 0P0000SI0V.HK for Fidelity Growth)
- Some funds have alternate tickers: `F0HKG06ZV*.HK`

## API Endpoints
- **v8 Chart API (preferred):** `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}?range=max&interval=1d`
  - JSON format, no cookie/crumb needed, returns timestamps + close prices
- **CSV Download (less reliable):** `https://query1.finance.yahoo.com/v7/finance/download/{TICKER}?period1=X&period2=Y&interval=1d`
  - Requires crumb cookie, often returns 401

## Key Note
Yahoo Finance stopped updating some MPF fund prices around 2021-2023. Data before that is good. For current prices, use AIA's own API (`getFundPriceList/mpf`).

## Performance
5,108 records backfilled in 6.7 seconds (5 funds, full history).
