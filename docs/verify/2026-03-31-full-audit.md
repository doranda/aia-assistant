# AIA Knowledge Hub — Full Diagnostic Audit
## Date: 2026-03-31

### Executive Summary
| Audit | Files | HIGH | MEDIUM | LOW | INFO |
|-------|-------|------|--------|-----|------|
| 1. Database | 17 migrations | 0 | 2 | 1 | 3 |
| 2. Backend Modules | 37 | 0 | 4 | 7 | 2 |
| 3. Frontend UI | 72 | 2 | 1 | 2 | 3 |
| 4. Navigation + Auth | 14 | 0 | 0 | 0 | 4 |
| 5. API Routes | 38 | 0 | 3 | 3 | 3 |
| 6. Mobile + A11y | 46 | 0 | 3 | 5 | 2 |
| 7. Deploy + Config | 9 | 0 | 1 | 2 | 2 |
| 8. Security | 75+ | 1 | 1 | 1 | 2 |
| **TOTAL** | **210+** | **3** | **15** | **21** | **21** |

---

### HIGH Priority (fix before next deploy)

**H1. [Security] `xlsx` dependency has 2 unpatched HIGH CVEs — no fix available**
Prototype Pollution (CVSS 7.8) + ReDoS (CVSS 7.5). Used in `src/app/api/mpf/upload/route.ts:48` to parse user-uploaded Excel files. SheetJS community edition is abandoned. Migrate to `exceljs` or `@erichmond/xlsx-parse`.

**H2. [Frontend] `createClient()` in server component — `src/app/(app)/chat/page.tsx:1,8`**
Server page uses cookie-based client instead of `createAdminClient()`. Query goes through RLS which is correct for user-scoped data, but inconsistent with every other server page. If RLS is misconfigured, conversations silently return empty.

**H3. [Frontend] `createClient()` in server component — `src/app/(app)/documents/page.tsx:1,6`**
Same pattern. Documents page fetches ALL documents relying on RLS. More concerning because documents query has no user filter — depends entirely on RLS policies being correct.

---

### MEDIUM Priority

**M1. [Security] CRON_SECRET auth missing `!!secret` guard — 17 cron routes**
All cron routes except `health` and `batch-ingest` use `authHeader !== \`Bearer ${process.env.CRON_SECRET}\``. If CRON_SECRET is undefined, this becomes `!== "Bearer undefined"` — accidentally safe but fragile. Should use `const secret = process.env.CRON_SECRET; if (!secret || authHeader !== \`Bearer ${secret}\`)`.
Files: `briefing/cron/daily`, `cron/ai-costs`, `mpf/cron/*` (8 routes), `mpf/backfill-yahoo`, `mpf/backtest`, `ilas/cron/*` (4 routes), `ilas/seed`, `ilas/backfill`

**M2. [API] `batch-ingest/route.ts` — No outer try/catch + wrong client for cron path**
`src/app/api/batch-ingest/route.ts:12,36` — Missing top-level try/catch. After CRON_SECRET auth, creates a cookie-based `createClient()` which has no auth context when called via cron Bearer token. Should use `createAdminClient()` for the cron-authenticated path.

**M3. [API] `approve-switch/route.ts` — No outer try/catch**
`src/app/api/mpf/approve-switch/route.ts:5` — Auth section and body parsing unwrapped. If `createClient()` or `getUser()` throws, crashes silently.

**M4. [Backend] `res.body!` non-null assertion can crash**
`src/lib/ollama.ts:62` — `ollamaChatStream` uses `res.body!.getReader()` without null check. If response body is null, throws unhandled TypeError.

**M5. [Backend] Module-level mutable state in serverless context**
`src/lib/mpf/backtester.ts:159` — `previousMetricsCache` persists across invocations in reused serverless instances. Drift detection could use stale data.

**M6. [Backend] Supabase upsert error silently discarded**
`src/lib/mpf/scrapers/fund-prices.ts:239` — Main upsert error checked but never logged when it fails.

**M7. [Backend] `searchDocuments` continues after query error**
`src/lib/search.ts:157-160` — Main chunk query error logged but execution continues with `data || []`. Should early-return on error.

**M8. [Frontend] Health page — no error handling on Promise.all**
`src/app/(app)/mpf-care/health/page.tsx:19-25` — If any helper function throws, entire page crashes with unhandled rejection. No try/catch or error boundary.

**M9. [Mobile] Document table edit/delete buttons are ~22px and hover-only**
`src/components/documents/document-table.tsx:133-155` — `p-1` with `opacity-0 group-hover:opacity-100`. Invisible and unreachable for touch users on laptops with touchscreens.

**M10. [Mobile] Conversation sidebar delete button ~34px + hover-only**
`src/components/chat/conversation-sidebar.tsx:69-77` — Same hover-gated visibility problem.

**M11. [Mobile] MPF Screener touch targets too small**
`src/app/(app)/mpf-care/screener/page.tsx:221-253` — Period toggles ~24px, category tabs ~28px, table rows ~34px. All below 44px minimum.

