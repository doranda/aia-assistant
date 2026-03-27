export type UserRole = "admin" | "manager" | "agent" | "member";

export type DeleteRequestStatus = "pending" | "approved" | "rejected";

export interface DeleteRequest {
  id: string;
  document_id: string;
  requested_by: string;
  reason: string | null;
  status: DeleteRequestStatus;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export type DocumentCategory =
  | "launchpad"
  | "memo"
  | "knowledge"
  | "promotions"
  | "premium_table"
  | "comparison"
  | "email_attachment"
  | "underwriting_guideline"
  | "claim_guideline"
  | "other";

export type DocumentSource = "upload" | "email" | "web_search";

export type DocumentStatus =
  | "pending"
  | "processing"
  | "indexed"
  | "error"
  | "pending_review";

export type MessageRole = "user" | "assistant";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}

export interface Document {
  id: string;
  title: string;
  category: DocumentCategory;
  source: DocumentSource;
  company: string | null;
  tags: string[];
  file_path: string;
  file_size: number;
  page_count: number | null;
  status: DocumentStatus;
  uploaded_by: string;
  is_deleted: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  sources: MessageSource[] | null;
  created_at: string;
}

export interface MessageSource {
  chunk_id: string;
  document_id: string;
  document_title: string;
  page_number: number;
  relevance_score: number;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  sources: MessageSource[] | null;
  created_by: string | null;
  use_count: number;
  created_at: string;
  updated_at: string;
}
