# MPF Care Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MPF fund tracking, news correlation, and AI-generated rebalancing insights to the AIA Knowledge Hub.

**Architecture:** Server-rendered Next.js 16 pages under `/mpf-care` with Supabase Postgres for storage, Vercel Cron + Serverless Functions for data collection, and Ollama Cloud (minimax-m2.5 for classification, DeepSeek V3 for insights). Supabase Realtime for live insight status updates.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Realtime), Tailwind v4, shadcn/ui, Recharts, Cheerio, xlsx, Ollama Cloud, Vercel Cron.

**Design Spec:** `docs/specs/2026-03-22-mpf-care-design.md`

**Prerequisite:** The AIA Knowledge Hub repo must be initialized on GitHub (`doranda/aia-assistant`) with the existing deployed code pushed. If the repo is still empty, push the current working codebase first before starting this plan.

---

## File Structure

### New Files (MPF Care)

```
src/
├── lib/
│   └── mpf/
│       ├── types.ts              — MPF-specific types (Fund, Price, News, Insight, etc.)
│       ├── constants.ts          — Fund registry seed data, impact-tag mapping, categories
│       ├── scrapers/
│       │   ├── fund-prices.ts    — MPFA Excel + AAStocks price scraper
│       │   ├── news-collector.ts — NewsAPI.org + MPFA blog news fetcher
│       │   └── mpfa-official.ts  — data.gov.hk cross-validation
│       ├── classification.ts     — News classification via minimax-m2.5
│       ├── insights.ts           — DeepSeek V3 insight generation
│       └── alerts.ts             — Alert trigger logic (outlier, high-impact, weekly)
├── app/
│   ├── (app)/
│   │   └── mpf-care/
│   │       ├── page.tsx              — Overview (heatmap, top movers, news, summary)
│   │       ├── overview-view.tsx     — Client component for overview interactivity
│   │       ├── funds/
│   │       │   └── [fund_code]/
│   │       │       └── page.tsx      — Fund Explorer (chart, table, correlated news)
│   │       ├── news/
│   │       │   └── page.tsx          — News & Insights feed
│   │       └── insights/
│   │           └── page.tsx          — Rebalancing Insights (AI profiles, archive)
│   └── api/
│       └── mpf/
│           ├── cron/
│           │   ├── prices/route.ts       — Cron: daily fund price scrape
│           │   ├── news/route.ts         — Cron: 6-hourly news collection
│           │   └── weekly/route.ts       — Cron: Sunday weekly insight
│           ├── insights/
│           │   ├── route.ts              — POST: trigger on-demand insight
│           │   └── [id]/route.ts         — GET: poll insight status
│           ├── refresh/route.ts          — POST: manual data refresh (admin/manager)
│           └── upload/route.ts           — POST: CSV/Excel gap-fill upload
├── components/
│   └── mpf/
│       ├── fund-heatmap.tsx          — Green/red grid of all 25 funds
│       ├── fund-chart.tsx            — Recharts line chart with time toggles
│       ├── news-feed.tsx             — Filterable news list with badges
│       ├── insight-card.tsx          — AI insight display with language toggle
│       ├── top-movers.tsx            — Biggest gains/losses today
│       └── disclaimer-banner.tsx     — "Not financial advice" banner
supabase/
└── migrations/
    └── 004_mpf_care.sql              — All 7 MPF tables + indexes + RLS
vercel.json                           — Cron schedules + function timeouts
```

### Modified Files

```
src/components/nav/top-nav.tsx        — Add "MPF Care" nav item + alert badge
src/components/nav/mobile-nav.tsx     — Add "MPF" mobile nav item
src/lib/permissions.ts                — Add canTriggerRefresh(), canUploadData()
src/app/(app)/dashboard/page.tsx      — Add MPF summary card (top 3 movers + latest insight)
```

---

## Phase 0: Prerequisites (Core Lib Files)

### Task 0: Create Base Infrastructure Files

The following core lib files are empty stubs and must be populated before MPF Care work begins. These are used by the existing app features AND by MPF Care.

**Files:**
- Create content in: `src/lib/supabase/admin.ts`
- Create content in: `src/lib/types.ts`
- Create content in: `src/lib/permissions.ts`

- [ ] **Step 1: Write the admin Supabase client**

```typescript
// src/lib/supabase/admin.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. Bypasses RLS.
 * Use ONLY in server-side code (API routes, crons, server actions).
 * Never expose to the client.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 2: Write the shared types**

```typescript
// src/lib/types.ts
export type UserRole = "admin" | "manager" | "agent" | "member";
```

- [ ] **Step 3: Write the permissions module**

```typescript
// src/lib/permissions.ts
import type { UserRole } from "./types";

// Document permissions
export function canViewDocuments(_role: UserRole): boolean { return true; }
export function canUploadDocuments(role: UserRole): boolean { return role !== "member"; }
export function canDeleteDocuments(role: UserRole): boolean { return role === "admin" || role === "manager"; }

// Team permissions
export function canManageTeam(role: UserRole): boolean { return role === "admin" || role === "manager"; }
export function canApproveDeletions(role: UserRole): boolean { return role === "admin" || role === "manager"; }

// MPF Care permissions
export function canTriggerMpfRefresh(role: UserRole): boolean { return role === "admin" || role === "manager"; }
export function canUploadMpfData(role: UserRole): boolean { return role === "admin"; }
export function canGenerateInsight(role: UserRole): boolean { return role === "admin" || role === "manager"; }
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/admin.ts src/lib/types.ts src/lib/permissions.ts
git commit -m "feat: add core lib files — admin client, types, permissions"
```

---

## Phase 1: Foundation (Database + Types + Nav)

### Task 1: Database Migration — MPF Tables

**Files:**
- Create: `supabase/migrations/004_mpf_care.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 004_mpf_care.sql — MPF Care tables

-- Fund registry
create table mpf_funds (
  id uuid primary key default gen_random_uuid(),
  fund_code text not null unique,
  name_en text not null,
  name_zh text not null,
  category text not null check (category in (
    'equity', 'bond', 'mixed', 'guaranteed', 'index', 'dis',
    'conservative', 'fidelity', 'dynamic'
  )),
  risk_rating int not null check (risk_rating between 1 and 5),
  scheme text not null default 'Prime Value Choice',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Daily NAV data
create table mpf_prices (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references mpf_funds(id) on delete cascade,
  date date not null,
  nav decimal(12,4) not null,
  daily_change_pct decimal(8,4),
  source text not null check (source in ('mpfa', 'aastocks', 'manual')),
  created_at timestamptz not null default now(),
  unique (fund_id, date)
);

create index idx_mpf_prices_fund_date on mpf_prices(fund_id, date desc);
create index idx_mpf_prices_date on mpf_prices(date desc);

-- Correlated news events
create table mpf_news (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  summary text,
  source text not null,
  url text,
  published_at timestamptz not null,
  region text not null check (region in ('global', 'asia', 'hk', 'china')),
  category text not null check (category in ('markets', 'geopolitical', 'policy', 'macro')),
  impact_tags text[] not null default '{}',
  sentiment text not null check (sentiment in ('positive', 'negative', 'neutral')),
  is_high_impact boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_mpf_news_published on mpf_news(published_at desc);
create index idx_mpf_news_region on mpf_news(region);
create index idx_mpf_news_high_impact on mpf_news(is_high_impact) where is_high_impact = true;

-- Fund-news correlation
create table mpf_fund_news (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references mpf_funds(id) on delete cascade,
  news_id uuid not null references mpf_news(id) on delete cascade,
  impact_note text,
  created_at timestamptz not null default now(),
  unique (fund_id, news_id)
);

-- AI-generated insights
create table mpf_insights (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('weekly', 'alert', 'on_demand')),
  trigger text not null,
  content_en text,
  content_zh text,
  fund_categories text[] not null default '{}',
  fund_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'generating', 'completed', 'failed')),
  model text not null default 'deepseek-v3',
  created_at timestamptz not null default now()
);

create index idx_mpf_insights_status on mpf_insights(status);
create index idx_mpf_insights_type_created on mpf_insights(type, created_at desc);

-- Scraper audit log
create table scraper_runs (
  id uuid primary key default gen_random_uuid(),
  scraper_name text not null,
  run_at timestamptz not null default now(),
  status text not null check (status in ('running', 'success', 'failed')),
  error_message text,
  records_processed int not null default 0,
  duration_ms int,
  created_at timestamptz not null default now()
);

create index idx_scraper_runs_name_status on scraper_runs(scraper_name, run_at desc);

-- Backfill progress tracker
create table mpf_backfill_progress (
  year int not null,
  month int not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  updated_at timestamptz not null default now(),
  primary key (year, month)
);

-- RLS policies (all authenticated users can read, admin/manager can write)
alter table mpf_funds enable row level security;
alter table mpf_prices enable row level security;
alter table mpf_news enable row level security;
alter table mpf_fund_news enable row level security;
alter table mpf_insights enable row level security;
alter table scraper_runs enable row level security;
alter table mpf_backfill_progress enable row level security;

-- Read access for all authenticated
create policy "mpf_funds_read" on mpf_funds for select to authenticated using (true);
create policy "mpf_prices_read" on mpf_prices for select to authenticated using (true);
create policy "mpf_news_read" on mpf_news for select to authenticated using (true);
create policy "mpf_fund_news_read" on mpf_fund_news for select to authenticated using (true);
create policy "mpf_insights_read" on mpf_insights for select to authenticated using (true);
create policy "scraper_runs_read" on scraper_runs for select to authenticated using (true);
create policy "mpf_backfill_read" on mpf_backfill_progress for select to authenticated using (true);

-- Write via service role only (crons + admin actions use admin client)
-- No insert/update/delete policies for authenticated — all writes go through service_role
```

- [ ] **Step 2: Run the migration**

```bash
cd /path/to/aia-assistant
npx supabase db push
```

Expected: Migration applied, 7 tables created.

- [ ] **Step 3: Verify tables exist**

```bash
npx supabase db reset --dry-run
```

Or check Supabase dashboard → Table Editor → confirm `mpf_funds`, `mpf_prices`, `mpf_news`, `mpf_fund_news`, `mpf_insights`, `scraper_runs`, `mpf_backfill_progress` all present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/004_mpf_care.sql
git commit -m "feat(mpf): add database schema — 7 tables with RLS"
```

---

### Task 2: TypeScript Types

**Files:**
- Create: `src/lib/mpf/types.ts`

- [ ] **Step 1: Write MPF types**

