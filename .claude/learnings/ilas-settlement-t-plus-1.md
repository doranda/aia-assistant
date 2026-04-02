---
id: ilas-settlement-t-plus-1
domain: ilas-portfolio
confidence: 0.3
created: 2026-04-03
confirmed: 0
---

# ILAS settles T+1, MPF settles T+2

AIA ILAS funds settle in 1 business day (T+1). MPF funds settle in 2 business days (T+2). When the ILAS module was bootstrapped from MPF code, the settlement constant was copied as T+2 without verification.

Price publication lags are also different: ILAS ~1 business day, MPF ~2 business days. Alert thresholds should differ accordingly (ILAS: 2 biz days overdue, MPF: 4 biz days overdue).

Always verify domain-specific constants with the product owner when cloning a system to build a similar one.
