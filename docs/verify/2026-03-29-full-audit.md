# AIA Knowledge Hub — Production Delivery Audit
## Date: 2026-03-29

### Executive Summary

| Audit | Files | CRITICAL | HIGH | MEDIUM | LOW | INFO |
|-------|-------|----------|------|--------|-----|------|
| 1. Database | 15 migrations + live DB | 3 | 0 | 11 | 4 | 7 |
| 2. Backend Modules | 35 files | 2 | 13 | 8 | 6 | 0 |
| 3. Frontend UI | 30+ files | 1 | 2 | 4 | 6 | 0 |
| 4. Nav + Auth + Caching | 10 files | 0 | 3 | 2 | 1 | 0 |
| 5. API Routes | 31 files | 5 | 6 | 7 | 5 | 0 |
| 6. Mobile + A11y | 25+ files | 6 | 6 | 10 | 1 | 0 |
| 7. Deploy + Config | 10 files | 0 | 0 | 1 | 2 | 0 |
| **TOTAL** | **~100 files** | **17** | **30** | **43** | **25** | **7** |

---

## ROOT CAUSE: Mobile Not Syncing

**Every audit agent independently identified the same cause:**

Zero pages export `dynamic = "force-dynamic"`. Zero `Cache-Control` headers in middleware. Zero cache config anywhere. Next.js and Vercel CDN are free to serve stale HTML indefinitely. Mobile browsers cache aggressively.

**Fix:** Add `export const dynamic = "force-dynamic"` to all 13 app pages + add `Cache-Control: private, no-cache, no-store` in middleware.

---

## TOP 5 CRITICAL FIXES (Ship Before Monday)

### 1. SECURITY: `anon` role has WRITE access to 16 production tables
Including profiles, documents, conversations, 127K price records. Unauthenticated users can INSERT/UPDATE/DELETE.
**Fix:** `REVOKE INSERT, UPDATE, DELETE ON [16 tables] FROM anon;`

### 2. CACHING: All pages serve stale content
No `force-dynamic`, no `Cache-Control` headers, no cache config.
**Fix:** Add `export const dynamic = "force-dynamic"` to 13 pages + Cache-Control in middleware.

### 3. SECURITY: `admin_all` policy grants ALL to `public` on 3 tables
backtest_results, backtest_runs, rebalance_scores — anyone can read/write/delete.
**Fix:** `DROP POLICY "admin_all" ON [3 tables];`

### 4. AUTH: Middleware only protects 3 of 7 app routes
/chat, /documents, /faqs, /team rely solely on layout redirect.
**Fix:** Add all routes to PROTECTED_ROUTES.

### 5. NEW CODE: ILAS cron routes missing try/catch + Discord alerts
ilas/cron/prices and ilas/cron/metrics can crash silently with no alerting.
**Fix:** Add top-level try/catch + Discord failure alerts matching MPF pattern.
