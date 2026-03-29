# AIA Knowledge Hub — Full Diagnostic Audit
## Date: 2026-03-29 (v3)

---

### Executive Summary

| Audit | Files | CRITICAL | IMPORTANT | SUGGESTION |
|-------|-------|----------|-----------|------------|
| 1. Database | 16 migrations | 3 | 5 | 3 |
| 2. Backend | 37 lib files | 1 | 4 | 3 |
| 3. Frontend | 47 pages+components | 2 | 2 | 3 |
| 4. Nav + Auth | 16 files | 2 | 3 | 2 |
| 5. API Routes | 37 route files | 1 | 6 | 5 |
| 6. Mobile + A11y | 49 files | 5 | 8 | 5 |
| 7. Deploy + Config | 8 config files | 0 | 0 | 4 |
| **TOTAL** | **210** | **14** | **28** | **25** |

---

### CRITICAL Issues (fix before next deploy)

**C1. [Database] 4 empty migration files — schema not reproducible**
Files: `001_initial_schema.sql`, `002_faqs.sql`, `002_fulltext_search.sql`, `003_team_roles.sql`
Core tables (documents, chunks, conversations, messages, faqs, profiles, popular_queries, delete_requests) were created via Supabase dashboard with no migration record. Fresh DB setup from migrations will fail.

**C2. [Database] Forward reference in settle_switch() — references mpf_reference_portfolio before it exists**
`007_portfolio_tracking.sql:226` references table created in `012_mpf_reference_portfolio.sql`. Sequential migration on fresh DB will fail at runtime.

**C3. [Database] Server components use createAdminClient() bypassing RLS entirely**
8+ pages use service_role for page-level data fetching. RLS policies are effectively decoration for all read operations. If data ever becomes user-scoped, any user sees all data.

**C4. [Backend] `search.ts:135` — `typeof data` forward reference**
`let titleChunks: typeof data = []` references `data` before its declaration at line 155. Type inference may resolve to `any`.

**C5. [Frontend] `documents/page.tsx:10-19` — ALL Supabase errors silently discarded**
Both `documents` and `profile` queries destructure only `{ data }`. Silent failures in production with zero log output.

**C6. [Frontend] `team/page.tsx:12-37` — ALL 4 Supabase queries discard errors + wrong client**
Uses `createClient()` (not admin) to fetch ALL profiles. Under RLS, team page may show only 1 member. Zero error logging.

**C7. [Nav+Auth] Login form ignores `?redirect` param — `login-form.tsx:34`**
Middleware sets `?redirect=/original-path` but LoginForm always hard-redirects to `/dashboard`. Deep links are lost after login.

**C8. [Nav+Auth] Auth callback ignores redirect param — `auth/callback/route.ts:10`**
Same issue for OAuth flows. Always redirects to `/dashboard`.

**C9. [API] `/api/health` — completely unauthenticated**
`health/route.ts:4` — exposes Supabase connectivity and Ollama status to anyone. Infrastructure reconnaissance risk.

**C10. [A11y] `chat-view.tsx` — missing `<main>` landmark**
Root is plain `<div>`. Screen readers cannot identify primary content.

**C11. [A11y] `documents-view.tsx:85` — missing `<main>` landmark**
Same issue.

**C12. [A11y] `team-management.tsx:185` — missing `<main>` landmark**
Same issue.

**C13. [A11y] `layout.tsx:60` — children wrapper is non-semantic `<div>`**
Pages without their own `<main>` inherit this gap.

**C14. [A11y] `document-table.tsx:93` — table not wrapped in `overflow-x-auto`**
7-column table will cause horizontal overflow on narrow screens.

---

### IMPORTANT Issues

**I1. [Database] 13 indexes without IF NOT EXISTS** — `004:31-93`, `007:28-93`. Re-running fails.

**I2. [Database] Non-idempotent RLS policies** — `004`, `005`, `007`, `010`, `012`. Re-running fails with "policy already exists".

**I3. [Database] Duplicate migration number** — two `002_*.sql` files.

**I4. [Database] 30+ Supabase queries discard `error` in portfolio-tracker** — settlement-critical NAV lookups proceed silently with null data.

**I5. [Database] Migration 012 GRANT misleading** — shows SELECT-only but 011 already granted ALL (additive, no functional issue).

**I6. [Backend] `ollama.ts:62` — non-null assertion on nullable `res.body`** — crashes if response has no body.

**I7. [Backend] 4 `any` types hiding API shape bugs** — `aia-api.ts:88,92,188`, `aia-ilas-scraper.ts:114,118`, `portfolio-tracker.ts:38`.

**I8. [Backend] Dead code `brave-search.ts`** — file header says "DEPRECATED", zero imports.

**I9. [Backend] `search.ts:55` — `matchFAQ` swallows errors** — returns `null` (indistinguishable from "no match").