```typescript
// src/lib/mpf/types.ts — MPF Care domain types

export type FundCategory =
  | "equity"
  | "bond"
  | "mixed"
  | "guaranteed"
  | "index"
  | "dis"
  | "conservative"
  | "fidelity"
  | "dynamic";

export type NewsRegion = "global" | "asia" | "hk" | "china";
export type NewsCategory = "markets" | "geopolitical" | "policy" | "macro";
export type Sentiment = "positive" | "negative" | "neutral";
export type InsightType = "weekly" | "alert" | "on_demand";
export type InsightStatus = "pending" | "generating" | "completed" | "failed";
export type PriceSource = "mpfa" | "aastocks" | "manual";

export interface MpfFund {
  id: string;
  fund_code: string;
  name_en: string;
  name_zh: string;
  category: FundCategory;
  risk_rating: number;
  scheme: string;
  is_active: boolean;
  created_at: string;
}

export interface MpfPrice {
  id: string;
  fund_id: string;
  date: string;
  nav: number;
  daily_change_pct: number | null;
  source: PriceSource;
  created_at: string;
}

export interface MpfNews {
  id: string;
  headline: string;
  summary: string | null;
  source: string;
  url: string | null;
  published_at: string;
  region: NewsRegion;
  category: NewsCategory;
  impact_tags: string[];
  sentiment: Sentiment;
  is_high_impact: boolean;
  created_at: string;
}

export interface MpfFundNews {
  id: string;
  fund_id: string;
  news_id: string;
  impact_note: string | null;
  created_at: string;
}

export interface MpfInsight {
  id: string;
  type: InsightType;
  trigger: string;
  content_en: string | null;
  content_zh: string | null;
  fund_categories: string[];
  fund_ids: string[];
  status: InsightStatus;
  model: string;
  created_at: string;
}

export interface ScraperRun {
  id: string;
  scraper_name: string;
  run_at: string;
  status: "running" | "success" | "failed";
  error_message: string | null;
  records_processed: number;
  duration_ms: number | null;
  created_at: string;
}

// View models for UI
export interface FundWithLatestPrice extends MpfFund {
  latest_nav: number | null;
  daily_change_pct: number | null;
  price_date: string | null;
}

export interface FundPerformance {
  fund_id: string;
  fund_code: string;
  name_en: string;
  name_zh: string;
  category: FundCategory;
  risk_rating: number;
  returns: {
    "1d": number | null;
    "1w": number | null;
    "1m": number | null;
    "3m": number | null;
    "1y": number | null;
    "5y": number | null;
  };
}

export interface NewsWithFunds extends MpfNews {
  affected_funds: { fund_code: string; name_en: string; impact_note: string | null }[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/types.ts
git commit -m "feat(mpf): add TypeScript types for all MPF entities"
```

---

### Task 3: Fund Constants & Seed Data

**Files:**
- Create: `src/lib/mpf/constants.ts`

- [ ] **Step 1: Write fund registry + impact mapping**

```typescript
// src/lib/mpf/constants.ts — Static MPF configuration

import type { FundCategory } from "./types";

// All 25 AIA MPF funds (Prime Value Choice scheme)
// Source: MPFA Fund Platform
export const AIA_FUNDS = [
  { fund_code: "AIA-AEF", name_en: "Asian Equity Fund", name_zh: "亞洲股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-EEF", name_en: "European Equity Fund", name_zh: "歐洲股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-GCF", name_en: "Greater China Equity Fund", name_zh: "大中華股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-HEF", name_en: "Hong Kong Equity Fund", name_zh: "香港股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-JEF", name_en: "Japan Equity Fund", name_zh: "日本股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-NAF", name_en: "North American Equity Fund", name_zh: "北美股票基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-GRF", name_en: "Green Fund", name_zh: "綠色基金", category: "equity" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-AMI", name_en: "American Index Fund", name_zh: "美國指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-EAI", name_en: "Eurasia Index Fund", name_zh: "歐亞指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-HCI", name_en: "HK & China Index Fund", name_zh: "香港及中國指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-WIF", name_en: "World Index Fund", name_zh: "環球指數基金", category: "index" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-GRW", name_en: "Growth Fund", name_zh: "增長基金", category: "mixed" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-BAL", name_en: "Balanced Fund", name_zh: "均衡基金", category: "mixed" as FundCategory, risk_rating: 3 },
  { fund_code: "AIA-CST", name_en: "Capital Stable Fund", name_zh: "資本穩定基金", category: "mixed" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-CHD", name_en: "China HK Dynamic Fund", name_zh: "中港動態基金", category: "dynamic" as FundCategory, risk_rating: 5 },
  { fund_code: "AIA-MCF", name_en: "Manager's Choice Fund", name_zh: "基金經理精選基金", category: "dynamic" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-FGR", name_en: "Fidelity Growth Fund", name_zh: "富達增長基金", category: "fidelity" as FundCategory, risk_rating: 4 },
  { fund_code: "AIA-FSG", name_en: "Fidelity Stable Growth Fund", name_zh: "富達穩定增長基金", category: "fidelity" as FundCategory, risk_rating: 3 },
  { fund_code: "AIA-FCS", name_en: "Fidelity Capital Stable Fund", name_zh: "富達資本穩定基金", category: "fidelity" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-ABF", name_en: "Asian Bond Fund", name_zh: "亞洲債券基金", category: "bond" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-GBF", name_en: "Global Bond Fund", name_zh: "環球債券基金", category: "bond" as FundCategory, risk_rating: 2 },
  { fund_code: "AIA-CON", name_en: "MPF Conservative Fund", name_zh: "強積金保守基金", category: "conservative" as FundCategory, risk_rating: 1 },
  { fund_code: "AIA-GPF", name_en: "Guaranteed Portfolio Fund", name_zh: "保證基金", category: "guaranteed" as FundCategory, risk_rating: 1 },
  { fund_code: "AIA-CAF", name_en: "Core Accumulation Fund", name_zh: "核心累積基金", category: "dis" as FundCategory, risk_rating: 3 },
  { fund_code: "AIA-65P", name_en: "Age 65 Plus Fund", name_zh: "65歲後基金", category: "dis" as FundCategory, risk_rating: 2 },
] as const;

// Impact tag → fund category mapping (from design spec)
export const IMPACT_TAG_TO_CATEGORIES: Record<string, FundCategory[]> = {
  hk_equity: ["equity"],      // HK, Greater China funds
  asia_equity: ["equity"],     // Asian, Japan funds
  us_equity: ["equity", "index"], // North American, American Index
  eu_equity: ["equity", "index"], // European, Eurasia Index
  global_equity: ["index", "mixed"], // World Index, all mixed
  bond: ["bond"],
  fx: ["equity", "bond", "mixed", "index", "dynamic", "fidelity", "conservative", "guaranteed", "dis"], // affects all
  rates: ["bond", "guaranteed", "conservative"],
  china: ["equity", "dynamic"], // Greater China, China HK Dynamic
  green_esg: ["equity"],       // Green Fund
};

// Impact tag → specific fund codes (more precise mapping)
export const IMPACT_TAG_TO_FUNDS: Record<string, string[]> = {
  hk_equity: ["AIA-HEF", "AIA-GCF", "AIA-HCI"],
  asia_equity: ["AIA-AEF", "AIA-JEF"],
  us_equity: ["AIA-NAF", "AIA-AMI"],
  eu_equity: ["AIA-EEF", "AIA-EAI"],
  global_equity: ["AIA-WIF", "AIA-GRW", "AIA-BAL"],
  bond: ["AIA-ABF", "AIA-GBF"],
  rates: ["AIA-ABF", "AIA-GBF", "AIA-GPF", "AIA-CON", "AIA-CST"],
  china: ["AIA-GCF", "AIA-CHD", "AIA-HCI"],
  green_esg: ["AIA-GRF"],
};

// Fund categories for display grouping
export const FUND_CATEGORY_LABELS: Record<FundCategory, string> = {
  equity: "Equity (Regional/Thematic)",
  index: "Index-Tracking",
  mixed: "Mixed / Lifestyle",
  dynamic: "Dynamic",
  fidelity: "Fidelity Series",
  bond: "Fixed Income",
  conservative: "Conservative",
  guaranteed: "Guaranteed",
  dis: "Default Investment Strategy",
};

// Outlier threshold for alert triggers
export const PRICE_OUTLIER_THRESHOLD_PCT = 2;

// Insight disclaimer text
export const INSIGHT_DISCLAIMER = {
  en: "Internal reference material for AIA team discussion. Not financial advice. Generated by AIA MPF Care Profile.",
  zh: "此為AIA團隊內部討論參考資料，並非投資建議。由AIA強積金護理檔案生成。",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/constants.ts
git commit -m "feat(mpf): add fund registry (25 funds) and impact tag mapping"
```

---

### Task 4: Seed Fund Data into Database

**Files:**
- Create: `src/app/api/mpf/seed/route.ts`

- [ ] **Step 1: Write seed endpoint (admin-only, one-time use)**

```typescript
// src/app/api/mpf/seed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AIA_FUNDS } from "@/lib/mpf/constants";
import type { UserRole } from "@/lib/types";

export async function POST(req: NextRequest) {
  // Admin-only
  const supabaseAuth = await createClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabaseAuth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if ((profile?.role as UserRole) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Check if already seeded
  const { count } = await supabase
    .from("mpf_funds")
    .select("*", { count: "exact", head: true });

  if (count && count > 0) {
    return NextResponse.json({ message: "Already seeded", count }, { status: 200 });
  }

  const { data, error } = await supabase
    .from("mpf_funds")
    .insert(AIA_FUNDS.map((f) => ({
      fund_code: f.fund_code,
      name_en: f.name_en,
      name_zh: f.name_zh,
      category: f.category,
      risk_rating: f.risk_rating,
    })))
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "Seeded", count: data.length });
}
```

- [ ] **Step 2: Run seed endpoint**

```bash
curl -X POST http://localhost:3000/api/mpf/seed
```

Expected: `{"message":"Seeded","count":25}`

- [ ] **Step 3: Verify in Supabase dashboard**

Check `mpf_funds` table has 25 rows with correct fund codes, names, categories.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mpf/seed/route.ts
git commit -m "feat(mpf): add fund seed endpoint — 25 AIA Prime Value Choice funds"
```

---

### Task 5: Permissions Extension

**Files:**
- Modify: `src/lib/permissions.ts`

- [ ] **Step 1: Add MPF-specific permission functions**

Add to the existing permissions.ts (keep all existing functions):

```typescript
// MPF Care permissions
export function canTriggerMpfRefresh(role: UserRole): boolean {
  return role === "admin" || role === "manager";
}

