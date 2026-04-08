-- Fix missing RLS write policies for chunks, documents, messages, conversations, delete_requests
-- These tables had SELECT policies but missing INSERT/UPDATE/DELETE policies,
-- causing user-client writes to silently fail under RLS.

-- ============================================================
-- CHUNKS: Need INSERT + DELETE for ingestion via user client
-- ============================================================
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chunks_insert_authenticated') THEN
  CREATE POLICY "chunks_insert_authenticated" ON chunks
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_id
        AND d.uploaded_by = auth.uid()
      )
    );
END IF;
END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'chunks_delete_authenticated') THEN
  CREATE POLICY "chunks_delete_authenticated" ON chunks
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_id
        AND d.uploaded_by = auth.uid()
      )
    );
END IF;
END $$;

-- ============================================================
-- DOCUMENTS: Need UPDATE for metadata edits + status changes
-- ============================================================
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'documents_update_authenticated') THEN
  CREATE POLICY "documents_update_authenticated" ON documents
    FOR UPDATE TO authenticated
    USING (uploaded_by = auth.uid())
    WITH CHECK (uploaded_by = auth.uid());
END IF;
END $$;

-- ============================================================
-- MESSAGES: Need DELETE for conversation cleanup
-- Ownership is via conversations.user_id (messages has no user_id col)
-- ============================================================
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'messages_delete_own') THEN
  CREATE POLICY "messages_delete_own" ON messages
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM conversations c
        WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
      )
    );
END IF;
END $$;

-- ============================================================
-- CONVERSATIONS: Need UPDATE for timestamp updates
-- ============================================================
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'conversations_update_own') THEN
  CREATE POLICY "conversations_update_own" ON conversations
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
END IF;
END $$;

-- ============================================================
-- DELETE_REQUESTS: Restrict UPDATE to admin/manager only
-- Drop overpermissive policy, replace with role-checked version
-- ============================================================
DROP POLICY IF EXISTS "delete_requests_update_authenticated" ON delete_requests;

-- Only allow updates (approve/reject) by users with admin or manager role
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'delete_requests_update_managers') THEN
  CREATE POLICY "delete_requests_update_managers" ON delete_requests
    FOR UPDATE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'manager')
      )
    );
END IF;
END $$;
