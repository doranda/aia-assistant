-- 002_fulltext_search.sql
-- Reconstructed from query patterns (2026-03-29).
-- Full-text search indexes for chunks and documents.

CREATE INDEX IF NOT EXISTS idx_chunks_content_trgm ON chunks USING gin (content gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_documents_title_trgm ON documents USING gin (title gin_trgm_ops);

-- Requires pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;