export function canUploadMpfData(role: UserRole): boolean {
  return role === "admin";
}

export function canGenerateInsight(role: UserRole): boolean {
  return role === "admin" || role === "manager";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/permissions.ts
git commit -m "feat(mpf): add permission functions for refresh, upload, insight generation"
```

---

### Task 6: Navigation — Add MPF Care to Nav

**Files:**
- Modify: `src/components/nav/top-nav.tsx`
- Modify: `src/components/nav/mobile-nav.tsx`

- [ ] **Step 1: Update TopNav — add MPF Care item between Dashboard and Chat**

In `top-nav.tsx`, update the navItems array and add the `TrendingUp` icon import:

```typescript
// Add to imports:
import { LayoutDashboard, TrendingUp, MessageSquare, ShieldCheck, FileText, BookOpen, Users } from "lucide-react";

// Replace navItems array:
const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "MPF Care", href: "/mpf-care", icon: TrendingUp },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Claim Check", href: "/claim-check", icon: ShieldCheck },
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "FAQs", href: "/faqs", icon: BookOpen },
  { label: "Team", href: "/team", icon: Users },
];
```

Add alert badge support — update the TopNav props to accept `mpfAlertCount`:

```typescript
export function TopNav({
  userInitials,
  pendingCount = 0,
  mpfAlertCount = 0,
}: {
  userInitials: string;
  pendingCount?: number;
  mpfAlertCount?: number;
}) {
```

Inside the nav item render, add MPF alert badge (same pattern as Team pending badge):

```typescript
{item.label === "MPF Care" && mpfAlertCount > 0 && (
  <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500" />
)}
```

- [ ] **Step 2: Update MobileNav — add MPF item**

In `mobile-nav.tsx`, update imports and navItems:

```typescript
import { LayoutDashboard, TrendingUp, MessageSquare, ShieldCheck, FileText, Users } from "lucide-react";

const navItems = [
  { label: "Home", href: "/dashboard", icon: LayoutDashboard },
  { label: "MPF", href: "/mpf-care", icon: TrendingUp },
  { label: "Chat", href: "/chat", icon: MessageSquare },
  { label: "Check", href: "/claim-check", icon: ShieldCheck },
  { label: "Docs", href: "/documents", icon: FileText },
];
```

Note: Team is dropped from mobile nav (5-item limit for thumb reach). Users access Team via TopNav on desktop.

- [ ] **Step 3: Update App Layout — pass mpfAlertCount to TopNav**

In `src/app/(app)/layout.tsx`, add query for unread MPF insights:

After the pending delete request query, add:

```typescript
// Check for new MPF insights (generated in last 24h)
const { count: mpfAlertCount } = await supabase
  .from("mpf_insights")
  .select("*", { count: "exact", head: true })
  .eq("status", "completed")
  .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
```

Update the TopNav render:

```typescript
<TopNav
  userInitials={initials || "?"}
  pendingCount={pendingCount}
  mpfAlertCount={mpfAlertCount || 0}
/>
```

- [ ] **Step 4: Verify nav renders correctly**

Start dev server, confirm:
- "MPF Care" appears between Dashboard and Chat in TopNav
- "MPF" appears in MobileNav
- Clicking navigates to `/mpf-care` (will 404 until pages are built — that's expected)

- [ ] **Step 5: Commit**

```bash
git add src/components/nav/top-nav.tsx src/components/nav/mobile-nav.tsx src/app/\(app\)/layout.tsx
git commit -m "feat(mpf): add MPF Care to navigation with alert badge"
```

---

## Phase 2: Data Pipeline (Scrapers + Cron)

### Task 7: Fund Price Scraper

**Files:**
- Create: `src/lib/mpf/scrapers/fund-prices.ts`

- [ ] **Step 1: Write the fund price scraper**

This scraper fetches fund NAV data. Primary source: MPFA Fund Platform (Excel). Secondary: AAStocks HTML (Cheerio).

```typescript
// src/lib/mpf/scrapers/fund-prices.ts
import * as cheerio from "cheerio";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PriceSource } from "../types";

interface ScrapedPrice {
  fund_code: string;
  date: string; // YYYY-MM-DD
  nav: number;
  source: PriceSource;
}

// Static lookup: AAStocks fund display names → our internal fund codes.
// UPDATE this map if AAStocks changes their fund naming.
const AASTOCKS_NAME_TO_CODE: Record<string, string> = {
  "Asian Equity Fund": "AIA-AEF",
  "European Equity Fund": "AIA-EEF",
  "Greater China Equity Fund": "AIA-GCF",
  "Hong Kong Equity Fund": "AIA-HEF",
  "Japan Equity Fund": "AIA-JEF",
  "North American Equity Fund": "AIA-NAF",
  "Green Fund": "AIA-GRF",
  "American Index Tracking Fund": "AIA-AMI",
  "Eurasia Index Tracking Fund": "AIA-EAI",
  "Hong Kong and China Index Tracking Fund": "AIA-HCI",
  "World Index Tracking Fund": "AIA-WIF",
  "Growth Fund": "AIA-GRW",
  "Balanced Fund": "AIA-BAL",
  "Capital Stable Fund": "AIA-CST",
  "China Hong Kong Dynamic Fund": "AIA-CHD",
  "Manager's Choice Fund": "AIA-MCF",
  "Fidelity Growth Fund": "AIA-FGR",
  "Fidelity Stable Growth Fund": "AIA-FSG",
  "Fidelity Capital Stable Fund": "AIA-FCS",
  "Asian Bond Fund": "AIA-ABF",
  "Global Bond Fund": "AIA-GBF",
  "MPF Conservative Fund": "AIA-CON",
  "Guaranteed Portfolio": "AIA-GPF",
  "Core Accumulation Fund": "AIA-CAF",
  "Age 65 Plus Fund": "AIA-65P",
};

/**
 * Match scraped fund name to internal fund code using static lookup.
 * Falls back to fuzzy match on key words.
 */
function matchFundCode(scrapedName: string): string | null {
  // Exact match first
  const exact = AASTOCKS_NAME_TO_CODE[scrapedName];
  if (exact) return exact;

  // Fuzzy: check if any lookup key is contained in the scraped name
  const lower = scrapedName.toLowerCase();
  for (const [displayName, code] of Object.entries(AASTOCKS_NAME_TO_CODE)) {
    if (lower.includes(displayName.toLowerCase())) return code;
  }

  return null;
}

/**
 * Scrape AAStocks MPF fund prices page.
 * This is the SECONDARY source — used when MPFA Excel is unavailable.
 */
