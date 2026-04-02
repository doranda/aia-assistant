---
id: aia-price-publication-lag
domain: mpf-care
confidence: 0.5
created: 2026-04-02
confirmed: 1
---

# AIA Price Publication Lag Differs by Product

AIA's MPF prices (getFundPriceList API) publish ~2 business days after valuation date.
AIA's ILAS prices (CorpWS/FundInfo2 API) publish ~1 business day after valuation date.

Settlement systems must model this lag as a first-class concept:
- T+2 settlement date doesn't mean prices are available on T+2
- MPF prices for settlement_date arrive ~T+4, ILAS ~T+3
- Settlement engine should stay in cash until exact prices arrive, not block/error
- Upsert-on-conflict in price scrapers masks stale data as success — always compare incoming date vs DB latest before upserting
- Backfilling NAV history with `getClosestNav` (stale prices) creates immutable wrong rows if the system treats non-cash rows as authoritative
