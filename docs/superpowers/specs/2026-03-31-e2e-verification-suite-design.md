# E2E Verification Suite — Design Spec

## Date: 2026-03-31

## Problem
Every deploy requires manually clicking through 14+ pages to verify nothing is broken. This takes 10-15 minutes and is error-prone.

## Solution
Playwright E2E test suite that logs in as an admin user, visits every page, and verifies key elements render with data. One command replaces the manual walkthrough.

## Architecture

### Dependencies
- Upgrade `playwright` → `@playwright/test` (test runner with assertions, reporters, storage state)
- No other new dependencies

### Auth Strategy
- **Setup project**: Playwright runs `auth.setup.ts` first, which logs in via the UI (email/password)
- **Storage state**: Session cookies saved to `e2e/.auth/user.json`
- **All tests**: Reuse the saved session — no login per test
- `.auth/` added to `.gitignore`

### Test Account
- Email: `e2e-test@aia-assistant.local`
- Password: generated 24-char random string
- Role: `admin` (covers all pages including team management)
- Created via a setup script (`scripts/create-test-user.ts`) that uses Supabase Admin API
- Credentials stored in `.env.local` as `TEST_USER_EMAIL` and `TEST_USER_PASSWORD`

### Config
```
e2e/
  playwright.config.ts
  setup/
    auth.setup.ts
  tests/
    login.spec.ts
    dashboard.spec.ts
    chat.spec.ts
    documents.spec.ts
    faqs.spec.ts
    team.spec.ts
    mpf-care.spec.ts
    ilas-track.spec.ts
    api-auth.spec.ts
```

`playwright.config.ts`:
- `baseURL`: from `NEXT_PUBLIC_APP_URL` or `http://localhost:3000`
- `projects`: `[{ name: 'setup', testMatch: 'setup/*.ts' }, { name: 'tests', testMatch: 'tests/*.ts', dependencies: ['setup'] }]`
- `use.storageState`: `e2e/.auth/user.json` (for tests project)
- `reporter`: `html` (generates browsable report)
- `retries`: 1 (flaky network tolerance)
- `timeout`: 30s per test

## Test Coverage

### login.spec.ts
- Login page renders (email input, password input, submit button)
- Invalid credentials show error
- Successful login redirects to dashboard

### dashboard.spec.ts
- Page loads, h1 visible
- Stats cards render (at least 4 cards)
- Recent activity section present
- Nav links work (spot check 2-3)

### chat.spec.ts
- Page loads, chat input visible
- Conversation sidebar renders
- Can type in chat input (no submit — avoid AI costs)
- Language selector visible

### documents.spec.ts
- Page loads, h1 "Documents" visible
- Document table or empty state renders
- Upload zone visible
- Filter controls present

### faqs.spec.ts
- Page loads
- FAQ list or empty state renders
- "Add FAQ" button visible (admin role)

### team.spec.ts
- Page loads, h1 "Team" visible
- Team member list renders
- Invite form visible (admin role)
- Role badges present

### mpf-care.spec.ts
- Main page: h1, nav tabs, heatmap or fund grid renders
- `/mpf-care/screener`: table renders with fund rows
- `/mpf-care/funds/[code]`: fund detail loads (pick first fund from screener)
- `/mpf-care/health`: pipeline status cards render
- `/mpf-care/insights`: insights list or empty state
- `/mpf-care/news`: news feed renders

### ilas-track.spec.ts
- Main page: h1, category tabs, fund grid renders
- `/ilas-track/screener`: table renders with fund rows
- `/ilas-track/funds/[code]`: fund detail loads (pick first fund from screener)

### api-auth.spec.ts
- `GET /api/chat` without session → 401 or redirect
- `GET /api/documents` without session → 401
- `GET /api/team` without session → 401
- `GET /api/mpf/cron/prices` without valid CRON_SECRET → 401
- `GET /api/health` → 200 (public endpoint, should work)

## Per-Page Assertion Pattern
Each page test follows this pattern:
1. `goto(url)` — navigate
2. Assert no error boundary rendered (no "something went wrong" text)
3. Assert key heading exists (`h1` or specific text)
4. Assert data container exists (table, card grid, etc.)
5. Assert data is populated (row count > 0, or valid empty state message)
6. Check for console errors (Playwright `page.on('console')` listener, fail on `error` level)

## Setup Script (scripts/create-test-user.ts)
- Uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`
- Creates user via `supabase.auth.admin.createUser()` with `email_confirm: true`
- Upserts profile row with `role: 'admin'`
- Idempotent — safe to run multiple times (checks if user exists first)
- Outputs credentials to stdout for manual `.env.local` setup

## Run Commands
```bash
npx playwright test                    # all tests, headless
npx playwright test --ui               # interactive mode
npx playwright test tests/dashboard    # single file
npx playwright show-report             # view HTML report
```

## What's NOT in Scope
- Visual regression / screenshot comparison
- Performance testing
- Mobile viewport testing (future enhancement)
- AI chat response validation (would incur API costs)
- Data mutation tests (don't want tests creating real data)
