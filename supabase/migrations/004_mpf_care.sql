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
