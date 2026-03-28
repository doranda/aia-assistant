---
topic: AIA ILAS Fund Price API
type: investigative
date: 2026-03-29
sources: 15
---

# AIA ILAS Fund Price API — Research Canvas

## Key Discovery

AIA uses a completely different backend for ILAS fund data than MPF:
- **MPF:** `www.aia.com.hk/api/gw/fund/getFundPerformance/MPF/` (broken/404 as of Mar 2026)
- **ILAS:** `www1.aia.com.hk/CorpWS/Investment/Get/` (working, no auth required)

## Working Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /CorpWS/Investment/Get/FundScheme/` | List all 25 ILAS plan schemes |
| `GET /CorpWS/Investment/Get/FundInfo2/?fund_cat={CAT}&lang=en` | All funds + current prices for a scheme |
| `GET /CorpWS/Investment/Get/FundChart/?fund_code={CODE}&fund_cat={CAT}` | Full daily price history |
| `GET /CorpWS/Investment/Get/FundOptionType/?fund_cat={CAT}` | Fund categories |
| `GET /CorpWS/Investment/Get/FundHouse/?fund_cat={CAT}` | Fund houses |

**No authentication, headers, or cookies required.** Plain HTTP GET.

## FundInfo2 Response Fields

code, name, ISIN, cat, currency, bidPrice, offerPrice, valuationDate, risk, rating, ms_rating, house, type, fund_size, priceHistory, dd_change, start_dealing_date, underlying_fundname

Prices embedded in HTML: `<font color='#D31145'>US$[19.8800]</font>` — extract with regex.

## Key Schemes

| Code | Plan | Active | Funds |
|------|------|--------|-------|
| TMP2 | Treasure Master Plus 2 | Yes | 142 |
| PLP-SP | 2-in-1 Protection Linked (Single) | Yes | 123 |
| PLP-RP | 2-in-1 Protection Linked (Regular) | Yes | active |

## Alternative Data Sources

1. **Morningstar (mstarpy)** — free, ILAS funds have ISINs that map to Morningstar
2. **Brave Search** — per-fund search, slow but resilient
3. **Fund house websites** — 29 sources, legally required to publish NAVs
4. **FE Precision Plus** — commercial API AIA uses, key required

## Decision

Use the CorpWS API as primary source. Build Morningstar as fallback.
This eliminates the need for Playwright entirely.

## Sources

1. AIA CorpWS API (direct testing) — HIGH
2. Morningstar HK (mstarpy) — HIGH
3. kanzy001/AIA-Fund-Dashboard-Final (GitHub) — HIGH
4. gitpan/Finance-Quote AIAHK.pm — MEDIUM
5. ctkqiang/StockAnalysis AIA Malaysia — MEDIUM
6. AIA investment-options-prices.html — HIGH
7. Sun Life HK ILAS prices — MEDIUM
8. AASTOCKS MPF data — MEDIUM
9. HKIFA fund directory — LOW
10. IA public disclosure rules — LOW
