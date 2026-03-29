-- 002_faqs.sql
-- Reconstructed from TypeScript types and query patterns (2026-03-29).

CREATE TABLE IF NOT EXISTS faqs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  keywords   TEXT[] NOT NULL DEFAULT '{}',
  sources    JSONB,
  created_by UUID REFERENCES auth.users(id),
  use_count  INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON faqs TO authenticated, service_role;
GRANT SELECT ON faqs TO anon;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'faqs_select_authenticated') THEN
  CREATE POLICY "faqs_select_authenticated" ON faqs FOR SELECT TO authenticated USING (true);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'faqs_all_authenticated') THEN
  CREATE POLICY "faqs_all_authenticated" ON faqs FOR ALL TO authenticated USING (true) WITH CHECK (true);
END IF;
END $$;