export async function scrapeAAStocksPrices(): Promise<ScrapedPrice[]> {
  const prices: ScrapedPrice[] = [];

  // AAStocks MPF overview page lists all AIA funds
  const res = await fetch("https://www.aastocks.com/en/mpf/fundlist.aspx?t=1&s=AIA", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AIA-Hub/1.0)" },
  });

  if (!res.ok) {
    throw new Error(`AAStocks fetch failed: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Parse fund table rows — structure may change, log HTML for debugging
  // Each row: fund name | NAV | date | 1D change
  $("table.mpf-fund-table tr").each((_i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 4) return;

    const name = $(cells[0]).text().trim();
    const navText = $(cells[1]).text().trim();
    const dateText = $(cells[2]).text().trim();

    const nav = parseFloat(navText.replace(/[^0-9.]/g, ""));
    if (isNaN(nav)) return;

    // Match to our fund code via static lookup
    const fundCode = matchFundCode(name);
    if (!fundCode) return;

    // Parse date (format: DD/MM/YYYY → YYYY-MM-DD)
    const [dd, mm, yyyy] = dateText.split("/");
    if (!dd || !mm || !yyyy) return;
    const date = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;

    prices.push({ fund_code: fundCode, date, nav, source: "aastocks" });
  });

  return prices;
}

/**
 * Upsert scraped prices into mpf_prices table.
 * Calculates daily_change_pct from previous day's NAV.
 */
export async function upsertPrices(prices: ScrapedPrice[]): Promise<number> {
  if (prices.length === 0) return 0;

  const supabase = createAdminClient();

  // Get fund_id map
  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("id, fund_code");

  const fundMap = new Map(funds?.map((f) => [f.fund_code, f.id]) || []);

  let upserted = 0;

  for (const price of prices) {
    const fund_id = fundMap.get(price.fund_code);
    if (!fund_id) continue;

    // Get previous day's NAV for daily_change_pct
    const { data: prev } = await supabase
      .from("mpf_prices")
      .select("nav")
      .eq("fund_id", fund_id)
      .lt("date", price.date)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const daily_change_pct = prev?.nav
      ? Number((((price.nav - prev.nav) / prev.nav) * 100).toFixed(4))
      : null;

    const { error } = await supabase
      .from("mpf_prices")
      .upsert(
        { fund_id, date: price.date, nav: price.nav, daily_change_pct, source: price.source },
        { onConflict: "fund_id,date" }
      );

    if (!error) upserted++;
  }

  return upserted;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/scrapers/fund-prices.ts
git commit -m "feat(mpf): add fund price scraper (AAStocks + upsert logic)"
```

---

### Task 8: News Collector

**Files:**
- Create: `src/lib/mpf/scrapers/news-collector.ts`

- [ ] **Step 1: Write news collector using NewsAPI.org**

```typescript
// src/lib/mpf/scrapers/news-collector.ts
import { createAdminClient } from "@/lib/supabase/admin";

interface NewsApiArticle {
  title: string;
  description: string | null;
  source: { name: string };
  url: string;
  publishedAt: string;
}

interface NewsApiResponse {
  status: string;
  totalResults: number;
  articles: NewsApiArticle[];
}

const QUERIES = [
  { q: "Hong Kong stock market OR Hang Seng", region: "hk" as const },
  { q: "China economy OR Shanghai composite OR yuan", region: "china" as const },
  { q: "Asia Pacific markets OR Asian stocks", region: "asia" as const },
  { q: "global markets OR Federal Reserve OR interest rates OR inflation", region: "global" as const },
  { q: "MPF OR mandatory provident fund", region: "hk" as const },
];

/**
 * Fetch news from NewsAPI.org.
 * Requires NEWSAPI_KEY env var.
 * Free tier: 100 requests/day, business plan: unlimited.
 */
export async function fetchNews(): Promise<number> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) throw new Error("NEWSAPI_KEY not set");

  const supabase = createAdminClient();
  let totalInserted = 0;

  for (const query of QUERIES) {
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", query.q);
    url.searchParams.set("language", "en");
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("apiKey", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) continue;

    const data: NewsApiResponse = await res.json();
    if (data.status !== "ok") continue;

    for (const article of data.articles) {
      if (!article.title || article.title === "[Removed]") continue;

      // Dedup by headline + published_at (same headline within 1 hour = duplicate)
      const pubTime = new Date(article.publishedAt);
      const hourBefore = new Date(pubTime.getTime() - 3600_000).toISOString();
      const hourAfter = new Date(pubTime.getTime() + 3600_000).toISOString();
      const { count } = await supabase
        .from("mpf_news")
        .select("*", { count: "exact", head: true })
        .eq("headline", article.title)
        .gte("published_at", hourBefore)
        .lte("published_at", hourAfter);

      if (count && count > 0) continue;

      // Insert with placeholder classification (will be classified by AI in next step)
      const { error } = await supabase.from("mpf_news").insert({
        headline: article.title,
        summary: article.description,
        source: article.source.name,
        url: article.url,
        published_at: article.publishedAt,
        region: query.region,
        category: "markets", // placeholder — AI classifies next
        impact_tags: [],
        sentiment: "neutral", // placeholder
        is_high_impact: false,
      });

      if (!error) totalInserted++;
    }
  }

  return totalInserted;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/scrapers/news-collector.ts
git commit -m "feat(mpf): add news collector (NewsAPI.org, 5 query categories)"
```

---

### Task 9: News Classification (AI)

**Files:**
- Create: `src/lib/mpf/classification.ts`

- [ ] **Step 1: Write news classification using minimax-m2.5**

```typescript
// src/lib/mpf/classification.ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { NewsCategory, NewsRegion, Sentiment } from "./types";

interface ClassificationResult {
  sentiment: Sentiment;
  category: NewsCategory;
  region: NewsRegion;
  impact_tags: string[];
  is_high_impact: boolean;
}

/**
 * Classify a news article using minimax-m2.5 via Ollama Cloud.
 * Fast (~1s per article).
 */
async function classifyArticle(headline: string, summary: string | null): Promise<ClassificationResult> {
  const ollamaUrl = process.env.OLLAMA_CLOUD_URL || "https://api.ollama.cloud/v1";
  const ollamaKey = process.env.OLLAMA_CLOUD_KEY;

  const prompt = `Classify this financial news article. Return ONLY valid JSON, no markdown.

Headline: ${headline}
${summary ? `Summary: ${summary}` : ""}

Return JSON with these exact fields:
{
  "sentiment": "positive" | "negative" | "neutral",
  "category": "markets" | "geopolitical" | "policy" | "macro",
  "region": "global" | "asia" | "hk" | "china",
  "impact_tags": ["hk_equity", "asia_equity", "us_equity", "eu_equity", "global_equity", "bond", "fx", "rates", "china", "green_esg"],
  "is_high_impact": true | false
}

Rules for is_high_impact:
- true if sentiment=negative AND impact_tags has 3+ items
- true if category=policy AND region is hk or china
- false otherwise

Only include relevant impact_tags (usually 1-3).`;

  const res = await fetch(`${ollamaUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ollamaKey ? { Authorization: `Bearer ${ollamaKey}` } : {}),
    },
    body: JSON.stringify({
      model: "minimax-m2.5",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`Ollama classification failed: ${res.status}`);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Parse JSON from response (handle potential markdown wrapping)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { sentiment: "neutral", category: "markets", region: "global", impact_tags: [], is_high_impact: false };
  }

  const parsed = JSON.parse(jsonMatch[0]);

  return {
    sentiment: parsed.sentiment || "neutral",
    category: parsed.category || "markets",
    region: parsed.region || "global",
    impact_tags: Array.isArray(parsed.impact_tags) ? parsed.impact_tags : [],
    is_high_impact: parsed.is_high_impact === true,
  };
}

/**
 * Classify all unclassified news (placeholder sentiment=neutral, empty impact_tags).
 */