**M12. [Database] 14 indexes missing `IF NOT EXISTS`**
`004_mpf_care.sql:31,32,50,51,52,78,79,93` and `007_portfolio_tracking.sql:28,32,33,78,79,93` — Re-running migrations will fail.

**M13. [Database] Non-idempotent CREATE POLICY in 6 migrations**
004, 005, 007, 010, 012, 015 — Bare CREATE POLICY without IF NOT EXISTS guard. 28 policies total.

**M14. [API] `backfill-yahoo` and `backtest` routes — catch blocks don't log errors**
`src/app/api/mpf/backfill-yahoo/route.ts:6` and `src/app/api/mpf/backtest/route.ts:6` — Return error but don't `console.error`. Inconsistent with all other routes.

**M15. [Deploy] Missing env vars for Discord alerts and Brave API**
`.env.local` missing `DISCORD_WEBHOOK_URL`, `DISCORD_AI_COSTS_WEBHOOK`, `BRAVE_SEARCH_API_KEY`, etc. Discord alerts won't fire, ai-costs cron will return 500.

---

### LOW Priority

| # | Source | Issue | File:Line |
|---|--------|-------|-----------|
| L1 | Backend | `pendingOrder?: any` type | `ilas/portfolio-tracker.ts:39` |
| L2 | Backend | Dead exports: `canViewDocuments`, `canUploadDocuments`, `canDeleteDocuments` | `permissions.ts:4-6` |
| L3 | Backend | Dead export `chunkText` | `ingestion.ts:42` |
| L4 | Backend | Empty `catch {}` blocks (3 files) | `ocr.ts:39`, `server.ts:15`, `scorer.ts:106` |
| L5 | Backend | Non-null assertions on env vars | `admin.ts:8-9` |
| L6 | Backend | `any` types on external API responses | `aia-api.ts:88,92,188`, `aia-ilas-scraper.ts:114,118` |
| L7 | Backend | `searchDocuments` error continues | `search.ts:157-160` |
| L8 | Frontend | Mixed client pattern (documented) | `insights/page.tsx:2` |
| L9 | Frontend | `model-performance.tsx` — no `"use client"` but renders client child | `model-performance.tsx` |
| L10 | Mobile | Chat textarea missing accessible label | `chat-input.tsx:48` |
| L11 | Mobile | Dashboard links too small for touch | `dashboard/page.tsx:112,163` |
| L12 | Mobile | "Save as FAQ" button ~30px | `message-bubble.tsx:169` |
| L13 | Mobile | Source citation button missing aria-label | `source-citation.tsx:12` |
| L14 | Mobile | Upload zone SVG missing aria-hidden | `upload-zone.tsx:153` |
| L15 | Deploy | `.env.local.example` out of sync (has dead vars) | `.env.local.example` |
| L16 | Deploy | Duplicate `.vercel` entry in `.gitignore` | `.gitignore:8,26` |
| L17 | Security | CSP allows `unsafe-inline` and `unsafe-eval` | `middleware.ts:50` |
| L18 | API | Chat route missing outer try/catch | `chat/route.ts:35` |
| L19 | API | popular-queries returns 200 on DB failure | `popular-queries/route.ts:15` |
| L20 | API | MPF metrics N+1 query pattern | `mpf/cron/metrics/route.ts:31-35` |
| L21 | Database | `settle_switch()` references table from later migration | `007:168-259` → `012` |

---

### Systemic Patterns

1. **CRON_SECRET auth inconsistency** — 2 routes use the correct `!!secret &&` pattern, 17 don't. Should be a shared utility function.
2. **Touch target undersizing** — Desktop components consistently use `py-1` to `py-2` for action buttons. Mobile nav correctly uses `min-h-[44px]`. The pattern exists but isn't applied to desktop interactive elements.
3. **Hover-gated visibility** — Document table and conversation sidebar hide action buttons behind `group-hover`. This breaks on touch devices entirely.
4. **Server page client inconsistency** — 2 of 16 server pages use `createClient()` instead of `createAdminClient()`. The rest are correct.
5. **Error logging consistency** — 95%+ of Supabase queries log errors properly. A handful of routes and the fund-prices upsert silently discard errors.

---

### Recommended Fix Order

1. **H1** — Replace `xlsx` dependency (security, user-uploaded files)
2. **M1** — Fix CRON_SECRET guards across 17 routes (5-minute bulk fix)
3. **H2/H3** — Switch `chat/page.tsx` and `documents/page.tsx` to `createAdminClient()`
4. **M2** — Fix `batch-ingest` try/catch + client
5. **M15** — Sync env vars (Discord alerts are silently broken)
6. **M8** — Add error boundary to health page
7. **M9/M10** — Fix hover-gated buttons (add always-visible mobile alternative)
8. **M3/M14** — Minor try/catch and logging fixes
9. Everything else is LOW/INFO — batch in a cleanup PR
