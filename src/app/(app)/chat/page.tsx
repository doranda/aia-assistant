import { createClient } from "@/lib/supabase/server";
import { ChatView } from "./chat-view";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: conversations } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", user!.id)
    .order("updated_at", { ascending: false });

  return <ChatView conversations={conversations ?? []} />;
}