export async function classifyUnclassifiedNews(): Promise<number> {
  const supabase = createAdminClient();

  // Get news with empty impact_tags (unclassified)
  const { data: unclassified } = await supabase
    .from("mpf_news")
    .select("id, headline, summary")
    .eq("impact_tags", "{}")
    .order("published_at", { ascending: false })
    .limit(50);

  if (!unclassified?.length) return 0;

  let classified = 0;

  for (const article of unclassified) {
    try {
      const result = await classifyArticle(article.headline, article.summary);

      await supabase
        .from("mpf_news")
        .update({
          sentiment: result.sentiment,
          category: result.category,
          region: result.region,
          impact_tags: result.impact_tags,
          is_high_impact: result.is_high_impact,
        })
        .eq("id", article.id);

      classified++;
    } catch {
      // Skip failed classifications, retry next run
      continue;
    }
  }

  return classified;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/classification.ts
git commit -m "feat(mpf): add AI news classification via minimax-m2.5"
```

---

### Task 10: Cron API Routes

**Files:**
- Create: `src/app/api/mpf/cron/prices/route.ts`
- Create: `src/app/api/mpf/cron/news/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Write price cron route**

```typescript
// src/app/api/mpf/cron/prices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrapeAAStocksPrices, upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import { PRICE_OUTLIER_THRESHOLD_PCT } from "@/lib/mpf/constants";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  // Log scraper run start
  const { data: run } = await supabase
    .from("scraper_runs")
    .insert({ scraper_name: "fund_prices", status: "running" })
    .select()
    .single();

  try {
    const prices = await scrapeAAStocksPrices();
    const count = await upsertPrices(prices);

    // Update scraper run
    await supabase
      .from("scraper_runs")
      .update({
        status: "success",
        records_processed: count,
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    // Check for outliers in just-upserted prices
    const today = new Date().toISOString().split("T")[0];
    const { data: todayPrices } = await supabase
      .from("mpf_prices")
      .select("fund_id, daily_change_pct")
      .eq("date", today)
      .not("daily_change_pct", "is", null);

    const outlierFunds = todayPrices?.filter(
      (p) => Math.abs(p.daily_change_pct || 0) >= PRICE_OUTLIER_THRESHOLD_PCT
    );

    // If outliers found, trigger alert insight (async — don't wait)
    if (outlierFunds && outlierFunds.length > 0) {
      const fundIds = outlierFunds.map((f) => f.fund_id);
      await supabase.from("mpf_insights").insert({
        type: "alert",
        trigger: `price_outlier: ${outlierFunds.length} fund(s) moved >${PRICE_OUTLIER_THRESHOLD_PCT}%`,
        fund_ids: fundIds,
        status: "pending",
      });
    }

    return NextResponse.json({ ok: true, count, outliers: outlierFunds?.length || 0 });
  } catch (error) {
    await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    return NextResponse.json({ error: "Scrape failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write news cron route**

```typescript
// src/app/api/mpf/cron/news/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchNews } from "@/lib/mpf/scrapers/news-collector";
import { classifyUnclassifiedNews } from "@/lib/mpf/classification";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const startTime = Date.now();

  const { data: run } = await supabase
    .from("scraper_runs")
    .insert({ scraper_name: "news_collector", status: "running" })
    .select()
    .single();

  try {
    // Step 1: Fetch news
    const fetched = await fetchNews();

    // Step 2: Classify unclassified news
    const classified = await classifyUnclassifiedNews();

    // Step 3: Check for high-impact news → trigger insight
    const { data: highImpact } = await supabase
      .from("mpf_news")
      .select("id")
      .eq("is_high_impact", true)
      .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (highImpact && highImpact.length > 0) {
      // Check if we already have a recent alert insight
      const { count: recentAlerts } = await supabase
        .from("mpf_insights")
        .select("*", { count: "exact", head: true })
        .eq("type", "alert")
        .gte("created_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString());

      if (!recentAlerts || recentAlerts === 0) {
        await supabase.from("mpf_insights").insert({
          type: "alert",
          trigger: "high_impact_news",
          status: "pending",
        });
      }
    }

    await supabase
      .from("scraper_runs")
      .update({
        status: "success",
        records_processed: fetched + classified,
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    return NextResponse.json({ ok: true, fetched, classified });
  } catch (error) {
    await supabase
      .from("scraper_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown error",
        duration_ms: Date.now() - startTime,
      })
      .eq("id", run?.id);

    return NextResponse.json({ error: "News collection failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create vercel.json with cron schedules**

```json
{
  "crons": [
    {
      "path": "/api/mpf/cron/prices",
      "schedule": "0 11 * * 1-5"
    },
    {
      "path": "/api/mpf/cron/news",
      "schedule": "0 */6 * * *"
    },
    {
      "path": "/api/mpf/cron/weekly",
      "schedule": "0 15 * * 0"
    }
  ]
}
```

Note: `maxDuration` is set via `export const maxDuration = 120` in each route file (the canonical Next.js 16 approach). No `functions` block needed in vercel.json.

Schedule notes:
- Prices: 11:00 UTC = 7pm HKT, weekdays only
- News: every 6 hours
- Weekly insight: 15:00 UTC Sunday = 11pm HKT Sunday

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mpf/cron/ vercel.json
git commit -m "feat(mpf): add cron routes for prices + news + vercel.json schedules"
```

---

## Phase 3: AI Insights

### Task 11: Insight Generation Engine

**Files:**
- Create: `src/lib/mpf/insights.ts`

- [ ] **Step 1: Write DeepSeek V3 insight generation**

```typescript
// src/lib/mpf/insights.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { INSIGHT_DISCLAIMER, FUND_CATEGORY_LABELS, IMPACT_TAG_TO_CATEGORIES } from "./constants";
import type { MpfInsight } from "./types";

/**
 * Generate an AI insight using DeepSeek V3 via Ollama Cloud.
 * Updates mpf_insights row status from pending → generating → completed/failed.
 */
export async function generateInsight(insightId: string): Promise<void> {
  const supabase = createAdminClient();
  const ollamaUrl = process.env.OLLAMA_CLOUD_URL || "https://api.ollama.cloud/v1";
  const ollamaKey = process.env.OLLAMA_CLOUD_KEY;

  // Mark as generating
  await supabase
    .from("mpf_insights")
    .update({ status: "generating" })
    .eq("id", insightId);

  try {
    // Get the insight record
    const { data: insight } = await supabase
      .from("mpf_insights")
      .select("*")
      .eq("id", insightId)
      .single();

    if (!insight) throw new Error("Insight not found");

    // Gather context data
    const context = await gatherInsightContext(insight);

    // Generate English version
    const contentEn = await callDeepSeek(ollamaUrl, ollamaKey, buildPrompt(context, "en"));

    // Generate Chinese version
    const contentZh = await callDeepSeek(ollamaUrl, ollamaKey, buildPrompt(context, "zh"));

    // Determine which fund categories are covered
    const fundCategories = determineFundCategories(context);

    await supabase
      .from("mpf_insights")
      .update({
        status: "completed",
        content_en: `${INSIGHT_DISCLAIMER.en}\n\n${contentEn}`,
        content_zh: `${INSIGHT_DISCLAIMER.zh}\n\n${contentZh}`,
        fund_categories: fundCategories,
      })
      .eq("id", insightId);
  } catch (error) {
    await supabase
      .from("mpf_insights")
      .update({
        status: "failed",
        content_en: `Generation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
      .eq("id", insightId);
  }
}

async function gatherInsightContext(insight: MpfInsight) {
  const supabase = createAdminClient();

  // Get recent prices (last 7 days)
  const { data: recentPrices } = await supabase
    .from("mpf_prices")
    .select("fund_id, date, nav, daily_change_pct, mpf_funds(fund_code, name_en, category)")
    .gte("date", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
    .order("date", { ascending: false });

  // Get recent high-impact news (last 7 days)
  const { data: recentNews } = await supabase
    .from("mpf_news")
    .select("headline, summary, region, category, sentiment, impact_tags, published_at")
    .gte("published_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order("published_at", { ascending: false })
    .limit(20);

  // Get top movers
  const { data: topMovers } = await supabase
    .from("mpf_prices")
    .select("daily_change_pct, mpf_funds(fund_code, name_en)")
    .eq("date", new Date().toISOString().split("T")[0])
    .not("daily_change_pct", "is", null)
    .order("daily_change_pct", { ascending: false })
    .limit(5);

  return {
    type: insight.type,
    trigger: insight.trigger,
    fund_ids: insight.fund_ids,
    recentPrices: recentPrices || [],
    recentNews: recentNews || [],
    topMovers: topMovers || [],
  };
}

function buildPrompt(context: Awaited<ReturnType<typeof gatherInsightContext>>, lang: "en" | "zh"): string {
  const langInstruction = lang === "zh"
    ? "Respond in Traditional Chinese (繁體中文). Use formal financial terminology."
    : "Respond in English.";

  return `You are the AIA MPF Care Profile analyst. Generate a ${context.type} insight report.

${langInstruction}

CONTEXT:
- Trigger: ${context.trigger}
- Period: Last 7 days

RECENT FUND PERFORMANCE:
${JSON.stringify(context.recentPrices.slice(0, 30), null, 2)}

TOP MOVERS TODAY:
${JSON.stringify(context.topMovers, null, 2)}

RECENT NEWS:
${JSON.stringify(context.recentNews, null, 2)}

FORMAT:
1. Market Overview (2-3 sentences)
2. Key Movements (bullet points — which funds moved, why)
3. News Impact Analysis (how news events correlate with fund movements)
4. Rebalancing Considerations (what AIA agents should discuss with clients — NOT advice, just talking points)
5. Outlook (1-2 sentences on near-term expectations)

RULES:
- This is internal reference material, NOT financial advice
- Be specific about fund names and percentage changes
- Cite news events when explaining movements
- Keep under 500 words`;
}

async function callDeepSeek(baseUrl: string, apiKey: string | undefined, prompt: string): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: "deepseek-v3",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek API failed: ${res.status}`);

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function determineFundCategories(context: Awaited<ReturnType<typeof gatherInsightContext>>): string[] {
  if (context.type === "weekly") {
    return Object.keys(FUND_CATEGORY_LABELS);
  }

  // For alert insights, map impact tags → actual fund categories
  const categories = new Set<string>();
  for (const news of context.recentNews) {
    if (news.impact_tags) {
      for (const tag of news.impact_tags) {
        const mapped = IMPACT_TAG_TO_CATEGORIES[tag];
        if (mapped) mapped.forEach((c) => categories.add(c));
      }
    }
  }
  return Array.from(categories);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/mpf/insights.ts
git commit -m "feat(mpf): add DeepSeek V3 insight generation engine"
```

---

### Task 12: Weekly Insight Cron + On-Demand API

**Files:**
- Create: `src/app/api/mpf/cron/weekly/route.ts`
- Create: `src/app/api/mpf/insights/route.ts`
- Create: `src/app/api/mpf/insights/[id]/route.ts`

- [ ] **Step 1: Write weekly cron route**

```typescript
// src/app/api/mpf/cron/weekly/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsight } from "@/lib/mpf/insights";

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Create pending insight
  const { data: insight } = await supabase
    .from("mpf_insights")
    .insert({
      type: "weekly",
      trigger: "weekly_cron",
      status: "pending",
    })
    .select()
    .single();

  if (!insight) {
    return NextResponse.json({ error: "Failed to create insight" }, { status: 500 });
  }

  // Generate (this takes ~40s per language, ~80s total)
  await generateInsight(insight.id);

  return NextResponse.json({ ok: true, insightId: insight.id });
}
```

- [ ] **Step 2: Write on-demand insight trigger API**

```typescript
// src/app/api/mpf/insights/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canGenerateInsight } from "@/lib/permissions";
import { generateInsight } from "@/lib/mpf/insights";
import type { UserRole } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile?.role || "agent") as UserRole;
  if (!canGenerateInsight(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Create pending insight
  const { data: insight } = await admin
    .from("mpf_insights")
    .insert({
      type: "on_demand",
      trigger: `manual:${user.email}`,
      status: "pending",
    })
    .select()
    .single();

  if (!insight) {
    return NextResponse.json({ error: "Failed to create insight" }, { status: 500 });
  }

  // Fire and forget — don't await. Client polls via GET /api/mpf/insights/[id]
  generateInsight(insight.id).catch((e) => console.error("[mpf/insights] generation failed:", e));

  return NextResponse.json({ id: insight.id, status: "pending" });
}
```

- [ ] **Step 3: Write insight status polling endpoint**

```typescript
// src/app/api/mpf/insights/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: insight } = await supabase
    .from("mpf_insights")
    .select("id, status, content_en, content_zh, type, trigger, created_at")
    .eq("id", id)
    .single();

  if (!insight) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(insight);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mpf/cron/weekly/route.ts src/app/api/mpf/insights/
git commit -m "feat(mpf): add weekly cron + on-demand insight API with status polling"
```

---

### Task 13: Alert Trigger Logic

**Files:**
- Create: `src/lib/mpf/alerts.ts`

- [ ] **Step 1: Write alert processing**

```typescript
// src/lib/mpf/alerts.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInsight } from "./insights";

/**
 * Process pending alert insights.
 * Called after price scrape (outliers) and news collection (high-impact).
 * Picks up insights with status=pending and generates them.
 */
export async function processPendingAlerts(): Promise<number> {
  const supabase = createAdminClient();

  const { data: pending } = await supabase
    .from("mpf_insights")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(3); // Process max 3 at a time

  if (!pending?.length) return 0;

  let processed = 0;
  for (const insight of pending) {
    try {
      await generateInsight(insight.id);
      processed++;
    } catch {
      continue;
    }
  }

  return processed;
}
```

- [ ] **Step 2: Wire alert processing into existing cron routes**

Add to the end of both `prices/route.ts` and `news/route.ts` (after the main scrape logic, before the return):

```typescript
// Process any pending alert insights
import { processPendingAlerts } from "@/lib/mpf/alerts";
// ... at the end of the try block:
const alertsProcessed = await processPendingAlerts();
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/mpf/alerts.ts src/app/api/mpf/cron/prices/route.ts src/app/api/mpf/cron/news/route.ts
git commit -m "feat(mpf): add alert trigger logic — process pending insights after scrapes"
```

---

## Phase 4: UI Pages

### Task 14: Shared UI Components

**Files:**
- Create: `src/components/mpf/disclaimer-banner.tsx`
- Create: `src/components/mpf/top-movers.tsx`
- Create: `src/components/mpf/fund-heatmap.tsx`

- [ ] **Step 1: Write disclaimer banner**

```typescript
// src/components/mpf/disclaimer-banner.tsx
import { INSIGHT_DISCLAIMER } from "@/lib/mpf/constants";

export function DisclaimerBanner({ lang = "en" }: { lang?: "en" | "zh" }) {
  return (
    <aside
      role="note"
      aria-label="Disclaimer"
      className="text-[11px] text-zinc-600 font-mono border border-zinc-800/40 rounded-md px-4 py-2.5"
    >
      {lang === "zh" ? INSIGHT_DISCLAIMER.zh : INSIGHT_DISCLAIMER.en}
    </aside>
  );
}
```

- [ ] **Step 2: Write top movers component**

```typescript
// src/components/mpf/top-movers.tsx
import { cn } from "@/lib/utils";
import type { FundWithLatestPrice } from "@/lib/mpf/types";

export function TopMovers({ funds }: { funds: FundWithLatestPrice[] }) {
  // Sort by absolute daily change
  const sorted = [...funds]
    .filter((f) => f.daily_change_pct !== null)
    .sort((a, b) => Math.abs(b.daily_change_pct || 0) - Math.abs(a.daily_change_pct || 0))
    .slice(0, 5);

  if (sorted.length === 0) {
    return <p className="text-sm text-zinc-500">No price data for today yet.</p>;
  }

  return (
    <ol className="space-y-0 divide-y divide-zinc-800/60">
      {sorted.map((fund) => (
        <li key={fund.id} className="flex items-center justify-between py-3 first:pt-0">
          <div>
            <span className="text-[13px] text-zinc-300">{fund.name_en}</span>
            <span className="text-[11px] text-zinc-600 ml-2 font-mono">{fund.fund_code}</span>
          </div>
          <span
            className={cn(
              "text-[13px] font-mono font-semibold tabular-nums",
              (fund.daily_change_pct || 0) > 0 ? "text-emerald-400" : "text-red-400"
            )}
          >
            {(fund.daily_change_pct || 0) > 0 ? "+" : ""}
            {fund.daily_change_pct?.toFixed(2)}%
          </span>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Write fund heatmap component**

```typescript
// src/components/mpf/fund-heatmap.tsx
"use client";

import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { FundWithLatestPrice } from "@/lib/mpf/types";
import { FUND_CATEGORY_LABELS } from "@/lib/mpf/constants";
import type { FundCategory } from "@/lib/mpf/types";

export function FundHeatmap({ funds }: { funds: FundWithLatestPrice[] }) {
  const router = useRouter();

  // Group by category
  const grouped = funds.reduce(
    (acc, fund) => {
      const cat = fund.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(fund);
      return acc;
    },
    {} as Record<string, FundWithLatestPrice[]>
  );

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, catFunds]) => (
        <section key={category}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 mb-3">
            {FUND_CATEGORY_LABELS[category as FundCategory] || category}
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {catFunds.map((fund) => {
              const pct = fund.daily_change_pct || 0;
              return (
                <button
                  key={fund.id}
                  onClick={() => router.push(`/mpf-care/funds/${fund.fund_code}`)}
                  className={cn(
                    "p-3 rounded-md text-left transition-colors cursor-pointer border",
                    pct > 1 ? "bg-emerald-950/40 border-emerald-800/30" :
                    pct > 0 ? "bg-emerald-950/20 border-emerald-900/20" :
                    pct < -1 ? "bg-red-950/40 border-red-800/30" :
                    pct < 0 ? "bg-red-950/20 border-red-900/20" :
                    "bg-zinc-900/40 border-zinc-800/30"
                  )}
                >
                  <div className="text-[11px] font-mono text-zinc-500">{fund.fund_code}</div>
                  <div className="text-[12px] text-zinc-300 mt-0.5 truncate">{fund.name_en}</div>
                  <div
                    className={cn(
                      "text-[14px] font-mono font-semibold mt-1 tabular-nums",
                      pct > 0 ? "text-emerald-400" : pct < 0 ? "text-red-400" : "text-zinc-500"
                    )}
                  >
                    {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/mpf/
git commit -m "feat(mpf): add shared UI components — disclaimer, top movers, heatmap"
```

---

### Task 15: Overview Page (`/mpf-care`)

**Files:**
- Create: `src/app/(app)/mpf-care/page.tsx`

- [ ] **Step 1: Write the overview page (server component)**

```typescript
// src/app/(app)/mpf-care/page.tsx
import { createClient } from "@/lib/supabase/server";
import { FundHeatmap } from "@/components/mpf/fund-heatmap";
import { TopMovers } from "@/components/mpf/top-movers";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import type { FundWithLatestPrice, MpfNews, MpfInsight } from "@/lib/mpf/types";
import { TrendingUp, Newspaper, Brain } from "lucide-react";

async function getOverviewData() {
  const supabase = await createClient();

  // Get all funds with latest price
  const { data: funds } = await supabase
    .from("mpf_funds")
    .select("*")
    .eq("is_active", true)
    .order("fund_code");

  // Get today's prices
  const today = new Date().toISOString().split("T")[0];
  const { data: todayPrices } = await supabase
    .from("mpf_prices")
    .select("fund_id, nav, daily_change_pct, date")
    .eq("date", today);

  // If no today prices, get latest price per fund
  let prices = todayPrices;
  let priceDate = today;
  if (!prices?.length) {
    // Fetch enough rows to cover all 25 funds even with sparse data
    const { data: latestPrices } = await supabase
      .from("mpf_prices")
      .select("fund_id, nav, daily_change_pct, date")
      .order("date", { ascending: false })
      .limit(200);
    // Deduplicate: keep only the latest price per fund_id
    const seen = new Set<string>();
    prices = (latestPrices || []).filter((p) => {
      if (seen.has(p.fund_id)) return false;
      seen.add(p.fund_id);
      return true;
    });
    priceDate = prices?.[0]?.date || today;
  }

  const priceMap = new Map(prices?.map((p) => [p.fund_id, p]) || []);

  const fundsWithPrices: FundWithLatestPrice[] = (funds || []).map((f) => {
    const price = priceMap.get(f.id);
    return {
      ...f,
      latest_nav: price?.nav || null,
      daily_change_pct: price?.daily_change_pct || null,
      price_date: price?.date || null,
    };
  });

  // Get latest news (5 items)
  const { data: news } = await supabase
    .from("mpf_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(5);

  // Get latest completed insight
  const { data: latestInsight } = await supabase
    .from("mpf_insights")
    .select("*")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Last scraper run
  const { data: lastRun } = await supabase
    .from("scraper_runs")
    .select("run_at, status, scraper_name")
    .eq("status", "success")
    .order("run_at", { ascending: false })
    .limit(1)
    .single();

  return { fundsWithPrices, news: (news || []) as MpfNews[], latestInsight: latestInsight as MpfInsight | null, lastRun, priceDate };
}

export default async function MpfCarePage() {
  const { fundsWithPrices, news, latestInsight, lastRun, priceDate } = await getOverviewData();

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-16">
        <h1 className="text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          MPF Care
        </h1>
        <p className="text-sm text-zinc-500 mt-2 font-mono">
          AIA MPF Care Profile — Fund performance & insights
          {lastRun && (
            <span className="ml-3 text-zinc-600">
              Last updated: {new Date(lastRun.run_at).toLocaleDateString("en-HK")}
            </span>
          )}
        </p>
      </header>

      <DisclaimerBanner />

      {/* Top Movers */}
      <section aria-labelledby="top-movers-heading" className="mt-12 mb-16">
        <div className="flex items-center gap-2 mb-6">
          <TrendingUp className="w-4 h-4 text-zinc-600" />
          <h2 id="top-movers-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            Top Movers — {priceDate}
          </h2>
        </div>
        <TopMovers funds={fundsWithPrices} />
      </section>

      {/* Fund Heatmap */}
      <section aria-labelledby="heatmap-heading" className="mb-16">
        <h2 id="heatmap-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 mb-6">
          All Funds
        </h2>
        <FundHeatmap funds={fundsWithPrices} />
      </section>

      {/* Two columns: News + Latest Insight */}
      <div className="grid lg:grid-cols-2 gap-16">
        {/* Latest News */}
        <section aria-labelledby="news-heading">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-zinc-600" />
              <h2 id="news-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                Latest News
              </h2>
            </div>
            <a href="/mpf-care/news" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
              View all
            </a>
          </div>
          {news.length === 0 ? (
            <p className="text-sm text-zinc-500">No news collected yet.</p>
          ) : (
            <ol className="space-y-0 divide-y divide-zinc-800/60">
              {news.map((n) => (
                <li key={n.id} className="py-3 first:pt-0">
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    {n.headline}
                  </a>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-zinc-600">{n.source}</span>
                    <span className={`text-[10px] font-mono ${
                      n.sentiment === "positive" ? "text-emerald-500" :
                      n.sentiment === "negative" ? "text-red-500" : "text-zinc-600"
                    }`}>
                      {n.sentiment}
                    </span>
                    {n.is_high_impact && (
                      <span className="text-[10px] font-mono text-amber-500">HIGH IMPACT</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Latest Insight */}
        <section aria-labelledby="insight-heading">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-zinc-600" />
              <h2 id="insight-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                Latest Profile
              </h2>
            </div>
            <a href="/mpf-care/insights" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
              View all
            </a>
          </div>
          {latestInsight ? (
            <div className="text-[13px] text-zinc-400 leading-relaxed whitespace-pre-wrap line-clamp-[12]">
              {latestInsight.content_en}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No insights generated yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify page renders**

Navigate to `/mpf-care` in browser. Expect: header, disclaimer, empty states (no data yet).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/mpf-care/page.tsx
git commit -m "feat(mpf): add MPF Care overview page — heatmap, movers, news, insight"
```

---

### Task 16: Fund Explorer Page (`/mpf-care/funds/[fund_code]`)

**Files:**
- Create: `src/components/mpf/fund-chart.tsx`
- Create: `src/app/(app)/mpf-care/funds/[fund_code]/page.tsx`

- [ ] **Step 1: Write the Recharts fund chart component**

```typescript
// src/components/mpf/fund-chart.tsx
"use client";

import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface PricePoint {
  date: string;
  nav: number;
}

const PERIODS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "5Y", days: 1825 },
] as const;

export function FundChart({ prices }: { prices: PricePoint[] }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["label"]>("1M");

  const days = PERIODS.find((p) => p.label === period)?.days || 30;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const filtered = prices.filter((p) => p.date >= cutoff);

  return (
    <div>
      <div className="flex gap-1 mb-4" role="tablist">
        {PERIODS.map((p) => (
          <button
            key={p.label}
            role="tab"
            aria-selected={period === p.label}
            onClick={() => setPeriod(p.label)}
            className={cn(
              "text-[11px] font-mono px-3 py-1 rounded-md transition-colors cursor-pointer",
              period === p.label
                ? "bg-zinc-800 text-zinc-200"
                : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={filtered}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "#71717a" }}
            tickFormatter={(d: string) => d.slice(5)} // MM-DD
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#71717a" }}
            domain={["auto", "auto"]}
            width={60}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "6px", fontSize: "12px" }}
            labelStyle={{ color: "#a1a1aa" }}
            itemStyle={{ color: "#e4e4e7" }}
          />
          <Line
            type="monotone"
            dataKey="nav"
            stroke="#D71920"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Write the fund explorer page**

```typescript
// src/app/(app)/mpf-care/funds/[fund_code]/page.tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FundChart } from "@/components/mpf/fund-chart";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import type { MpfFund, MpfPrice, MpfNews } from "@/lib/mpf/types";
import { FUND_CATEGORY_LABELS } from "@/lib/mpf/constants";
import type { FundCategory } from "@/lib/mpf/types";

export default async function FundExplorerPage({
  params,
}: {
  params: Promise<{ fund_code: string }>;
}) {
  const { fund_code } = await params;
  const supabase = await createClient();

  // Get fund
  const { data: fund } = await supabase
    .from("mpf_funds")
    .select("*")
    .eq("fund_code", fund_code)
    .single();

  if (!fund) notFound();

  // Get all prices for chart
  const { data: prices } = await supabase
    .from("mpf_prices")
    .select("date, nav, daily_change_pct, source")
    .eq("fund_id", fund.id)
    .order("date", { ascending: true });

  // Get correlated news
  const { data: correlatedNews } = await supabase
    .from("mpf_fund_news")
    .select("impact_note, mpf_news(headline, summary, source, published_at, sentiment, url)")
    .eq("fund_id", fund.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Calculate returns
  const priceList = prices || [];
  const latest = priceList[priceList.length - 1];
  const calcReturn = (daysAgo: number) => {
    if (!latest) return null;
    const targetDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const past = priceList.find((p) => p.date <= targetDate);
    if (!past) return null;
    return ((latest.nav - past.nav) / past.nav * 100);
  };

  const returns = {
    "1D": latest?.daily_change_pct || null,
    "1W": calcReturn(7),
    "1M": calcReturn(30),
    "3M": calcReturn(90),
    "1Y": calcReturn(365),
    "5Y": calcReturn(1825),
  };

  const riskStars = "★".repeat(fund.risk_rating) + "☆".repeat(5 - fund.risk_rating);

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <a href="/mpf-care" className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors">
            ← MPF Care
          </a>
        </div>
        <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          {fund.name_en}
        </h1>
        <div className="flex items-center gap-4 mt-2">
          <span className="text-[12px] font-mono text-zinc-500">{fund.fund_code}</span>
          <span className="text-[12px] text-zinc-500">{FUND_CATEGORY_LABELS[fund.category as FundCategory]}</span>
          <span className="text-[12px] text-amber-500" aria-label={`Risk rating ${fund.risk_rating} of 5`}>{riskStars}</span>
        </div>
        {latest && (
          <div className="mt-4">
            <span className="text-[clamp(1.5rem,2.5vw,2rem)] font-semibold font-mono text-zinc-50 tabular-nums">
              ${latest.nav.toFixed(4)}
            </span>
            <span className="text-[12px] font-mono text-zinc-600 ml-2">NAV as of {latest.date}</span>
          </div>
        )}
      </header>

      {/* Price Chart */}
      <section aria-label="Price chart" className="mb-16">
        <FundChart prices={priceList.map((p) => ({ date: p.date, nav: p.nav }))} />
      </section>

      {/* Returns Table */}
      <section aria-labelledby="returns-heading" className="mb-16">
        <h2 id="returns-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 mb-4">
          Performance
        </h2>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
          {Object.entries(returns).map(([period, value]) => (
            <div key={period}>
              <div className="text-[11px] font-mono text-zinc-600">{period}</div>
              <div className={`text-[16px] font-mono font-semibold tabular-nums ${
                value === null ? "text-zinc-600" :
                value > 0 ? "text-emerald-400" : "text-red-400"
              }`}>
                {value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Correlated News */}
      <section aria-labelledby="correlated-news-heading" className="mb-12">
        <h2 id="correlated-news-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 mb-4">
          Correlated News
        </h2>
        {(!correlatedNews || correlatedNews.length === 0) ? (
          <p className="text-sm text-zinc-500">No correlated news events yet.</p>
        ) : (
          <ol className="space-y-0 divide-y divide-zinc-800/60">
            {correlatedNews.map((item, i) => {
              const news = item.mpf_news as unknown as MpfNews;
              return (
                <li key={i} className="py-3 first:pt-0">
                  <a
                    href={news?.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-zinc-300 hover:text-zinc-100 transition-colors"
                  >
                    {news?.headline}
                  </a>
                  {item.impact_note && (
                    <p className="text-[12px] text-zinc-500 mt-1">{item.impact_note}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <DisclaimerBanner />
    </main>
  );
}
```

- [ ] **Step 3: Install Recharts dependency**

```bash
npm install recharts
```

- [ ] **Step 4: Commit**

```bash
git add src/components/mpf/fund-chart.tsx src/app/\(app\)/mpf-care/funds/
git commit -m "feat(mpf): add Fund Explorer page with Recharts chart + returns table"
```

---

### Task 17: News & Insights Page (`/mpf-care/news`)

**Files:**
- Create: `src/components/mpf/news-feed.tsx`
- Create: `src/app/(app)/mpf-care/news/page.tsx`

- [ ] **Step 1: Write filterable news feed component**

```typescript
// src/components/mpf/news-feed.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MpfNews, NewsRegion, NewsCategory } from "@/lib/mpf/types";

const REGIONS: { label: string; value: NewsRegion | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Global", value: "global" },
  { label: "Asia", value: "asia" },
  { label: "Hong Kong", value: "hk" },
  { label: "China", value: "china" },
];

const CATEGORIES: { label: string; value: NewsCategory | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Markets", value: "markets" },
  { label: "Geopolitical", value: "geopolitical" },
  { label: "Policy", value: "policy" },
  { label: "Macro", value: "macro" },
];

export function NewsFeed({ news }: { news: MpfNews[] }) {
  const [region, setRegion] = useState<NewsRegion | "all">("all");
  const [category, setCategory] = useState<NewsCategory | "all">("all");

  const filtered = news.filter((n) => {
    if (region !== "all" && n.region !== region) return false;
    if (category !== "all" && n.category !== category) return false;
    return true;
  });

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-6 mb-8">
        <FilterGroup label="Region" items={REGIONS} value={region} onChange={setRegion} />
        <FilterGroup label="Category" items={CATEGORIES} value={category} onChange={setCategory} />
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <p className="text-sm text-zinc-500">No news matches your filters.</p>
      ) : (
        <ol className="space-y-0 divide-y divide-zinc-800/60">
          {filtered.map((n) => (
            <li key={n.id} className="py-4 first:pt-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <a
                    href={n.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[14px] text-zinc-300 hover:text-zinc-100 transition-colors leading-relaxed"
                  >
                    {n.headline}
                  </a>
                  {n.summary && (
                    <p className="text-[12px] text-zinc-500 mt-1 line-clamp-2">{n.summary}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-[10px] font-mono text-zinc-600">{n.source}</span>
                    <span className="text-[10px] font-mono text-zinc-700">|</span>
                    <span className="text-[10px] font-mono text-zinc-600">
                      {new Date(n.published_at).toLocaleDateString("en-HK")}
                    </span>
                    <span className={`text-[10px] font-mono ${
                      n.sentiment === "positive" ? "text-emerald-500" :
                      n.sentiment === "negative" ? "text-red-500" : "text-zinc-600"
                    }`}>
                      {n.sentiment}
                    </span>
                    {n.impact_tags.map((tag) => (
                      <span key={tag} className="text-[10px] font-mono text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                {n.is_high_impact && (
                  <span className="text-[10px] font-mono text-amber-500 whitespace-nowrap shrink-0">
                    HIGH IMPACT
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="text-[10px] font-mono text-zinc-600 block mb-1.5">{label}</span>
      <div className="flex gap-0.5" role="tablist" aria-label={`Filter by ${label}`}>
        {items.map((item) => (
          <button
            key={item.value}
            role="tab"
            aria-selected={value === item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              "text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors cursor-pointer",
              value === item.value
                ? "bg-zinc-800 text-zinc-200"
                : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write news page**

```typescript
// src/app/(app)/mpf-care/news/page.tsx
import { createClient } from "@/lib/supabase/server";
import { NewsFeed } from "@/components/mpf/news-feed";
import type { MpfNews } from "@/lib/mpf/types";

export default async function MpfNewsPage() {
  const supabase = await createClient();

  const { data: news } = await supabase
    .from("mpf_news")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(100);

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <a href="/mpf-care" className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors">
            ← MPF Care
          </a>
        </div>
        <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
          News & Impact
        </h1>
        <p className="text-sm text-zinc-500 mt-2 font-mono">
          Financial news correlated with AIA MPF fund movements
        </p>
      </header>

      <NewsFeed news={(news || []) as MpfNews[]} />
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/mpf/news-feed.tsx src/app/\(app\)/mpf-care/news/
git commit -m "feat(mpf): add News & Impact page with region/category filters"
```

---

### Task 18: Rebalancing Insights Page (`/mpf-care/insights`)

**Files:**
- Create: `src/components/mpf/insight-card.tsx`
- Create: `src/app/(app)/mpf-care/insights/page.tsx`

- [ ] **Step 1: Write insight card with language toggle**

```typescript
// src/components/mpf/insight-card.tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MpfInsight } from "@/lib/mpf/types";

export function InsightCard({ insight }: { insight: MpfInsight }) {
  const [lang, setLang] = useState<"en" | "zh">("en");

  const content = lang === "zh" ? insight.content_zh : insight.content_en;
  const typeLabel = insight.type === "weekly" ? "Weekly Profile" :
                    insight.type === "alert" ? "Alert" : "On-Demand";

  return (
    <article className="border border-zinc-800/40 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className={cn(
            "text-[10px] font-mono px-2 py-0.5 rounded",
            insight.type === "weekly" ? "bg-blue-950/50 text-blue-400" :
            insight.type === "alert" ? "bg-amber-950/50 text-amber-400" :
            "bg-zinc-800 text-zinc-400"
          )}>
            {typeLabel}
          </span>
          <span className="text-[11px] font-mono text-zinc-600">
            {new Date(insight.created_at).toLocaleDateString("en-HK", {
              year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
            })}
          </span>
        </div>

        {/* Language toggle */}
        <div className="flex gap-0.5" role="tablist" aria-label="Language">
          <button
            role="tab"
            aria-selected={lang === "en"}
            onClick={() => setLang("en")}
            className={cn(
              "text-[11px] font-mono px-2 py-0.5 rounded transition-colors cursor-pointer",
              lang === "en" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            EN
          </button>
          <button
            role="tab"
            aria-selected={lang === "zh"}
            onClick={() => setLang("zh")}
            className={cn(
              "text-[11px] font-mono px-2 py-0.5 rounded transition-colors cursor-pointer",
              lang === "zh" ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            )}
          >
            繁中
          </button>
        </div>
      </div>

      <div className="text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {content || "Content not available in this language."}
      </div>

      {insight.trigger && (
        <div className="mt-4 text-[10px] font-mono text-zinc-700">
          Trigger: {insight.trigger}
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Write insights page with generate button**

```typescript
// src/app/(app)/mpf-care/insights/page.tsx
import { createClient } from "@/lib/supabase/server";
import { canGenerateInsight } from "@/lib/permissions";
import { InsightCard } from "@/components/mpf/insight-card";
import { DisclaimerBanner } from "@/components/mpf/disclaimer-banner";
import { GenerateInsightButton } from "./generate-button";
import type { MpfInsight } from "@/lib/mpf/types";
import type { UserRole } from "@/lib/types";

export default async function MpfInsightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  const role = (profile?.role || "agent") as UserRole;
  const canGenerate = canGenerateInsight(role);

  const { data: insights } = await supabase
    .from("mpf_insights")
    .select("*")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="max-w-[980px] mx-auto px-6 py-16 lg:py-24">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <a href="/mpf-care" className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors">
            ← MPF Care
          </a>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.03em] text-zinc-50 leading-[1.1]">
              Rebalancing Insights
            </h1>
            <p className="text-sm text-zinc-500 mt-2 font-mono">
              AI-generated AIA MPF Care Profiles
            </p>
          </div>
          {canGenerate && <GenerateInsightButton />}
        </div>
      </header>

      <DisclaimerBanner />

      <div className="mt-8 space-y-6">
        {(!insights || insights.length === 0) ? (
          <p className="text-sm text-zinc-500 py-8">No insights generated yet. {canGenerate ? "Click \"Generate Fresh Insight\" to create one." : ""}</p>
        ) : (
          (insights as MpfInsight[]).map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Write generate button client component**

```typescript
// src/app/(app)/mpf-care/insights/generate-button.tsx
"use client";

import { useState, useRef } from "react";

export function GenerateInsightButton() {
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleGenerate() {
    setStatus("generating");

    try {
      const res = await fetch("/api/mpf/insights", { method: "POST" });
      if (!res.ok) throw new Error("Failed");

      const { id } = await res.json();

      // Poll for completion
      pollRef.current = setInterval(async () => {
        const check = await fetch(`/api/mpf/insights/${id}`);
        const data = await check.json();
        if (data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("done");
          window.location.reload();
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setStatus("error");
        }
      }, 3000);

      // Timeout after 3 minutes
      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        // Use functional update to read current status without stale closure
        setStatus((prev) => (prev === "generating" ? "error" : prev));
      }, 180_000);
    } catch {
      setStatus("error");
    }
  }

  return (
    <button
      onClick={handleGenerate}
      disabled={status === "generating"}
      className="text-[12px] font-medium px-4 py-2 rounded-md bg-[#D71920] text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
    >
      {status === "generating" ? "Generating…" :
       status === "done" ? "Done!" :
       status === "error" ? "Failed — Retry" :
       "Generate Fresh Insight"}
    </button>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/mpf/insight-card.tsx src/app/\(app\)/mpf-care/insights/
git commit -m "feat(mpf): add Rebalancing Insights page with language toggle + generate button"
```

---

### Task 19: Dashboard MPF Summary Card

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add MPF summary to dashboard**

In `getStats()`, add MPF queries:

```typescript
// Add to the Promise.all array:
const mpfTopMovers = supabase
  .from("mpf_prices")
  .select("daily_change_pct, mpf_funds(fund_code, name_en)")
  .order("date", { ascending: false })
  .not("daily_change_pct", "is", null)
  .limit(25);

const mpfLatestInsight = supabase
  .from("mpf_insights")
  .select("content_en, type, created_at")
  .eq("status", "completed")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
```

Add to the `getStats()` Promise.all:

```typescript
const mpfTopMovers = supabase
  .from("mpf_prices")
  .select("daily_change_pct, date, mpf_funds(fund_code, name_en)")
  .not("daily_change_pct", "is", null)
  .order("date", { ascending: false })
  .limit(100);

const mpfLatestInsight = supabase
  .from("mpf_insights")
  .select("content_en, type, created_at")
  .eq("status", "completed")
  .order("created_at", { ascending: false })
  .limit(1)
  .single();
```

Deduplicate movers to get latest per fund, then sort by absolute change:

```typescript
// After Promise.all resolves:
const moversRaw = mpfTopMovers.data || [];
const seenFunds = new Set<string>();
const uniqueMovers = moversRaw.filter((m) => {
  const code = (m.mpf_funds as any)?.fund_code;
  if (!code || seenFunds.has(code)) return false;
  seenFunds.add(code);
  return true;
});
const top3 = uniqueMovers
  .sort((a, b) => Math.abs(b.daily_change_pct || 0) - Math.abs(a.daily_change_pct || 0))
  .slice(0, 3);
const insight = mpfLatestInsight.data;
```

Add a new section after the two-column grid:

```tsx
{/* MPF Care Summary */}
<section aria-labelledby="mpf-summary-heading" className="mt-20">
  <div className="flex items-center justify-between mb-6">
    <h2 id="mpf-summary-heading" className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
      MPF Care
    </h2>
    <a href="/mpf-care" className="text-[11px] font-medium text-[#D71920] hover:text-red-400 transition-colors">
      View all
    </a>
  </div>
  {top3.length > 0 ? (
    <div className="space-y-0 divide-y divide-zinc-800/60 mb-6">
      {top3.map((m, i) => {
        const fund = m.mpf_funds as any;
        const pct = m.daily_change_pct || 0;
        return (
          <div key={i} className="flex items-center justify-between py-3 first:pt-0">
            <div>
              <span className="text-[13px] text-zinc-300">{fund?.name_en}</span>
              <span className="text-[11px] text-zinc-600 ml-2 font-mono">{fund?.fund_code}</span>
            </div>
            <span className={`text-[13px] font-mono font-semibold tabular-nums ${pct > 0 ? "text-emerald-400" : "text-red-400"}`}>
              {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  ) : (
    <p className="text-sm text-zinc-500 mb-6">No fund data yet.</p>
  )}
  {insight?.content_en && (
    <p className="text-[12px] text-zinc-500 leading-relaxed line-clamp-3">
      {insight.content_en.slice(0, 200)}…
    </p>
  )}
</section>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(mpf): add MPF summary card to dashboard"
```

---

### Task 20: Manual Data Refresh + Upload APIs

**Files:**
- Create: `src/app/api/mpf/refresh/route.ts`
- Create: `src/app/api/mpf/upload/route.ts`

- [ ] **Step 1: Write manual refresh endpoint (admin/manager)**

```typescript
// src/app/api/mpf/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canTriggerMpfRefresh } from "@/lib/permissions";
import { scrapeAAStocksPrices, upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import { fetchNews } from "@/lib/mpf/scrapers/news-collector";
import { classifyUnclassifiedNews } from "@/lib/mpf/classification";
import type { UserRole } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!canTriggerMpfRefresh((profile?.role || "agent") as UserRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const prices = await scrapeAAStocksPrices();
    const priceCount = await upsertPrices(prices);
    const newsCount = await fetchNews();
    const classified = await classifyUnclassifiedNews();

    return NextResponse.json({ ok: true, prices: priceCount, news: newsCount, classified });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Write CSV/Excel upload endpoint (admin only)**

```typescript
// src/app/api/mpf/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUploadMpfData } from "@/lib/permissions";
import { upsertPrices } from "@/lib/mpf/scrapers/fund-prices";
import * as XLSX from "xlsx";
import type { UserRole } from "@/lib/types";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!canUploadMpfData((profile?.role || "agent") as UserRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<{ fund_code: string; date: string; nav: number }>(sheet);

  const prices = rows
    .filter((r) => r.fund_code && r.date && r.nav)
    .map((r) => ({
      fund_code: r.fund_code,
      date: r.date,
      nav: Number(r.nav),
      source: "manual" as const,
    }));

  const count = await upsertPrices(prices);

  return NextResponse.json({ ok: true, count });
}
```

- [ ] **Step 3: Install xlsx dependency**

```bash
npm install xlsx
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mpf/refresh/route.ts src/app/api/mpf/upload/route.ts
git commit -m "feat(mpf): add manual refresh + Excel upload APIs"
```

---

## Phase 5: Integration & Polish

### Task 21: Install Dependencies

- [ ] **Step 1: Install all new dependencies at once**

```bash
npm install recharts cheerio xlsx
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add recharts, cheerio, xlsx dependencies for MPF Care"
```

---

### Task 22: Env Vars Setup

- [ ] **Step 1: Add required env vars to Vercel**

```bash
# NewsAPI.org key
vercel env add NEWSAPI_KEY

# Cron secret (if not already set)
vercel env add CRON_SECRET

# Ollama Cloud should already be set from chat feature:
# OLLAMA_CLOUD_URL, OLLAMA_CLOUD_KEY
```

- [ ] **Step 2: Pull env vars locally**

```bash
vercel env pull .env.local
```

- [ ] **Step 3: Verify `.env.local` has all required vars**

Check for: `NEWSAPI_KEY`, `CRON_SECRET`, `OLLAMA_CLOUD_URL`, `OLLAMA_CLOUD_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

---

### Task 23: Deploy + Verify

- [ ] **Step 1: Build locally**

```bash
vercel build --prod
```

Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 2: Deploy**

```bash
vercel deploy --prebuilt --prod
```

- [ ] **Step 3: Run seed endpoint in production**

```bash
curl -X POST https://aia-assistant.vercel.app/api/mpf/seed
```

Expected: `{"message":"Seeded","count":25}`

- [ ] **Step 4: Verify pages load**

- `/mpf-care` — Overview page with empty states
- `/mpf-care/funds/AIA-HEF` — Fund Explorer for HK Equity
- `/mpf-care/news` — News feed (empty initially)
- `/mpf-care/insights` — Insights page (empty initially)

- [ ] **Step 5: Trigger manual refresh (as admin)**

Navigate to MPF Care, trigger refresh via API or admin UI.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(mpf): post-deploy fixes"
```

---

## Dependency Graph

```
Task 0 (Core Libs) → Task 1 (DB) → Task 2 (Types) → Task 3 (Constants) → Task 4 (Seed)
                                                    ↘
Task 5 (Permissions) ──────────────────────────────→ Task 6 (Nav)
                                                    ↓
Task 7 (Price Scraper) → Task 8 (News Collector) → Task 9 (Classification)
                                                    ↓
                                                  Task 10 (Cron Routes)
                                                    ↓
Task 11 (Insight Engine) → Task 12 (Weekly + On-Demand) → Task 13 (Alerts)
                                                    ↓
Task 14 (Shared Components) → Task 15 (Overview) → Task 16 (Fund Explorer)
                            → Task 17 (News Page) → Task 18 (Insights Page)
                                                    ↓
                                                  Task 19 (Dashboard Card)
                                                    ↓
Task 20 (Refresh + Upload) → Task 21 (Dependencies) → Task 22 (Env) → Task 23 (Deploy)
```

**Parallelizable groups:**
- Tasks 2, 3, 5 can run in parallel after Task 1
- Tasks 7, 8 can run in parallel after Task 3
- Tasks 15, 16, 17, 18 can run in parallel after Task 14
- Task 19 can run in parallel with Task 20

---

## Total Files

| Action | Count |
|--------|-------|
| **Create** | 23 new files |
| **Modify** | 4 existing files |
| **Total** | 27 files |

Estimated implementation: 24 tasks (Task 0–23), ~21 commits.
