# AIA Knowledge Assistant — Full Diagnostic Audit

**Date:** 2026-04-17
**Trigger:** Two teammates (Alvin, Philip) registered 2026-04-02 but never appeared on team dashboard. Root cause traced to orphaned auth users (auth row present, profiles row missing). Fixed in `src/app/api/team/route.ts` POST handler via explicit `upsert` + auth rollback on failure.
**Audits run:** 10 of 11 (Dead Code was interrupted mid-run — rerun separately)

## Executive Summary

| # | Domain | Files | CRITICAL | HIGH | MED | LOW |
|---|--------|-------|----------|------|-----|-----|
| 1 | Database | 19 | 0 | 3 | 6 | 4 |
| 2 | Backend Modules | 39 | 0 | 3 | 6 | 5 |
| 3 | Frontend UI | 42 | 0 | 1 | 6 | 4 |
| 4 | Navigation + Auth | 11 | 0 | 1 | 2 | 2 |
| 5 | API Routes | 42 | 0 | 0 | 1 | 6 |
| 6 | Mobile + A11y | 65 | 0 | 3 | 5 | 3 |
| 7 | Deploy + Config | n/a | 0 | 2 | 3 | 3 |
| 8 | Security | ~80 | 0 | 4 | 6 | 3 |
| 9 | I18N | 42 | 0 | 8+ | 15+ | many |
| 10 | API Contracts | 14 | 0 | 0 | 2 | 1 |
| 11 | Dead Code | — | — | — | — | — |
| **TOTAL** | | | **0** | **25+** | **52+** | **30+** |

**No CRITICALs. Team POST fix verified LGTM** by both API Routes + API Contracts agents.

---

## HIGH Priority — fix before next deploy

### Database (root cause of this incident)

1. **`handle_new_user` trigger missing `SET search_path` + `ON CONFLICT DO NOTHING` swallows all errors** — `supabase/migrations/003_team_roles.sql:6-14`. This is why Alvin + Philip orphaned. Fix: `SET search_path = public, pg_temp`, remove `ON CONFLICT DO NOTHING` (or narrow it), raise errors instead of swallowing.
2. **`handle_user_login` trigger same issue** — `003_team_roles.sql:22-28`. Supabase silently eats auth trigger errors on sign-in → orphans + missed `last_login` updates.
3. **Migration 004 created 7 tables with RLS but NO WRITE policies and NO GRANTs** — `004_mpf_care.sql:106-125`. Tables unusable until `011_fix_004_table_grants.sql` 15 days later. Pattern risk for future migrations.
4. **`delete_requests_update_managers` policy missing `WITH CHECK`** — `017_missing_rls_policies.sql:79-97`. Approver could flip `requested_by` to another user.

### Backend

5. **Settlement legacy NAV-wait branch reachable with one-line edit** — `src/lib/mpf/portfolio-tracker.ts:506` + `src/lib/ilas/portfolio-tracker.ts:482`. `MIGRATION_CUTOFF = 2000-01-01` makes it effectively dead but hundreds of lines of money code still wired. Delete or gate explicitly.
6. **`updateSession` swallows `supabase.auth.getUser()` error** — `src/lib/supabase/middleware.ts:26`. Auth service hiccup silently bounces logged-in user to `/login`; in edge cases protected-route check may be skipped.
7. **Settlement audit insert fire-and-forget** — `src/lib/mpf/portfolio-tracker.ts:552` + `src/lib/ilas/portfolio-tracker.ts:527`. `state_transitions` audit insert failure only logs; settlement continues marked `executed`. Breaks audit trail silently.

### Frontend

8. **Layout uses `createClient()` (user session) for admin queries** — `src/app/(app)/layout.tsx:32-72`. RLS could silently return 0 counts — admin's pending-approvals badge lies. Should be `createAdminClient()`.

### Navigation + Cache-Control (workspace hard rule)

9. **Cache-Control gap on RSC payloads** — `src/lib/supabase/middleware.ts:48` excludes `_next/` from header-setting. `_next/data` RSC payloads on authenticated routes get NO `private, no-store` override. Workspace hard rule violated.

### Accessibility

