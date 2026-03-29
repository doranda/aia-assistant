-- 001_initial_schema.sql
-- Reconstructed from TypeScript types and query patterns (2026-03-29).
-- Original was created via Supabase dashboard. This backfill enables
-- fresh DB setup from migrations.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- profiles
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  full_name  TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','manager','agent','member')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON profiles TO authenticated, service_role;
GRANT SELECT ON profiles TO anon;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_select_authenticated') THEN
  CREATE POLICY "profiles_select_authenticated" ON profiles FOR SELECT TO authenticated USING (true);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profiles_update_own') THEN
  CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
END IF;
END $$;

-- documents
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other'
              CHECK (category IN ('launchpad','memo','knowledge','promotions','premium_table','comparison','email_attachment','underwriting_guideline','claim_guideline','other')),
  source      TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','email','web_search')),
  company     TEXT,
  tags        TEXT[] NOT NULL DEFAULT '{}',
  file_path   TEXT NOT NULL,
  file_size   BIGINT NOT NULL DEFAULT 0,
  page_count  INT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','processing','indexed','error','pending_review')),
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  is_deleted  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
GRANT ALL ON documents TO authenticated, service_role;
GRANT SELECT ON documents TO anon;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'documents_select_authenticated') THEN
  CREATE POLICY "documents_select_authenticated" ON documents FOR SELECT TO authenticated USING (true);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'documents_insert_authenticated') THEN
  CREATE POLICY "documents_insert_authenticated" ON documents FOR INSERT TO authenticated WITH CHECK (true);
END IF;
END $$;

-- chunks
CREATE TABLE IF NOT EXISTS chunks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  page_number INT NOT NULL DEFAULT 1,
  chunk_index INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON chunks TO authenticated, service_role;
GRANT SELECT ON chunks TO anon;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chunks_select_authenticated') THEN
  CREATE POLICY "chunks_select_authenticated" ON chunks FOR SELECT TO authenticated USING (true);
END IF;
END $$;

-- conversations
CREATE TABLE IF NOT EXISTS conversations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON conversations TO authenticated, service_role;
GRANT SELECT ON conversations TO anon;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'conversations_select_own') THEN
  CREATE POLICY "conversations_select_own" ON conversations FOR SELECT TO authenticated USING (auth.uid() = user_id);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'conversations_insert_own') THEN
  CREATE POLICY "conversations_insert_own" ON conversations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'conversations_delete_own') THEN
  CREATE POLICY "conversations_delete_own" ON conversations FOR DELETE TO authenticated USING (auth.uid() = user_id);
END IF;
END $$;

-- messages
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  sources         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
GRANT ALL ON messages TO authenticated, service_role;
GRANT SELECT ON messages TO anon;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages_select_own') THEN
  CREATE POLICY "messages_select_own" ON messages FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()));
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages_insert_own') THEN
  CREATE POLICY "messages_insert_own" ON messages FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()));
END IF;
END $$;

-- popular_queries
CREATE TABLE IF NOT EXISTS popular_queries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_text    TEXT NOT NULL,
  query_hash    TEXT NOT NULL,
  count         INT NOT NULL DEFAULT 1,
  last_asked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_asked_by UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_popular_queries_hash ON popular_queries(query_hash);
ALTER TABLE popular_queries ENABLE ROW LEVEL SECURITY;
GRANT ALL ON popular_queries TO authenticated, service_role;
GRANT SELECT ON popular_queries TO anon;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'popular_queries_select_authenticated') THEN
  CREATE POLICY "popular_queries_select_authenticated" ON popular_queries FOR SELECT TO authenticated USING (true);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'popular_queries_upsert_authenticated') THEN
  CREATE POLICY "popular_queries_upsert_authenticated" ON popular_queries FOR ALL TO authenticated USING (true) WITH CHECK (true);
END IF;
END $$;

-- delete_requests
CREATE TABLE IF NOT EXISTS delete_requests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id  UUID NOT NULL REFERENCES documents(id),
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  UUID REFERENCES auth.users(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE delete_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON delete_requests TO authenticated, service_role;
GRANT SELECT ON delete_requests TO anon;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delete_requests_select_authenticated') THEN
  CREATE POLICY "delete_requests_select_authenticated" ON delete_requests FOR SELECT TO authenticated USING (true);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delete_requests_insert_authenticated') THEN
  CREATE POLICY "delete_requests_insert_authenticated" ON delete_requests FOR INSERT TO authenticated WITH CHECK (true);
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delete_requests_update_authenticated') THEN
  CREATE POLICY "delete_requests_update_authenticated" ON delete_requests FOR UPDATE TO authenticated USING (true);
END IF;
END $$;
