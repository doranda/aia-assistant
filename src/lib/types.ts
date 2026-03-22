export type UserRole = "admin" | "manager" | "agent" | "member";

export interface MessageSource {
  document_id: string;
  document_title: string;
  page_number?: number;
  excerpt?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sources?: MessageSource[] | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