10. **Form inputs not bound to labels** — `<Label>` without `htmlFor`, `<Input>` without matching `id`. Systemic across `team-management.tsx:402,413,423,434`, `edit-document-dialog.tsx:132,141,160,170`, `upload-zone.tsx:185,195,212,223`. Screen readers cannot associate.
11. **Chat textarea + FAQ search have no label** — `src/components/chat/chat-input.tsx:42-51`, `faqs/faq-manager.tsx:90-96`. Primary inputs of the app.
12. **Send button cramped** — `chat-input.tsx:63-69` `py-2` → 36px, below 44px touch target.

### Security

13. **`next 16.2.2` — DoS via Server Components** — `npm audit` HIGH. Bump to 16.2.4.
14. **`xlsx *` — prototype pollution + ReDoS, NO FIX AVAILABLE** — `npm audit` HIGH. Swap to `exceljs` (already a dep).
15. **PostgREST `.or()` built from user keywords** — `src/lib/search.ts:98,126`. Wildcards escaped; commas/parens NOT. Possible filter bypass. Switch to `.textSearch()`.
16. **Zero schema validation across ALL API routes** — no zod/yup anywhere. Bodies cast via `as { … }`. Biggest systemic gap.

### Deploy hygiene

17. **`vercel.json` + 4 settlement-critical files uncommitted** — rebalancers + trackers + cron config diverged from production. Drift risk on any deploy.
18. **`CLAUDE.md` + `AGENTS.md` untracked** — workspace hard rule: every `02_Product/` project must have committed `CLAUDE.md`.

### I18N (systemic — directly relevant to user's mobile concern)

19. **~60-70% of UI not wired to `t()`**. Entire Approvals flow, Health page, MPF dashboard widgets (`portfolio-track-record`, `portfolio-reference`, `model-performance`, `risk-metrics`, `debate-log`, `top-movers`, `news-feed`, `fund-chart`, `fund-heatmap`), role labels in team-management, all 7 toast strings, ALL aria-labels — hardcoded English. zh-HK users see mixed English/Chinese UI.
20. **Date formatter locked to `en-HK` regardless of locale** — 10 call sites use `toLocaleDateString("en-HK", ...)`. zh-HK user sees "Feb 12" instead of "2月12日".
21. **`.en` field access bypasses locale** — `ILAS_INSIGHT_DISCLAIMER.en` (twice), `latestInsight.content_en` on MPF dashboard. Insights likely have `content_zh` never rendered.
22. **No interpolation helper** — `t(key)` returns flat string. Every count/date manually concatenated in JSX → breaks zh grammar.

### API Routes

23. **`/api/chat` POST has NO outer try/catch** — `src/app/api/chat/route.ts:35-270`. Any throw returns raw Next.js 500 with stack trace exposed; inconsistent with every other route.

---

## Fix Order (recommended)

**Priority 1 — prevent recurrence of the orphan bug:**
- Patch `handle_new_user` trigger (add `SET search_path`, remove broad swallow) → migration 019
- Patch `handle_user_login` trigger same way

**Priority 2 — commit the uncommitted work:**
- Settlement trackers + rebalancers + vercel.json → one commit
- CLAUDE.md + AGENTS.md → separate commit

**Priority 3 — workspace hard rules:**
- Fix Cache-Control RSC gap (`_next/data`)
- Fix layout `createClient → createAdminClient`
- Bump `next` to 16.2.4, drop `xlsx`

**Priority 4 — systemic:**
- Introduce zod schema validation on API routes
- Fix i18n coverage (approvals, health, MPF widgets, toasts, aria-labels, date formatter)
- Fix form label `htmlFor`/`id` pairing in dialogs

**Priority 5 — settlement hardening:**
- Gate or delete legacy NAV-wait branch behind explicit flag
- Fail-closed on `state_transitions` insert in settlement

---

## LGTM — no regression in team POST fix

- Handler destructures `{ email, full_name, password, role }` — matches caller `team-management.tsx:84-89`.
- `upsert({ onConflict: "id" })` correctly overwrites trigger-created stub if present, inserts if not.
- Auth user rollback on profile failure closes the orphan window.
- Two non-blocking nits: rollback itself doesn't check `deleteUser` error (orphan-on-rollback-failure); no outer-catch for `createUser` throws (low probability).

## Incomplete

- **Audit 11 — Dead Code** was interrupted. Rerun as a separate task when needed.