**I10. [Frontend] `documents/page.tsx` and `team/page.tsx` use `createClient()` instead of `createAdminClient()`** — cross-user queries return incomplete data under RLS.

**I11. [Frontend] FAQ components (`faq-manager.tsx:17`, `trending-questions.tsx:15`) — zero error handling on fetch** — no `.catch()`, no `r.ok` check.

**I12. [Nav+Auth] 3 Supabase queries in `(app)/layout.tsx:31,39,47` discard errors** — profile role silently defaults to "agent", stripping admin/manager capabilities.

**I13. [Nav+Auth] Mobile nav missing FAQs + Team** — `mobile-nav.tsx` has 5 items vs 7 on desktop. Mobile users can't navigate to these features.

**I14. [Nav+Auth] Auth callback doesn't check `exchangeCodeForSession` result** — `auth/callback/route.ts:8`. Failed exchange creates silent redirect loop.

**I15. [API] `mpf/insights/route.ts:11-49` — no outer try/catch** — raw 500 on throw.

**I16. [API] `ilas/seed/route.ts:12-55` — no outer try/catch**.

**I17. [API] `delete-requests/route.ts:7-130` — no try/catch on either handler**.

**I18. [API] `documents/route.ts:48-123` POST — no outer try/catch** (PATCH/DELETE do have them).

**I19. [API] `mpf/upload/route.ts:49` — `upsertPrices()` call unwrapped** — DB operation outside try/catch.

**I20. [API] `chat/route.ts:66-167` — multiple Supabase errors silently discarded** — popular_queries, message inserts, FAQ use_count updates.

**I21. [A11y] 9 touch targets below 44px** — top-nav buttons (28px), sign-out (28px), conversation-drawer (28px), document-filters (28px), conversation-sidebar delete (22px), faq-manager edit/delete (22px), team-management toggle (no min-height).

**I22. [A11y] `chat-view.tsx:231` — heading hierarchy violation** — `<h2>` with no `<h1>` on page.

---

### Systemic Patterns

1. **Silent Supabase error discarding** — 40+ locations across backend, frontend, layout, and API routes destructure only `{ data }` and throw away `{ error }`. This is the #1 systemic issue. When things break in production, there will be zero diagnostic trail.

2. **createClient() vs createAdminClient() inconsistency** — Some pages use admin (bypassing RLS), others use session client (constrained by RLS). Neither is consistently applied. The result: RLS policies exist but are unevenly enforced.

3. **Missing `<main>` landmarks** — 3 views + the layout wrapper lack semantic structure. All `<main>`-less pages should be fixed in one pass.

4. **Undersized touch targets** — Icon buttons across the app use `p-1.5` (~22px) or `py-1.5` (~28px). A single utility class (`min-h-[44px] min-w-[44px]`) applied to all icon buttons would fix this.

5. **Non-idempotent migrations** — Earlier migrations (004-007) lack `IF NOT EXISTS` guards. Later ones (008+) do it correctly. Won't cause issues unless migrations are re-run.

---

### Recommended Fix Order

**Batch 1: Security + Data Integrity (1-2 hours)**
- Fix login redirect: read `?redirect` param in `login-form.tsx` and `auth/callback/route.ts`
- Add auth to `/api/health` (or strip infrastructure details from public response)
- Add try/catch to 4 unwrapped API routes
- Fix `search.ts:135` forward reference

**Batch 2: Error Handling Sweep (2-3 hours)**
- Add `{ error }` destructuring + logging to all 40+ silent discard locations
- Add error handling to FAQ fetch calls
- Check `exchangeCodeForSession` result in auth callback

**Batch 3: Accessibility (1-2 hours)**
- Add `<main>` to chat-view, documents-view, team-management
- Wrap document-table in `overflow-x-auto`
- Add `min-h-[44px]` to all icon buttons
- Add missing `<h1>` to chat page
- Add FAQs + Team to mobile nav

**Batch 4: Architecture (plan, don't rush)**
- Backfill 4 empty migration files from live schema
- Decide on createClient vs createAdminClient policy and apply consistently
- Remove dead `brave-search.ts`
- Type the `any` API responses

---

### What's Working Well

- **CRON_SECRET authentication** — consistent across all 14 cron routes
- **Role-based authorization** — admin/manager gates on sensitive operations
- **Cache-Control headers** — `private, no-store` correctly set for authenticated pages
- **TypeScript** — compiles clean with zero errors
- **RLS + GRANTs** — 30/30 tables have RLS enabled and proper grants
- **Responsive grids** — 20/21 grid layouts use proper breakpoints
- **Empty state handling** — most pages have explicit empty states
- **Server/client separation** — correct `'use client'` boundaries throughout
- **Button labels** — 10/10 icon buttons have aria-label or title
- **Deploy config** — all 14 cron paths resolve, deps match imports, .gitignore solid
